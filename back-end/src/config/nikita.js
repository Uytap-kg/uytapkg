import dotenv from "dotenv";

dotenv.config();

// =======================================================
// Конфигурация SMS-сервиса Nikita OTP (smspro.nikita.kg).
//
// Все секреты (API-ключ) берутся ИСКЛЮЧИТЕЛЬНО из переменных
// окружения и никогда не должны логироваться или хардкодиться.
// =======================================================

export const nikitaConfig = {
  // Обязательный API-ключ из кабинета Nikita (вкладка «СЕРВИС OTP»)
  get apiKey() {
    return process.env.NIKITA_API_KEY || "";
  },
  // Базовый URL API Nikita (по умолчанию https://smspro.nikita.kg)
  get baseUrl() {
    return (process.env.NIKITA_BASE_URL || "https://smspro.nikita.kg").replace(/\/+$/, "");
  },
  // Таймаут сетевого запроса в миллисекундах (по умолчанию 10 секунд)
  get timeoutMs() {
    const val = Number(process.env.NIKITA_TIMEOUT_MS);
    return Number.isFinite(val) && val > 0 ? val : 10000;
  },
  // Кулдаун повторной отправки на один номер (в секундах, по умолчанию 60с)
  get resendCooldownSec() {
    const val = Number(process.env.NIKITA_RESEND_COOLDOWN_SEC);
    return Number.isFinite(val) && val > 0 ? val : 60;
  },
  // Лимит отправок на один номер в час (по умолчанию 5)
  get hourlyLimitPhone() {
    const val = Number(process.env.NIKITA_HOURLY_LIMIT_PHONE);
    return Number.isFinite(val) && val > 0 ? val : 5;
  },
  // Суточный лимит отправок на один номер в 24 часа (по умолчанию 10)
  get dailyLimitPhone() {
    const val = Number(process.env.NIKITA_DAILY_LIMIT_PHONE);
    return Number.isFinite(val) && val > 0 ? val : 10;
  },
  // Лимит отправок с одного IP в минуту (по умолчанию 30 для защиты от флуд-скриптов)
  get minuteLimitIp() {
    const val = Number(process.env.NIKITA_MINUTE_LIMIT_IP);
    return Number.isFinite(val) && val > 0 ? val : 30;
  },
  // Лимит отправок с одного IP в час (по умолчанию 120 с учётом CGNAT мобильных операторов)
  get hourlyLimitIp() {
    const val = Number(process.env.NIKITA_HOURLY_LIMIT_IP);
    return Number.isFinite(val) && val > 0 ? val : 120;
  },
  // Общий суточный потолок SMS на весь сервис (защита от разорения баланса провайдера, по умолчанию 500)
  get dailyServiceCeiling() {
    const val = Number(process.env.NIKITA_DAILY_SERVICE_CEILING);
    return Number.isFinite(val) && val > 0 ? val : 500;
  },
  // Максимальное количество попыток ввода кода на один токен (по умолчанию 5)
  get maxVerifyAttempts() {
    const val = Number(process.env.NIKITA_MAX_VERIFY_ATTEMPTS);
    return Number.isFinite(val) && val > 0 ? val : 5;
  },
  // Время жизни сессии подтверждения на сервере (в миллисекундах, по умолчанию 10 минут)
  get tokenTtlMs() {
    const val = Number(process.env.NIKITA_TOKEN_TTL_MS);
    return Number.isFinite(val) && val > 0 ? val : 10 * 60 * 1000;
  },
};

/**
 * Проверка наличия обязательной конфигурации Nikita.
 * Падает с понятной ошибкой при отсутствии NIKITA_API_KEY.
 */
export function assertNikitaConfigured() {
  if (!process.env.NIKITA_API_KEY || !process.env.NIKITA_API_KEY.trim()) {
    throw new Error(
      "SMS-сервис Nikita не настроен: отсутствует обязательная переменная окружения NIKITA_API_KEY. " +
      "Задайте NIKITA_API_KEY в файле .env (ключ генерируется в личном кабинете https://smspro.nikita.kg, вкладка «СЕРВИС OTP»)."
    );
  }
}
