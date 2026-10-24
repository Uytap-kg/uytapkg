import {
  listAllBanners,
  listActiveBanners,
  getBannerById,
  createBanner as createBannerRecord,
  updateBanner as updateBannerRecord,
  deleteBanner as deleteBannerRecord,
  incrementBannerViews,
  incrementBannerClicks,
} from "../utils/bannersStore.js";
import {
  uploadBannerImageToStorage,
  removeBannerImageFromStorage,
} from "../utils/storage.js";
import { bannerSchema, updateBannerSchema } from "../utils/validation.js";
import { validateImageMagicBytes } from "../middleware/upload.js";
import { getClientIp } from "./listingsController.js";
import { evictExpiredAndCapMap } from "../utils/boundedMap.js";

// P3-04: Защита от накрутки просмотров и кликов баннеров по (IP, bannerId) с TTL и ограничением памяти
export const BANNER_VIEW_THROTTLE_MS = 10 * 60 * 1000; // 10 минут
export const BANNER_CLICK_THROTTLE_MS = 5 * 60 * 1000; // 5 минут
export const BANNER_THROTTLE_MAX_SIZE = 10000;
export const bannerViewsThrottleMap = new Map();
export const bannerClicksThrottleMap = new Map();

export function clearBannerThrottleMaps() {
  bannerViewsThrottleMap.clear();
  bannerClicksThrottleMap.clear();
}

export function shouldRecordBannerEvent(map, ip, bannerId, ttlMs) {
  if (!ip || !bannerId) return true;
  const key = `${ip}:${bannerId}`;
  const now = Date.now();
  const lastTime = map.get(key);
  if (lastTime && now - lastTime < ttlMs) {
    return false;
  }
  if (map.has(key)) {
    map.delete(key);
  }
  map.set(key, now);

  if (map.size > BANNER_THROTTLE_MAX_SIZE) {
    evictExpiredAndCapMap(map, BANNER_THROTTLE_MAX_SIZE, (ts) => now - ts >= ttlMs);
  }
  return true;
}

function toPublicBanner(banner) {
  return {
    id: banner.id,
    title: banner.title,
    imageUrl: banner.imageUrl,
    imagePositionX: banner.imagePositionX,
    imagePositionY: banner.imagePositionY,
    link: banner.link,
  };
}

// =======================================================
// Публичный список активных баннеров (GET /api/banners)
//
// Без авторизации — отдаёт только баннеры с active=true, дата которых
// уже наступила и ещё не истекла. Внутренние поля (даты, active,
// createdAt/updatedAt) наружу не отдаются.
// =======================================================
export const getPublicBanners = async (req, res) => {
  try {
    const banners = await listActiveBanners();
    return res.json({ success: true, data: banners.map(toPublicBanner) });
  } catch (error) {
    console.error("Get Public Banners Error:", error);
    return res.status(500).json({
      success: false,
      message: "Не удалось получить баннеры",
    });
  }
};

// =======================================================
// Список всех баннеров для админки (GET /api/admin/banners)
// =======================================================
export const getAdminBanners = async (req, res) => {
  try {
    const banners = await listAllBanners();
    return res.json({ success: true, data: banners });
  } catch (error) {
    console.error("Get Admin Banners Error:", error);
    return res.status(500).json({
      success: false,
      message: "Не удалось получить список баннеров",
    });
  }
};

// =======================================================
// Загрузка изображения баннера (POST /api/admin/banners/upload-image)
//
// Возвращает публичный URL — его дальше передают в createBanner/updateBanner.
// Файл проверяется multer'ом (тип/размер) до того, как попасть сюда.
// =======================================================
export const uploadBannerImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Файл изображения не найден в запросе",
      });
    }

    if (!validateImageMagicBytes(req.file.buffer)) {
      return res.status(400).json({
        success: false,
        message: "Недопустимый формат файла. Разрешены только JPEG, PNG и WebP.",
      });
    }

    const { publicUrl } = await uploadBannerImageToStorage(req.file);

    return res.json({ success: true, url: publicUrl });
  } catch (error) {
    console.error("Upload Banner Image Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Не удалось загрузить изображение",
    });
  }
};

// =======================================================
// Создание баннера (POST /api/admin/banners)
// =======================================================
export const createBanner = async (req, res) => {
  try {
    const result = bannerSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error.issues[0]?.message || "Некорректные данные баннера",
      });
    }

    const banner = await createBannerRecord(result.data);

    return res.status(201).json({ success: true, data: banner });
  } catch (error) {
    console.error("Create Banner Error:", error);
    return res.status(500).json({
      success: false,
      message: "Не удалось создать баннер",
    });
  }
};

// =======================================================
// Обновление баннера (PUT /api/admin/banners/:id)
// =======================================================
export const updateBanner = async (req, res) => {
  try {
    const { id } = req.params;
    const result = updateBannerSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error.issues[0]?.message || "Некорректные данные баннера",
      });
    }

    const outcome = await updateBannerRecord(id, result.data);

    if (!outcome) {
      return res.status(404).json({ success: false, message: "Баннер не найден" });
    }

    const { previous, updated } = outcome;

    // Если изображение заменили — подчищаем старый файл из Storage,
    // чтобы не копить мусор (ошибка удаления не критична, не блокирует ответ).
    if (
      result.data.imageUrl &&
      previous.imageUrl &&
      previous.imageUrl !== updated.imageUrl
    ) {
      removeBannerImageFromStorage(previous.imageUrl).catch(() => {});
    }

    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error("Update Banner Error:", error);
    return res.status(500).json({
      success: false,
      message: "Не удалось обновить баннер",
    });
  }
};

// =======================================================
// Включение/выключение баннера (PATCH /api/admin/banners/:id/toggle)
// =======================================================
export const toggleBanner = async (req, res) => {
  try {
    const { id } = req.params;
    const banner = await getBannerById(id);

    if (!banner) {
      return res.status(404).json({ success: false, message: "Баннер не найден" });
    }

    const outcome = await updateBannerRecord(id, { active: !banner.active });

    return res.json({ success: true, data: outcome.updated });
  } catch (error) {
    console.error("Toggle Banner Error:", error);
    return res.status(500).json({
      success: false,
      message: "Не удалось изменить статус баннера",
    });
  }
};

// =======================================================
// Удаление баннера (DELETE /api/admin/banners/:id)
// =======================================================
export const deleteBanner = async (req, res) => {
  try {
    const { id } = req.params;
    const banner = await deleteBannerRecord(id);

    if (!banner) {
      return res.status(404).json({ success: false, message: "Баннер не найден" });
    }

    if (banner.imageUrl) {
      removeBannerImageFromStorage(banner.imageUrl).catch(() => {});
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("Delete Banner Error:", error);
    return res.status(500).json({
      success: false,
      message: "Не удалось удалить баннер",
    });
  }
};

// =======================================================
// Увеличение счётчика просмотров (POST /api/banners/:id/view)
// =======================================================
export const trackBannerView = async (req, res) => {
  try {
    const { id } = req.params;
    const clientIp = getClientIp(req);
    if (!shouldRecordBannerEvent(bannerViewsThrottleMap, clientIp, id, BANNER_VIEW_THROTTLE_MS)) {
      return res.json({ success: true, deduplicated: true });
    }
    await incrementBannerViews(id);
    return res.json({ success: true });
  } catch (error) {
    console.error("Track Banner View Error:", error);
    return res.status(500).json({
      success: false,
      message: "Не удалось зафиксировать просмотр баннера",
    });
  }
};

// =======================================================
// Увеличение счётчика кликов (POST /api/banners/:id/click)
// =======================================================
export const trackBannerClick = async (req, res) => {
  try {
    const { id } = req.params;
    const clientIp = getClientIp(req);
    if (!shouldRecordBannerEvent(bannerClicksThrottleMap, clientIp, id, BANNER_CLICK_THROTTLE_MS)) {
      return res.json({ success: true, deduplicated: true });
    }
    await incrementBannerClicks(id);
    return res.json({ success: true });
  } catch (error) {
    console.error("Track Banner Click Error:", error);
    return res.status(500).json({
      success: false,
      message: "Не удалось зафиксировать клик по баннеру",
    });
  }
};

