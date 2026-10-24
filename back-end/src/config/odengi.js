import dotenv from "dotenv";

dotenv.config();

// =======================================================
// Конфигурация мерчанта O!Деньги (O!Dengi QR Pay API).
//
// Все секреты (SID, пароль API) приходят ТОЛЬКО из переменных
// окружения и никогда не должны попадать в git/frontend.
// =======================================================

const REQUIRED_IN_PRODUCTION = ["ODENGI_SID", "ODENGI_PASSWORD"];

export const odengiConfig = {
  apiUrl: process.env.ODENGI_API_URL || "https://mw-api-test.dengi.kg/api/json/json.php",
  sid: process.env.ODENGI_SID || "",
  password: process.env.ODENGI_PASSWORD || "",
  version: Number(process.env.ODENGI_VERSION || 1005),
  // 1 = тестовый платёж (sandbox), 0 = боевой
  test: process.env.ODENGI_TEST === "0" ? 0 : 1,
  lang: process.env.ODENGI_LANG || "ru",
  // Публичный URL бэкенда, на который O!Dengi шлёт callback об изменении статуса счёта (/api/payments/webhook)
  resultUrl: process.env.ODENGI_RESULT_URL || "",
  // Таймаут сетевого запроса к O!Dengi API (по умолчанию 15 секунд)
  timeoutMs: Number(process.env.ODENGI_TIMEOUT_MS || 15000),
};

export function assertOdengiConfigured() {
  const missing = REQUIRED_IN_PRODUCTION.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `O!Dengi не настроен: отсутствуют переменные окружения ${missing.join(", ")}. ` +
        "Укажите ODENGI_SID и ODENGI_PASSWORD в .env (данные из личного кабинета mwallet: Торговые точки -> Все торговые точки)."
    );
  }
}
