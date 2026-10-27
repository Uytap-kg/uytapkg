/**
 * Утилиты для гарантированного ограничения размера (FIFO/LRU) и TTL-очистки
 * структур данных в памяти процесса (Map / Set).
 * Защищают процесс от утечек памяти (OOM) при всплесках трафика и атаках с ротацией IP/ключей.
 */

/**
 * Безопасная вставка в Map с гарантированным верхним пределом размера.
 * Если ключ уже есть — обновляет его позицию (в конец очереди вставки).
 * Если размер Map достиг maxSize — сначала вызывает optional purgeExpiredFn(map),
 * а если размер всё ещё >= maxSize (все записи свежие), вытесняет самые старые ключи по FIFO.
 */
export function setBoundedMap(map, key, value, maxSize = 10000, purgeExpiredFn = null) {
  if (!map || typeof map.set !== "function") return;
  const cap = Number.isFinite(maxSize) && maxSize > 0 ? Math.floor(maxSize) : 10000;

  if (map.has(key)) {
    map.delete(key);
    map.set(key, value);
    return;
  }

  if (map.size >= cap && typeof purgeExpiredFn === "function") {
    try {
      purgeExpiredFn(map);
    } catch {
      // ignore purge errors
    }
  }

  while (map.size >= cap) {
    const oldestKey = map.keys().next().value;
    if (oldestKey === undefined) break;
    map.delete(oldestKey);
  }

  map.set(key, value);
}

/**
 * Очистка просроченных записей из Map и принудительное усечение до maxSize по FIFO.
 */
export function evictExpiredAndCapMap(map, maxSize = 10000, isExpiredFn = null) {
  if (!map || typeof map.entries !== "function") return;
  const cap = Number.isFinite(maxSize) && maxSize > 0 ? Math.floor(maxSize) : 10000;

  if (typeof isExpiredFn === "function") {
    for (const [k, v] of map.entries()) {
      if (isExpiredFn(v, k)) {
        map.delete(k);
      }
    }
  }

  while (map.size > cap) {
    const oldestKey = map.keys().next().value;
    if (oldestKey === undefined) break;
    map.delete(oldestKey);
  }
}

/**
 * Безопасное добавление элемента в Set с верхним пределом размера (FIFO).
 */
export function addBoundedSet(set, value, maxSize = 5000) {
  if (!set || typeof set.add !== "function") return;
  const cap = Number.isFinite(maxSize) && maxSize > 0 ? Math.floor(maxSize) : 5000;

  if (set.has(value)) return;

  while (set.size >= cap) {
    const oldestVal = set.values().next().value;
    if (oldestVal === undefined) break;
    set.delete(oldestVal);
  }

  set.add(value);
}
