import { supabase } from "../config/db.js";

// Регулярное выражение для валидации UUID v4
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuid(id) {
  return typeof id === "string" && UUID_REGEX.test(id);
}

/**
 * Преобразует строку из таблицы public.instagram_requests (snake_case)
 * в формат DTO для приложения (camelCase).
 */
export function mapRowToRequest(row) {
  if (!row) return null;

  return {
    id: row.id,
    listingId: row.listing_id,
    userId: row.user_id,
    status: row.status || "pending",
    createdAt: row.created_at
      ? typeof row.created_at === "string"
        ? row.created_at
        : new Date(row.created_at).toISOString()
      : new Date().toISOString(),
    publishedAt: row.published_at
      ? typeof row.published_at === "string"
        ? row.published_at
        : new Date(row.published_at).toISOString()
      : null,
    updatedAt: row.updated_at
      ? typeof row.updated_at === "string"
        ? row.updated_at
        : new Date(row.updated_at).toISOString()
      : null,
    publishedBy: row.published_by || null,
    notes: row.notes || null,
  };
}

/**
 * Форматирует заявку с вложенными данными объявления и пользователя
 * для ответа панели администратора (GET /api/admin/instagram-requests).
 */
export function formatRequestWithDetails(request) {
  if (!request) return null;

  const listing = request.listing || null;
  const user = request.user || null;
  const profile = Array.isArray(user?.user_profiles)
    ? user.user_profiles[0]
    : user?.user_profiles || null;

  const mainPhoto = listing?.listing_photos?.length
    ? [...listing.listing_photos].sort((a, b) => {
        if (a.is_main !== b.is_main) return a.is_main ? -1 : 1;
        return (a.display_order ?? 0) - (b.display_order ?? 0);
      })[0]
    : null;

  const userName =
    profile?.company_name ||
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
    user?.email ||
    "Пользователь удалён";

  return {
    id: request.id,
    status: request.status,
    createdAt: request.created_at
      ? typeof request.created_at === "string"
        ? request.created_at
        : new Date(request.created_at).toISOString()
      : null,
    publishedAt: request.published_at
      ? typeof request.published_at === "string"
        ? request.published_at
        : new Date(request.published_at).toISOString()
      : null,
    listing: listing
      ? {
          id: listing.id,
          title: listing.title,
          price: listing.price,
          currency: listing.currency,
          propertyType: listing.property_type,
          dealType: listing.deal_type,
          region: listing.region,
          city: listing.city,
          district: listing.district,
          address: listing.address,
          rooms: listing.rooms,
          area: listing.area,
          promotionStatus: listing.promotion_status,
          isUrgent: listing.is_urgent,
          image: mainPhoto?.url || null,
        }
      : null,
    user: {
      name: userName,
      phone: user?.phone || null,
    },
  };
}

/**
 * Создать новую заявку на публикацию в Instagram.
 *
 * Если для данного объявления уже существует заявка в статусе 'pending',
 * частичный уникальный индекс idx_instagram_requests_unique_pending_listing
 * выбросит ошибку Postgres с кодом 23505 (unique_violation).
 * Функция перехватывает её и выбрасывает понятную ошибку с HTTP-статусом 409.
 */
export async function createInstagramRequest({ listingId, userId }) {
  if (!listingId || !isValidUuid(listingId)) {
    const err = new Error("Некорректный ID объявления (ожидается UUID)");
    err.status = 400;
    err.statusCode = 400;
    throw err;
  }
  if (!userId || !isValidUuid(userId)) {
    const err = new Error("Некорректный ID пользователя (ожидается UUID)");
    err.status = 400;
    err.statusCode = 400;
    throw err;
  }

  const insertPayload = {
    listing_id: listingId,
    user_id: userId,
    status: "pending",
  };

  const { data, error } = await supabase
    .from("instagram_requests")
    .insert(insertPayload)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      const conflictError = new Error("Заявка на это объявление уже подана");
      conflictError.status = 409;
      conflictError.statusCode = 409;
      conflictError.code = "23505";
      throw conflictError;
    }

    console.error("DB error in createInstagramRequest:", error.message || error);
    const dbError = new Error(error.message || "Не удалось создать заявку на Instagram");
    dbError.status = 500;
    throw dbError;
  }

  return mapRowToRequest(data);
}

/**
 * Получить список всех заявок (для админки), отсортированных от новых к старым.
 */
export async function listInstagramRequests(limit = 100) {
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 100));
  let query = supabase
    .from("instagram_requests")
    .select("id, listing_id, user_id, status, created_at, published_at, updated_at, published_by, notes")
    .order("created_at", { ascending: false });

  if (typeof query?.limit === "function") {
    query = query.limit(safeLimit);
  }

  const { data, error } = await query;

  if (error) {
    console.error("DB error in listInstagramRequests:", error.message || error);
    throw new Error(error.message || "Не удалось загрузить список заявок на Instagram");
  }

  return (data || []).slice(0, safeLimit).map(mapRowToRequest);
}

/**
 * Получить заявку по ID.
 */
export async function getInstagramRequestById(id) {
  if (!id || !isValidUuid(id)) return null;

  const { data, error } = await supabase
    .from("instagram_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error(`DB error in getInstagramRequestById(${id}):`, error.message || error);
    throw new Error(error.message || "Не удалось получить заявку на Instagram");
  }

  return data ? mapRowToRequest(data) : null;
}

/**
 * Отметить заявку на публикацию в Instagram как выполненную (статус published).
 * Фиксирует published_at, updated_at и ID администратора published_by.
 */
export async function markInstagramRequestPublished(
  id,
  { publishedBy = null, notes = null } = {}
) {
  if (!id || !isValidUuid(id)) return null;

  const now = new Date().toISOString();
  const updatePayload = {
    status: "published",
    published_at: now,
    updated_at: now,
  };

  if (publishedBy && isValidUuid(publishedBy)) {
    updatePayload.published_by = publishedBy;
  }
  if (notes !== undefined && notes !== null) {
    updatePayload.notes = notes;
  }

  const { data, error } = await supabase
    .from("instagram_requests")
    .update(updatePayload)
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) {
    console.error(
      `DB error in markInstagramRequestPublished(${id}):`,
      error.message || error
    );
    throw new Error(
      error.message || "Не удалось обновить статус заявки на Instagram"
    );
  }

  return data ? mapRowToRequest(data) : null;
}

/**
 * Загрузить заявки Instagram со всеми связанными данными (объявление, фото, пользователь, профиль)
 * одним запросом с вложенным выбором через Supabase SDK.
 */
export async function fetchInstagramRequestsWithDetails(limit = 100) {
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 100));
  let query = supabase
    .from("instagram_requests")
    .select(`
      id,
      status,
      created_at,
      published_at,
      listing:listings!listing_id (
        id,
        title,
        price,
        currency,
        property_type,
        deal_type,
        region,
        city,
        district,
        address,
        rooms,
        area,
        promotion_status,
        is_urgent,
        listing_photos (url, is_main, display_order)
      ),
      user:users!user_id (
        id,
        email,
        phone,
        user_profiles (first_name, last_name, company_name)
      )
    `)
    .order("created_at", { ascending: false });

  if (typeof query?.limit === "function") {
    query = query.limit(safeLimit);
  }

  const { data: requestRows, error } = await query;

  if (error) {
    // Резервный путь при ошибках разрешения связей в PostgREST:
    // выполняем раздельные параллельные выборки без падения процесса
    console.warn(
      "Nested select on instagram_requests encountered error, falling back to separate queries:",
      error.message
    );
    return fetchInstagramRequestsWithDetailsFallback(safeLimit);
  }

  return (requestRows || []).slice(0, safeLimit).map(formatRequestWithDetails);
}

/**
 * Резервный метод загрузки с раздельными запросами
 */
async function fetchInstagramRequestsWithDetailsFallback() {
  const requests = await listInstagramRequests();

  const listingIds = [...new Set(requests.map((r) => r.listingId).filter(Boolean))];
  const userIds = [...new Set(requests.map((r) => r.userId).filter(Boolean))];

  const [{ data: listingRows }, { data: userRows }, { data: profileRows }] =
    await Promise.all([
      listingIds.length > 0
        ? supabase
            .from("listings")
            .select(
              "id, title, price, currency, property_type, deal_type, region, city, district, address, rooms, area, promotion_status, is_urgent, listing_photos (url, is_main, display_order)"
            )
            .in("id", listingIds)
        : { data: [] },
      userIds.length > 0
        ? supabase.from("users").select("id, email, phone").in("id", userIds)
        : { data: [] },
      userIds.length > 0
        ? supabase
            .from("user_profiles")
            .select("user_id, first_name, last_name, company_name")
            .in("user_id", userIds)
        : { data: [] },
    ]);

  const listingsById = new Map((listingRows || []).map((l) => [l.id, l]));
  const usersById = new Map((userRows || []).map((u) => [u.id, u]));
  const profilesByUserId = new Map(
    (profileRows || []).map((p) => [p.user_id, p])
  );

  return requests.map((request) => {
    const listing = listingsById.get(request.listingId) || null;
    const user = usersById.get(request.userId) || null;
    const profile = profilesByUserId.get(request.userId) || null;

    const mainPhoto = listing?.listing_photos?.length
      ? [...listing.listing_photos].sort((a, b) => {
          if (a.is_main !== b.is_main) return a.is_main ? -1 : 1;
          return (a.display_order ?? 0) - (b.display_order ?? 0);
        })[0]
      : null;

    const userName =
      profile?.company_name ||
      [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
      user?.email ||
      "Пользователь удалён";

    return {
      id: request.id,
      status: request.status,
      createdAt: request.createdAt,
      publishedAt: request.publishedAt,
      listing: listing
        ? {
            id: listing.id,
            title: listing.title,
            price: listing.price,
            currency: listing.currency,
            propertyType: listing.property_type,
            dealType: listing.deal_type,
            region: listing.region,
            city: listing.city,
            district: listing.district,
            address: listing.address,
            rooms: listing.rooms,
            area: listing.area,
            promotionStatus: listing.promotion_status,
            isUrgent: listing.is_urgent,
            image: mainPhoto?.url || null,
          }
        : null,
      user: {
        name: userName,
        phone: user?.phone || null,
      },
    };
  });
}
