// Единая безопасная обработка X-Forwarded-For для всех Next.js-прокси к бэкенду.
//
// Бэкенд настроен на `trust proxy: 1` и берёт IP клиента из X-Forwarded-For
// для express-rate-limit.
// В продакшене перед Next.js могут стоять Cloudflare (cf-connecting-ip),
// Nginx (x-real-ip) или Vercel (x-vercel-forwarded-for). Если они присутствуют,
// мы отдаём приоритет проверенным заголовкам провайдеров. В противном случае
// берём проверенный IP из X-Forwarded-For. Все значения валидируются по формату IP.

const IPV4_REGEX = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6_REGEX = /^(?:[a-fA-F0-9]{1,4}:){1,7}[a-fA-F0-9]{1,4}$|^::1$|^::$/;

export function isValidIp(val) {
  if (!val || typeof val !== "string") return false;
  const trimmed = val.trim();
  return IPV4_REGEX.test(trimmed) || IPV6_REGEX.test(trimmed);
}

export function getTrustedClientIp(request) {
  if (!request) return null;

  // 1. Cloudflare Edge: гарантированно реальный IP посетителя ТОЛЬКО если Cloudflare явно включен в конфигурации
  const isCloudflareEnabled =
    process.env.ENABLE_CLOUDFLARE === "true" ||
    process.env.BEHIND_CLOUDFLARE === "true";

  if (isCloudflareEnabled) {
    const cfIp = request.headers?.get?.("cf-connecting-ip");
    if (cfIp && isValidIp(cfIp)) {
      return cfIp.trim();
    }
  }

  // 2. Vercel Forwarded For: первый IP в списке — это адрес клиента, подключившегося к Vercel Edge
  const vercelIp = request.headers?.get?.("x-vercel-forwarded-for");
  if (vercelIp) {
    const parts = vercelIp.split(",").map((p) => p.trim()).filter(isValidIp);
    if (parts.length > 0) return parts[0];
  }

  // 3. Next.js Request.ip (если доступен в рантайме хостинга Vercel)
  if (request.ip && isValidIp(request.ip)) {
    return request.ip.trim();
  }

  // 4. Nginx X-Real-IP (устанавливается директивой proxy_set_header X-Real-IP $remote_addr)
  const realIp = request.headers?.get?.("x-real-ip");
  if (realIp && isValidIp(realIp)) {
    return realIp.trim();
  }

  // 5. X-Forwarded-For: для локальной разработки без Vercel/Cloudflare
  const raw = request.headers?.get?.("x-forwarded-for");
  if (!raw) return null;
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return null;

  // Берём последний элемент (ближайший обратный прокси), если он валиден
  const candidate = parts[parts.length - 1];
  if (isValidIp(candidate)) {
    return candidate;
  }

  // Если последний элемент не валидный IP, ищем первый валидный с конца
  for (let i = parts.length - 1; i >= 0; i--) {
    if (isValidIp(parts[i])) {
      return parts[i];
    }
  }

  return null;
}

/**
 * Удаляет все клиентские заголовки, указывающие на IP, и выставляет
 * единственное доверенное значение (если оно известно) вместе с секретом прокси.
 */
export function applyTrustedForwardedFor(headers, request) {
  const trustedClientIp = getTrustedClientIp(request);

  headers.delete("x-forwarded-for");
  headers.delete("x-real-ip");
  headers.delete("forwarded");

  if (trustedClientIp) {
    headers.set("x-forwarded-for", trustedClientIp);
  }

  const proxySecret = process.env.INTERNAL_PROXY_SECRET;
  if (proxySecret) {
    headers.set("x-internal-proxy-secret", proxySecret);
  }

  return headers;
}

/**
 * Единый надёжный резолвер URL бэкенда для proxy routes.
 * Корректно нормализует суффикс /api для любого хоста (localhost, VPS, Docker, Kubernetes).
 */
export function getBackendApiUrl() {
  let url = (process.env.BACKEND_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api")
    .trim()
    .replace(/\/+$/, "");

  if (!url.endsWith("/api")) {
    url = `${url}/api`;
  }
  return url;
}
