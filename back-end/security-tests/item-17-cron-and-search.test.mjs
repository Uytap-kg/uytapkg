import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { supabase } from "../src/config/db.js";
import { getListings } from "../src/controllers/listingsController.js";
import {
  runMaintenanceJob,
  startCronService,
  stopCronService,
  MAINTENANCE_INTERVAL_MS,
} from "../src/services/cronService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

test("Дефект 2.3: Наличие миграции 20261013000001_search_indexes_and_cleanup.sql с триграммными GIN-индексами", () => {
  const migrationPath = path.resolve(
    __dirname,
    "../../supabase/migrations/20261013000001_search_indexes_and_cleanup.sql"
  );
  assert.ok(fs.existsSync(migrationPath), "Файл миграции для поиска должен существовать");

  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.ok(sql.includes("pg_trgm"), "Миграция должна подключать расширение pg_trgm");
  assert.ok(sql.includes("idx_listings_city_trgm"), "Миграция должна содержать idx_listings_city_trgm");
  assert.ok(sql.includes("idx_listings_district_trgm"), "Миграция должна содержать idx_listings_district_trgm");
  assert.ok(sql.includes("idx_listings_region_trgm"), "Миграция должна содержать idx_listings_region_trgm");
});

test("Дефект 2.3: Точный поиск по городу использует query.eq('city', city.trim()), а 'Все' пропускается", async () => {
  const origFrom = supabase.from;
  const eqCalls = [];

  const queryChain = {
    select: () => queryChain,
    eq: (col, val) => {
      eqCalls.push({ col, val });
      return queryChain;
    },
    gt: () => queryChain,
    order: () => queryChain,
    range: () => Promise.resolve({ data: [], count: 0, error: null }),
  };

  supabase.from = () => queryChain;

  try {
    // 1. Поиск по конкретному городу "Бишкек " -> eq("city", "Бишкек")
    eqCalls.length = 0;
    await getListings({ query: { city: "Бишкек " } }, createMockRes());
    const cityCall = eqCalls.find((c) => c.col === "city");
    assert.ok(cityCall, "Должен вызываться .eq('city', ...)");
    assert.equal(cityCall.val, "Бишкек", "Город должен быть обрезан trim()");

    // 2. city === "Все" -> eq("city") не вызывается
    eqCalls.length = 0;
    await getListings({ query: { city: "Все" } }, createMockRes());
    const allCall = eqCalls.find((c) => c.col === "city");
    assert.equal(allCall, undefined, "Для города 'Все' фильтр .eq('city') не должен накладываться");
  } finally {
    supabase.from = origFrom;
  }
});

test("Дефект 3.1: runMaintenanceJob переводит просроченные объявления в status='expired' и сбрасывает промо-статусы", async () => {
  const origFrom = supabase.from;
  const updatesExecuted = [];

  supabase.from = (table) => {
    if (table === "listings") {
      return {
        update: (updates) => {
          const updateRecord = { updates, eqFilters: [], lteFilters: [], neqFilters: [] };
          updatesExecuted.push(updateRecord);

          const chain = {
            eq: (col, val) => {
              updateRecord.eqFilters.push({ col, val });
              return chain;
            },
            neq: (col, val) => {
              updateRecord.neqFilters.push({ col, val });
              return chain;
            },
            lte: (col, val) => {
              updateRecord.lteFilters.push({ col, val });
              return chain;
            },
            select: async () => ({
              data: [{ id: "mock-affected-row" }],
              error: null,
            }),
          };
          return chain;
        },
      };
    }
    return origFrom(table);
  };

  try {
    const summary = await runMaintenanceJob();

    assert.equal(summary.expiredListingsCount, 1);
    assert.equal(summary.resetPromotionsCount, 1);
    assert.equal(summary.resetUrgentCount, 1);

    // 1. Проверка очистки просроченных объявлений
    const expireJob = updatesExecuted.find((u) => u.updates.status === "expired");
    assert.ok(expireJob, "Должен быть апдейт status='expired'");
    assert.ok(expireJob.eqFilters.some((f) => f.col === "status" && f.val === "active"));
    assert.ok(expireJob.lteFilters.some((f) => f.col === "expires_at"));

    // 2. Проверка сброса промо-статусов
    const promoJob = updatesExecuted.find((u) => u.updates.promotion_status === "regular");
    assert.ok(promoJob, "Должен быть апдейт promotion_status='regular'");
    assert.equal(promoJob.updates.priority_rank, 3);
    assert.ok(promoJob.neqFilters.some((f) => f.col === "promotion_status" && f.val === "regular"));
    assert.ok(promoJob.lteFilters.some((f) => f.col === "promotion_expires_at"));

    // 3. Проверка сброса urgent
    const urgentJob = updatesExecuted.find((u) => u.updates.is_urgent === false);
    assert.ok(urgentJob, "Должен быть апдейт is_urgent=false");
    assert.equal(urgentJob.updates.priority_rank, 3);
    assert.ok(urgentJob.eqFilters.some((f) => f.col === "is_urgent" && f.val === true));
    assert.ok(urgentJob.lteFilters.some((f) => f.col === "urgent_expires_at"));
  } finally {
    supabase.from = origFrom;
  }
});

test("Дефект 3.1: startCronService запускает таймер с unref() и корректно останавливается stopCronService", () => {
  const timer = startCronService(MAINTENANCE_INTERVAL_MS);
  assert.ok(timer, "startCronService должен возвращать таймер");
  assert.equal(typeof timer.unref, "function", "Таймер обязан поддерживать unref()");

  stopCronService();
});
