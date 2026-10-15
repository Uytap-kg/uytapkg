import jwt from "jsonwebtoken";
import { supabase } from "../config/db.js";
import {
  createListingSchema,
  updateListingSchema,
  promoteWithTariffSchema,
} from "../utils/validation.js";
import { removeImageFromStorage } from "../utils/storage.js";
import { resolvePromotionExpiry, grantPromotion } from "../services/promotionsService.js";
import { createInstagramRequest } from "../utils/instagramRequests.js";
import {
  consumeTariffBoost,
  refundTariffBoost,
  getActiveListingsLimit,
  getActiveSubscription,
  consumeTariffListing,
  refundTariffListing,
  activateListingSlot,
  checkDraftsLimit,
  MAX_DRAFTS_PER_USER,
} from "../services/subscriptionsService.js";
import { verifyAllOwnedBy } from "../utils/uploadOwnership.js";

// Удаляет из пользовательского объекта features системные ключи:
// promotionExpiresAt, urgentExpiresAt, residentialComplexId,
// чтобы предотвратить их манипуляцию через API.
export function sanitizeFeatures(features) {
  if (!features || typeof features !== "object" || Array.isArray(features)) {
    return {};
  }
  const clean = { ...features };
  delete clean.promotionExpiresAt;
  delete clean.urgentExpiresAt;
  delete clean.residentialComplexId;
  delete clean.promotion_expires_at;
  delete clean.urgent_expires_at;
  delete clean.residential_complex_id;
  return clean;
}

// Купленное продвижение (VIP/ТОП/Срочно) действует ограниченный срок, но
// в БД нет job'а, который бы его снимал по истечении — вместо cron'а
// каждый read-путь маскирует уже истёкшее продвижение прямо в ответе (см.
// resolvePromotionExpiry). Возвращает тот же объект, если ничего не
// изменилось — лишний спред не нужен.
function maskExpiredPromotion(listing) {
  const resolved = resolvePromotionExpiry(listing);
  if (!resolved.changed) return listing;

  return {
    ...listing,
    promotion_status: resolved.promotionStatus,
    is_urgent: resolved.isUrgent,
  };
}

// Автомаскирование статуса в read-путях:
// Если у объявления status === 'active' и expires_at <= NOW(),
// выставлять в ответе status: 'expired', чтобы клиент сразу видел статус «Срок истёк».
function maskExpiredListing(listing) {
  if (!listing) return listing;

  const masked = maskExpiredPromotion(listing);

  const isExpired =
    masked.status === "active" &&
    masked.expires_at &&
    new Date(masked.expires_at).getTime() <= Date.now();

  if (isExpired) {
    return {
      ...masked,
      status: "expired",
    };
  }

  return masked;
}

// Единая функция валидации переходов статусов для владельца
export function canOwnerTransition(fromStatus, toStatus) {
  // Возвращает { allowed: boolean, message?: string }
  // Модерация: владелец ни при каких условиях не может перевести объявление из или в status="moderation"
  if (fromStatus === "moderation" || toStatus === "moderation") {
    return { allowed: false, message: "Статус модерации может изменить только администратор" };
  }
  // Черновик: прямой перевод draft -> active запрещён для владельца (активация черновика только через оплату/grantPromotion)
  if (fromStatus === "draft" && toStatus === "active") {
    return { allowed: false, message: "Черновик объявления ожидает оплаты или подтверждения публикации" };
  }
  // Разрешённые переходы владельца:
  // active <-> hidden, active -> active, hidden -> hidden, draft -> draft, draft -> hidden, expired -> active
  const allowedTransitions = new Set([
    "active->active",
    "active->hidden",
    "hidden->active",
    "hidden->hidden",
    "draft->draft",
    "draft->hidden",
    "expired->active",
    "expired->hidden",
    "expired->expired",
  ]);
  const key = `${fromStatus}->${toStatus}`;
  if (allowedTransitions.has(key)) {
    return { allowed: true };
  }
  return { allowed: false, message: `Переход из статуса "${fromStatus}" в "${toStatus}" запрещён` };
}

// =======================================================
// 1. Получение списка объявлений с фильтрами
// =======================================================
export const getListings = async (req, res) => {
  try {
    const {
      country,
      region,
      city,
      district,
      propertyType,
      dealType,
      rentPeriod,
      minPrice,
      maxPrice,
      rooms,
      isResort,
      onlyPopular, // Флаг для блока популярных объявлений
      page = 1,
      limit = 20,
    } = req.query;

    let query = supabase
      .from("listings")
      .select(`
        *,
        listing_photos (id, url, is_main, display_order),
        users!inner (id, is_verified, account_type)
      `, { count: "exact" })
      .eq("status", "active")
      .gt("expires_at", new Date().toISOString());

    // Фильтрация по региону / городу / району / стране
    if (country) {
      const cLower = String(country).toLowerCase();
      if (cLower === "turkey" || cLower === "турция") {
        query = query.or("region.ilike.%TURKEY%,region.ilike.%Турция%,city.ilike.%Турция%,city.ilike.%Turkey%");
      }
    } else if (region) {
      const rLower = String(region).toLowerCase();
      if (rLower === "turkey" || rLower === "турция") {
        query = query.or("region.ilike.%TURKEY%,region.ilike.%Турция%,city.ilike.%Турция%,city.ilike.%Turkey%");
      } else {
        query = query.ilike("region", `%${region}%`);
      }
    }

    if (city && city !== "Все") query = query.eq("city", city.trim());
    if (district) query = query.ilike("district", `%${district}%`);

    // Фильтрация по типу недвижимости и сделки
    if (propertyType) query = query.eq("property_type", propertyType);
    if (dealType) query = query.eq("deal_type", dealType);
    if (rentPeriod) query = query.eq("rent_period", rentPeriod);

    // Цена
    if (minPrice && !Number.isNaN(Number(minPrice))) query = query.gte("price", Number(minPrice));
    if (maxPrice && !Number.isNaN(Number(maxPrice))) query = query.lte("price", Number(maxPrice));

    // Количественные параметры
    if (rooms && !Number.isNaN(Number(rooms))) query = query.eq("rooms", Number(rooms));
    if (isResort !== undefined) query = query.eq("is_resort", isResort === "true");

    // ТЗ Правило (Дефект 1.1): В блок "Популярные" на главной попадают только объявления с фото
    if (onlyPopular === "true") {
      query = query.gt("photos_count", 0);
    }

    // Пагинация и сортировка на уровне БД
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    let orderedQuery = query.order("priority_rank", { ascending: true });
    if (typeof orderedQuery?.order === "function") {
      orderedQuery = orderedQuery.order("created_at", { ascending: false });
    }
    query = orderedQuery.range(from, to);

    const { data: listings, count, error } = await query;

    if (error) {
      console.error("Error fetching listings:", JSON.stringify(error, null, 2) || error);
      return res.status(500).json({ success: false, message: "Ошибка загрузки объявлений" });
    }

    // Вспомогательная функция приоритета: vip (0) -> urgent (1) -> top (2) -> regular (3)
    const getListingPriority = (item) => {
      if (item.priority_rank !== undefined && item.priority_rank !== null) return item.priority_rank;
      if (item.promotion_status === "vip") return 0;
      if (item.is_urgent) return 1;
      if (item.promotion_status === "top") return 2;
      return 3;
    };

    // Маскируем истёкший срок и истёкшее продвижение
    const maskedListings = (listings || []).map(maskExpiredListing);

    // Поддержка динамически замаскированных записей (или моков тестов)
    maskedListings.sort((a, b) => {
      const prioA = getListingPriority(a);
      const prioB = getListingPriority(b);
      if (prioA !== prioB) return prioA - prioB;
      return new Date(b.created_at) - new Date(a.created_at);
    });

    return res.json({
      success: true,
      data: maskedListings,
      pagination: {
        total: count ?? maskedListings.length,
        page: pageNum,
        limit: limitNum,
      },
    });
  } catch (error) {
    console.error("Listings Get Error:", error);
    return res.status(500).json({ success: false, message: "Ошибка сервера при поиске объявлений" });
  }
};

// =======================================================
// Защита PII и учёт просмотров (пункт 7 ТЗ)
// =======================================================

// Извлекает и валидирует пользователя из req.user (если установлен middleware)
// либо из заголовка Authorization: Bearer <token>. Безопасно возвращает null для анонимов.
export async function resolveCurrentUser(req) {
  if (req?.user) {
    return req.user;
  }

  const authHeader = req?.headers?.["authorization"] || req?.headers?.["Authorization"];
  if (!authHeader || typeof authHeader !== "string") {
    return null;
  }

  const parts = authHeader.trim().split(/\s+/);
  const token = parts.length === 2 && parts[0].toLowerCase() === "bearer" ? parts[1] : null;
  if (!token) {
    return null;
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    return null;
  }

  try {
    const decoded = jwt.verify(token, jwtSecret, { algorithms: ["HS256"] });
    if (!decoded || decoded.typ !== "access") {
      return null;
    }

    const { data: dbUser, error } = await supabase
      .from("users")
      .select("id, role, account_type, token_version")
      .eq("id", decoded.id)
      .maybeSingle();

    if (error || !dbUser) {
      return null;
    }

    if (dbUser.token_version !== (decoded.tv ?? 0)) {
      return null;
    }

    const user = {
      ...decoded,
      id: dbUser.id,
      role: dbUser.role || "user",
      account_type: dbUser.account_type || decoded.accountType,
      accountType: dbUser.account_type || decoded.accountType,
    };
    req.user = user;
    return user;
  } catch (err) {
    return null;
  }
}

// Фильтрация PII продавца:
// - email полностью удаляется во всех случаях
// - phone отдаётся только для бизнес-аккаунтов (agency, developer, realtor)
//   либо если у автора включен флаг показа телефона (show_phone).
//   Для personal-продавцов отдаётся phone: null.
export function sanitizeAuthorPII(author) {
  if (!author || typeof author !== "object") return author;

  const isBusinessAccount = ["agency", "developer", "realtor"].includes(author.account_type);
  const profile = Array.isArray(author.user_profiles) ? author.user_profiles[0] : author.user_profiles;
  const showPhone =
    isBusinessAccount ||
    Boolean(
      author.show_phone ||
      author.showPhone ||
      profile?.show_phone ||
      profile?.showPhone
    );

  const sanitized = {
    ...author,
    phone: showPhone ? (author.phone || null) : null,
  };

  delete sanitized.email;
  return sanitized;
}

// Извлечение реального IP клиента с учётом заголовков прокси
export function getClientIp(req) {
  if (!req) return "unknown";
  const forwarded = req.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    const firstIp = forwarded.split(",")[0].trim();
    if (firstIp) return firstIp;
  }
  const realIp = req.headers?.["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim()) {
    return realIp.trim();
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

// Защита от спама просмотров: не чаще 1 инкремента с одного IP на объявление за 10 минут
export const VIEW_THROTTLE_MS = 10 * 60 * 1000;
export const viewsThrottleMap = new Map();

export function shouldIncrementView(ip, listingId) {
  if (!ip || !listingId) return true;
  const key = `${ip}:${listingId}`;
  const now = Date.now();
  const lastViewTime = viewsThrottleMap.get(key);
  if (lastViewTime && now - lastViewTime < VIEW_THROTTLE_MS) {
    return false;
  }
  viewsThrottleMap.set(key, now);

  // Защита от утечки памяти при большом числе ключей
  if (viewsThrottleMap.size > 10000) {
    for (const [k, timestamp] of viewsThrottleMap.entries()) {
      if (now - timestamp >= VIEW_THROTTLE_MS) {
        viewsThrottleMap.delete(k);
      }
    }
  }
  return true;
}

// Атомарный инкремент просмотров в базе данных через RPC increment_views с фолбэком
export async function incrementListingViews(listingId, currentViewsCount) {
  let newViewsCount = (currentViewsCount || 0) + 1;
  try {
    const { data: rpcViews, error: rpcError } = await supabase.rpc("increment_views", {
      listing_id: listingId,
    });
    if (!rpcError && typeof rpcViews === "number") {
      newViewsCount = rpcViews;
    } else {
      if (rpcError) {
        console.warn(
          "⚠️ increment_views RPC failed or not installed, falling back to direct update:",
          rpcError.message || rpcError
        );
      }
      const { error: updateError } = await supabase
        .from("listings")
        .update({ views_count: newViewsCount })
        .eq("id", listingId);
      if (updateError) {
        console.warn("Direct views_count update failed:", updateError.message);
      }
    }
  } catch (err) {
    console.warn("increment_views exception, falling back to direct update:", err.message);
    try {
      await supabase
        .from("listings")
        .update({ views_count: newViewsCount })
        .eq("id", listingId);
    } catch (directErr) {
      console.warn("Fallback direct views_count update failed:", directErr.message);
    }
  }
  return newViewsCount;
}

// =======================================================
// 2. Получение одного объявления по ID
// =======================================================
export const getListingById = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: listing, error } = await supabase
      .from("listings")
      .select(`
        *,
        listing_photos (*),
        users (id, phone, show_phone, is_verified, account_type, user_profiles (first_name, last_name, company_name, avatar_url, about))
      `)
      .eq("id", id)
      .single();

    if (error || !listing) {
      if (error) {
        console.error("Get Listing By ID DB Error:", error);
      }
      return res.status(404).json({ success: false, message: "Объявление не найдено" });
    }

    // 1. Определение текущего пользователя
    const currentUser = await resolveCurrentUser(req);
    const userId = currentUser?.id;
    const userRole = currentUser?.role;

    const isOwner = Boolean(userId && listing.user_id === userId);
    const isAdmin = userRole === "admin";

    // 2. Разграничение доступа:
    // Для анонимных пользователей и чужих аккаунтов (не владелец и не admin):
    // отдавать карточку ТОЛЬКО если status === 'active' И (expires_at IS NULL ИЛИ expires_at > NOW()).
    // Если объявление в draft, moderation, hidden или expired — возвращать 404 Not Found!
    // Владелец и admin видят объявление в любом статусе.
    if (!isOwner && !isAdmin) {
      const isExpired = listing.expires_at && new Date(listing.expires_at).getTime() <= Date.now();
      if (listing.status !== "active" || isExpired) {
        return res.status(404).json({ success: false, message: "Объявление не найдено" });
      }
    }

    // 3. Защита от накрутки просмотров:
    // - Не считать просмотры владельца (если userId === listing.user_id — счётчик не увеличивать).
    // - Защита от спама: не чаще 1 инкремента с одного IP на объявление за 10 минут.
    // - Счётчик инкрементируется только для активных неистёкших объявлений.
    const isListingActive =
      listing.status === "active" &&
      (!listing.expires_at || new Date(listing.expires_at).getTime() > Date.now());

    if (!isOwner && isListingActive) {
      const clientIp = getClientIp(req);
      if (shouldIncrementView(clientIp, listing.id)) {
        const updatedViews = await incrementListingViews(listing.id, listing.views_count);
        listing.views_count = updatedViews;
      }
    }

    // 4. Фильтрация PII:
    // Из объекта автора users полностью убрать поле email.
    // Поле phone отдавать только для бизнес-аккаунтов (agency, developer, realtor)
    // либо если у автора включен флаг показа телефона. Для personal-продавцов отдавать phone: null.
    if (listing.users) {
      if (Array.isArray(listing.users)) {
        listing.users = listing.users.map(sanitizeAuthorPII);
      } else {
        listing.users = sanitizeAuthorPII(listing.users);
      }
    }

    return res.json({ success: true, data: maskExpiredListing(listing) });
  } catch (error) {
    console.error("Get Listing By ID Error:", error);
    return res.status(500).json({ success: false, message: "Ошибка сервера при получении объявления" });
  }
};

// =======================================================
// 3. Создание нового объявления
// =======================================================
export const createListing = async (req, res) => {
  try {
    // Валидация входящих данных через Zod
    const validationResult = createListingSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        message: "Ошибка валидации данных",
        errors: validationResult.error.errors.map((e) => e.message),
      });
    }

    const userId = req.user.id;

    const {
      title,
      description,
      propertyType,
      dealType,
      rentPeriod,
      region,
      city,
      district,
      microdistrict,
      address,
      latitude,
      longitude,
      price,
      currency,
      area,
      rooms,
      floor,
      totalFloors,
      isResort,
      resortFilters = {},
      features = {},
      photos = [],
      listingType,
      days,
      beachDistanceFrom,
      beachDistanceTo,
      developerOrComplex,
      residentialComplexId,
    } = validationResult.data;

    // Каждое фото должно быть реально загружено ЭТИМ пользователем через
    // /api/upload/listing-photo (иначе фото не прошло бы через водяной
    // знак) — trustedImageUrl в схеме проверяет только хост ссылки, а не
    // то, кто и как файл загрузил. Без этой проверки можно было бы
    // подставить публичный URL чужого фото (обход водяного знака и,
    // отдельно, IDOR на удаление — см. removeImageFromStorage в
    // deleteListing: она выполняется с сервисными правами и стёрла бы
    // чужой файл из Storage при удалении/обновлении ЭТОГО объявления).
    if (!(await verifyAllOwnedBy(photos, userId))) {
      return res.status(400).json({
        success: false,
        message: "Все фото должны быть загружены вами через форму загрузки объявления",
      });
    }

    // Объявление ВСЕГДА вставляется как обычное (regular/не срочное) —
    // клиентский listingType никогда не пишется в promotion_status/is_urgent
    // напрямую (иначе любой пользователь мог бы бесплатно и без срока
    // действия присвоить себе платный статус). VIP/ТОП/Срочно применяются
    // отдельным вызовом grantPromotion НИЖЕ, только после того, как это
    // подтверждено сервером — списанием поднятия с тарифа (consumeTariffBoost)
    // либо (для остальных случаев) реальной оплатой через O!Dengi, для
    // которой объявление создаётся статусом "draft" и становится "active"
    // только после подтверждения платежа (см. paymentsController.js
    // reconcilePaymentStatus → promotionsService.applyPromotion →
    // grantPromotion, который сам переводит "draft"/"hidden" в "active").
    const promotion_status = "regular";
    const is_urgent = false;
    const boostDays = Number.isInteger(days) ? days : 7;

    // Платное продвижение, покрытое лимитом тарифа, списывается ДО
    // вставки строки — если тарифа/лимита нет, объявление создаётся
    // "draft" и ждёт оплаты, а не публикуется бесплатно.
    const operationId = `listing_create_${userId}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    let tariffGrant = null; // { serviceType, days, remaining } если списано с тарифа
    let initialStatus = req.body.status === "draft" ? "draft" : "active";

    if (listingType === "vip" || listingType === "top") {
      const consumption = await consumeTariffBoost(userId, listingType);
      if (consumption.granted) {
        tariffGrant = { serviceType: listingType, days: boostDays, remaining: consumption.remaining };
      } else {
        initialStatus = "draft";
      }
    } else if (listingType === "urgent") {
      // "Срочно" не входит в лимиты тарифа — всегда только платно.
      initialStatus = "draft";
    }

    // Проверка лимитов:
    // - для draft: лимит одновременных черновиков (максимум 10)
    // - для active: атомарная проверка и вставка через create_listing_with_limit (Пункт 11)
    let tariffListingGrant = false;
    if (initialStatus === "draft") {
      const draftsCheck = await checkDraftsLimit(userId);
      if (!draftsCheck.allowed) {
        if (tariffGrant) {
          await refundTariffBoost(userId, tariffGrant.serviceType, `${operationId}_boost`);
        }
        return res.status(400).json({
          success: false,
          message: "Превышен лимит одновременных черновиков (максимум 10)",
        });
      }
    }

    // Сборка комплексного объекта курортных фильтров
    const mergedResortFilters = {
      ...resortFilters,
      beachDistanceFrom: beachDistanceFrom || resortFilters?.beachDistanceFrom || null,
      beachDistanceTo: beachDistanceTo || resortFilters?.beachDistanceTo || null,
      developerOrComplex: developerOrComplex || resortFilters?.developerOrComplex || null,
    };

    // Проверяем, что указанный ЖК реально существует — иначе через тело
    // запроса можно было бы привязать объявление к произвольному/несуществующему
    // ID и оно "подделанно" отображалось бы в чужом жилом комплексе. Значение
    // берём только из проверенного результата, а не из сырого features
    // клиента, чтобы его нельзя было подменить в обход этой проверки.
    let verifiedComplexId = null;
    if (residentialComplexId) {
      const { data: complexRow } = await supabase
        .from("residential_complexes")
        .select("id")
        .eq("id", residentialComplexId)
        .maybeSingle();

      if (!complexRow) {
        if (tariffGrant) {
          await refundTariffBoost(userId, tariffGrant.serviceType, `${operationId}_boost`);
        }
        return res.status(400).json({
          success: false,
          message: "Указанный жилой комплекс не найден",
        });
      }

      verifiedComplexId = complexRow.id;
    }

    const listingPayload = {
      title,
      description,
      property_type: propertyType,
      deal_type: dealType,
      rent_period: dealType === "rent" ? rentPeriod : null,
      region,
      city,
      district,
      microdistrict,
      address,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      price: Number(price),
      currency: currency || "KGS",
      area: area ? Number(area) : null,
      rooms: rooms ? Number(rooms) : null,
      floor: floor ? Number(floor) : null,
      total_floors: totalFloors ? Number(totalFloors) : null,
      is_resort: Boolean(isResort),
      resort_filters: mergedResortFilters,
      features: { ...sanitizeFeatures(features), residentialComplexId: verifiedComplexId },
      status: initialStatus,
      promotion_status,
      is_urgent,
      priority_rank: 3,
      photos_count: Array.isArray(photos) ? photos.length : 0,
      expires_at: new Date(Date.now() + 40 * 24 * 60 * 60 * 1000).toISOString(),
    };

    let newListing = null;

    // Пункт 11: Для статуса "active" вызываем атомарный механизм create_listing_with_limit
    // с advisory lock на уровне БД, исключающий любые состояния гонки.
    if (initialStatus === "active") {
      const activeLimit = await getActiveListingsLimit(userId, req.user.account_type);
      const activeSub = await getActiveSubscription(userId);
      if (activeSub) {
        tariffListingGrant = true;
      }

      let rpcExecuted = false;
      try {
        const { data: rpcListing, error: rpcError } = await supabase.rpc(
          "create_listing_with_limit",
          {
            p_user_id: userId,
            p_listing_data: listingPayload,
            p_limit: activeLimit,
          }
        );

        if (!rpcError && rpcListing) {
          newListing = Array.isArray(rpcListing) ? rpcListing[0] : rpcListing;
          rpcExecuted = true;
        } else if (rpcError) {
          if (
            rpcError.message?.includes("LIMIT_EXCEEDED") ||
            rpcError.code === "P0002" ||
            rpcError.details?.includes("LIMIT_EXCEEDED")
          ) {
            if (tariffGrant) {
              await refundTariffBoost(userId, tariffGrant.serviceType, `${operationId}_boost`);
            }
            return res.status(403).json({
              success: false,
              message: `Достигнут лимит активных объявлений (${activeLimit}). Для размещения новых объявлений продлите тариф или выберите другой план.`,
            });
          }

          console.warn(
            "⚠️ create_listing_with_limit RPC failed or not installed, falling back to direct insertion:",
            rpcError.message || rpcError
          );
        }
      } catch (rpcEx) {
        if (rpcEx.message?.includes("LIMIT_EXCEEDED")) {
          if (tariffGrant) {
            await refundTariffBoost(userId, tariffGrant.serviceType, `${operationId}_boost`);
          }
          return res.status(403).json({
            success: false,
            message: `Достигнут лимит активных объявлений (${activeLimit}). Для размещения новых объявлений продлите тариф или выберите другой план.`,
          });
        }
        console.warn("⚠️ create_listing_with_limit exception, fallback:", rpcEx.message);
      }

      // Фолбэк на прямое создание (если RPC ещё не развёрнут в БД)
      if (!rpcExecuted) {
        const slot = await activateListingSlot(userId, null, req.user.account_type);
        if (!slot.granted) {
          if (tariffGrant) {
            await refundTariffBoost(userId, tariffGrant.serviceType, `${operationId}_boost`);
          }
          return res.status(403).json({
            success: false,
            message: slot.message,
          });
        }

        const { data: directListing, error: createError } = await supabase
          .from("listings")
          .insert([
            {
              user_id: userId,
              ...listingPayload,
            },
          ])
          .select()
          .single();

        if (createError || !directListing) {
          console.error("Listing Create Error (fallback):", JSON.stringify(createError, null, 2) || createError);
          if (tariffGrant) {
            await refundTariffBoost(userId, tariffGrant.serviceType, `${operationId}_boost`);
          }
          if (tariffListingGrant) {
            await refundTariffListing(userId, `${operationId}_slot`);
          }
          return res.status(500).json({ success: false, message: "Ошибка создания объявления" });
        }

        newListing = directListing;
      }
    } else {
      // initialStatus === "draft"
      const { data: draftListing, error: createError } = await supabase
        .from("listings")
        .insert([
          {
            user_id: userId,
            ...listingPayload,
          },
        ])
        .select()
        .single();

      if (createError || !draftListing) {
        console.error("Draft Listing Create Error:", JSON.stringify(createError, null, 2) || createError);
        if (tariffGrant) {
          await refundTariffBoost(userId, tariffGrant.serviceType, `${operationId}_boost`);
        }
        return res.status(500).json({ success: false, message: "Ошибка создания черновика объявления" });
      }

      newListing = draftListing;
    }

    // Сохранение фото
    if (photos && photos.length > 0) {
      const photosData = photos.map((url, idx) => ({
        listing_id: newListing.id,
        url,
        is_main: idx === 0,
        display_order: idx,
      }));
      const { error: photosError } = await supabase.from("listing_photos").insert(photosData);
      if (photosError) {
        console.error("Listing Photos Insert Error:", photosError);
        await supabase.from("listings").delete().eq("id", newListing.id);
        if (tariffGrant) {
          await refundTariffBoost(userId, tariffGrant.serviceType, `${operationId}_boost`);
        }
        if (tariffListingGrant) {
          await refundTariffListing(userId, `${operationId}_slot`);
        }
        return res.status(500).json({ success: false, message: "Ошибка сохранения фотографий объявления" });
      }

      await supabase.from("listings").update({ photos_count: photos.length }).eq("id", newListing.id);
      newListing.photos_count = photos.length;
    }

    // Тип размещения "instagram" публикует объявление как обычное (оплата
    // услуги пока не реализована), но создаёт заявку для админки — там её
    // подтверждают вручную после фактической публикации в Instagram UyTap.
    if (listingType === "instagram") {
      try {
        await createInstagramRequest({ listingId: newListing.id, userId });
      } catch (instagramError) {
        if (instagramError.status === 409 || instagramError.code === "23505") {
          console.warn("Instagram request already exists for listing:", newListing.id);
        } else {
          console.error("Instagram Request Create Error:", instagramError);
        }
      }
    }

    let finalListing = newListing;

    // Поднятие уже списано с тарифа (до вставки строки) — применяем
    // продвижение сразу, объявление публикуется с ним же, без отдельного
    // шага оплаты.
    if (tariffGrant) {
      const applied = await grantPromotion({
        listingId: newListing.id,
        serviceType: tariffGrant.serviceType,
        days: tariffGrant.days,
      });

      if (applied) {
        const { data: refreshed } = await supabase
          .from("listings")
          .select("*")
          .eq("id", newListing.id)
          .single();
        if (refreshed) finalListing = refreshed;
      } else {
        // Само объявление уже создано (активно как обычное) — не роняем
        // ответ клиенту, но возвращаем поднятие, раз применить его не
        // получилось, чтобы пользователь не терял его впустую.
        console.error("Create Listing: grantPromotion failed after tariff consumption", newListing.id);
        await refundTariffBoost(userId, tariffGrant.serviceType, `${operationId}_boost`);
      }
    }

    return res.status(201).json({
      success: true,
      message:
        initialStatus === "draft"
          ? "Объявление создано и ждёт оплаты продвижения"
          : "Объявление успешно создано",
      data: finalListing,
      // needsPayment/promotion — подсказка фронтенду, что дальше нужно
      // создать оплату (см. front-end/src/app/add-product/page.jsx) —
      // объявление в статусе "draft" не публикуется, пока не пройдёт
      // POST /api/payments/promotion/create → успешная оплата.
      needsPayment: initialStatus === "draft",
      promotion:
        initialStatus === "draft" ? { serviceType: listingType, days: boostDays } : null,
    });
  } catch (error) {
    console.error("Create Listing Error:", error);
    return res.status(500).json({ success: false, message: "Ошибка сервера при создании объявления" });
  }
};

// =======================================================
// 4. Получение объявлений текущего пользователя ("Мои объявления")
// =======================================================
export const getMyListings = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      status,
      page = 1,
      limit = 20,
    } = req.query;

    let query = supabase
      .from("listings")
      .select(
        `
        *,
        listing_photos (id, url, is_main, display_order)
      `,
        { count: "exact" }
      )
      .eq("user_id", userId);

    if (status) {
      query = query.eq("status", status);
    }

    const from = (Number(page) - 1) * Number(limit);
    const to = from + Number(limit) - 1;

    query = query
      .order("created_at", { ascending: false })
      .range(from, to);

    const { data: listings, count, error } = await query;

    if (error) {
      console.error("Error fetching my listings:", error);
      return res
        .status(500)
        .json({ success: false, message: "Ошибка загрузки ваших объявлений" });
    }

    // Реальное кол-во добавлений в избранное по каждому объявлению —
    // раньше на фронте вместо этого ошибочно показывался views_count.
    const listingIds = (listings || []).map((l) => l.id);
    const favoritesCountMap = new Map();

    if (listingIds.length > 0) {
      const { data: favoriteRows, error: favoritesError } = await supabase
        .from("favorites")
        .select("listing_id")
        .in("listing_id", listingIds);

      if (favoritesError) {
        console.error("Error fetching favorites counts:", favoritesError);
      } else {
        for (const row of favoriteRows || []) {
          favoritesCountMap.set(
            row.listing_id,
            (favoritesCountMap.get(row.listing_id) || 0) + 1
          );
        }
      }
    }

    // Маскируем истёкшее продвижение в ответе и заодно фиксируем это в БД:
    // владелец регулярно открывает свои объявления, так что это удобное
    // место, чтобы "самоисцелять" запись без отдельной cron-задачи (см.
    // maskExpiredPromotion выше).
    const expiredIds = [];
    const maskedListings = (listings || []).map((l) => {
      const masked = maskExpiredListing(l);
      if (masked.promotion_status !== l.promotion_status || masked.is_urgent !== l.is_urgent) {
        expiredIds.push(l.id);
      }
      return masked;
    });

    if (expiredIds.length > 0) {
      Promise.all(
        maskedListings
          .filter((l) => expiredIds.includes(l.id))
          .map((l) =>
            supabase
              .from("listings")
              .update({ promotion_status: l.promotion_status, is_urgent: l.is_urgent })
              .eq("id", l.id)
          )
      ).catch((err) => console.error("Downgrade expired promotion error:", err));
    }

    const listingsWithFavorites = maskedListings.map((l) => ({
      ...l,
      favorites_count: favoritesCountMap.get(l.id) || 0,
    }));

    return res.json({
      success: true,
      data: listingsWithFavorites,
      pagination: {
        total: count || (listings ? listings.length : 0),
        page: Number(page),
        limit: Number(limit),
      },
    });
  } catch (error) {
    console.error("Get My Listings Error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Ошибка сервера при получении ваших объявлений" });
  }
};

// =======================================================
// 5. Редактирование объявления (PUT /api/listings/:id)
// =======================================================
export const updateListing = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    // 1. Поиск существующего объявления
    const { data: existingListing, error: fetchError } = await supabase
      .from("listings")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !existingListing) {
      return res.status(404).json({ success: false, message: "Объявление не найдено" });
    }

    // 2. Проверка прав: только владелец или admin
    if (existingListing.user_id !== userId && userRole !== "admin") {
      return res
        .status(403)
        .json({ success: false, message: "Вы не являетесь владельцем этого объявления" });
    }

    // 3. Валидация входящих данных через Zod
    const validationResult = updateListingSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        message: "Ошибка валидации данных",
        errors: validationResult.error.errors.map((e) => e.message),
      });
    }

    const data = validationResult.data;

    // Игнорируем/запрещаем изменение user_id — владелец остаётся неизменным
    delete data.userId;
    delete data.user_id;

    // Та же проверка владельца файла, что и при создании (см. createListing
    // выше) — без неё в photos при обновлении можно было бы подставить чужое
    // фото в обход водяного знака и подготовить IDOR на удаление файла.
    // Admin исключён — модерация может редактировать чужое объявление, и
    // фото в нём по определению загружены не им.
    if (
      userRole !== "admin" &&
      data.photos !== undefined &&
      !(await verifyAllOwnedBy(data.photos, userId))
    ) {
      return res.status(400).json({
        success: false,
        message: "Все фото должны быть загружены вами через форму загрузки объявления",
      });
    }

    // Формируем объект обновлений для базы данных (маппинг полей)
    const updates = {
      updated_at: new Date().toISOString(),
    };

    if (data.title !== undefined) updates.title = data.title;
    if (data.description !== undefined) updates.description = data.description;
    if (data.propertyType !== undefined) updates.property_type = data.propertyType;
    if (data.dealType !== undefined) updates.deal_type = data.dealType;
    if (data.rentPeriod !== undefined) updates.rent_period = data.rentPeriod;
    if (data.region !== undefined) updates.region = data.region;
    if (data.city !== undefined) updates.city = data.city;
    if (data.district !== undefined) updates.district = data.district;
    if (data.microdistrict !== undefined) updates.microdistrict = data.microdistrict;
    if (data.address !== undefined) updates.address = data.address;
    if (data.latitude !== undefined) updates.latitude = data.latitude;
    if (data.longitude !== undefined) updates.longitude = data.longitude;
    if (data.price !== undefined) updates.price = data.price;
    if (data.currency !== undefined) updates.currency = data.currency;
    if (data.area !== undefined) updates.area = data.area;
    if (data.rooms !== undefined) updates.rooms = data.rooms;
    if (data.floor !== undefined) updates.floor = data.floor;
    if (data.totalFloors !== undefined) updates.total_floors = data.totalFloors;
    if (data.isResort !== undefined) updates.is_resort = data.isResort;
    if (data.resortFilters !== undefined) updates.resort_filters = data.resortFilters;

    // ЖК квартиры хранится внутри features.residentialComplexId — как и при
    // создании, не доверяем сырому значению внутри присланного features (его
    // легко подделать в обход проверки), а валидируем отдельное поле
    // residentialComplexId и подставляем в features только проверенный ID.
    if (data.features !== undefined || data.residentialComplexId !== undefined) {
      const nextFeatures =
        data.features !== undefined
          ? sanitizeFeatures(data.features)
          : sanitizeFeatures(existingListing.features || {});

      if (data.residentialComplexId !== undefined) {
        if (data.residentialComplexId === null) {
          nextFeatures.residentialComplexId = null;
        } else {
          const { data: complexRow } = await supabase
            .from("residential_complexes")
            .select("id")
            .eq("id", data.residentialComplexId)
            .maybeSingle();

          if (!complexRow) {
            return res.status(400).json({
              success: false,
              message: "Указанный жилой комплекс не найден",
            });
          }

          nextFeatures.residentialComplexId = complexRow.id;
        }
      } else {
        // Поле явно не передавали — сохраняем прежнюю привязку к ЖК, а не
        // то, что клиент мог прислать внутри самого features.
        nextFeatures.residentialComplexId = existingListing.features?.residentialComplexId ?? null;
      }

      updates.features = nextFeatures;
    }

    // promotionStatus/isUrgent и сроки продвижения отражают ОПЛАЧЕННОЕ продвижение (см.
    // services/promotionsService.js grantPromotion) — владелец не может
    // выставлять их напрямую, иначе получал бы платный VIP/ТОП/Срочно
    // бесплатно через обычный PUT. Валидация переходов статусов для владельца
    // выполняется через canOwnerTransition (запрещены переход в/из moderation,
    // прямой переход draft -> active и любые недопустимые переходы).
    if (userRole !== "admin") {
      if (
        data.promotionStatus !== undefined ||
        data.isUrgent !== undefined ||
        data.promotionExpiresAt !== undefined ||
        data.urgentExpiresAt !== undefined ||
        data.promotion_expires_at !== undefined ||
        data.urgent_expires_at !== undefined
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Изменение VIP/ТОП/Срочно доступно только через оплату продвижения или тариф",
        });
      }

      if (data.status !== undefined && data.status !== existingListing.status) {
        const check = canOwnerTransition(existingListing.status, data.status);
        if (!check.allowed) {
          return res.status(403).json({ success: false, message: check.message });
        }
      }
    }

    // Возврат объявления в "active" (например, из "hidden"/"draft")
    // увеличивает число активных объявлений так же, как и создание нового
    // — проверяем тот же лимит тарифа, иначе его можно обойти, скрывая и
    // показывая объявления вместо реального удаления лишних.
    const isReactivating =
      userRole !== "admin" &&
      data.status === "active" &&
      existingListing.status !== "active";

    if (isReactivating) {
      const slot = await activateListingSlot(userId, id, req.user.account_type);
      if (!slot.granted) {
        return res.status(403).json({
          success: false,
          message: slot.message,
        });
      }
    }

    if (data.status !== undefined) updates.status = data.status;
    if (userRole === "admin") {
      if (data.promotionStatus !== undefined) updates.promotion_status = data.promotionStatus;
      if (data.isUrgent !== undefined) updates.is_urgent = data.isUrgent;
      if (data.promotionExpiresAt !== undefined) updates.promotion_expires_at = data.promotionExpiresAt;
      if (data.promotion_expires_at !== undefined) updates.promotion_expires_at = data.promotion_expires_at;
      if (data.urgentExpiresAt !== undefined) updates.urgent_expires_at = data.urgentExpiresAt;
      if (data.urgent_expires_at !== undefined) updates.urgent_expires_at = data.urgent_expires_at;

      // Если админ выставляет vip или top без указания срока, гарантируем 30 дней, чтобы не срабатывал сброс
      if (
        (updates.promotion_status === "vip" || updates.promotion_status === "top") &&
        updates.promotion_expires_at === undefined &&
        (!existingListing.promotion_expires_at ||
          new Date(existingListing.promotion_expires_at).getTime() <= Date.now())
      ) {
        updates.promotion_expires_at = new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString();
      }

      // Если админ выставляет срочно без указания срока, гарантируем 30 дней
      if (
        updates.is_urgent === true &&
        updates.urgent_expires_at === undefined &&
        (!existingListing.urgent_expires_at ||
          new Date(existingListing.urgent_expires_at).getTime() <= Date.now())
      ) {
        updates.urgent_expires_at = new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString();
      }
    } else {
      // Для не-admin гарантируем, что серверные колонки сроков продвижения не перезаписываются
      delete updates.promotion_expires_at;
      delete updates.urgent_expires_at;
    }

    // 4. Обновление записи в таблице listings
    const { data: updatedListing, error: updateError } = await supabase
      .from("listings")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (updateError || !updatedListing) {
      console.error("Listing Update Error:", updateError);
      if (isReactivating) {
        await refundTariffListing(userId, `update_fail_${id}_${Date.now()}`);
      }
      return res.status(500).json({ success: false, message: "Ошибка обновления объявления" });
    }

    // Та же повторная проверка после записи, что и в createListing — сужает
    // окно гонки при параллельной реактивации нескольких объявлений сразу.
    if (isReactivating) {
      const raceCheck = await activateListingSlot(userId, id, req.user.account_type);
      if (!raceCheck.granted) {
        console.warn(
          "Update Listing: active listings limit race detected, reverting status",
          updatedListing.id
        );

        await supabase
          .from("listings")
          .update({ status: existingListing.status })
          .eq("id", id);

        await refundTariffListing(userId, `reactivate_race_${id}_${Date.now()}`);

        return res.status(403).json({
          success: false,
          message: raceCheck.message,
        });
      }
    }

    // 5. Если переданы фотографии — обновим в таблице listing_photos
    if (data.photos && Array.isArray(data.photos)) {
      await supabase.from("listing_photos").delete().eq("listing_id", id);

      if (data.photos.length > 0) {
        const photosData = data.photos.map((url, idx) => ({
          listing_id: id,
          url,
          is_main: idx === 0,
          display_order: idx,
        }));
        await supabase.from("listing_photos").insert(photosData);
      }

      await supabase.from("listings").update({ photos_count: data.photos.length }).eq("id", id);
      if (updatedListing) {
        updatedListing.photos_count = data.photos.length;
      }
    }

    return res.json({
      success: true,
      message: "Объявление успешно обновлено",
      data: updatedListing,
    });
  } catch (error) {
    console.error("Update Listing Error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Ошибка сервера при обновлении объявления" });
  }
};

// =======================================================
// 6. Удаление объявления (DELETE /api/listings/:id)
// =======================================================
export const deleteListing = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    // 1. Поиск существующего объявления с вложенными фото
    const { data: existingListing, error: fetchError } = await supabase
      .from("listings")
      .select("*, listing_photos(*)")
      .eq("id", id)
      .single();

    if (fetchError || !existingListing) {
      return res.status(404).json({ success: false, message: "Объявление не найдено" });
    }

    // 2. Проверка прав: только владелец или admin
    if (existingListing.user_id !== userId && userRole !== "admin") {
      return res
        .status(403)
        .json({ success: false, message: "Вы не являетесь владельцем этого объявления" });
    }

    // 3. Удаление ассоциированных фотографий из Supabase Storage
    if (existingListing.listing_photos && existingListing.listing_photos.length > 0) {
      for (const photo of existingListing.listing_photos) {
        if (photo.url) {
          await removeImageFromStorage(photo.url);
        }
      }
    }

    // 4. Удаление объявления из базы данных (каскадно удалит строки в listing_photos)
    const { error: deleteError } = await supabase
      .from("listings")
      .delete()
      .eq("id", id);

    if (deleteError) {
      console.error("Listing Delete Error:", deleteError);
      return res.status(500).json({ success: false, message: "Ошибка удаления объявления" });
    }

    // Если удалённое объявление было активным и не истёкшим — освобождаем слот в тарифе
    const isUnexpiredActive =
      existingListing.status === "active" &&
      (!existingListing.expires_at || new Date(existingListing.expires_at).getTime() > Date.now());

    if (isUnexpiredActive) {
      await refundTariffListing(existingListing.user_id, `delete_${id}_${Date.now()}`);
    }

    return res.json({
      success: true,
      message: "Объявление успешно удалено",
    });
  } catch (error) {
    console.error("Delete Listing Error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Ошибка сервера при удалении объявления" });
  }
};

// =======================================================
// 7. Бесплатное поднятие в VIP/ТОП за счёт лимита тарифа
//    (POST /api/listings/:id/promote-with-tariff)
//
// Если у пользователя есть активный тариф (дефолтный или индивидуальный) с
// доступным лимитом VIP/TOP-поднятий — списывает одно поднятие и сразу
// применяет продвижение к объявлению, без оплаты через O!Dengi. Если
// лимита нет (тариф не активен/лимит исчерпан) — возвращает granted:false
// и фронтенд должен перейти к обычной платной покупке
// (POST /api/payments/promotion/create).
// =======================================================
export const promoteListingWithTariff = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = promoteWithTariffSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error.issues[0]?.message || "Некорректные данные запроса",
      });
    }

    const { serviceType, days } = result.data;

    const { data: listing, error: fetchError } = await supabase
      .from("listings")
      .select("id, user_id")
      .eq("id", id)
      .maybeSingle();

    if (fetchError || !listing) {
      return res.status(404).json({ success: false, message: "Объявление не найдено" });
    }

    if (listing.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: "Вы можете продвигать только свои объявления",
      });
    }

    const consumption = await consumeTariffBoost(userId, serviceType);

    if (!consumption.granted) {
      return res.json({ success: true, data: { granted: false, reason: consumption.reason } });
    }

    const applied = await grantPromotion({ listingId: id, serviceType, days });

    if (!applied) {
      return res.status(500).json({
        success: false,
        message: "Не удалось применить продвижение",
      });
    }

    return res.json({
      success: true,
      data: { granted: true, remaining: consumption.remaining },
    });
  } catch (error) {
    console.error("Promote Listing With Tariff Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при применении тарифа",
    });
  }
};

// =======================================================
// 8. Продление объявления на 40 дней (POST /api/listings/:id/renew)
// =======================================================
export const renewListing = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    // 1. Поиск объявления
    const { data: listing, error } = await supabase
      .from("listings")
      .select("id, user_id, status, expires_at")
      .eq("id", id)
      .single();

    if (error || !listing) {
      return res.status(404).json({ success: false, message: "Объявление не найдено" });
    }

    // 2. Защита от IDOR
    if (listing.user_id !== userId && userRole !== "admin") {
      return res.status(403).json({ success: false, message: "Вы не являетесь владельцем этого объявления" });
    }

    // 3. Валидация возможности продления для не-admin
    if (userRole !== "admin") {
      if (listing.status === "moderation") {
        return res.status(403).json({
          success: false,
          message: "Нельзя продлить объявление, находящееся на модерации",
        });
      }

      if (listing.status === "draft") {
        return res.status(403).json({
          success: false,
          message: "Нельзя продлить неоплаченный черновик. Завершите оплату публикации",
        });
      }

      const transitionCheck = canOwnerTransition(listing.status, "active");
      if (!transitionCheck.allowed) {
        return res.status(403).json({
          success: false,
          message: transitionCheck.message,
        });
      }

      if (listing.status !== "active" && listing.status !== "hidden" && listing.status !== "expired") {
        return res.status(403).json({
          success: false,
          message: `Переход из статуса "${listing.status}" в "active" запрещён`,
        });
      }
    }

    // 4. Проверка лимитов тарифа (если объявление сейчас не активно)
    const isCurrentlyActive =
      listing.status === "active" &&
      listing.expires_at &&
      new Date(listing.expires_at) > new Date();

    if (!isCurrentlyActive) {
      const slot = await activateListingSlot(userId, id, req.user.account_type);
      if (!slot.granted) {
        return res.status(403).json({
          success: false,
          message: slot.message,
        });
      }
    }

    // 4. Продление на 40 дней (дата считается исключительно на сервере)
    const newExpiresAt = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000).toISOString();
    const { data: updated, error: updateError } = await supabase
      .from("listings")
      .update({
        status: "active",
        expires_at: newExpiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select(`
        *,
        listing_photos (id, url, is_main, display_order)
      `)
      .single();

    if (updateError) {
      if (!isCurrentlyActive) {
        await refundTariffListing(userId, `renew_fail_${id}_${Date.now()}`);
      }
      return res.status(500).json({ success: false, message: "Не удалось продлить объявление" });
    }

    return res.json({
      success: true,
      message: "Объявление успешно продлено на 40 дней",
      data: updated,
    });
  } catch (err) {
    console.error("Renew listing error:", err);
    return res.status(500).json({ success: false, message: "Ошибка сервера при продлении объявления" });
  }
};



