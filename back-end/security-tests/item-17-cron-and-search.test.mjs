import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { supabase } from "../src/config/db.js";
import {
  getListings,
  getMapListings,
  applyListingFilters,
  sanitizeSearchQuery,
} from "../src/controllers/listingsController.js";
import {
  runMaintenanceJob,
  startCronService,
  stopCronService,
  MAINTENANCE_INTERVAL_MS,
} from "../src/services/cronService.js";
import { cleanupOrphanedPendingAvatars } from "../src/utils/storage.js";

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
    return {
      select: () => ({
        eq: () => ({
          is: () => ({ lte: async () => ({ data: [], error: null }) }),
          maybeSingle: async () => ({ data: null, error: null }),
          limit: async () => ({ data: [] }),
        }),
        is: () => ({ lte: async () => ({ data: [], error: null }) }),
        ilike: () => ({ limit: async () => ({ data: [] }) }),
      }),
    };
  };

  try {
    const summary = await runMaintenanceJob();

    assert.equal(summary.expiredListingsCount, 1);
    assert.equal(summary.resetPromotionsCount, 1);
    assert.equal(summary.resetUrgentCount, 1);
    assert.equal(typeof summary.cleanedPendingAvatarsCount, "number");

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

test("Дефект 3.1: cleanupOrphanedPendingAvatars удаляет невостребованные временные аватары старше 24ч и сохраняет используемые", async () => {
  const origStorage = supabase.storage;
  const origFrom = supabase.from;
  const removedPaths = [];

  const now = Date.now();
  const mockFiles = [
    { name: "stale-orphaned.jpg", created_at: new Date(now - 30 * 60 * 60 * 1000).toISOString() }, // 30ч назад (удалить)
    { name: "stale-referenced.jpg", created_at: new Date(now - 30 * 60 * 60 * 1000).toISOString() }, // 30ч назад, но используется (сохранить)
    { name: "recent-unreferenced.jpg", created_at: new Date(now - 2 * 60 * 60 * 1000).toISOString() }, // 2ч назад (слишком свежий, сохранить)
  ];

  supabase.storage = {
    from: (bucket) => ({
      list: async (folder) => {
        assert.equal(folder, "pending");
        return { data: mockFiles, error: null };
      },
      remove: async (paths) => {
        removedPaths.push(...paths);
        return { data: paths, error: null };
      },
    }),
  };

  supabase.from = (table) => ({
    select: () => ({
      ilike: (_col, val) => ({
        limit: async () => {
          // Симулируем, что stale-referenced.jpg найден в БД
          if (val.includes("stale-referenced.jpg")) {
            return { data: [{ id: "user-123" }] };
          }
          return { data: [] };
        },
      }),
    }),
  });

  try {
    const res = await cleanupOrphanedPendingAvatars(24 * 60 * 60 * 1000);
    assert.equal(res.cleanedCount, 1);
    assert.deepEqual(removedPaths, ["pending/stale-orphaned.jpg"]);
  } finally {
    supabase.storage = origStorage;
    supabase.from = origFrom;
  }
});

test("Фаза 1: Наличие миграции 20261017000000_search_title_trgm_index.sql с GIN-индексом на title", () => {
  const migrationPath = path.resolve(
    __dirname,
    "../../supabase/migrations/20261017000000_search_title_trgm_index.sql"
  );
  assert.ok(fs.existsSync(migrationPath), "Файл миграции для поиска по названию должен существовать");

  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.ok(sql.includes("pg_trgm"), "Миграция должна проверять расширение pg_trgm");
  assert.ok(sql.includes("idx_listings_title_trgm"), "Миграция должна содержать idx_listings_title_trgm");
});

test("Фаза 1: sanitizeSearchQuery корректно обрабатывает все опасные и граничные строки", () => {
  // 1. Пустая строка и пробелы
  assert.equal(sanitizeSearchQuery(""), "");
  assert.equal(sanitizeSearchQuery("   "), "");
  assert.equal(sanitizeSearchQuery(null), "");
  assert.equal(sanitizeSearchQuery(undefined), "");

  // 2. Спецсимволы PostgREST: запятая, скобки, точка, двоеточие
  assert.equal(sanitizeSearchQuery(","), "");
  assert.equal(sanitizeSearchQuery("()"), "");
  assert.equal(sanitizeSearchQuery("site.com:80"), "site com 80");
  assert.equal(sanitizeSearchQuery("field:val,other(val)"), "field val other val");

  // 3. SQL спецсимволы: %, _, кавычки, обратный слэш
  assert.equal(sanitizeSearchQuery("%"), "");
  assert.equal(sanitizeSearchQuery("_"), "");
  assert.equal(sanitizeSearchQuery("100%"), "100");
  assert.equal(sanitizeSearchQuery("user_name"), "user name");
  assert.equal(sanitizeSearchQuery('"admin" or \'1\'=\'1\''), "admin or 1 1");
  assert.equal(sanitizeSearchQuery("path\\to\\file"), "path to file");

  // 4. Ограничение длины 100+ символов
  const long150 = "а".repeat(150);
  assert.equal(sanitizeSearchQuery(long150).length, 100);

  // 5. Кириллица
  assert.equal(sanitizeSearchQuery("Квартира в Бишкеке"), "Квартира в Бишкеке");

  // 6. Кыргызские өүң
  assert.equal(sanitizeSearchQuery("жер үй 4 бөлмө"), "жер үй 4 бөлмө");

  // 7. Эмодзи
  assert.equal(sanitizeSearchQuery("🔥 Срочно 🏡 продается"), "Срочно продается");
});

test("Фаза 1: applyListingFilters безопасно применяет searchQuery и не падает на опасных строках", () => {
  const orCalls = [];
  const gteCalls = [];
  const lteCalls = [];
  const eqCalls = [];

  const createMockQuery = () => {
    const q = {
      or: (val) => {
        orCalls.push(val);
        return q;
      },
      gte: (col, val) => {
        gteCalls.push({ col, val });
        return q;
      },
      lte: (col, val) => {
        lteCalls.push({ col, val });
        return q;
      },
      eq: (col, val) => {
        eqCalls.push({ col, val });
        return q;
      },
      ilike: () => q,
      gt: () => q,
    };
    return q;
  };

  // 1. Опасные строки не должны вызывать исключений или накладывать мусорный .or()
  const dangerousInputs = [
    "",
    "   ",
    ",",
    "()",
    "%",
    "_",
    "\"'",
    "\\\\",
    ":::",
    "🔥🎉",
  ];

  for (const dangerous of dangerousInputs) {
    orCalls.length = 0;
    const q = createMockQuery();
    assert.doesNotThrow(() => {
      applyListingFilters(q, { searchQuery: dangerous });
    }, `Не должно выбрасывать исключение на "${dangerous}"`);
    assert.equal(orCalls.length, 0, `На мусорную строку "${dangerous}" .or() не должен вызываться`);
  }

  // 2. Валидный запрос с кыргызскими буквами и дефисом
  orCalls.length = 0;
  const validQuery = createMockQuery();
  applyListingFilters(validQuery, { searchQuery: "ЖК Ихлас-Центр" });
  assert.equal(orCalls.length, 1);
  assert.ok(orCalls[0].includes("ЖК Ихлас-Центр"));
  assert.ok(orCalls[0].includes("title.ilike."));
  assert.ok(orCalls[0].includes("district.ilike."));
  assert.ok(orCalls[0].includes("city.ilike."));

  // 3. Фильтры площади minArea / maxArea
  gteCalls.length = 0;
  lteCalls.length = 0;
  const areaQuery = createMockQuery();
  applyListingFilters(areaQuery, { minArea: 50, maxArea: 100 });
  assert.deepEqual(gteCalls.find((c) => c.col === "area"), { col: "area", val: 50 });
  assert.deepEqual(lteCalls.find((c) => c.col === "area"), { col: "area", val: 100 });

  // 4. Фильтр валюты: без границ цен НЕ фильтрует по currency (Phase 3 ТЗ)
  eqCalls.length = 0;
  orCalls.length = 0;
  const noCurQuery = createMockQuery();
  applyListingFilters(noCurQuery, {});
  assert.equal(eqCalls.find((c) => c.col === "currency"), undefined, "Без валюты фильтр currency не накладывается");

  const curOnlyQuery = createMockQuery();
  applyListingFilters(curOnlyQuery, { currency: "USD" });
  assert.equal(eqCalls.find((c) => c.col === "currency"), undefined, "Валюта без границ цен не фильтрует объявления");

  const curPriceQuery = createMockQuery();
  applyListingFilters(curPriceQuery, { currency: "USD", minPrice: 50000 });
  assert.ok(orCalls.some((c) => c.includes("currency.eq.USD") && c.includes("currency.eq.KGS")), "Валюта с ценой накладывает мультивалютный or-фильтр");

  // 5. Комнаты: числовые значения дают eq, а суффикс '+' даёт gte
  eqCalls.length = 0;
  gteCalls.length = 0;
  const rooms4ExactQuery = createMockQuery();
  applyListingFilters(rooms4ExactQuery, { rooms: 4 });
  assert.deepEqual(eqCalls.find((c) => c.col === "rooms"), { col: "rooms", val: 4 });
  assert.equal(gteCalls.find((c) => c.col === "rooms"), undefined);

  eqCalls.length = 0;
  gteCalls.length = 0;
  const rooms4PlusQuery = createMockQuery();
  applyListingFilters(rooms4PlusQuery, { rooms: "4+" });
  assert.deepEqual(gteCalls.find((c) => c.col === "rooms"), { col: "rooms", val: 4 });
  assert.equal(eqCalls.find((c) => c.col === "rooms"), undefined);

  // 6. Детерминированный приоритет параметров и их алиасов
  gteCalls.length = 0;
  lteCalls.length = 0;
  orCalls.length = 0;
  const aliasQuery = createMockQuery();
  applyListingFilters(aliasQuery, {
    minPrice: 1000,
    priceFrom: 2000,
    maxPrice: 5000,
    priceTo: 6000,
    minArea: 40,
    areaFrom: 50,
    maxArea: 90,
    areaTo: 100,
    searchQuery: "элитка",
    query: "вторичка",
  });
  // minPrice ?? priceFrom -> 1000
  assert.deepEqual(gteCalls.find((c) => c.col === "price"), { col: "price", val: 1000 });
  // maxPrice ?? priceTo -> 5000
  assert.deepEqual(lteCalls.find((c) => c.col === "price"), { col: "price", val: 5000 });
  // minArea ?? areaFrom -> 40
  assert.deepEqual(gteCalls.find((c) => c.col === "area"), { col: "area", val: 40 });
  // maxArea ?? areaTo -> 90
  assert.deepEqual(lteCalls.find((c) => c.col === "area"), { col: "area", val: 90 });
  // searchQuery ?? query -> "элитка"
  assert.ok(orCalls[0].includes("title.ilike.%элитка%"));
});

test("Фаза 1: getMapListings корректно сохраняет все фильтры карты и применяет searchQuery", async () => {
  const origFrom = supabase.from;
  const calls = {
    eq: [],
    gte: [],
    lte: [],
    or: [],
    not: [],
  };

  const queryChain = {
    select: () => queryChain,
    eq: (col, val) => {
      calls.eq.push({ col, val });
      return queryChain;
    },
    gte: (col, val) => {
      calls.gte.push({ col, val });
      return queryChain;
    },
    lte: (col, val) => {
      calls.lte.push({ col, val });
      return queryChain;
    },
    or: (val) => {
      calls.or.push(val);
      return queryChain;
    },
    not: (col, op, val) => {
      calls.not.push({ col, op, val });
      return queryChain;
    },
    gt: () => queryChain,
    order: () => queryChain,
    range: () => Promise.resolve({ data: [], count: 0, error: null }),
  };

  supabase.from = () => queryChain;

  try {
    const res = createMockRes();
    await getMapListings(
      {
        query: {
          city: "Бишкек",
          searchQuery: "студия",
          minPrice: 20000,
          maxPrice: 60000,
          minLat: "42.8",
          maxLat: "42.9",
          minLng: "74.5",
          maxLng: "74.7",
        },
      },
      res
    );

    assert.equal(res.statusCode, 200);
    // Проверка, что фильтры карты не сломаны:
    // 1. Координаты (bbox) наложены
    assert.ok(calls.gte.some((c) => c.col === "latitude" && c.val === 42.8));
    assert.ok(calls.lte.some((c) => c.col === "latitude" && c.val === 42.9));
    assert.ok(calls.gte.some((c) => c.col === "longitude" && c.val === 74.5));
    assert.ok(calls.lte.some((c) => c.col === "longitude" && c.val === 74.7));

    // 2. Город наложен
    assert.ok(calls.eq.some((c) => c.col === "city" && c.val === "Бишкек"));

    // 3. Цена наложена
    assert.ok(calls.gte.some((c) => c.col === "price" && c.val === 20000));
    assert.ok(calls.lte.some((c) => c.col === "price" && c.val === 60000));

    // 4. Поиск по ключевому слову применился безопасно через .or()
    assert.ok(calls.or.some((val) => val.includes("title.ilike.%студия%")));
  } finally {
    supabase.from = origFrom;
  }
});
