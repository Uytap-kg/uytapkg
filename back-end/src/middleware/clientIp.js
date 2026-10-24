import net from "node:net";
import crypto from "node:crypto";
import logger from "../utils/logger.js";

export function isValidIp(val) {
  if (!val || typeof val !== "string") return false;
  const trimmed = val.trim();
  return net.isIP(trimmed) !== 0;
}

/**
 * Постоянное по времени сравнение секрета прокси (защита от timing side-channel).
 * Устойчиво к случайным пробелам/переносам строк при копировании в панель Render/Vercel.
 */
export function isValidProxySecret(incomingSecret, configuredSecret) {
  if (
    typeof configuredSecret !== "string" ||
    typeof incomingSecret !== "string"
  ) {
    return false;
  }

  const cleanConfigured = configuredSecret.trim();
  const cleanIncoming = incomingSecret.trim();

  if (cleanConfigured.length === 0 || cleanIncoming.length === 0) {
    return false;
  }

  const bufConfigured = Buffer.from(cleanConfigured, "utf8");
  const bufIncoming = Buffer.from(cleanIncoming, "utf8");

  return (
    bufConfigured.length === bufIncoming.length &&
    crypto.timingSafeEqual(bufConfigured, bufIncoming)
  );
}

/**
 * Middleware для надёжного определения IP-адреса клиента:
 * 1. Защита от подмены IP (IP Spoofing): X-Forwarded-For принимается при наличии
 *    валидного секретного заголовка X-Internal-Proxy-Secret от доверенного прокси
 *    фронтенда (Next.js на Vercel / Render / Nginx).
 * 2. На платформе Render (RENDER=true / RENDER_SERVICE_ID) для прямых запросов к бэкенду
 *    (например, встроенный healthcheck Render с 10.x.x.x или вебхуки O!Dengi)
 *    используется заголовок периметра Render/Cloudflare (true-client-ip / cf-connecting-ip /
 *    первый адрес X-Forwarded-For от балансировщика Render) без ложных предупреждений в логах.
 * 3. При прямом запросе без валидного секрета вне Render X-Forwarded-For принудительно
 *    игнорируется, а IP берётся строго из прямого сетевого сокета (remoteAddress).
 * 4. Фиксирует доверенный IP в req.ip и req.clientIp.
 */
export function resolveClientIp(req, res, next) {
  const configuredSecret =
    process.env.INTERNAL_PROXY_SECRET ||
    process.env.TRUSTED_PROXY_SECRET ||
    process.env.PROXY_SECRET;
  const incomingSecret = req.headers["x-internal-proxy-secret"];
  const rawSocketIp =
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    "127.0.0.1";

  // Нормализуем socket IP (убираем IPv4-mapped IPv6 префикс ::ffff:)
  const normalizedSocketIp = rawSocketIp.startsWith("::ffff:")
    ? rawSocketIp.slice(7)
    : rawSocketIp;

  let clientIp = normalizedSocketIp;

  const isProxyTrusted = isValidProxySecret(incomingSecret, configuredSecret);
  const isRenderRuntime = Boolean(
    process.env.RENDER === "true" || process.env.RENDER_SERVICE_ID
  );
  const isHealthCheck =
    typeof req.path === "string" && req.path.startsWith("/api/health");

  if (isProxyTrusted) {
    const rawXff = req.headers["x-vercel-forwarded-for"] || req.headers["x-forwarded-for"];
    if (typeof rawXff === "string" && rawXff.trim().length > 0) {
      const candidate = rawXff.split(",")[0].trim();
      const normCandidate = candidate.startsWith("::ffff:")
        ? candidate.slice(7)
        : candidate;
      if (isValidIp(normCandidate)) {
        clientIp = normCandidate;
      }
    }
  } else if (isRenderRuntime && !incomingSecret) {
    // На Render все входящие соединения приходят через управляемый балансировщик Render (10.x.x.x).
    // Для прямых вызовов (healthcheck Render, вебхуки O!Dengi) берём IP периметра Render/Cloudflare.
    const renderEdgeIp =
      req.headers["true-client-ip"] ||
      req.headers["cf-connecting-ip"] ||
      (typeof req.headers["x-forwarded-for"] === "string"
        ? req.headers["x-forwarded-for"].split(",")[0].trim()
        : null);
    if (typeof renderEdgeIp === "string" && isValidIp(renderEdgeIp.trim())) {
      clientIp = renderEdgeIp.trim();
    }
  } else if (!isHealthCheck) {
    const hasProxyHeaders = Boolean(
      req.headers["x-forwarded-for"] ||
      req.headers["x-real-ip"] ||
      req.headers["x-vercel-forwarded-for"] ||
      incomingSecret
    );
    if (hasProxyHeaders) {
      logger.warn(
        "Untrusted proxy headers or invalid proxy secret detected; ignoring forwarded headers and falling back to direct socket IP",
        {
          remoteSocketIp: normalizedSocketIp,
          path: req.path,
          hasForwardedFor: Boolean(req.headers["x-forwarded-for"]),
          hasVercelForwardedFor: Boolean(req.headers["x-vercel-forwarded-for"]),
          hasSecretHeader: Boolean(incomingSecret),
        }
      );
    }
  }

  // Удаляем заголовки прокси из req.headers, так как доверенный IP уже надёжно
  // зафиксирован в req.ip и req.clientIp, предотвращая конфликты с express-rate-limit
  delete req.headers["x-forwarded-for"];
  delete req.headers["x-real-ip"];
  delete req.headers["x-vercel-forwarded-for"];

  // Переопределяем req.ip, чтобы express-rate-limit и auth-лимитеры брали именно доверенный IP
  Object.defineProperty(req, "ip", {
    value: clientIp,
    configurable: true,
    writable: true,
  });
  req.clientIp = clientIp;

  next();
}

export default resolveClientIp;
