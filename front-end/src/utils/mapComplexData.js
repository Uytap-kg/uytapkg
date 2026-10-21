export function mapComplexData(item) {
  if (!item) return null;

  const developerName = item.developers?.company_name || "Застройщик не указан";

  const developerLogo =
    item.developers?.avatarUrl ||
    item.developers?.avatar_url ||
    item.developers?.logo_url ||
    item.avatarUrl ||
    "/assets/DeveloperImage.png";

  const features = item.features || {};

  let priceFrom = null;
  let priceTo = null;

  if (item.complex_layouts?.length) {
    const prices = item.complex_layouts
      .map((layout) => Number(layout.price))
      .filter((price) => Number.isFinite(price) && price > 0);

    if (prices.length) {
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);

      priceFrom = minPrice;
      priceTo = maxPrice;
    }
  }

  const address =
    item.address ||
    [item.city, item.region].filter(Boolean).join(", ") ||
    "Кыргызстан";

  const formatNumber = (value) => {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    const number = Number(value);

    if (Number.isFinite(number)) {
      return number.toLocaleString("ru-RU");
    }

    return String(value);
  };

  return {
    id: item.id,

    name: item.name || "Жилой комплекс",

    developer: developerName,

    developerId: item.developers?.user_id || item.developers?.id || null,

    logo: developerLogo,

    address,

    city: item.city || null,

    district: item.district || features.district || null,

    country: item.country || features.country || "kyrgyzstan",

    region: item.region || null,

    // В residential_complexes нет колонок latitude/longitude — координаты
    // хранятся внутри features (см. complexesController.js).
    latitude: item.latitude ?? features.latitude ?? null,

    longitude: item.longitude ?? features.longitude ?? null,

    description: item.description || "Описание жилого комплекса отсутствует.",

    housingClass: item.housing_class || "Класс не указан",

    completionStatus:
      item.completion_status === "completed"
        ? "Сдан"
        : item.completion_status === "building"
          ? "Строится"
          : item.completion_status || "Статус не указан",

    completionDate: item.completion_date || null,

    priceFrom,

    priceTo,

    image:
      item.cover_photo ||
      features.images?.[0] ||
      "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?q=80&w=800",

    images: features.images?.length
      ? features.images
      : item.cover_photo
        ? [item.cover_photo]
        : [],

    floors: features.floors ?? null,

    blocks: features.blocks ?? null,

    apartments: features.apartments ?? null,

    parking: features.parking ?? null,

    ceilingHeight: features.ceilingHeight ?? features.ceiling_height ?? null,

    construction: features.construction ?? features.constructionType ?? null,

    area: features.area ?? null,

    areaSotka: features.areaSotka ?? features.area_sotka ?? null,

    heating: features.heating ?? null,

    electricity: features.electricity ?? null,

    security: features.security ?? null,

    videoSurveillance:
      features.videoSurveillance ?? features.video_surveillance ?? null,

    documentsUrl: features.documentsUrl || features.documents_url || null,

    amenities: Array.isArray(features.amenities) ? features.amenities : [],

    layouts: Array.isArray(item.complex_layouts) ? item.complex_layouts : [],

    raw: item,

    formatNumber,
  };
}
