import express from "express";
import rateLimit from "express-rate-limit";
import { uploadImage, uploadListingPhoto, uploadComplexPhoto } from "../controllers/uploadController.js";
import { uploadAnonymousFile, uploadImageFile } from "../middleware/upload.js";
import { authenticateToken } from "../middleware/auth.js";
import { ipKeyGenerator } from "./authRoutes.js";

const router = express.Router();

/** Строгий лимит для анонимных загрузок: максимум 5 файлов в час на 1 IP */
export const anonymousUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 час
  max: 5,
  keyGenerator: (req) => ipKeyGenerator(req),
  message: {
    success: false,
    message: "Слишком много загрузок с этого IP-адреса. Разрешено не более 5 файлов в час.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/** Лимитер для авторизованных загрузок фото объявлений и ЖК */
export const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: {
    success: false,
    message: "Слишком много загрузок. Попробуйте снова через 15 минут.",
  },
});

/** Обработчик анонимной загрузки с лимитом размера 2 МБ */
export const handleAnonymousFileUpload = (req, res, next) => {
  uploadAnonymousFile(req, res, (err) => {
    if (err) {
      const isLimit = err.code === "LIMIT_FILE_SIZE";
      return res.status(400).json({
        success: false,
        message: isLimit
          ? "Размер файла не должен превышать 2 МБ"
          : err.message || "Ошибка загрузки файла",
      });
    }
    next();
  });
};

/** Разрешённые типы для анонимной загрузки: только avatar и logo */
export const ALLOWED_ANONYMOUS_TYPES = new Set(["avatar", "logo"]);

export const validateAnonymousUploadType = (req, res, next) => {
  const rawType = req.body?.type ?? req.query?.type;
  const type = (rawType || "avatar").toString().toLowerCase().trim();
  if (!ALLOWED_ANONYMOUS_TYPES.has(type)) {
    return res.status(400).json({
      success: false,
      message: "Недопустимый тип загрузки. Разрешены только: avatar, logo",
    });
  }
  req.uploadType = type;
  next();
};

const handleImageFileUpload = (req, res, next) => {
  uploadImageFile(req, res, (err) => {
    if (err) {
      const isLimit = err.code === "LIMIT_FILE_SIZE";
      return res.status(400).json({
        success: false,
        message: isLimit
          ? "Размер файла не должен превышать 8 МБ"
          : err.message || "Ошибка загрузки файла",
      });
    }
    next();
  });
};

// Публичный эндпоинт для регистрации: лимит 5/час/IP, max 2 МБ, только avatar / logo
router.post(
  "/",
  anonymousUploadLimiter,
  handleAnonymousFileUpload,
  validateAnonymousUploadType,
  uploadImage
);

// Фото объявлений — всегда с водяным знаком (лого UyTap), см.
// uploadController.js. Отдельный маршрут от "/", чтобы наложение
// водяного знака нельзя было обойти со стороны клиента. Требует
// авторизации (форма добавления объявления и так доступна только
// вошедшим пользователям) — дополнительно ограничивает анонимный доступ
// к CPU-затратной обработке изображений.
router.post(
  "/listing-photo",
  authenticateToken,
  uploadLimiter,
  handleImageFileUpload,
  uploadListingPhoto
);

// Фото ЖК — по той же причине, что и фото объявлений, всегда с водяным
// знаком; требует авторизации (форма создания ЖК доступна только
// вошедшим застройщикам).
router.post(
  "/complex-photo",
  authenticateToken,
  uploadLimiter,
  handleImageFileUpload,
  uploadComplexPhoto
);

export default router;
