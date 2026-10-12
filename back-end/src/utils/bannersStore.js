import { supabase } from "../config/db.js";

// Регулярное выражение для валидации UUID v4
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuid(id) {
  return typeof id === "string" && UUID_REGEX.test(id);
}

/**
 * Преобразует строку из таблицы public.banners (snake_case)
 * в формат DTO для фронтенда (camelCase).
 *
 * Если в записи отсутствуют значения полей (например, при чтении
 * старых строк или неполных данных), подставляются значения по умолчанию
 * в строгом соответствии с миграцией 20261012120000_banners_extend.sql.
 */
export function mapRowToBanner(row) {
  if (!row) return null;

  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();

  const createdAt = row.created_at
    ? typeof row.created_at === "string"
      ? row.created_at
      : new Date(row.created_at).toISOString()
    : now;

  const updatedAt = row.updated_at
    ? typeof row.updated_at === "string"
      ? row.updated_at
      : new Date(row.updated_at).toISOString()
    : createdAt;

  let startDate;
  if (row.start_date) {
    startDate =
      typeof row.start_date === "string"
        ? row.start_date.slice(0, 10)
        : new Date(row.start_date).toISOString().slice(0, 10);
  } else {
    startDate = createdAt ? createdAt.slice(0, 10) : today;
  }

  let endDate = null;
  if (row.end_date) {
    endDate =
      typeof row.end_date === "string"
        ? row.end_date.slice(0, 10)
        : new Date(row.end_date).toISOString().slice(0, 10);
  }

  return {
    id: row.id,
    title: row.title || "",
    imageUrl: row.image_url || "",
    imagePositionX: Number(row.image_position_x ?? 50),
    imagePositionY: Number(row.image_position_y ?? 50),
    link: row.link_url || null,
    startDate,
    endDate,
    active:
      row.is_active !== null && row.is_active !== undefined
        ? Boolean(row.is_active)
        : true,
    viewsCount: Number(row.views_count ?? 0),
    clicksCount: Number(row.clicks_count ?? 0),
    createdAt,
    updatedAt,
  };
}

/**
 * Получить все баннеры для админ-панели (сортировка от новых к старым).
 */
export async function listAllBanners() {
  const { data, error } = await supabase
    .from("banners")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("DB error in listAllBanners:", error.message || error);
    throw new Error(error.message || "Не удалось загрузить список баннеров");
  }

  return (data || []).map(mapRowToBanner);
}

/**
 * Получить список активных баннеров для публичной страницы.
 *
 * Бэкенд работает под service_role, поэтому RLS обходится —
 * фильтрация по is_active и диапазону дат [start_date <= today AND (end_date IS NULL OR end_date >= today)]
 * выполняется непосредственно в запросе к БД.
 */
export async function listActiveBanners() {
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("banners")
    .select("*")
    .eq("is_active", true)
    .lte("start_date", today)
    .or(`end_date.is.null,end_date.gte.${today}`)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("DB error in listActiveBanners:", error.message || error);
    throw new Error(error.message || "Не удалось получить список активных баннеров");
  }

  return (data || []).map(mapRowToBanner);
}

/**
 * Получить баннер по ID.
 */
export async function getBannerById(id) {
  if (!id || !isValidUuid(id)) return null;

  const { data, error } = await supabase
    .from("banners")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error(`DB error in getBannerById(${id}):`, error.message || error);
    throw new Error(error.message || "Не удалось получить баннер");
  }

  return data ? mapRowToBanner(data) : null;
}

/**
 * Создать новый баннер.
 */
export async function createBanner(data) {
  const today = new Date().toISOString().slice(0, 10);

  const insertPayload = {
    title: (data.title || "").trim(),
    image_url: data.imageUrl,
    image_position_x: data.imagePositionX ?? 50,
    image_position_y: data.imagePositionY ?? 50,
    link_url: data.link || null,
    start_date: data.startDate || today,
    end_date: data.endDate || null,
    is_active: data.active !== undefined ? Boolean(data.active) : true,
  };

  if (data.id && isValidUuid(data.id)) {
    insertPayload.id = data.id;
  }

  const { data: createdRow, error } = await supabase
    .from("banners")
    .insert(insertPayload)
    .select()
    .single();

  if (error) {
    console.error("DB error in createBanner:", error.message || error);
    throw new Error(error.message || "Не удалось создать баннер");
  }

  return mapRowToBanner(createdRow);
}

/**
 * Обновить существующий баннер.
 * Возвращает `{ previous, updated }` или `null`, если баннер не найден.
 */
export async function updateBanner(id, data) {
  if (!id || !isValidUuid(id)) return null;

  const previous = await getBannerById(id);
  if (!previous) return null;

  const updatePayload = {
    updated_at: new Date().toISOString(),
  };

  if (data.title !== undefined) updatePayload.title = (data.title || "").trim();
  if (data.imageUrl !== undefined) updatePayload.image_url = data.imageUrl;
  if (data.imagePositionX !== undefined) updatePayload.image_position_x = data.imagePositionX;
  if (data.imagePositionY !== undefined) updatePayload.image_position_y = data.imagePositionY;
  if (data.link !== undefined) updatePayload.link_url = data.link || null;
  if (data.startDate !== undefined) updatePayload.start_date = data.startDate;
  if (data.endDate !== undefined) updatePayload.end_date = data.endDate || null;
  if (data.active !== undefined) updatePayload.is_active = Boolean(data.active);

  const { data: updatedRow, error } = await supabase
    .from("banners")
    .update(updatePayload)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error(`DB error in updateBanner(${id}):`, error.message || error);
    throw new Error(error.message || "Не удалось обновить баннер");
  }

  const updated = mapRowToBanner(updatedRow);
  return { previous, updated };
}

/**
 * Удалить баннер по ID.
 * Возвращает удалённый баннер или `null`, если баннер не найден.
 */
export async function deleteBanner(id) {
  if (!id || !isValidUuid(id)) return null;

  const { data: deletedRow, error } = await supabase
    .from("banners")
    .delete()
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) {
    console.error(`DB error in deleteBanner(${id}):`, error.message || error);
    throw new Error(error.message || "Не удалось удалить баннер");
  }

  return deletedRow ? mapRowToBanner(deletedRow) : null;
}

/**
 * Атомарное увеличение счётчика просмотров или кликов через PostgreSQL RPC:
 * `public.increment_banner_stat(banner_id uuid, stat text)`.
 *
 * Допустимые значения stat: 'view' или 'click'.
 */
export async function incrementBannerStat(bannerId, stat) {
  if (!bannerId || !isValidUuid(bannerId)) {
    throw new Error("Некорректный ID баннера (ожидается UUID)");
  }

  const normalized = String(stat).toLowerCase();
  let statParam;
  if (normalized === "view" || normalized === "views") {
    statParam = "view";
  } else if (normalized === "click" || normalized === "clicks") {
    statParam = "click";
  } else {
    throw new Error(`Недопустимый тип метрики: ${stat}. Разрешено: view, click`);
  }

  const { error } = await supabase.rpc("increment_banner_stat", {
    banner_id: bannerId,
    stat: statParam,
  });

  if (error) {
    console.error(`DB error in incrementBannerStat(${bannerId}, ${statParam}):`, error.message || error);
    throw new Error(error.message || "Не удалось обновить счётчик баннера");
  }

  return true;
}

/**
 * Увеличить счётчик просмотров баннера на 1.
 */
export async function incrementBannerViews(bannerId) {
  return incrementBannerStat(bannerId, "view");
}

/**
 * Увеличить счётчик кликов по баннеру на 1.
 */
export async function incrementBannerClicks(bannerId) {
  return incrementBannerStat(bannerId, "click");
}
