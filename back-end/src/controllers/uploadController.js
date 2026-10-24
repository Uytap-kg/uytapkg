import sharp from "sharp";
import { uploadPublicImageToStorage, uploadPendingAvatarToStorage } from "../utils/storage.js";
import { applyWatermark } from "../utils/watermark.js";
import { recordUploadOwner } from "../utils/uploadOwnership.js";
import { validateImageMagicBytes } from "../middleware/upload.js";

const ALLOWED_UPLOAD_TYPES = new Set(["avatar", "logo"]);
const ALLOWED_SHARP_FORMATS = new Set(["jpeg", "png", "webp"]);

/**
 * POST /api/upload — публичная анонимная загрузка фото/логотипа для регистрации.
 * Поле формы: `file`.
 *
 * Безопасность:
 * - Не доверяет клиентскому Content-Type.
 * - Проверяет Magic Bytes буфера (строго JPEG, PNG, WebP).
 * - Анализирует метаданные через sharp.metadata(), отклоняя HTML, SVG, exe и повреждённые байты.
 * - Принудительно санитайзит и пересохраняет изображение через sharp (удаление EXIF, фиксация формата в webp/jpeg).
 * - Изолирует файл в отдельном префиксе Storage `avatars/pending/`.
 */
export const uploadImage = async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        message: "Файл не передан. Ожидается поле формы `file`.",
      });
    }

    // 1. Валидация типа загрузки (разрешены только avatar / logo)
    const rawType = req.uploadType || req.body?.type || req.query?.type;
    const uploadType = (rawType || "avatar").toString().toLowerCase().trim();
    if (!ALLOWED_UPLOAD_TYPES.has(uploadType)) {
      return res.status(400).json({
        success: false,
        message: "Недопустимый тип загрузки. Разрешены только: avatar, logo",
      });
    }

    // 2. Валидация содержимого по Magic Bytes (не доверяем Content-Type от клиента)
    if (!validateImageMagicBytes(req.file.buffer)) {
      return res.status(400).json({
        success: false,
        message: "Недопустимый формат файла. Разрешены только форматы JPEG, PNG и WebP.",
      });
    }

    // 3. Анализ структуры через sharp.metadata() (отклоняем HTML, SVG, exe и повреждённые байты)
    let metadata;
    try {
      metadata = await sharp(req.file.buffer, { limitInputPixels: 25_000_000 }).metadata();
    } catch (parseErr) {
      return res.status(400).json({
        success: false,
        message: "Недопустимый или повреждённый файл изображения. Ожидаются форматы JPEG, PNG или WebP.",
      });
    }

    if (!metadata?.format || !ALLOWED_SHARP_FORMATS.has(metadata.format)) {
      return res.status(400).json({
        success: false,
        message: "Недопустимый формат файла. Разрешены только форматы JPEG, PNG и WebP.",
      });
    }

    // 4. Санитайзинг через sharp: удаление EXIF, авто-поворот, перекодирование (фиксация в webp/jpeg)
    const targetFormat = metadata.format === "jpeg" ? "jpeg" : "webp";
    const pipeline = sharp(req.file.buffer, { limitInputPixels: 25_000_000 }).rotate();

    let sanitizedBuffer;
    let finalMime;
    let finalExt;

    if (targetFormat === "jpeg") {
      sanitizedBuffer = await pipeline.jpeg({ quality: 85 }).toBuffer();
      finalMime = "image/jpeg";
      finalExt = "jpg";
    } else {
      sanitizedBuffer = await pipeline.webp({ quality: 85 }).toBuffer();
      finalMime = "image/webp";
      finalExt = "webp";
    }

    // 5. Изоляция: сохраняем анонимный файл в отдельный префикс avatars/pending/
    const sanitizedFile = {
      buffer: sanitizedBuffer,
      mimetype: finalMime,
      extension: finalExt,
      originalname: `${uploadType}.${finalExt}`,
    };

    const { publicUrl } = await uploadPendingAvatarToStorage(sanitizedFile);

    return res.json({
      success: true,
      url: publicUrl,
    });
  } catch (error) {
    console.error("Upload Image Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при загрузке файла",
      requestId: req?.id,
    });
  }
};

/**
 * POST /api/upload/listing-photo — загрузка фото объявления.
 * Поле формы: `file`. Перед сохранением всегда накладывает водяной знак
 * (лого UyTap) — это отдельный от uploadImage эндпоинт специально для
 * того, чтобы наложение нельзя было обойти клиентским флагом: тип
 * загрузки определяется тем, какой URL вызван, а не телом запроса.
 */
export const uploadListingPhoto = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Файл не передан. Ожидается поле формы `file`.",
      });
    }

    if (!validateImageMagicBytes(req.file.buffer)) {
      return res.status(400).json({
        success: false,
        message: "Недопустимый формат файла. Разрешены только форматы JPEG, PNG и WebP.",
      });
    }

    let watermarkedBuffer;
    try {
      watermarkedBuffer = await applyWatermark(req.file.buffer, req.file.mimetype);
    } catch (watermarkError) {
      console.error("Apply Watermark Error:", watermarkError);
      return res.status(400).json({
        success: false,
        message: "Не удалось обработать изображение. Файл повреждён или имеет неподдерживаемый формат.",
      });
    }

    const { publicUrl, objectPath } = await uploadPublicImageToStorage({
      ...req.file,
      buffer: watermarkedBuffer,
    });

    await recordUploadOwner(objectPath, req.user.id);

    return res.json({
      success: true,
      url: publicUrl,
    });
  } catch (error) {
    console.error("Upload Listing Photo Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при загрузке файла",
      requestId: req?.id,
    });
  }
};

/**
 * POST /api/upload/complex-photo — загрузка фото жилого комплекса (галерея
 * / обложка ЖК). Поле формы: `file`. Тот же водяной знак, что и у фото
 * объявлений, и по той же причине — отдельный эндпоинт от uploadImage,
 * чтобы наложение нельзя было обойти со стороны клиента.
 */
export const uploadComplexPhoto = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Файл не передан. Ожидается поле формы `file`.",
      });
    }

    if (!validateImageMagicBytes(req.file.buffer)) {
      return res.status(400).json({
        success: false,
        message: "Недопустимый формат файла. Разрешены только форматы JPEG, PNG и WebP.",
      });
    }

    let watermarkedBuffer;
    try {
      watermarkedBuffer = await applyWatermark(req.file.buffer, req.file.mimetype);
    } catch (watermarkError) {
      console.error("Apply Watermark Error:", watermarkError);
      return res.status(400).json({
        success: false,
        message: "Не удалось обработать изображение. Файл повреждён или имеет неподдерживаемый формат.",
      });
    }

    const { publicUrl, objectPath } = await uploadPublicImageToStorage({
      ...req.file,
      buffer: watermarkedBuffer,
    });

    await recordUploadOwner(objectPath, req.user.id);

    return res.json({
      success: true,
      url: publicUrl,
    });
  } catch (error) {
    console.error("Upload Complex Photo Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при загрузке файла",
      requestId: req?.id,
    });
  }
};
