import express from "express";
import rateLimit from "express-rate-limit";
import {
  register,
  login,
  getMe,
  updateMe,
  uploadUserAvatar,
  deleteUserAvatar,
  sendOtp,
  verifyOtp,
  forgotPassword,
  verifyResetCode,
  resetPassword,
  logoutAll,
  getUserPublicProfile,
  getVerificationStatus,
  submitVerificationRequest,
  uploadVerificationDocument,
} from "../controllers/authController.js";
import { authenticateToken } from "../middleware/auth.js";
import { uploadAvatar, uploadVerificationDocument as uploadVerificationDocumentFile } from "../middleware/upload.js";

const router = express.Router();

// =======================================================
// Безопасная обработка IP и IPv6 (нормализация по подсети /56)
// =======================================================

/**
 * Нормализация IP-адресов:
 * - IPv4: возвращается как есть (или извлекается из IPv4-mapped ::ffff:x.x.x.x)
 * - IPv6: нормализуется по префиксу подсети /56 (первые 56 бит),
 *   предотвращая обход лимитеров перебором адресов внутри клиентской подсети.
 */
export function normalizeIp(ip) {
  if (!ip || typeof ip !== "string") return "127.0.0.1";
  const trimmed = ip.trim();

  // IPv4-mapped IPv6 (например, ::ffff:192.168.1.1)
  if (trimmed.startsWith("::ffff:")) {
    return trimmed.slice(7);
  }

  // Обычный IPv4
  if (!trimmed.includes(":")) {
    return trimmed;
  }

  try {
    let parts;
    if (trimmed.includes("::")) {
      const [left, right] = trimmed.split("::");
      const leftParts = left ? left.split(":") : [];
      const rightParts = right ? right.split(":") : [];
      const missingCount = 8 - (leftParts.length + rightParts.length);
      const zeros = Array(Math.max(0, missingCount)).fill("0");
      parts = [...leftParts, ...zeros, ...rightParts];
    } else {
      parts = trimmed.split(":");
    }

    const fullHex = parts.slice(0, 8).map((p) => p.padStart(4, "0"));
    const h0 = fullHex[0] || "0000";
    const h1 = fullHex[1] || "0000";
    const h2 = fullHex[2] || "0000";
    const h3Prefix = (fullHex[3] || "0000").slice(0, 2);

    return `${h0}:${h1}:${h2}:${h3Prefix}00::/56`;
  } catch (err) {
    return trimmed;
  }
}

export const ipKeyGenerator = (req) => {
  const rawIp = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || "127.0.0.1";
  return normalizeIp(rawIp);
};

// =======================================================
// Раздельные лимитеры для разных операций
// =======================================================

// 1. Лимитер проверки кодов (/verify-otp, /verify-reset-code):
// Ограничение не только по IP, но и по email (ключ req.body.email || req.ip):
// максимум 10 неудачных попыток в час на email.
export const rateLimitVerify = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 час
  max: 10,
  skipSuccessfulRequests: true, // Учитываем только неудачные попытки (статус >= 400)
  keyGenerator: (req) => {
    const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase().trim() : "";
    return email || ipKeyGenerator(req);
  },
  message: {
    success: false,
    message: "Слишком много неудачных попыток ввода кода. Попробуйте снова через час.",
  },
});

// 2. Лимитер входа (/login): 5 попыток в 15 минут
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 5,
  keyGenerator: (req) => {
    const identifier = typeof req.body?.identifier === "string" ? req.body.identifier.toLowerCase().trim() : "";
    return identifier || ipKeyGenerator(req);
  },
  message: {
    success: false,
    message: "Слишком много попыток входа. Попробуйте снова через 15 минут.",
  },
});

// 3. Лимитер отправки OTP (/send-otp, /forgot-password): 3 запроса в минуту
export const sendOtpLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 минута
  max: 3,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase().trim() : "";
    return email || ipKeyGenerator(req);
  },
  message: {
    success: false,
    message: "Слишком много запросов на отправку кода. Подождите минуту.",
  },
});

// 4. Общий лимит для остальных эндпоинтов авторизации (/register, /reset-password)
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  keyGenerator: (req) => ipKeyGenerator(req),
  message: {
    success: false,
    message: "Слишком много запросов. Попробуйте снова через 15 минут.",
  },
});

// Публичные эндпоинты
router.post("/register", authLimiter, register);
router.post("/login", loginLimiter, login);
router.post("/send-otp", sendOtpLimiter, sendOtp);
router.post("/verify-otp", rateLimitVerify, verifyOtp);
router.post("/forgot-password", sendOtpLimiter, forgotPassword);
router.post("/verify-reset-code", rateLimitVerify, verifyResetCode);
router.post("/reset-password", authLimiter, resetPassword);
router.get("/users/:id", getUserPublicProfile);

// Защищенные эндпоинты
router.get("/me", authenticateToken, getMe);
router.put("/me", authenticateToken, updateMe);
router.post("/logout-all", authenticateToken, logoutAll);

// Верификация профиля застройщика
router.get("/verification-status", authenticateToken, getVerificationStatus);
router.post("/verify-request", authenticateToken, submitVerificationRequest);
router.post(
  "/verify-documents",
  authenticateToken,
  authLimiter,
  (req, res, next) => {
    uploadVerificationDocumentFile(req, res, (err) => {
      if (err) {
        const isLimit = err.code === "LIMIT_FILE_SIZE";
        return res.status(400).json({
          success: false,
          message: isLimit
            ? "Размер файла не должен превышать 10 МБ"
            : err.message || "Ошибка загрузки файла",
        });
      }
      next();
    });
  },
  uploadVerificationDocument
);

// Аватар: multipart/form-data, поле `avatar`
router.post(
  "/avatar",
  authenticateToken,
  (req, res, next) => {
    uploadAvatar(req, res, (err) => {
      if (err) {
        const isLimit = err.code === "LIMIT_FILE_SIZE";
        return res.status(400).json({
          success: false,
          message: isLimit
            ? "Размер файла не должен превышать 5 МБ"
            : err.message || "Ошибка загрузки файла",
        });
      }
      next();
    });
  },
  uploadUserAvatar
);
router.delete("/avatar", authenticateToken, deleteUserAvatar);

export default router;
