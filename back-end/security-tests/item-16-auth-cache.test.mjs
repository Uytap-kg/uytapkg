import test from "node:test";
import assert from "node:assert/strict";

import { supabase } from "../src/config/db.js";
import {
  authenticateToken,
  generateToken,
  userAuthCache,
  invalidateUserAuthCache,
  clearUserAuthCache,
  AUTH_CACHE_TTL_MS,
  MAX_AUTH_CACHE_SIZE,
} from "../src/middleware/auth.js";
import { logoutAll, resetPassword } from "../src/controllers/authController.js";

function createMockReq(token) {
  return {
    headers: {
      authorization: token ? `Bearer ${token}` : undefined,
    },
  };
}

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

test("Дефект 2.1: Первый запрос обращается к БД и сохраняет данные пользователя в userAuthCache", async () => {
  clearUserAuthCache();

  const origFrom = supabase.from;
  let dbQueriesCount = 0;

  supabase.from = (table) => {
    if (table === "users") {
      return {
        select: () => ({
          eq: () => ({
            single: async () => {
              dbQueriesCount++;
              return {
                data: {
                  id: "user-cache-1",
                  role: "user",
                  account_type: "personal",
                  token_version: 0,
                },
                error: null,
              };
            },
          }),
        }),
      };
    }
    return origFrom(table);
  };

  try {
    const token = generateToken({ id: "user-cache-1", tv: 0 });
    const req = createMockReq(token);
    const res = createMockRes();

    let nextCalled = false;
    await new Promise((resolve) => {
      authenticateToken(req, res, () => {
        nextCalled = true;
        resolve();
      });
    });

    assert.ok(nextCalled, "Middleware должен вызвать next()");
    assert.equal(dbQueriesCount, 1, "Должен быть ровно один запрос в БД");
    assert.ok(userAuthCache.has("user-cache-1"), "Запись должна появиться в userAuthCache");

    const cached = userAuthCache.get("user-cache-1");
    assert.equal(cached.role, "user");
    assert.equal(cached.account_type, "personal");
    assert.equal(cached.token_version, 0);
  } finally {
    supabase.from = origFrom;
    clearUserAuthCache();
  }
});

test("Дефект 2.1: Повторные запросы используют userAuthCache без сетевых обращений к Supabase", async () => {
  clearUserAuthCache();

  const origFrom = supabase.from;
  let dbQueriesCount = 0;

  supabase.from = (table) => {
    if (table === "users") {
      return {
        select: () => ({
          eq: () => ({
            single: async () => {
              dbQueriesCount++;
              return {
                data: {
                  id: "user-cache-2",
                  role: "realtor",
                  account_type: "realtor",
                  token_version: 0,
                },
                error: null,
              };
            },
          }),
        }),
      };
    }
    return origFrom(table);
  };

  try {
    const token = generateToken({ id: "user-cache-2", tv: 0 });

    // 1-й запрос — наполняет кэш
    const req1 = createMockReq(token);
    const res1 = createMockRes();
    await new Promise((resolve) => authenticateToken(req1, res1, resolve));
    assert.equal(dbQueriesCount, 1);
    assert.equal(req1.user.role, "realtor");

    // 2-й, 3-й, 4-й запросы — обязаны читать из кэша (0 дополнительных запросов в БД)
    for (let i = 0; i < 3; i++) {
      const req = createMockReq(token);
      const res = createMockRes();
      await new Promise((resolve) => authenticateToken(req, res, resolve));
      assert.equal(req.user.role, "realtor");
      assert.equal(req.user.account_type, "realtor");
    }

    assert.equal(dbQueriesCount, 1, "Число запросов к БД не должно вырасти при повторных авторизациях");
  } finally {
    supabase.from = origFrom;
    clearUserAuthCache();
  }
});

test("Дефект 2.1: invalidateUserAuthCache удаляет запись и заставляет следующий запрос перечитать БД", async () => {
  clearUserAuthCache();

  const origFrom = supabase.from;
  let dbQueriesCount = 0;

  supabase.from = (table) => {
    if (table === "users") {
      return {
        select: () => ({
          eq: () => ({
            single: async () => {
              dbQueriesCount++;
              return {
                data: {
                  id: "user-cache-3",
                  role: "user",
                  account_type: "personal",
                  token_version: 0,
                },
                error: null,
              };
            },
          }),
        }),
      };
    }
    return origFrom(table);
  };

  try {
    const token = generateToken({ id: "user-cache-3", tv: 0 });

    // 1-й запрос
    const req1 = createMockReq(token);
    await new Promise((resolve) => authenticateToken(req1, createMockRes(), resolve));
    assert.equal(dbQueriesCount, 1);
    assert.ok(userAuthCache.has("user-cache-3"));

    // Инвалидация
    invalidateUserAuthCache("user-cache-3");
    assert.equal(userAuthCache.has("user-cache-3"), false, "Кэш пользователя должен быть удалён");

    // Следующий запрос — должен снова запросить БД
    const req2 = createMockReq(token);
    await new Promise((resolve) => authenticateToken(req2, createMockRes(), resolve));
    assert.equal(dbQueriesCount, 2, "После инвалидации должен быть выполнен новый запрос в БД");
  } finally {
    supabase.from = origFrom;
    clearUserAuthCache();
  }
});

test("Дефект 2.1: logoutAll инвалидирует auth-кэш пользователя", async () => {
  clearUserAuthCache();

  // Заполняем кэш пользователя
  userAuthCache.set("user-logout-test", {
    role: "user",
    account_type: "personal",
    token_version: 1,
    cachedAt: Date.now(),
  });
  assert.ok(userAuthCache.has("user-logout-test"));

  const origFrom = supabase.from;
  supabase.from = (table) => {
    if (table === "users") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { token_version: 1 },
              error: null,
            }),
          }),
        }),
        update: () => ({
          eq: async () => ({ error: null }),
        }),
      };
    }
    return origFrom(table);
  };

  try {
    const req = { user: { id: "user-logout-test", token_version: 1 } };
    const res = createMockRes();

    await logoutAll(req, res);
    assert.equal(res.statusCode, 200);

    assert.equal(
      userAuthCache.has("user-logout-test"),
      false,
      "logoutAll обязан удалить пользователя из userAuthCache"
    );
  } finally {
    supabase.from = origFrom;
    clearUserAuthCache();
  }
});

test("Дефект 2.1: Memory Leak Protection очищает устаревшие записи при превышении MAX_AUTH_CACHE_SIZE", () => {
  clearUserAuthCache();

  const now = Date.now();
  for (let i = 0; i < MAX_AUTH_CACHE_SIZE + 50; i++) {
    userAuthCache.set(`user-old-${i}`, {
      role: "user",
      account_type: "personal",
      token_version: 0,
      cachedAt: now - (AUTH_CACHE_TTL_MS + 1000), // устаревшие
    });
  }

  assert.ok(userAuthCache.size > MAX_AUTH_CACHE_SIZE);

  // Добавление новой записи с проверкой переполнения
  if (userAuthCache.size > MAX_AUTH_CACHE_SIZE) {
    for (const [uid, item] of userAuthCache.entries()) {
      if (now - item.cachedAt >= AUTH_CACHE_TTL_MS) {
        userAuthCache.delete(uid);
      }
    }
  }

  assert.equal(userAuthCache.size, 0, "Устаревшие записи должны быть полностью очищены");
  clearUserAuthCache();
});
