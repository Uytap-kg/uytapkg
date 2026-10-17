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
  "amenities",
  "communications",
  "technicalParameters",
]);

export const ARRAY_FILTER_KEYS = new Set([
  "amenities",
  "communications",
  "technicalParameters",
]);

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
