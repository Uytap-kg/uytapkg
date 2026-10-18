import net from "node:net";

export function isValidIp(val) {
  if (!val || typeof val !== "string") return false;
  const trimmed = val.trim();
  return net.isIP(trimmed) !== 0;
}

/**
 * Middleware для надёжного определения IP-адреса клиента:
 * 1. Защита от подмены IP (IP Spoofing): X-Forwarded-For принимается ТОЛЬКО
 *    при наличии валидного секретного заголовка X-Internal-Proxy-Secret от
 *    доверенного прокси фронтенда (Next.js/Vercel).
 * 2. При прямом запросе (без валидного секрета) X-Forwarded-For принудительно
 *    удаляется, а IP берётся строго из прямого сетевого сокета (remoteAddress).
 * 3. Фиксирует доверенный IP в req.ip и req.clientIp.
 */
export function resolveClientIp(req, res, next) {
  const configuredSecret = process.env.INTERNAL_PROXY_SECRET;
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

  const isProxyTrusted = Boolean(
    configuredSecret &&
    typeof incomingSecret === "string" &&
    incomingSecret.length > 0 &&
    incomingSecret === configuredSecret
  );

  if (isProxyTrusted) {
    const rawXff = req.headers["x-forwarded-for"];
    if (typeof rawXff === "string" && rawXff.trim().length > 0) {
      const candidate = rawXff.split(",")[0].trim();
      const normCandidate = candidate.startsWith("::ffff:")
        ? candidate.slice(7)
        : candidate;
      if (isValidIp(normCandidate)) {
        clientIp = normCandidate;
      }
    }
  } else {
    // Прямой запрос или неверный секрет — удаляем потенциально поддельный заголовок
    delete req.headers["x-forwarded-for"];
    delete req.headers["x-real-ip"];
  }

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
