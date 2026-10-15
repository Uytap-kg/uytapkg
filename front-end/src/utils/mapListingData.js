const REGION_NAMES = {
  BISHKEK: "Бишкек",
  bishkek: "Бишкек",
  CHUY: "Чуйская область",
  chuy: "Чуйская область",
  CHUI: "Чуйская область",
  chui: "Чуйская область",
  OSH_REGION: "Ошская область",
  osh_region: "Ошская область",
  OSH: "Ошская область",
  osh: "Ошская область",
  OSH_CITY: "Ош",
  osh_city: "Ош",
  oshCity: "Ош",
  JALAL_ABAD: "Джалал-Абадская область",
  jalal_abad: "Джалал-Абадская область",
  JALALABAD: "Джалал-Абадская область",
  jalalabad: "Джалал-Абадская область",
  jalalAbad: "Джалал-Абадская область",
  ISSYK_KUL: "Иссык-Кульская область",
  issyk_kul: "Иссык-Кульская область",
  ISSYKKUL: "Иссык-Кульская область",
  issykkul: "Иссык-Кульская область",
  issykKul: "Иссык-Кульская область",
  NARYN: "Нарынская область",
  naryn: "Нарынская область",
  TALAS: "Таласская область",
  talas: "Таласская область",
  BATKEN: "Баткенская область",
  batken: "Баткенская область",
  TURKEY: "Турция",
  turkey: "Турция",
};

export function formatRegion(region) {
  if (!region) return "";
  const str = String(region).trim();
  if (REGION_NAMES[str]) return REGION_NAMES[str];
  const upper = str.toUpperCase();
  if (REGION_NAMES[upper]) return REGION_NAMES[upper];
  const underscored = upper.replace(/[-\s]+/g, "_");
  if (REGION_NAMES[underscored]) return REGION_NAMES[underscored];
  return str;
}

export function formatListingLocation(item) {
  if (!item) return "Кыргызстан";

  const rawRegion = String(item.region || item.rawRegion || "").trim();
  const regionName = formatRegion(rawRegion);
  const rawCity = String(item.city || item.settlement || "").trim();
  let rawDistrict = String(item.district || "").trim();

  // Игнорируем район, если он дублирует регион или город
  if (
    rawDistrict &&
    (rawDistrict.toLowerCase() === rawRegion.toLowerCase() ||
      formatRegion(rawDistrict) === regionName ||
      rawDistrict.toLowerCase() === rawCity.toLowerCase() ||
      rawDistrict.toLowerCase().includes("issyk_kul") ||
      rawDistrict.toLowerCase() === "issyk-kul")
  ) {
    rawDistrict = "";
  }

  const upperRegion = rawRegion.toUpperCase();
  const lowerCity = rawCity.toLowerCase();

  // 1. Бишкек: если rawRegion.toUpperCase() === 'BISHKEK' или rawCity.toLowerCase() === 'бишкек'
  const isBishkek =
    upperRegion === "BISHKEK" ||
    lowerCity === "бишкек" ||
    (regionName && regionName.toLowerCase() === "бишкек");

  if (isBishkek) {
    return rawDistrict && rawDistrict.toLowerCase() !== "бишкек"
      ? `Бишкек, ${rawDistrict}`
      : "Бишкек";
  }

  // 2. Ош (город): если rawRegion.toUpperCase() === 'OSH_CITY' или (rawCity.toLowerCase() === 'ош' и не OSH_REGION)
  const isOshRegion =
    upperRegion === "OSH_REGION" ||
    rawRegion.toLowerCase() === "osh_region" ||
    regionName === "Ошская область";

  const isOshCity =
    upperRegion === "OSH_CITY" ||
    rawRegion.toLowerCase() === "osh_city" ||
    (lowerCity === "ош" && !isOshRegion);

  if (isOshCity) {
    return rawDistrict && rawDistrict.toLowerCase() !== "ош"
      ? `Ош, ${rawDistrict}`
      : "Ош";
  }

  // 3. Город/село + область
  if (rawCity && regionName && regionName !== "Кыргызстан") {
    // Проверить, что название области уже не содержит имя города (чтобы не дублировать)
    if (!regionName.toLowerCase().includes(lowerCity)) {
      return `${rawCity}, ${regionName}`;
    }
    return rawCity;
  }

  // 4. Только город: если области нет
  if (rawCity) {
    return rawCity;
  }

  // 5. Только область: если город не указан
  if (regionName && regionName !== "Кыргызстан") {
    if (rawDistrict) {
      return `${rawDistrict}, ${regionName}`;
    }
    return regionName;
  }

  // 6. Только район: если нет города и области
  if (rawDistrict) {
    return rawDistrict;
  }

  // 7. Fallback: адрес или "Кыргызстан"
  if (item.address && String(item.address).trim()) {
    return String(item.address).trim();
  }

  return "Кыргызстан";
}

export function mapListingData(item) {
  const propertyTypeMapping = {
    apartment: "Квартира",
    house: "Дом",
    cottage: "Коттедж",
    land: "Участок",
    commercial: "Коммерция",
    room: "Комнаты",
    garage: "Паркинг/гараж",
    parking: "Паркинг/гараж",
  };

  const mainPhoto = item.listing_photos?.find((p) => p.is_main)?.url 
    || item.listing_photos?.[0]?.url 
    || "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?q=80&w=400";

  const formattedLocation = formatListingLocation(item);

  const expiresAt = item.expires_at || null;
  const isExpired = item.status === "expired" || (expiresAt && new Date(expiresAt) <= new Date());
  const daysLeft = expiresAt && !isExpired
    ? Math.max(0, Math.ceil((new Date(expiresAt) - new Date()) / (1000 * 60 * 60 * 24)))
    : 0;

  const rawType = item.property_type || item.propertyType || "";
  const resolvedType =
    propertyTypeMapping[rawType] ||
    (typeof rawType === "string" && rawType.trim() ? rawType.trim() : "") ||
    "Другое";

  const promoStatus = item.promotion_status || item.promotionStatus || "regular";
  const isUrgent = Boolean(item.is_urgent ?? item.isUrgent);

  return {
    // Характеристики категории (серия, этаж, стены и т.д.) — берём из
    // features первыми, чтобы канонические поля ниже всегда были главнее
    // и не могли быть случайно затёрты значениями формы (см. add-product).
    ...(item.features || {}),

    id: item.id,
    title: item.title || "Без названия",
    description: item.description || "",
    type: resolvedType,
    dealType: item.deal_type === "sale" ? "Продажа" : "Сниму в аренду",
    status: promoStatus === "vip"
      ? "vip"
      : (isUrgent
          ? "urgent"
          : (promoStatus === "top" ? "top" : "regular")),
    promotion_status: promoStatus,
    promotionStatus: promoStatus,
    is_urgent: isUrgent,
    isUrgent: isUrgent,
    isVip: promoStatus === "vip" || Boolean(item.isVip ?? item.is_vip),
    isTop: promoStatus === "top" || Boolean(item.isTop ?? item.is_top),
    location: formattedLocation,
    city: item.city || (item.region === "BISHKEK" || item.region === "bishkek" ? "Бишкек" : ""),
    region: formatRegion(item.region),
    district: item.district,
    address: item.address || "",
    price: `${item.price?.toLocaleString() || 0} ${item.currency === "USD" ? "$" : "сом"}`,
    rawPrice: item.price || 0,
    rawArea: item.area || 0,
    image: mainPhoto,
    likes: 0,
    rooms: item.rooms,
    area: item.area ? `${item.area} м²` : "",
    expiresAt,
    daysLeft,
    isExpired,
    raw: item,
  };
}

export function mapListingDetail(item) {
  const propertyTypeMapping = {
    apartment: "Квартира",
    house: "Дом",
    cottage: "Коттедж",
    land: "Участок",
    commercial: "Коммерция",
    room: "Комната",
    garage: "Паркинг/гараж",
    parking: "Паркинг/гараж",
  };

  const dealTypeMapping = {
    sale: "Продажа",
    rent: "Аренда",
  };

  let images = ["https://images.unsplash.com/photo-1564013799919-ab600027ffc6?q=80&w=800"];
  if (item.listing_photos && item.listing_photos.length > 0) {
    const sorted = [...item.listing_photos].sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
    images = sorted.map((p) => p.url);
  }

  const dbUser = item.users || {};
  const dbProfile = dbUser.user_profiles || {};

  const owner = {
    id: dbUser.id || "",
    name: (dbProfile.first_name || dbProfile.last_name)
      ? `${dbProfile.first_name || ""} ${dbProfile.last_name || ""}`.trim()
      : dbUser.email || "Пользователь",
    role: dbUser.account_type === "agency" ? "Агентство" : (dbUser.account_type === "realtor" ? "Риелтор" : "Владелец"),
    avatar: dbProfile.avatar_url || "https://i.pravatar.cc/150?img=12",
    phone: dbUser?.phone || dbProfile?.phone || dbProfile?.phone_number || "",
  };

  const features = item.features || {};
  const resortFilters = item.resort_filters || {};

  // Расстояние до пляжа: у новых объявлений хранится в resort_filters
  // (корректно сохраняется после исправления формы добавления объявления),
  // у старых объявлений (созданных до исправления) значение осело только
  // в features.beachDistance — проверяем оба источника, чтобы не терять данные.
  const beachDistance =
    resortFilters.beachDistanceFrom ??
    resortFilters.beachDistanceTo ??
    features.beachDistance ??
    features.beachDistanceFrom ??
    null;

  const dateOptions = { day: "numeric", month: "long", year: "numeric" };
  const createdAtFormatted = item.created_at
    ? new Date(item.created_at).toLocaleDateString("ru-RU", dateOptions)
    : "Не указана";

  const formattedLocation = formatListingLocation(item);
  const city = item.city || (item.region === "BISHKEK" || item.region === "bishkek" ? "Бишкек" : "");

  const expiresAt = item.expires_at || null;
  const isExpired = item.status === "expired" || (expiresAt && new Date(expiresAt) <= new Date());
  const daysLeft = expiresAt && !isExpired
    ? Math.max(0, Math.ceil((new Date(expiresAt) - new Date()) / (1000 * 60 * 60 * 24)))
    : 0;

  return {
    id: item.id,
    title: item.title || "Без названия",
    price: `${item.price?.toLocaleString() || 0} ${item.currency === "USD" ? "$" : "сом"}`,
    type: propertyTypeMapping[item.property_type] || "Другое",
    dealType: dealTypeMapping[item.deal_type] || "Другое",
    country: item.country || "Кыргызстан",
    region: formatRegion(item.region),
    rawRegion: item.region,
    city: city || "",
    district: item.district || "",
    settlement: item.settlement || "",
    location: formattedLocation,
    address: item.address || "",
    latitude: item.latitude != null ? item.latitude : null,
    longitude: item.longitude != null ? item.longitude : null,
    area: item.area ? `${item.area} м²` : "",
    rooms: item.rooms || 0,
    floors: item.total_floors || item.floor || 0,
    year: features.year || null,
    beachDistance,
    status: item.is_urgent
      ? "urgent"
      : item.promotion_status === "vip"
        ? "vip"
        : item.promotion_status === "top"
          ? "top"
          : "regular",
    promotion_status: item.promotion_status || "regular",
    promotionStatus: item.promotion_status || "regular",
    is_urgent: Boolean(item.is_urgent),
    isUrgent: Boolean(item.is_urgent),
    isVip: item.promotion_status === "vip" || Boolean(item.is_vip),
    isTop: item.promotion_status === "top" || Boolean(item.is_top),
    // Реальный статус публикации (active/draft/hidden/moderation) — не
    // путать с полем status выше, которое означает тип продвижения
    // (vip/urgent). Нужен, чтобы страница объявления честно показывала
    // "Черновик"/"На модерации"/"Скрыто" вместо всегда "Опубликовано" —
    // см. front-end/src/app/profile/ads/[id]/page.jsx.
    publicationStatus: isExpired ? "expired" : (item.status || "active"),
    expiresAt,
    daysLeft,
    isExpired,
    description: item.description || "Описание отсутствует.",
    images,
    owner,
    createdAt: createdAtFormatted,
    rawFeatures: features,
    raw: item,
  };
}
