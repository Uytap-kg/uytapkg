import { supabase } from "../config/db.js";

// Константа экспортируется для обратной совместимости
export const APP_SETTINGS_BUCKET = "app-settings";

// Лимиты тарифа и расценки по умолчанию.
// Используются строго как fallback при первом старте (когда таблицы в БД пусты),
// а также для нормализации неполных структур.
export const DEFAULT_PRICING = Object.freeze({
  tariffs: {
    start: { price: 390, activeListings: 5, vipLifts: 1, topLifts: 1 },
    optimal: { price: 790, activeListings: 15, vipLifts: 2, topLifts: 3 },
    business: { price: 1890, activeListings: 50, vipLifts: 5, topLifts: 10 },
    developer: {
      mode: "individual",
      value: null,
      activeListings: 100,
      vipLifts: 10,
      topLifts: 20,
    },
  },
  services: {
    vip: 290,
    urgent: 70,
    top: 190,
    instagram: 390,
  },
});

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const int = (value, fallback) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
};

// Нормализует один тарифный план (price + лимиты)
function normalizePlan(raw, fallback) {
  if (raw && typeof raw === "object") {
    return {
      price: num(raw.price, fallback.price),
      activeListings: int(raw.activeListings, fallback.activeListings),
      vipLifts: int(raw.vipLifts, fallback.vipLifts),
      topLifts: int(raw.topLifts, fallback.topLifts),
    };
  }

  return {
    price: num(raw, fallback.price),
    activeListings: fallback.activeListings,
    vipLifts: fallback.vipLifts,
    topLifts: fallback.topLifts,
  };
}

// Приводит произвольные данные к каноническому виду цен платформы
export function normalizePricing(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const t = src.tariffs && typeof src.tariffs === "object" ? src.tariffs : {};
  const s = src.services && typeof src.services === "object" ? src.services : {};
  const dev = t.developer && typeof t.developer === "object" ? t.developer : {};

  const mode = dev.mode === "numeric" ? "numeric" : "individual";

  return {
    tariffs: {
      start: normalizePlan(t.start, DEFAULT_PRICING.tariffs.start),
      optimal: normalizePlan(t.optimal, DEFAULT_PRICING.tariffs.optimal),
      business: normalizePlan(t.business, DEFAULT_PRICING.tariffs.business),
      developer: {
        mode,
        value: mode === "numeric" ? num(dev.value, 0) : null,
        activeListings: int(dev.activeListings, DEFAULT_PRICING.tariffs.developer.activeListings),
        vipLifts: int(dev.vipLifts, DEFAULT_PRICING.tariffs.developer.vipLifts),
        topLifts: int(dev.topLifts, DEFAULT_PRICING.tariffs.developer.topLifts),
      },
    },
    services: {
      vip: num(s.vip, DEFAULT_PRICING.services.vip),
      urgent: num(s.urgent, DEFAULT_PRICING.services.urgent),
      top: num(s.top, DEFAULT_PRICING.services.top),
      instagram: num(s.instagram, DEFAULT_PRICING.services.instagram),
    },
  };
}

let cache = null;
let cacheAt = 0;
const CACHE_TTL_MS = 60 * 1000; // Кэш в памяти до 60 секунд для снижения нагрузки на БД

/**
 * Сброс кэша цен в памяти (для тестов или принудительной инвалидации)
 */
export function invalidatePricingCache() {
  cache = null;
  cacheAt = 0;
}

/**
 * Читает актуальные тарифы и цены из таблиц public.tariff_plans и public.service_prices.
 *
 * Безопасность платежей:
 * При сбое БД (ошибка подключения/сетевой таймаут) функция НЕ откатывается молча на дефолты,
 * а логирует ошибку и выбрасывает исключение — финансовые списания не должны производиться
 * по дефолтным ценам при сбое БД.
 *
 * Исключение: если таблицы успешно опрошены, но в них 0 строк (первый запуск до сидирования),
 * используются дефолтные значения DEFAULT_PRICING с предупреждением в лог.
 */
export async function getPricingSettings() {
  if (cache && Date.now() - cacheAt < CACHE_TTL_MS) {
    return cache;
  }

  const [{ data: tariffRows, error: tariffsError }, { data: serviceRows, error: servicesError }] =
    await Promise.all([
      supabase.from("tariff_plans").select("*"),
      supabase.from("service_prices").select("*"),
    ]);

  if (tariffsError || servicesError) {
    const err = tariffsError || servicesError;
    console.error("DB error fetching pricing settings:", err.message || err);
    throw new Error(`Не удалось загрузить цены из базы данных: ${err.message || err}`);
  }

  const tariffsList = tariffRows || [];
  const servicesList = serviceRows || [];

  // Если обе таблицы пусты — логируем и используем стартовые значения по умолчанию
  if (tariffsList.length === 0 && servicesList.length === 0) {
    console.warn("Таблицы tariff_plans и service_prices пусты, используются начальные значения по умолчанию (DEFAULT_PRICING)");
    const fallback = normalizePricing(DEFAULT_PRICING);
    cache = fallback;
    cacheAt = Date.now();
    return fallback;
  }

  const tariffsById = new Map(tariffsList.map((t) => [t.id, t]));
  const servicesById = new Map(servicesList.map((s) => [s.id, s]));

  const startRow = tariffsById.get("start");
  const optimalRow = tariffsById.get("optimal");
  const businessRow = tariffsById.get("business");
  const devRow = tariffsById.get("developer");

  const rawData = {
    tariffs: {
      start: startRow
        ? {
            price: startRow.price,
            activeListings: startRow.active_listings_limit,
            vipLifts: startRow.vip_boosts_limit,
            topLifts: startRow.top_boosts_limit,
          }
        : undefined,
      optimal: optimalRow
        ? {
            price: optimalRow.price,
            activeListings: optimalRow.active_listings_limit,
            vipLifts: optimalRow.vip_boosts_limit,
            topLifts: optimalRow.top_boosts_limit,
          }
        : undefined,
      business: businessRow
        ? {
            price: businessRow.price,
            activeListings: businessRow.active_listings_limit,
            vipLifts: businessRow.vip_boosts_limit,
            topLifts: businessRow.top_boosts_limit,
          }
        : undefined,
      developer: devRow
        ? {
            mode: devRow.price_mode,
            value: devRow.price,
            activeListings: devRow.active_listings_limit,
            vipLifts: devRow.vip_boosts_limit,
            topLifts: devRow.top_boosts_limit,
          }
        : undefined,
    },
    services: {
      vip: servicesById.get("vip")?.price,
      urgent: servicesById.get("urgent")?.price,
      top: servicesById.get("top")?.price,
      instagram: servicesById.get("instagram")?.price,
    },
  };

  const result = normalizePricing(rawData);
  cache = result;
  cacheAt = Date.now();
  return result;
}

/**
 * Сохраняет новые цены тарифов и разовых услуг в таблицы public.tariff_plans
 * и public.service_prices через операцию upsert по первичному ключу id.
 * Инвалидирует кэш в памяти.
 */
export async function savePricingSettings(pricingInput) {
  const normalized = normalizePricing(pricingInput);
  const now = new Date().toISOString();

  const tariffRows = [
    {
      id: "start",
      title: "СТАРТ",
      price: normalized.tariffs.start.price,
      price_mode: "numeric",
      active_listings_limit: normalized.tariffs.start.activeListings,
      vip_boosts_limit: normalized.tariffs.start.vipLifts,
      top_boosts_limit: normalized.tariffs.start.topLifts,
      updated_at: now,
    },
    {
      id: "optimal",
      title: "ОПТИМАЛЬНЫЙ",
      price: normalized.tariffs.optimal.price,
      price_mode: "numeric",
      active_listings_limit: normalized.tariffs.optimal.activeListings,
      vip_boosts_limit: normalized.tariffs.optimal.vipLifts,
      top_boosts_limit: normalized.tariffs.optimal.topLifts,
      updated_at: now,
    },
    {
      id: "business",
      title: "БИЗНЕС",
      price: normalized.tariffs.business.price,
      price_mode: "numeric",
      active_listings_limit: normalized.tariffs.business.activeListings,
      vip_boosts_limit: normalized.tariffs.business.vipLifts,
      top_boosts_limit: normalized.tariffs.business.topLifts,
      updated_at: now,
    },
    {
      id: "developer",
      title: "ЗАСТРОЙЩИК",
      price:
        normalized.tariffs.developer.mode === "numeric"
          ? normalized.tariffs.developer.value
          : null,
      price_mode: normalized.tariffs.developer.mode,
      active_listings_limit: normalized.tariffs.developer.activeListings,
      vip_boosts_limit: normalized.tariffs.developer.vipLifts,
      top_boosts_limit: normalized.tariffs.developer.topLifts,
      updated_at: now,
    },
  ];

  const serviceRows = [
    {
      id: "vip",
      title: "VIP",
      price: normalized.services.vip,
      price_period: "day",
      updated_at: now,
    },
    {
      id: "urgent",
      title: "Срочно",
      price: normalized.services.urgent,
      price_period: "day",
      updated_at: now,
    },
    {
      id: "top",
      title: "ТОП",
      price: normalized.services.top,
      price_period: "day",
      updated_at: now,
    },
    {
      id: "instagram",
      title: "Instagram",
      price: normalized.services.instagram,
      price_period: "once",
      updated_at: now,
    },
  ];

  const [{ error: tariffError }, { error: serviceError }] = await Promise.all([
    supabase.from("tariff_plans").upsert(tariffRows, { onConflict: "id" }),
    supabase.from("service_prices").upsert(serviceRows, { onConflict: "id" }),
  ]);

  if (tariffError || serviceError) {
    const err = tariffError || serviceError;
    console.error("DB error saving pricing settings:", err.message || err);
    throw new Error(err.message || "Не удалось сохранить настройки цен в базу данных");
  }

  cache = normalized;
  cacheAt = Date.now();
  return normalized;
}
