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
// - Межпроцессную синхронизацию сессий и счётчиков SMS через phoneOtpStore
// =======================================================

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

export const NIKITA_USER_MESSAGES = {
  [NIKITA_STATUS.SUCCESS]: "Успешно",
  [NIKITA_STATUS.INVALID_CODE]: "Неверный код",
  [NIKITA_STATUS.TIME_EXPIRED]: "Срок действия кода истёк, запросите новый",
  [NIKITA_STATUS.INVALID_PHONE]: "Некорректный номер телефона",
  [NIKITA_STATUS.INVALID_TOKEN]: "Сессия подтверждения устарела, запросите код заново",
  DEFAULT_ERROR: "Не удалось отправить код, попробуйте позже",
};

export function normalizeNikitaPhone(rawPhone) {
  if (!rawPhone || typeof rawPhone !== "string") {
    return {
      valid: false,
      phone: "",
      error: "Укажите номер телефона",
    };
  }

  let cleaned = rawPhone.replace(/\D/g, "");

  if (cleaned.startsWith("0") && cleaned.length === 10) {
    cleaned = "996" + cleaned.slice(1);
  } else if (cleaned.length === 9 && !cleaned.startsWith("996")) {
    cleaned = "996" + cleaned;
  }

  if (!/^\d{10,15}$/.test(cleaned)) {
    return {
      valid: false,
      phone: cleaned,
      error: "Некорректный номер телефона",
    };
  }

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

export function generateTransactionId() {
  return crypto.randomUUID().replace(/-/g, "");
}

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
  } catch {
    throw new Error(
      `Nikita API вернул невалидный JSON (HTTP ${response.status}): ${text.slice(0, 200)}`
    );
  }

  return { response, json };
}

export async function sendOtp({ phone, ip, purpose = "registration" }) {
  assertNikitaConfigured();

  const normalized = normalizeNikitaPhone(phone);
  if (!normalized.valid) {
    return {
      success: false,
      status: NIKITA_STATUS.INVALID_PHONE,
      message: normalized.error,
    };
  }
  const cleanPhone = normalized.phone;

  if (!cleanPhone.startsWith("996") || cleanPhone.length !== 12) {
    return {
      success: false,
      status: NIKITA_STATUS.INVALID_PHONE,
      message: "Разрешены только номера Кыргызстана (+996)",
    };
  }

  // Защита от злоупотреблений и гонок: резервируем слот (в памяти и общем хранилище БД) ДО await к Nikita
  const limitCheck = await phoneOtpStore.checkSendLimitsShared({
    phone: cleanPhone,
    ip,
    reserve: true,
  });
  if (!limitCheck.allowed) {
    return {
      success: false,
      rateLimited: true,
      retryAfter: limitCheck.retryAfter,
      message: limitCheck.message,
    };
  }

  let resultJson;
  let lastError;

  try {
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
  } finally {
    if (!resultJson) {
      phoneOtpStore.rollbackSendReservation(limitCheck.reservation);
    } else {
      phoneOtpStore.completeSendReservation(limitCheck.reservation);
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

  const statusCode = Number(resultJson.status);

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

    await phoneOtpStore.recordSendShared({
      phone: cleanPhone,
      ip,
      token,
      ttlMs: nikitaConfig.tokenTtlMs,
      purpose,
      skipCounters: true,
    });

    logger.info("SMS OTP успешно отправлен через Nikita", {
      phone: maskPhoneNikita(cleanPhone),
      purpose,
    });

    return {
      success: true,
      token,
      phone: cleanPhone,
      purpose,
      message: "Код подтверждения отправлен по SMS",
    };
  }

  const description = resultJson.description || "";

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

export async function verifyOtp({ token, phone, code, purpose }) {
  assertNikitaConfigured();

  const strCode = code !== null && code !== undefined ? String(code).trim() : "";
  if (!strCode) {
    return {
      success: false,
      status: NIKITA_STATUS.INVALID_CODE,
      message: "Укажите код подтверждения",
    };
  }

  let cleanPhone = "";
  if (typeof phone === "string" && phone.trim() !== "") {
    const norm = normalizeNikitaPhone(phone);
    if (!norm.valid) {
      return {
        success: false,
        status: NIKITA_STATUS.INVALID_PHONE,
        message: norm.error,
      };
    }
    cleanPhone = norm.phone;
  }

  const session = await phoneOtpStore.findRecordShared({ token, phone: cleanPhone, purpose });
  if (!session) {
    return {
      success: false,
      status: NIKITA_STATUS.INVALID_TOKEN,
      message: NIKITA_USER_MESSAGES[NIKITA_STATUS.INVALID_TOKEN],
    };
  }

  const activeToken = session.token;

  if (!phoneOtpStore.acquireVerifyLock(activeToken)) {
    return {
      success: false,
      status: NIKITA_STATUS.INVALID_TOKEN,
      message: "Проверка кода уже выполняется, подождите",
    };
  }

  try {
    const freshSession = await phoneOtpStore.findRecordShared({ token: activeToken, phone: cleanPhone, purpose });
    if (!freshSession) {
      return {
        success: false,
        status: NIKITA_STATUS.INVALID_TOKEN,
        message: NIKITA_USER_MESSAGES[NIKITA_STATUS.INVALID_TOKEN],
      };
    }

    const attemptResult = await phoneOtpStore.registerAttemptShared(activeToken);
    if (!attemptResult.allowed) {
      return {
        success: false,
        status: NIKITA_STATUS.INVALID_TOKEN,
        message: "Превышено максимальное число попыток ввода кода (5). Запросите новый код",
        attemptsLeft: 0,
      };
    }

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

    const statusCode = Number(resultJson.status);

    if (statusCode === NIKITA_STATUS.SUCCESS) {
      await phoneOtpStore.invalidateTokenShared(activeToken);

      logger.info("SMS OTP код успешно подтвержден через Nikita", {
        purpose: freshSession.purpose,
      });

      return {
        success: true,
        status: 0,
        phone: freshSession.phone,
        purpose: freshSession.purpose,
        message: "Код подтвержден",
      };
    }

    if (statusCode === NIKITA_STATUS.INVALID_CODE) {
      return {
        success: false,
        status: 14,
        message: NIKITA_USER_MESSAGES[NIKITA_STATUS.INVALID_CODE],
        attemptsLeft: attemptResult.attemptsLeft,
      };
    }

    if (statusCode === NIKITA_STATUS.TIME_EXPIRED) {
      await phoneOtpStore.invalidateTokenShared(activeToken);
      return {
        success: false,
        status: 13,
        message: NIKITA_USER_MESSAGES[NIKITA_STATUS.TIME_EXPIRED],
      };
    }

    if (statusCode === NIKITA_STATUS.INVALID_TOKEN) {
      await phoneOtpStore.invalidateTokenShared(activeToken);
      return {
        success: false,
        status: 12,
        message: NIKITA_USER_MESSAGES[NIKITA_STATUS.INVALID_TOKEN],
      };
    }

    logger.error("Nikita OTP verify вернул ошибку", {
      status: statusCode,
      description: resultJson.description,
    });

    return {
      success: false,
      status: statusCode,
      message: NIKITA_USER_MESSAGES.DEFAULT_ERROR,
    };
  } finally {
    phoneOtpStore.releaseVerifyLock(activeToken);
  }
}

export const nikitaService = {
  sendOtp,
  verifyOtp,
  normalizeNikitaPhone,
  generateTransactionId,
  maskPhoneNikita,
};

export default nikitaService;
