import { nikitaConfig } from "../config/nikita.js";

// =======================================================
// Хранилище сессий OTP и защита от злоупотреблений SMS.
//
// SMS стоят денег и требуют строгой защиты:
// 1. Кулдаун между отправками на один номер (по умолчанию 60с).
// 2. Лимит отправок на один номер в час (по умолчанию 5).
// 3. Лимит отправок с одного IP в час (по умолчанию 20).
// 4. Ограничение попыток ввода кода (максимум 5 на token).
// 5. Одноразовость token: удаление сразу после успешной проверки.
// 6. Маскирование номера в логах: 99677****56.
// =======================================================

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
    // token -> { phone, attempts, createdAt, expiresAt }
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
   * Проверка лимитов на отправку OTP.
   * Возвращает { allowed: true } или { allowed: false, message, retryAfter, reason }
   */
  checkSendLimits({ phone, ip }) {
    const now = Date.now();
    const cooldownMs = nikitaConfig.resendCooldownSec * 1000;
    const oneMinuteMs = 60 * 1000;
    const oneHourMs = 60 * 60 * 1000;
    const oneDayMs = 24 * 60 * 60 * 1000;

    // 0. Общий суточный потолок SMS на весь сервис (защита от разорения баланса провайдера)
    const freshServiceSms = this.serviceDailyHistory.filter(
      (ts) => now - ts < oneDayMs
    );
    this.serviceDailyHistory = freshServiceSms;
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

    // 4. Лимит в минуту на IP (10/мин, защита от скриптов/флуда)
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

      // 5. Лимит в час на IP (60/час с учётом CGNAT мобильных сетей)
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

    return { allowed: true };
  }

  /**
   * Фиксация успешной отправки OTP и сохранение сессии токена.
   */
  recordSend({ phone, ip, token, ttlMs, sentAt }) {
    const now = sentAt || Date.now();
    const expiresAt = now + (ttlMs || nikitaConfig.tokenTtlMs);

    // Если для этого номера уже был активный токен, инвалидируем старый
    const previousToken = this.phoneToToken.get(phone);
    if (previousToken && previousToken !== token) {
      this.tokens.delete(previousToken);
    }

    // Сохраняем сессию токена
    this.tokens.set(token, {
      phone,
      attempts: 0,
      createdAt: now,
      expiresAt,
    });
    this.phoneToToken.set(phone, token);

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

  /**
   * Поиск токена по token или по phone.
   */
  findRecord({ token, phone }) {
    const now = Date.now();

    let targetToken = token;
    if (!targetToken && phone) {
      targetToken = this.phoneToToken.get(phone);
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

    return { token: targetToken, ...record };
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
  }
}

export const phoneOtpStore = new PhoneOtpStore();
export default phoneOtpStore;
