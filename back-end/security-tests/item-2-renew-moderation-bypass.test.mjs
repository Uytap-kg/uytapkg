import test from "node:test";
import assert from "node:assert/strict";

import {
  renewListing,
  updateListing,
  canOwnerTransition,
} from "../src/controllers/listingsController.js";
import { supabase } from "../src/config/db.js";

/**
 * Создаёт мок объекта ответа Express (res)
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
 * Хелпер для создания мока Supabase с управляемым состоянием
 */
function setupDbMock({
  listing,
  activeCount = 0,
  subscription = null,
} = {}) {
  let currentListing = listing ? { ...listing } : null;
  const updateCalls = [];

  const mockFrom = (table) => {
    if (table === "subscriptions") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: subscription,
              error: null,
            }),
            single: async () => ({
              data: subscription,
              error: null,
            }),
          }),
        }),
      };
    }

    if (table === "listings") {
      return {
        select: (fields, options) => {
          // Запрос подсчёта активных объявлений для проверки лимита тарифа
          if (options && options.count) {
            return {
              eq: () => ({
                eq: () => ({
                  or: async () => ({
                    count: activeCount,
                    error: null,
                  }),
                }),
              }),
            };
          }

          // Обычный select объявления по id
          return {
            eq: (col, val) => ({
              single: async () => {
                if (!currentListing || currentListing.id !== val) {
                  return { data: null, error: { message: "Listing not found" } };
                }
                return { data: { ...currentListing }, error: null };
              },
              maybeSingle: async () => {
                if (!currentListing || currentListing.id !== val) {
                  return { data: null, error: null };
                }
                return { data: { ...currentListing }, error: null };
              },
            }),
          };
        },
        update: (updates) => {
          updateCalls.push(updates);
          if (currentListing) {
            currentListing = { ...currentListing, ...updates };
          }
          const eqResult = {
            then: (resolve) => resolve({ data: { ...currentListing }, error: null }),
            select: () => ({
              single: async () => ({
                data: {
                  ...currentListing,
                  listing_photos: [],
                },
                error: null,
              }),
            }),
            single: async () => ({
              data: { ...currentListing },
              error: null,
            }),
          };
          return {
            eq: () => eqResult,
          };
        },
        delete: () => ({
          eq: async () => ({ data: null, error: null }),
        }),
      };
    }

    if (table === "listing_photos") {
      return {
        delete: () => ({
          eq: async () => ({ data: null, error: null }),
        }),
        insert: async () => ({ data: [], error: null }),
      };
    }

    if (table === "residential_complexes") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      };
    }

    throw new Error(`Unexpected table queried in mock: ${table}`);
  };

  return {
    mockFrom,
    getUpdateCalls: () => updateCalls,
    getCurrentListing: () => currentListing,
  };
}

// ==============================================================================
// КРИТЕРИЙ 1: POST /api/listings/:id/renew на объявление со статусом "moderation"
// ==============================================================================
test("Критерий 1: POST /api/listings/:id/renew на объявление со статусом 'moderation' возвращает 403 Forbidden, статус в БД остаётся 'moderation', срок не продлевается", async () => {
  const origFrom = supabase.from;
  const initialExpiry = "2026-10-10T00:00:00.000Z";

  const initialListing = {
    id: "listing-mod-001",
    user_id: "user-owner-001",
    status: "moderation",
    expires_at: initialExpiry,
    title: "Квартира на модерации",
    price: 50000,
    currency: "USD",
  };

  const { mockFrom, getUpdateCalls, getCurrentListing } = setupDbMock({
    listing: initialListing,
  });

  try {
    supabase.from = mockFrom;

    const req = {
      params: { id: "listing-mod-001" },
      user: { id: "user-owner-001", role: "personal", account_type: "personal" },
    };
    const res = createMockRes();

    await renewListing(req, res);

    // 1. Проверяем HTTP статус и сообщение об ошибке
    assert.equal(res.statusCode, 403, `Ожидался HTTP 403 Forbidden, получено: ${res.statusCode}`);
    assert.equal(res.body?.success, false, "Ответ должен содержать success: false");
    assert.equal(
      res.body?.message,
      "Нельзя продлить объявление, находящееся на модерации",
      "Сообщение должно прямо указывать на запрет продления объявлений на модерации"
    );

    // 2. Проверяем, что в базу данных не отправлялось ни одного запроса на обновление
    const updateCalls = getUpdateCalls();
    assert.equal(updateCalls.length, 0, "Запрос update в БД не должен выполняться при попытке продления moderation");

    // 3. Проверяем неизменность статуса и срока объявления в БД
    const currentListing = getCurrentListing();
    assert.equal(currentListing.status, "moderation", "Статус объявления в БД должен оставаться 'moderation'");
    assert.equal(currentListing.expires_at, initialExpiry, "Срок действия expires_at не должен изменяться");
  } finally {
    supabase.from = origFrom;
  }
});

// ==============================================================================
// КРИТЕРИЙ 2: POST /api/listings/:id/renew на объявление со статусом "draft"
// ==============================================================================
test("Критерий 2: POST /api/listings/:id/renew на объявление со статусом 'draft' (неоплаченный черновик) возвращает 403 Forbidden, статус в БД остаётся 'draft'", async () => {
  const origFrom = supabase.from;
  const initialExpiry = "2026-10-10T00:00:00.000Z";

  const initialListing = {
    id: "listing-draft-001",
    user_id: "user-owner-001",
    status: "draft",
    expires_at: initialExpiry,
    title: "Неоплаченный черновик объявления",
    price: 75000,
    currency: "USD",
  };

  const { mockFrom, getUpdateCalls, getCurrentListing } = setupDbMock({
    listing: initialListing,
  });

  try {
    supabase.from = mockFrom;

    const req = {
      params: { id: "listing-draft-001" },
      user: { id: "user-owner-001", role: "personal", account_type: "personal" },
    };
    const res = createMockRes();

    await renewListing(req, res);

    // 1. Проверяем HTTP статус и сообщение об ошибке
    assert.equal(res.statusCode, 403, `Ожидался HTTP 403 Forbidden, получено: ${res.statusCode}`);
    assert.equal(res.body?.success, false, "Ответ должен содержать success: false");
    assert.equal(
      res.body?.message,
      "Нельзя продлить неоплаченный черновик. Завершите оплату публикации",
      "Сообщение должно указывать на необходимость оплаты черновика"
    );

    // 2. Проверяем, что в БД не было обновлений
    const updateCalls = getUpdateCalls();
    assert.equal(updateCalls.length, 0, "Запрос update в БД не должен выполняться при попытке продления draft");

    // 3. Проверяем неизменность статуса и срока объявления в БД
    const currentListing = getCurrentListing();
    assert.equal(currentListing.status, "draft", "Статус объявления в БД должен оставаться 'draft'");
    assert.equal(currentListing.expires_at, initialExpiry, "Срок действия expires_at не должен изменяться");
  } finally {
    supabase.from = origFrom;
  }
});

// ==============================================================================
// КРИТЕРИЙ 3 (а): canOwnerTransition — матрица разрешённых и запрещённых переходов
// ==============================================================================
test("Критерий 3 (а): canOwnerTransition — запрещает не-админу переходы из/в moderation, draft->active, и разрешает легитимные переходы", () => {
  // Запрет перехода из moderation в active
  const modToActive = canOwnerTransition("moderation", "active");
  assert.equal(modToActive.allowed, false, "Переход moderation -> active должен быть запрещён");
  assert.equal(modToActive.message, "Статус модерации может изменить только администратор");

  // Запрет перехода из active в moderation
  const activeToMod = canOwnerTransition("active", "moderation");
  assert.equal(activeToMod.allowed, false, "Переход active -> moderation должен быть запрещён");
  assert.equal(activeToMod.message, "Статус модерации может изменить только администратор");

  // Запрет перехода из draft в moderation
  const draftToMod = canOwnerTransition("draft", "moderation");
  assert.equal(draftToMod.allowed, false, "Переход draft -> moderation должен быть запрещён");
  assert.equal(draftToMod.message, "Статус модерации может изменить только администратор");

  // Запрет перехода из moderation в hidden
  const modToHidden = canOwnerTransition("moderation", "hidden");
  assert.equal(modToHidden.allowed, false, "Переход moderation -> hidden должен быть запрещён");
  assert.equal(modToHidden.message, "Статус модерации может изменить только администратор");

  // Запрет прямого перехода из draft в active
  const draftToActive = canOwnerTransition("draft", "active");
  assert.equal(draftToActive.allowed, false, "Переход draft -> active должен быть запрещён");
  assert.equal(draftToActive.message, "Черновик объявления ожидает оплаты или подтверждения публикации");

  // Запрет невалидных произвольных переходов
  const activeToDraft = canOwnerTransition("active", "draft");
  assert.equal(activeToDraft.allowed, false, "Переход active -> draft должен быть запрещён");

  const hiddenToDraft = canOwnerTransition("hidden", "draft");
  assert.equal(hiddenToDraft.allowed, false, "Переход hidden -> draft должен быть запрещён");

  // Легитимные переходы владельца (active <-> hidden, повторный выбор текущего статуса, draft -> hidden)
  assert.equal(canOwnerTransition("active", "hidden").allowed, true, "Переход active -> hidden разрешён");
  assert.equal(canOwnerTransition("hidden", "active").allowed, true, "Переход hidden -> active разрешён");
  assert.equal(canOwnerTransition("active", "active").allowed, true, "Переход active -> active разрешён");
  assert.equal(canOwnerTransition("hidden", "hidden").allowed, true, "Переход hidden -> hidden разрешён");
  assert.equal(canOwnerTransition("draft", "draft").allowed, true, "Переход draft -> draft разрешён");
  assert.equal(canOwnerTransition("draft", "hidden").allowed, true, "Переход draft -> hidden разрешён");
});

// ==============================================================================
// КРИТЕРИЙ 3 (б): PUT /api/listings/:id (updateListing) — запрет обхода модерации и активации черновика
// ==============================================================================
test("Критерий 3 (б): updateListing — не-админ не может перевести объявление из moderation в active через PUT", async () => {
  const origFrom = supabase.from;
  const initialListing = {
    id: "listing-mod-put",
    user_id: "user-owner-001",
    status: "moderation",
    title: "Квартира на модерации",
    price: 60000,
    currency: "USD",
  };

  const { mockFrom, getUpdateCalls, getCurrentListing } = setupDbMock({
    listing: initialListing,
  });

  try {
    supabase.from = mockFrom;

    const req = {
      params: { id: "listing-mod-put" },
      user: { id: "user-owner-001", role: "personal", account_type: "personal" },
      body: {
        status: "active",
      },
    };
    const res = createMockRes();

    await updateListing(req, res);

    assert.equal(res.statusCode, 403, "Ожидался HTTP 403 Forbidden");
    assert.equal(res.body?.success, false);
    assert.equal(res.body?.message, "Статус модерации может изменить только администратор");

    const updateCalls = getUpdateCalls();
    assert.equal(updateCalls.length, 0, "Обновление в БД не должно выполняться");
    assert.equal(getCurrentListing().status, "moderation", "Статус в БД должен оставаться 'moderation'");
  } finally {
    supabase.from = origFrom;
  }
});

test("Критерий 3 (в): updateListing — не-админ не может перевести объявление из draft в active через PUT", async () => {
  const origFrom = supabase.from;
  const initialListing = {
    id: "listing-draft-put",
    user_id: "user-owner-001",
    status: "draft",
    title: "Черновик объявления",
    price: 60000,
    currency: "USD",
  };

  const { mockFrom, getUpdateCalls, getCurrentListing } = setupDbMock({
    listing: initialListing,
  });

  try {
    supabase.from = mockFrom;

    const req = {
      params: { id: "listing-draft-put" },
      user: { id: "user-owner-001", role: "personal", account_type: "personal" },
      body: {
        status: "active",
      },
    };
    const res = createMockRes();

    await updateListing(req, res);

    assert.equal(res.statusCode, 403, "Ожидался HTTP 403 Forbidden");
    assert.equal(res.body?.success, false);
    assert.equal(res.body?.message, "Черновик объявления ожидает оплаты или подтверждения публикации");

    const updateCalls = getUpdateCalls();
    assert.equal(updateCalls.length, 0, "Обновление в БД не должно выполняться");
    assert.equal(getCurrentListing().status, "draft", "Статус в БД должен оставаться 'draft'");
  } finally {
    supabase.from = origFrom;
  }
});

test("Критерий 3 (г): updateListing — разрешает легитимные переходы владельца active <-> hidden", async () => {
  const origFrom = supabase.from;
  const activeListing = {
    id: "listing-legit-put",
    user_id: "user-owner-001",
    status: "active",
    title: "Действующее объявление",
    price: 60000,
    currency: "USD",
  };

  const { mockFrom, getUpdateCalls, getCurrentListing } = setupDbMock({
    listing: activeListing,
    activeCount: 1,
  });

  try {
    supabase.from = mockFrom;

    // 1. Переход active -> hidden
    const reqHide = {
      params: { id: "listing-legit-put" },
      user: { id: "user-owner-001", role: "personal", account_type: "personal" },
      body: {
        status: "hidden",
      },
    };
    const resHide = createMockRes();

    await updateListing(reqHide, resHide);

    assert.equal(resHide.statusCode, 200, "Переход active -> hidden должен возвращать 200 OK");
    assert.equal(resHide.body?.success, true);
    assert.equal(getCurrentListing().status, "hidden", "Статус в БД должен стать 'hidden'");

    // 2. Переход hidden -> active (при наличии доступного лимита)
    const reqActivate = {
      params: { id: "listing-legit-put" },
      user: { id: "user-owner-001", role: "personal", account_type: "personal" },
      body: {
        status: "active",
      },
    };
    const resActivate = createMockRes();

    await updateListing(reqActivate, resActivate);

    assert.equal(resActivate.statusCode, 200, "Переход hidden -> active должен возвращать 200 OK");
    assert.equal(resActivate.body?.success, true);
    assert.equal(getCurrentListing().status, "active", "Статус в БД должен вернуться в 'active'");
  } finally {
    supabase.from = origFrom;
  }
});

// ==============================================================================
// КРИТЕРИЙ 4 (а): POST /api/listings/:id/renew для легитимного активного (active) объявления
// ==============================================================================
test("Критерий 4 (а): POST /api/listings/:id/renew для легитимного активного объявления успешно продлевает объявление на 40 дней со статусом 'active'", async () => {
  const origFrom = supabase.from;
  const oldExpiry = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();

  const activeListing = {
    id: "listing-active-001",
    user_id: "user-owner-001",
    status: "active",
    expires_at: oldExpiry,
    title: "Активное объявление для продления",
    price: 90000,
    currency: "USD",
  };

  const { mockFrom, getUpdateCalls, getCurrentListing } = setupDbMock({
    listing: activeListing,
  });

  try {
    supabase.from = mockFrom;

    const req = {
      params: { id: "listing-active-001" },
      user: { id: "user-owner-001", role: "personal", account_type: "personal" },
    };
    const res = createMockRes();

    const beforeCall = Date.now();
    await renewListing(req, res);
    const afterCall = Date.now();

    // 1. Проверяем успешный HTTP ответ
    assert.equal(res.statusCode, 200, `Ожидался HTTP 200 OK, получено: ${res.statusCode}`);
    assert.equal(res.body?.success, true);
    assert.equal(res.body?.message, "Объявление успешно продлено на 40 дней");

    // 2. Проверяем вызов update в БД
    const updateCalls = getUpdateCalls();
    assert.equal(updateCalls.length, 1, "Должен быть ровно 1 вызов update в БД");
    const sentUpdate = updateCalls[0];
    assert.equal(sentUpdate.status, "active", "Статус в запросе обновления должен быть 'active'");

    // 3. Проверяем корректность продления на 40 дней (серверный расчёт)
    assert.ok(sentUpdate.expires_at, "Поле expires_at должно быть передано в обновлении");
    const updatedExpiryMs = new Date(sentUpdate.expires_at).getTime();
    const expectedExpiryMin = beforeCall + 40 * 24 * 60 * 60 * 1000;
    const expectedExpiryMax = afterCall + 40 * 24 * 60 * 60 * 1000;

    assert.ok(
      updatedExpiryMs >= expectedExpiryMin - 1000 && updatedExpiryMs <= expectedExpiryMax + 1000,
      `Новый expires_at должен отстоять ровно на 40 дней от текущего момента (${sentUpdate.expires_at})`
    );

    // 4. Проверяем возвращённый объект
    const currentListing = getCurrentListing();
    assert.equal(currentListing.status, "active", "Статус в БД должен оставаться 'active'");
    assert.equal(currentListing.expires_at, sentUpdate.expires_at, "Срок в БД должен совпадать с новым сроком");
  } finally {
    supabase.from = origFrom;
  }
});

// ==============================================================================
// КРИТЕРИЙ 4 (б): POST /api/listings/:id/renew для скрытого (hidden) объявления при соблюдении лимита тарифа
// ==============================================================================
test("Критерий 4 (б): POST /api/listings/:id/renew для скрытого (hidden) объявления при соблюдении лимита тарифа успешно продлевает на 40 дней со статусом 'active'", async () => {
  const origFrom = supabase.from;
  const expiredDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

  const hiddenListing = {
    id: "listing-hidden-001",
    user_id: "user-owner-001",
    status: "hidden",
    expires_at: expiredDate,
    title: "Скрытое объявление для реактивации через продление",
    price: 85000,
    currency: "USD",
  };

  // activeCount = 0 при бесплатном лимите для personal = 2
  const { mockFrom, getUpdateCalls, getCurrentListing } = setupDbMock({
    listing: hiddenListing,
    activeCount: 0,
  });

  try {
    supabase.from = mockFrom;

    const req = {
      params: { id: "listing-hidden-001" },
      user: { id: "user-owner-001", role: "personal", account_type: "personal" },
    };
    const res = createMockRes();

    await renewListing(req, res);

    assert.equal(res.statusCode, 200, `Ожидался HTTP 200 OK, получено: ${res.statusCode}`);
    assert.equal(res.body?.success, true);
    assert.equal(res.body?.message, "Объявление успешно продлено на 40 дней");

    const updateCalls = getUpdateCalls();
    assert.equal(updateCalls.length, 1);
    assert.equal(updateCalls[0].status, "active", "Статус скрытого объявления должен обновиться на 'active'");

    const currentListing = getCurrentListing();
    assert.equal(currentListing.status, "active", "Статус в БД должен стать 'active'");
    assert.ok(
      new Date(currentListing.expires_at).getTime() > Date.now() + 39 * 24 * 60 * 60 * 1000,
      "Срок объявления должен быть продлён примерно на 40 дней вперёд"
    );
  } finally {
    supabase.from = origFrom;
  }
});

// ==============================================================================
// КРИТЕРИЙ 4 (в): POST /api/listings/:id/renew для скрытого (hidden) объявления при ПРЕВЫШЕНИИ лимита тарифа
// ==============================================================================
test("Критерий 4 (в): POST /api/listings/:id/renew для скрытого объявления при ПРЕВЫШЕНИИ лимита тарифа возвращает 403 Forbidden и не меняет статус", async () => {
  const origFrom = supabase.from;
  const expiredDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

  const hiddenListing = {
    id: "listing-hidden-overlimit",
    user_id: "user-owner-001",
    status: "hidden",
    expires_at: expiredDate,
    title: "Скрытое объявление при исчерпанном лимите",
    price: 85000,
    currency: "USD",
  };

  // activeCount = 2, что равно максимальному бесплатному лимиту для personal (2)
  const { mockFrom, getUpdateCalls, getCurrentListing } = setupDbMock({
    listing: hiddenListing,
    activeCount: 2,
  });

  try {
    supabase.from = mockFrom;

    const req = {
      params: { id: "listing-hidden-overlimit" },
      user: { id: "user-owner-001", role: "personal", account_type: "personal" },
    };
    const res = createMockRes();

    await renewListing(req, res);

    assert.equal(res.statusCode, 403, `Ожидался HTTP 403 Forbidden, получено: ${res.statusCode}`);
    assert.equal(res.body?.success, false);
    assert.match(
      res.body?.message,
      /Достигнут лимит активных объявлений/i,
      "Сообщение должно указывать на достижение лимита активных объявлений"
    );

    const updateCalls = getUpdateCalls();
    assert.equal(updateCalls.length, 0, "Запрос update в БД не должен выполняться при превышении лимита");
    assert.equal(getCurrentListing().status, "hidden", "Статус объявления в БД должен оставаться 'hidden'");
    assert.equal(getCurrentListing().expires_at, expiredDate, "Срок действия в БД не должен изменяться");
  } finally {
    supabase.from = origFrom;
  }
});

// ==============================================================================
// КРИТЕРИЙ 4 (г): POST /api/listings/:id/renew — Защита от IDOR (чужой пользователь не может продлить объявление)
// ==============================================================================
test("Критерий 4 (г): POST /api/listings/:id/renew — попытка продления чужого объявления не-администратором отклоняется с 403 Forbidden (IDOR Protection)", async () => {
  const origFrom = supabase.from;
  const victimListing = {
    id: "listing-victim-001",
    user_id: "user-victim-001",
    status: "active",
    expires_at: "2026-10-15T00:00:00.000Z",
    title: "Чужое объявление",
    price: 100000,
    currency: "USD",
  };

  const { mockFrom, getUpdateCalls, getCurrentListing } = setupDbMock({
    listing: victimListing,
  });

  try {
    supabase.from = mockFrom;

    const req = {
      params: { id: "listing-victim-001" },
      user: { id: "user-attacker-666", role: "personal", account_type: "personal" },
    };
    const res = createMockRes();

    await renewListing(req, res);

    assert.equal(res.statusCode, 403, `Ожидался HTTP 403 Forbidden, получено: ${res.statusCode}`);
    assert.equal(res.body?.success, false);
    assert.equal(res.body?.message, "Вы не являетесь владельцем этого объявления");

    const updateCalls = getUpdateCalls();
    assert.equal(updateCalls.length, 0, "Запрос update в БД не должен выполняться при чужом user_id");
    assert.equal(getCurrentListing().status, "active");
  } finally {
    supabase.from = origFrom;
  }
});
