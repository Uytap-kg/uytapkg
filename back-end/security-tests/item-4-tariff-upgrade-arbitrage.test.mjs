import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  activateSubscription,
  getActiveSubscription,
} from "../src/services/subscriptionsService.js";
import {
  calculateProRata,
  getTariffDailyPrice,
  calculateTariffTotal,
  DAYS_IN_MONTH,
} from "../src/constants/tariffs.js";
import { supabase } from "../src/config/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Мок хранилища для предотвращения сетевого таймаута при запросе getPricingSettings()
if (supabase.storage) {
  supabase.storage.from = () => ({
    download: async () => ({ data: null, error: new Error("Storage mocked for offline testing") }),
  });
}

// ==============================================================================
// 1. КРИТЕРИЙ 1: Арбитраж и формула Pro-Rata при смене тарифа
// ==============================================================================

test("Критерий 1 (а): calculateProRata — математическая защита от арбитража START (12 мес) -> БИЗНЕС (1 мес)", () => {
  const nowMs = Date.UTC(2026, 9, 10, 0, 0, 0); // Фиксированная дата
  const currentExpiresAt = new Date(nowMs + 360 * 24 * 60 * 60 * 1000).toISOString(); // 12 мес = 360 дней

  // START: 390 сом/мес = 13 сом/день. Остаток: 360 * 13 = 4680 сом
  // BUSINESS: 1890 сом/мес = 63 сом/день
  // Конвертация: Math.floor(4680 / 63) = 74 дня БИЗНЕСА
  // Куплен 1 месяц БИЗНЕСА = 30 дней
  // Итоговый срок БИЗНЕСА: 74 + 30 = 104 дня (~3.46 мес)
  const result = calculateProRata({
    currentTariffId: "start",
    newTariffId: "business",
    currentExpiresAt,
    newMonths: 1,
    nowMs,
  });

  assert.equal(result.sameTariff, false, "sameTariff должен быть false при смене start -> business");
  assert.equal(result.remainingDays, 360, "Остаток в днях должен быть 360");
  assert.equal(result.remainingValue, 4680, "Остаточная стоимость: 360 * 13 = 4680 сом");
  assert.equal(result.convertedDays, 74, "Конвертированные дни: 4680 / 63 = 74 дня");
  assert.equal(result.totalDays, 104, "Итоговый срок должен быть строго 104 дня, а НЕ 390 дней (13 месяцев)");

  // Проверяем, что дата окончания ровно через 104 дня от nowMs
  const expectedExpiry = new Date(nowMs + 104 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(result.expiresAt.toISOString(), expectedExpiry);

  // Дополнительная проверка предотвращения финансовой уязвимости:
  // Без pro-rata клиент получил бы 390 дней БИЗНЕСА (стоимостью 24 570 сом) за 6 570 сом (4680 + 1890)
  const unearnedDaysWithoutProRata = 390 - result.totalDays;
  assert.equal(unearnedDaysWithoutProRata, 286, "Формула предотвращает получение 286 неоплаченных дней БИЗНЕСА");
});

test("Критерий 1 (б): calculateProRata — симметричный перерасчёт при даунгрейде БИЗНЕС (1 мес) -> СТАРТ (1 мес)", () => {
  const nowMs = Date.UTC(2026, 9, 10, 0, 0, 0);
  const currentExpiresAt = new Date(nowMs + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 дней БИЗНЕСА

  // BUSINESS: 63 сом/день. Остаток: 30 * 63 = 1890 сом
  // START: 13 сом/день. Конвертация: 1890 / 13 = 145 дней
  // Куплен 1 месяц СТАРТА = 30 дней
  // Итоговый срок СТАРТА: 145 + 30 = 175 дней
  const result = calculateProRata({
    currentTariffId: "business",
    newTariffId: "start",
    currentExpiresAt,
    newMonths: 1,
    nowMs,
  });

  assert.equal(result.sameTariff, false);
  assert.equal(result.remainingDays, 30);
  assert.equal(result.remainingValue, 1890);
  assert.equal(result.convertedDays, 145);
  assert.equal(result.totalDays, 175);
});

test("Критерий 1 (в): calculateProRata — продление того же тарифа (sameTariff) просто прибавляет дни к текущему сроку", () => {
  const nowMs = Date.UTC(2026, 9, 10, 0, 0, 0);
  const currentExpiresAt = new Date(nowMs + 20 * 24 * 60 * 60 * 1000).toISOString(); // Осталось 20 дней

  const result = calculateProRata({
    currentTariffId: "optimal",
    newTariffId: "optimal",
    currentExpiresAt,
    newMonths: 2, // +60 дней
    nowMs,
  });

  assert.equal(result.sameTariff, true);
  assert.equal(result.remainingDays, 20);
  assert.equal(result.totalDays, 60);

  // Итоговый срок: currentExpiresAt + 60 дней = nowMs + 80 дней
  const expectedExpiry = new Date(nowMs + 80 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(result.expiresAt.toISOString(), expectedExpiry);
});

test("Критерий 1 (г): activateSubscription — интеграционный тест: покупка START 12 мес + БИЗНЕС 1 мес даёт ~104 дня, а НЕ 13 месяцев", async () => {
  const origFrom = supabase.from;
  const origRpc = supabase.rpc;

  const userId = "user-arbitrage-test";
  const now = Date.now();
  const initialExpiresAt = new Date(now + 360 * 24 * 60 * 60 * 1000).toISOString(); // 12 мес START

  let currentSub = {
    id: "sub-arb-001",
    user_id: userId,
    tariff_id: "start",
    is_active: true,
    is_individual: false,
    expires_at: initialExpiresAt,
  };

  try {
    supabase.from = (table) => {
      if (table === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { ...currentSub }, error: null }),
            }),
          }),
          upsert: (payload) => {
            currentSub = { ...currentSub, ...payload };
            return {
              select: () => ({
                maybeSingle: async () => ({ data: { ...currentSub }, error: null }),
              }),
            };
          },
        };
      }
      if (table === "processed_subscription_payments") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
          insert: async () => ({ error: null }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    };

    supabase.rpc = async (fn, params) => {
      if (fn === "activate_subscription_atomic") {
        assert.equal(params.p_tariff_id, "business");
        assert.equal(params.p_days, 104, "В RPC должно быть передано ровно 104 дня по pro-rata формуле");

        const newExpiry = new Date(now + params.p_days * 24 * 60 * 60 * 1000).toISOString();
        currentSub = {
          ...currentSub,
          tariff_id: params.p_tariff_id,
          expires_at: newExpiry,
          is_active: true,
        };
        return { data: { ...currentSub }, error: null };
      }
      throw new Error(`Unexpected RPC: ${fn}`);
    };

    const res = await activateSubscription(userId, "business", 1, "pay-arb-001");

    assert.equal(res.tariffId, "business", "Тариф должен смениться на business");

    const daysFromNow = (new Date(res.expiresAt).getTime() - now) / (24 * 60 * 60 * 1000);
    // Проверяем: срок составляет около 104 дней, существенно меньше 390 дней (13 месяцев)
    assert.ok(
      daysFromNow >= 103 && daysFromNow <= 105,
      `Срок должен составлять ~104 дня, получено: ${daysFromNow.toFixed(1)} дней`
    );
    assert.ok(
      daysFromNow < 120,
      `Срок не должен превышать 120 дней (арбитраж 13 месяцев предотвращён)`
    );
    assert.equal(currentSub.tariff_id, "business");
  } finally {
    supabase.from = origFrom;
    supabase.rpc = origRpc;
  }
});

// ==============================================================================
// 2. КРИТЕРИЙ 2: Параллельные активации одного тарифа (Promise.all)
// ==============================================================================

test("Критерий 2 (а): Параллельные активации (Promise.all) — две одновременные активации 1 мес + 1 мес суммируют оба периода (+60 дней) без потери данных", async () => {
  const origFrom = supabase.from;
  const origRpc = supabase.rpc;

  const userId = "user-parallel-test";
  const now = Date.now();

  let currentSub = null;
  const processedPayments = new Set();

  // Моделируем транзакционную advisory lock блокировку PostgreSQL на уровне пользователя
  let userLock = Promise.resolve();

  try {
    supabase.from = (table) => {
      if (table === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: currentSub ? { ...currentSub } : null, error: null }),
            }),
          }),
        };
      }
      if (table === "processed_subscription_payments") {
        return {
          select: () => ({
            eq: (col, val) => ({
              maybeSingle: async () => ({
                data: processedPayments.has(val) ? { payment_id: val } : null,
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    };

    supabase.rpc = async (fn, params) => {
      if (fn === "activate_subscription_atomic") {
        // Очередь блокировок (эмуляция pg_advisory_xact_lock / FOR UPDATE)
        const prev = userLock;
        let release;
        userLock = new Promise((r) => { release = r; });
        await prev;

        try {
          // Имитация случайной сетевой задержки PostgreSQL I/O
          await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 10) + 1));

          if (params.p_payment_id && processedPayments.has(params.p_payment_id)) {
            return { data: { ...currentSub }, error: null };
          }
          if (params.p_payment_id) {
            processedPayments.add(params.p_payment_id);
          }

          const curTime = Date.now();
          const curExpiry = currentSub?.expires_at ? new Date(currentSub.expires_at).getTime() : 0;
          let newExpiryTime;

          if (currentSub && currentSub.is_active && curExpiry > curTime) {
            if (currentSub.tariff_id === params.p_tariff_id) {
              // Тот же тариф: прибавляем к текущему сроку
              newExpiryTime = curExpiry + params.p_days * 24 * 60 * 60 * 1000;
            } else {
              newExpiryTime = curTime + params.p_days * 24 * 60 * 60 * 1000;
            }
          } else {
            // Первая активация: от текущего времени
            newExpiryTime = curTime + params.p_days * 24 * 60 * 60 * 1000;
          }

          currentSub = {
            id: "sub-parallel-1",
            user_id: params.p_user_id,
            tariff_id: params.p_tariff_id,
            expires_at: new Date(newExpiryTime).toISOString(),
            is_active: true,
            is_individual: false,
          };

          return { data: { ...currentSub }, error: null };
        } finally {
          release();
        }
      }
      throw new Error(`Unexpected RPC: ${fn}`);
    };

    // Два параллельных запроса активации по 1 месяцу (30 дней каждый) через Promise.all
    const results = await Promise.all([
      activateSubscription(userId, "optimal", 1, "pay-concurrent-01"),
      activateSubscription(userId, "optimal", 1, "pay-concurrent-02"),
    ]);

    assert.equal(results.length, 2);
    assert.equal(results[0].tariffId, "optimal");
    assert.equal(results[1].tariffId, "optimal");

    // Итоговый срок в БД должен составлять ровно 60 дней (+- 2 секунды)
    const totalDaysFromNow = (new Date(currentSub.expires_at).getTime() - now) / (24 * 60 * 60 * 1000);
    assert.ok(
      totalDaysFromNow >= 59.8 && totalDaysFromNow <= 60.2,
      `Периоды должны быть корректно суммированы до 60 дней, получено: ${totalDaysFromNow.toFixed(2)}`
    );

    // Ни один платёж не потерян
    assert.equal(processedPayments.size, 2, "Оба платежа должны быть зафиксированы в БД");
  } finally {
    supabase.from = origFrom;
    supabase.rpc = origRpc;
  }
});

test("Критерий 2 (б): Параллельные активации 3 запросов (1 мес + 1 мес + 1 мес) аккумулируют ровно 90 дней", async () => {
  const origFrom = supabase.from;
  const origRpc = supabase.rpc;

  const userId = "user-parallel-3-test";
  const now = Date.now();

  let currentSub = null;
  const processedPayments = new Set();
  let userLock = Promise.resolve();

  try {
    supabase.from = (table) => {
      if (table === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: currentSub ? { ...currentSub } : null, error: null }),
            }),
          }),
        };
      }
      if (table === "processed_subscription_payments") {
        return {
          select: () => ({
            eq: (col, val) => ({
              maybeSingle: async () => ({
                data: processedPayments.has(val) ? { payment_id: val } : null,
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    };

    supabase.rpc = async (fn, params) => {
      if (fn === "activate_subscription_atomic") {
        const prev = userLock;
        let release;
        userLock = new Promise((r) => { release = r; });
        await prev;

        try {
          await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 5) + 1));
          if (params.p_payment_id) processedPayments.add(params.p_payment_id);

          const curTime = Date.now();
          const curExpiry = currentSub?.expires_at ? new Date(currentSub.expires_at).getTime() : 0;
          let newExpiryTime = curExpiry > curTime
            ? curExpiry + params.p_days * 24 * 60 * 60 * 1000
            : curTime + params.p_days * 24 * 60 * 60 * 1000;

          currentSub = {
            id: "sub-p3",
            user_id: params.p_user_id,
            tariff_id: params.p_tariff_id,
            expires_at: new Date(newExpiryTime).toISOString(),
            is_active: true,
          };
          return { data: { ...currentSub }, error: null };
        } finally {
          release();
        }
      }
      throw new Error(`Unexpected RPC: ${fn}`);
    };

    await Promise.all([
      activateSubscription(userId, "optimal", 1, "p3-1"),
      activateSubscription(userId, "optimal", 1, "p3-2"),
      activateSubscription(userId, "optimal", 1, "p3-3"),
    ]);

    const totalDays = (new Date(currentSub.expires_at).getTime() - now) / (24 * 60 * 60 * 1000);
    assert.ok(
      totalDays >= 89.8 && totalDays <= 90.2,
      `Периоды 3-х параллельных активаций должны суммироваться в 90 дней, получено: ${totalDays.toFixed(2)}`
    );
    assert.equal(processedPayments.size, 3);
  } finally {
    supabase.from = origFrom;
    supabase.rpc = origRpc;
  }
});

// ==============================================================================
// 3. КРИТЕРИЙ 3: Защита индивидуального тарифа (is_individual = true)
// ==============================================================================

test("Критерий 3 (а): Защита индивидуального тарифа — активный тариф с is_individual=true блокирует активацию стандартного тарифа с ошибкой 409 Conflict", async () => {
  const origFrom = supabase.from;
  const origRpc = supabase.rpc;

  const userId = "user-indiv-active";
  const futureExpiry = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

  const individualSubscription = {
    id: "sub-indiv-001",
    user_id: userId,
    tariff_id: "developer",
    custom_name: "Корпоративный VIP Застройщик",
    is_active: true,
    is_individual: true, // ИНДИВИДУАЛЬНЫЙ ТАРИФ
    active_listings_limit: 150,
    vip_boosts_limit: 20,
    top_boosts_limit: 30,
    expires_at: futureExpiry,
  };

  let dbWasUpdated = false;

  try {
    supabase.from = (table) => {
      if (table === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { ...individualSubscription }, error: null }),
            }),
          }),
          upsert: async () => {
            dbWasUpdated = true;
            return { select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) };
          },
        };
      }
      if (table === "processed_subscription_payments") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    };

    supabase.rpc = async () => {
      dbWasUpdated = true;
      return { data: null, error: new Error("RPC should not be called") };
    };

    // Попытка купить стандартный тариф "optimal" поверх активного индивидуального
    await assert.rejects(
      async () => {
        await activateSubscription(userId, "optimal", 1, "pay-attack-indiv");
      },
      (err) => {
        assert.equal(err.status || err.statusCode, 409, "Должен быть возвращён HTTP статус 409");
        assert.equal(err.code, "INDIVIDUAL_TARIFF_ACTIVE", "Код ошибки должен быть INDIVIDUAL_TARIFF_ACTIVE");
        assert.match(
          err.message,
          /персональный корпоративный тариф.*обратитесь к администратору/,
          "Сообщение об ошибке должно информировать о персональном тарифе"
        );
        return true;
      }
    );

    // Проверяем, что в БД ничего не было затерто
    assert.equal(dbWasUpdated, false, "Запись в БД не должна быть изменена при 409 Conflict");
  } finally {
    supabase.from = origFrom;
    supabase.rpc = origRpc;
  }
});

test("Критерий 3 (б): Защита индивидуального тарифа на уровне RPC — при ошибке базы данных генерируется 409 Conflict", async () => {
  const origFrom = supabase.from;
  const origRpc = supabase.rpc;

  const userId = "user-indiv-rpc-fail";

  try {
    supabase.from = (table) => {
      if (table === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              // На клиенте подписка не отобразилась, но в БД на уровне RPC обнаружена
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      if (table === "processed_subscription_payments") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          }),
        };
      }
    };

    supabase.rpc = async (fn) => {
      if (fn === "activate_subscription_atomic") {
        return {
          data: null,
          error: {
            message: "У вас активен персональный корпоративный тариф. Для смены тарифа обратитесь к администратору",
            code: "P0001",
          },
        };
      }
    };

    await assert.rejects(
      async () => {
        await activateSubscription(userId, "optimal", 1);
      },
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, "INDIVIDUAL_TARIFF_ACTIVE");
        return true;
      }
    );
  } finally {
    supabase.from = origFrom;
    supabase.rpc = origRpc;
  }
});

test("Критерий 3 (в): Если индивидуальный тариф уже истёк (expires_at < NOW), активация стандартного тарифа разрешена", async () => {
  const origFrom = supabase.from;
  const origRpc = supabase.rpc;

  const userId = "user-indiv-expired";
  const pastExpiry = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(); // Истёк 5 дней назад

  let currentSub = {
    id: "sub-indiv-old",
    user_id: userId,
    tariff_id: "developer",
    is_active: false,
    is_individual: true,
    expires_at: pastExpiry,
  };

  try {
    supabase.from = (table) => {
      if (table === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { ...currentSub }, error: null }),
            }),
          }),
        };
      }
      if (table === "processed_subscription_payments") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          }),
        };
      }
    };

    supabase.rpc = async (fn, params) => {
      if (fn === "activate_subscription_atomic") {
        currentSub = {
          id: "sub-new-opt",
          user_id: userId,
          tariff_id: params.p_tariff_id,
          is_active: true,
          is_individual: false,
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        };
        return { data: { ...currentSub }, error: null };
      }
    };

    const res = await activateSubscription(userId, "optimal", 1);
    assert.equal(res.tariffId, "optimal", "Истёкший индивидуальный тариф может быть заменён стандартным");
  } finally {
    supabase.from = origFrom;
    supabase.rpc = origRpc;
  }
});

// ==============================================================================
// 4. КРИТЕРИЙ 4: Идемпотентность по payment_id
// ==============================================================================

test("Критерий 4 (а): Идемпотентность по payment_id — повторный вызов activateSubscription с тем же paymentId не продлевает срок повторно", async () => {
  const origFrom = supabase.from;
  const origRpc = supabase.rpc;

  const userId = "user-idempotency-test";
  const paymentId = "UT-PAY-IDEM-001";
  const now = Date.now();

  let rpcCallCount = 0;
  let currentSub = null;
  const processedPayments = new Set();

  try {
    supabase.from = (table) => {
      if (table === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: currentSub ? { ...currentSub } : null, error: null }),
            }),
          }),
        };
      }
      if (table === "processed_subscription_payments") {
        return {
          select: () => ({
            eq: (col, val) => ({
              maybeSingle: async () => ({
                data: processedPayments.has(val) ? { payment_id: val } : null,
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    };

    supabase.rpc = async (fn, params) => {
      if (fn === "activate_subscription_atomic") {
        rpcCallCount++;
        if (params.p_payment_id && processedPayments.has(params.p_payment_id)) {
          return { data: { ...currentSub }, error: null };
        }
        if (params.p_payment_id) processedPayments.add(params.p_payment_id);

        const newExpiry = new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
        currentSub = {
          id: "sub-idem",
          user_id: userId,
          tariff_id: params.p_tariff_id,
          expires_at: newExpiry,
          is_active: true,
        };
        return { data: { ...currentSub }, error: null };
      }
    };

    // 1. Первый вызов — успешная активация
    const res1 = await activateSubscription(userId, "optimal", 1, paymentId);
    assert.equal(res1.tariffId, "optimal");
    const initialExpiry = res1.expiresAt;
    assert.equal(rpcCallCount, 1);

    // 2. Второй вызов с тем же paymentId (повтор вебхука / повторный опрос)
    const res2 = await activateSubscription(userId, "optimal", 1, paymentId);
    assert.equal(res2.alreadyProcessed, true, "Второй вызов должен вернуть alreadyProcessed: true");
    assert.equal(res2.expiresAt, initialExpiry, "Срок окончания должен остаться точно таким же");
    assert.equal(
      rpcCallCount,
      1,
      "RPC даже не должен вызываться, так как платёж уже отсечён на уровне processed_subscription_payments"
    );

    // 3. Третий вызов с тем же paymentId
    const res3 = await activateSubscription(userId, "optimal", 1, paymentId);
    assert.equal(res3.alreadyProcessed, true);
    assert.equal(res3.expiresAt, initialExpiry);
    assert.equal(rpcCallCount, 1);

    // 4. Вызов с НОВЫМ paymentId — успешное продление
    const res4 = await activateSubscription(userId, "optimal", 1, "UT-PAY-IDEM-002");
    assert.equal(res4.alreadyProcessed, undefined);
    assert.equal(rpcCallCount, 2, "С новым paymentId должен состояться новый вызов RPC");
  } finally {
    supabase.from = origFrom;
    supabase.rpc = origRpc;
  }
});

// ==============================================================================
// 5. ВЕРИФИКАЦИЯ СТРУКТУРЫ SQL В schema.sql
// ==============================================================================

test("Критерий 5: Проверка наличия SQL-функции activate_subscription_atomic и блокировок в schema.sql", () => {
  const schemaPath = path.resolve(__dirname, "../src/schema.sql");
  assert.ok(fs.existsSync(schemaPath), "Файл schema.sql должен существовать");

  const schemaContent = fs.readFileSync(schemaPath, "utf-8");

  // 1. Наличие функции
  assert.match(
    schemaContent,
    /CREATE OR REPLACE FUNCTION activate_subscription_atomic/i,
    "В schema.sql должна быть объявлена функция activate_subscription_atomic"
  );

  // 2. Наличие pg_advisory_xact_lock
  assert.match(
    schemaContent,
    /pg_advisory_xact_lock\(hashtext\(p_user_id::text\)\)/i,
    "Функция должна использовать pg_advisory_xact_lock для защиты от параллельной гонки"
  );

  // 3. Наличие FOR UPDATE
  assert.match(
    schemaContent,
    /FROM subscriptions\s+WHERE user_id = p_user_id\s+FOR UPDATE/i,
    "Функция должна выполнять SELECT ... FOR UPDATE для блокировки строки подписки"
  );

  // 4. Проверка идемпотентности по payment_id
  assert.match(
    schemaContent,
    /FROM processed_subscription_payments WHERE payment_id = p_payment_id/i,
    "Функция должна проверять таблицу processed_subscription_payments"
  );

  // 5. Проверка запрета затирания индивидуального тарифа (RAISE EXCEPTION)
  assert.match(
    schemaContent,
    /v_existing\.is_individual = TRUE/i,
    "Функция должна проверять флаг is_individual"
  );
  assert.match(
    schemaContent,
    /RAISE EXCEPTION 'У вас активен персональный корпоративный тариф/i,
    "Функция должна выбрасывать исключение при попытке смены активного индивидуального тарифа"
  );

  // 6. Наличие таблицы processed_subscription_payments
  assert.match(
    schemaContent,
    /CREATE TABLE IF NOT EXISTS processed_subscription_payments/i,
    "В schema.sql должна быть объявлена таблица processed_subscription_payments"
  );
});
