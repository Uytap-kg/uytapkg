import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });
dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-key-32-chars-minimum-length!!";

import {
  getListingById,
  sanitizeAuthorPII,
  shouldIncrementView,
  viewsThrottleMap,
  VIEW_THROTTLE_MS,
  getClientIp,
  incrementListingViews,
  resolveCurrentUser,
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
 * Хелпер для создания стандартного тестового объявления
 */
function createMockListing(overrides = {}) {
  const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  return {
    id: "listing-test-uuid-001",
    user_id: "author-owner-uuid-111",
    title: "Уютная 2-комнатная квартира",
    description: "Светлая просторная квартира в тихом районе",
    status: "active",
    expires_at: futureDate,
    price: 65000,
    currency: "USD",
    views_count: 10,
    listing_photos: [
      { id: "photo-1", url: "https://storage.local/photo1.jpg", is_main: true }
    ],
    users: {
      id: "author-owner-uuid-111",
      account_type: "personal",
      email: "author-private@example.com",
      phone: "+996555123456",
      is_verified: true,
      show_phone: false,
      user_profiles: {
        first_name: "Азамат",
        last_name: "Бакиров",
        company_name: null,
        avatar_url: null,
        about: "Частный собственник",
        show_phone: false,
      },
    },
    ...overrides,
  };
}

/**
 * Хелпер для настройки мока Supabase
 */
function setupDbMock({ listing = null, users = {}, rpcIncrementResult = null } = {}) {
  const origFrom = supabase.from;
  const origRpc = supabase.rpc;

  let rpcCallCount = 0;
  let updateCallCount = 0;
  let currentViews = listing ? listing.views_count : 0;

  supabase.from = (table) => {
    if (table === "listings") {
      return {
        select: () => ({
          eq: (col, val) => ({
            single: async () => {
              if (listing && (val === undefined || listing.id === val)) {
                return { data: JSON.parse(JSON.stringify(listing)), error: null };
              }
              return { data: null, error: { message: "Listing not found" } };
            },
            maybeSingle: async () => {
              if (listing && (val === undefined || listing.id === val)) {
                return { data: JSON.parse(JSON.stringify(listing)), error: null };
              }
              return { data: null, error: null };
            },
          }),
        }),
        update: (updates) => {
          updateCallCount++;
          if (updates && typeof updates.views_count === "number") {
            currentViews = updates.views_count;
            if (listing) listing.views_count = updates.views_count;
          }
          return {
            eq: () => ({
              select: () => ({
                single: async () => ({
                  data: { ...listing, ...updates },
                  error: null,
                }),
              }),
            }),
          };
        },
      };
    }

    if (table === "users") {
      return {
        select: () => ({
          eq: (col, val) => ({
            maybeSingle: async () => {
              const u = users[val] || Object.values(users).find((x) => x.id === val);
              return { data: u ? { ...u } : null, error: null };
            },
            single: async () => {
              const u = users[val] || Object.values(users).find((x) => x.id === val);
              if (!u) return { data: null, error: { message: "User not found" } };
              return { data: { ...u }, error: null };
            },
          }),
        }),
      };
    }

    return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    };
  };

  supabase.rpc = async (fn, params) => {
    if (fn === "increment_views") {
      rpcCallCount++;
      if (rpcIncrementResult !== null) {
        return rpcIncrementResult;
      }
      currentViews += 1;
      if (listing) listing.views_count = currentViews;
      return { data: currentViews, error: null };
    }
    return { data: null, error: { message: `Unknown RPC function: ${fn}` } };
  };

  return {
    restore: () => {
      supabase.from = origFrom;
      supabase.rpc = origRpc;
    },
    getRpcCallCount: () => rpcCallCount,
    getUpdateCallCount: () => updateCallCount,
    getCurrentViews: () => currentViews,
  };
}

// ==============================================================================
// 1. КРИТЕРИЙ 1: СОКРЫТИЕ PII (EMAIL И ТЕЛЕФОНА) PERSONAL-АВТОРА
// ==============================================================================

test("Критерий 1.1: Анонимный запрос карточки personal-автора не содержит email и phone (null / удалены)", async () => {
  viewsThrottleMap.clear();
  const listing = createMockListing({
    users: {
      id: "author-owner-uuid-111",
      account_type: "personal",
      email: "confidential-seller@personal.kg",
      phone: "+996555112233",
      is_verified: true,
      show_phone: false,
      user_profiles: {
        first_name: "Бекзат",
        last_name: "Осмонов",
        show_phone: false,
      },
    },
  });

  const db = setupDbMock({ listing });
  try {
    const req = {
      params: { id: listing.id },
      headers: {},
      ip: "192.168.1.50",
    };
    const res = createMockRes();

    await getListingById(req, res);

    assert.equal(res.statusCode, 200, "Активное объявление должно быть доступно (200 OK)");
    assert.equal(res.body.success, true);

    const author = res.body.data.users;
    assert.ok(author, "Объект автора должен присутствовать в выдаче");

    // Email должен быть гарантированно удален
    assert.equal(author.email, undefined, "Поле email должно быть удалено");
    assert.equal("email" in author, false, "Ключ 'email' не должен присутствовать в объекте автора");

    // Phone для personal-продавца без флага показа должен быть строго null
    assert.equal(author.phone, null, "Телефон personal-автора должен быть null");

    // Публичные поля должны сохраняться
    assert.equal(author.account_type, "personal");
    assert.equal(author.is_verified, true);
    assert.equal(author.user_profiles.first_name, "Бекзат");
  } finally {
    db.restore();
  }
});

test("Критерий 1.2: Personal-автор с включённым флагом show_phone: true — телефон отображается, email полностью удалён", async () => {
  viewsThrottleMap.clear();
  const listing = createMockListing({
    users: {
      id: "author-owner-uuid-111",
      account_type: "personal",
      email: "optin-seller@personal.kg",
      phone: "+996555778899",
      show_phone: true,
      user_profiles: {
        first_name: "Айгуль",
        show_phone: false, // На уровне юзера включено
      },
    },
  });

  const db = setupDbMock({ listing });
  try {
    const req = {
      params: { id: listing.id },
      headers: {},
      ip: "192.168.1.51",
    };
    const res = createMockRes();

    await getListingById(req, res);

    assert.equal(res.statusCode, 200);
    const author = res.body.data.users;

    // Email по-прежнему строго отсутствует
    assert.equal(author.email, undefined);
    assert.equal("email" in author, false);

    // Телефон отображается, так как show_phone: true
    assert.equal(author.phone, "+996555778899");
  } finally {
    db.restore();
  }
});

test("Критерий 1.3: Personal-автор с флагом show_phone: true в user_profiles — телефон отображается, email полностью удалён", async () => {
  viewsThrottleMap.clear();
  const listing = createMockListing({
    users: {
      id: "author-owner-uuid-111",
      account_type: "personal",
      email: "profile-optin@personal.kg",
      phone: "+996700112233",
      show_phone: false,
      user_profiles: {
        first_name: "Эркин",
        show_phone: true, // В профиле включено
      },
    },
  });

  const db = setupDbMock({ listing });
  try {
    const req = {
      params: { id: listing.id },
      headers: {},
      ip: "192.168.1.52",
    };
    const res = createMockRes();

    await getListingById(req, res);

    assert.equal(res.statusCode, 200);
    const author = res.body.data.users;

    assert.equal("email" in author, false);
    assert.equal(author.phone, "+996700112233");
  } finally {
    db.restore();
  }
});

test("Критерий 1.4: Бизнес-аккаунты (agency, developer, realtor) — телефон всегда публичен, email ВСЕГДА полностью удалён", async () => {
  const businessTypes = ["agency", "developer", "realtor"];

  for (const accountType of businessTypes) {
    viewsThrottleMap.clear();
    const listing = createMockListing({
      users: {
        id: `author-${accountType}-uuid`,
        account_type: accountType,
        email: `corporate-secret@${accountType}.kg`,
        phone: `+996312${accountType.length}0000`,
        show_phone: false, // Даже если флаг false, для бизнеса телефон публичен
      },
    });

    const db = setupDbMock({ listing });
    try {
      const req = {
        params: { id: listing.id },
        headers: {},
        ip: `192.168.1.6${accountType.length}`,
      };
      const res = createMockRes();

      await getListingById(req, res);

      assert.equal(res.statusCode, 200);
      const author = res.body.data.users;

      // Email обязан быть полностью удален
      assert.equal(author.email, undefined, `Email для ${accountType} должен быть удален`);
      assert.equal("email" in author, false, `Ключ email для ${accountType} должен отсутствовать`);

      // Телефон должен оставаться доступным
      assert.equal(author.phone, `+996312${accountType.length}0000`);
    } finally {
      db.restore();
    }
  }
});

test("Критерий 1.5: Юнит-тестирование sanitizeAuthorPII для всех краевых случаев (массив, null, отсутствие профиля)", () => {
  // Edge-case: null / undefined / не объект
  assert.equal(sanitizeAuthorPII(null), null);
  assert.equal(sanitizeAuthorPII(undefined), undefined);

  // Edge-case: personal автор без телефона и без email
  const emptyPersonal = { id: "p1", account_type: "personal" };
  const resEmpty = sanitizeAuthorPII(emptyPersonal);
  assert.equal(resEmpty.phone, null);
  assert.equal("email" in resEmpty, false);

  // Edge-case: user_profiles в виде массива [profile]
  const authorWithArrayProfile = {
    id: "p2",
    account_type: "personal",
    email: "test@array.kg",
    phone: "+996555999000",
    user_profiles: [{ show_phone: true }],
  };
  const resArrayProfile = sanitizeAuthorPII(authorWithArrayProfile);
  assert.equal(resArrayProfile.phone, "+996555999000");
  assert.equal("email" in resArrayProfile, false);
});

// ==============================================================================
// 2. КРИТЕРИЙ 2: АНОНИМНЫЙ И СТОРОННИЙ ДОСТУП К DRAFT/MODERATION/HIDDEN/EXPIRED -> 404 NOT FOUND
// ==============================================================================

test("Критерий 2.1: Анонимный запрос чужого черновика (draft) возвращает строго 404 Not Found", async () => {
  viewsThrottleMap.clear();
  const draftListing = createMockListing({ status: "draft" });
  const db = setupDbMock({ listing: draftListing });

  try {
    const req = {
      params: { id: draftListing.id },
      headers: {}, // Анонимный запрос
    };
    const res = createMockRes();

    await getListingById(req, res);

    assert.equal(res.statusCode, 404, "Запрос черновика анонимом должен вернуть 404");
    assert.equal(res.body.success, false);
    assert.equal(res.body.message, "Объявление не найдено");
  } finally {
    db.restore();
  }
});

test("Критерий 2.2: Анонимный запрос объявления на модерации (moderation) возвращает строго 404 Not Found", async () => {
  viewsThrottleMap.clear();
  const moderationListing = createMockListing({ status: "moderation" });
  const db = setupDbMock({ listing: moderationListing });

  try {
    const req = {
      params: { id: moderationListing.id },
      headers: {},
    };
    const res = createMockRes();

    await getListingById(req, res);

    assert.equal(res.statusCode, 404, "Запрос модерации анонимом должен вернуть 404");
    assert.equal(res.body.success, false);
    assert.equal(res.body.message, "Объявление не найдено");
  } finally {
    db.restore();
  }
});

test("Критерий 2.3: Анонимный запрос скрытого объявления (hidden) возвращает строго 404 Not Found", async () => {
  viewsThrottleMap.clear();
  const hiddenListing = createMockListing({ status: "hidden" });
  const db = setupDbMock({ listing: hiddenListing });

  try {
    const req = {
      params: { id: hiddenListing.id },
      headers: {},
    };
    const res = createMockRes();

    await getListingById(req, res);

    assert.equal(res.statusCode, 404, "Запрос скрытого объявления анонимом должен вернуть 404");
    assert.equal(res.body.success, false);
    assert.equal(res.body.message, "Объявление не найдено");
  } finally {
    db.restore();
  }
});

test("Критерий 2.4: Анонимный запрос истёкшего объявления (active, но expires_at <= NOW) возвращает строго 404 Not Found", async () => {
  viewsThrottleMap.clear();
  const expiredPastDate = new Date(Date.now() - 3600 * 1000).toISOString();
  const expiredListing = createMockListing({
    status: "active",
    expires_at: expiredPastDate,
  });
  const db = setupDbMock({ listing: expiredListing });

  try {
    const req = {
      params: { id: expiredListing.id },
      headers: {},
    };
    const res = createMockRes();

    await getListingById(req, res);

    assert.equal(res.statusCode, 404, "Запрос истёкшего объявления анонимом должен вернуть 404");
    assert.equal(res.body.success, false);
    assert.equal(res.body.message, "Объявление не найдено");
  } finally {
    db.restore();
  }
});

test("Критерий 2.5: Чужой авторизованный пользователь (stranger) при запросе draft получает строго 404 Not Found", async () => {
  viewsThrottleMap.clear();
  const draftListing = createMockListing({
    user_id: "author-owner-uuid-111",
    status: "draft",
  });
  const db = setupDbMock({ listing: draftListing });

  try {
    const req = {
      params: { id: draftListing.id },
      user: { id: "stranger-user-uuid-999", role: "user" }, // Чужой аккаунт
    };
    const res = createMockRes();

    await getListingById(req, res);

    assert.equal(res.statusCode, 404, "Чужой черновик должен возвращать 404 для стороннего пользователя");
    assert.equal(res.body.success, false);
  } finally {
    db.restore();
  }
});

test("Критерий 2.6: Чужой авторизованный пользователь при запросе чужого moderation/hidden/expired получает строго 404 Not Found", async () => {
  const nonActiveStatuses = [
    { status: "moderation", expires_at: new Date(Date.now() + 86400000).toISOString() },
    { status: "hidden", expires_at: new Date(Date.now() + 86400000).toISOString() },
    { status: "active", expires_at: new Date(Date.now() - 86400000).toISOString() }, // expired
  ];

  for (const item of nonActiveStatuses) {
    viewsThrottleMap.clear();
    const listing = createMockListing({
      user_id: "author-owner-uuid-111",
      status: item.status,
      expires_at: item.expires_at,
    });
    const db = setupDbMock({ listing });

    try {
      const req = {
        params: { id: listing.id },
        user: { id: "stranger-user-uuid-999", role: "user" },
      };
      const res = createMockRes();

      await getListingById(req, res);

      assert.equal(
        res.statusCode,
        404,
        `Статус ${item.status} должен возвращать 404 для чужого пользователя`
      );
      assert.equal(res.body.success, false);
    } finally {
      db.restore();
    }
  }
});

test("Критерий 2.7: Активное неистёкшее объявление открывается анонимным и сторонним пользователям (200 OK)", async () => {
  viewsThrottleMap.clear();
  const activeListing = createMockListing({
    status: "active",
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  });
  const db = setupDbMock({ listing: activeListing });

  try {
    // 1. Анонимный
    const reqAnon = { params: { id: activeListing.id }, headers: {} };
    const resAnon = createMockRes();
    await getListingById(reqAnon, resAnon);
    assert.equal(resAnon.statusCode, 200);
    assert.equal(resAnon.body.success, true);

    // 2. Сторонний пользователь
    const reqStranger = {
      params: { id: activeListing.id },
      user: { id: "stranger-user-uuid-999", role: "user" },
    };
    const resStranger = createMockRes();
    await getListingById(reqStranger, resStranger);
    assert.equal(resStranger.statusCode, 200);
    assert.equal(resStranger.body.success, true);
  } finally {
    db.restore();
  }
});

// ==============================================================================
// 3. КРИТЕРИЙ 3: АВТОРИЗОВАННЫЙ ВЛАДЕЛЕЦ И АДМИН МОГУТ ПРОСМАТРИВАТЬ DRAFT/MODERATION (200 OK)
// ==============================================================================

test("Критерий 3.1: Авторизованный владелец просматривает свой черновик (draft) — возвращает 200 OK", async () => {
  viewsThrottleMap.clear();
  const ownerId = "author-owner-uuid-111";
  const draftListing = createMockListing({
    user_id: ownerId,
    status: "draft",
  });
  const db = setupDbMock({ listing: draftListing });

  try {
    const req = {
      params: { id: draftListing.id },
      user: { id: ownerId, role: "user" },
    };
    const res = createMockRes();

    await getListingById(req, res);

    assert.equal(res.statusCode, 200, "Владелец должен иметь доступ к своему draft (200 OK)");
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.id, draftListing.id);
    assert.equal(res.body.data.status, "draft");
  } finally {
    db.restore();
  }
});

test("Критерий 3.2: Авторизованный владелец просматривает своё объявление на модерации (moderation) — возвращает 200 OK", async () => {
  viewsThrottleMap.clear();
  const ownerId = "author-owner-uuid-111";
  const modListing = createMockListing({
    user_id: ownerId,
    status: "moderation",
  });
  const db = setupDbMock({ listing: modListing });

  try {
    const req = {
      params: { id: modListing.id },
      user: { id: ownerId, role: "user" },
    };
    const res = createMockRes();

    await getListingById(req, res);

    assert.equal(res.statusCode, 200, "Владелец должен иметь доступ к своей модерации (200 OK)");
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.status, "moderation");
  } finally {
    db.restore();
  }
});

test("Критерий 3.3: Авторизованный владелец просматривает своё скрытое (hidden) и истёкшее объявление — возвращает 200 OK", async () => {
  const ownerId = "author-owner-uuid-111";

  // Hidden
  viewsThrottleMap.clear();
  const hiddenListing = createMockListing({ user_id: ownerId, status: "hidden" });
  let db = setupDbMock({ listing: hiddenListing });
  try {
    const req = { params: { id: hiddenListing.id }, user: { id: ownerId, role: "user" } };
    const res = createMockRes();
    await getListingById(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.status, "hidden");
  } finally {
    db.restore();
  }

  // Expired
  viewsThrottleMap.clear();
  const expiredListing = createMockListing({
    user_id: ownerId,
    status: "active",
    expires_at: new Date(Date.now() - 3600000).toISOString(),
  });
  db = setupDbMock({ listing: expiredListing });
  try {
    const req = { params: { id: expiredListing.id }, user: { id: ownerId, role: "user" } };
    const res = createMockRes();
    await getListingById(req, res);
    assert.equal(res.statusCode, 200);
    // Для истёкшего объявления статус маскируется в 'expired'
    assert.equal(res.body.data.status, "expired");
  } finally {
    db.restore();
  }
});

test("Критерий 3.4: Администратор просматривает ЧУЖИЕ draft, moderation, hidden и expired — возвращает 200 OK", async () => {
  const ownerId = "author-owner-uuid-111";
  const adminUser = { id: "admin-superuser-uuid-999", role: "admin" };

  const testCases = [
    { status: "draft", expires_at: new Date(Date.now() + 86400000).toISOString() },
    { status: "moderation", expires_at: new Date(Date.now() + 86400000).toISOString() },
    { status: "hidden", expires_at: new Date(Date.now() + 86400000).toISOString() },
    { status: "active", expires_at: new Date(Date.now() - 86400000).toISOString() }, // expired
  ];

  for (const tc of testCases) {
    viewsThrottleMap.clear();
    const listing = createMockListing({
      user_id: ownerId,
      status: tc.status,
      expires_at: tc.expires_at,
    });
    const db = setupDbMock({ listing });

    try {
      const req = {
        params: { id: listing.id },
        user: adminUser,
      };
      const res = createMockRes();

      await getListingById(req, res);

      assert.equal(
        res.statusCode,
        200,
        `Администратор должен иметь доступ к чужому статусу ${tc.status} (200 OK)`
      );
      assert.equal(res.body.success, true);
    } finally {
      db.restore();
    }
  }
});

test("Критерий 3.5: Доступ владельца через реальный JWT токен в заголовке Authorization: Bearer <token>", async () => {
  viewsThrottleMap.clear();
  const ownerId = "author-owner-jwt-uuid";
  const token = jwt.sign(
    { id: ownerId, typ: "access", tv: 0, accountType: "personal" },
    JWT_SECRET,
    { algorithm: "HS256" }
  );

  const draftListing = createMockListing({
    user_id: ownerId,
    status: "draft",
  });

  const db = setupDbMock({
    listing: draftListing,
    users: {
      [ownerId]: { id: ownerId, role: "user", account_type: "personal", token_version: 0 },
    },
  });

  try {
    const req = {
      params: { id: draftListing.id },
      headers: {
        authorization: `Bearer ${token}`,
      },
    };
    const res = createMockRes();

    await getListingById(req, res);

    assert.equal(res.statusCode, 200, "Владелец с валидным JWT должен получить 200 OK");
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.id, draftListing.id);
  } finally {
    db.restore();
  }
});

// ==============================================================================
// 4. КРИТЕРИЙ 4: ЗАЩИТА СЧЁТЧИКА ПРОСМОТРОВ (VIEWS ANTI-SPAM & OWNER PROTECTION)
// ==============================================================================

test("Критерий 4.1: Просмотр владельцем не накручивает счётчик просмотров", async () => {
  viewsThrottleMap.clear();
  const ownerId = "author-owner-uuid-111";
  const initialViews = 15;
  const listing = createMockListing({
    user_id: ownerId,
    status: "active",
    views_count: initialViews,
  });

  const db = setupDbMock({ listing });
  try {
    const req = {
      params: { id: listing.id },
      user: { id: ownerId, role: "user" },
      ip: "10.0.0.1",
    };
    const res = createMockRes();

    await getListingById(req, res);

    assert.equal(res.statusCode, 200);
    // Просмотр владельца не должен инкрементировать счётчик в БД и в ответе
    assert.equal(res.body.data.views_count, initialViews, "Счётчик в ответе не должен измениться");
    assert.equal(db.getRpcCallCount(), 0, "RPC increment_views не должен вызываться для владельца");
    assert.equal(db.getUpdateCallCount(), 0, "Прямое обновление БД не должно вызываться для владельца");
  } finally {
    db.restore();
  }
});

test("Критерий 4.2: Просмотр черновика или модерации владельцем/админом не накручивает счётчик", async () => {
  viewsThrottleMap.clear();
  const ownerId = "author-owner-uuid-111";
  const draftListing = createMockListing({
    user_id: ownerId,
    status: "draft",
    views_count: 5,
  });

  const db = setupDbMock({ listing: draftListing });
  try {
    const req = {
      params: { id: draftListing.id },
      user: { id: ownerId, role: "user" },
      ip: "10.0.0.1",
    };
    const res = createMockRes();

    await getListingById(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.views_count, 5);
    assert.equal(db.getRpcCallCount(), 0);
  } finally {
    db.restore();
  }
});

test("Критерий 4.3: Первый просмотр сторонним посетителем успешно увеличивает счётчик просмотров", async () => {
  viewsThrottleMap.clear();
  const initialViews = 20;
  const listing = createMockListing({
    status: "active",
    views_count: initialViews,
  });

  const db = setupDbMock({ listing });
  try {
    const req = {
      params: { id: listing.id },
      ip: "203.0.113.10",
    };
    const res = createMockRes();

    await getListingById(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(db.getRpcCallCount(), 1, "RPC increment_views должен быть вызван ровно 1 раз");
    assert.equal(res.body.data.views_count, initialViews + 1, "Счётчик должен увеличиться на 1");
  } finally {
    db.restore();
  }
});

test("Критерий 4.4: Спам просмотров с одного IP не приводит к бесконечному инкременту views_count", async () => {
  viewsThrottleMap.clear();
  const initialViews = 50;
  const spamIp = "198.51.100.77";

  const listing = createMockListing({
    status: "active",
    views_count: initialViews,
  });

  const db = setupDbMock({ listing });
  try {
    // Выполняем 25 повторных запросов с одного и того же IP подряд (спам-атака)
    for (let i = 1; i <= 25; i++) {
      const req = {
        params: { id: listing.id },
        ip: spamIp,
      };
      const res = createMockRes();

      await getListingById(req, res);
      assert.equal(res.statusCode, 200);
    }

    // Ровно 1 вызов должен был инкрементировать счётчик, все остальные 24 должны быть заблокированы тротлингом
    assert.equal(
      db.getRpcCallCount(),
      1,
      "С одного IP за 10 минут разрешён строго 1 инкремент! Спам заблокирован."
    );
    assert.equal(db.getCurrentViews(), initialViews + 1);
  } finally {
    db.restore();
  }
});

test("Критерий 4.5: Разные IP-адреса для одного объявления инкрементируют счётчик независимо", async () => {
  viewsThrottleMap.clear();
  const initialViews = 100;
  const listing = createMockListing({
    status: "active",
    views_count: initialViews,
  });

  const db = setupDbMock({ listing });
  try {
    const uniqueIps = ["192.0.2.1", "192.0.2.2", "192.0.2.3", "192.0.2.4", "192.0.2.5"];

    for (const ip of uniqueIps) {
      const req = {
        params: { id: listing.id },
        ip,
      };
      const res = createMockRes();

      await getListingById(req, res);
      assert.equal(res.statusCode, 200);
    }

    assert.equal(db.getRpcCallCount(), uniqueIps.length, "Каждый уникальный IP должен учтен");
    assert.equal(db.getCurrentViews(), initialViews + uniqueIps.length);
  } finally {
    db.restore();
  }
});

test("Критерий 4.6: Один IP может просматривать разные объявления (не блокирует другие листинги)", async () => {
  viewsThrottleMap.clear();
  const clientIp = "192.168.1.199";

  const listing1 = createMockListing({ id: "listing-111", views_count: 10 });
  const listing2 = createMockListing({ id: "listing-222", views_count: 20 });

  let db = setupDbMock({ listing: listing1 });
  try {
    const req1 = { params: { id: listing1.id }, ip: clientIp };
    const res1 = createMockRes();
    await getListingById(req1, res1);
    assert.equal(res1.body.data.views_count, 11);
  } finally {
    db.restore();
  }

  db = setupDbMock({ listing: listing2 });
  try {
    const req2 = { params: { id: listing2.id }, ip: clientIp };
    const res2 = createMockRes();
    await getListingById(req2, res2);
    assert.equal(res2.body.data.views_count, 21, "Просмотр другого объявления должен быть учтен");
  } finally {
    db.restore();
  }
});

test("Критерий 4.7: shouldIncrementView разрешает повторный просмотр после истечения 10 минут (VIEW_THROTTLE_MS)", () => {
  viewsThrottleMap.clear();
  const ip = "192.168.0.5";
  const listingId = "listing-throttle-test";

  assert.equal(shouldIncrementView(ip, listingId), true, "1-й вызов разрешён");
  assert.equal(shouldIncrementView(ip, listingId), false, "2-й вызов в течение 10 минут заблокирован");

  // Эмулируем истечение времени (10 минут + 1 секунда)
  const key = `${ip}:${listingId}`;
  viewsThrottleMap.set(key, Date.now() - (VIEW_THROTTLE_MS + 1000));

  assert.equal(
    shouldIncrementView(ip, listingId),
    true,
    "Вызов после истечения 10 минут должен быть разрешён"
  );
});

test("Критерий 4.8: getClientIp корректно извлекает реальный IP клиента (x-forwarded-for, x-real-ip, req.ip)", () => {
  // Цепочка прокси в x-forwarded-for
  const reqForwarded = {
    headers: { "x-forwarded-for": "185.100.85.12, 10.0.0.1, 172.16.0.1" },
  };
  assert.equal(getClientIp(reqForwarded), "185.100.85.12");

  // Заголовок x-real-ip
  const reqRealIp = {
    headers: { "x-real-ip": "194.67.210.55" },
  };
  assert.equal(getClientIp(reqRealIp), "194.67.210.55");

  // Прямой req.ip
  const reqDirect = {
    headers: {},
    ip: "212.112.96.1",
  };
  assert.equal(getClientIp(reqDirect), "212.112.96.1");

  // Fallback на socket.remoteAddress
  const reqSocket = {
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  };
  assert.equal(getClientIp(reqSocket), "127.0.0.1");

  // Fallback при отсутствии данных
  assert.equal(getClientIp(null), "unknown");
});

test("Критерий 4.9: viewsThrottleMap очищает устаревшие записи при превышении размера 10000 (Memory Leak Protection)", () => {
  viewsThrottleMap.clear();

  // Заполняем карту устаревшими записями
  const oldTimestamp = Date.now() - (VIEW_THROTTLE_MS + 5000);
  for (let i = 0; i < 10005; i++) {
    viewsThrottleMap.set(`ip-${i}:listing-1`, oldTimestamp);
  }

  assert.ok(viewsThrottleMap.size > 10000, "Размер карты превысил 10000");

  // Следующий вызов должен инициировать garbage collection
  shouldIncrementView("fresh-ip", "listing-fresh");

  // Все устаревшие записи должны быть удалены
  assert.ok(
    viewsThrottleMap.size < 100,
    `Карта должна очиститься от старых записей, текущий размер: ${viewsThrottleMap.size}`
  );
});

// ==============================================================================
// 5. ПРОВЕРКА ФАЙЛОВ СХЕМЫ И МИГРАЦИИ (БАЗА ДАННЫХ И ХРАНИМЫЕ ПРОЦЕДУРЫ)
// ==============================================================================

test("Критерий 5.1: Наличие миграции 007_pii_and_views.sql с функцией increment_views и колонкой show_phone", () => {
  const migrationPath = path.resolve(__dirname, "../src/migrations/007_pii_and_views.sql");
  assert.ok(fs.existsSync(migrationPath), "Файл миграции 007_pii_and_views.sql обязан существовать");

  const content = fs.readFileSync(migrationPath, "utf-8");
  assert.ok(
    content.includes("CREATE OR REPLACE FUNCTION increment_views"),
    "Миграция должна создавать хранимую функцию increment_views"
  );
  assert.ok(
    content.includes("show_phone"),
    "Миграция должна добавлять колонку show_phone для настройки видимости телефона"
  );
});

test("Критерий 5.2: Наличие определения increment_views и show_phone в основной схеме schema.sql", () => {
  const schemaPath = path.resolve(__dirname, "../src/schema.sql");
  assert.ok(fs.existsSync(schemaPath), "Файл schema.sql обязан существовать");

  const content = fs.readFileSync(schemaPath, "utf-8");
  assert.ok(
    content.includes("increment_views"),
    "schema.sql должен объявлять функцию increment_views"
  );
  assert.ok(
    content.includes("show_phone"),
    "schema.sql должен содержать поле show_phone в таблице users"
  );
});
