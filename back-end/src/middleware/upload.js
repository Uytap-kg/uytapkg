import multer from "multer";
import path from "path";

const HEIC_MIME = new Set(["image/heic", "image/heif"]);

/** Расширение файла по extension, MIME или originalname */
export const getImageExtension = (file) => {
  if (file.extension) return file.extension;
  const fromMime = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "application/pdf": "pdf",
  };
  if (fromMime[file.mimetype]) return fromMime[file.mimetype];
  const ext = path.extname(file.originalname || "").replace(".", "").toLowerCase();
  return ext || "jpg";
};

/**
 * Валидация сигнатуры (Magic Bytes) изображения:
 * Анализирует первые байты буфера файла, разрешая только реальные форматы JPEG, PNG, WebP.
 * Не доверяет заголовкам клиента. Файлы с HTML, SVG, exe или невалидными байтами отклоняются.
 */
export const validateImageMagicBytes = (buffer, { allowGif = false } = {}) => {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 12) {
    return false;
  }

  // JPEG: FF D8 FF
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const isPng =
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;

  // WebP: RIFF (байты 0..3) + размер (байты 4..7) + WEBP (байты 8..11)
  const isRiff =
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46;
  const isWebp =
    isRiff &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50;

  // GIF: "GIF87a" / "GIF89a" (только если явно разрешено, например для аватаров)
  const isGif =
    allowGif &&
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) &&
    buffer[5] === 0x61;

  return isJpeg || isPng || isWebp || isGif;
};

const createImageFilter = (allowedMime, unsupportedMessage) => (req, file, cb) => {
  if (HEIC_MIME.has(file.mimetype)) {
    return cb(
      new Error(
        "Формат HEIC не поддерживается. Сконвертируйте фото в JPEG или PNG на устройстве."
      ),
      false
    );
  }
  if (!allowedMime.has(file.mimetype)) {
    return cb(new Error(unsupportedMessage), false);
  }
  cb(null, true);
};

const storage = multer.memoryStorage();

/** POST /api/auth/avatar — поле `avatar`, до 5 МБ, JPEG/PNG/WebP/GIF */
const AVATAR_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export const uploadAvatar = multer({
  storage,
  fileFilter: createImageFilter(
    AVATAR_MIME,
    "Допустимы только изображения: JPEG, PNG, WebP, GIF"
  ),
  limits: { fileSize: 5 * 1024 * 1024 },
}).single("avatar");

/** Лимит размера для анонимных загрузок аватаров/логотипов — 2 МБ */
export const ANONYMOUS_MAX_FILE_SIZE = 2 * 1024 * 1024;

/** POST /api/upload — анонимная загрузка аватара/логотипа, поле `file`, до 2 МБ, JPEG/PNG/WebP */
const UPLOAD_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export const uploadAnonymousFile = multer({
  storage,
  fileFilter: createImageFilter(
    UPLOAD_MIME,
    "Допустимы только изображения: JPEG, PNG, WebP"
  ),
  limits: { fileSize: ANONYMOUS_MAX_FILE_SIZE },
}).single("file");

export const uploadAnonymousImageFile = uploadAnonymousFile;

/** POST /api/upload/listing-photo, complex-photo — авторизованная загрузка, поле `file`, до 8 МБ, JPEG/PNG/WebP */
export const uploadImageFile = multer({
  storage,
  fileFilter: createImageFilter(
    UPLOAD_MIME,
    "Допустимы только изображения: JPEG, PNG, WebP"
  ),
  limits: { fileSize: 8 * 1024 * 1024 },
}).single("file");

/** POST /api/auth/verify-documents — поле `document`, до 10 МБ, PDF/JPEG/PNG/WebP */
const VERIFICATION_DOC_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export const uploadVerificationDocument = multer({
  storage,
  fileFilter: createImageFilter(
    VERIFICATION_DOC_MIME,
    "Допустимы только файлы PDF, JPEG, PNG или WebP"
  ),
  limits: { fileSize: 10 * 1024 * 1024 },
}).single("document");

/** POST /api/admin/banners/upload-image — поле `image`, до 5 МБ, JPEG/PNG/WebP */
const BANNER_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export const uploadBannerImage = multer({
  storage,
  fileFilter: createImageFilter(
    BANNER_IMAGE_MIME,
    "Допустимы только изображения: JPEG, PNG, WebP"
  ),
  limits: { fileSize: 5 * 1024 * 1024 },
}).single("image");
