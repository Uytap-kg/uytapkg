import crypto from "crypto";
import { nikitaConfig, assertNikitaConfigured } from "../config/nikita.js";
import { phoneOtpStore, maskPhoneNikita } from "../utils/phoneOtpStore.js";
import logger from "../utils/logger.js";

// =======================================================
// Клиент SMS-сервиса Nikita OTP API (https://smspro.nikita.kg).
//
// Реализует:
// - Отправку одноразовых кодов через POST /api/otp/send
// - Проверку кодов через POST /api/otp/verify
// - Нормализацию и валидацию номеров телефона
// - Генерацию уникальных 32-символьных transaction_id
// - Маппинг status (число/строка) в понятные пользовательские ошибки
// - Защиту от злоупотреблений (rate limit, ограничение попыток, одноразовость)
// - Безопасный 1-кратный ретрай при сетевых сбоях с НОВЫМ transaction_id
// =======================================================

/**
 * Коды ответов Nikita OTP API
 */
export const NIKITA_STATUS = {
  SUCCESS: 0,
  BAD_FORMAT: 1,
  BAD_AUTH: 2,
  BAD_IP: 3,
  NOT_ENOUGH_MONEY: 4,
  SENDER_OR_TEXT_NOT_SET: 5,
  INVALID_PHONE: 7,
  INVALID_TRANSACTION_ID: 10,
  INVALID_TOKEN: 12,
  TIME_EXPIRED: 13,
  INVALID_CODE: 14,
};

/**
 * Пользовательские сообщения для статусов ошибок
 */
export const NIKITA_USER_MESSAGES = {
  [NIKITA_STATUS.SUCCESS]: "Успешно",
  [NIKITA_STATUS.INVALID_CODE]: "Неверный код",
  [NIKITA_STATUS.TIME_EXPIRED]: "Срок действия кода истёк, запросите новый",
  [NIKITA_STATUS.INVALID_PHONE]: "Некорректный номер телефона",
  [NIKITA_STATUS.INVALID_TOKEN]: "Сессия подтверждения устарела, запросите код заново",
  DEFAULT_ERROR: "Не удалось отправить код, попробуйте позже",
};

/**
 * Нормализация и валидация номера телефона под формат Nikita OTP API:
 * - Убирает +, пробелы, скобки, дефисы.
 * - 0XXXXXXXXX (10 цифр) превращает в 996XXXXXXXXX.
 * - 9 цифр (XXXXXXXXX) превращает в 996XXXXXXXXX.
 * - Проверяет международный формат без "+".
 */
export function normalizeNikitaPhone(rawPhone) {
  if (!rawPhone || typeof rawPhone !== "string") {
    return {
      valid: false,
      phone: "",
      error: "Укажите номер телефона",
    };
  }

  // Очистка от всех нецифровых символов (пробелы, +, скобки, тире)
  let cleaned = rawPhone.replace(/\D/g, "");

  // Локальный формат Кыргызстана: 0XXXXXXXXX (10 цифр) -> 996XXXXXXXXX (12 цифр)
  if (cleaned.startsWith("0") && cleaned.length === 10) {
    cleaned = "996" + cleaned.slice(1);
  } else if (cleaned.length === 9 && !cleaned.startsWith("996")) {
    // 9 цифр без префикса (например, 770123456) -> 996770123456
    cleaned = "996" + cleaned;
  }

  // Международный номер: от 10 до 15 цифр без плюса
  if (!/^\d{10,15}$/.test(cleaned)) {
    return {
      valid: false,
      phone: cleaned,
      error: "Некорректный номер телефона",
    };
  }

  // Для номеров Кыргызстана (префикс 996) строго 12 цифр
  if (cleaned.startsWith("996") && cleaned.length !== 12) {
    return {
      valid: false,
      phone: cleaned,
      error: "Некорректный номер телефона Кыргызстана (должно быть 9 цифр после 996)",
    };
  }

  return {
    valid: true,
    phone: cleaned,
    error: null,
  };
}

/**
 * Генерация уникального transaction_id до 32 символов (буквы и цифры).
 * Использует UUID v4 без дефисов (ровно 32 шестнадцатеричных символа).
 */
export function generateTransactionId() {
  return crypto.randomUUID().replace(/-/g, "");
}

/**
 * Выполнение HTTP-запроса к Nikita с таймаутом.
 */
async function postNikita(endpoint, body) {
  assertNikitaConfigured();

  const url = `${nikitaConfig.baseUrl}${endpoint}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": nikitaConfig.apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(nikitaConfig.timeoutMs),
  });

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `Nikita API вернул невалидный JSON (HTTP ${response.status}): ${text.slice(0, 200)}`
    );
  }

  return { response, json };
}

/**
 * Отправка одноразового OTP кода через SMS.
 *
 * @param {Object} params
 * @param {string} params.phone - Номер телефона получателя
 * @param {string} [params.ip] - IP-адрес клиента для rate limiting
 * @returns {Promise<{success: boolean, token?: string, status?: number, message: string, retryAfter?: number, rateLimited?: boolean}>}
 */
export async function sendOtp({ phone, ip }) {
  // 1. Проверка конфигурации API-ключа
  assertNikitaConfigured();

  // 2. Нормализация и валидация номера телефона
  const normalized = normalizeNikitaPhone(phone);
  if (!normalized.valid) {
    return {
      success: false,
      status: NIKITA_STATUS.INVALID_PHONE,
      message: normalized.error,
    };
  }
  const cleanPhone = normalized.phone;

  // 3. Защита от злоупотреблений и rate limit (кулдаун и лимиты в час)
  const limitCheck = phoneOtpStore.checkSendLimits({ phone: cleanPhone, ip });
  if (!limitCheck.allowed) {
    return {
      success: false,
      rateLimited: true,
      retryAfter: limitCheck.retryAfter,
      message: limitCheck.message,
    };
  }

  // 4. Отправка запроса с обработкой безопасного 1-кратного ретрая при сетевой ошибке ДО ответа
  let resultJson;
  let lastError;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const transactionId = generateTransactionId();
    try {
      const { json } = await postNikita("/api/otp/send", {
        transaction_id: transactionId,
        phone: cleanPhone,
      });
      resultJson = json;
      break;
    } catch (err) {
      lastError = err;
      // Повтор только при сетевой ошибке до получения ответа и только 1 раз (attempt 1)
      const isAbortOrTimeout = err.name === "TimeoutError" || err.name === "AbortError";
      if (attempt === 1 && !isAbortOrTimeout) {
        logger.warn("Сетевой сбой при отправке в Nikita OTP API, повтор с новым transaction_id", {
          phone: maskPhoneNikita(cleanPhone),
          error: err.message,
        });
        continue;
      }
      break;
    }
  }

  if (!resultJson) {
    logger.error("Не удалось отправить SMS через Nikita OTP (сетевая ошибка)", {
      phone: maskPhoneNikita(cleanPhone),
      error: lastError?.message,
    });
    return {
      success: false,
      message: NIKITA_USER_MESSAGES.DEFAULT_ERROR,
    };
  }

  // Приведение типа статуса (Nikita может вернуть число 0 или строку "0")
  const statusCode = Number(resultJson.status);

  // 5. Обработка успешного ответа
  if (statusCode === NIKITA_STATUS.SUCCESS) {
    const token = resultJson.token;
    if (!token) {
      logger.error("Nikita OTP API вернул статус 0, но токен отсутствует", {
        phone: maskPhoneNikita(cleanPhone),
        description: resultJson.description,
      });
      return {
        success: false,
        message: NIKITA_USER_MESSAGES.DEFAULT_ERROR,
      };
    }

    // Сохраняем сессию в локальном хранилище для последующей проверки
    phoneOtpStore.recordSend({
      phone: cleanPhone,
      ip,
      token,
      ttlMs: nikitaConfig.tokenTtlMs,
    });

    logger.info("SMS OTP успешно отправлен через Nikita", {
      phone: maskPhoneNikita(cleanPhone),
    });

    return {
      success: true,
      token,
      phone: cleanPhone,
      message: "Код подтверждения отправлен по SMS",
    };
  }

  // 6. Обработка ошибок со стороны Nikita
  const description = resultJson.description || "";

  // 1, 2, 3, 4, 5, 10 — проблемы конфигурации, баланса или формата
  if (
    statusCode === NIKITA_STATUS.BAD_AUTH ||
    statusCode === NIKITA_STATUS.BAD_IP ||
    statusCode === NIKITA_STATUS.NOT_ENOUGH_MONEY ||
    statusCode === NIKITA_STATUS.SENDER_OR_TEXT_NOT_SET ||
    statusCode === NIKITA_STATUS.BAD_FORMAT ||
    statusCode === NIKITA_STATUS.INVALID_TRANSACTION_ID
  ) {
    logger.error("Ошибка конфигурации или баланса в Nikita OTP API", {
      status: statusCode,
      description,
      phone: maskPhoneNikita(cleanPhone),
    });
    return {
      success: false,
      status: statusCode,
      message: NIKITA_USER_MESSAGES.DEFAULT_ERROR,
    };
  }

  const userMessage =
    NIKITA_USER_MESSAGES[statusCode] || NIKITA_USER_MESSAGES.DEFAULT_ERROR;

  return {
    success: false,
    status: statusCode,
    message: userMessage,
  };
}

/**
 * Проверка введённого пользователем OTP кода.
 *
 * @param {Object} params
 * @param {string} [params.token] - Токен сессии, полученный при отправке
 * @param {string} [params.phone] - Номер телефона (если токен не передан напрямую)
 * @param {string|number} params.code - Код подтверждения из SMS
 * @returns {Promise<{success: boolean, status?: number, message: string, attemptsLeft?: number}>}
 */
export async function verifyOtp({ token, phone, code }) {
  // 1. Проверка конфигурации API-ключа
  assertNikitaConfigured();

  const strCode = code !== null && code !== undefined ? String(code).trim() : "";
  if (!strCode) {
    return {
      success: false,
      status: NIKITA_STATUS.INVALID_CODE,
      message: "Укажите код подтверждения",
    };
  }

  // 2. Поиск активной сессии токена
  let cleanPhone = "";
  if (phone) {
    const norm = normalizeNikitaPhone(phone);
    if (norm.valid) cleanPhone = norm.phone;
  }

  const session = phoneOtpStore.findRecord({ token, phone: cleanPhone });
  if (!session) {
    return {
      success: false,
      status: NIKITA_STATUS.INVALID_TOKEN,
      message: NIKITA_USER_MESSAGES[NIKITA_STATUS.INVALID_TOKEN],
    };
  }

  const activeToken = session.token;

  // 3. Учёт попыток ввода (максимум 5 на один токен для защиты от подбора)
  const attemptResult = phoneOtpStore.registerAttempt(activeToken);
  if (!attemptResult.allowed) {
    return {
      success: false,
      status: NIKITA_STATUS.INVALID_TOKEN,
      message: "Превышено максимальное число попыток ввода кода (5). Запросите новый код",
      attemptsLeft: 0,
    };
  }

  // 4. Запрос проверки кода в Nikita OTP API
  let resultJson;
  try {
    const { json } = await postNikita("/api/otp/verify", {
      token: activeToken,
      code: strCode,
    });
    resultJson = json;
  } catch (err) {
    logger.error("Ошибка при обращении к Nikita OTP verify API", {
      error: err.message,
    });
    return {
      success: false,
      message: "Не удалось проверить код. Попробуйте снова.",
    };
  }

  // Приведение типа: в verify status приходит строкой ("0")
  const statusCode = Number(resultJson.status);

  // 5. Успешная валидация
  if (statusCode === NIKITA_STATUS.SUCCESS) {
    // Токен одноразовый: немедленно инвалидируем после успешного подтверждения
    phoneOtpStore.invalidateToken(activeToken);

    logger.info("SMS OTP код успешно подтвержден через Nikita");

    return {
      success: true,
      status: 0,
      phone: session.phone,
      message: "Код подтвержден",
    };
  }

  // 6. Обработка ошибок верификации
  // 14: Неверный код
  if (statusCode === NIKITA_STATUS.INVALID_CODE) {
    return {
      success: false,
      status: 14,
      message: NIKITA_USER_MESSAGES[NIKITA_STATUS.INVALID_CODE],
      attemptsLeft: attemptResult.attemptsLeft,
    };
  }

  // 13: Срок действия кода истек
  if (statusCode === NIKITA_STATUS.TIME_EXPIRED) {
    phoneOtpStore.invalidateToken(activeToken);
    return {
      success: false,
      status: 13,
      message: NIKITA_USER_MESSAGES[NIKITA_STATUS.TIME_EXPIRED],
    };
  }

  // 12: Неверный токен
  if (statusCode === NIKITA_STATUS.INVALID_TOKEN) {
    phoneOtpStore.invalidateToken(activeToken);
    return {
      success: false,
      status: 12,
      message: NIKITA_USER_MESSAGES[NIKITA_STATUS.INVALID_TOKEN],
    };
  }

  // Прочие ошибки со стороны провайдера
  logger.error("Nikita OTP verify вернул ошибку", {
    status: statusCode,
    description: resultJson.description,
  });

  return {
    success: false,
    status: statusCode,
    message: NIKITA_USER_MESSAGES.DEFAULT_ERROR,
  };
}

// =======================================================
// TODO: Подключение отчётов о доставке SMS (Delivery Reports / DR).
//
// При необходимости получения детальных статусов доставки:
// 1. Зарегистрировать callback URL на бэкенде: например, POST /api/otp/dr
// 2. В кабинете Nikita указать URL callback или периодически опрашивать:
//    POST https://smspro.nikita.kg/api/dr
//    Body: { "transaction_id": "...", "message_id": "..." }
// 3. Сохранять статусы (DELIVRD, EXPIRED, UNDELIV) в таблицу логов сообщений.
// =======================================================

export const nikitaService = {
  sendOtp,
  verifyOtp,
  normalizeNikitaPhone,
  generateTransactionId,
  maskPhoneNikita,
};

export default nikitaService;
