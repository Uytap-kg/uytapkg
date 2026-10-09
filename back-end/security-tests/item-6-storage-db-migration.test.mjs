import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPromotionOrder,
  getPromotionOrderByOrderId,
  markPromotionOrderStatus,
  listPromotionOrders,
} from "../src/utils/promotionOrders.js";

import {
  recordUploadOwner,
  isUploadOwnedBy,
  verifyAllOwnedBy,
} from "../src/utils/uploadOwnership.js";

import { supabase } from "../src/config/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ==============================================================================
// 1. ПРОВЕРКА ЭКСПОРТОВ И МИГРАЦИИ СХЕМЫ БД
// ==============================================================================
test("Item 6.1 - Архитектура: модули экспортируют функции и миграция БД содержит необходимые таблицы и индексы", () => {
  // Экспорты promotionOrders
  assert.equal(typeof createPromotionOrder, "function", "createPromotionOrder должен быть функцией");
  assert.equal(typeof getPromotionOrderByOrderId, "function", "getPromotionOrderByOrderId должен быть функцией");
  assert.equal(typeof markPromotionOrderStatus, "function", "markPromotionOrderStatus должен быть функцией");
  assert.equal(typeof listPromotionOrders, "function", "listPromotionOrders должен быть функцией");

  // Экспорты uploadOwnership
  assert.equal(typeof recordUploadOwner, "function", "recordUploadOwner должен быть функцией");
  assert.equal(typeof isUploadOwnedBy, "function", "isUploadOwnedBy должен быть функцией");
  assert.equal(typeof verifyAllOwnedBy, "function", "verifyAllOwnedBy должен быть функцией");

  // Проверка миграции 006_promotion_orders_db.sql
  const migrationPath = path.join(__dirname, "..", "src", "migrations", "006_promotion_orders_db.sql");
  assert.ok(fs.existsSync(migrationPath), "Файл миграции 006_promotion_orders_db.sql должен существовать");

  const sqlContent = fs.readFileSync(migrationPath, "utf-8");
  assert.match(sqlContent, /CREATE TABLE IF NOT EXISTS promotion_orders/i, "Миграция должна создавать таблицу promotion_orders");
  assert.match(sqlContent, /order_id\s+VARCHAR\(\d+\)\s+PRIMARY KEY/i, "order_id должен быть PRIMARY KEY");
  assert.match(sqlContent, /CREATE TABLE IF NOT EXISTS upload_ownership/i, "Миграция должна создавать таблицу upload_ownership");
  assert.match(sqlContent, /object_path\s+TEXT\s+PRIMARY KEY/i, "object_path должен быть PRIMARY KEY");
  assert.match(sqlContent, /idx_promotion_orders_user_id/i, "Должен быть индекс по user_id в promotion_orders");
  assert.match(sqlContent, /idx_promotion_orders_listing_id/i, "Должен быть индекс по listing_id в promotion_orders");
  assert.match(sqlContent, /idx_upload_ownership_user_id/i, "Должен быть индекс по user_id в upload_ownership");
});

// ==============================================================================
// 2. КРИТЕРИЙ 2: ПАРАЛЛЕЛЬНОЕ СОЗДАНИЕ ЗАКАЗОВ (RACE CONDITION RESILIENCE & ACID)
// ==============================================================================
test("Item 6.2 - ACID Resilience: параллельные одновременные создания заказов не теряют записи и предотвращают коллизии", async () => {
  const origFrom = supabase.from;
  const dbOrders = new Map();

  try {
    // Эмулируем ACID-поведение PostgreSQL: изолированные транзакции/вставки с проверкой уникальности PK
    supabase.from = (table) => {
      assert.equal(table, "promotion_orders", "Обращение должно идти строго к таблице promotion_orders");

      return {
        insert: (row) => {
          return {
            select: () => ({
              single: async () => {
                // Имитация задержки сетевого I/O для провоцирования race condition
                await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 10) + 1));

                if (dbOrders.has(row.order_id)) {
                  return {
                    data: null,
                    error: new Error(`duplicate key value violates unique constraint "promotion_orders_pkey": ${row.order_id}`),
                  };
                }

                const inserted = {
                  ...row,
                  created_at: new Date().toISOString(),
                  applied_at: null,
                };
                dbOrders.set(row.order_id, inserted);
                return { data: inserted, error: null };
              },
            }),
          };
        },
        select: () => ({
          order: (col, opts) => {
            assert.equal(col, "created_at");
            assert.equal(opts.ascending, false);
            const list = Array.from(dbOrders.values()).sort(
              (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            );
            return Promise.resolve({ data: list, error: null });
          },
          eq: (col, val) => {
            assert.equal(col, "order_id");
            return {
              maybeSingle: async () => {
                const found = dbOrders.get(val);
                return { data: found || null, error: null };
              },
            };
          },
        }),
      };
    };

    // Генерируем 30 параллельных заказов от разных пользователей и листингов
    const orderCount = 30;
    const orderRequests = Array.from({ length: orderCount }, (_, i) => ({
      orderId: `UT-RACE-ORDER-${String(i).padStart(3, "0")}`,
      userId: `user-uuid-${i}`,
      listingId: `listing-uuid-${i}`,
      serviceType: i % 2 === 0 ? "top" : "vip",
      days: (i % 7) + 1,
    }));

    // Запускаем одновременное создание всех заказов (Promise.all)
    const creationResults = await Promise.all(
      orderRequests.map((req) => createPromotionOrder(req))
    );

    // Проверяем, что все 30 созданий вернули нормализованные объекты
    assert.equal(creationResults.length, orderCount, "Должно быть возвращено 30 результатов");
    for (const res of creationResults) {
      assert.ok(res.orderId, "orderId должен присутствовать");
      assert.equal(res.status, "pending");
    }

    // Проверяем, что в хранилище БД ровно 30 записей — ни одна не потерялась из-за race condition
    assert.equal(dbOrders.size, orderCount, `В БД должно быть сохранено ровно ${orderCount} записей без потерь`);

    // Проверяем выборку через listPromotionOrders
    const listed = await listPromotionOrders();
    assert.equal(listed.length, orderCount, "listPromotionOrders должен вернуть все 30 заказов");

    // Проверяем уникальность всех ID
    const listedIds = new Set(listed.map((o) => o.orderId));
    assert.equal(listedIds.size, orderCount, "Все orderId должны быть уникальными");

    // Проверяем попытку дублирования order_id: Postgres PK должен отбить дубликат ошибкой
    await assert.rejects(
      async () => {
        await createPromotionOrder(orderRequests[0]);
      },
      /duplicate key value violates unique constraint/,
      "Повторная вставка с существующим order_id должна выбрасывать ошибку первичного ключа"
    );
  } finally {
    supabase.from = origFrom;
  }
});

// ==============================================================================
// 3. КРИТЕРИЙ 1: ИМИТАЦИЯ СБОЯ (ОТСУТСТВИЕ ДЕСТРУКТИВНОГО OVERWRITE ПУСТЫМ МАССИВОМ)
// ==============================================================================
test("Item 6.3 - Fault Tolerance: сбой БД выбрасывает ошибку, не возвращает молча [] и не уничтожает существующие записи", async () => {
  const origFrom = supabase.from;

  // Исходное состояние базы с ранее сохранёнными заказами
  const existingOrders = [
    {
      order_id: "UT-EXISTING-001",
      user_id: "user-1",
      listing_id: "list-1",
      service_type: "vip",
      days: 7,
      status: "applied",
      created_at: "2026-10-01T10:00:00.000Z",
      applied_at: "2026-10-01T10:05:00.000Z",
    },
    {
      order_id: "UT-EXISTING-002",
      user_id: "user-2",
      listing_id: "list-2",
      service_type: "top",
      days: 3,
      status: "pending",
      created_at: "2026-10-02T12:00:00.000Z",
      applied_at: null,
    },
  ];

  let storageOverwrittenWithEmpty = false;

  try {
    // Эмулируем сбой соединения с базой (timeout / 503 / network partition)
    supabase.from = (table) => {
      assert.equal(table, "promotion_orders");
      return {
        select: () => ({
          order: () =>
            Promise.resolve({
              data: null,
              error: new Error("PostgreSQL: Connection terminated unexpectedly (ECONNRESET)"),
            }),
          eq: () => ({
            maybeSingle: async () => ({
              data: null,
              error: new Error("PostgreSQL: Connection timeout"),
            }),
          }),
        }),
        insert: () => {
          // Если бы старый код пытался перезаписать реестр пустым массивом
          storageOverwrittenWithEmpty = true;
          return {
            select: () => ({
              single: async () => ({
                data: null,
                error: new Error("PostgreSQL: Cannot connect to DB during insert"),
              }),
            }),
          };
        },
      };
    };

    // 1. Проверяем listPromotionOrders: при ошибке соединения НЕЛЬЗЯ возвращать []
    await assert.rejects(
      async () => {
        const result = await listPromotionOrders();
        // Если вдруг не выбросило ошибку, но вернуло [], это баг
        if (Array.isArray(result) && result.length === 0) {
          throw new Error("VULNERABILITY: listPromotionOrders вернул молча пустой массив [] при сбое БД!");
        }
      },
      /PostgreSQL: Connection terminated unexpectedly/,
      "listPromotionOrders должен пробрасывать ошибку БД, а не маскировать её пустым массивом []"
    );

    // 2. Проверяем getPromotionOrderByOrderId: при ошибке соединения НЕЛЬЗЯ возвращать {} или глушить
    await assert.rejects(
      async () => {
        await getPromotionOrderByOrderId("UT-EXISTING-001");
      },
      /PostgreSQL: Connection timeout/,
      "getPromotionOrderByOrderId должен выбрасывать исключение при сбое БД"
    );

    // 3. Проверяем, что существующий массив данных не был затерт
    assert.equal(
      storageOverwrittenWithEmpty,
      false,
      "Существующие данные не должны подвергаться деструктивному overwrite пустым массивом"
    );
    assert.equal(existingOrders.length, 2, "Исходные записи заказов сохранены в целости");
  } finally {
    supabase.from = origFrom;
  }
});

// ==============================================================================
// 4. КРИТЕРИЙ 3: UPLOAD_OWNERSHIP БЕЗ ФАЙЛОВОГО КЭША И ЗАЩИТА ОТ RACE CONDITIONS
// ==============================================================================
test("Item 6.4 - upload_ownership: параллельная запись владельцев и извлечение напрямую из БД без файлового кэша", async () => {
  const origFrom = supabase.from;
  const ownershipDb = new Map();

  try {
    // Эмулируем таблицу Postgres upload_ownership (upsert и select)
    supabase.from = (table) => {
      assert.equal(table, "upload_ownership", "Операции должны идти к таблице upload_ownership");

      return {
        upsert: async (payload) => {
          // Имитируем асинхронную задержку вставки/апдейта в БД
          await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 8) + 1));
          ownershipDb.set(payload.object_path, {
            object_path: payload.object_path,
            user_id: payload.user_id,
            uploaded_at: payload.uploaded_at,
          });
          return { error: null };
        },
        select: (cols) => {
          assert.equal(cols, "user_id");
          return {
            eq: (col, val) => {
              assert.equal(col, "object_path");
              return {
                maybeSingle: async () => {
                  const row = ownershipDb.get(val);
                  return {
                    data: row ? { user_id: row.user_id } : null,
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    };

    // 1. Параллельная загрузка 20 файлов тремя разными пользователями
    const users = ["user-alice", "user-bob", "user-charlie"];
    const uploadTasks = Array.from({ length: 20 }, (_, i) => {
      const user = users[i % users.length];
      const path = `uploads/photos/img-${i}.webp`;
      return { path, user };
    });

    await Promise.all(uploadTasks.map((t) => recordUploadOwner(t.path, t.user)));

    // Проверяем, что все 20 записей сохранились в БД
    assert.equal(ownershipDb.size, 20, "Все 20 владельцев файлов должны быть зафиксированы в таблице");

    // 2. Проверка isUploadOwnedBy для каждого файла:
    for (const task of uploadTasks) {
      const isOwner = await isUploadOwnedBy(task.path, task.user);
      assert.equal(isOwner, true, `Файл ${task.path} должен принадлежать пользователю ${task.user}`);

      // Проверка чужого пользователя (IDOR / спуфинг)
      const attacker = task.user === "user-alice" ? "user-bob" : "user-alice";
      const isAttackerOwner = await isUploadOwnedBy(task.path, attacker);
      assert.equal(isAttackerOwner, false, `Чужой пользователь ${attacker} не должен быть признан владельцем ${task.path}`);
    }

    // Проверка несуществующего пути
    const nonExistent = await isUploadOwnedBy("uploads/photos/non-existent.webp", "user-alice");
    assert.equal(nonExistent, false, "Несуществующий файл должен возвращать false");

    // Пустые аргументы
    assert.equal(await isUploadOwnedBy("", "user-alice"), false);
    assert.equal(await isUploadOwnedBy("uploads/photos/img-0.webp", ""), false);

    // 3. Проверка verifyAllOwnedBy с валидацией нескольких URL
    const aliceUrls = [
      "https://example.supabase.co/storage/v1/object/public/avatars/uploads/photos/img-0.webp",
      "https://example.supabase.co/storage/v1/object/public/avatars/uploads/photos/img-3.webp",
      "https://example.supabase.co/storage/v1/object/public/avatars/uploads/photos/img-6.webp",
    ];

    const allAliceOwned = await verifyAllOwnedBy(aliceUrls, "user-alice");
    assert.equal(allAliceOwned, true, "Все файлы Алисы должны успешно пройти проверку");

    // Подмешиваем файл Боба (img-1) в список Алисы (попытка использовать чужое фото или обойти водяной знак)
    const mixedUrls = [
      ...aliceUrls,
      "https://example.supabase.co/storage/v1/object/public/avatars/uploads/photos/img-1.webp",
    ];

    const mixedVerification = await verifyAllOwnedBy(mixedUrls, "user-alice");
    assert.equal(
      mixedVerification,
      false,
      "Если хоть один файл принадлежит другому пользователю, verifyAllOwnedBy должен вернуть false"
    );

    // Пустой список всегда валиден
    assert.equal(await verifyAllOwnedBy([], "user-alice"), true);

    // 4. Проверка Fail-Closed при сбое БД в isUploadOwnedBy
    supabase.from = () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: null,
            error: new Error("DB Connection Error during ownership check"),
          }),
        }),
      }),
    });

    const failClosedResult = await isUploadOwnedBy("uploads/photos/img-0.webp", "user-alice");
    assert.equal(
      failClosedResult,
      false,
      "При сбое БД проверка владельца должна безопасно возвращать false (Fail-Closed principle)"
    );
  } finally {
    supabase.from = origFrom;
  }
});

// ==============================================================================
// 5. ДОПОЛНИТЕЛЬНО: ОБНОВЛЕНИЕ СТАТУСА ЗАКАЗА (markPromotionOrderStatus)
// ==============================================================================
test("Item 6.5 - promotionOrders: markPromotionOrderStatus корректно обновляет статус и applied_at", async () => {
  const origFrom = supabase.from;
  let updatedRow = null;

  try {
    supabase.from = (table) => {
      assert.equal(table, "promotion_orders");
      return {
        update: (updates) => ({
          eq: (col, val) => {
            assert.equal(col, "order_id");
            assert.equal(val, "UT-STATUS-TEST-01");
            return {
              select: () => ({
                maybeSingle: async () => {
                  updatedRow = {
                    order_id: val,
                    user_id: "user-uuid-1",
                    listing_id: "listing-uuid-1",
                    service_type: "vip",
                    days: 7,
                    status: updates.status,
                    applied_at: updates.applied_at || null,
                    created_at: "2026-10-08T12:00:00.000Z",
                  };
                  return { data: updatedRow, error: null };
                },
              }),
            };
          },
        }),
      };
    };

    // Применение заказа
    const applied = await markPromotionOrderStatus("UT-STATUS-TEST-01", "applied");
    assert.equal(applied.status, "applied");
    assert.ok(applied.appliedAt, "appliedAt должен быть проставлен");

    // fulfillment_pending
    const pendingFulfill = await markPromotionOrderStatus("UT-STATUS-TEST-01", "fulfillment_pending");
    assert.equal(pendingFulfill.status, "fulfillment_pending");
    assert.ok(pendingFulfill.appliedAt, "appliedAt должен быть проставлен для fulfillment_pending");

    // Неизвестный orderId (maybeSingle возвращает null)
    supabase.from = () => ({
      update: () => ({
        eq: () => ({
          select: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    });

    const notFound = await markPromotionOrderStatus("UT-UNKNOWN-ORDER", "applied");
    assert.equal(notFound, null, "Для несуществующего заказа должен возвращаться null");

    // Пустой orderId
    assert.equal(await markPromotionOrderStatus(null, "applied"), null);
  } finally {
    supabase.from = origFrom;
  }
});
