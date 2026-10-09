import test from "node:test";
import assert from "node:assert/strict";

import {
  activateListingSlot,
  checkDraftsLimit,
  MAX_DRAFTS_PER_USER,
} from "../src/services/subscriptionsService.js";
import {
  createListing,
  updateListing,
  renewListing,
} from "../src/controllers/listingsController.js";
import { grantPromotion } from "../src/services/promotionsService.js";
import { supabase } from "../src/config/db.js";

/**
 * Хелпер создания мока ответа Express (res)
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

// ==============================================================================
// 1. ТЕСТИРОВАНИЕ checkDraftsLimit и константы MAX_DRAFTS_PER_USER
// ==============================================================================
test("checkDraftsLimit: MAX_DRAFTS_PER_USER равен 10, при count >= 10 возвращает allowed: false, иначе allowed: true", async () => {
  const origFrom = supabase.from;
  assert.equal(MAX_DRAFTS_PER_USER, 10, "MAX_DRAFTS_PER_USER должен быть равен 10");

  try {
    // 1. Проверка при 10 черновиках (лимит достигнут)
    supabase.from = () => ({
      select: () => ({
        eq: () => ({
          eq: async () => ({ count: 10, error: null }),
        }),
      }),
    });

    const res10 = await checkDraftsLimit("user-test-01");
    assert.equal(res10.allowed, false, "При 10 черновиках allowed должен быть false");
    assert.equal(res10.count, 10);
    assert.equal(res10.max, 10);

    // 2. Проверка при 12 черновиках (превышение)
    supabase.from = () => ({
      select: () => ({
        eq: () => ({
          eq: async () => ({ count: 12, error: null }),
        }),
      }),
    });

    const res12 = await checkDraftsLimit("user-test-01");
    assert.equal(res12.allowed, false, "При > 10 черновиках allowed должен быть false");

    // 3. Проверка при 9 черновиках (разрешено)
    supabase.from = () => ({
      select: () => ({
        eq: () => ({
          eq: async () => ({ count: 9, error: null }),
        }),
      }),
    });

    const res9 = await checkDraftsLimit("user-test-01");
    assert.equal(res9.allowed, true, "При 9 черновиках allowed должен быть true");
  } finally {
    supabase.from = origFrom;
  }
});

// ==============================================================================
// 2. ТЕСТИРОВАНИЕ activateListingSlot
// ==============================================================================
test("activateListingSlot: для personal (лимит 2) блокирует при count >= 2 и разрешает при count < 2", async () => {
  const origFrom = supabase.from;

  try {
    // Мок: нет подписки, пользователь personal, activeCount = 2
    supabase.from = (table) => {
      if (table === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      if (table === "users") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { account_type: "personal" }, error: null }),
            }),
          }),
        };
      }
      if (table === "listings") {
        return {
          select: (cols, opts) => {
            if (opts && opts.count) {
              return {
                eq: () => ({
                  eq: () => ({
                    or: async () => ({ count: 2, error: null }),
                  }),
                }),
              };
            }
            return {
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    };

    const result = await activateListingSlot("user-p1", null, "personal");
    assert.equal(result.granted, false, "При 2 активных объявлениях для personal активация должна быть отклонена");
    assert.equal(result.reason, "limit_reached");
    assert.equal(result.limit, 2);
    assert.equal(result.count, 2);
    assert.equal(result.message, "Достигнут лимит активных объявлений (2 из 2)");
  } finally {
    supabase.from = origFrom;
  }
});

test("activateListingSlot: для бизнес-аккаунта (realtor/agency/developer) без тарифа лимит = 0, блокирует сразу", async () => {
  const origFrom = supabase.from;

  try {
    supabase.from = (table) => {
      if (table === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      if (table === "users") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { account_type: "agency" }, error: null }),
            }),
          }),
        };
      }
      if (table === "listings") {
        return {
          select: (cols, opts) => {
            if (opts && opts.count) {
              return {
                eq: () => ({
                  eq: () => ({
                    or: async () => ({ count: 0, error: null }),
                  }),
                }),
              };
            }
            return {
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    };

    const result = await activateListingSlot("user-agency-1", null, "agency");
    assert.equal(result.granted, false, "Для agency без тарифа лимит = 0, активация должна блокироваться");
    assert.equal(result.reason, "limit_reached");
    assert.equal(result.limit, 0);
    assert.equal(result.count, 0);
    assert.equal(result.message, "Достигнут лимит активных объявлений (0 из 0)");
  } finally {
    supabase.from = origFrom;
  }
});

test("activateListingSlot: если listingId передан и уже активен, он не увеличивает число", async () => {
  const origFrom = supabase.from;
  const activeExpiry = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();

  try {
    supabase.from = (table) => {
      if (table === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      if (table === "users") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { account_type: "personal" }, error: null }),
            }),
          }),
        };
      }
      if (table === "listings") {
        return {
          select: (cols, opts) => {
            if (opts && opts.count) {
              return {
                eq: () => ({
                  eq: () => ({
                    neq: () => ({
                      or: async () => ({ count: 1, error: null }),
                    }),
                    or: async () => ({ count: 2, error: null }),
                  }),
                }),
              };
            }
            return {
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: "listing-active-123",
                    user_id: "user-p1",
                    status: "active",
                    expires_at: activeExpiry,
                  },
                  error: null,
                }),
              }),
            };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    };

    // Пользователь personal (лимит 2). У него 2 активных объявления (включая listing-active-123).
    // При проверке listing-active-123 оно исключается, остаётся 1 (< 2).
    const result = await activateListingSlot("user-p1", "listing-active-123", "personal");
    assert.equal(result.granted, true, "Уже активное объявление не должно увеличивать счётчик и должно быть разрешено");
  } finally {
    supabase.from = origFrom;
  }
});

test("activateListingSlot: при активном тарифе и исчерпании listings_used возвращает reason: 'tariff_exhausted'", async () => {
  const origFrom = supabase.from;
  const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const mockSubscription = {
    id: "sub-1",
    user_id: "user-sub-1",
    is_active: true,
    is_individual: true,
    active_listings_limit: 5,
    listings_used: 5, // Лимит исчерпан
    expires_at: futureDate,
  };

  try {
    supabase.from = (table) => {
      if (table === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: mockSubscription, error: null }),
              single: async () => ({ data: mockSubscription, error: null }),
            }),
          }),
        };
      }
      if (table === "listings") {
        return {
          select: (cols, opts) => {
            if (opts && opts.count) {
              return {
                eq: () => ({
                  eq: () => ({
                    or: async () => ({ count: 3, error: null }), // Реальных объявлений 3 из 5
                  }),
                }),
              };
            }
            return {
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    };

    const result = await activateListingSlot("user-sub-1", null);
    assert.equal(result.granted, false);
    assert.equal(result.reason, "tariff_exhausted", "При исчерпании listings_used должен быть reason 'tariff_exhausted'");
    assert.match(result.message, /Лимит объявлений по вашему тарифу исчерпан/);
  } finally {
    supabase.from = origFrom;
  }
});

// ==============================================================================
// 3. ТЕСТИРОВАНИЕ createListing (контроллер)
// ==============================================================================
test("createListing: при initialStatus === 'draft' и draftsCount >= 10 возвращает 400 'Превышен лимит одновременных черновиков (максимум 10)'", async () => {
  const origFrom = supabase.from;

  try {
    supabase.from = (table) => {
      if (table === "listings") {
        return {
          select: (cols, opts) => {
            if (opts && opts.count) {
              return {
                eq: () => ({
                  eq: async () => ({ count: 10, error: null }), // 10 черновиков
                }),
              };
            }
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    };

    const req = {
      user: { id: "user-draft-limit", role: "personal", account_type: "personal" },
      body: {
        title: "Заголовок черновика для проверки",
        dealType: "sale",
        propertyType: "apartment",
        region: "Бишкек",
        price: 50000,
        status: "draft",
      },
    };
    const res = createMockRes();

    await createListing(req, res);

    assert.equal(res.statusCode, 400, `Ожидался HTTP 400, получено: ${res.statusCode}`);
    assert.equal(res.body?.success, false);
    assert.equal(res.body?.message, "Превышен лимит одновременных черновиков (максимум 10)");
  } finally {
    supabase.from = origFrom;
  }
});

test("createListing: при initialStatus === 'active' и исчерпанном лимите слотов возвращает 403 Forbidden с сообщением", async () => {
  const origFrom = supabase.from;

  try {
    supabase.from = (table) => {
      if (table === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      if (table === "users") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { account_type: "personal" }, error: null }),
            }),
          }),
        };
      }
      if (table === "listings") {
        return {
          select: (cols, opts) => {
            if (opts && opts.count) {
              return {
                eq: () => ({
                  eq: () => ({
                    or: async () => ({ count: 2, error: null }), // Уже 2 активных объявления
                  }),
                }),
              };
            }
            return {
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    };

    const req = {
      user: { id: "user-active-limit", role: "personal", account_type: "personal" },
      body: {
        title: "Новое активное объявление",
        dealType: "sale",
        propertyType: "apartment",
        region: "Бишкек",
        price: 60000,
      },
    };
    const res = createMockRes();

    await createListing(req, res);

    assert.equal(res.statusCode, 403, `Ожидался HTTP 403 Forbidden, получено: ${res.statusCode}`);
    assert.equal(res.body?.success, false);
    assert.equal(res.body?.message, "Достигнут лимит активных объявлений (2 из 2)");
  } finally {
    supabase.from = origFrom;
  }
});

// ==============================================================================
// 4. ТЕСТИРОВАНИЕ grantPromotion (promotionsService)
// ==============================================================================
test("grantPromotion: при активации draft/hidden объявления и исчерпанном лимите слотов возвращает false и НЕ переводит в active", async () => {
  const origFrom = supabase.from;
  let updateCalled = false;

  try {
    supabase.from = (table) => {
      if (table === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      if (table === "users") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { account_type: "personal" }, error: null }),
            }),
          }),
        };
      }
      if (table === "listings") {
        return {
          select: (cols, opts) => {
            if (opts && opts.count) {
              return {
                eq: () => ({
                  eq: () => ({
                    or: async () => ({ count: 2, error: null }), // Лимит 2 исчерпан
                  }),
                }),
              };
            }
            return {
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: "listing-draft-promo",
                    user_id: "user-promo-1",
                    status: "draft",
                  },
                  error: null,
                }),
              }),
            };
          },
          update: () => {
            updateCalled = true;
            return {
              eq: async () => ({ error: null }),
            };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    };

    const granted = await grantPromotion({
      listingId: "listing-draft-promo",
      serviceType: "vip",
      days: 7,
    });

    assert.equal(granted, false, "grantPromotion должен вернуть false при исчерпании лимита слотов");
    assert.equal(updateCalled, false, "Объявление не должно обновляться в БД в статус active при исчерпанном лимите");
  } finally {
    supabase.from = origFrom;
  }
});

test("grantPromotion: при активации draft/hidden объявления и наличии свободного слота успешно переводит в active", async () => {
  const origFrom = supabase.from;
  let updatedFields = null;

  try {
    supabase.from = (table) => {
      if (table === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      if (table === "users") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { account_type: "personal" }, error: null }),
            }),
          }),
        };
      }
      if (table === "listings") {
        return {
          select: (cols, opts) => {
            if (opts && opts.count) {
              return {
                eq: () => ({
                  eq: () => ({
                    or: async () => ({ count: 1, error: null }), // 1 из 2 активно, слот доступен
                  }),
                }),
              };
            }
            return {
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: "listing-draft-ok",
                    user_id: "user-promo-ok",
                    status: "draft",
                  },
                  error: null,
                }),
              }),
            };
          },
          update: (updates) => {
            updatedFields = updates;
            return {
              eq: async () => ({ error: null }),
            };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    };

    const granted = await grantPromotion({
      listingId: "listing-draft-ok",
      serviceType: "vip",
      days: 7,
    });

    assert.equal(granted, true, "grantPromotion должен вернуть true при свободном слоте");
    assert.ok(updatedFields, "Обновление в БД должно состояться");
    assert.equal(updatedFields.status, "active", "Статус должен стать 'active'");
    assert.equal(updatedFields.promotion_status, "vip");
  } finally {
    supabase.from = origFrom;
  }
});

// ==============================================================================
// 5. ТЕСТИРОВАНИЕ updateListing: реактивация (hidden -> active) с проверкой слота
// ==============================================================================
test("updateListing: при реактивации hidden -> active и исчерпанном лимите возвращает 403 Forbidden", async () => {
  const origFrom = supabase.from;

  try {
    supabase.from = (table) => {
      if (table === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      if (table === "users") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { account_type: "personal" }, error: null }),
            }),
          }),
        };
      }
      if (table === "listings") {
        return {
          select: (cols, opts) => {
            if (opts && opts.count) {
              return {
                eq: () => ({
                  eq: () => ({
                    or: async () => ({ count: 2, error: null }), // Лимит 2 исчерпан
                  }),
                }),
              };
            }
            return {
              eq: () => ({
                single: async () => ({
                  data: {
                    id: "listing-reactivate-test",
                    user_id: "user-reactivate-1",
                    status: "hidden",
                    title: "Старое скрытое объявление",
                  },
                  error: null,
                }),
                maybeSingle: async () => ({
                  data: {
                    id: "listing-reactivate-test",
                    user_id: "user-reactivate-1",
                    status: "hidden",
                  },
                  error: null,
                }),
              }),
            };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    };

    const req = {
      params: { id: "listing-reactivate-test" },
      user: { id: "user-reactivate-1", role: "personal", account_type: "personal" },
      body: {
        status: "active",
      },
    };
    const res = createMockRes();

    await updateListing(req, res);

    assert.equal(res.statusCode, 403, `Ожидался HTTP 403 Forbidden, получено: ${res.statusCode}`);
    assert.equal(res.body?.success, false);
    assert.equal(res.body?.message, "Достигнут лимит активных объявлений (2 из 2)");
  } finally {
    supabase.from = origFrom;
  }
});

// ==============================================================================
// 6. ТЕСТИРОВАНИЕ renewListing: продление неактивного (hidden / expired) с проверкой слота
// ==============================================================================
test("renewListing: при продлении неактивного (isCurrentlyActive: false) объявления и исчерпанном лимите возвращает 403 Forbidden", async () => {
  const origFrom = supabase.from;
  const expiredDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

  try {
    supabase.from = (table) => {
      if (table === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      if (table === "users") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { account_type: "personal" }, error: null }),
            }),
          }),
        };
      }
      if (table === "listings") {
        return {
          select: (cols, opts) => {
            if (opts && opts.count) {
              return {
                eq: () => ({
                  eq: () => ({
                    or: async () => ({ count: 2, error: null }), // Лимит 2 исчерпан
                  }),
                }),
              };
            }
            return {
              eq: () => ({
                single: async () => ({
                  data: {
                    id: "listing-renew-test",
                    user_id: "user-renew-1",
                    status: "hidden",
                    expires_at: expiredDate,
                  },
                  error: null,
                }),
                maybeSingle: async () => ({
                  data: {
                    id: "listing-renew-test",
                    user_id: "user-renew-1",
                    status: "hidden",
                    expires_at: expiredDate,
                  },
                  error: null,
                }),
              }),
            };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    };

    const req = {
      params: { id: "listing-renew-test" },
      user: { id: "user-renew-1", role: "personal", account_type: "personal" },
    };
    const res = createMockRes();

    await renewListing(req, res);

    assert.equal(res.statusCode, 403, `Ожидался HTTP 403 Forbidden, получено: ${res.statusCode}`);
    assert.equal(res.body?.success, false);
    assert.equal(res.body?.message, "Достигнут лимит активных объявлений (2 из 2)");
  } finally {
    supabase.from = origFrom;
  }
});

// ==============================================================================
// 7. КРИТЕРИЙ 4: Подсчёт лимита по реальному числу активных объявлений (count) в БД
// ==============================================================================
test("activateListingSlot: подсчёт лимита по реальному числу активных объявлений (count) в БД блокирует активацию, даже если listings_used равен 0", async () => {
  const origFrom = supabase.from;
  const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const mockSubscription = {
    id: "sub-count-test",
    user_id: "user-count-1",
    is_active: true,
    is_individual: true,
    active_listings_limit: 3,
    listings_used: 0, // По тарифу использовано 0, но в БД уже 3 активных объявления!
    expires_at: futureDate,
  };

  try {
    supabase.from = (table) => {
      if (table === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: mockSubscription, error: null }),
              single: async () => ({ data: mockSubscription, error: null }),
            }),
          }),
        };
      }
      if (table === "listings") {
        return {
          select: (cols, opts) => {
            if (opts && opts.count) {
              return {
                eq: () => ({
                  eq: () => ({
                    or: async () => ({ count: 3, error: null }), // В БД уже 3 активных объявления
                  }),
                }),
              };
            }
            return {
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    };

    const result = await activateListingSlot("user-count-1", null);
    assert.equal(result.granted, false, "Активация должна быть отклонена при достижении count >= limit");
    assert.equal(result.reason, "limit_reached", "Причина должна быть 'limit_reached', а не 'tariff_exhausted'");
    assert.equal(result.limit, 3);
    assert.equal(result.count, 3);
    assert.equal(result.message, "Достигнут лимит активных объявлений (3 из 3)");
  } finally {
    supabase.from = origFrom;
  }
});

// ==============================================================================
// 8. КРИТЕРИЙ 1: Тест на параллельную гонку активаций N+1 (Promise.all)
// ==============================================================================
test("Параллельная гонка активаций N+1 черновиков через Promise.all (grantPromotion): при лимите тарифа N=3 создаём 5 черновиков — активными в БД становится строго <= N=3", async () => {
  const origFrom = supabase.from;
  const tick = () => new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 5)));

  const userId = "user-race-tariff-test";
  const subState = {
    id: "sub-race-test-1",
    user_id: userId,
    is_active: true,
    is_individual: true,
    active_listings_limit: 3,
    listings_used: 0,
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };

  const listingsMap = new Map();
  // Создаём 5 черновиков (N+1, при лимите N=3)
  for (let i = 1; i <= 5; i++) {
    listingsMap.set(`draft-${i}`, {
      id: `draft-${i}`,
      user_id: userId,
      status: "draft",
      expires_at: null,
      title: `Черновик ${i}`,
    });
  }

  try {
    supabase.from = (table) => {
      if (table === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                await tick();
                return { data: { ...subState }, error: null };
              },
              single: async () => {
                await tick();
                return { data: { ...subState }, error: null };
              },
            }),
          }),
          update: (updates) => {
            let expectedUsed = undefined;
            const builder = {
              eq(col, val) {
                if (col === "listings_used") expectedUsed = val;
                return builder;
              },
              select() {
                return {
                  maybeSingle: async () => {
                    await tick();
                    if (expectedUsed !== undefined && subState.listings_used !== expectedUsed) {
                      return { data: null, error: null }; // conflict due to concurrent write!
                    }
                    if (updates.listings_used !== undefined) {
                      subState.listings_used = updates.listings_used;
                    }
                    return { data: { id: subState.id }, error: null };
                  },
                };
              },
              then(resolve, reject) {
                (async () => {
                  await tick();
                  if (updates.listings_used !== undefined) {
                    subState.listings_used = updates.listings_used;
                  }
                  resolve({ error: null });
                })().catch(reject);
              },
            };
            return builder;
          },
        };
      }

      if (table === "listings") {
        return {
          select: (cols, opts) => {
            if (opts && opts.count) {
              let excludeId = null;
              return {
                eq: () => ({
                  eq: () => ({
                    neq: (f, val) => {
                      excludeId = val;
                      return {
                        or: async () => {
                          await tick();
                          const count = [...listingsMap.values()].filter(
                            (l) => l.user_id === userId && l.status === "active" && l.id !== excludeId
                          ).length;
                          return { count, error: null };
                        },
                      };
                    },
                    or: async () => {
                      await tick();
                      const count = [...listingsMap.values()].filter(
                        (l) => l.user_id === userId && l.status === "active" && l.id !== excludeId
                      ).length;
                      return { count, error: null };
                    },
                  }),
                }),
              };
            }

            return {
              eq: (col, val) => ({
                maybeSingle: async () => {
                  await tick();
                  const item = listingsMap.get(val);
                  return { data: item ? { ...item } : null, error: null };
                },
                single: async () => {
                  await tick();
                  const item = listingsMap.get(val);
                  return { data: item ? { ...item } : null, error: null };
                },
              }),
            };
          },
          update: (updates) => ({
            eq: (col, val) => {
              const p = Promise.resolve().then(async () => {
                await tick();
                const item = listingsMap.get(val);
                if (item) Object.assign(item, updates);
                return { error: null };
              });
              p.select = () => ({
                single: async () => {
                  await tick();
                  const item = listingsMap.get(val);
                  if (item) Object.assign(item, updates);
                  return { data: item ? { ...item } : null, error: null };
                },
              });
              return p;
            },
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    };

    const draftIds = ["draft-1", "draft-2", "draft-3", "draft-4", "draft-5"];
    const results = await Promise.all(
      draftIds.map((id) => grantPromotion({ listingId: id, serviceType: "vip", days: 7 }))
    );

    const activeListings = [...listingsMap.values()].filter((l) => l.status === "active");
    const successfulActivations = results.filter((r) => r === true);

    // Главная проверка приёмки: активными в БД должно стать строго не более установленного лимита N=3
    assert.ok(
      activeListings.length <= 3,
      `В БД активными должно стать строго не более лимита N=3, фактически: ${activeListings.length}`
    );
    assert.equal(
      activeListings.length,
      successfulActivations.length,
      "Количество активных записей в БД должно точно соответствовать числу успешных активаций"
    );
    assert.ok(
      subState.listings_used <= 3,
      `Счётчик listings_used по тарифу не должен превысить лимит N=3, фактически: ${subState.listings_used}`
    );

    // Черновики, не попавшие в лимит, должны остаться в статусе draft
    const remainingDrafts = [...listingsMap.values()].filter((l) => l.status === "draft");
    assert.equal(
      activeListings.length + remainingDrafts.length,
      5,
      "Все объявления должны быть либо active, либо остаться draft"
    );
  } finally {
    supabase.from = origFrom;
  }
});

test("Параллельная гонка реактиваций N+1 скрытых объявлений через Promise.all (updateListing): при лимите N=2 для personal — активными в БД остаётся строго <= N=2 благодаря raceCheck", async () => {
  const origFrom = supabase.from;
  const tick = () => new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 5)));

  const userId = "user-race-personal-test";
  const listingsMap = new Map();
  // Создаём 5 скрытых объявлений при лимите 2 для personal
  for (let i = 1; i <= 5; i++) {
    listingsMap.set(`hidden-${i}`, {
      id: `hidden-${i}`,
      user_id: userId,
      status: "hidden",
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      title: `Объявление ${i}`,
    });
  }

  try {
    supabase.from = (table) => {
      if (table === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                await tick();
                return { data: null, error: null };
              },
              single: async () => {
                await tick();
                return { data: null, error: null };
              },
            }),
          }),
        };
      }
      if (table === "users") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                await tick();
                return { data: { account_type: "personal" }, error: null };
              },
            }),
          }),
        };
      }
      if (table === "listings") {
        return {
          select: (cols, opts) => {
            if (opts && opts.count) {
              let excludeId = null;
              return {
                eq: () => ({
                  eq: () => ({
                    neq: (f, val) => {
                      excludeId = val;
                      return {
                        or: async () => {
                          await tick();
                          const count = [...listingsMap.values()].filter(
                            (l) => l.user_id === userId && l.status === "active" && l.id !== excludeId
                          ).length;
                          return { count, error: null };
                        },
                      };
                    },
                    or: async () => {
                      await tick();
                      const count = [...listingsMap.values()].filter(
                        (l) => l.user_id === userId && l.status === "active" && l.id !== excludeId
                      ).length;
                      return { count, error: null };
                    },
                  }),
                }),
              };
            }

            return {
              eq: (col, val) => ({
                maybeSingle: async () => {
                  await tick();
                  const item = listingsMap.get(val);
                  return { data: item ? { ...item } : null, error: null };
                },
                single: async () => {
                  await tick();
                  const item = listingsMap.get(val);
                  return { data: item ? { ...item } : null, error: null };
                },
              }),
            };
          },
          update: (updates) => ({
            eq: (col, val) => {
              const p = Promise.resolve().then(async () => {
                await tick();
                const item = listingsMap.get(val);
                if (item) Object.assign(item, updates);
                return { error: null };
              });
              p.select = () => ({
                single: async () => {
                  await tick();
                  const item = listingsMap.get(val);
                  if (item) Object.assign(item, updates);
                  return { data: item ? { ...item } : null, error: null };
                },
              });
              return p;
            },
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    };

    const hiddenIds = ["hidden-1", "hidden-2", "hidden-3", "hidden-4", "hidden-5"];
    const responses = hiddenIds.map(() => createMockRes());

    await Promise.all(
      hiddenIds.map((id, idx) => {
        const req = {
          params: { id },
          user: { id: userId, role: "personal", account_type: "personal" },
          body: { status: "active" },
        };
        return updateListing(req, responses[idx]);
      })
    );

    const activeListings = [...listingsMap.values()].filter((l) => l.status === "active");

    // Главная проверка приёмки: активными в БД должно остаться строго не более лимита N=2
    assert.ok(
      activeListings.length <= 2,
      `В БД активными должно остаться строго не более лимита N=2, фактически: ${activeListings.length}`
    );

    // Должны быть возвращены 403 Forbidden для тех, кто превысил лимит
    const forbiddenCount = responses.filter((r) => r.statusCode === 403).length;
    assert.ok(
      forbiddenCount >= 3,
      `Как минимум 3 запроса из 5 должны получить 403 Forbidden, фактически: ${forbiddenCount}`
    );
  } finally {
    supabase.from = origFrom;
  }
});

