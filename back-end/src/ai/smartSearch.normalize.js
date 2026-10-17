/**
 * Умный поиск: постобработка и валидация ответа модели.
 *
 * Единственная точка входа — normalizeSmartSearchResult(raw, { query }). Ответ модели считается
 * недоверенным: неизвестные ключи отбрасываются, каждое поле валидируется Zod-схемой с `.catch(null)`
 * (одно плохое поле не портит остальные), справочные значения сверяются с backend constants.
 * Функция чистая: без сети, без побочных эффектов.
 */
import { z } from "zod";
import { sanitizeSearchQuery } from "../controllers/listingsController.js";
import {
  FILTER_KEYS,
  COUNTRIES,
  TURKEY_REGION,
  ACCEPTED_REGION_VALUES,
  PROPERTY_TYPE_VALUES,
  DEAL_TYPE_VALUES,
  CURRENCIES,
  ROOMS_VALUES,
  LIMITS,
  KNOWN_CITIES,
  KNOWN_DISTRICTS,
  countryForRegion,
} from "./smartSearch.schema.js";

/** Все поля = null (формат «нет фильтров»). */
export const emptySmartSearchFilters = () => Object.fromEntries(FILTER_KEYS.map((key) => [key, null]));

/* ------------------------------ Zod-схема полей ------------------------------ */

const enumField = (values, prepare) =>
  z
    .preprocess((v) => (typeof v === "string" ? prepare(v.trim()) : v), z.enum(values))
    .nullable()
    .catch(null);

const numberField = (max) =>
  z
    .preprocess(
      (v) => (typeof v === "string" && /^\d+([.,]\d+)?$/.test(v.trim()) ? Number(v.trim().replace(",", ".")) : v),
      // positive(): 0 бессмыслен для цены/площади/расстояния и опасен как maxPrice (пустая выдача).
      z.number().finite().positive().max(max),
    )
    .nullable()
    .catch(null);

const textField = (maxLength) =>
  z
    .preprocess((v) => (typeof v === "string" ? sanitizeSearchQuery(v, maxLength) || null : v), z.string().nullable())
    .catch(null);

// Комнаты: 1|2|3|"4+"; целое >= 4 -> "4+"; всё остальное (диапазон «2-3», 0, текст) -> null.
const roomsField = z
  .preprocess((v) => {
    if (typeof v === "string" && v.trim() === "4+") return "4+";
    const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : NaN;
    if (Number.isInteger(n)) return n >= 4 ? "4+" : n;
    return v;
  }, z.custom((v) => ROOMS_VALUES.includes(v)))
  .nullable()
  .catch(null);

const smartSearchSchema = z.object({
  country: enumField(COUNTRIES, (s) => s.toLowerCase()),
  region: enumField(ACCEPTED_REGION_VALUES, (s) => s.toUpperCase()),
  city: textField(LIMITS.locationNameLength),
  district: textField(LIMITS.locationNameLength),
  propertyType: enumField(PROPERTY_TYPE_VALUES, (s) => s.toLowerCase()),
  dealType: enumField(DEAL_TYPE_VALUES, (s) => s.toLowerCase()),
  rooms: roomsField,
  minPrice: numberField(LIMITS.price),
  maxPrice: numberField(LIMITS.price),
  currency: enumField(CURRENCIES, (s) => s.toUpperCase()),
  minArea: numberField(LIMITS.area),
  maxArea: numberField(LIMITS.area),
  searchQuery: textField(LIMITS.searchQueryLength),
  beachDistanceFrom: numberField(LIMITS.beachDistance),
  beachDistanceTo: numberField(LIMITS.beachDistance),
  // Только true осмысленно; false/любое другое = «не указано» (единый формат null).
  urgentOnly: z
    .preprocess((v) => (v === true ? true : null), z.literal(true).nullable())
    .catch(null),
});

/* --------------------------- Сверка с текстом запроса --------------------------- */

// Сворачиваем регистр и кыргызские буквы, чтобы «Көк-Жар» == «кок жар», «Түнгүчтөн» ~ «тунгуч».
const FOLD_MAP = { ө: "о", ү: "у", ң: "н", ё: "е", ъ: "", ь: "" };
const foldText = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[өүңёъь]/g, (ch) => FOLD_MAP[ch])
    .replace(/[-–—_]+/g, " ")
    .replace(/(^|\s)дж/g, "$1ж")
    .replace(/ия(?=\s|$)/g, "я")
    .replace(/\s+/g, " ")
    .trim();

// Основа названия: без последней гласной (Чолпон-Ата -> «чолпон ат», Бостери -> «бостер»),
// чтобы находить склонения и кыргызские падежи («Чолпон-Атадан», «Бостерях»).
const nameStem = (name) => foldText(name).replace(/[аяыиеоуэюaeiou]$/, "");

const queryMentions = (foldedQuery, name) => {
  const stem = nameStem(name);
  return stem.length >= 3 && foldedQuery.includes(stem);
};

const canonicalFrom = (list, value) => list.find((item) => foldText(item) === foldText(value)) ?? null;

/* ----------------------- Защита от ложной цены (единицы площади) ----------------------- */

// Единицы площади: м2, м², кв, кв.м, квадрат(ов/ных), чарчы, сот(ка/ок/ых). Слово «кв» должно быть
// целым — «квартира» не совпадает (lookahead на букву).
export const AREA_UNIT = "(?:м\\.?\\s?кв|м2|м²|кв|квадрат\\p{L}*|чарчы\\p{L}*|сот\\p{L}*)(?![\\p{L}\\d])";
const NUMBER_BEFORE_AREA_UNIT = new RegExp(`(?<![\\p{L}\\d.,])(\\d+(?:[.,]\\d+)?)\\s*${AREA_UNIT}`, "giu");

/**
 * Принцип: тип числа определяется ЕДИНИЦЕЙ рядом с ним, а не размером. Если число, стоящее в тексте
 * прямо перед единицей площади («50 квадратов», «80 м2», «6 соток»), оказалось в цене — это ошибка
 * модели, цена отбрасывается. Единственная проверка; цифры словами («пятьдесят квадратов») —
 * зона промпта. Известное ограничение: настоящая цена, численно равная площади, тоже будет отброшена.
 */
export function dropPriceMatchingAreaNumber(filters, query) {
  if (!query || (filters.minPrice === null && filters.maxPrice === null)) return filters;
  const areaNumbers = new Set(
    [...String(query).matchAll(NUMBER_BEFORE_AREA_UNIT)].map((m) => Number(m[1].replace(",", "."))),
  );
  if (areaNumbers.size === 0) return filters;
  return {
    ...filters,
    minPrice: areaNumbers.has(filters.minPrice) ? null : filters.minPrice,
    maxPrice: areaNumbers.has(filters.maxPrice) ? null : filters.maxPrice,
  };
}

/* ------------------------------- Главная функция ------------------------------- */

// min > max при обоих заданных значениях — перепутанный порядок («от 100 до 50»): меняем местами.
// Противоречия вида «до 50 и от 100» должен обнулять промпт; значения вне диапазона уже отброшены Zod.
const orderRange = (min, max) => (min !== null && max !== null && min > max ? [max, min] : [min, max]);

/**
 * @param {unknown} raw   — недоверенный ответ модели (или локального парсера)
 * @param {{query?: string}} [options] — исходный текст запроса для сверок (город, цена vs площадь)
 * @returns {object|null} ровно 16 полей схемы либо null, если raw — не объект
 */
export function normalizeSmartSearchResult(raw, { query } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  let f = smartSearchSchema.parse(raw); // не бросает: у каждого поля есть .catch(null)
  const foldedQuery = typeof query === "string" ? foldText(query) : null;

  // Регион/страна: страна следует из региона; «страна turkey без региона» -> TURKEY.
  if (f.region) f.country = countryForRegion(f.region);
  else if (f.country === "turkey") f.region = TURKEY_REGION;

  // Город: если модель ошибочно записала название области/страны («Иссык-Куль», «Турция») в city —
  // переносим в region и сбрасываем city в null.
  if (f.city) {
    const foldedCity = foldText(f.city);
    if (
      foldedCity === "иссык кул" ||
      foldedCity === "ысык кол" ||
      foldedCity.includes("иссык кульск") ||
      foldedCity.includes("ысык колск")
    ) {
      if (!f.region) f.region = "ISSYK_KUL";
      f.country = "kyrgyzstan";
      f.city = null;
    } else if (foldedCity === "турция" || foldedCity === "туркя" || foldedCity === "turkey") {
      f.region = TURKEY_REGION;
      f.country = "turkey";
      f.city = null;
    } else if (foldedCity.includes("област")) {
      f.city = null;
    }
  }

  // Город: справочное значение (с приведением к написанию из констант) либо названное в тексте.
  if (f.city) {
    const canonical = canonicalFrom(KNOWN_CITIES, f.city);
    if (canonical) f.city = canonical;
    else if (foldedQuery !== null && !queryMentions(foldedQuery, f.city)) f.city = null;
  }

  // Район: то же правило (канонический регистр из справочника, иначе должен быть назван в тексте).
  if (f.district) {
    const canonical = canonicalFrom(KNOWN_DISTRICTS, f.district);
    if (canonical) f.district = canonical;
    else if (foldedQuery !== null && !queryMentions(foldedQuery, f.district)) f.district = null;
  }

  // Студия («студ», «студия», «студию»): searchQuery = "студия", rooms = null (если 1-комнатность не названа явно).
  if (foldedQuery && /(?:^|\s)(?:студ(?=\s|$)|сту[дл](?:я|и\p{L}*)(?=\s|$))/u.test(foldedQuery)) {
    if (!f.searchQuery || /^(?:квартир\p{L}*\s+)?сту[дл]\p{L}*$/u.test(foldText(f.searchQuery))) {
      f.searchQuery = "студия";
    }
    if (!f.propertyType) {
      f.propertyType = "apartment";
    }
    const explicitOneRoom = /(?:^|\s)(?:1|бир|одна|одну|однокомнат|однушк|odnushk)/u.test(foldedQuery);
    if (f.rooms === 1 && !explicitOneRoom) {
      f.rooms = null;
    }
  }

  f = dropPriceMatchingAreaNumber(f, query);

  [f.minPrice, f.maxPrice] = orderRange(f.minPrice, f.maxPrice);
  [f.minArea, f.maxArea] = orderRange(f.minArea, f.maxArea);
  [f.beachDistanceFrom, f.beachDistanceTo] = orderRange(f.beachDistanceFrom, f.beachDistanceTo);

  // Валюта без цены бессмысленна; цена без валюты допустима.
  if (f.minPrice === null && f.maxPrice === null) f.currency = null;

  return f;
}
