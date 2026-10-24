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
import {
  buildSystemPrompt,
  buildCachedSystemBlocks,
  buildUserMessage,
} from "../ai/smartSearch.prompt.js";
import { buildOutputSchema } from "../ai/smartSearch.schema.js";
import {
  normalizeSmartSearchResult,
  emptySmartSearchFilters,
  AREA_UNIT,
} from "../ai/smartSearch.normalize.js";
import { extractCategoryFeatures } from "../ai/smartSearch.features.js";
import { resolveComplexFromText } from "../services/complexLookupService.js";
import { setBoundedMap } from "../utils/boundedMap.js";
import { Semaphore } from "../utils/semaphore.js";
import { checkAndIncrementRateLimit } from "../utils/sharedState.js";
import { getClientIp } from "./listingsController.js";

// Числа с единицей площади (для локального парсера): «50 квадратов», «80 м2», «от 80 до 100 кв».
const AREA_NUMBER_RE = new RegExp(`(?<![\\p{L}\\d.,])\\d+(?:[.,]\\d+)?\\s*${AREA_UNIT}`, "giu");
const AREA_RANGE_RE = new RegExp(
  `(?:от\\s*)?\\d+(?:[.,]\\d+)?\\s*(?:до|-|–)\\s*\\d+(?:[.,]\\d+)?\\s*${AREA_UNIT}`,
  "giu",
);

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

export const setInCache = (prompt, data, ttlMs = CACHE_TTL_MS, meta = {}) => {
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
    matchedComplex: meta.matchedComplex || null,
    expiresAt: Date.now() + ttlMs,
    degraded: meta.degraded === true, // результат локального парсера (LLM была недоступна)
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


const CLAUDE_TIMEOUT_MS = 8000; // запас на первый запрос со structured outputs (компиляция грамматики схемы)
const CLAUDE_MAX_TOKENS = 512; // ответ — один маленький JSON (~150 токенов)
const CLAUDE_RETRY_DELAY_MS = 300;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isRetryableStatus = (status) => status === 429 || status >= 500;

/**
 * Вызов Claude для разбора запроса умного поиска. Возвращает «сырой» объект модели либо null.
 * Валидация результата — в normalizeSmartSearchResult (вызывающий код).
 *
 * - Structured outputs: output_config.format (json_schema), схема строится из констант.
 * - Prompt caching: статичный system-блок помечен cache_control (ephemeral).
 * - Запрос передаётся отдельным блоком <query> (buildUserMessage).
 * - temperature НЕ передаём: Claude Haiku 5.5 может отвечать 400 на sampling-параметры.
 * - Один ретрай только при сетевой ошибке / 429 / 5xx. Таймаут не ретраится (иначе > лимита прокси).
 * - Если API отклонил схему (400), один раз повторяем без output_config: ответ всё равно проходит Zod.
 */
export const callClaude = async (query) => {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) return null;

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

  const userMessage = buildUserMessage(query);
  let useStructuredOutput = !isChatCompletions;

  const buildBody = () =>
    isChatCompletions
      ? {
          model,
          messages: [
            { role: "system", content: buildSystemPrompt() },
            { role: "user", content: userMessage },
          ],
          response_format: { type: "json_object" },
        }
      : {
          model,
          max_tokens: CLAUDE_MAX_TOKENS,
          system: buildCachedSystemBlocks(),
          messages: [{ role: "user", content: userMessage }],
          ...(useStructuredOutput
            ? { output_config: { format: { type: "json_schema", schema: buildOutputSchema() } } }
            : {}),
        };

  let retriesLeft = 1;
  const startedAt = Date.now();

  while (true) {
    let response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(CLAUDE_TIMEOUT_MS),
        body: JSON.stringify(buildBody()),
      });
    } catch (err) {
      const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
      console.warn(`Claude API call failed (${timedOut ? "timeout" : "network"}):`, err?.message || err);
      if (timedOut || retriesLeft <= 0) return null;
      retriesLeft -= 1;
      await sleep(CLAUDE_RETRY_DELAY_MS);
      continue;
    }

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      console.warn(
        `Claude API warning (${response.status}):`,
        errBody?.error?.message || errBody?.message || response.statusText,
      );

      if (response.status === 400 && useStructuredOutput) {
        useStructuredOutput = false; // схема отклонена — один повтор без structured outputs
        continue;
      }
      if (isRetryableStatus(response.status) && retriesLeft > 0) {
        retriesLeft -= 1;
        await sleep(CLAUDE_RETRY_DELAY_MS);
        continue;
      }
      return null;
    }

    const data = await response.json().catch(() => null);
    if (!data) return null;

    if (data.stop_reason === "max_tokens" || data.stop_reason === "refusal") {
      console.warn(`Claude API: ответ не использован (stop_reason=${data.stop_reason})`);
      return null;
    }

    const usage = data.usage || {};
    console.info(
      `[smart-search] claude ok ms=${Date.now() - startedAt} in=${usage.input_tokens ?? "?"} ` +
        `cache_read=${usage.cache_read_input_tokens ?? 0} cache_write=${usage.cache_creation_input_tokens ?? 0} ` +
        `out=${usage.output_tokens ?? "?"} structured=${useStructuredOutput}`,
    );

    // Ищем именно text-блок: перед ним может идти thinking-блок.
    const rawText = isChatCompletions
      ? data?.choices?.[0]?.message?.content
      : data?.content?.find((block) => block?.type === "text")?.text;

    const parsed = parseJsonFromText(rawText);
    return parsed && typeof parsed === "object" ? parsed : null;
  }
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
            systemInstruction: { parts: [{ text: buildSystemPrompt() }] },
            contents: [{ role: "user", parts: [{ text: buildUserMessage(prompt) }] }],
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
// Вся логика — в ai/smartSearch.normalize.js (normalizeSmartSearchResult).
// Имя сохранено для обратной совместимости с существующими импортами и тестами.
export function validateAndSanitizeAIFilters(raw, options) {
  return normalizeSmartSearchResult(raw, options);
}

export const fallbackParse = (prompt) => {
  let lower = prompt.toLowerCase().replace(/ё/g, "е");

  // Fix common typos in Russian/Kyrgyz
  lower = lower
    .replace(/стули\w*/g, "студия")
    .replace(/миркорайон\w*/g, "микрорайон")
    .replace(/комплекск\w*/g, "комплекс")
    .replace(/комплексе\w*/g, "комплекс")
    .replace(/уентральн\w*/g, "центральн");

  // 1. Поиск по ЖК / застройщику и архитектурным ключевым словам
  let searchQuery = null;
  const markerMatch = lower.match(
    /(?:жк|жило[йм]\s+комплекс[а-я]*|застройщик)\s+([a-zа-яёөүң0-9\-]+)(?:\s+([a-zа-яёөүң0-9\-]+))?/iu
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
  } else if (/(?:^|[^\p{L}])(?:студ(?=$|[^\p{L}])|сту[дл]и\p{L}*(?=$|[^\p{L}]))/iu.test(lower)) {
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
    lower.includes("алани") ||
    lower.includes("антал") ||
    lower.includes("стамбул") ||
    lower.includes("istanbul") ||
    lower.includes("мерсин") ||
    lower.includes("измир") ||
    lower.includes("бодрум") ||
    lower.includes("анкар") ||
    lower.includes("бурс") ||
    lower.includes("мармарис");

  const isIssykKul =
    lower.includes("иссык") ||
    lower.includes("ысык") ||
    lower.includes("issyk") ||
    lower.includes("чолпон") ||
    lower.includes("бостери") ||
    lower.includes("каракол") ||
    lower.includes("балыкчы") ||
    lower.includes("тамч") ||
    lower.includes("каджи") ||
    lower.includes("чок-тал") ||
    lower.includes("чок тал") ||
    lower.includes("сары-ой") ||
    lower.includes("сары ой") ||
    lower.includes("тамг") ||
    lower.includes("тосор") ||
    lower.includes("боконбаев") ||
    lower.includes("барскоон") ||
    lower.includes("ананьев") ||
    lower.includes("семеновк") ||
    lower.includes("григорьевк") ||
    lower.includes("тюп") ||
    lower.includes("кызыл-суу");

  const matchLocationInList = (text, list) => {
    const foldedText = text.replace(/[-–—_]+/g, " ").replace(/\s+/g, " ");
    for (const item of list) {
      const variants = item.includes("(")
        ? [
            item.replace(/\s*\([^)]*\)/g, "").trim(),
            (item.match(/\(([^)]+)\)/)?.[1] || "").trim(),
          ].filter(Boolean)
        : [item];
      for (const v of variants) {
        const cleanV = v.toLowerCase().replace(/ё/g, "е").replace(/[-–—_]+/g, " ").trim();
        const stemV = cleanV.length >= 4 ? cleanV.replace(/[аяоеиыуюь]$/i, "") : cleanV;
        if (stemV && foldedText.includes(stemV)) {
          return item;
        }
      }
    }
    return null;
  };

  const matchedOshSettlement = matchLocationInList(lower, OSH_REGION_LOCATIONS);
  const matchedJalalAbadSettlement = matchLocationInList(lower, JALAL_ABAD_LOCATIONS);
  const matchedNarynSettlement = matchLocationInList(lower, NARYN_LOCATIONS);
  const matchedTalasSettlement = matchLocationInList(lower, TALAS_LOCATIONS);
  const matchedBatkenSettlement = matchLocationInList(lower, BATKEN_LOCATIONS);
  const matchedChuySettlement = matchLocationInList(lower, CHUY_LOCATIONS);
  const matchedIssykKulSettlement = matchLocationInList(lower, ISSYK_KUL_LOCATIONS);

  const isOsh =
    /(?:^|[^\p{L}])ош(?:то|тон|ко|тун|ской|ская|ские|е|а|у)?(?![\p{L}])/iu.test(lower) ||
    Boolean(matchedOshSettlement);
  const isBishkek = lower.includes("бишкек") || lower.includes("бшкек") || lower.includes("bishkek");
  const isChuy =
    lower.includes("чуй") ||
    lower.includes("чүй") ||
    Boolean(matchedChuySettlement);
  const isJalalAbad =
    lower.includes("жалал-абад") ||
    lower.includes("джалал-абад") ||
    lower.includes("жалал абад") ||
    lower.includes("джалал абад") ||
    Boolean(matchedJalalAbadSettlement);
  const isNaryn = lower.includes("нарын") || Boolean(matchedNarynSettlement);
  const isTalas = lower.includes("талас") || Boolean(matchedTalasSettlement);
  const isBatken = lower.includes("баткен") || Boolean(matchedBatkenSettlement);

  let country = null;
  let region = null;
  let city = null;

  if (isTurkey) {
    country = "turkey";
    region = "TURKEY";
    city =
      lower.includes("алань") || lower.includes("алани")
        ? "Аланья"
        : lower.includes("антал")
          ? "Анталья"
          : lower.includes("стамбул") || lower.includes("istanbul")
            ? "Стамбул"
            : lower.includes("мерсин")
              ? "Мерсин"
              : lower.includes("бодрум")
                ? "Бодрум"
                : lower.includes("измир")
                  ? "Измир"
                  : lower.includes("анкар")
                    ? "Анкара"
                    : lower.includes("бурс")
                      ? "Бурса"
                      : lower.includes("мармарис")
                        ? "Мармарис"
                        : null;
  } else if (isIssykKul || matchedIssykKulSettlement) {
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
            : lower.includes("тамч")
              ? "Тамчи"
              : lower.includes("каджи")
                ? "Каджи-Сай"
                : lower.includes("чок-тал") || lower.includes("чок тал")
                  ? "Чок-Тал"
                  : lower.includes("сары-ой") || lower.includes("сары ой")
                    ? "Сары-Ой"
                    : lower.includes("тамг")
                      ? "Тамга"
                      : lower.includes("тосор")
                        ? "Тосор"
                        : lower.includes("боконбаев")
                          ? "Боконбаево"
                          : lower.includes("барскоон")
                            ? "Барскоон"
                            : lower.includes("ананьев")
                              ? "Ананьево"
                              : lower.includes("семеновк")
                                ? "Семеновка"
                                : lower.includes("григорьевк")
                                  ? "Григорьевка"
                                  : lower.includes("тюп")
                                    ? "Тюп"
                                    : lower.includes("кызыл-суу")
                                      ? "Кызыл-Суу"
                                      : matchedIssykKulSettlement || null;
  } else if (isOsh) {
    country = "kyrgyzstan";
    region = matchedOshSettlement ? "OSH_REGION" : "OSH";
    city = matchedOshSettlement || (lower.includes("област") ? null : "Ош");
  } else if (isBishkek) {
    country = "kyrgyzstan";
    region = "BISHKEK";
    city = "Бишкек";
  } else if (isChuy) {
    country = "kyrgyzstan";
    region = "CHUY";
    city = matchedChuySettlement || null;
  } else if (isJalalAbad) {
    country = "kyrgyzstan";
    region = "JALAL_ABAD";
    city = matchedJalalAbadSettlement || (lower.includes("област") ? null : "Жалал-Абад");
  } else if (isNaryn) {
    country = "kyrgyzstan";
    region = "NARYN";
    city = matchedNarynSettlement || (lower.includes("област") ? null : "Нарын");
  } else if (isTalas) {
    country = "kyrgyzstan";
    region = "TALAS";
    city = matchedTalasSettlement || (lower.includes("област") ? null : "Талас");
  } else if (isBatken) {
    country = "kyrgyzstan";
    region = "BATKEN";
    city = matchedBatkenSettlement || (lower.includes("област") ? null : "Баткен");
  }

  // District (Canonical naming for Bishkek & Osh)
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
  } else if (lower.includes("асанба")) {
    district = "Асанбай";
    if (!region) {
      region = "BISHKEK";
      city = "Бишкек";
      country = "kyrgyzstan";
    }
  } else if (lower.includes("тунгуч") || lower.includes("түнгүч")) {
    district = "Тунгуч";
    if (!region) {
      region = "BISHKEK";
      city = "Бишкек";
      country = "kyrgyzstan";
    }
  } else if (lower.includes("кок-жар") || lower.includes("кок жар") || lower.includes("көк-жар")) {
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
    const matchedBishkekDist = matchLocationInList(lower, BISHKEK_DISTRICTS);
    if (matchedBishkekDist) {
      district = matchedBishkekDist;
      if (!region) {
        region = "BISHKEK";
        city = "Бишкек";
        country = "kyrgyzstan";
      }
    } else {
      const matchedOshDist = matchLocationInList(lower, OSH_CITY_DISTRICTS);
      if (matchedOshDist) {
        district = matchedOshDist;
        if (!region) {
          region = "OSH_CITY";
          city = "Ош";
          country = "kyrgyzstan";
        }
      }
    }
  }

  // Property Type (including Kyrgyz & prefixes: кварт*, комнат*, участ*, коттед*, коммер*, паркин*, гараж*)
  let propertyType = null;
  if (
    lower.includes("жер уй") ||
    lower.includes("жер үй") ||
    /(?:^|[^\wа-яёөүң])(жер\s*[үу]й|үй|уй|дом\w*|таунхаус\w*|особняк\w*|вилл\w*|дач\w*)(?=[^\wа-яёөүң]|$)/i.test(
      lower,
    )
  ) {
    propertyType = "house";
  } else if (lower.includes("коттед")) {
    propertyType = "cottage";
  } else if (lower.includes("участ") || lower.includes("жер")) {
    propertyType = "land";
  } else if (
    lower.includes("коммер") ||
    lower.includes("офис") ||
    lower.includes("склад") ||
    lower.includes("магазин") ||
    lower.includes("помещен")
  ) {
    propertyType = "commercial";
  } else if (lower.includes("гараж") || lower.includes("паркин") || lower.includes("машиномест")) {
    propertyType = "parking";
  } else if (
    lower.includes("комната") ||
    lower.includes("комнату") ||
    lower.includes("бөлмө") ||
    /(?:^|[^\p{L}])комнат(?=$|[^\p{L}])/iu.test(lower)
  ) {
    propertyType =
      lower.includes("кварт") || lower.includes("квртир") || lower.includes("батир")
        ? "apartment"
        : "room";
  } else if (
    lower.includes("кварт") ||
    lower.includes("квртир") ||
    lower.includes("кватир") ||
    lower.includes("kvartir") ||
    lower.includes("батир") ||
    lower.includes("однушк") ||
    lower.includes("двушк") ||
    lower.includes("трешк") ||
    lower.includes("евродвушк") ||
    lower.includes("пентхаус") ||
    lower.includes("апарт") ||
    /(?:^|[^\p{L}])(?:студ(?=$|[^\p{L}])|сту[дл]и\p{L}*(?=$|[^\p{L}]))/iu.test(lower)
  ) {
    propertyType = "apartment";
  }

  // Deal Type ("ижарага алам" -> rent, "сатып алам" / "батир алам" -> sale)
  let dealType = null;
  if (
    lower.includes("аренд") ||
    lower.includes("arenda") ||
    lower.includes("снять") ||
    lower.includes("сниму") ||
    lower.includes("сдается") ||
    lower.includes("посуточн") ||
    lower.includes("помесячн") ||
    lower.includes("длительный срок") ||
    lower.includes("ижара") ||
    lower.includes("жалдайм") ||
    lower.includes("күнүмдүк")
  ) {
    dealType = "rent";
  } else if (
    lower.includes("куп") ||
    lower.includes("kupit") ||
    lower.includes("прод") ||
    lower.includes("сатам") ||
    lower.includes("сатуу") ||
    lower.includes("сатып") ||
    lower.includes("сатылат") ||
    /(?:^|[^\p{L}])алам(?![\p{L}])/iu.test(lower)
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
    lower.includes("однокомнат") ||
    /(?:^|[^\p{L}\d])(?:1|бир|одна|одну)\s*(?:-?комнат\p{L}*|комн\p{L}*|komnat\p{L}*|к(?![\p{L}])|бөлмө\p{L}*)/iu.test(lower)
  ) {
    rooms = 1;
  } else if (
    lower.includes("2 комн") ||
    lower.includes("2-комн") ||
    lower.includes("2 бөлмө") ||
    lower.includes("двушк") ||
    lower.includes("двухкомнат") ||
    /(?:^|[^\p{L}\d])(?:2|эки|две|двух)\s*(?:-?комнат\p{L}*|комн\p{L}*|komnat\p{L}*|к(?![\p{L}])|бөлмө\p{L}*)/iu.test(lower)
  ) {
    rooms = 2;
  } else if (
    lower.includes("3 комн") ||
    lower.includes("3-комн") ||
    lower.includes("3 бөлмө") ||
    lower.includes("трешк") ||
    lower.includes("трехкомнат") ||
    /(?:^|[^\p{L}\d])(?:3|үч|уч|три|трех)\s*(?:-?комнат\p{L}*|комн\p{L}*|komnat\p{L}*|к(?![\p{L}])|бөлмө\p{L}*)/iu.test(lower)
  ) {
    rooms = 3;
  } else if (
    lower.includes("4 комн") ||
    lower.includes("4-комн") ||
    lower.includes("4 бөлмө") ||
    lower.includes("4+") ||
    /(?:четырех|пяти|шести)комнат/.test(lower) ||
    /(?:^|[^\p{L}\d])(?:[4-9]|четыре|пять|шесть|төрт|торт|беш|алты)\s*(?:-?комнат\p{L}*|комн\p{L}*|komnat\p{L}*|к(?![\p{L}])|бөлмө\p{L}*)/iu.test(lower)
  ) {
    rooms = "4+";
  }

  // Currency
  let currency = null;
  if (lower.includes("сом") || lower.includes("kgs") || /\bsom\b/.test(lower)) {
    currency = "KGS";
  } else if (
    lower.includes("$") ||
    lower.includes("доллар") ||
    lower.includes("dollar") ||
    lower.includes("usd") ||
    isTurkey
  ) {
    currency = "USD";
  }

  // Area (квадрат, соток, м2)
  let minArea = null;
  let maxArea = null;

  const sotkaRangeMatch = lower.match(
    /(?:от\s*)?(\d+)\s*(?:до|-)\s*(\d+)\s*(?:соток|сотки|сотых|сот(?![\p{L}]))/iu,
  );
  const singleSotkaMatch = lower.match(/(\d+)\s*(?:соток|сотки|сотых|сот(?![\p{L}]))/iu);

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
      /(?:от\s*)?(\d+)\s*(?:до|-)\s*(\d+)\s*(?:квадрат|чарчы|кв|м2|м²)/iu,
    );
    if (areaRangeMatch) {
      minArea = Number(areaRangeMatch[1]);
      maxArea = Number(areaRangeMatch[2]);
    } else {
      const singleAreaMatch = lower.match(/(\d+)\s*(?:квадрат|чарчы|кв\s*м|кв(?![\p{L}])|м2|м²)/iu);
      if (singleAreaMatch) {
        const val = Number(singleAreaMatch[1]);
        minArea = Math.round(val * 0.9);
        maxArea = Math.round(val * 1.1);
      }
    }
  }

  // Расстояние до пляжа и срочность
  let beachDistanceTo = null;
  const beachMetersMatch = lower.match(
    /(\d+)\s*(?:м(?![\p{L}])|метр\p{L}*)\s*(?:от|до|чейин|аралыкта)?\s*(?:моря|пляж\p{L}*|берег\p{L}*|озер\p{L}*|көл\p{L}*|жээк\p{L}*)|(?:(?:от|до|чейин)\s*(?:моря|пляж\p{L}*|берег\p{L}*|озер\p{L}*|көл\p{L}*|жээк\p{L}*))\s*(\d+)\s*(?:м(?![\p{L}])|метр\p{L}*)/iu,
  );
  if (beachMetersMatch) {
    beachDistanceTo = Number(beachMetersMatch[1] || beachMetersMatch[2]);
  } else if (
    lower.includes("первая береговая") ||
    lower.includes("первой береговой") ||
    lower.includes("береговой линии") ||
    lower.includes("первой линии") ||
    lower.includes("1 линии") ||
    lower.includes("биринчи жээк")
  ) {
    beachDistanceTo = 100;
  } else if (
    lower.includes("у моря") ||
    lower.includes("рядом с пляжем") ||
    lower.includes("недалеко от пляжа") ||
    lower.includes("пляжга жакын")
  ) {
    beachDistanceTo = 500;
  }

  // Price (предварительно вырезаем комнаты, этажи, площадь и расстояние до пляжа)
  const cleanedForPrice = lower
    .replace(/(?:^|[^\p{L}\d])[1-9]\s*(?:-?комнатн\p{L}*|комнат\p{L}*|комн\p{L}*|komnat\p{L}*|к(?![\p{L}])|бөлмө\p{L}*)/giu, " ")
    .replace(/\b\d+\s*(?:этаж\p{L}*|из\s*\d+)/giu, " ")
    .replace(/однушк\p{L}*|двушк\p{L}*|трешк\p{L}*/giu, " ")
    .replace(/(?:до\s*)?\d+\s*(?:м(?![\p{L}])|метр\p{L}*)\s*(?:от|до|чейин|аралыкта)?\s*(?:моря|пляж\p{L}*|берег\p{L}*|озер\p{L}*|көл\p{L}*|жээк\p{L}*)/giu, " ")
    // Число рядом с единицей площади (в т.ч. диапазон «80 до 100 кв») — не цена.
    .replace(AREA_RANGE_RE, " ")
    .replace(AREA_NUMBER_RE, " ");

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
    const maxMatch = cleanedForPrice.match(/(?:до|do|дегенде|чейин)\s*(\d+[\s\d]*)/i);
    if (maxMatch) {
      maxPrice = Number(maxMatch[1].replace(/\s/g, ""));
    } else {
      // Голое число без единицы цены ценой не считаем (тип числа определяет единица, а не размер):
      // нужен маркер цены — «за/бюджет/цена» перед числом либо валюта после него.
      const priced = cleanedForPrice.match(
        /(?:за|бюджет|цена)\s*(\d+[\s\d]*)|(\d+[\s\d]*?)\s*(?:\$|доллар\w*|dollar\w*|usd|сом\w*|som\b|kgs)/i,
      );
      if (priced) {
        maxPrice = Number((priced[1] || priced[2]).replace(/\s/g, ""));
      }
    }
  }

  const urgentOnly =
    lower.includes("срочн") || lower.includes("шашылыш") || lower.includes("тез арада")
      ? true
      : null;

  // Запрос явно не о недвижимости (например, «какая погода в Бишкеке») -> все поля null
  if (
    /(?:^|[^\p{L}])(?:погод\p{L}*|рецепт\p{L}*|анекдот\p{L}*|курс\s+валют\p{L}*)(?![\p{L}])/iu.test(lower) &&
    !propertyType &&
    !dealType &&
    !rooms &&
    minPrice === null &&
    maxPrice === null &&
    minArea === null
  ) {
    return emptySmartSearchFilters();
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
    beachDistanceFrom: null,
    beachDistanceTo,
    urgentOnly,
  };
};

// =======================================================
// Умный Поиск: вызов LLM с таймаутом, дедупликацией и LRU
// =======================================================

export const MAX_INFLIGHT_SEARCHES = 500;
export const INFLIGHT_SEARCHES = new Map();
export const AI_DAILY_USER_LIMIT = Number(process.env.AI_DAILY_USER_LIMIT) || 100;
export const AI_DAILY_GLOBAL_LIMIT = Number(process.env.AI_DAILY_GLOBAL_LIMIT) || 3000;
export const aiSemaphore = new Semaphore({
  maxConcurrent: 8,
  maxQueue: 50,
  acquireTimeoutMs: 10000,
  name: "ai_llm",
});

const LOCAL_PARSER_SOURCE = "local-parser";

const hasClaudeKey = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);

// Единая валидация ответа любого провайдера (LLM или локального парсера): null — ответ непригоден.
const validateProviderResult = (raw, query) => normalizeSmartSearchResult(raw, { query });

// Текст запроса: управляющие символы -> пробел, схлопнутые пробелы, trim.
// eslint-disable-next-line no-control-regex
const cleanPrompt = (value) => value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();

// Локальный разбор на случай недоступности LLM. Никогда не бросает исключение.
const safeLocalParse = (prompt) => {
  try {
    if (typeof prompt !== "string" || !prompt.trim()) return null;
    return validateProviderResult(fallbackParse(prompt), prompt);
  } catch {
    return null;
  }
};

export async function executeAiSearch(prompt) {
  const startedAt = Date.now();
  const preferredProvider = (
    process.env.AI_PROVIDER ||
    (hasClaudeKey() ? "claude" : "gemini")
  ).toLowerCase();

  const claudeModelName = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";
  let filters = null;
  let source = LOCAL_PARSER_SOURCE;

  const tryProvider = async (providerSource, call, label) => {
    try {
      const rawRes = await aiSemaphore.run(() => call(prompt));
      const validated = validateProviderResult(rawRes, prompt);
      if (validated) {
        filters = validated;
        source = providerSource;
      }
    } catch (providerError) {
      console.warn(`${label} warning:`, providerError?.message || providerError);
    }
  };

  const tryClaude = () => (hasClaudeKey() ? tryProvider(claudeModelName, callClaude, "Claude API call") : null);
  const tryGemini = () => (process.env.GEMINI_API_KEY ? tryProvider("gemini-api", callGemini, "Gemini API call") : null);

  if (preferredProvider === "claude" || preferredProvider === "anthropic") {
    await tryClaude();
    if (!filters) await tryGemini();
  } else {
    await tryGemini();
    if (!filters) await tryClaude();
  }

  // Если оба внешних LLM провайдера недоступны, вернули невалидный JSON или сработал таймаут:
  // упрощённый локальный разбор (результат помечается degraded), а если и он не удался — пустые фильтры.
  if (!filters) {
    filters = safeLocalParse(prompt) || emptySmartSearchFilters();
    source = LOCAL_PARSER_SOURCE;
  }

  const degraded = source === LOCAL_PARSER_SOURCE;

  // Метрики для мониторинга без текста запроса (только длина и результат).
  console.info(
    `[smart-search] source=${source} degraded=${degraded} ms=${Date.now() - startedAt} qlen=${prompt.length}`,
  );

  // Сохраняем в кэш для повторных вызовов (ответы LLM на 30 мин, fallbackParse при сбое LLM максимум на 2 мин)
  const ttl = degraded ? FALLBACK_CACHE_TTL_MS : CACHE_TTL_MS;
  // Резолвинг Жилого Комплекса (Entity Resolution) через In-Memory сервис
  let matchedComplex = null;
  try {
    const resolved =
      (await resolveComplexFromText(prompt)) ||
      (filters.searchQuery ? await resolveComplexFromText(filters.searchQuery) : null);

    if (resolved) {
      matchedComplex = resolved.matchedComplex;
      if (!filters.searchQuery) {
        filters.searchQuery = resolved.complexName;
      }
      if (!filters.propertyType && /(?:квартир|батир|однушк|двушк|трешк|бөлмө)/iu.test(prompt)) {
        filters.propertyType = "apartment";
      }
    }
  } catch (lookupErr) {
    console.warn("[aiController] complex lookup warning:", lookupErr?.message || lookupErr);
  }

  setInCache(prompt, filters, ttl, { degraded, matchedComplex });

  return { filters, matchedComplex, source, degraded };
}

export const aiSearch = async (req, res) => {
  try {
    const rawPrompt = req.body?.prompt;

    if (typeof rawPrompt !== "string" || !rawPrompt.trim()) {
      return res.status(400).json({ success: false, message: "Введите текстовый или голосовой запрос" });
    }

    const prompt = cleanPrompt(rawPrompt);

    if (!prompt) {
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
        matchedComplex: SEARCH_CACHE.get(normalizeCacheKey(prompt))?.matchedComplex || null,
        features: extractCategoryFeatures(prompt, cachedFilters),
        source: "cache",
        degraded: SEARCH_CACHE.get(normalizeCacheKey(prompt))?.degraded === true,
      });
    }

    // 1b. Проверка суточных потолков стоимости LLM (на пользователя/IP и общий суточный потолок сервиса)
    if (hasClaudeKey() || process.env.GEMINI_API_KEY) {
      const actorKey = req.user?.id ? `user:${req.user.id}` : `ip:${getClientIp(req)}`;
      const userLimit = Number(process.env.AI_DAILY_USER_LIMIT) || AI_DAILY_USER_LIMIT;
      const globalLimit = Number(process.env.AI_DAILY_GLOBAL_LIMIT) || AI_DAILY_GLOBAL_LIMIT;
      const dayMs = 24 * 60 * 60 * 1000;

      const [userQuota, globalQuota] = await Promise.all([
        checkAndIncrementRateLimit(`quota:ai_search:${actorKey}`, dayMs, userLimit, 1),
        checkAndIncrementRateLimit("quota:ai_search:global", dayMs, globalLimit, 1),
      ]);

      if (!userQuota.allowed || !globalQuota.allowed) {
        const fallbackFilters = safeLocalParse(prompt) || emptySmartSearchFilters();
        return res.json({
          success: true,
          filters: fallbackFilters,
          matchedComplex: null,
          features: extractCategoryFeatures(prompt, fallbackFilters),
          source: LOCAL_PARSER_SOURCE,
          degraded: true,
        });
      }
    }

    // 2. Дедупликация параллельных запросов с одинаковым промптом (Inflight Map)
    const cacheKey = normalizeCacheKey(prompt);
    let inflightPromise = INFLIGHT_SEARCHES.get(cacheKey);

    if (!inflightPromise) {
      inflightPromise = executeAiSearch(prompt).finally(() => {
        INFLIGHT_SEARCHES.delete(cacheKey);
      });
      setBoundedMap(INFLIGHT_SEARCHES, cacheKey, inflightPromise, MAX_INFLIGHT_SEARCHES);
    }

    const { filters, matchedComplex, source, degraded } = await inflightPromise;

    return res.json({
      success: true,
      filters,
      matchedComplex: matchedComplex || null,
      features: extractCategoryFeatures(prompt, filters),
      source,
      degraded,
    });
  } catch (error) {
    // Пользователю никогда не отдаём стектрейс/500: управляемый результат с признаком degraded.
    console.error("AI Search Controller Error:", error?.message || error);
    const fallbackFilters = safeLocalParse(req.body?.prompt) || emptySmartSearchFilters();
    return res.json({
      success: true,
      filters: fallbackFilters,
      matchedComplex: null,
      features: extractCategoryFeatures(req.body?.prompt, fallbackFilters),
      source: LOCAL_PARSER_SOURCE,
      degraded: true,
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
      generated = await aiSemaphore.run(() => tryClaudeDescription()).catch(() => null);
      if (!generated) generated = await aiSemaphore.run(() => tryGeminiDescription()).catch(() => null);
    } else {
      generated = await aiSemaphore.run(() => tryGeminiDescription()).catch(() => null);
      if (!generated) generated = await aiSemaphore.run(() => tryClaudeDescription()).catch(() => null);
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
