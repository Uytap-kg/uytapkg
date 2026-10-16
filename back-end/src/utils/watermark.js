import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, "..", "assets", "watermark-logo.png");

let logoBuffer = null;
try {
  logoBuffer = readFileSync(LOGO_PATH);
} catch (err) {
  console.warn("Watermark logo not found or unreadable, watermarking disabled:", err.message);
}

// Почти прозрачный, но всё ещё различимый — не должен мешать смотреть фото.
const WATERMARK_OPACITY = 0.16;
// Непрозрачность тёмной "тени" под белым знаком — без неё белый водяной
// знак на светлом/белом фоне (частый случай — светлые стены в квартире)
// становится полностью невидимым.
const SHADOW_OPACITY = 0.14;
const SHADOW_BLUR_RATIO = 0.015;
// Ширина одного отпечатка водяного знака — доля от ширины фотографии.
const WATERMARK_WIDTH_RATIO = 0.22;
const WATERMARK_MIN_WIDTH = 60;
const WATERMARK_MAX_WIDTH = 420;
// Отступ от края — доля от ширины фотографии.
const MARGIN_RATIO = 0.03;

// Пять копий знака (по углам и в центре) нужны, чтобы усложнить обрезку
// водяного знака при краже фото — но чтобы не превратить маленькие/квадратные
// фото в мешанину из перекрывающихся отпечатков, требуем минимальный размер.
const MULTI_WATERMARK_MIN_SIZE = 500;

let cachedLogoWidth = null;
// Кэш готового полупрозрачного PNG водяного знака по ширине в пикселях —
// на одно объявление обычно загружают несколько фото одинакового размера
// (или близкого), это экономит повторный ресайз/пересчёт альфы.
const resizedLogoCache = new Map();

async function getResizedLogo(targetWidth) {
  if (!logoBuffer) return null;
  if (resizedLogoCache.has(targetWidth)) {
    return resizedLogoCache.get(targetWidth);
  }

  const { data, info } = await sharp(logoBuffer)
    .resize({ width: targetWidth })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Перекрашиваем логотип: исходный — фирменный синий, что на фото выглядит
  // слишком заметно и не всегда уместно поверх ярких/синих деталей
  // интерьера. Форму знака задаёт alpha-канал оригинала (он же несёт
  // сглаживание по краям) — его и оставляем, просто линейно уменьшая, а RGB
  // заменяем: белый слой + под ним размытая тёмная "тень" той же формы —
  // так знак остаётся виден и на светлом, и на тёмном фоне (чисто белый
  // знак на белом фоне, например на фото со светлыми стенами, был бы
  // попросту не виден без тени).
  const whiteData = Buffer.from(data);
  const shadowData = Buffer.from(data);

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];

    whiteData[i] = 255;
    whiteData[i + 1] = 255;
    whiteData[i + 2] = 255;
    whiteData[i + 3] = Math.round(alpha * WATERMARK_OPACITY);

    shadowData[i] = 0;
    shadowData[i + 1] = 0;
    shadowData[i + 2] = 0;
    shadowData[i + 3] = Math.round(alpha * SHADOW_OPACITY);
  }

  const whitePng = await sharp(whiteData, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();

  const shadowPng = await sharp(shadowData, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .blur(Math.max(1, targetWidth * SHADOW_BLUR_RATIO))
    .png()
    .toBuffer();

  const result = { whitePng, shadowPng, width: info.width, height: info.height };

  // Кэш маленький и ограниченный (ширины водяного знака укладываются в
  // WATERMARK_MIN_WIDTH..WATERMARK_MAX_WIDTH), но на всякий случай не даём
  // ему расти бесконечно при очень разных размерах фото.
  if (resizedLogoCache.size > 50) resizedLogoCache.clear();
  resizedLogoCache.set(targetWidth, result);

  return result;
}

/**
 * Накладывает почти прозрачный водяной знак (лого UyTap, перекрашенное в
 * белый) в 4 угла и в центр изображения — на достаточно крупных фото. На
 * маленьких фото, где 5 отпечатков накладывались бы друг на друга,
 * ограничиваемся одним в правом нижнем углу. Возвращает новый буфер —
 * исходный не изменяется.
 *
 * mimetype используется, чтобы сохранить исходный формат на выходе
 * (jpeg/png/webp); всё остальное трактуем как jpeg.
 */
export async function applyWatermark(buffer, mimetype) {
  if (!logoBuffer) {
    return buffer;
  }

  try {
    // limitInputPixels — защита от decompression-bomb (маленький файл,
    // распаковывающийся в гигантское изображение и съедающий память/CPU).
    // .rotate() без аргументов — авто-поворот по EXIF-тегу ориентации
    // (важно для фото с телефона: иначе водяной знак окажется не в том
    // углу после того, как браузер/клиент повернёт изображение).
    const image = sharp(buffer, { limitInputPixels: 50_000_000 }).rotate();
    const metadata = await image.metadata();

    const width = metadata.width || 0;
    const height = metadata.height || 0;

    // Слишком маленькое изображение — пропускаем водяной знак, чтобы не
    // получить нечитаемое пятно поверх миниатюры.
    if (width < 200 || height < 200) {
      return buffer;
    }

    const targetWidth = Math.round(
      Math.min(
        WATERMARK_MAX_WIDTH,
        Math.max(WATERMARK_MIN_WIDTH, width * WATERMARK_WIDTH_RATIO)
      )
    );

    const logo = await getResizedLogo(targetWidth);
    if (!logo) return buffer;
    const margin = Math.round(width * MARGIN_RATIO);

    const leftEdge = Math.max(0, margin);
    const rightEdge = Math.max(0, width - logo.width - margin);
    const topEdge = Math.max(0, margin);
    const bottomEdge = Math.max(0, height - logo.height - margin);
    const centerLeft = Math.max(0, Math.round((width - logo.width) / 2));
    const centerTop = Math.max(0, Math.round((height - logo.height) / 2));

    const useMultiplePositions =
      width >= MULTI_WATERMARK_MIN_SIZE && height >= MULTI_WATERMARK_MIN_SIZE;

    const positions = useMultiplePositions
      ? [
          { left: leftEdge, top: topEdge },
          { left: rightEdge, top: topEdge },
          { left: centerLeft, top: centerTop },
          { left: leftEdge, top: bottomEdge },
          { left: rightEdge, top: bottomEdge },
        ]
      : [{ left: rightEdge, top: bottomEdge }];

    // Для каждой позиции сначала кладём тень, а поверх — белый знак: так
    // порядок наложения в итоговом изображении соблюдается корректно.
    const compositeOps = positions.flatMap(({ left, top }) => [
      { input: logo.shadowPng, left, top },
      { input: logo.whitePng, left, top },
    ]);

    let pipeline = image.composite(compositeOps);

    if (mimetype === "image/png") {
      pipeline = pipeline.png();
    } else if (mimetype === "image/webp") {
      pipeline = pipeline.webp({ quality: 90 });
    } else {
      pipeline = pipeline.jpeg({ quality: 90 });
    }

    return pipeline.toBuffer();
  } catch (err) {
    console.warn("Watermark processing failed:", err);
    throw err;
  }
}

// Проверка ширины лого на всякий случай (не блокирует запуск, только для
// отладки — если ассет вдруг заменят на битый файл).
export async function warmUpWatermark() {
  if (!logoBuffer) return null;
  if (cachedLogoWidth !== null) return cachedLogoWidth;
  const meta = await sharp(logoBuffer).metadata();
  cachedLogoWidth = meta.width;
  return cachedLogoWidth;
}
