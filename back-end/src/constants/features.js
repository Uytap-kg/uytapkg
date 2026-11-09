/**
 * Белый список ключей характеристик (features) недвижимости.
 * Синхронизирован с фронтендом (all-products/page.jsx и StepCategory.jsx).
 */

export const FEATURE_KEYS = new Set([
  "series",
  "floor",
  "condition",
  "walls",
  "heating",
  "documents",
  "furniture",
  "offerType",
  "residentialComplex",
  "houseType",
  "floors",
  "sewerage",
  "water",
  "electricity",
  "purpose",
  "fence",
  "location",
  "terrain",
  "roomsInApartment",
  "privateBathroom",
  "roomLocation",
  "premisesType",
  "firstLine",
  "separateEntrance",
  "rentalBusiness",
  "ceilingHeight",
  "parkingType",
  "material",
  "security",
  "gates",
  "inspectionPit",
  "basement",
  "truckAccess",
  "gateType",
  "rentalPeriod",
  "pets",
  "amenities",
  "communications",
  "technicalParameters",
]);

export const ARRAY_FILTER_KEYS = new Set([
  "amenities",
  "communications",
  "technicalParameters",
]);

// Срок аренды хранится в колонке rent_period, а фильтры и умный поиск передают
// его названием в rentalPeriod. Коды из rent_period тоже принимаются как есть.
export const RENTAL_PERIOD_TO_RENT_CODES = {
  "По часам": ["hourly"],
  "Почасово": ["hourly"],
  "Посуточно": ["daily"],
  "Помесячно": ["monthly"],
  "На долгий срок": ["long_term"],
  "От 1 месяца": ["monthly"],
  "От 3 месяцев": ["monthly", "long_term"],
  "От 6 месяцев": ["monthly", "long_term"],
  hourly: ["hourly"],
  daily: ["daily"],
  weekly: ["weekly"],
  monthly: ["monthly"],
  long_term: ["long_term"],
};

/**
 * Валидация и санитизация значения характеристики.
 * Максимальная длина строки: 100 символов.
 * Отсекает опасные спецсимволы, способные сломать синтаксис PostgREST.
 */
export function sanitizeFeatureValue(value, maxLength = 100) {
  if (value === undefined || value === null) return "";
  const str = String(value).slice(0, maxLength).trim();
  // Разрешаем буквы, цифры, дефис, пробел, слэш, точку, плюс (например "10+", "106", "1-комн")
  return str.replace(/[^\p{L}\p{N}\s\-/.+]/gu, " ").replace(/\s+/g, " ").trim();
}
