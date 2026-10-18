// back-end/src/middleware/requestContext.js
// Middleware для сквозной трассировки запросов:
// 1. Извлекает входящий X-Request-Id или генерирует уникальный UUID.
// 2. Добавляет ID в req.id и заголовок ответа X-Request-Id.
// 3. Логирует завершение каждого HTTP-запроса с метриками (метод, путь, статус, длительность).
// ВАЖНО: Тело запроса (req.body), заголовок Authorization, пароли и OTP-коды НЕ логируются.

import crypto from "crypto";
import logger from "../utils/logger.js";

export function requestContext(req, res, next) {
  const incomingId = req.headers["x-request-id"];
  const requestId = typeof incomingId === "string" && incomingId.trim().length > 0
    ? incomingId.trim()
    : crypto.randomUUID();

  req.id = requestId;
  res.setHeader("X-Request-Id", requestId);

  const startTime = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - startTime;
    const clientIp = req.ip || req.clientIp || req.socket?.remoteAddress || "127.0.0.1";

    logger.info("HTTP request completed", {
      requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      status: res.statusCode,
      durationMs,
      ip: clientIp,
    });
  });

  next();
}

export default requestContext;
