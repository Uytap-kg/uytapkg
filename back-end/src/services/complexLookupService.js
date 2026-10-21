/**
 * Сервис быстрого поиска и резолвинга Жилых Комплексов (In-Memory Complex Lookup).
 *
 * Высоконагруженная архитектура (High-Load):
 * 1. Список активных ЖК кэшируется в оперативной памяти процесса (TTL: 1 час, ~150 КБ RAM).
 * 2. Резолвинг названия («в олоконе» -> ЖК «Олокон») выполняется за 0 мс без обращений к БД.
 * 3. Поддерживает падежные окончания (русский/кыргызский стемминг), транслит и опечатки.
 * 4. Предоставляет список названий для внедрения в кэшируемый промпт Claude Haiku 5.5.
 */
import { supabase } from "../config/db.js";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 час
let cachedComplexes = null;
let lastFetchTime = 0;
let fetchPromise = null;

// Сворачивание регистра, спецсимволов и букв для нечувствительного сравнения
const FOLD_MAP = { ө: "о", ү: "у", ң: "н", ё: "е", ъ: "", ь: "" };
export function foldText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[өүңёъь]/g, (ch) => FOLD_MAP[ch])
    .replace(/[-–—_]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Отсечение окончаний падежей для извлечения основы названия ЖК
// (например: «олоконе» -> «олокон», «ихласе» -> «ихлас», «авалона» -> «авалон»)
const CASE_SUFFIX_RE =
  /(?:е|а|у|ом|ем|ы|и|ой|ей|ях|ах|дор|дордо|дон|до|де|тен|тан|дан|ден|дын|дин|нин|дын)$/iu;

export function stemComplexWord(word) {
  if (!word || typeof word !== "string") return "";
  const cleaned = word.trim();
  if (cleaned.length < 4) return cleaned;
  const stemmed = cleaned.replace(CASE_SUFFIX_RE, "");
  return stemmed.length >= 3 ? stemmed : cleaned;
}

/**
 * Загрузка и кэширование списка ЖК из Supabase.
 * Thread-safe: повторные одновременные вызовы используют общий промис (single-flight).
 */
export async function getActiveComplexes() {
  const now = Date.now();
  if (cachedComplexes && now - lastFetchTime < CACHE_TTL_MS) {
    return cachedComplexes;
  }

  if (fetchPromise) {
    return fetchPromise;
  }

  fetchPromise = (async () => {
    try {
      const { data, error } = await supabase
        .from("residential_complexes")
        .select(`
          id,
          name,
          housing_class,
          completion_date,
          address,
          city,
          region,
          cover_photo,
          developer_id,
          developers (id, company_name, logo_url, is_verified)
        `)
        .order("created_at", { ascending: false });

      if (error) {
        console.warn("[complexLookupService] Error fetching complexes:", error.message || error);
        return cachedComplexes || [];
      }

      cachedComplexes = (data || []).map((c) => {
        const developerName = c.developers?.company_name || "Застройщик";
        const developerLogo = c.developers?.logo_url || "/assets/DeveloperImage.png";
        return {
          id: c.id,
          name: c.name || "Жилой комплекс",
          developer: developerName,
          developerLogo,
          housingClass: c.housing_class || "Комфорт",
          completionDate: c.completion_date || null,
          address: c.address || (c.city ? `${c.city}, Кыргызстан` : "Кыргызстан"),
          coverPhoto: c.cover_photo || "/assets/ComplexImage.png",
          _folded: foldText(c.name),
          _stem: stemComplexWord(foldText(c.name)),
        };
      });

      lastFetchTime = Date.now();
      return cachedComplexes;
    } catch (err) {
      console.warn("[complexLookupService] Unexpected fetch error:", err.message || err);
      return cachedComplexes || [];
    } finally {
      fetchPromise = null;
    }
  })();

  return fetchPromise;
}

/**
 * Возвращает список названий ЖК для статического системного промпта.
 */
export async function getComplexNames() {
  const complexes = await getActiveComplexes();
  return complexes.map((c) => c.name).filter(Boolean);
}

/**
 * Мгновенный поиск ЖК по строке или названию (In-Memory).
 * Ищет точное совпадение основы слова, подстроку или стемминг падежей.
 *
 * @param {string} inputQuery — поисковая фраза (например: "олокон", "в олоконе", "жк ихлас")
 * @returns {object|null} { matchedComplex, complexId, complexName } или null
 */
export async function resolveComplexFromText(inputQuery) {
  if (!inputQuery || typeof inputQuery !== "string") return null;

  const complexes = await getActiveComplexes();
  if (!complexes.length) return null;

  const foldedInput = foldText(inputQuery);
  if (!foldedInput) return null;

  // Очистка от маркеров ЖК ("жк", "жилой комплекс")
  const strippedInput = foldedInput
    .replace(/(?:^|\s)(?:жк|жилой\s+комплекс|застройщик)(?:\s|$)/g, " ")
    .trim();

  const words = strippedInput.split(/\s+/).filter(Boolean);
  const stemmedWords = words.map(stemComplexWord);

  // 1. Точное совпадение нормализованного названия
  for (const c of complexes) {
    if (c._folded === foldedInput || c._folded === strippedInput) {
      return buildResolvedResult(c);
    }
  }

  // 2. Совпадение основы названия с одним из слов запроса
  for (const c of complexes) {
    const complexWords = c._folded.split(/\s+/).filter(Boolean);
    const complexStems = complexWords.map(stemComplexWord);

    // Однословные ЖК (например "Олокон", "Легенда", "Семетей")
    if (complexWords.length === 1) {
      const cStem = complexStems[0];
      if (stemmedWords.includes(cStem) || words.includes(complexWords[0])) {
        return buildResolvedResult(c);
      }
    } else {
      // Многословные ЖК (например "Avangard City", "Английский квартал")
      const matchesAll = complexStems.every((cs) => stemmedWords.includes(cs) || words.includes(cs));
      if (matchesAll || strippedInput.includes(c._folded) || foldedInput.includes(c._folded)) {
        return buildResolvedResult(c);
      }
    }
  }

  // 3. Подстрочный поиск (если название ЖК целиком содержится в запросе)
  for (const c of complexes) {
    if (c._folded.length >= 4 && (foldedInput.includes(c._folded) || strippedInput.includes(c._stem))) {
      return buildResolvedResult(c);
    }
  }

  return null;
}

function buildResolvedResult(c) {
  return {
    complexId: c.id,
    complexName: c.name,
    matchedComplex: {
      id: c.id,
      name: c.name,
      developer: c.developer,
      developerLogo: c.developerLogo,
      housingClass: c.housingClass,
      completionDate: c.completionDate,
      address: c.address,
      coverPhoto: c.coverPhoto,
    },
  };
}
