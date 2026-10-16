// Единая безопасная обработка X-Forwarded-For для всех Next.js-прокси к бэкенду.
//
// Бэкенд настроен на `trust proxy: 1` и берёт IP клиента из X-Forwarded-For
// для express-rate-limit. Клиент может прислать этот заголовок сам, поэтому
// мы доверяем только ПОСЛЕДНЕМУ элементу списка — его дописал ближайший
// reverse-прокси перед нами (nginx, Vercel, Cloudflare и т.п.), и подделать
// его клиентским заголовком нельзя. Если фактическая инфраструктура не
// дописывает, а заменяет заголовок — поведение остаётся корректным.
export function getTrustedClientIp(request) {
  const raw = request.headers.get("x-forwarded-for");
  if (!raw) return null;
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

/**
 * Удаляет все клиентские заголовки, указывающие на IP, и выставляет
 * единственное доверенное значение (если оно известно).
 */
export function applyTrustedForwardedFor(headers, request) {
  const trustedClientIp = getTrustedClientIp(request);

  headers.delete("x-forwarded-for");
  headers.delete("x-real-ip");
  headers.delete("forwarded");

  if (trustedClientIp) {
    headers.set("x-forwarded-for", trustedClientIp);
  }

  return headers;
}
