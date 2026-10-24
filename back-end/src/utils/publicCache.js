import { setBoundedMap, evictExpiredAndCapMap } from "./boundedMap.js";

/**
 * Короткоживущий кэш чтения (TTL 30–60 с) для редко меняющихся публичных данных:
 * - activeBanners (GET /api/banners)
 * - complexes (GET /api/complexes, GET /api/complexes/:id)
 * - developers (GET /api/developers, GET /api/developers/:id)
 * - lawyers (GET /api/lawyers)
 *
 * Гарантирует:
 * 1. Ограничение размера каждого пространства имён (MAX_KEYS_PER_NAMESPACE = 200).
 * 2. Мгновенный сброс (invalidatePublicCache) при любом изменении через админку или кабинет застройщика.
 * 3. В окружении unit-тестов (NODE_TEST_CONTEXT) кэширование по умолчанию отключено,
 *    чтобы тесты с подменой supabase.from не получали ответы от предыдущих тестов,
 *    но может быть включено через ENABLE_PUBLIC_CACHE_IN_TESTS="true".
 */
const MAX_KEYS_PER_NAMESPACE = 200;
const namespaces = new Map();

function isPublicCacheEnabled() {
  if (process.env.ENABLE_PUBLIC_CACHE_IN_TESTS === "true") return true;
  const isNodeTestRunner =
    Boolean(process.env.NODE_TEST_CONTEXT) ||
    process.argv.some((arg) => arg === "--test" || arg.endsWith(".test.mjs"));
  return !isNodeTestRunner;
}

function getNamespaceMap(namespace) {
  let map = namespaces.get(namespace);
  if (!map) {
    map = new Map();
    namespaces.set(namespace, map);
  }
  return map;
}

/**
 * Читает значение из кэша или вычисляет через fetcher() и сохраняет на ttlMs.
 *
 * @param {string} namespace - Пространство имён ('banners' | 'complexes' | 'developers' | 'lawyers')
 * @param {string} key - Ключ запроса (например, сериализованные query-параметры)
 * @param {number} ttlMs - Время жизни записи в миллисекундах (30000..60000)
 * @param {() => Promise<any>} fetcher - Асинхронная функция получения данных
 */
export async function getOrSetPublicCache(namespace, key, ttlMs, fetcher) {
  if (!isPublicCacheEnabled()) {
    return fetcher();
  }

  const map = getNamespaceMap(namespace);
  const now = Date.now();
  const cached = map.get(key);

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  if (cached) {
    map.delete(key);
  }

  const value = await fetcher();

  evictExpiredAndCapMap(
    map,
    MAX_KEYS_PER_NAMESPACE - 1,
    (entry) => !entry || entry.expiresAt <= now
  );
  setBoundedMap(
    map,
    key,
    { value, expiresAt: now + ttlMs },
    MAX_KEYS_PER_NAMESPACE
  );

  return value;
}

/**
 * Мгновенно сбрасывает кэш указанного пространства имён (или всех пространств, если не передано).
 *
 * @param {string} [namespace]
 */
export function invalidatePublicCache(namespace) {
  if (!namespace) {
    for (const map of namespaces.values()) {
      map.clear();
    }
    return;
  }
  const map = namespaces.get(namespace);
  if (map) {
    map.clear();
  }
}
