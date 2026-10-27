import { supabase } from "../config/db.js";
import { setBoundedMap } from "./boundedMap.js";

/**
 * Пакетная запись горячих счётчиков (просмотры объявлений, просмотры и клики баннеров).
 *
 * Зачем нужно:
 * При всплеске трафика обновление одной и той же строки (UPDATE listings SET views_count = views_count + 1
 * или UPDATE banners SET views_count = views_count + 1) на каждый HTTP GET/POST создаёт блокировки
 * строк (row lock contention) и раздувает мёртвые кортежи (MVCC bloat) в PostgreSQL.
 *
 * Решение:
 * После IP-дедупликации (10 минут) инкременты накапливаются в ограниченном буфере памяти
 * и сбрасываются в БД одним пакетным RPC-вызовом раз в 5 секунд, а также при gracefulShutdown.
 */
const MAX_LISTING_BUFFER_KEYS = 10000;
const MAX_BANNER_BUFFER_KEYS = 5000;
const FLUSH_INTERVAL_MS = Number(process.env.COUNTER_FLUSH_INTERVAL_MS) || 5000;

export const listingViewsBuffer = new Map();
export const bannerStatsBuffer = new Map();

let flushTimer = null;
let isFlushing = false;

export function isBatchCountersEnabled() {
  if (process.env.ENABLE_BATCH_COUNTERS === "false") return false;
  if (process.env.ENABLE_BATCH_COUNTERS_IN_TESTS === "true") return true;
  const isNodeTestRunner =
    Boolean(process.env.NODE_TEST_CONTEXT) ||
    process.argv.some((arg) => arg === "--test" || arg.endsWith(".test.mjs"));
  return !isNodeTestRunner;
}

function ensureFlushTimer() {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    flushAllCounters().catch(() => {});
  }, FLUSH_INTERVAL_MS);
  if (typeof flushTimer.unref === "function") {
    flushTimer.unref();
  }
}

/**
 * Накапливает +1 просмотр объявления в буфере и возвращает актуальное число просмотров
 * с учётом ещё не сброшенной дельты.
 */
export function bufferListingView(listingId, currentViewsCount = 0) {
  if (!listingId) return (currentViewsCount || 0) + 1;
  const prevDelta = listingViewsBuffer.get(listingId) || 0;
  const nextDelta = prevDelta + 1;
  setBoundedMap(listingViewsBuffer, listingId, nextDelta, MAX_LISTING_BUFFER_KEYS);
  ensureFlushTimer();
  return (currentViewsCount || 0) + nextDelta;
}

/**
 * Накапливает +1 просмотр или клик баннера в буфере.
 * @param {string} bannerId
 * @param {'view' | 'click'} stat
 */
export function bufferBannerStat(bannerId, stat) {
  if (!bannerId) return false;
  const current = bannerStatsBuffer.get(bannerId) || { views: 0, clicks: 0 };
  const next = {
    views: current.views + (stat === "view" ? 1 : 0),
    clicks: current.clicks + (stat === "click" ? 1 : 0),
  };
  setBoundedMap(bannerStatsBuffer, bannerId, next, MAX_BANNER_BUFFER_KEYS);
  ensureFlushTimer();
  return true;
}

export async function flushListingViews() {
  if (listingViewsBuffer.size === 0) return 0;

  const entries = Array.from(listingViewsBuffer.entries());
  listingViewsBuffer.clear();

  const deltasObj = Object.fromEntries(entries);

  try {
    const { error } = await supabase.rpc("increment_views_batch", {
      p_deltas: deltasObj,
    });

    if (!error) {
      return entries.length;
    }

    // Фолбэк на поштучный RPC, если миграция increment_views_batch ещё не применена
    for (const [listingId, delta] of entries) {
      for (let i = 0; i < delta; i++) {
        // eslint-disable-next-line no-await-in-loop
        await supabase.rpc("increment_views", { listing_id: listingId });
      }
    }
    return entries.length;
  } catch (err) {
    console.warn("flushListingViews warning:", err?.message || err);
    return 0;
  }
}

export async function flushBannerStats() {
  if (bannerStatsBuffer.size === 0) return 0;

  const entries = Array.from(bannerStatsBuffer.entries());
  bannerStatsBuffer.clear();

  const deltasObj = Object.fromEntries(entries);

  try {
    const { error } = await supabase.rpc("increment_banner_stats_batch", {
      p_deltas: deltasObj,
    });

    if (!error) {
      return entries.length;
    }

    // Фолбэк на поштучный increment_banner_stat
    for (const [bannerId, stats] of entries) {
      for (let i = 0; i < (stats.views || 0); i++) {
        // eslint-disable-next-line no-await-in-loop
        await supabase.rpc("increment_banner_stat", { banner_id: bannerId, stat: "view" });
      }
      for (let i = 0; i < (stats.clicks || 0); i++) {
        // eslint-disable-next-line no-await-in-loop
        await supabase.rpc("increment_banner_stat", { banner_id: bannerId, stat: "click" });
      }
    }
    return entries.length;
  } catch (err) {
    console.warn("flushBannerStats warning:", err?.message || err);
    return 0;
  }
}

export async function flushAllCounters() {
  if (isFlushing) return;
  isFlushing = true;
  try {
    await Promise.all([flushListingViews(), flushBannerStats()]);
  } finally {
    isFlushing = false;
  }
}

export function stopCounterBatcher() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}
