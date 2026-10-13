// back-end/src/utils/alerts.js
// Модуль оповещения о критических сбоях и предупреждениях платформы UyTap.
// Отправляет уведомления в Telegram при наличии ALERT_TELEGRAM_BOT_TOKEN и ALERT_TELEGRAM_CHAT_ID.
// Включает 5-минутную дедупликацию однотипных алертов, таймаут 3с и полную изоляцию от сбоев Telegram.
// Всегда дублирует запись в структурный logger.

import logger from "./logger.js";

const DEDUPLICATION_WINDOW_MS = 5 * 60 * 1000; // 5 минут
const TELEGRAM_TIMEOUT_MS = 3000; // 3 секунды

// Кэш для дедупликации: key -> timestamp последней отправки
const alertDeduplicationCache = new Map();

/**
 * Очистка кэша дедупликации (используется в тестах)
 */
export function clearAlertDeduplicationCache() {
  alertDeduplicationCache.clear();
}

/**
 * Проверка дедупликации
 */
function shouldSendAlert(key) {
  const now = Date.now();
  const lastSent = alertDeduplicationCache.get(key);
  if (lastSent && now - lastSent < DEDUPLICATION_WINDOW_MS) {
    return false;
  }
  alertDeduplicationCache.set(key, now);

  // Очистка старых записей из кэша (memory leak protection)
  if (alertDeduplicationCache.size > 1000) {
    for (const [k, ts] of alertDeduplicationCache.entries()) {
      if (now - ts >= DEDUPLICATION_WINDOW_MS) {
        alertDeduplicationCache.delete(k);
      }
    }
  }

  return true;
}

/**
 * Экранирование спецсимволов HTML для Telegram API
 */
function escapeHtml(text) {
  if (typeof text !== "string") return String(text ?? "");
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Отправка сообщения в Telegram с таймаутом и подавлением ошибок
 */
async function sendToTelegram(severity, message, context = {}) {
  const botToken = process.env.ALERT_TELEGRAM_BOT_TOKEN;
  const chatId = process.env.ALERT_TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    return false;
  }

  const icon = severity === "CRITICAL" ? "🚨 [CRITICAL ALERT]" : "⚠️ [WARNING ALERT]";
  const timeStr = new Date().toISOString();

  let contextStr = "";
  if (context && Object.keys(context).length > 0) {
    try {
      contextStr = `\n<pre>${escapeHtml(JSON.stringify(context, null, 2))}</pre>`;
    } catch {
      contextStr = `\n<pre>${escapeHtml(String(context))}</pre>`;
    }
  }

  const text = `<b>${escapeHtml(icon)}</b>\n<b>Время:</b> <code>${escapeHtml(timeStr)}</code>\n<b>Сообщение:</b> ${escapeHtml(message)}${contextStr}`;

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
      }),
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
    });

    return response.ok;
  } catch (err) {
    // Никогда не роняем бэкенд из-за сбоя в Telegram API
    logger.warn("Failed to dispatch alert to Telegram", { error: err?.message });
    return false;
  }
}

export const alerts = {
  async critical(msg, ctx = {}) {
    logger.error(`[CRITICAL ALERT] ${msg}`, ctx);

    const dedupKey = `CRITICAL:${ctx?.key || msg}`;
    if (!shouldSendAlert(dedupKey)) {
      return false;
    }

    return sendToTelegram("CRITICAL", msg, ctx);
  },

  async warn(msg, ctx = {}) {
    logger.warn(`[WARN ALERT] ${msg}`, ctx);

    const dedupKey = `WARN:${ctx?.key || msg}`;
    if (!shouldSendAlert(dedupKey)) {
      return false;
    }

    return sendToTelegram("WARN", msg, ctx);
  },
};

export default alerts;
