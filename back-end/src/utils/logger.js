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
    const truncated = val.length > 2000 ? `${val.slice(0, 2000)}...[truncated]` : val;
    let masked = maskEmail(truncated);
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

// Защита от шторма одинаковых ошибок под нагрузкой (disk/stdout flood protection):
// не более LOG_BURST_MAX_PER_WINDOW одинаковых warn/error за LOG_BURST_WINDOW_MS.
export const LOG_BURST_WINDOW_MS = 10 * 1000;
export const LOG_BURST_MAX_PER_WINDOW = 20;
const MAX_BURST_KEYS = 500;
const logBurstState = new Map();

export function resetLoggerBurstState() {
  logBurstState.clear();
}

function checkLogBurst(level, msg) {
  const key = `${level}:${typeof msg === "string" ? msg.slice(0, 160) : String(msg).slice(0, 160)}`;
  const now = Date.now();
  let entry = logBurstState.get(key);

  if (!entry || now - entry.windowStart >= LOG_BURST_WINDOW_MS) {
    const suppressedFromPrev = entry && entry.suppressed > 0 ? entry.suppressed : 0;
    if (logBurstState.size >= MAX_BURST_KEYS && !logBurstState.has(key)) {
      const oldestKey = logBurstState.keys().next().value;
      if (oldestKey !== undefined) logBurstState.delete(oldestKey);
    }
    entry = { windowStart: now, count: 1, suppressed: 0 };
    logBurstState.set(key, entry);
    return { allowed: true, suppressedFromPrev };
  }

  entry.count += 1;
  if (entry.count <= LOG_BURST_MAX_PER_WINDOW) {
    return { allowed: true, suppressedFromPrev: 0 };
  }

  entry.suppressed += 1;
  return { allowed: false, suppressedFromPrev: 0 };
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
    const burst = checkLogBurst("warn", msg);
    if (!burst.allowed) return;
    const ctx =
      burst.suppressedFromPrev > 0
        ? { ...(context && typeof context === "object" ? context : {}), suppressedSimilarLogs: burst.suppressedFromPrev }
        : context;
    process.stdout.write(formatLog("warn", msg, ctx) + "\n");
  },
  error(msg, context) {
    const burst = checkLogBurst("error", msg);
    if (!burst.allowed) return;
    const ctx =
      burst.suppressedFromPrev > 0
        ? { ...(context && typeof context === "object" ? context : {}), suppressedSimilarLogs: burst.suppressedFromPrev }
        : context;
    process.stderr.write(formatLog("error", msg, ctx) + "\n");
  },
};

export default logger;
