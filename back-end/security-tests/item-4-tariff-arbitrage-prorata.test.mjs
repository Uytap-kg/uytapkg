import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DAYS_IN_MONTH,
  getTariffDailyPrice,
  dailyPrice,
  calculateProRata,
  getTariff,
} from "../src/constants/tariffs.js";
import {
  activateSubscription,
  getActiveSubscription,
} from "../src/services/subscriptionsService.js";
import { createPayment } from "../src/controllers/paymentsController.js";
import { supabase } from "../src/config/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DAY_MS = 24 * 60 * 60 * 1000;

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
}

// ==============================================================================
// 1. ТЕСТИРОВАНИЕ РАСЧЁТА ДНЕВНОЙ СТОИМОСТИ (dailyPrice)
// ==============================================================================
test("Item 4: dailyPrice возвращает корректную суточную стоимость тарифов", () => {
  assert.equal(DAYS_IN_MONTH, 30, "В месяце должно быть 30 дней для расчёта тарифов");

  // Дефолтные цены: start = 390, optimal = 790, business = 1890
  const startDaily = dailyPrice("start");
  const optimalDaily = dailyPrice("optimal");
  const businessDaily = dailyPrice("business");

  assert.equal(startDaily, 390 / 30, "START: 390 / 30 = 13 сом/день");
  assert.equal(optimalDaily, 790 / 30, "OPTIMAL: 790 / 30 = 26.33... сом/день");
  assert.equal(businessDaily, 1890 / 30, "BUSINESS: 1890 / 30 = 63 сом/день");

  // Проверка с кастомным pricing объектом
  const customPricing = {
    tariffs: {
      start: { price: 600 },
      optimal: { price: 1200 },
      business: { price: 2400 },
    },
  };
  assert.equal(dailyPrice("start", customPricing), 20, "Кастомный pricing: 600 / 30 = 20");
  assert.equal(dailyPrice("business", customPricing), 80, "Кастомный pricing: 2400 / 30 = 80");
});

// ==============================================================================
// 2. ТЕСТИРОВАНИЕ БИЗНЕС-ПРАВИЛА PRO-RATA (Устранение арбитража)
// ==============================================================================
test("Item 4 (Арбитраж): START на 12 мес при покупке 1 мес БИЗНЕС конвертируется в 104 дня, а не 390 дней (13 месяцев)", () => {
  const now = Date.now();
  // 12 месяцев START = 360 дней остатка
  const currentExpiry = new Date(now + 360 * DAY_MS).toISOString();

  const proRata = calculateProRata({
    currentTariffId: "start",
    newTariffId: "business",
    currentExpiresAt: currentExpiry,
    newMonths: 1,
    nowMs: now,
  });

  // remainingDays = 360
  // dailyPrice(start) = 13
  // remainingValue = 360 * 13 = 4680 сом
  // dailyPrice(business) = 63
  // convertedDays = Math.floor(4680 / 63) = 74 дня
  // newPeriodDays = 1 * 30 = 30 дней
  // totalDays = 74 + 30 = 104 дня
  assert.equal(proRata.sameTariff, false);
  assert.equal(Math.round(proRata.remainingDays), 360);
  assert.equal(proRata.remainingValue, 360 * 13);
  assert.equal(proRata.convertedDays, 74, "360 дней START должны конвертироваться в 74 дня BUSINESS");
  assert.equal(proRata.totalDays, 104, "Итоговый срок должен быть 74 + 30 = 104 дня");

  const diffDays = Math.round((proRata.expiresAt.getTime() - now) / DAY_MS);
  assert.equal(diffDays, 104, "Дата окончания должна быть через 104 дня от NOW");
  assert.notEqual(diffDays, 390, "Уязвимость устранена: срок НЕ должен суммироваться наивно в 390 дней!");
});

test("Item 4 (Pro-Rata): обратный переход (downscale) с БИЗНЕС на СТАРТ пересчитывает остаток в большее число дней", () => {
  const now = Date.now();
  // 30 дней остатка БИЗНЕС
  const currentExpiry = new Date(now + 30 * DAY_MS).toISOString();

  const proRata = calculateProRata({
    currentTariffId: "business",
    newTariffId: "start",
    currentExpiresAt: currentExpiry,
    newMonths: 1,
    nowMs: now,
  });

  // remainingDays = 30
  // dailyPrice(business) = 63
  // remainingValue = 30 * 63 = 1890 сом
  // dailyPrice(start) = 13
  // convertedDays = Math.floor(1890 / 13) = 145 дней
  // newPeriodDays = 1 * 30 = 30 дней
  // totalDays = 145 + 30 = 175 дней
  assert.equal(proRata.convertedDays, 145);
  assert.equal(proRata.totalDays, 175);
  const diffDays = Math.round((proRata.expiresAt.getTime() - now) / DAY_MS);
  assert.equal(diffDays, 175);
});

test("Item 4 (Same Tariff): продление того же тарифа сохраняет все остававшиеся дни и прибавляет ровно оплаченный период", () => {
  const now = Date.now();
  // 15 дней остатка OPTIMAL
  const currentExpiry = new Date(now + 15 * DAY_MS).toISOString();

  const proRata = calculateProRata({
    currentTariffId: "optimal",
    newTariffId: "optimal",
    currentExpiresAt: currentExpiry,
    newMonths: 1,
    nowMs: now,
  });

  assert.equal(proRata.sameTariff, true);
  assert.equal(proRata.convertedDays, 0);
  assert.equal(proRata.totalDays, 30);

  // Итоговая дата должна быть currentExpiry + 30 дней = now + 45 дней
  const diffDays = Math.round((proRata.expiresAt.getTime() - now) / DAY_MS);
  assert.equal(diffDays, 45, "15 дней остатка + 30 дней продления = 45 дней");
});

test("Item 4 (Expired): покупка тарифа при истёкшей подписке отсчитывает срок строго от NOW", () => {
  const now = Date.now();
  // Подписка истекла 5 дней назад
  const currentExpiry = new Date(now - 5 * DAY_MS).toISOString();

  const proRata = calculateProRata({
    currentTariffId: "start",
    newTariffId: "business",
    currentExpiresAt: currentExpiry,
    newMonths: 1,
    nowMs: now,
  });

  assert.equal(proRata.remainingDays, 0);
  assert.equal(proRata.convertedDays, 0);
  assert.equal(proRata.totalDays, 30);
  const diffDays = Math.round((proRata.expiresAt.getTime() - now) / DAY_MS);
  assert.equal(diffDays, 30, "Истёкшая подписка не даёт остаточных дней, ровно 30 дней от NOW");
});

// ==============================================================================
// 3. ТЕСТИРОВАНИЕ ЗАЩИТЫ ИНДИВИДУАЛЬНОЙ ПОДПИСКИ (is_individual === true)
// ==============================================================================
test("Item 4 (Защита индивидуальной подписки): покупка дефолтного тарифа отклоняется с 409 Conflict, если активна индивидуальная подписка", async () => {
  const origFrom = supabase.from;
  const now = Date.now();

  try {
    // Эмулируем активную индивидуальную подписку в БД
    supabase.from = (table) => {
      if (table === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "sub-indiv-1",
                  user_id: "user-indiv-1",
                  tariff_id: "individual_vip",
                  expires_at: new Date(now + 60 * DAY_MS).toISOString(),
                  is_active: true,
                  is_individual: true,
                  custom_name: "Корпоративный VIP",
                  active_listings_limit: 100,
                  vip_boosts_limit: 20,
                  top_boosts_limit: 30,
                },
                error: null,
              }),
            }),
          }),
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
    };

    // 1. Проверяем вызов activateSubscription напрямую
    await assert.rejects(
      async () => {
        await activateSubscription("user-indiv-1", "business", 1);
      },
      (err) => {
        assert.equal(err.status || err.statusCode, 409, "Должен быть HTTP 409 Conflict");
        assert.match(
          err.message,
          /У вас активен персональный корпоративный тариф\. Для смены тарифа обратитесь к администратору/
        );
        return true;
      },
      "activateSubscription должен отклонять покупку дефолтного тарифа при активном индивидуальном"
    );

    // 2. Проверяем эндпоинт createPayment
    const req = {
      user: { id: "user-indiv-1" },
      body: { tariffId: "business", months: 1 },
    };
    const res = createMockRes();

    await createPayment(req, res);
    assert.equal(res.statusCode, 409, "createPayment должен вернуть 409 Conflict");
    assert.match(
      res.body.message,
      /У вас активен персональный корпоративный тариф\. Для смены тарифа обратитесь к администратору/
    );
  } finally {
    supabase.from = origFrom;
  }
});

test("Item 4 (Истёкшая индивидуальная подписка): если срок индивидуального тарифа истёк, покупка дефолтного тарифа разрешена", async () => {
  const origFrom = supabase.from;
  const now = Date.now();
  let upsertedPayload = null;

  try {
    supabase.from = (table) => {
      if (table === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "sub-indiv-expired",
                  user_id: "user-indiv-2",
                  tariff_id: "individual_vip",
                  expires_at: new Date(now - 10 * DAY_MS).toISOString(), // Истекла 10 дней назад
                  is_active: true,
                  is_individual: true,
                },
                error: null,
              }),
            }),
          }),
          upsert: (payload) => {
            upsertedPayload = payload;
            return {
              select: () => ({
                maybeSingle: async () => ({
                  data: { ...payload, id: "sub-new" },
                  error: null,
                }),
              }),
            };
          },
        };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      };
    };

    const result = await activateSubscription("user-indiv-2", "optimal", 1);
    assert.equal(result.tariffId, "optimal");
    assert.ok(upsertedPayload, "Подписка должна быть обновлена");
    assert.equal(upsertedPayload.is_individual, false, "Новая подписка должна иметь is_individual = false");
    assert.equal(upsertedPayload.tariff_id, "optimal");
  } finally {
    supabase.from = origFrom;
  }
});

// ==============================================================================
// 4. ТЕСТИРОВАНИЕ ИДЕМПОТЕНТНОСТИ (paymentId protection)
// ==============================================================================
test("Item 4 (Идемпотентность): повторный вызов activateSubscription с тем же paymentId не продлевает срок вторично", async () => {
  const origFrom = supabase.from;
  const now = Date.now();
  const initialExpiry = new Date(now + 30 * DAY_MS).toISOString();
  let upsertCalled = false;

  try {
    supabase.from = (table) => {
      if (table === "processed_subscription_payments") {
        return {
          select: () => ({
            eq: (col, val) => ({
              maybeSingle: async () => {
                if (val === "PAY-DUP-001") {
                  return { data: { payment_id: "PAY-DUP-001" }, error: null };
                }
                return { data: null, error: null };
              },
            }),
          }),
        };
      }
      if (table === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "sub-1",
                  user_id: "user-dup-test",
                  tariff_id: "optimal",
                  expires_at: initialExpiry,
                  is_active: true,
                  is_individual: false,
                },
                error: null,
              }),
            }),
          }),
          upsert: () => {
            upsertCalled = true;
            return { select: () => ({ maybeSingle: async () => ({ data: {}, error: null }) }) };
          },
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
    };

    const res = await activateSubscription("user-dup-test", "optimal", 1, "PAY-DUP-001");
    assert.equal(res.alreadyProcessed, true, "Должен быть возвращен флаг alreadyProcessed: true");
    assert.equal(res.expiresAt, initialExpiry, "expiresAt не должен измениться");
    assert.equal(upsertCalled, false, "upsert не должен вызываться повторно для уже обработанного paymentId");
  } finally {
    supabase.from = origFrom;
  }
});

// ==============================================================================
// 5. ТЕСТИРОВАНИЕ МИГРАЦИИ 004 И СХЕМЫ schema.sql
// ==============================================================================
test("Item 4 (Миграция 004 и schema.sql): файлы содержат таблицу processed_subscription_payments и функцию activate_subscription_atomic с FOR UPDATE", () => {
  const migrationPath = path.resolve(__dirname, "../src/migrations/004_atomic_subscriptions.sql");
  const schemaPath = path.resolve(__dirname, "../src/schema.sql");

  assert.ok(fs.existsSync(migrationPath), "Файл миграции 004_atomic_subscriptions.sql должен существовать");
  assert.ok(fs.existsSync(schemaPath), "Файл schema.sql должен существовать");

  const migrationContent = fs.readFileSync(migrationPath, "utf-8");
  const schemaContent = fs.readFileSync(schemaPath, "utf-8");

  for (const [name, content] of [["migration", migrationContent], ["schema", schemaContent]]) {
    // 1. Таблица processed_subscription_payments
    assert.match(
      content,
      /CREATE TABLE IF NOT EXISTS processed_subscription_payments/i,
      `В ${name} должна создаваться таблица processed_subscription_payments`
    );
    assert.match(
      content,
      /payment_id VARCHAR\(64\) PRIMARY KEY/i,
      `В ${name} должен быть primary key payment_id VARCHAR(64)`
    );

    // 2. Функция activate_subscription_atomic
    assert.match(
      content,
      /CREATE OR REPLACE FUNCTION activate_subscription_atomic/i,
      `В ${name} должна определяться функция activate_subscription_atomic`
    );
    assert.match(
      content,
      /p_user_id UUID,\s*p_tariff_id VARCHAR,\s*p_days INT,\s*p_payment_id VARCHAR DEFAULT NULL/i,
      `В ${name} функция должна иметь сигнатуру (p_user_id UUID, p_tariff_id VARCHAR, p_days INT, p_payment_id VARCHAR DEFAULT NULL)`
    );

    // 3. Блокировка FOR UPDATE
    assert.match(
      content,
      /FOR UPDATE/i,
      `В ${name} должен использоваться FOR UPDATE для блокировки строки подписки`
    );

    // 4. pg_advisory_xact_lock
    assert.match(
      content,
      /pg_advisory_xact_lock/i,
      `В ${name} должен использоваться pg_advisory_xact_lock для защиты от гонок`
    );

    // 5. Защита индивидуальной подписки
    assert.match(
      content,
      /is_individual = TRUE/i,
      `В ${name} должна быть проверка защиты индивидуального тарифа`
    );
    assert.match(
      content,
      /персональный корпоративный тариф/i,
      `В ${name} должно быть исключение с сообщением о корпоративном тарифе`
    );
  }
});
