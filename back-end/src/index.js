import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import authRoutes from "./routes/authRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import listingsRoutes from "./routes/listingsRoutes.js";
import complexesRoutes from "./routes/complexesRoutes.js";
import aiRoutes from "./routes/aiRoutes.js";
import constantsRoutes from "./routes/constantsRoutes.js";
import favoritesRoutes from "./routes/favoritesRoutes.js";
import developersRoutes from "./routes/developersRoutes.js";
import paymentsRoutes from "./routes/paymentsRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import lawyersRoutes from "./routes/lawyersRoutes.js";
import settingsRoutes from "./routes/settingsRoutes.js";
import bannersRoutes from "./routes/bannersRoutes.js";
import subscriptionsRoutes from "./routes/subscriptionsRoutes.js";
import { startCronService, stopCronService } from "./services/cronService.js";
import { supabase, dbPool } from "./config/db.js";
import logger from "./utils/logger.js";
import requestContext from "./middleware/requestContext.js";
import resolveClientIp from "./middleware/clientIp.js";
import { enforceProductionSecrets } from "./config/runtimeCheck.js";
import { BoundedSharedRateLimitStore } from "./utils/sharedState.js";
import { flushAllCounters, stopCounterBatcher } from "./utils/counterBatcher.js";
import { ipKeyGenerator } from "./routes/authRoutes.js";

dotenv.config();

enforceProductionSecrets(process.env);

const app = express();
// Отключаем слепое доверие к заголовкам X-Forwarded-* со стороны Express.
// Определение IP клиента выполняет resolveClientIp, доверяя X-Forwarded-For
// только при наличии корректного X-Internal-Proxy-Secret.
app.set("trust proxy", false);
app.use(resolveClientIp);
app.use(requestContext);
const PORT = process.env.PORT || 5000;

// Базовые защитные HTTP-заголовки (X-Content-Type-Options, отключение
// устаревшего X-Powered-By и т.п.). CSP отключаем — этот сервер отдаёт
// только JSON API, а не HTML-страницы, так что CSP тут не применим и
// только мешал бы (например, ответам Swagger/дебаг-страниц при их наличии).
app.use(helmet({ contentSecurityPolicy: false }));

// Разрешенные CORS источники. ВАЖНО: при деплое на реальный домен
// добавьте сюда его адрес (https://uytap.kg и т.п.) — иначе фронтенд в
// проде не сможет достучаться до API из браузера.
const isProduction = process.env.NODE_ENV === "production";
const devOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "https://uytapkgdep.vercel.app",
  "https://uytap.kg",
  "https://www.uytap.kg",
];
const defaultOrigins = [
  "https://uytapkgdep.vercel.app",
  "https://www.uytap.kg",
  "https://uytapkg.vercel.app",
];
// ALLOWED_ORIGINS="https://a.kg,https://b.kg" полностью заменяет список по умолчанию.
const envOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
const allowedOrigins =
  envOrigins.length > 0
    ? envOrigins
    : isProduction
      ? defaultOrigins
      : [...devOrigins, ...defaultOrigins];

app.use(
  cors({
    origin: (origin, callback) => {
      // origin отсутствует у server-to-server запросов и большинства
      // прямых curl/Postman-обращений — не блокируем их, т.к. они и так
      // не подвержены браузерной CORS-модели (credential-хищение через
      // CORS работает только из чужой вкладки браузера).
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Origin not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "1mb" }));

// Health Check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "UyTap Backend API",
    time: new Date().toISOString(),
  });
});

// Readiness: проверяет доступность БД (для мониторинга/балансировщика)
app.get("/api/health/ready", async (req, res) => {
  try {
    const { error } = await supabase.from("users").select("id").limit(1);
    if (error) throw error;
    res.json({ status: "ready", time: new Date().toISOString() });
  } catch (err) {
    logger.warn("Readiness check failed", { error: err?.message || err });
    res.status(503).json({ status: "unavailable" });
  }
});

// Глобальный базовый лимит на весь API (300 запросов/мин с IP). Более строгие
// лимитеры на чувствительных маршрутах (auth, payments, upload, ai) — в routes/.
// Хранилище ограничено в памяти (BoundedSharedRateLimitStore) для защиты от утечек при атаках с ротацией IP.
app.use(
  "/api",
  rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    keyGenerator: (req) => ipKeyGenerator(req),
    validate: { xForwardedForHeader: false },
    store: new BoundedSharedRateLimitStore({
      prefix: "rl:global_api:",
      windowMs: 60 * 1000,
      maxEntries: 20000,
    }),
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path.startsWith("/health"),
    message: { success: false, message: "Слишком много запросов. Попробуйте позже." },
  })
);

// Регистрация всех роутов API UyTap
app.use("/api/auth", authRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/listings", listingsRoutes);
app.use("/api/complexes", complexesRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/constants", constantsRoutes);
app.use("/api/favorites", favoritesRoutes);
app.use("/api/developers", developersRoutes);
app.use("/api/payments", paymentsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/lawyers", lawyersRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/banners", bannersRoutes);
app.use("/api/subscriptions", subscriptionsRoutes);

// Глобальный обработчик ошибок (включая Multer)
app.use((err, req, res, next) => {
  logger.error("Unhandled Server Error", {
    requestId: req?.id,
    error: err?.message,
    stack: err?.stack,
  });

  if (err.message === "Origin not allowed by CORS") {
    return res.status(403).json({
      success: false,
      message: "Запросы с этого источника запрещены",
    });
  }

  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({
      success: false,
      message: "Превышен допустимый размер файла",
    });
  }

  if (err instanceof Error && err.message?.includes("HEIC")) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }

  if (err instanceof Error && err.message?.includes("Допустимы только изображения")) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }

  res.status(500).json({
    success: false,
    message: "Внутренняя ошибка сервера",
    requestId: req?.id,
  });
});

const server = app.listen(PORT, "0.0.0.0", () => {
  logger.info(`UyTap Backend API запущен на порту ${PORT}: http://0.0.0.0:${PORT}`);
  logger.info("Готов к приему запросов от Frontend");
  startCronService();
});

// Таймауты HTTP-сервера для защиты от медленных клиентов (Slowloris) и гонок Keep-Alive с Nginx
server.requestTimeout = 30000;
server.headersTimeout = 35000;
server.keepAliveTimeout = 65000;

// Graceful shutdown (P2-09): при деплое (PM2/Docker/systemd шлют SIGTERM)
// 1) перестаём принимать новые соединения,
// 2) останавливаем cron и таймер батчера счётчиков,
// 3) дожидаемся активных HTTP-запросов,
// 4) сбрасываем буфер просмотров/кликов в БД и закрываем пул PostgreSQL (dbPool.end()).
let shuttingDown = false;
export async function gracefulShutdown(signal, exitProcess = true) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} получен, останавливаем сервер...`);

  // Принудительное завершение, если запросы или пул не закрылись за 25 секунд
  const forceExitTimer = setTimeout(() => {
    logger.error("Превышен таймаут gracefulShutdown (25s), принудительный выход");
    if (exitProcess) process.exit(1);
  }, 25000);
  forceExitTimer.unref();

  stopCronService();
  stopCounterBatcher();

  await new Promise((resolve) => {
    server.close(() => {
      logger.info("HTTP-сервер перестал принимать новые соединения и завершил активные запросы");
      resolve();
    });
  });

  try {
    await flushAllCounters();
  } catch (flushErr) {
    logger.warn("Ошибка сброса буфера счётчиков при остановке", {
      error: flushErr?.message || flushErr,
    });
  }

  if (dbPool && typeof dbPool.end === "function") {
    try {
      await dbPool.end();
      logger.info("Пул соединений PostgreSQL (dbPool) корректно закрыт");
    } catch (poolErr) {
      logger.warn("Ошибка при закрытии dbPool", { error: poolErr?.message || poolErr });
    }
  }

  clearTimeout(forceExitTimer);
  logger.info("Сервер корректно остановлен");
  if (exitProcess) {
    process.exit(0);
  }
}

const shutdown = gracefulShutdown;
export { app, server };

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled Promise Rejection", {
    reason: reason instanceof Error ? reason.message : reason,
    stack: reason?.stack,
  });
});
process.on("uncaughtException", (err) => {
  logger.error("Uncaught Exception", {
    error: err?.message,
    stack: err?.stack,
  });
  shutdown("uncaughtException");
});
