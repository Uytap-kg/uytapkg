import { nikitaConfig } from "../config/nikita.js";
import logger from "./logger.js";
import { setBoundedMap, evictExpiredAndCapMap, addBoundedSet } from "./boundedMap.js";
import {
  checkAndIncrementRateLimit,
  resetAllRateLimitCounters,
  releaseRateLimit,
  saveSharedPhoneOtpSession,
  loadSharedPhoneOtpSession,
  consumeSharedPhoneOtpAttempt,
  deleteSharedPhoneOtpSession,
} from "./sharedState.js";

export const MAX_OTP_MAP_SIZE = 10000;
export const MAX_INFLIGHT_SET_SIZE = 5000;
export const MAX_SERVICE_HISTORY_SIZE = 20000;

export const VALID_OTP_PURPOSES = new Set([
  "registration",
  "phone_change",
  "password_reset",
]);

/**
 * Безопасное маскирование номера телефона для логов.
 * Пример: "996770123456" -> "99677****56"
 */
export function maskPhoneNikita(phone) {
  if (!phone || typeof phone !== "string") return "";
  const cleaned = phone.replace(/\D/g, "");
  if (cleaned.length < 7) return "***";
  return `${cleaned.slice(0, 5)}****${cleaned.slice(-2)}`;
}

class PhoneOtpStore {
  constructor() {
    // token -> { phone, purpose, attempts, createdAt, expiresAt }
    this.tokens = new Map();
    // normalizedPhone -> latest token
    this.phoneToToken = new Map();
    // normalizedPhone -> lastSentTimestamp
    this.phoneLastSent = new Map();
    // normalizedPhone -> [timestamp, timestamp, ...] (1 час)
    this.phoneHourlyHistory = new Map();
    // normalizedPhone -> [timestamp, timestamp, ...] (24 часа)
    this.phoneDailyHistory = new Map();
    // ip -> [timestamp, timestamp, ...] (1 минута)
    this.ipMinuteHistory = new Map();
    // ip -> [timestamp, timestamp, ...] (1 час)
    this.ipHourlyHistory = new Map();
    // [timestamp, timestamp, ...] (24 часа на весь сервис)
    this.serviceDailyHistory = [];
    // Блокировки активных (in-flight) отправок по номеру для защиты от гонки TOCTOU
    this.inFlightSends = new Set();
    // Блокировки активных (in-flight) сетевых проверок кода по токену
    this.verifyingTokens = new Set();

    // Запуск сборщика мусора раз в 5 минут
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);

    // Не блокировать завершение процесса Node.js
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Запись отправки SMS на уровне сервиса (для учёта суточного потолка)
   */
  recordServiceSms(timestamp = Date.now()) {
    this.serviceDailyHistory.push(timestamp);
    if (this.serviceDailyHistory.length > MAX_SERVICE_HISTORY_SIZE) {
      this.serviceDailyHistory = this.serviceDailyHistory.slice(-MAX_SERVICE_HISTORY_SIZE);
    }
  }

  /**
   * Проверка лимитов на отправку OTP (и опциональное синхронное резервирование слота до await).
   * Возвращает { allowed: true, reservation? } или { allowed: false, message, retryAfter, reason }
   */
  checkSendLimits({ phone, ip, reserve = false }) {
    const now = Date.now();
    const cooldownMs = nikitaConfig.resendCooldownSec * 1000;
    const oneMinuteMs = 60 * 1000;
    const oneHourMs = 60 * 60 * 1000;
    const oneDayMs = 24 * 60 * 60 * 1000;

    // 0. Проверка параллельной отправки (in-flight) на тот же номер
    if (this.inFlightSends.has(phone)) {
      return {
        allowed: false,
        retryAfter: nikitaConfig.resendCooldownSec,
        reason: "cooldown",
        message: `Повторная отправка возможна через ${nikitaConfig.resendCooldownSec} секунд`,
      };
    }

    // 0.1 Общий суточный потолок SMS на весь сервис (защита от разорения баланса провайдера)
    const freshServiceSms = this.serviceDailyHistory.filter(
      (ts) => now - ts < oneDayMs
    );
    this.serviceDailyHistory = freshServiceSms;

    const warningThreshold = Math.floor(nikitaConfig.dailyServiceCeiling * 0.7);
    if (freshServiceSms.length >= warningThreshold) {
      logger.warn("SMS daily ceiling threshold reached (>= 70%)", {
        currentCount: freshServiceSms.length,
        ceiling: nikitaConfig.dailyServiceCeiling,
        percent: Math.round((freshServiceSms.length / nikitaConfig.dailyServiceCeiling) * 100),
      });
    }

    if (freshServiceSms.length >= nikitaConfig.dailyServiceCeiling) {
      return {
        allowed: false,
        reason: "service_daily_limit",
        message: "Превышен суточный лимит отправки SMS сервиса. Попробуйте позже или используйте вход по email.",
      };
    }

    // 1. Кулдаун на номер (60с)
    const lastSent = this.phoneLastSent.get(phone);
    if (lastSent && now - lastSent < cooldownMs) {
      const waitSec = Math.ceil((cooldownMs - (now - lastSent)) / 1000);
      return {
        allowed: false,
        retryAfter: waitSec,
        reason: "cooldown",
        message: `Повторная отправка возможна через ${waitSec} секунд`,
      };
    }

    // 2. Лимит в час на номер
    const phoneHistory = (this.phoneHourlyHistory.get(phone) || []).filter(
      (ts) => now - ts < oneHourMs
    );
    if (phoneHistory.length > 0) {
      setBoundedMap(this.phoneHourlyHistory, phone, phoneHistory, MAX_OTP_MAP_SIZE);
    } else {
      this.phoneHourlyHistory.delete(phone);
    }

    if (phoneHistory.length >= nikitaConfig.hourlyLimitPhone) {
      return {
        allowed: false,
        reason: "phone_hourly_limit",
        message: "Превышен лимит отправок на этот номер телефона в час. Попробуйте позже.",
      };
    }

    // 3. Суточный лимит на номер (24 часа)
    const phoneDaily = (this.phoneDailyHistory.get(phone) || []).filter(
      (ts) => now - ts < oneDayMs
    );
    if (phoneDaily.length > 0) {
      setBoundedMap(this.phoneDailyHistory, phone, phoneDaily, MAX_OTP_MAP_SIZE);
    } else {
      this.phoneDailyHistory.delete(phone);
    }

    if (phoneDaily.length >= nikitaConfig.dailyLimitPhone) {
      return {
        allowed: false,
        reason: "phone_daily_limit",
        message: "Превышен суточный лимит отправок SMS на этот номер. Попробуйте завтра.",
      };
    }

    // 4. Лимит в минуту на IP (защита от скриптов/флуда)
    if (ip) {
      const ipMinute = (this.ipMinuteHistory.get(ip) || []).filter(
        (ts) => now - ts < oneMinuteMs
      );
      if (ipMinute.length > 0) {
        setBoundedMap(this.ipMinuteHistory, ip, ipMinute, MAX_OTP_MAP_SIZE);
      } else {
        this.ipMinuteHistory.delete(ip);
      }

      if (ipMinute.length >= nikitaConfig.minuteLimitIp) {
        return {
          allowed: false,
          reason: "ip_minute_limit",
          message: "Слишком много запросов на отправку кода с вашего IP за минуту. Подождите немного.",
        };
      }

      // 5. Лимит в час на IP (с учётом CGNAT мобильных сетей)
      const ipHistory = (this.ipHourlyHistory.get(ip) || []).filter(
        (ts) => now - ts < oneHourMs
      );
      if (ipHistory.length > 0) {
        setBoundedMap(this.ipHourlyHistory, ip, ipHistory, MAX_OTP_MAP_SIZE);
      } else {
        this.ipHourlyHistory.delete(ip);
      }

      if (ipHistory.length >= nikitaConfig.hourlyLimitIp) {
        return {
          allowed: false,
          reason: "ip_hourly_limit",
          message: "Слишком много запросов на отправку кода с вашего IP-адреса. Попробуйте позже.",
        };
      }
    }

    if (reserve) {
      const previousLastSent = this.phoneLastSent.get(phone) ?? null;
      addBoundedSet(this.inFlightSends, phone, MAX_INFLIGHT_SET_SIZE);
      setBoundedMap(this.phoneLastSent, phone, now, MAX_OTP_MAP_SIZE);

      phoneHistory.push(now);
      setBoundedMap(this.phoneHourlyHistory, phone, phoneHistory, MAX_OTP_MAP_SIZE);

      phoneDaily.push(now);
      setBoundedMap(this.phoneDailyHistory, phone, phoneDaily, MAX_OTP_MAP_SIZE);

      if (ip) {
        const ipMin = this.ipMinuteHistory.get(ip) || [];
        ipMin.push(now);
        setBoundedMap(this.ipMinuteHistory, ip, ipMin, MAX_OTP_MAP_SIZE);

        const ipHr = this.ipHourlyHistory.get(ip) || [];
        ipHr.push(now);
        setBoundedMap(this.ipHourlyHistory, ip, ipHr, MAX_OTP_MAP_SIZE);
      }

      this.recordServiceSms(now);

      return {
        allowed: true,
        reservation: {
          phone,
          ip,
          timestamp: now,
          previousLastSent,
        },
      };
    }

    return { allowed: true };
  }

  /**
   * Межпроцессная проверка и резервирование лимитов отправки SMS (память + PostgreSQL / общее хранилище).
   */
  async checkSendLimitsShared({ phone, ip, reserve = false }) {
    const localResult = this.checkSendLimits({ phone, ip, reserve });
    if (!localResult.allowed) {
      return localResult;
    }

    const cooldownMs = nikitaConfig.resendCooldownSec * 1000;
    const oneMinuteMs = 60 * 1000;
    const oneHourMs = 60 * 60 * 1000;
    const oneDayMs = 24 * 60 * 60 * 1000;
    const inc = reserve ? 1 : 0;

    // 1. Общий суточный потолок SMS
    const serviceCheck = await checkAndIncrementRateLimit(
      "sms:service_daily",
      oneDayMs,
      nikitaConfig.dailyServiceCeiling,
      inc
    );
    if (!serviceCheck.allowed) {
      if (reserve && localResult.reservation) this.rollbackSendReservation(localResult.reservation);
      return {
        allowed: false,
        reason: "service_daily_limit",
        message: "Превышен суточный лимит отправки SMS сервиса. Попробуйте позже или используйте вход по email.",
      };
    }

    // 2. Кулдаун на номер (60с)
    const cooldownCheck = await checkAndIncrementRateLimit(
      `sms:cooldown:${phone}`,
      cooldownMs,
      1,
      inc
    );
    if (!cooldownCheck.allowed) {
      if (reserve && localResult.reservation) this.rollbackSendReservation(localResult.reservation);
      const waitSec = cooldownCheck.retryAfterSec || nikitaConfig.resendCooldownSec;
      return {
        allowed: false,
        retryAfter: waitSec,
        reason: "cooldown",
        message: `Повторная отправка возможна через ${waitSec} секунд`,
      };
    }

    // 3. Часовой лимит на номер
    const phoneHourCheck = await checkAndIncrementRateLimit(
      `sms:phone_hour:${phone}`,
      oneHourMs,
      nikitaConfig.hourlyLimitPhone,
      inc
    );
    if (!phoneHourCheck.allowed) {
      if (reserve && localResult.reservation) this.rollbackSendReservation(localResult.reservation);
      return {
        allowed: false,
        reason: "phone_hourly_limit",
        message: "Превышен лимит отправок на этот номер телефона в час. Попробуйте позже.",
      };
    }

    // 4. Суточный лимит на номер
    const phoneDayCheck = await checkAndIncrementRateLimit(
      `sms:phone_day:${phone}`,
      oneDayMs,
      nikitaConfig.dailyLimitPhone,
      inc
    );
    if (!phoneDayCheck.allowed) {
      if (reserve && localResult.reservation) this.rollbackSendReservation(localResult.reservation);
      return {
        allowed: false,
        reason: "phone_daily_limit",
        message: "Превышен суточный лимит отправок SMS на этот номер. Попробуйте завтра.",
      };
    }

    // 5. Лимиты по IP
    if (ip) {
      const ipMinCheck = await checkAndIncrementRateLimit(
        `sms:ip_min:${ip}`,
        oneMinuteMs,
        nikitaConfig.minuteLimitIp,
        inc
      );
      if (!ipMinCheck.allowed) {
        if (reserve && localResult.reservation) this.rollbackSendReservation(localResult.reservation);
        return {
          allowed: false,
          reason: "ip_minute_limit",
          message: "Слишком много запросов на отправку кода с вашего IP за минуту. Подождите немного.",
        };
      }

      const ipHourCheck = await checkAndIncrementRateLimit(
        `sms:ip_hour:${ip}`,
        oneHourMs,
        nikitaConfig.hourlyLimitIp,
        inc
      );
      if (!ipHourCheck.allowed) {
        if (reserve && localResult.reservation) this.rollbackSendReservation(localResult.reservation);
        return {
          allowed: false,
          reason: "ip_hourly_limit",
          message: "Слишком много запросов на отправку кода с вашего IP-адреса. Попробуйте позже.",
        };
      }
    }

    return localResult;
  }

  /**
   * Снятие in-flight флага после успешной отправки.
   */
  completeSendReservation(reservation) {
    if (!reservation?.phone) return;
    this.inFlightSends.delete(reservation.phone);
  }

  /**
   * Откат зарезервированного слота (при сетевой ошибке ДО отправки SMS).
   */
  rollbackSendReservation(reservation) {
    if (!reservation) return;
    const { phone, ip, timestamp, previousLastSent } = reservation;
    this.inFlightSends.delete(phone);

    if (this.phoneLastSent.get(phone) === timestamp) {
      if (previousLastSent !== null && previousLastSent !== undefined) {
        setBoundedMap(this.phoneLastSent, phone, previousLastSent, MAX_OTP_MAP_SIZE);
      } else {
        this.phoneLastSent.delete(phone);
      }
    }

    const removeTs = (arr) => {
      if (!Array.isArray(arr)) return [];
      const idx = arr.lastIndexOf(timestamp);
      if (idx !== -1) arr.splice(idx, 1);
      return arr;
    };

    if (this.phoneHourlyHistory.has(phone)) {
      setBoundedMap(this.phoneHourlyHistory, phone, removeTs(this.phoneHourlyHistory.get(phone)), MAX_OTP_MAP_SIZE);
    }
    if (this.phoneDailyHistory.has(phone)) {
      setBoundedMap(this.phoneDailyHistory, phone, removeTs(this.phoneDailyHistory.get(phone)), MAX_OTP_MAP_SIZE);
    }
    if (ip) {
      if (this.ipMinuteHistory.has(ip)) {
        setBoundedMap(this.ipMinuteHistory, ip, removeTs(this.ipMinuteHistory.get(ip)), MAX_OTP_MAP_SIZE);
      }
      if (this.ipHourlyHistory.has(ip)) {
        setBoundedMap(this.ipHourlyHistory, ip, removeTs(this.ipHourlyHistory.get(ip)), MAX_OTP_MAP_SIZE);
      }
    }
    removeTs(this.serviceDailyHistory);
  }

  /**
   * Полный откат резервирования: память + общие счётчики (PostgreSQL / SHARED_STATE_FILE).
   * Вызывается, когда SMS фактически не отправлена.
   */
  async rollbackSendReservationShared(reservation) {
    if (!reservation) return;
    this.rollbackSendReservation(reservation);
    const { phone, ip } = reservation;
    const keys = [
      "sms:service_daily",
      `sms:cooldown:${phone}`,
      `sms:phone_hour:${phone}`,
      `sms:phone_day:${phone}`,
    ];
    if (ip) keys.push(`sms:ip_min:${ip}`, `sms:ip_hour:${ip}`);
    await Promise.all(keys.map((key) => releaseRateLimit(key, 1)));
  }

  /**
   * Фиксация успешной отправки OTP и сохранение сессии токена.
   */
  recordSend({
    phone,
    ip,
    token,
    ttlMs,
    sentAt,
    purpose = "registration",
    skipCounters = false,
  }) {
    const normalizedPurpose = VALID_OTP_PURPOSES.has(purpose) ? purpose : "registration";
    const now = sentAt || Date.now();
    const expiresAt = now + (ttlMs || nikitaConfig.tokenTtlMs);

    // Если для этого номера уже был активный токен, инвалидируем старый
    const previousToken = this.phoneToToken.get(phone);
    if (previousToken && previousToken !== token) {
      this.tokens.delete(previousToken);
      this.verifyingTokens.delete(previousToken);
    }

    const sessionRecord = {
      phone,
      purpose: normalizedPurpose,
      attempts: 0,
      createdAt: now,
      expiresAt,
    };

    // Сохраняем сессию токена со строгой привязкой к phone и purpose и ограничением размера Map
    setBoundedMap(this.tokens, token, sessionRecord, MAX_OTP_MAP_SIZE);
    setBoundedMap(this.phoneToToken, phone, token, MAX_OTP_MAP_SIZE);

    if (!skipCounters) {
      setBoundedMap(this.phoneLastSent, phone, now, MAX_OTP_MAP_SIZE);

      const phoneHistory = this.phoneHourlyHistory.get(phone) || [];
      phoneHistory.push(now);
      setBoundedMap(this.phoneHourlyHistory, phone, phoneHistory, MAX_OTP_MAP_SIZE);

      const phoneDaily = this.phoneDailyHistory.get(phone) || [];
      phoneDaily.push(now);
      setBoundedMap(this.phoneDailyHistory, phone, phoneDaily, MAX_OTP_MAP_SIZE);

      if (ip) {
        const ipMinute = this.ipMinuteHistory.get(ip) || [];
        ipMinute.push(now);
        setBoundedMap(this.ipMinuteHistory, ip, ipMinute, MAX_OTP_MAP_SIZE);

        const ipHistory = this.ipHourlyHistory.get(ip) || [];
        ipHistory.push(now);
        setBoundedMap(this.ipHourlyHistory, ip, ipHistory, MAX_OTP_MAP_SIZE);
      }

      this.recordServiceSms(now);
    }

    // Фоново сохраняем сессию в общее хранилище (PostgreSQL / SHARED_STATE_FILE)
    saveSharedPhoneOtpSession({ token, ...sessionRecord }).catch(() => {});
  }

  /**
   * Асинхронная фиксация успешной отправки OTP с гарантированным сохранением в общем хранилище.
   */
  async recordSendShared(params) {
    this.recordSend(params);
    const rec = this.tokens.get(params.token);
    if (rec) {
      await saveSharedPhoneOtpSession({ token: params.token, ...rec });
    }
  }

  /**
   * Поиск токена по token или по phone с обязательной сверкой phone и purpose.
   */
  findRecord({ token, phone, purpose }) {
    const now = Date.now();
    const cleanToken = typeof token === "string" ? token.trim() : "";
    const cleanPhone = typeof phone === "string" ? phone.trim() : "";

    let targetToken = cleanToken;
    if (!targetToken && cleanPhone) {
      targetToken = this.phoneToToken.get(cleanPhone) || "";
    }

    if (!targetToken) return null;

    const record = this.tokens.get(targetToken);
    if (!record) return null;

    // Проверка истечения времени жизни на нашей стороне
    if (now > record.expiresAt) {
      this.invalidateToken(targetToken);
      return null;
    }

    // Если передан телефон, он обязан строго совпадать с телефоном сессии
    if (cleanPhone && record.phone !== cleanPhone) {
      return null;
    }

    // Проверка соответствия назначения (purpose), если указано вызывающим кодом
    if (purpose !== undefined && purpose !== null) {
      const allowedPurposes = Array.isArray(purpose) ? purpose : [purpose];
      if (!allowedPurposes.includes(record.purpose)) {
        return null;
      }
    }

    return { token: targetToken, ...record };
  }

  /**
   * Межпроцессный поиск сессии OTP (память + PostgreSQL / общее хранилище).
   */
  async findRecordShared({ token, phone, purpose }) {
    const local = this.findRecord({ token, phone, purpose });
    if (local) return local;

    const cleanToken = typeof token === "string" ? token.trim() : "";
    const cleanPhone = typeof phone === "string" ? phone.trim() : "";
    const shared = await loadSharedPhoneOtpSession({ token: cleanToken, phone: cleanPhone });
    if (!shared || shared.used) return null;

    setBoundedMap(this.tokens, shared.token, {
      phone: shared.phone,
      purpose: shared.purpose,
      attempts: shared.attempts || 0,
      createdAt: shared.createdAt,
      expiresAt: shared.expiresAt,
    }, MAX_OTP_MAP_SIZE);
    setBoundedMap(this.phoneToToken, shared.phone, shared.token, MAX_OTP_MAP_SIZE);

    return this.findRecord({ token: shared.token, phone: cleanPhone, purpose });
  }

  /**
   * Блокировка сессии на время сетевого запроса проверки кода (защита от параллельных запросов).
   */
  acquireVerifyLock(token) {
    if (!token || this.verifyingTokens.has(token)) {
      return false;
    }
    addBoundedSet(this.verifyingTokens, token, MAX_INFLIGHT_SET_SIZE);
    return true;
  }

  releaseVerifyLock(token) {
    if (!token) return;
    this.verifyingTokens.delete(token);
  }

  /**
   * Учёт попытки проверки кода.
   * Возвращает { allowed: boolean, attempts: number, attemptsLeft: number }
   */
  registerAttempt(token) {
    const record = this.tokens.get(token);
    if (!record) {
      return { allowed: false, attempts: -1, attemptsLeft: 0, expired: true };
    }

    record.attempts += 1;
    const maxAttempts = nikitaConfig.maxVerifyAttempts;

    if (record.attempts > maxAttempts) {
      // Превышен лимит попыток: инвалидируем токен навсегда
      this.invalidateToken(token);
      return {
        allowed: false,
        attempts: record.attempts,
        attemptsLeft: 0,
        exhausted: true,
      };
    }

    const attemptsLeft = Math.max(0, maxAttempts - record.attempts);
    return {
      allowed: true,
      attempts: record.attempts,
      attemptsLeft,
      exhausted: false,
    };
  }

  /**
   * Межпроцессный атомарный учёт попытки проверки кода.
   */
  async registerAttemptShared(token) {
    const maxAttempts = nikitaConfig.maxVerifyAttempts;
    const sharedAttempts = await consumeSharedPhoneOtpAttempt(token, maxAttempts + 1);
    if (typeof sharedAttempts === "number") {
      const record = this.tokens.get(token);
      if (record) {
        record.attempts = sharedAttempts === -1 ? maxAttempts + 1 : sharedAttempts;
      }
      if (sharedAttempts === -1 || sharedAttempts > maxAttempts) {
        await this.invalidateTokenShared(token);
        return {
          allowed: false,
          attempts: maxAttempts + 1,
          attemptsLeft: 0,
          exhausted: true,
        };
      }
      return {
        allowed: true,
        attempts: sharedAttempts,
        attemptsLeft: Math.max(0, maxAttempts - sharedAttempts),
        exhausted: false,
      };
    }

    return this.registerAttempt(token);
  }

  /**
   * Инвалидация токена (одноразовое использование или сброс).
   */
  invalidateToken(token) {
    if (!token) return;
    const record = this.tokens.get(token);
    if (record?.phone) {
      if (this.phoneToToken.get(record.phone) === token) {
        this.phoneToToken.delete(record.phone);
      }
    }
    this.tokens.delete(token);
    this.verifyingTokens.delete(token);
    deleteSharedPhoneOtpSession(token).catch(() => {});
  }

  async invalidateTokenShared(token) {
    this.invalidateToken(token);
    await deleteSharedPhoneOtpSession(token);
  }

  /**
   * Очистка устаревших записей + жёсткое усечение размеров по FIFO
   */
  cleanup() {
    const now = Date.now();
    const oneMinuteMs = 60 * 1000;
    const oneHourMs = 60 * 60 * 1000;
    const oneDayMs = 24 * 60 * 60 * 1000;
    const cooldownMs = nikitaConfig.resendCooldownSec * 1000;

    evictExpiredAndCapMap(this.tokens, MAX_OTP_MAP_SIZE, (record, token) => {
      const expired = now > record.expiresAt;
      if (expired) {
        if (record.phone && this.phoneToToken.get(record.phone) === token) {
          this.phoneToToken.delete(record.phone);
        }
        this.verifyingTokens.delete(token);
      }
      return expired;
    });

    evictExpiredAndCapMap(this.phoneToToken, MAX_OTP_MAP_SIZE, (tok) => !this.tokens.has(tok));
    evictExpiredAndCapMap(this.phoneLastSent, MAX_OTP_MAP_SIZE, (ts) => now - ts >= cooldownMs);

    for (const [ip, history] of this.ipMinuteHistory.entries()) {
      const fresh = history.filter((ts) => now - ts < oneMinuteMs);
      if (fresh.length === 0) {
        this.ipMinuteHistory.delete(ip);
      } else {
        this.ipMinuteHistory.set(ip, fresh);
      }
    }
    evictExpiredAndCapMap(this.ipMinuteHistory, MAX_OTP_MAP_SIZE);

    for (const [ip, history] of this.ipHourlyHistory.entries()) {
      const fresh = history.filter((ts) => now - ts < oneHourMs);
      if (fresh.length === 0) {
        this.ipHourlyHistory.delete(ip);
      } else {
        this.ipHourlyHistory.set(ip, fresh);
      }
    }
    evictExpiredAndCapMap(this.ipHourlyHistory, MAX_OTP_MAP_SIZE);

    for (const [phone, history] of this.phoneHourlyHistory.entries()) {
      const fresh = history.filter((ts) => now - ts < oneHourMs);
      if (fresh.length === 0) {
        this.phoneHourlyHistory.delete(phone);
      } else {
        this.phoneHourlyHistory.set(phone, fresh);
      }
    }
    evictExpiredAndCapMap(this.phoneHourlyHistory, MAX_OTP_MAP_SIZE);

    for (const [phone, history] of this.phoneDailyHistory.entries()) {
      const fresh = history.filter((ts) => now - ts < oneDayMs);
      if (fresh.length === 0) {
        this.phoneDailyHistory.delete(phone);
      } else {
        this.phoneDailyHistory.set(phone, fresh);
      }
    }
    evictExpiredAndCapMap(this.phoneDailyHistory, MAX_OTP_MAP_SIZE);

    this.serviceDailyHistory = this.serviceDailyHistory.filter(
      (ts) => now - ts < oneDayMs
    );
    if (this.serviceDailyHistory.length > MAX_SERVICE_HISTORY_SIZE) {
      this.serviceDailyHistory = this.serviceDailyHistory.slice(-MAX_SERVICE_HISTORY_SIZE);
    }
  }

  /**
   * Сброс всех данных (для тестов)
   */
  reset() {
    this.tokens.clear();
    this.phoneToToken.clear();
    this.phoneLastSent.clear();
    this.phoneHourlyHistory.clear();
    this.phoneDailyHistory.clear();
    this.ipMinuteHistory.clear();
    this.ipHourlyHistory.clear();
    this.serviceDailyHistory = [];
    this.inFlightSends.clear();
    this.verifyingTokens.clear();
    resetAllRateLimitCounters();
  }
}

export const phoneOtpStore = new PhoneOtpStore();
export default phoneOtpStore;
