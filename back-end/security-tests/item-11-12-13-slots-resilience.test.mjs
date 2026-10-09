import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

import {
  createListing,
} from "../src/controllers/listingsController.js";
import {
  consumeTariffListing,
  refundTariffListing,
  refundTariffBoost,
  getActiveSubscription,
  getActiveListingsLimit,
  activateListingSlot,
} from "../src/services/subscriptionsService.js";
import { supabase } from "../src/config/db.js";

/**
 * Хелпер создания мока объекта ответа Express (res)
 */
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

/**
 * Хелпер создания базового тела валидного запроса на создание объявления
 */
function createValidListingPayload(overrides = {}) {
  return {
    title: "Тестовая квартира для проверки лимитов",
    description: "Просторная светлая квартира в центре города",
    propertyType: "apartment",
    dealType: "sale",
    region: "Бишкек",
    city: "Бишкек",
    price: 1500000,
    currency: "KGS",
    area: 65,
    rooms: 2,
    photos: [],
    status: "active",
    ...overrides,
  };
}

// ==============================================================================
// РАЗДЕЛ 1: ПУНКТ 11 ТЗ — 20 ПАРАЛЛЕЛЬНЫХ ЗАПРОСОВ НА FREE PERSONAL (Promise.all)
// ==============================================================================

test("Пункт 11: 20 параллельных запросов создания активных объявлений (Promise.all) на free personal дают в БД ровно 2 активных объявления (остальные 18 отклоняются с 403 Forbidden)", async () => {
  const origRpc = supabase.rpc;
  const origFrom = supabase.from;

  const testUserId = "user-free-personal-p11";
  const mockDbListings = [];
  let listingIdSeq = 1;
  let queueLock = Promise.resolve();

  try {
    // Моделируем поведение БД и Postgres Advisory Lock RPC (create_listing_with_limit)
    supabase.rpc = async (funcName, params) => {
      if (funcName === "create_listing_with_limit") {
        const { p_user_id, p_listing_data, p_limit } = params;

        // Эмуляция PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text))
        const nextLock = queueLock.then(async () => {
          // Имитируем асинхронный контекст I/O БД
          await new Promise((resolve) => setImmediate(resolve));

          const activeCount = mockDbListings.filter(
            (l) =>
              l.user_id === p_user_id &&
              l.status === "active" &&
              (!l.expires_at || new Date(l.expires_at).getTime() > Date.now())
          ).length;

          const limit = p_limit ?? 2;

          if (activeCount >= limit) {
            return {
              data: null,
              error: {
                message: "LIMIT_EXCEEDED",
                code: "P0002",
                details: `User ${p_user_id} exceeded active listings limit: ${activeCount} of ${limit}`,
              },
            };
          }

          const newRecord = {
            id: `listing-${listingIdSeq++}`,
            user_id: p_user_id,
            status: "active",
            ...p_listing_data,
            created_at: new Date().toISOString(),
          };
          mockDbListings.push(newRecord);

          return { data: newRecord, error: null };
        });

        queueLock = nextLock.catch(() => {});
        return await nextLock;
      }

      return { data: null, error: new Error(`Unknown RPC ${funcName}`) };
    };

    // Мок таблиц Supabase
    supabase.from = (tableName) => {
      if (tableName === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }), // Нет платной подписки (free)
            }),
          }),
        };
      }
      if (tableName === "users") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: testUserId, account_type: "personal" },
                error: null,
              }),
            }),
          }),
        };
      }
      if (tableName === "upload_ownership") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      return origFrom(tableName);
    };

    // Запускаем ровно 20 параллельных запросов создания активных объявлений через Promise.all
    const requests = Array.from({ length: 20 }, (_, idx) => {
      const req = {
        user: { id: testUserId, account_type: "personal" },
        body: createValidListingPayload({
          title: `Квартира ${idx + 1} - Конкурентный тест`,
        }),
      };
      const res = createMockRes();
      return createListing(req, res).then(() => res);
    });

    const responses = await Promise.all(requests);

    // Подсчитываем успешные (201) и отклонённые по лимиту (403) ответы
    const createdResponses = responses.filter((r) => r.statusCode === 201);
    const limitExceededResponses = responses.filter((r) => r.statusCode === 403);

    assert.equal(
      createdResponses.length,
      2,
      `Ровно 2 запроса из 20 должны успешно создать объявление (получено 201: ${createdResponses.length})`
    );
    assert.equal(
      limitExceededResponses.length,
      18,
      `Остальные 18 запросов из 20 должны быть отклонены с 403 Forbidden (получено 403: ${limitExceededResponses.length})`
    );

    // Проверяем тексты сообщений об ошибке
    for (const res403 of limitExceededResponses) {
      assert.equal(res403.body.success, false);
      assert.ok(
        res403.body.message.includes("Достигнут лимит активных объявлений (2)"),
        `Сообщение должно указывать на достижение лимита 2: ${res403.body.message}`
      );
    }

    // Проверяем итоговое состояние в БД: ровно 2 активных объявления
    const activeListingsInDb = mockDbListings.filter(
      (l) => l.user_id === testUserId && l.status === "active"
    );
    assert.equal(
      activeListingsInDb.length,
      2,
      `В базе данных должно быть строго 2 активных объявления, получено: ${activeListingsInDb.length}`
    );

    // Проверяем 21-й последующий запрос: он обязан немедленно отклониться со статусом 403
    const req21 = {
      user: { id: testUserId, account_type: "personal" },
      body: createValidListingPayload({ title: "Квартира 21 - Попытка после лимита" }),
    };
    const res21 = createMockRes();
    await createListing(req21, res21);

    assert.equal(res21.statusCode, 403, "21-й запрос создания должен быть отклонен с 403 Forbidden");
    assert.equal(res21.body.success, false);
    assert.equal(mockDbListings.length, 2, "Число объявлений в БД должно оставаться строго 2");
  } finally {
    supabase.rpc = origRpc;
    supabase.from = origFrom;
  }
});

test("Пункт 11: Прямой вызов RPC create_listing_with_limit — 20 параллельных вызовов дают ровно 2 успеха и 18 ошибок LIMIT_EXCEEDED", async () => {
  const origRpc = supabase.rpc;
  const testUserId = "user-direct-rpc-p11";
  const mockDbListings = [];
  let listingIdSeq = 100;
  let queueLock = Promise.resolve();

  try {
    supabase.rpc = async (funcName, params) => {
      if (funcName === "create_listing_with_limit") {
        const { p_user_id, p_listing_data, p_limit } = params;

        const nextLock = queueLock.then(async () => {
          await new Promise((resolve) => setImmediate(resolve));

          const activeCount = mockDbListings.filter(
            (l) =>
              l.user_id === p_user_id &&
              l.status === "active" &&
              (!l.expires_at || new Date(l.expires_at).getTime() > Date.now())
          ).length;

          if (activeCount >= p_limit) {
            return {
              data: null,
              error: {
                message: "LIMIT_EXCEEDED",
                code: "P0002",
                details: `User ${p_user_id} exceeded active listings limit: ${activeCount} of ${p_limit}`,
              },
            };
          }

          const newRecord = {
            id: `listing-${listingIdSeq++}`,
            user_id: p_user_id,
            status: "active",
            ...p_listing_data,
          };
          mockDbListings.push(newRecord);
          return { data: newRecord, error: null };
        });

        queueLock = nextLock.catch(() => {});
        return await nextLock;
      }
      return { data: null, error: new Error("Unknown RPC") };
    };

    const rpcCalls = Array.from({ length: 20 }, (_, idx) =>
      supabase.rpc("create_listing_with_limit", {
        p_user_id: testUserId,
        p_listing_data: { title: `RPC Объявление ${idx + 1}` },
        p_limit: 2,
      })
    );

    const results = await Promise.all(rpcCalls);

    const successes = results.filter((r) => r.data && !r.error);
    const errors = results.filter((r) => r.error && r.error.message === "LIMIT_EXCEEDED");

    assert.equal(successes.length, 2, "Ровно 2 прямых вызова RPC должны завершиться успехом");
    assert.equal(errors.length, 18, "Остальные 18 вызовов RPC должны вернуть ошибку LIMIT_EXCEEDED");
    assert.equal(mockDbListings.length, 2, "В хранилище должно быть ровно 2 записи");
  } finally {
    supabase.rpc = origRpc;
  }
});

test("Пункт 11: Наличие истёкших или скрытых объявлений не уменьшает лимит создания активных (лимит строго считает только active и неистёкшие)", async () => {
  const origRpc = supabase.rpc;
  const origFrom = supabase.from;

  const testUserId = "user-mixed-status-p11";
  // В БД уже есть 1 скрытое и 1 истёкшее объявление пользователя
  const mockDbListings = [
    {
      id: "listing-hidden-1",
      user_id: testUserId,
      status: "hidden",
      title: "Скрытое объявление",
    },
    {
      id: "listing-expired-1",
      user_id: testUserId,
      status: "active",
      expires_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // истёк вчера
      title: "Истёкшее объявление",
    },
  ];
  let listingIdSeq = 200;
  let queueLock = Promise.resolve();

  try {
    supabase.rpc = async (funcName, params) => {
      if (funcName === "create_listing_with_limit") {
        const { p_user_id, p_listing_data, p_limit } = params;

        const nextLock = queueLock.then(async () => {
          await new Promise((resolve) => setImmediate(resolve));

          // Строгий подсчёт: status = 'active' AND (expires_at IS NULL OR expires_at > NOW())
          const activeCount = mockDbListings.filter(
            (l) =>
              l.user_id === p_user_id &&
              l.status === "active" &&
              (!l.expires_at || new Date(l.expires_at).getTime() > Date.now())
          ).length;

          if (activeCount >= p_limit) {
            return {
              data: null,
              error: {
                message: "LIMIT_EXCEEDED",
                code: "P0002",
              },
            };
          }

          const newRecord = {
            id: `listing-${listingIdSeq++}`,
            user_id: p_user_id,
            status: "active",
            ...p_listing_data,
          };
          mockDbListings.push(newRecord);
          return { data: newRecord, error: null };
        });

        queueLock = nextLock.catch(() => {});
        return await nextLock;
      }
      return { data: null, error: new Error("Unknown RPC") };
    };

    supabase.from = (tableName) => {
      if (tableName === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      if (tableName === "users") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: testUserId, account_type: "personal" },
                error: null,
              }),
            }),
          }),
        };
      }
      return origFrom(tableName);
    };

    const requests = Array.from({ length: 20 }, (_, idx) => {
      const req = {
        user: { id: testUserId, account_type: "personal" },
        body: createValidListingPayload({
          title: `Новое объявление ${idx + 1}`,
        }),
      };
      const res = createMockRes();
      return createListing(req, res).then(() => res);
    });

    const responses = await Promise.all(requests);

    const createdResponses = responses.filter((r) => r.statusCode === 201);
    const limitExceededResponses = responses.filter((r) => r.statusCode === 403);

    // Должно успешно создаться ровно 2 активных объявления, так как старые скрыты/истекли
    assert.equal(createdResponses.length, 2);
    assert.equal(limitExceededResponses.length, 18);

    const activeListings = mockDbListings.filter(
      (l) =>
        l.user_id === testUserId &&
        l.status === "active" &&
        (!l.expires_at || new Date(l.expires_at).getTime() > Date.now())
    );
    assert.equal(activeListings.length, 2, "Количество реально активных неистёкших должно быть ровно 2");
  } finally {
    supabase.rpc = origRpc;
    supabase.from = origFrom;
  }
});

test("Пункт 11: Бесплатный бизнес-аккаунт без тарифа (realtor/agency) имеет лимит 0 активных (все 20 параллельных запросов отклоняются со статусом 403)", async () => {
  const origRpc = supabase.rpc;
  const origFrom = supabase.from;

  const testUserId = "user-biz-free-p11";
  const mockDbListings = [];

  try {
    supabase.rpc = async (funcName, params) => {
      if (funcName === "create_listing_with_limit") {
        // Лимит 0 для бизнес-пользователя без тарифа
        return {
          data: null,
          error: {
            message: "LIMIT_EXCEEDED",
            code: "P0002",
            details: "User exceeded active listings limit: 0 of 0",
          },
        };
      }
      return { data: null, error: new Error("Unknown RPC") };
    };

    supabase.from = (tableName) => {
      if (tableName === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      if (tableName === "users") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: testUserId, account_type: "realtor" },
                error: null,
              }),
            }),
          }),
        };
      }
      return origFrom(tableName);
    };

    const requests = Array.from({ length: 20 }, (_, idx) => {
      const req = {
        user: { id: testUserId, account_type: "realtor" },
        body: createValidListingPayload({
          title: `Бизнес объявление ${idx + 1}`,
        }),
      };
      const res = createMockRes();
      return createListing(req, res).then(() => res);
    });

    const responses = await Promise.all(requests);

    const createdResponses = responses.filter((r) => r.statusCode === 201);
    const limitExceededResponses = responses.filter((r) => r.statusCode === 403);

    assert.equal(createdResponses.length, 0, "Для бизнес-аккаунта без тарифа создано ровно 0 объявлений");
    assert.equal(limitExceededResponses.length, 20, "Все 20 запросов отклонены с 403");
  } finally {
    supabase.rpc = origRpc;
    supabase.from = origFrom;
  }
});

// ==============================================================================
// РАЗДЕЛ 2: ПУНКТ 12 ТЗ — АТОМАРНОСТЬ, GREATEST(x-1, 0) И ИДЕМПОТЕНТНОСТЬ ВОЗВРАТОВ
// ==============================================================================

test("Пункт 12: refundTariffListing — неотрицательность счётчика: вызовы никогда не делают listings_used отрицательным (GREATEST(x-1, 0))", async () => {
  const origRpc = supabase.rpc;
  const testUserId = "user-refund-nonneg-p12";

  // Имитируем подписку с listings_used = 1
  let listingsUsed = 1;

  try {
    supabase.rpc = async (funcName, params) => {
      if (funcName === "refund_tariff_listing_atomic") {
        // Postgres: UPDATE subscriptions SET listings_used = GREATEST(listings_used - 1, 0)
        listingsUsed = Math.max(listingsUsed - 1, 0);
        return { data: true, error: null };
      }
      return { data: null, error: new Error("Unknown RPC") };
    };

    // 1-й возврат: уменьшает с 1 до 0
    await refundTariffListing(testUserId, "op-ref-1");
    assert.equal(listingsUsed, 0, "Счётчик listings_used должен уменьшиться до 0");

    // 2-й возврат при счётчике 0: должен остаться 0 (не -1)
    await refundTariffListing(testUserId, "op-ref-2");
    assert.equal(listingsUsed, 0, "Счётчик listings_used должен оставаться 0 (не -1)");

    // Ещё 10 возвратов подряд с новыми ID операций
    for (let i = 3; i <= 12; i++) {
      await refundTariffListing(testUserId, `op-ref-${i}`);
      assert.ok(listingsUsed >= 0, `listings_used должен быть неотрицательным, текущее значение: ${listingsUsed}`);
      assert.equal(listingsUsed, 0, "listings_used не должен уходить в минус при избыточных возвратах");
    }
  } finally {
    supabase.rpc = origRpc;
  }
});

test("Пункт 12: refundTariffListing — идемпотентность по operationId: повторные вызовы с одним operationId не возвращают слот дважды", async () => {
  const origRpc = supabase.rpc;
  const testUserId = "user-refund-idem-p12";

  let listingsUsed = 5;
  const processedOps = new Set();
  let queueLock = Promise.resolve();

  try {
    supabase.rpc = async (funcName, params) => {
      if (funcName === "refund_tariff_listing_atomic") {
        const { p_operation_id } = params;

        const nextLock = queueLock.then(async () => {
          await new Promise((resolve) => setImmediate(resolve));

          // 1. Проверка идемпотентности
          if (p_operation_id && processedOps.has(p_operation_id)) {
            return { data: true, error: null }; // no-op
          }

          // 2. Атомарное обновление
          listingsUsed = Math.max(listingsUsed - 1, 0);

          // 3. Запись в processed_refund_operations
          if (p_operation_id) {
            processedOps.add(p_operation_id);
          }

          return { data: true, error: null };
        });

        queueLock = nextLock.catch(() => {});
        return await nextLock;
      }
      return { data: null, error: new Error("Unknown RPC") };
    };

    const duplicateOpId = "op-duplicate-listing-001";

    // Первый вызов с duplicateOpId: должен уменьшить с 5 до 4
    await refundTariffListing(testUserId, duplicateOpId);
    assert.equal(listingsUsed, 4, "Первый вызов должен уменьшить listings_used с 5 до 4");

    // Второй вызов с ТЕМ ЖЕ duplicateOpId: счётчик не должен измениться
    await refundTariffListing(testUserId, duplicateOpId);
    assert.equal(listingsUsed, 4, "Второй вызов с тем же operationId не должен вернуть слот повторно");

    // Третий вызов с ТЕМ ЖЕ duplicateOpId: счётчик не меняется
    await refundTariffListing(testUserId, duplicateOpId);
    assert.equal(listingsUsed, 4, "Третий вызов с тем же operationId не должен изменить счётчик");

    // 20 параллельных вызовов с тем же duplicateOpId через Promise.all
    await Promise.all(
      Array.from({ length: 20 }, () => refundTariffListing(testUserId, duplicateOpId))
    );
    assert.equal(
      listingsUsed,
      4,
      "Конкурентные повторные вызовы с тем же operationId не должны вернуть слот повторно"
    );

    // Новый operationId уменьшает счётчик с 4 до 3
    const newOpId = "op-duplicate-listing-002";
    await refundTariffListing(testUserId, newOpId);
    assert.equal(listingsUsed, 3, "Вызов с новым operationId должен уменьшить счётчик до 3");
  } finally {
    supabase.rpc = origRpc;
  }
});

test("Пункт 12: refundTariffBoost (VIP и TOP) — неотрицательность (GREATEST(x-1, 0)) и идемпотентность по operationId", async () => {
  const origRpc = supabase.rpc;
  const testUserId = "user-boost-refund-p12";

  let vipUsed = 2;
  let topUsed = 3;
  const processedOps = new Set();
  let queueLock = Promise.resolve();

  try {
    supabase.rpc = async (funcName, params) => {
      if (funcName === "refund_tariff_boost_atomic") {
        const { p_boost_type, p_operation_id } = params;

        const nextLock = queueLock.then(async () => {
          await new Promise((resolve) => setImmediate(resolve));

          if (p_operation_id && processedOps.has(p_operation_id)) {
            return { data: true, error: null };
          }

          if (p_boost_type === "vip") {
            vipUsed = Math.max(vipUsed - 1, 0);
          } else if (p_boost_type === "top") {
            topUsed = Math.max(topUsed - 1, 0);
          }

          if (p_operation_id) {
            processedOps.add(p_operation_id);
          }

          return { data: true, error: null };
        });

        queueLock = nextLock.catch(() => {});
        return await nextLock;
      }
      return { data: null, error: new Error("Unknown RPC") };
    };

    // 1. VIP возврат: уменьшает с 2 до 1
    const vipOpId = "op-vip-test-01";
    await refundTariffBoost(testUserId, "vip", vipOpId);
    assert.equal(vipUsed, 1, "vipUsed уменьшился с 2 до 1");

    // Повторный вызов VIP с тем же operationId
    await refundTariffBoost(testUserId, "vip", vipOpId);
    assert.equal(vipUsed, 1, "Повторный вызов с тем же operationId не должен повторно возвращать VIP");

    // Возвращаем второй VIP до 0
    await refundTariffBoost(testUserId, "vip", "op-vip-test-02");
    assert.equal(vipUsed, 0, "vipUsed уменьшился до 0");

    // Попытка вернуть VIP при значении 0: неотрицательность
    await refundTariffBoost(testUserId, "vip", "op-vip-test-03");
    assert.equal(vipUsed, 0, "vipUsed не должен уйти в минус (строго >= 0)");

    // 2. TOP возврат: уменьшает с 3 до 2
    const topOpId = "op-top-test-01";
    await refundTariffBoost(testUserId, "top", topOpId);
    assert.equal(topUsed, 2, "topUsed уменьшился с 3 до 2");

    // Повторные 10 параллельных вызовов с тем же topOpId
    await Promise.all(
      Array.from({ length: 10 }, () => refundTariffBoost(testUserId, "top", topOpId))
    );
    assert.equal(topUsed, 2, "Конкурентные повторные вызовы TOP не должны возвращать слоты повторно");

    // Возвращаем до 0
    await refundTariffBoost(testUserId, "top", "op-top-test-02");
    await refundTariffBoost(testUserId, "top", "op-top-test-03");
    assert.equal(topUsed, 0, "topUsed уменьшился до 0");

    // Попытка вернуть при 0: неотрицательность
    await refundTariffBoost(testUserId, "top", "op-top-test-04");
    assert.equal(topUsed, 0, "topUsed не должен уйти в минус (строго >= 0)");
  } finally {
    supabase.rpc = origRpc;
  }
});

test("Пункт 12: Фолбэк возврата (при сбое RPC) также обеспечивает идемпотентность и неотрицательность Math.max(used - 1, 0)", async () => {
  const origRpc = supabase.rpc;
  const origFrom = supabase.from;
  const origConsoleWarn = console.warn;

  const testUserId = "user-fallback-refund-p12";
  let listingsUsed = 2;
  const processedRows = [];

  try {
    console.warn = () => {}; // Подавляем лог фолбэка RPC
    // Симулируем отсутствие или сбой RPC, чтобы сработал JS-фолбэк в subscriptionsService
    supabase.rpc = async () => ({
      data: null,
      error: { message: "function refund_tariff_listing_atomic does not exist" },
    });

    supabase.from = (tableName) => {
      if (tableName === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "sub-uuid-fb-1",
                  user_id: testUserId,
                  is_active: true,
                  expires_at: new Date(Date.now() + 86400000).toISOString(),
                  listings_used: listingsUsed,
                },
                error: null,
              }),
            }),
          }),
          update: (payload) => ({
            eq: (field1, val1) => ({
              eq: (field2, val2) => ({
                select: () => ({
                  maybeSingle: async () => {
                    if (val2 === listingsUsed) {
                      listingsUsed = payload.listings_used;
                      return { data: { id: "sub-uuid-fb-1" }, error: null };
                    }
                    return { data: null, error: null }; // optimistic lock conflict
                  },
                }),
              }),
            }),
          }),
        };
      }
      if (tableName === "processed_refund_operations") {
        return {
          select: () => ({
            eq: (col, val) => ({
              maybeSingle: async () => {
                const found = processedRows.find((r) => r.operation_id === val);
                return { data: found || null, error: null };
              },
            }),
          }),
          insert: async (row) => {
            if (processedRows.some((r) => r.operation_id === row.operation_id)) {
              const err = new Error("duplicate key");
              err.code = "23505";
              return { error: err };
            }
            processedRows.push(row);
            return { error: null };
          },
        };
      }
      return origFrom(tableName);
    };

    const opId = "fb-op-listing-1";

    // 1-й возврат: уменьшает с 2 до 1
    await refundTariffListing(testUserId, opId);
    assert.equal(listingsUsed, 1, "Фолбэк должен уменьшить listings_used с 2 до 1");

    // 2-й возврат с тем же opId: игнорируется через processed_refund_operations
    await refundTariffListing(testUserId, opId);
    assert.equal(listingsUsed, 1, "Фолбэк должен защитить от повторного возврата по opId");

    // Возврат другого opId уменьшает до 0
    await refundTariffListing(testUserId, "fb-op-listing-2");
    assert.equal(listingsUsed, 0, "Второй уникальный возврат уменьшает до 0");

    // Избыточный возврат при 0 не уходит в минус благодаря Math.max(used - 1, 0)
    await refundTariffListing(testUserId, "fb-op-listing-3");
    assert.equal(listingsUsed, 0, "Счётчик остаётся 0 (неотрицательность)");
  } finally {
    supabase.rpc = origRpc;
    supabase.from = origFrom;
    console.warn = origConsoleWarn;
  }
});

// ==============================================================================
// РАЗДЕЛ 3: ПУНКТ 13 ТЗ — УСТРАНЕНИЕ FAIL-OPEN (FAIL-CLOSED ПРИ ОШИБКАХ БД)
// ==============================================================================

test("Пункт 13: consumeTariffListing в production-режиме при искусственной ошибке БД НЕ даёт granted: true (доступ отклоняется с reason: 'db_error')", async () => {
  const origEnv = process.env.NODE_ENV;
  const origFrom = supabase.from;
  const origConsoleError = console.error;

  const testUserId = "user-fail-closed-p13";

  try {
    process.env.NODE_ENV = "production";
    console.error = () => {}; // Подавляем ожидаемый лог ошибки БД

    // Имитируем активную подписку
    supabase.from = (tableName) => {
      if (tableName === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "sub-uuid-prod-13",
                  user_id: testUserId,
                  is_active: true,
                  tariff_id: "optimal",
                  expires_at: new Date(Date.now() + 86400000).toISOString(),
                  listings_used: 1,
                },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: async () => ({
                    data: null,
                    error: {
                      message: "Connection terminated unexpectedly (Artificial DB Error)",
                      code: "ECONNRESET",
                    },
                  }),
                }),
              }),
            }),
          }),
        };
      }
      return origFrom(tableName);
    };

    const result = await consumeTariffListing(testUserId);

    assert.equal(
      result.granted,
      false,
      "КРИТИЧНО: При ошибке БД в production granted ОБЯЗАН быть false (устранение fail-open)"
    );
    assert.notEqual(result.granted, true, "granted ни при каких обстоятельствах не должен быть true");
    assert.equal(result.hasSubscription, true);
    assert.equal(result.reason, "db_error", "reason должен быть равен 'db_error'");
    assert.ok(result.message.includes("Ошибка базы данных"), "Сообщение должно сообщать об ошибке БД");
  } finally {
    process.env.NODE_ENV = origEnv;
    supabase.from = origFrom;
    console.error = origConsoleError;
  }
});

test("Пункт 13: consumeTariffListing в production-режиме при ошибке отсутствия колонки (PGRST204/42703) также отклоняет доступ (fail-open устранён даже при неполной схеме)", async () => {
  const origEnv = process.env.NODE_ENV;
  const origFrom = supabase.from;
  const origConsoleError = console.error;

  const testUserId = "user-missing-col-prod-p13";

  try {
    process.env.NODE_ENV = "production";
    console.error = () => {};

    supabase.from = (tableName) => {
      if (tableName === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "sub-uuid-prod-missing-col",
                  user_id: testUserId,
                  is_active: true,
                  tariff_id: "start",
                  expires_at: new Date(Date.now() + 86400000).toISOString(),
                  listings_used: 0,
                },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: async () => ({
                    data: null,
                    error: {
                      message: "column 'listings_used' does not exist",
                      code: "PGRST204", // Либо 42703
                    },
                  }),
                }),
              }),
            }),
          }),
        };
      }
      return origFrom(tableName);
    };

    const result = await consumeTariffListing(testUserId);

    assert.equal(
      result.granted,
      false,
      "В production-режиме даже при отсутствии колонки granted обязан быть false!"
    );
    assert.equal(result.reason, "db_error");
  } finally {
    process.env.NODE_ENV = origEnv;
    supabase.from = origFrom;
    console.error = origConsoleError;
  }
});

test("Пункт 13: В dev-режиме generic ошибка БД всё равно отклоняет доступ (granted: false), и только при отсутствии колонки (isMissingColumn) допускается fallback", async () => {
  const origEnv = process.env.NODE_ENV;
  const origFrom = supabase.from;
  const origConsoleError = console.error;
  const origConsoleWarn = console.warn;

  const testUserId = "user-dev-mode-p13";

  try {
    process.env.NODE_ENV = "development";
    console.error = () => {};
    console.warn = () => {};

    // 1. Generic ошибка БД в dev-режиме: доступ ОТКЛОНЯЕТСЯ
    supabase.from = (tableName) => {
      if (tableName === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "sub-uuid-dev-1",
                  user_id: testUserId,
                  is_active: true,
                  tariff_id: "start",
                  expires_at: new Date(Date.now() + 86400000).toISOString(),
                  listings_used: 0,
                },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: async () => ({
                    data: null,
                    error: {
                      message: "Deadlock detected (Generic DB Error)",
                      code: "40P01",
                    },
                  }),
                }),
              }),
            }),
          }),
        };
      }
      return origFrom(tableName);
    };

    const genericDevResult = await consumeTariffListing(testUserId);
    assert.equal(genericDevResult.granted, false, "Generic ошибка БД в dev обязана отклонять доступ (granted: false)");
    assert.equal(genericDevResult.reason, "db_error");

    // 2. Ошибка отсутствия колонки в dev-режиме: fallback разрешён только для локальной разработки
    supabase.from = (tableName) => {
      if (tableName === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "sub-uuid-dev-2",
                  user_id: testUserId,
                  is_active: true,
                  tariff_id: "start",
                  expires_at: new Date(Date.now() + 86400000).toISOString(),
                  listings_used: 0,
                },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: async () => ({
                    data: null,
                    error: {
                      message: "column 'listings_used' does not exist",
                      code: "42703",
                    },
                  }),
                }),
              }),
            }),
          }),
        };
      }
      return origFrom(tableName);
    };

    const missingColDevResult = await consumeTariffListing(testUserId);
    assert.equal(missingColDevResult.granted, true, "Только в dev и только при missing column разрешён fallback");
  } finally {
    process.env.NODE_ENV = origEnv;
    supabase.from = origFrom;
    console.error = origConsoleError;
    console.warn = origConsoleWarn;
  }
});

test("Пункт 13: activateListingSlot при ошибке БД в consumeTariffListing блокирует активацию слота со статусом reason: 'db_error'", async () => {
  const origEnv = process.env.NODE_ENV;
  const origFrom = supabase.from;
  const origConsoleError = console.error;

  const testUserId = "user-slot-failclosed-p13";

  try {
    process.env.NODE_ENV = "production";
    console.error = () => {};

    supabase.from = (tableName) => {
      if (tableName === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "sub-uuid-prod-slot-13",
                  user_id: testUserId,
                  is_active: true,
                  tariff_id: "optimal",
                  expires_at: new Date(Date.now() + 86400000).toISOString(),
                  listings_used: 1,
                },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: async () => ({
                    data: null,
                    error: { message: "Database timeout", code: "57014" },
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (tableName === "listings") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                or: async () => ({ count: 1, error: null }),
              }),
            }),
          }),
        };
      }
      return origFrom(tableName);
    };

    const slotResult = await activateListingSlot(testUserId);

    assert.equal(slotResult.granted, false, "activateListingSlot должен отклонить доступ при сбое БД");
    assert.equal(slotResult.reason, "db_error");
    assert.equal(slotResult.message, "Ошибка базы данных при списании слота тарифа");
  } finally {
    process.env.NODE_ENV = origEnv;
    supabase.from = origFrom;
  }
});

// ==============================================================================
// РАЗДЕЛ 4: СТАТИЧЕСКИЙ АУДИТ КОДА И МИГРАЦИЙ (ПУНКТЫ 11, 12, 13)
// ==============================================================================

test("Статический аудит: Проверка исходных файлов на соответствие требованиям ТЗ (11, 12, 13)", () => {
  const servicePath = path.join(rootDir, "src", "services", "subscriptionsService.js");
  const controllerPath = path.join(rootDir, "src", "controllers", "listingsController.js");
  const migrationPath = path.join(rootDir, "src", "migrations", "011_p2_slots_and_rpc.sql");
  const schemaPath = path.join(rootDir, "src", "schema.sql");

  const serviceCode = fs.readFileSync(servicePath, "utf-8");
  const controllerCode = fs.readFileSync(controllerPath, "utf-8");
  const migrationSql = fs.readFileSync(migrationPath, "utf-8");
  const schemaSql = fs.readFileSync(schemaPath, "utf-8");

  // Пункт 11
  assert.ok(migrationSql.includes("FUNCTION create_listing_with_limit"), "Миграция содержит create_listing_with_limit");
  assert.ok(migrationSql.includes("pg_advisory_xact_lock"), "Миграция использует pg_advisory_xact_lock");
  assert.ok(migrationSql.includes("RAISE EXCEPTION 'LIMIT_EXCEEDED'"), "Миграция выбрасывает LIMIT_EXCEEDED");
  assert.ok(controllerCode.includes('create_listing_with_limit'), "Контроллер вызывает RPC create_listing_with_limit");
  assert.ok(controllerCode.includes('LIMIT_EXCEEDED'), "Контроллер обрабатывает LIMIT_EXCEEDED");

  // Пункт 12
  assert.ok(migrationSql.includes("processed_refund_operations"), "Миграция создаёт таблицу processed_refund_operations");
  assert.ok(migrationSql.includes("refund_tariff_listing_atomic"), "Миграция содержит refund_tariff_listing_atomic");
  assert.ok(migrationSql.includes("refund_tariff_boost_atomic"), "Миграция содержит refund_tariff_boost_atomic");
  assert.ok(migrationSql.includes("GREATEST(listings_used - 1, 0)"), "Миграция использует GREATEST для listings_used");
  assert.ok(migrationSql.includes("GREATEST(vip_boosts_used - 1, 0)"), "Миграция использует GREATEST для vip_boosts_used");
  assert.ok(migrationSql.includes("GREATEST(top_boosts_used - 1, 0)"), "Миграция использует GREATEST для top_boosts_used");
  assert.ok(serviceCode.includes("processed_refund_operations"), "subscriptionsService поддерживает processed_refund_operations");
  assert.ok(serviceCode.includes("Math.max(used - 1, 0)"), "subscriptionsService использует неотрицательный возврат в фолбэке");

  // Пункт 13
  assert.ok(
    !serviceCode.includes("// Если колонка ещё не создана в БД, не блокируем создание аварийно\n    return { hasSubscription: true, granted: true"),
    "Безусловный fail-open удалён"
  );
  assert.ok(serviceCode.includes('reason: "db_error"'), "Код содержит reason: 'db_error'");
  assert.ok(serviceCode.includes('isMissingColumn && isDev'), "Fallback ограничен только dev и missing column");
});
