// =======================================================
// Тарифы UyTap PRO и их актуальные цены.
//
// Сами цены редактируются админом (см. utils/pricingSettings.js) и
// хранятся на сервере — но пересчёт суммы к оплате всегда происходит
// здесь же, на бэкенде, по актуальным ценам. Клиент присылает лишь
// tariffId/months, сумма никогда не принимается от клиента напрямую,
// чтобы никто не мог подделать её через query-параметры или тело
// запроса.
// =======================================================

// discountPercent за выбранный период оплаты (в месяцах)
export const PERIOD_DISCOUNTS = {
  1: 0,
  3: 10,
  6: 20,
  12: 35,
};

// `pricing` — объект, полученный через getPricingSettings() (см.
// utils/pricingSettings.js). Передаётся явно, чтобы вызывающий код мог
// один раз получить актуальные цены и переиспользовать их (например, при
// расчёте списка платежей в админке), не дёргая хранилище на каждую запись.
export function getTariff(tariffId, pricing) {
  if (!pricing) return null;

  // pricing.tariffs.<id> — объект { price, activeListings, vipLifts,
  // topLifts } (см. utils/pricingSettings.js); лимиты нужны, чтобы при
  // выдаче/продлении дефолтного тарифа (subscriptionsService.js) знать,
  // сколько объявлений/поднятий полагается пользователю.
  const map = {
    start: { id: "start", title: "СТАРТ", ...pricing.tariffs.start },
    optimal: { id: "optimal", title: "ОПТИМАЛЬНЫЙ", ...pricing.tariffs.optimal },
    business: { id: "business", title: "БИЗНЕС", ...pricing.tariffs.business },
  };

  return map[tariffId] || null;
}

// Считает финальную сумму в сомах (не в копейках) с учётом скидки за период.
export function calculateTariffTotal(tariffId, months, pricing) {
  const tariff = getTariff(tariffId, pricing);
  if (!tariff) return null;

  const period = Number(months);
  if (!Number.isInteger(period) || !(period in PERIOD_DISCOUNTS)) {
    return null;
  }

  const discountPercent = PERIOD_DISCOUNTS[period];
  const pricePerMonth = Math.round(tariff.price * (1 - discountPercent / 100));
  const total = pricePerMonth * period;

  return {
    tariff,
    months: period,
    discountPercent,
    pricePerMonth,
    total,
  };
}

export const DAYS_IN_MONTH = 30;

const DEFAULT_TARIFF_PRICES = {
  start: 390,
  optimal: 790,
  business: 1890,
};

// Расчёт суточной стоимости тарифа (в сомах) для Pro-Rata перерасчёта.
// Принимает либо id тарифа ("start", "optimal", "business") и опциональный pricing,
// либо готовый объект тарифа { price, ... }.
export function getTariffDailyPrice(tariffIdOrTariff, pricing) {
  if (!tariffIdOrTariff) return 0;

  if (typeof tariffIdOrTariff === "object" && typeof tariffIdOrTariff.price === "number") {
    return tariffIdOrTariff.price > 0 ? tariffIdOrTariff.price / DAYS_IN_MONTH : 0;
  }

  const tariffId = String(tariffIdOrTariff).toLowerCase();
  if (pricing) {
    const tariff = getTariff(tariffId, pricing);
    if (tariff && typeof tariff.price === "number" && tariff.price > 0) {
      return tariff.price / DAYS_IN_MONTH;
    }
  }

  const fallbackPrice = DEFAULT_TARIFF_PRICES[tariffId];
  return fallbackPrice ? fallbackPrice / DAYS_IN_MONTH : 0;
}

export const dailyPrice = getTariffDailyPrice;

/**
 * Бизнес-правило Pro-Rata при смене тарифа:
 * Если у пользователя уже есть активная подписка (expires_at > NOW()):
 *   а) Если тариф ТОТ ЖЕ (current.tariff_id === newTariffId):
 *      просто продлеваем: expiresAt = currentExpiry + months * 30 дней.
 *   б) Если тариф ДРУГОЙ:
 *      рассчитываем остаточную стоимость текущей подписки:
 *      remainingDays = (currentExpiry - NOW()) / (24 * 60 * 60 * 1000).
 *      remainingValue = remainingDays * dailyPrice(currentTariff).
 *      Переводим эту стоимость в дни нового тарифа:
 *      convertedDays = Math.floor(remainingValue / dailyPrice(newTariff)).
 *      Итоговый срок = NOW() + (convertedDays + months * 30 дней).
 */
export function calculateProRata({
  currentTariffId,
  newTariffId,
  currentExpiresAt,
  newMonths,
  pricing,
  nowMs = Date.now(),
}) {
  const currentExpiry = currentExpiresAt ? new Date(currentExpiresAt).getTime() : 0;
  const periodMonths = Number(newMonths) || 0;
  const newPeriodDays = periodMonths * DAYS_IN_MONTH;
  const dayMs = 24 * 60 * 60 * 1000;

  // Если подписка отсутствует или уже истекла:
  if (!currentExpiry || currentExpiry <= nowMs) {
    const totalDays = newPeriodDays;
    return {
      sameTariff: false,
      remainingDays: 0,
      remainingValue: 0,
      convertedDays: 0,
      totalDays,
      expiresAt: new Date(nowMs + totalDays * dayMs),
    };
  }

  // Если тариф тот же — просто прибавляем новый период к текущему сроку
  if (currentTariffId === newTariffId) {
    const totalDays = newPeriodDays;
    return {
      sameTariff: true,
      remainingDays: Math.max(0, (currentExpiry - nowMs) / dayMs),
      remainingValue: 0,
      convertedDays: 0,
      totalDays,
      expiresAt: new Date(currentExpiry + newPeriodDays * dayMs),
    };
  }

  // Если тариф другой — Pro-Rata перерасчёт остаточной стоимости
  const remainingDays = Math.max(0, (currentExpiry - nowMs) / dayMs);
  const curDaily = getTariffDailyPrice(currentTariffId, pricing);
  const newDaily = getTariffDailyPrice(newTariffId, pricing);

  const remainingValue = remainingDays * curDaily;
  const convertedDays = newDaily > 0 ? Math.floor(remainingValue / newDaily) : 0;
  const totalDays = convertedDays + newPeriodDays;

  return {
    sameTariff: false,
    remainingDays,
    remainingValue,
    convertedDays,
    totalDays,
    expiresAt: new Date(nowMs + totalDays * dayMs),
  };
}
