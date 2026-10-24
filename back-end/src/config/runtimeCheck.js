import logger from "../utils/logger.js";

/**
 * Проверка обязательных секретов окружения в production-режиме (Fail-Fast).
 * Возвращает массив ошибок конфигурации (пустой, если всё валидно).
 */
export function checkProductionSecrets(env = process.env) {
  const errors = [];

  const jwtSecret = typeof env.JWT_SECRET === "string" ? env.JWT_SECRET.trim() : "";
  if (jwtSecret.length < 32) {
    errors.push(
      "КРИТИЧЕСКАЯ ОШИБКА КОНФИГУРАЦИИ: Переменная окружения JWT_SECRET в production обязана быть длиной не менее 32 символов."
    );
  }

  const otpSecret = typeof env.OTP_SECRET === "string" ? env.OTP_SECRET.trim() : "";
  if (otpSecret.length < 32) {
    errors.push(
      "КРИТИЧЕСКАЯ ОШИБКА КОНФИГУРАЦИИ: Переменная окружения OTP_SECRET обязательна в production (минимум 32 символа)."
    );
  } else if (otpSecret === jwtSecret) {
    errors.push(
      "КРИТИЧЕСКАЯ ОШИБКА КОНФИГУРАЦИИ: OTP_SECRET в production не должен совпадать с JWT_SECRET (требуется разделение ключей)."
    );
  }

  const proxySecret =
    typeof env.INTERNAL_PROXY_SECRET === "string" ? env.INTERNAL_PROXY_SECRET.trim() : "";
  if (proxySecret.length < 16) {
    errors.push(
      "КРИТИЧЕСКАЯ ОШИБКА КОНФИГУРАЦИИ: Переменная окружения INTERNAL_PROXY_SECRET обязательна в production (минимум 16 символов) для защиты от подмены IP-адресов."
    );
  }

  return errors;
}

/**
 * Проверка боевой конфигурации платёжного шлюза O!Dengi в production-режиме (P1-05).
 */
export function checkProductionOdengiConfig(env = process.env) {
  const errors = [];

  if (env.ODENGI_TEST !== "0") {
    errors.push(
      "КРИТИЧЕСКАЯ ОШИБКА КОНФИГУРАЦИИ: В production режиме ODENGI_TEST обязан быть равен '0' (боевой режим O!Dengi)."
    );
  }

  const resultUrl = typeof env.ODENGI_RESULT_URL === "string" ? env.ODENGI_RESULT_URL.trim() : "";
  let isValidWebhookUrl = false;
  if (resultUrl) {
    try {
      const parsed = new URL(resultUrl);
      isValidWebhookUrl =
        (parsed.protocol === "https:" || parsed.protocol === "http:") &&
        parsed.pathname.replace(/\/+$/, "") === "/api/payments/webhook";
    } catch {
      isValidWebhookUrl = false;
    }
  }

  if (!isValidWebhookUrl) {
    errors.push(
      "КРИТИЧЕСКАЯ ОШИБКА КОНФИГУРАЦИИ: В production режиме ODENGI_RESULT_URL обязан указывать на /api/payments/webhook."
    );
  }

  return errors;
}

/**
 * Вызывает process.exit(1) при обнаружении ошибок конфигурации в production.
 */
export function enforceProductionSecrets(env = process.env) {
  if (env.NODE_ENV !== "production") return;

  const errors = [
    ...checkProductionSecrets(env),
    ...checkProductionOdengiConfig(env),
  ];
  if (errors.length > 0) {
    for (const msg of errors) {
      logger.error(msg);
    }
    process.exit(1);
  }
}

export default enforceProductionSecrets;
