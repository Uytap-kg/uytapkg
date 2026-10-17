/**
 * Умный поиск: словарь допустимых значений и JSON-схема ответа модели.
 *
 * Single Source of Truth: регионы, города, типы объектов и типы сделок берутся
 * из backend/src/constants (те же данные отдаёт GET /api/constants). Этот модуль
 * используется И промптом (smartSearch.prompt.js), И валидацией ответа
 * (smartSearch.normalize.js), поэтому они не могут разойтись.
 */
import { REGIONS, LOCATIONS_BY_REGION, BISHKEK_DISTRICTS, OSH_CITY_DISTRICTS } from "../constants/locations.js";
import { PROPERTY_TYPES, UI_TO_DB_PROPERTY_TYPE, DEAL_TYPES } from "../constants/propertyTypes.js";

// Порядок и состав полей ответа AI-поиска (контракт с фронтендом, НЕ менять).
export const FILTER_KEYS = [
  "country",
  "region",
  "city",
  "district",
  "propertyType",
  "dealType",
  "rooms",
  "minPrice",
  "maxPrice",
  "currency",
  "minArea",
  "maxArea",
  "searchQuery",
  "beachDistanceFrom",
  "beachDistanceTo",
  "urgentOnly",
];

// Страны: отдельной константы в constants/ нет. Страна однозначно следует из региона
// (TURKEY -> turkey, остальные -> kyrgyzstan), см. countryForRegion().
export const COUNTRIES = ["kyrgyzstan", "turkey"];
export const TURKEY_REGION = "TURKEY";

export function countryForRegion(region) {
  return region === TURKEY_REGION ? "turkey" : "kyrgyzstan";
}

// Регион в ответе AI-поиска: «OSH» объединяет OSH_CITY и OSH_REGION. Это безопасно, т.к.
// фильтр листингов сравнивает регион через ilike %value% (listingsController.applyListingFilters).
const OSH_ALIAS = "OSH";
export const REGION_VALUES = [
  ...new Set(Object.keys(REGIONS).map((key) => (key.startsWith(`${OSH_ALIAS}_`) ? OSH_ALIAS : key))),
];
// Значения, которые принимаем при валидации (включая "сырые" ключи OSH_CITY / OSH_REGION).
export const ACCEPTED_REGION_VALUES = [...new Set([...REGION_VALUES, ...Object.keys(REGIONS)])];

// Типы объектов в терминах UI (cottage/parking). "garage" — это DB-имя типа "parking".
export const PROPERTY_TYPE_VALUES = Object.keys(UI_TO_DB_PROPERTY_TYPE).filter(
  (key) => key !== PROPERTY_TYPES.GARAGE,
);
export const DEAL_TYPE_VALUES = Object.values(DEAL_TYPES);
export const CURRENCIES = ["USD", "KGS"];
export const ROOMS_VALUES = [1, 2, 3, "4+"];

// Разумные верхние пределы числовых полей (защита от мусора модели).
export const LIMITS = {
  price: 1_000_000_000,
  area: 100_000, // м² либо сотки (для land)
  beachDistance: 100_000, // метры
  searchQueryLength: 100,
  locationNameLength: 50,
};

// Справочник локаций, сгруппированный по значениям REGION_VALUES (OSH_* склеены в OSH).
export const LOCATIONS_BY_SMART_REGION = (() => {
  const grouped = {};
  for (const [key, list] of Object.entries(LOCATIONS_BY_REGION)) {
    const region = key.startsWith(`${OSH_ALIAS}_`) ? OSH_ALIAS : key;
    grouped[region] = [...new Set([...(grouped[region] || []), ...list])];
  }
  return grouped;
})();

// Названия городов-«столиц» регионов: Бишкек (регион = город) и Ош (из «Ош (город)»).
const capitalCityNames = [REGIONS.BISHKEK, REGIONS.OSH_CITY]
  .filter(Boolean)
  .map((name) => name.replace(/\s*\(.*\)\s*$/, "").trim());

export const KNOWN_CITIES = [...new Set([...Object.values(LOCATIONS_BY_REGION).flat(), ...capitalCityNames])];

// Канонические названия районов (для приведения регистра: «центр» -> «Центр»).
export const KNOWN_DISTRICTS = [...new Set([...BISHKEK_DISTRICTS, ...OSH_CITY_DISTRICTS])];

/**
 * JSON-схема для structured outputs (output_config.format).
 * Ограничения API (docs.anthropic.com/.../structured-outputs): все поля required,
 * additionalProperties:false, minimum/maximum не поддерживаются (их проверяет Zod в normalize).
 */
export function buildOutputSchema() {
  const nullableString = { type: ["string", "null"] };
  const nullableNumber = { type: ["number", "null"] };
  return {
    type: "object",
    additionalProperties: false,
    required: [...FILTER_KEYS],
    properties: {
      country: { enum: [...COUNTRIES, null] },
      region: { enum: [...REGION_VALUES, null] },
      city: nullableString,
      district: nullableString,
      propertyType: { enum: [...PROPERTY_TYPE_VALUES, null] },
      dealType: { enum: [...DEAL_TYPE_VALUES, null] },
      rooms: { enum: [...ROOMS_VALUES, null] },
      minPrice: nullableNumber,
      maxPrice: nullableNumber,
      currency: { enum: [...CURRENCIES, null] },
      minArea: nullableNumber,
      maxArea: nullableNumber,
      searchQuery: nullableString,
      beachDistanceFrom: nullableNumber,
      beachDistanceTo: nullableNumber,
      urgentOnly: { type: ["boolean", "null"] },
    },
  };
}
