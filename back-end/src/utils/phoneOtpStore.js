import { nikitaConfig } from "../config/nikita.js";
import logger from "./logger.js";

// =======================================================
// Хранилище сессий OTP и защита от злоупотреблений SMS.
//
// SMS стоят денег и требуют строгой защиты:
// 1. Кулдаун между отправками на один номер (по умолчанию 60с).
// 2. Лимит отправок на один номер в час (по умолчанию 5).
// 3. Лимит отправок с одного IP в час (по умолчанию 120) и в минуту (30).
// 4. Ограничение попыток ввода кода (максимум 5 на token).
// 5. Одноразовость token: удаление сразу после успешной проверки.
// 6. Привязка сессии к номеру (phone) и назначению (purpose).
// 7. Синхронное резервирование слота ДО сетевого запроса в Nikita (защита от гонок TOCTOU).
// 8. Маскирование номера в логах: 99677****56.
// =======================================================

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
    this.phoneHourlyHistory.set(phone, phoneHistory);

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
    this.phoneDailyHistory.set(phone, phoneDaily);

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
      this.ipMinuteHistory.set(ip, ipMinute);

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
      this.ipHourlyHistory.set(ip, ipHistory);

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
      this.inFlightSends.add(phone);
      this.phoneLastSent.set(phone, now);

      phoneHistory.push(now);
      this.phoneHourlyHistory.set(phone, phoneHistory);

      phoneDaily.push(now);
      this.phoneDailyHistory.set(phone, phoneDaily);

      if (ip) {
        const ipMin = this.ipMinuteHistory.get(ip) || [];
        ipMin.push(now);
        this.ipMinuteHistory.set(ip, ipMin);

        const ipHr = this.ipHourlyHistory.get(ip) || [];
        ipHr.push(now);
        this.ipHourlyHistory.set(ip, ipHr);
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
        this.phoneLastSent.set(phone, previousLastSent);
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
      this.phoneHourlyHistory.set(phone, removeTs(this.phoneHourlyHistory.get(phone)));
    }
    if (this.phoneDailyHistory.has(phone)) {
      this.phoneDailyHistory.set(phone, removeTs(this.phoneDailyHistory.get(phone)));
    }
    if (ip) {
      if (this.ipMinuteHistory.has(ip)) {
        this.ipMinuteHistory.set(ip, removeTs(this.ipMinuteHistory.get(ip)));
      }
      if (this.ipHourlyHistory.has(ip)) {
        this.ipHourlyHistory.set(ip, removeTs(this.ipHourlyHistory.get(ip)));
      }
    }
    removeTs(this.serviceDailyHistory);
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

    // Сохраняем сессию токена со строгой привязкой к phone и purpose
    this.tokens.set(token, {
      phone,
      purpose: normalizedPurpose,
      attempts: 0,
      createdAt: now,
      expiresAt,
    });
    this.phoneToToken.set(phone, token);

    if (!skipCounters) {
      // Обновляем метки времени лимитов
      this.phoneLastSent.set(phone, now);

      const phoneHistory = this.phoneHourlyHistory.get(phone) || [];
      phoneHistory.push(now);
      this.phoneHourlyHistory.set(phone, phoneHistory);

      const phoneDaily = this.phoneDailyHistory.get(phone) || [];
      phoneDaily.push(now);
      this.phoneDailyHistory.set(phone, phoneDaily);

      if (ip) {
        const ipMinute = this.ipMinuteHistory.get(ip) || [];
        ipMinute.push(now);
        this.ipMinuteHistory.set(ip, ipMinute);

        const ipHistory = this.ipHourlyHistory.get(ip) || [];
        ipHistory.push(now);
        this.ipHourlyHistory.set(ip, ipHistory);
      }

      // Фиксируем в суточной истории сервиса
      this.recordServiceSms(now);
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

    if (!targetToken) {
      return null;
    }

    const record = this.tokens.get(targetToken);
    if (!record) {
      return null;
    }

    // Проверка срока жизни токена
    if (now > record.expiresAt) {
      this.invalidateToken(targetToken);
      return null;
    }

    // P0-01: Если переданы и token, и phone, номер в сессии ОБЯЗАН совпадать с переданным номером
    if (cleanPhone && record.phone !== cleanPhone) {
      return null;
    }

    // P0-02: Проверка назначения сессии (purpose), если указано вызывающим кодом
    if (purpose !== undefined && purpose !== null) {
      const allowedPurposes = Array.isArray(purpose) ? purpose : [purpose];
      if (!allowedPurposes.includes(record.purpose)) {
        return null;
      }
    }

    return { token: targetToken, ...record };
  }

  /**
   * Блокировка сессии на время сетевого запроса проверки кода (защита от параллельных запросов).
   */
  acquireVerifyLock(token) {
    if (!token || this.verifyingTokens.has(token)) {
      return false;
    }
    this.verifyingTokens.add(token);
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
  }

  /**
   * Очистка устаревших записей
   */
  cleanup() {
    const now = Date.now();
    const oneMinuteMs = 60 * 1000;
    const oneHourMs = 60 * 60 * 1000;
    const oneDayMs = 24 * 60 * 60 * 1000;

    // Удаляем протухшие токены
    for (const [token, record] of this.tokens.entries()) {
      if (now > record.expiresAt) {
        if (record.phone && this.phoneToToken.get(record.phone) === token) {
          this.phoneToToken.delete(record.phone);
        }
        this.tokens.delete(token);
        this.verifyingTokens.delete(token);
      }
    }

    // Очищаем старые записи истории IP (минутные)
    for (const [ip, history] of this.ipMinuteHistory.entries()) {
      const fresh = history.filter((ts) => now - ts < oneMinuteMs);
      if (fresh.length === 0) {
        this.ipMinuteHistory.delete(ip);
      } else {
        this.ipMinuteHistory.set(ip, fresh);
      }
    }

    // Очищаем старые записи истории IP (часовые)
    for (const [ip, history] of this.ipHourlyHistory.entries()) {
      const fresh = history.filter((ts) => now - ts < oneHourMs);
      if (fresh.length === 0) {
        this.ipHourlyHistory.delete(ip);
      } else {
        this.ipHourlyHistory.set(ip, fresh);
      }
    }

    // Очищаем старые записи истории номеров (часовые)
    for (const [phone, history] of this.phoneHourlyHistory.entries()) {
      const fresh = history.filter((ts) => now - ts < oneHourMs);
      if (fresh.length === 0) {
        this.phoneHourlyHistory.delete(phone);
      } else {
        this.phoneHourlyHistory.set(phone, fresh);
      }
    }

    // Очищаем старые записи истории номеров (суточные)
    for (const [phone, history] of this.phoneDailyHistory.entries()) {
      const fresh = history.filter((ts) => now - ts < oneDayMs);
      if (fresh.length === 0) {
        this.phoneDailyHistory.delete(phone);
      } else {
        this.phoneDailyHistory.set(phone, fresh);
      }
    }

    // Очищаем суточную историю сервиса
    this.serviceDailyHistory = this.serviceDailyHistory.filter(
      (ts) => now - ts < oneDayMs
    );
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
  }
}

export const phoneOtpStore = new PhoneOtpStore();
export default phoneOtpStore;
