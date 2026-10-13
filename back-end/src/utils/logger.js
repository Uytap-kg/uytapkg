// back-end/src/utils/logger.js
// Структурный JSON-логгер платформы UyTap без внешних зависимостей.
// Выводит JSON в process.stdout (debug, info, warn) и process.stderr (error).
// Рекурсивно маскирует конфиденциальные данные (секреты, токены, пароли, OTP) и PII (email, phone).

const SENSITIVE_KEYS = new Set([
  "password",
  "newpassword",
  "currentpassword",
  "token",
  "accesstoken",
  "refreshtoken",
  "resettoken",
  "authorization",
  "secret",
  "apikey",
  "code",
  "otp",
  "otpcode",
  "creditcard",
  "cvv",
]);

/**
 * Маскирование email: user@example.com -> u***@example.com
 */
export function maskEmail(str) {
  if (typeof str !== "string") return str;
  return str.replace(/([a-zA-Z0-9_\-+.]+)@([a-zA-Z0-9.\-_]+)/g, (_match, local, domain) => {
    const firstChar = local.length > 0 ? local[0] : "";
    return `${firstChar}***@${domain}`;
  });
}

/**
 * Маскирование номера телефона: +996555123456 -> +996***456
 */
export function maskPhone(str) {
  if (typeof str !== "string") return str;
  const replacedIntl = str.replace(/(\+\d{1,3})\d{3,}(\d{3})\b/g, "$1***$2");
  if (replacedIntl !== str) {
    return replacedIntl;
  }
  return str.replace(/\b(\d{3})\d{3,}(\d{3})\b/g, "$1***$2");
}

/**
 * Рекурсивная санитизация данных: вырезает секреты и маскирует PII
 */
export function sanitize(val, key = "", seen = new WeakSet()) {
  if (val === null || val === undefined) return val;

  const lowerKey = key.toLowerCase();
  if (SENSITIVE_KEYS.has(lowerKey)) {
    return "[REDACTED]";
  }

  if (typeof val === "string") {
    if (lowerKey === "authorization") {
      return "[REDACTED]";
    }
    let masked = maskEmail(val);
    masked = maskPhone(masked);
    return masked;
  }

  if (typeof val === "number" || typeof val === "boolean") {
    return val;
  }

  if (val instanceof Error) {
    return {
      name: val.name,
      message: sanitize(val.message, "message", seen),
      stack: val.stack,
    };
  }

  if (typeof val === "object") {
    if (seen.has(val)) {
      return "[Circular]";
    }
    seen.add(val);

    if (Array.isArray(val)) {
      return val.map((item) => sanitize(item, key, seen));
    }

    const cleaned = {};
    for (const [k, v] of Object.entries(val)) {
      cleaned[k] = sanitize(v, k, seen);
    }
    return cleaned;
  }

  return String(val);
}

/**
 * Формирование структурированной JSON-строки лога
 */
function formatLog(level, msg, context = {}) {
  let ctxObj = {};
  let reqId = undefined;

  if (context && typeof context === "object") {
    ctxObj = { ...context };
    if (ctxObj.requestId) {
      reqId = ctxObj.requestId;
      delete ctxObj.requestId;
    } else if (ctxObj.reqId) {
      reqId = ctxObj.reqId;
      delete ctxObj.reqId;
    }
  } else if (context !== undefined) {
    ctxObj = { value: context };
  }

  const sanitizedContext = sanitize(ctxObj);

  const payload = {
    level,
    time: new Date().toISOString(),
    msg: typeof msg === "string" ? sanitize(msg) : sanitize(String(msg)),
    ...(reqId ? { requestId: reqId } : {}),
    ...(sanitizedContext && Object.keys(sanitizedContext).length > 0 ? sanitizedContext : {}),
  };

  return JSON.stringify(payload);
}

export const logger = {
  debug(msg, context) {
    if (process.env.NODE_ENV !== "production" || process.env.LOG_LEVEL === "debug") {
      process.stdout.write(formatLog("debug", msg, context) + "\n");
    }
  },
  info(msg, context) {
    process.stdout.write(formatLog("info", msg, context) + "\n");
  },
  warn(msg, context) {
    process.stdout.write(formatLog("warn", msg, context) + "\n");
  },
  error(msg, context) {
    process.stderr.write(formatLog("error", msg, context) + "\n");
  },
};

export default logger;
