import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { supabase } from "../src/config/db.js";
import { getListings, createListing, updateListing } from "../src/controllers/listingsController.js";
import { grantPromotion } from "../src/services/promotionsService.js";

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

test("Дефект 1.1: Наличие миграции 20261013000000_listing_priority_rank.sql с колонками, триггерами и индексами", () => {
  const migrationPath = path.resolve(
    __dirname,
    "../../supabase/migrations/20261013000000_listing_priority_rank.sql"
  );
  assert.ok(fs.existsSync(migrationPath), "Файл миграции 20261013000000_listing_priority_rank.sql должен существовать");

  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.ok(sql.includes("priority_rank"), "Миграция должна добавлять priority_rank");
  assert.ok(sql.includes("photos_count"), "Миграция должна добавлять photos_count");
  assert.ok(sql.includes("update_listing_priority_rank"), "Миграция должна содержать функцию update_listing_priority_rank");
  assert.ok(sql.includes("trg_listing_priority_rank"), "Миграция должна содержать триггер trg_listing_priority_rank");
  assert.ok(sql.includes("update_listing_photos_count"), "Миграция должна содержать функцию update_listing_photos_count");
  assert.ok(sql.includes("trg_listing_photos_count"), "Миграция должна содержать триггер trg_listing_photos_count");
  assert.ok(sql.includes("idx_listings_active_prio"), "Миграция должна создавать индекс idx_listings_active_prio");
  assert.ok(sql.includes("idx_listings_photos_count"), "Миграция должна создавать индекс idx_listings_photos_count");
});

test("Дефект 1.1: Схема schema.sql содержит priority_rank, photos_count, триггеры и индексы", () => {
  const schemaPath = path.resolve(__dirname, "../src/schema.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf8");

  assert.ok(schemaSql.includes("priority_rank INT DEFAULT 3 NOT NULL"), "schema.sql должна содержать priority_rank");
  assert.ok(schemaSql.includes("photos_count INT DEFAULT 0 NOT NULL"), "schema.sql должна содержать photos_count");
  assert.ok(schemaSql.includes("update_listing_priority_rank"), "schema.sql должна содержать функцию update_listing_priority_rank");
  assert.ok(schemaSql.includes("update_listing_photos_count"), "schema.sql должна содержать функцию update_listing_photos_count");
  assert.ok(schemaSql.includes("idx_listings_active_prio"), "schema.sql должна содержать индекс idx_listings_active_prio");
  assert.ok(schemaSql.includes("idx_listings_photos_count"), "schema.sql должна содержать индекс idx_listings_photos_count");
});

test("Дефект 1.1: getListings передаёт order(priority_rank, ascending) и range(from, to) на уровне БД", async () => {
  const origFrom = supabase.from;
  const calls = [];

  const queryChain = {
    select: () => queryChain,
    eq: () => queryChain,
    gt: (col, val) => {
      calls.push({ method: "gt", col, val });
      return queryChain;
    },
    order: (col, opts) => {
      calls.push({ method: "order", col, opts });
      return queryChain;
    },
    range: (from, to) => {
      calls.push({ method: "range", from, to });
      return Promise.resolve({
        data: [
          { id: "vip-1", priority_rank: 0, promotion_status: "vip", created_at: "2026-10-13T10:00:00Z" },
          { id: "urgent-1", priority_rank: 1, is_urgent: true, created_at: "2026-10-13T09:00:00Z" },
          { id: "top-1", priority_rank: 2, promotion_status: "top", created_at: "2026-10-13T08:00:00Z" },
          { id: "reg-1", priority_rank: 3, promotion_status: "regular", created_at: "2026-10-13T07:00:00Z" },
        ],
        count: 4,
        error: null,
      });
    },
  };

  supabase.from = (table) => {
    calls.push({ method: "from", table });
    return queryChain;
  };

  try {
    const req = { query: { page: 1, limit: 20 } };
    const res = createMockRes();

    await getListings(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);

    // Проверяем вызовы order: priority_rank asc, затем created_at desc
    const orderCalls = calls.filter((c) => c.method === "order");
    assert.ok(orderCalls.length >= 2, "Должно быть вызвано не менее двух order()");
    assert.equal(orderCalls[0].col, "priority_rank");
    assert.equal(orderCalls[0].opts?.ascending, true);
    assert.equal(orderCalls[1].col, "created_at");
    assert.equal(orderCalls[1].opts?.ascending, false);

    // Проверяем, что range был вызван
    const rangeCall = calls.find((c) => c.method === "range");
    assert.ok(rangeCall, "range() должен быть вызван");
    assert.equal(rangeCall.from, 0);
    assert.equal(rangeCall.to, 19);
  } finally {
    supabase.from = origFrom;
  }
});

test("Дефект 1.1: getListings с onlyPopular=true применяет .gt('photos_count', 0) на уровне базы данных", async () => {
  const origFrom = supabase.from;
  const calls = [];

  const queryChain = {
    select: () => queryChain,
    eq: () => queryChain,
    gt: (col, val) => {
      calls.push({ method: "gt", col, val });
      return queryChain;
    },
    order: (col, opts) => {
      calls.push({ method: "order", col, opts });
      return queryChain;
    },
    range: (from, to) => {
      calls.push({ method: "range", from, to });
      return Promise.resolve({
        data: [
          { id: "pop-1", photos_count: 5, priority_rank: 0, promotion_status: "vip", created_at: "2026-10-13T10:00:00Z" },
        ],
        count: 1,
        error: null,
      });
    },
  };

  supabase.from = (table) => {
    return queryChain;
  };

  try {
    const req = { query: { onlyPopular: "true", page: 1, limit: 10 } };
    const res = createMockRes();

    await getListings(req, res);

    assert.equal(res.statusCode, 200);
    const gtPhotos = calls.find((c) => c.method === "gt" && c.col === "photos_count");
    assert.ok(gtPhotos, "Должен быть вызван .gt('photos_count', 0)");
    assert.equal(gtPhotos.val, 0);
  } finally {
    supabase.from = origFrom;
  }
});

test("Дефект 1.1: grantPromotion явно рассчитывает и записывает priority_rank", async () => {
  const origFrom = supabase.from;
  const updatesRecorded = [];

  supabase.from = (table) => {
    if (table === "listings") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                id: "listing-test-promo",
                user_id: "user-123",
                status: "active",
                promotion_status: "regular",
                is_urgent: false,
                promotion_expires_at: null,
                urgent_expires_at: null,
              },
              error: null,
            }),
          }),
        }),
        update: (updates) => {
          updatesRecorded.push(updates);
          return {
            eq: async () => ({ error: null }),
          };
        },
      };
    }
    return origFrom(table);
  };

  try {
    // 1. VIP -> priority_rank = 0
    updatesRecorded.length = 0;
    const resVip = await grantPromotion({ listingId: "listing-test-promo", serviceType: "vip", days: 7 });
    assert.equal(resVip, true);
    assert.equal(updatesRecorded[0].priority_rank, 0, "VIP услуга должна выставлять priority_rank = 0");
    assert.equal(updatesRecorded[0].promotion_status, "vip");

    // 2. Urgent -> priority_rank = 1
    updatesRecorded.length = 0;
    const resUrgent = await grantPromotion({ listingId: "listing-test-promo", serviceType: "urgent", days: 3 });
    assert.equal(resUrgent, true);
    assert.equal(updatesRecorded[0].priority_rank, 1, "Urgent услуга должна выставлять priority_rank = 1");
    assert.equal(updatesRecorded[0].is_urgent, true);

    // 3. Top -> priority_rank = 2
    updatesRecorded.length = 0;
    const resTop = await grantPromotion({ listingId: "listing-test-promo", serviceType: "top", days: 5 });
    assert.equal(resTop, true);
    assert.equal(updatesRecorded[0].priority_rank, 2, "Top услуга должна выставлять priority_rank = 2");
    assert.equal(updatesRecorded[0].promotion_status, "top");
  } finally {
    supabase.from = origFrom;
  }
});
