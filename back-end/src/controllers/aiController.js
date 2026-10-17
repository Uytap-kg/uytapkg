import dotenv from "dotenv";
import { sanitizeSearchQuery } from "./listingsController.js";
import {
  REGIONS,
  BISHKEK_DISTRICTS,
  ISSYK_KUL_LOCATIONS,
  CHUY_LOCATIONS,
  OSH_CITY_DISTRICTS,
  OSH_REGION_LOCATIONS,
  JALAL_ABAD_LOCATIONS,
  NARYN_LOCATIONS,
  TALAS_LOCATIONS,
  BATKEN_LOCATIONS,
  TURKEY_LOCATIONS,
} from "../constants/locations.js";
import { PROPERTY_TYPES, DEAL_TYPES } from "../constants/propertyTypes.js";

dotenv.config();

export const SEARCH_CACHE = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 минут для ответов LLM
export const FALLBACK_CACHE_TTL_MS = 2 * 60 * 1000; // 2 минуты максимум для fallback при сбое LLM
const MAX_CACHE_SIZE = 1000;
const AI_TIMEOUT_MS = 5000; // 5 секунд таймаут для внешних LLM API
const MAX_PROMPT_LENGTH = 500;

export const normalizeCacheKey = (prompt) => {
  if (!prompt || typeof prompt !== "string") return "";
  return prompt.trim().toLowerCase().replace(/\s+/g, " ");
};

export const getFromCache = (prompt) => {
  const key = normalizeCacheKey(prompt);
  if (!key) return null;
  const cached = SEARCH_CACHE.get(key);
  if (!cached) return null;

  if (Date.now() > cached.expiresAt) {
    SEARCH_CACHE.delete(key);
    return null;
  }

  // Честный LRU: удаляем и вставляем заново, перемещая ключ в конец (MRU)
  SEARCH_CACHE.delete(key);
  SEARCH_CACHE.set(key, cached);

  return cached.data;
};

export const setInCache = (prompt, data, ttlMs = CACHE_TTL_MS) => {
  const key = normalizeCacheKey(prompt);
  if (!key || !data) return;

  if (SEARCH_CACHE.has(key)) {
    SEARCH_CACHE.delete(key);
  } else if (SEARCH_CACHE.size >= MAX_CACHE_SIZE) {
    // Вытесняем старейший элемент (первый ключ в Map)
    const oldestKey = SEARCH_CACHE.keys().next().value;
    if (oldestKey !== undefined) {
      SEARCH_CACHE.delete(oldestKey);
    }
  }

  SEARCH_CACHE.set(key, {
    data,
    expiresAt: Date.now() + ttlMs,
  });
};

export const clearSearchCache = () => {
  SEARCH_CACHE.clear();
};

const parseJsonFromText = (rawText) => {
  if (!rawText || typeof rawText !== "string") return null;

  const cleaned = rawText.replace(/```(?:json)?|```/g, "").trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  const jsonString = jsonMatch ? jsonMatch[0] : cleaned;

  try {
    return JSON.parse(jsonString);
  } catch (error) {
    const relaxed = jsonString
      .replace(/[\n\r]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    try {
      return JSON.parse(relaxed);
    } catch (innerError) {
      return null;
    }
  }
};

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const getCandidateModels = () => {
  return Array.from(
    new Set([process.env.GEMINI_MODEL, "gemini-2.5-flash", "gemini-flash-latest"].filter(Boolean))
  );
};

const buildSearchPrompt = (prompt) => {
  return `Ты — AI-ассистент платформы недвижимости UyTap (Кыргызстан и Турция).
Проанализируй поисковый запрос пользователя на русском или кыргызском языке и извлеки структурированные фильтры.
Если параметр не указан в запросе, верни null.

Схема ответа (строгий JSON без markdown):
{
  "country": "kyrgyzstan" | "turkey" | null,
  "region": "BISHKEK" | "CHUY" | "OSH" | "ISSYK_KUL" | "JALAL_ABAD" | "NARYN" | "TALAS" | "BATKEN" | "TURKEY" | null,
  "city": string | null,
  "district": string | null,
  "propertyType": "apartment" | "house" | "cottage" | "land" | "commercial" | "room" | "parking" | null,
  "dealType": "sale" | "rent" | null,
  "rooms": 1 | 2 | 3 | "4+" | null,
  "minPrice": number | null,
  "maxPrice": number | null,
  "currency": "USD" | "KGS" | null,
  "minArea": number | null,
  "maxArea": number | null,
  "searchQuery": string | null,
  "beachDistanceFrom": number | null,
  "beachDistanceTo": number | null,
  "urgentOnly": boolean | null
}

Правила анализа:
1. Исправление опечаток:
   - Пользователь может писать с опечатками (например, "стулия" -> "студия", "миркорайон" -> "микрорайон", "уентральном" -> "Центр"). Исправляй их автоматически.
2. Многоязычность (кыргызский и русский языки):
   - "жер уй", "жер үй", "үй" -> propertyType: "house"
   - "батир" -> propertyType: "apartment"
   - "жер", "жер тилкеси" -> propertyType: "land"
   - "комната", "бөлмө" -> propertyType: "room"
   - "ижара", "ижарага", "алам" -> dealType: "rent"
   - "сатуу", "сатам", "сатып алам" -> dealType: "sale"
   - "сом", "сомго", "сомдон" -> currency: "KGS"
3. Специфические ключевые слова (searchQuery):
   - В поле "searchQuery" помещай ТОЛЬКО явные имена собственные: название жилого комплекса ("Ихлас", "Авалон", "Victory"), застройщика ("Авангард Стиль", "Эмарк"), конкретной улицы или уникальные типы планировок ("студия", "евродвушка", "пентхаус").
   - КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО помещать в "searchQuery" описательные фразы, качественные/оценочные прилагательные и служебные слова: "с ремонтом", "вид на горы", "арзан", "дешевый", "хороший", "элитный", "чистый", "срочно", "с бассейном", "с газом", "под строительство". Если явного названия ЖК, застройщика, улицы или планировки в запросе нет, верни "searchQuery": null.
4. Районы (канонизация для Бишкека):
   - Районы приводи к их каноническим названиям в именительном падеже:
     - "в центре", "в центральном районе", "центр" -> district: "Центр"
     - "южный микрорайон", "южные микрорайоны", "в южной части" -> district: "Южные микрорайоны"
     - "джал", "в джале", "жал", "жалда" -> district: "Джал"
     - "асанбай" -> district: "Асанбай"
     - "тунгуч" -> district: "Тунгуч"
     - "кок-жар", "көк-жар" -> district: "Кок-Жар"
     - "ахунбаева" -> district: "Ахунбаева"
5. Площадь ("квадрат", "соток"):
   - Для квартир и домов площадь указывается в м²: "110 квадрат", "110 кв", "110 м2" -> minArea: 100, maxArea: 120. "от 50 до 80 кв" -> minArea: 50, maxArea: 80.
   - ВАЖНО: Для земельных участков (propertyType = "land") при упоминании "соток" площадь должна быть СТРОГО В СОТКАХ (НЕ умножать на 100!): "6 соток" -> minArea: 6, maxArea: 6. "от 4 до 10 соток" -> minArea: 4, maxArea: 10.
6. Регионы и города:
   - Если указан микрорайон Бишкека (Южные микрорайоны, Джал, Центр, Асанбай и т.д.), автоматически: region: "BISHKEK", city: "Бишкек".
   - Иссык-Куль, Каракол, Чолпон-Ата, Бостери, Балыкчы -> region: "ISSYK_KUL".
   - Ош -> region: "OSH", city: "Ош".
   - Чуй, Токмок, Кант, Кара-Балта, Сокулук -> region: "CHUY".
   - Аланья, Анталия, Стамбул, Мерсин -> country: "turkey", region: "TURKEY".
7. Цены и валюта:
   - "от 20 000 долларов до 80000" -> minPrice: 20000, maxPrice: 80000, currency: "USD".
   - "$" или "доллар" или "usd" -> currency: "USD".
   - "сом" или "kgs" -> currency: "KGS".
8. Тип недвижимости:
   - Если тип недвижимости в запросе не указан (например, "купить в Оше до 50000$"), верни propertyType: null. НЕ выдумывай тип, если его нет.

Текст запроса: "${prompt}"`;
};

const callClaude = async (prompt) => {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) return null;

  const model = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";
  const baseUrl = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1").replace(/\/+$/, "");

  try {
    const isChatCompletions =
      baseUrl.endsWith("/chat/completions") || baseUrl.includes("openrouter.ai/api/v1");
    const endpoint = isChatCompletions
      ? baseUrl.endsWith("/chat/completions")
        ? baseUrl
        : `${baseUrl}/chat/completions`
      : `${baseUrl}/messages`;

    const headers = isChatCompletions
      ? {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        }
      : {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        };

    const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
    if (workspaceId && !isChatCompletions) {
      headers["anthropic-workspace-id"] = workspaceId;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      body: JSON.stringify(
        isChatCompletions
          ? {
              model,
              messages: [
                { role: "system", content: buildSearchPrompt(prompt) },
                { role: "user", content: `Пользовательский запрос: "${prompt}"` },
              ],
              response_format: { type: "json_object" },
            }
          : {
              model,
              max_tokens: 1000,
              system: buildSearchPrompt(prompt),
              messages: [
                { role: "user", content: `Пользовательский запрос: "${prompt}"` },
              ],
            },
      ),
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      console.warn(
        `Claude API warning (${response.status}):`,
        errBody?.error?.message || errBody?.message || response.statusText,
      );
      return null;
    }

    const data = await response.json();
    const rawText = isChatCompletions
      ? data?.choices?.[0]?.message?.content
      : data?.content?.[0]?.text;

    const parsed = parseJsonFromText(rawText);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch (err) {
    console.warn("Claude API call failed:", err?.message || err);
  }

  return null;
};

const callGemini = async (prompt) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const candidateModels = getCandidateModels();

  for (const model of candidateModels) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(AI_TIMEOUT_MS),
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: buildSearchPrompt(prompt),
                  },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: "application/json",
            },
          }),
        },
      );

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        console.warn(
          `Gemini API warning for model ${model} (${response.status}):`,
          errBody?.error?.message || response.statusText,
        );
        // Если квота исчерпана (429), остальные модели того же проекта тоже упадут — не тратим время
        if (response.status === 429) {
          break;
        }
        continue;
      }

      const data = await response.json();
      const rawText =
        data?.candidates?.[0]?.content?.parts?.[0]?.text ||
        data?.output?.[0]?.content?.[0]?.text;
      const parsed = parseJsonFromText(rawText);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch (err) {
      console.warn(`Gemini API call failed for model ${model}:`, err?.message || err);
    }
  }

  return null;
};

// =======================================================
// Валидация и санитизация недоверенного ответа LLM
// =======================================================

const VALID_COUNTRIES = new Set(["kyrgyzstan", "turkey"]);
const VALID_REGIONS = new Set([
  "BISHKEK",
  "ISSYK_KUL",
  "CHUY",
  "OSH",
  "OSH_CITY",
  "OSH_REGION",
  "JALAL_ABAD",
  "NARYN",
  "TALAS",
  "BATKEN",
  "TURKEY",
]);
const VALID_PROPERTY_TYPES = new Set([
  ...Object.values(PROPERTY_TYPES),
  "cottage",
  "parking",
]);
const VALID_DEAL_TYPES = new Set(Object.values(DEAL_TYPES));
const VALID_CURRENCIES = new Set(["USD", "KGS"]);
const VALID_ROOMS = new Set([1, 2, 3, "4+"]);

export function validateAndSanitizeAIFilters(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  // 1. Белый список разрешённых полей (все неизвестные/инъецированные поля отбрасываются)
  let country = null;
  if (typeof raw.country === "string") {
    const c = raw.country.trim().toLowerCase();
    if (VALID_COUNTRIES.has(c)) {
      country = c;
    }
  }

  let region = null;
  if (typeof raw.region === "string") {
    const r = raw.region.trim().toUpperCase();
    if (VALID_REGIONS.has(r)) {
      region = r;
    }
  }

  let city = null;
  if (typeof raw.city === "string" && raw.city.trim()) {
    city = sanitizeSearchQuery(raw.city, 50) || null;
  }

  let district = null;
  if (typeof raw.district === "string" && raw.district.trim()) {
    district = sanitizeSearchQuery(raw.district, 50) || null;
  }

  let propertyType = null;
  if (typeof raw.propertyType === "string") {
    const pt = raw.propertyType.trim().toLowerCase();
    if (VALID_PROPERTY_TYPES.has(pt)) {
      propertyType = pt;
    }
  }

  let dealType = null;
  if (typeof raw.dealType === "string") {
    const dt = raw.dealType.trim().toLowerCase();
    if (VALID_DEAL_TYPES.has(dt)) {
      dealType = dt;
    }
  }

  let rooms = null;
  if (raw.rooms !== undefined && raw.rooms !== null) {
    if (raw.rooms === "4+" || String(raw.rooms).trim() === "4+") {
      rooms = "4+";
    } else {
      const rNum = Number(raw.rooms);
      if (!Number.isNaN(rNum) && Number.isInteger(rNum)) {
        if (rNum >= 4) {
          rooms = "4+";
        } else if (VALID_ROOMS.has(rNum)) {
          rooms = rNum;
        }
      }
    }
  }

  let currency = null;
  if (typeof raw.currency === "string") {
    const cur = raw.currency.trim().toUpperCase();
    if (VALID_CURRENCIES.has(cur)) {
      currency = cur;
    }
  }

  // 2. Числовые диапазоны: неотрицательные, min <= max (при инверсии меняются местами)
  let minPrice = null;
  let maxPrice = null;
  if (raw.minPrice !== undefined && raw.minPrice !== null) {
    const num = Number(raw.minPrice);
    if (Number.isFinite(num) && num >= 0) minPrice = num;
  }
  if (raw.maxPrice !== undefined && raw.maxPrice !== null) {
    const num = Number(raw.maxPrice);
    if (Number.isFinite(num) && num >= 0) maxPrice = num;
  }
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
    const temp = minPrice;
    minPrice = maxPrice;
    maxPrice = temp;
  }

  let minArea = null;
  let maxArea = null;
  if (raw.minArea !== undefined && raw.minArea !== null) {
    const num = Number(raw.minArea);
    if (Number.isFinite(num) && num >= 0) minArea = num;
  }
  if (raw.maxArea !== undefined && raw.maxArea !== null) {
    const num = Number(raw.maxArea);
    if (Number.isFinite(num) && num >= 0) maxArea = num;
  }
  if (minArea !== null && maxArea !== null && minArea > maxArea) {
    const temp = minArea;
    minArea = maxArea;
    maxArea = temp;
  }

  // 3. Санитизация searchQuery через общий строгий sanitizeSearchQuery
  let searchQuery = null;
  if (typeof raw.searchQuery === "string" && raw.searchQuery.trim()) {
    const clean = sanitizeSearchQuery(raw.searchQuery, 100);
    searchQuery = clean || null;
  }

  // 4. Расстояние до моря / пляжа (Турция / курорты)
  let beachDistanceFrom = null;
  let beachDistanceTo = null;
  if (raw.beachDistanceFrom !== undefined && raw.beachDistanceFrom !== null) {
    const num = Number(raw.beachDistanceFrom);
    if (Number.isFinite(num) && num >= 0) beachDistanceFrom = num;
  }
  if (raw.beachDistanceTo !== undefined && raw.beachDistanceTo !== null) {
    const num = Number(raw.beachDistanceTo);
    if (Number.isFinite(num) && num >= 0) beachDistanceTo = num;
  }
  if (beachDistanceFrom !== null && beachDistanceTo !== null && beachDistanceFrom > beachDistanceTo) {
    const temp = beachDistanceFrom;
    beachDistanceFrom = beachDistanceTo;
    beachDistanceTo = temp;
  }

  // 5. Признак "только срочные"
  let urgentOnly = null;
  if (raw.urgentOnly !== undefined && raw.urgentOnly !== null) {
    urgentOnly = Boolean(raw.urgentOnly);
  }

  return {
    country,
    region,
    city,
    district,
    propertyType,
    dealType,
    rooms,
    minPrice,
    maxPrice,
    currency,
    minArea,
    maxArea,
    searchQuery,
    beachDistanceFrom,
    beachDistanceTo,
    urgentOnly,
  };
}

export const fallbackParse = (prompt) => {
  let lower = prompt.toLowerCase().replace(/ё/g, "е");

  // Fix common typos in Russian/Kyrgyz
  lower = lower
    .replace(/стули\w*/g, "студия")
    .replace(/миркорайон\w*/g, "микрорайон")
    .replace(/уентральн\w*/g, "центральн");

  // 1. Поиск по ЖК / застройщику и архитектурным ключевым словам
  let searchQuery = null;
  const markerMatch = lower.match(
    /(?:жк|жилой\s+комплекс|застройщик)\s+([a-zа-яёөүң0-9\-]+)(?:\s+([a-zа-яёөүң0-9\-]+))?/iu
  );
  if (markerMatch) {
    const firstWord = markerMatch[1];
    const secondWord = markerMatch[2];

    const stopWords = new Set([
      "за", "в", "на", "от", "до", "с", "по", "для", "и", "чейин", "дегенде", "сом", "доллар", "usd", "kgs",
    ]);

    const isKnownQueryTerm = (w) => {
      if (!w) return true;
      if (stopWords.has(w) || /^\d/.test(w)) return true;
      if (w.startsWith("евро") || w === "студия" || w === "пентхаус") return true;
      if (w.includes("ремонт")) return true;
      if (
        w.includes("комнат") ||
        w.includes("бөлмө") ||
        w.includes("однушк") ||
        w.includes("двушк") ||
        w.includes("трешк") ||
        w.includes("четырех")
      ) {
        return true;
      }
      if (
        w === "квартира" ||
        w === "батир" ||
        w === "дом" ||
        w === "уй" ||
        w === "үй" ||
        w === "участок" ||
        w === "коттедж" ||
        w === "офис" ||
        w === "паркинг" ||
        w === "гараж" ||
        w === "комната"
      ) {
        return true;
      }
      return false;
    };

    if (secondWord && !isKnownQueryTerm(secondWord)) {
      searchQuery = sanitizeSearchQuery(`${firstWord} ${secondWord}`);
    } else {
      searchQuery = sanitizeSearchQuery(firstWord);
    }
  } else if (lower.includes("студи")) {
    searchQuery = "студия";
  } else if (lower.includes("евродвушк")) {
    searchQuery = "евродвушка";
  } else if (lower.includes("пентхаус")) {
    searchQuery = "пентхаус";
  }

  // Country & Region detection
  const isTurkey =
    lower.includes("турци") ||
    lower.includes("turkey") ||
    lower.includes("түркия") ||
    lower.includes("алань") ||
    lower.includes("антал") ||
    lower.includes("стамбул") ||
    lower.includes("мерсин") ||
    lower.includes("измир");

  const isIssykKul =
    lower.includes("иссык") ||
    lower.includes("ысык") ||
    lower.includes("чолпон") ||
    lower.includes("бостери") ||
    lower.includes("каракол") ||
    lower.includes("балыкчы");

  const isOsh = lower.includes("ош") && !lower.includes("хорош");
  const isBishkek = lower.includes("бишкек");
  const isChuy =
    lower.includes("чуй") ||
    lower.includes("чүй") ||
    lower.includes("токмок") ||
    lower.includes("кант") ||
    lower.includes("кара-балта") ||
    lower.includes("сокулук");
  const isJalalAbad =
    lower.includes("жалал-абад") || lower.includes("джалал-абад");
  const isNaryn = lower.includes("нарын");
  const isTalas = lower.includes("талас");
  const isBatken = lower.includes("баткен");

  let country = null;
  let region = null;
  let city = null;

  if (isTurkey) {
    country = "turkey";
    region = "TURKEY";
    city = lower.includes("алань")
      ? "Аланья"
      : lower.includes("антал")
        ? "Анталия"
        : lower.includes("стамбул")
          ? "Стамбул"
          : lower.includes("мерсин")
            ? "Мерсин"
            : "Турция";
  } else if (isIssykKul) {
    country = "kyrgyzstan";
    region = "ISSYK_KUL";
    city = lower.includes("каракол")
      ? "Каракол"
      : lower.includes("чолпон")
        ? "Чолпон-Ата"
        : lower.includes("бостери")
          ? "Бостери"
          : lower.includes("балыкчы")
            ? "Балыкчы"
            : "Иссык-Куль";
  } else if (isOsh) {
    country = "kyrgyzstan";
    region = "OSH";
    city = "Ош";
  } else if (isBishkek) {
    country = "kyrgyzstan";
    region = "BISHKEK";
    city = "Бишкек";
  } else if (isChuy) {
    country = "kyrgyzstan";
    region = "CHUY";
    city = lower.includes("токмок")
      ? "Токмок"
      : lower.includes("кант")
        ? "Кант"
        : lower.includes("кара-балта")
          ? "Кара-Балта"
          : null;
  } else if (isJalalAbad) {
    country = "kyrgyzstan";
    region = "JALAL_ABAD";
    city = "Джалал-Абад";
  } else if (isNaryn) {
    country = "kyrgyzstan";
    region = "NARYN";
    city = "Нарын";
  } else if (isTalas) {
    country = "kyrgyzstan";
    region = "TALAS";
    city = "Талас";
  } else if (isBatken) {
    country = "kyrgyzstan";
    region = "BATKEN";
    city = "Баткен";
  }

  // District (Canonical naming for Bishkek)
  let district = null;
  if (
    lower.includes("южн") &&
    (lower.includes("микрорайон") ||
      lower.includes("мкр") ||
      lower.includes("част"))
  ) {
    district = "Южные микрорайоны";
    if (!region) {
      region = "BISHKEK";
      city = "Бишкек";
      country = "kyrgyzstan";
    }
  } else if (lower.includes("центр") || lower.includes("центральн")) {
    district = "Центр";
    if (!region && !isTurkey) {
      region = "BISHKEK";
      city = "Бишкек";
      country = "kyrgyzstan";
    }
  } else if (
    lower.includes("джал") ||
    lower.includes("жалда") ||
    /(?:^|[^\wа-яёөүң])жал(?=[^\wа-яёөүң]|$)/i.test(lower)
  ) {
    district = "Джал";
    if (!region) {
      region = "BISHKEK";
      city = "Бишкек";
      country = "kyrgyzstan";
    }
  } else if (lower.includes("асанбай")) {
    district = "Асанбай";
    if (!region) {
      region = "BISHKEK";
      city = "Бишкек";
      country = "kyrgyzstan";
    }
  } else if (lower.includes("тунгуч")) {
    district = "Тунгуч";
    if (!region) {
      region = "BISHKEK";
      city = "Бишкек";
      country = "kyrgyzstan";
    }
  } else if (lower.includes("кок-жар") || lower.includes("кок жар")) {
    district = "Кок-Жар";
    if (!region) {
      region = "BISHKEK";
      city = "Бишкек";
      country = "kyrgyzstan";
    }
  } else if (lower.includes("ахунбаев")) {
    district = "Ахунбаева";
    if (!region) {
      region = "BISHKEK";
      city = "Бишкек";
      country = "kyrgyzstan";
    }
  } else {
    for (const bDist of BISHKEK_DISTRICTS) {
      if (lower.includes(bDist.toLowerCase())) {
        district = bDist;
        if (!region) {
          region = "BISHKEK";
          city = "Бишкек";
          country = "kyrgyzstan";
        }
        break;
      }
    }
  }

  // Property Type (including Kyrgyz: жер уй / жер үй = house, батир = apartment, жер = land)
  let propertyType = null;
  if (
    lower.includes("жер уй") ||
    lower.includes("жер үй") ||
    /(?:^|[^\wа-яёөүң])(жер\s*[үу]й|үй|уй|дом\w*)(?=[^\wа-яёөүң]|$)/i.test(
      lower,
    )
  ) {
    propertyType = "house";
  } else if (lower.includes("коттедж")) {
    propertyType = "cottage";
  } else if (lower.includes("участок") || lower.includes("жер")) {
    propertyType = "land";
  } else if (
    lower.includes("коммерц") ||
    lower.includes("офис") ||
    lower.includes("склад") ||
    lower.includes("магазин")
  ) {
    propertyType = "commercial";
  } else if (lower.includes("гараж") || lower.includes("паркинг")) {
    propertyType = "parking";
  } else if (
    lower.includes("комната") ||
    lower.includes("комнату") ||
    lower.includes("бөлмө")
  ) {
    propertyType =
      lower.includes("квартир") || lower.includes("батир")
        ? "apartment"
        : "room";
  } else if (
    lower.includes("квартир") ||
    lower.includes("батир") ||
    lower.includes("однушк") ||
    lower.includes("двушк") ||
    lower.includes("трешк") ||
    lower.includes("студи")
  ) {
    propertyType = "apartment";
  }

  // Deal Type
  let dealType = null;
  if (
    lower.includes("аренд") ||
    lower.includes("снять") ||
    lower.includes("сниму") ||
    lower.includes("ижара") ||
    lower.includes("алам")
  ) {
    dealType = "rent";
  } else if (
    lower.includes("куп") ||
    lower.includes("прод") ||
    lower.includes("сатам") ||
    lower.includes("сатуу") ||
    lower.includes("сатып")
  ) {
    dealType = "sale";
  }

  // Rooms
  let rooms = null;
  if (
    lower.includes("1 комн") ||
    lower.includes("1-комн") ||
    lower.includes("1 бөлмө") ||
    lower.includes("однушк") ||
    /\b1\s*(?:-?комнат\w*|комн\w*|к\b|бөлмө\w*)/.test(lower)
  ) {
    rooms = 1;
  } else if (
    lower.includes("2 комн") ||
    lower.includes("2-комн") ||
    lower.includes("2 бөлмө") ||
    lower.includes("двушк") ||
    /\b2\s*(?:-?комнат\w*|комн\w*|к\b|бөлмө\w*)/.test(lower)
  ) {
    rooms = 2;
  } else if (
    lower.includes("3 комн") ||
    lower.includes("3-комн") ||
    lower.includes("3 бөлмө") ||
    lower.includes("трешк") ||
    /\b3\s*(?:-?комнат\w*|комн\w*|к\b|бөлмө\w*)/.test(lower)
  ) {
    rooms = 3;
  } else if (
    lower.includes("4 комн") ||
    lower.includes("4-комн") ||
    lower.includes("4 бөлмө") ||
    lower.includes("4+") ||
    /\b4\s*(?:-?комнат\w*|комн\w*|к\b|бөлмө\w*)/.test(lower)
  ) {
    rooms = "4+";
  }

  // Currency
  let currency = null;
  if (lower.includes("сом") || lower.includes("kgs")) {
    currency = "KGS";
  } else if (
    lower.includes("$") ||
    lower.includes("доллар") ||
    lower.includes("usd") ||
    isTurkey
  ) {
    currency = "USD";
  }

  // Area (квадрат, соток, м2)
  let minArea = null;
  let maxArea = null;

  const sotkaRangeMatch = lower.match(
    /(?:от\s*)?(\d+)\s*(?:до|-)\s*(\d+)\s*(?:соток|сотки|сот\b)/,
  );
  const singleSotkaMatch = lower.match(/(\d+)\s*(?:соток|сотки|сот\b)/);

  if (sotkaRangeMatch) {
    minArea = Number(sotkaRangeMatch[1]);
    maxArea = Number(sotkaRangeMatch[2]);
    if (!propertyType) propertyType = "land";
  } else if (singleSotkaMatch) {
    const val = Number(singleSotkaMatch[1]);
    minArea = val;
    maxArea = val;
    if (!propertyType) propertyType = "land";
  } else {
    const areaRangeMatch = lower.match(
      /(?:от\s*)?(\d+)\s*(?:до|-)\s*(\d+)\s*(?:квадрат|кв|м2|м²)/,
    );
    if (areaRangeMatch) {
      minArea = Number(areaRangeMatch[1]);
      maxArea = Number(areaRangeMatch[2]);
    } else {
      const singleAreaMatch = lower.match(/(\d+)\s*(?:квадрат|кв\s*м|м2|м²)/);
      if (singleAreaMatch) {
        const val = Number(singleAreaMatch[1]);
        minArea = Math.round(val * 0.9);
        maxArea = Math.round(val * 1.1);
      }
    }
  }

  // Price
  const cleanedForPrice = lower
    .replace(/[1-4]\s*(-комнатн\w*|комнатн\w*|комн\w*|к\b|бөлмө\w*)/g, " ")
    .replace(/однушк\w*|двушк\w*|трешк\w*/g, " ")
    .replace(/(\d+)\s*(?:квадрат|кв|м2|м²|соток)/g, " ");

  let minPrice = null;
  let maxPrice = null;

  const rangePriceMatch = cleanedForPrice.match(
    /от\s*(\d+[\s\d]*)\s*(?:доллар\w*|\$|usd|сом\w*|kgs|евро|eur)?\s*(?:до|-)\s*(\d+[\s\d]*)/i,
  );
  if (rangePriceMatch) {
    minPrice = Number(rangePriceMatch[1].replace(/\s/g, ""));
    maxPrice = Number(rangePriceMatch[2].replace(/\s/g, ""));
  } else {
    const minMatch = cleanedForPrice.match(
      /(?:от|выше|начиная с)\s*(\d+[\s\d]*)/,
    );
    if (minMatch) {
      minPrice = Number(minMatch[1].replace(/\s/g, ""));
    }
    const maxMatch = cleanedForPrice.match(/(?:до|дегенде|чейин)\s*(\d+[\s\d]*)/);
    if (maxMatch) {
      maxPrice = Number(maxMatch[1].replace(/\s/g, ""));
    } else {
      const numbers = cleanedForPrice.match(/\b\d{2,10}\b/g);
      if (numbers && numbers.length > 0) {
        const candidates = numbers
          .map((n) => Number(n.replace(/\s/g, "")))
          .filter((n) => n >= 50);
        if (candidates.length > 0) {
          maxPrice = candidates[candidates.length - 1];
        }
      }
    }
  }

  return {
    country,
    region,
    city,
    district,
    propertyType: propertyType || null,
    dealType,
    rooms,
    minPrice,
    maxPrice,
    currency:
      currency ||
      (isTurkey
        ? "USD"
        : dealType === "rent" && maxPrice && maxPrice > 5000
          ? "KGS"
          : null),
    minArea,
    maxArea,
    searchQuery,
  };
};

// =======================================================
// Умный Поиск и Генерация Описания с Gemini AI
// =======================================================

// =======================================================
// Умный Поиск: вызов LLM с таймаутом, дедупликацией и LRU
// =======================================================

export const INFLIGHT_SEARCHES = new Map();

async function executeAiSearch(prompt) {
  const preferredProvider = (
    process.env.AI_PROVIDER ||
    (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY ? "claude" : "gemini")
  ).toLowerCase();

  const claudeModelName = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";
  let filters = null;
  let source = "local-parser";

  if (preferredProvider === "claude" || preferredProvider === "anthropic") {
    try {
      const raw = await callClaude(prompt);
      const validated = validateAndSanitizeAIFilters(raw);
      if (validated) {
        filters = validated;
        source = claudeModelName;
      }
    } catch (claudeError) {
      console.warn("Claude API call warning:", claudeError?.message || claudeError);
    }

    if (!filters && process.env.GEMINI_API_KEY) {
      try {
        const raw = await callGemini(prompt);
        const validated = validateAndSanitizeAIFilters(raw);
        if (validated) {
          filters = validated;
          source = "gemini-api";
        }
      } catch (geminiError) {
        console.warn("Gemini API fallback warning:", geminiError?.message || geminiError);
      }
    }
  } else {
    try {
      const raw = await callGemini(prompt);
      const validated = validateAndSanitizeAIFilters(raw);
      if (validated) {
        filters = validated;
        source = "gemini-api";
      }
    } catch (geminiError) {
      console.warn("Gemini API call warning:", geminiError?.message || geminiError);
    }

    if (!filters && (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY)) {
      try {
        const raw = await callClaude(prompt);
        const validated = validateAndSanitizeAIFilters(raw);
        if (validated) {
          filters = validated;
          source = claudeModelName;
        }
      } catch (claudeError) {
        console.warn("Claude API fallback warning:", claudeError?.message || claudeError);
      }
    }
  }

  // Если оба внешних LLM провайдера недоступны, вернули невалидный JSON или сработал таймаут:
  if (!filters) {
    const rawFallback = fallbackParse(prompt);
    filters = validateAndSanitizeAIFilters(rawFallback) || rawFallback;
    source = "local-parser";
  }

  // Сохраняем в кэш для повторных вызовов (ответы LLM на 30 мин, fallbackParse при сбое LLM максимум на 2 мин)
  if (filters && typeof filters === "object") {
    const ttl = source === "local-parser" ? FALLBACK_CACHE_TTL_MS : CACHE_TTL_MS;
    setInCache(prompt, filters, ttl);
  }

  return { filters, source };
}

export const aiSearch = async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return res.status(400).json({ success: false, message: "Введите текстовый или голосовой запрос" });
    }

    if (prompt.length > MAX_PROMPT_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Запрос слишком длинный (максимум ${MAX_PROMPT_LENGTH} символов)`,
      });
    }

    // 1. Проверяем высокоскоростной In-Memory кэш (LRU / TTL 30 мин)
    const cachedFilters = getFromCache(prompt);
    if (cachedFilters) {
      return res.json({
        success: true,
        filters: cachedFilters,
        source: "cache",
      });
    }

    // 2. Дедупликация параллельных запросов с одинаковым промптом (Inflight Map)
    const cacheKey = normalizeCacheKey(prompt);
    let inflightPromise = INFLIGHT_SEARCHES.get(cacheKey);

    if (!inflightPromise) {
      inflightPromise = executeAiSearch(prompt).finally(() => {
        INFLIGHT_SEARCHES.delete(cacheKey);
      });
      INFLIGHT_SEARCHES.set(cacheKey, inflightPromise);
    }

    const { filters, source } = await inflightPromise;

    return res.json({
      success: true,
      filters,
      source,
    });
  } catch (error) {
    console.error("AI Search Controller Error:", error);
    const fallbackFilters = fallbackParse(req.body?.prompt || "");
    return res.json({
      success: true,
      filters: fallbackFilters,
      source: "local-parser",
    });
  }
};

const MAX_DETAILS_LENGTH = 1000;

export const aiGenerateDescription = async (req, res) => {
  try {
    const { details } = req.body;

    if (!details || typeof details !== "string" || !details.trim()) {
      return res.status(400).json({ success: false, message: "Укажите характеристики объекта" });
    }

    if (details.length > MAX_DETAILS_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Слишком длинный текст (максимум ${MAX_DETAILS_LENGTH} символов)`,
      });
    }

    const claudeKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;
    const prompt = `На основе кратких характеристик создай продающее описание недвижимости на русском и кыргызском языках. Верни в формате JSON {"ru": "...", "kg": "..."}. Характеристики: ${details}`;

    const preferredProvider = (
      process.env.AI_PROVIDER ||
      (claudeKey ? "claude" : "gemini")
    ).toLowerCase();

    const tryClaudeDescription = async () => {
      if (!claudeKey) return null;
      const model = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";
      const baseUrl = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1").replace(/\/+$/, "");
      const isChatCompletions =
        baseUrl.endsWith("/chat/completions") || baseUrl.includes("openrouter.ai/api/v1");
      const endpoint = isChatCompletions
        ? baseUrl.endsWith("/chat/completions")
          ? baseUrl
          : `${baseUrl}/chat/completions`
        : `${baseUrl}/messages`;

      const headers = isChatCompletions
        ? { "Content-Type": "application/json", Authorization: `Bearer ${claudeKey}` }
        : { "Content-Type": "application/json", "x-api-key": claudeKey, "anthropic-version": "2023-06-01" };

      const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
      if (workspaceId && !isChatCompletions) {
        headers["anthropic-workspace-id"] = workspaceId;
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
        body: JSON.stringify(
          isChatCompletions
            ? {
                model,
                messages: [
                  { role: "system", content: "Верни результат строго в формате JSON без markdown: {\"ru\": \"...\", \"kg\": \"...\"}" },
                  { role: "user", content: prompt },
                ],
                response_format: { type: "json_object" },
              }
            : {
                model,
                max_tokens: 1000,
                system: "Верни результат строго в формате JSON без markdown: {\"ru\": \"...\", \"kg\": \"...\"}",
                messages: [{ role: "user", content: prompt }],
              },
        ),
      });

      if (!response.ok) return null;
      const data = await response.json();
      const rawText = isChatCompletions
        ? data?.choices?.[0]?.message?.content
        : data?.content?.[0]?.text;
      return parseJsonFromText(rawText);
    };

    const tryGeminiDescription = async () => {
      if (!geminiKey) return null;
      const candidateModels = getCandidateModels();
      for (const model of candidateModels) {
        try {
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: AbortSignal.timeout(AI_TIMEOUT_MS),
              body: JSON.stringify({
                contents: [
                  {
                    parts: [
                      {
                        text: prompt,
                      },
                    ],
                  },
                ],
                generationConfig: {
                  responseMimeType: "application/json",
                },
              }),
            },
          );

          if (!response.ok) {
            if (response.status === 429) break;
            continue;
          }

          const data = await response.json();
          const rawText =
            data?.candidates?.[0]?.content?.parts?.[0]?.text ||
            data?.output?.[0]?.content?.[0]?.text;
          const parsed = parseJsonFromText(rawText);
          if (parsed && (parsed.ru || parsed.kg)) {
            return parsed;
          }
        } catch (err) {
          console.warn(`Gemini description error with ${model}:`, err?.message || err);
        }
      }
      return null;
    };

    let generated = null;
    if (preferredProvider === "claude" || preferredProvider === "anthropic") {
      generated = await tryClaudeDescription();
      if (!generated) generated = await tryGeminiDescription();
    } else {
      generated = await tryGeminiDescription();
      if (!generated) generated = await tryClaudeDescription();
    }

    if (generated && (generated.ru || generated.kg)) {
      return res.json({ success: true, generatedText: generated });
    }

    return res.json({
      success: true,
      generatedText: {
        ru: `Отличный объект недвижимости. ${details || ""}`,
        kg: `Кыймылсыз мүлк объектиси. ${details || ""}`,
      },
    });
  } catch (error) {
    console.error("AI Generate Error:", error);
    return res.status(500).json({ success: false, message: "Ошибка генерации описания" });
  }
};
