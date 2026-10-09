import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });
dotenv.config();

import { generateToken, authenticateToken } from "../src/middleware/auth.js";
import authRoutes from "../src/routes/authRoutes.js";
import { logoutAll, resetPassword } from "../src/controllers/authController.js";
import { supabase } from "../src/config/db.js";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is required for security tests");
}

/**
 * Хелпер для запуска Express middleware authenticateToken с возвратом Promise
 */
function runAuthMiddleware(token, reqOverrides = {}) {
  return new Promise((resolve) => {
    let nextCalled = false;
    const req = {
      headers: {
        authorization: token ? `Bearer ${token}` : undefined,
      },
      ...reqOverrides,
    };

    const res = {
      statusCode: null,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        resolve({
          req,
          res,
          nextCalled: false,
          statusCode: this.statusCode,
          body: this.body,
        });
        return this;
      },
    };

    const next = () => {
      nextCalled = true;
      resolve({
        req,
        res,
        nextCalled: true,
        statusCode: 200,
        body: null,
        user: req.user,
      });
    };

    authenticateToken(req, res, next);
  });
}

/**
 * Хелпер для создания мока ответа Express (res)
 */
function createMockRes() {
  return {
    statusCode: null,
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
 * Хелпер создания управляемой базы данных пользователей и кодов верификации
 */
function setupMockDb({ initialUsers = [], initialVerifications = [] } = {}) {
  const users = initialUsers.map((u) => ({ ...u }));
  const verifications = initialVerifications.map((v) => ({ ...v }));
  const updatesLog = [];

  const mockFrom = (table) => {
    if (table === "users") {
      return {
        select: () => ({
          eq: (col, val) => ({
            single: async () => {
              const u = users.find((item) => item[col] === val);
              if (!u) return { data: null, error: { code: "PGRST116", message: "User not found" } };
              return { data: { ...u }, error: null };
            },
            maybeSingle: async () => {
              const u = users.find((item) => item[col] === val);
              if (!u) return { data: null, error: null };
              return { data: { ...u }, error: null };
            },
          }),
        }),
        update: (updates) => ({
          eq: (col, val) => {
            updatesLog.push({ table: "users", col, val, updates });
            const target = users.find((item) => item[col] === val);
            if (target) {
              Object.assign(target, updates);
            }
            return {
              error: null,
              data: target ? { ...target } : null,
              then: (resolve) => resolve({ data: target ? { ...target } : null, error: null }),
              select: () => ({
                maybeSingle: async () => ({
                  data: target ? { ...target } : null,
                  error: target ? null : { message: "User not found" },
                }),
                single: async () => ({
                  data: target ? { ...target } : null,
                  error: target ? null : { message: "User not found" },
                }),
              }),
            };
          },
        }),
      };
    }

    if (table === "email_verifications") {
      return {
        select: () => ({
          eq: (col1, val1) => ({
            eq: (col2, val2) => ({
              eq: (col3, val3) => ({
                maybeSingle: async () => {
                  const item = verifications.find(
                    (v) => v[col1] === val1 && v[col2] === val2 && v[col3] === val3
                  );
                  return { data: item ? { ...item } : null, error: null };
                },
              }),
            }),
          }),
        }),
        update: (updates) => ({
          eq: (col1, val1) => ({
            eq: (col2, val2) => ({
              select: () => ({
                maybeSingle: async () => {
                  const item = verifications.find(
                    (v) => v[col1] === val1 && v[col2] === val2
                  );
                  if (item) {
                    Object.assign(item, updates);
                    return { data: { id: item.id, ...updates }, error: null };
                  }
                  return { data: null, error: null };
                },
              }),
            }),
          }),
        }),
      };
    }

    throw new Error(`Unexpected table queried in mock: ${table}`);
  };

  return {
    mockFrom,
    users,
    verifications,
    updatesLog,
  };
}

// ==============================================================================
// 1. СТРУКТУРА ТОКЕНА И ФУНКЦИЯ GENERATETOKEN
// ==============================================================================

test("generateToken: включает typ: 'access', tv: 0 по умолчанию, id и ttl 1 день (86400с)", () => {
  const token = generateToken({ id: "user-test-1", accountType: "personal", email: "test@example.com" });
  const decoded = jwt.verify(token, JWT_SECRET);

  assert.equal(decoded.typ, "access", "Токен должен содержать typ: 'access'");
  assert.equal(decoded.tv, 0, "По умолчанию tv должно быть 0");
  assert.equal(decoded.id, "user-test-1");

  const ttlSeconds = decoded.exp - decoded.iat;
  assert.equal(ttlSeconds, 86400, "Срок жизни access-токена должен составлять ровно 1 день (86400 секунд)");
});

test("generateToken: корректно принимает tokenVersion и выставляет tv", () => {
  const token = generateToken({
    id: "user-test-2",
    accountType: "realtor",
    email: "realtor@example.com",
    tokenVersion: 5,
  });
  const decoded = jwt.verify(token, JWT_SECRET);

  assert.equal(decoded.typ, "access");
  assert.equal(decoded.tv, 5, "tv должно совпадать с переданным tokenVersion");
});

test("generateToken: корректно принимает tv при отсутствии tokenVersion", () => {
  const token = generateToken({
    id: "user-test-3",
    accountType: "developer",
    email: "dev@example.com",
    tv: 3,
  });
  const decoded = jwt.verify(token, JWT_SECRET);

  assert.equal(decoded.tv, 3, "tv должно браться из payload.tv");
});

// ==============================================================================
// 2. КРИТЕРИЙ 2 ТЗ: ПРОВЕРКА ТИПА ТОКЕНА (authenticateToken отклоняет typ !== 'access')
// ==============================================================================

test("Критерий 2 (а): токен сброса пароля (purpose='password_reset' без typ) отклоняется authenticateToken с кодом 401 'Недействительный тип токена'", async () => {
  const resetToken = jwt.sign(
    { email: "user@example.com", codeId: "otp-1", purpose: "password_reset" },
    JWT_SECRET,
    { expiresIn: "10m", algorithm: "HS256" }
  );

  const result = await runAuthMiddleware(resetToken);

  assert.equal(result.statusCode, 401, "Должен возвращаться статус 401 Unauthorized");
  assert.equal(result.body?.success, false);
  assert.equal(result.body?.message, "Недействительный тип токена");
  assert.equal(result.nextCalled, false, "next() не должен вызываться для resetToken");
});

test("Критерий 2 (б): токен сброса пароля с typ='password_reset' отклоняется с кодом 401 'Недействительный тип токена'", async () => {
  const resetToken = jwt.sign(
    { email: "user@example.com", codeId: "otp-2", typ: "password_reset", purpose: "password_reset" },
    JWT_SECRET,
    { expiresIn: "10m", algorithm: "HS256" }
  );

  const result = await runAuthMiddleware(resetToken);

  assert.equal(result.statusCode, 401, "Должен возвращаться статус 401 Unauthorized");
  assert.equal(result.body?.success, false);
  assert.equal(result.body?.message, "Недействительный тип токена");
  assert.equal(result.nextCalled, false, "next() не должен вызываться");
});

test("Критерий 2 (в): refresh-токен (typ='refresh') отклоняется с кодом 401 'Недействительный тип токена'", async () => {
  const refreshToken = jwt.sign(
    { id: "user-123", typ: "refresh", tv: 0 },
    JWT_SECRET,
    { expiresIn: "30d", algorithm: "HS256" }
  );

  const result = await runAuthMiddleware(refreshToken);

  assert.equal(result.statusCode, 401, "Должен возвращаться статус 401 Unauthorized");
  assert.equal(result.body?.success, false);
  assert.equal(result.body?.message, "Недействительный тип токена");
  assert.equal(result.nextCalled, false, "next() не должен вызываться");
});

test("Критерий 2 (г): токен без поля typ (undefined) отклоняется с кодом 401 и не вызывает next()", async () => {
  const forgedToken = jwt.sign(
    { id: "user-attacker", role: "admin", tv: 0 },
    JWT_SECRET,
    { expiresIn: "1d", algorithm: "HS256" }
  );

  const result = await runAuthMiddleware(forgedToken);

  assert.equal(result.statusCode, 401, "Должен возвращаться статус 401 Unauthorized");
  assert.equal(result.body?.message, "Недействительный тип токена");
  assert.equal(result.nextCalled, false, "next() не должен вызываться");
});

test("Критерий 2 (д): пустой заголовок Authorization или отсутствие токена возвращает 401 'Требуется авторизация'", async () => {
  const result = await runAuthMiddleware(null);

  assert.equal(result.statusCode, 401);
  assert.equal(result.body?.success, false);
  assert.equal(result.body?.message, "Требуется авторизация. Токен отсутствует.");
  assert.equal(result.nextCalled, false);
});

// ==============================================================================
// 3. КРИТЕРИЙ 1 ТЗ: ИНВАЛИДАЦИЯ ПРИ СБРОСЕ ПАРОЛЯ
// ==============================================================================

test("Критерий 1 (а): resetPassword инкрементирует token_version в БД и помечает reset_completed = true", async () => {
  const origFrom = supabase.from;
  const user = {
    id: "user-reset-001",
    email: "reset-target@example.com",
    account_type: "personal",
    role: "user",
    token_version: 0,
    password_hash: "$2b$10$oldhasholdhasholdhasholdhasholdhasholdhash",
  };
  const verification = {
    id: "verif-code-001",
    email: user.email,
    type: "password_reset",
    is_used: true,
    reset_completed: false,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  };

  const { mockFrom, users, verifications } = setupMockDb({
    initialUsers: [user],
    initialVerifications: [verification],
  });
  supabase.from = mockFrom;

  try {
    const resetToken = jwt.sign(
      { email: user.email, codeId: verification.id, purpose: "password_reset" },
      JWT_SECRET,
      { expiresIn: "10m", algorithm: "HS256" }
    );

    const req = {
      body: {
        resetToken,
        newPassword: "BrandNewPassword123!",
      },
    };
    const res = createMockRes();

    await resetPassword(req, res);

    assert.equal(res.statusCode, null); // res.json без предварительного status означает 200 OK
    assert.equal(res.body?.success, true);
    assert.equal(res.body?.message, "Пароль успешно изменен");

    // Проверяем состояние БД: token_version должен увеличиться с 0 до 1
    const updatedUser = users.find((u) => u.id === user.id);
    assert.equal(updatedUser.token_version, 1, "token_version пользователя должен быть инкрементирован до 1");

    // Проверяем, что код помечен как использованный
    const updatedVerif = verifications.find((v) => v.id === verification.id);
    assert.equal(updatedVerif.reset_completed, true, "reset_completed должен быть установлен в true");
  } finally {
    supabase.from = origFrom;
  }
});

test("Критерий 1 (б): старый access-токен (tv: 0) после сброса пароля даёт 401 Unauthorized при обращении к защищённым эндпоинтам", async () => {
  const origFrom = supabase.from;

  // Исходное состояние: пользователь выпустил access-токен с версией 0
  const user = {
    id: "user-reset-002",
    email: "stale-session@example.com",
    account_type: "personal",
    role: "user",
    token_version: 0,
  };

  const oldAccessToken = generateToken({
    id: user.id,
    accountType: user.account_type,
    email: user.email,
    tokenVersion: 0,
  });

  const { mockFrom, users } = setupMockDb({ initialUsers: [user] });
  supabase.from = mockFrom;

  try {
    // 1. До сброса пароля: старый токен работает корректно
    const preResetCheck = await runAuthMiddleware(oldAccessToken);
    assert.equal(preResetCheck.nextCalled, true, "До сброса пароля токен с актуальным tv должен быть валиден");
    assert.equal(preResetCheck.user?.id, user.id);

    // 2. Имитируем сброс пароля: token_version в БД инкрементируется до 1
    users[0].token_version = 1;

    // 3. После сброса пароля: тот же старый токен даёт 401 Unauthorized
    const postResetCheck = await runAuthMiddleware(oldAccessToken);
    assert.equal(postResetCheck.statusCode, 401, "Старый токен должен отклоняться с 401 Unauthorized");
    assert.equal(postResetCheck.body?.success, false);
    assert.equal(
      postResetCheck.body?.message,
      "Сессия отозвана или устарела. Пожалуйста, выполните вход заново"
    );
    assert.equal(postResetCheck.nextCalled, false, "next() не должен вызываться для отозванного токена");
  } finally {
    supabase.from = origFrom;
  }
});

test("Критерий 1 (в): защита от Replay Attack — повторное использование resetToken отклоняется (400), token_version не инкрементируется повторно", async () => {
  const origFrom = supabase.from;
  const user = {
    id: "user-reset-003",
    email: "replay-target@example.com",
    token_version: 1,
  };
  const verification = {
    id: "verif-code-003",
    email: user.email,
    type: "password_reset",
    is_used: true,
    reset_completed: true, // уже использован!
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  };

  const { mockFrom, users } = setupMockDb({
    initialUsers: [user],
    initialVerifications: [verification],
  });
  supabase.from = mockFrom;

  try {
    const resetToken = jwt.sign(
      { email: user.email, codeId: verification.id, purpose: "password_reset" },
      JWT_SECRET,
      { expiresIn: "10m", algorithm: "HS256" }
    );

    const req = { body: { resetToken, newPassword: "AnotherPassword123!" } };
    const res = createMockRes();

    await resetPassword(req, res);

    assert.equal(res.statusCode, 400, "Повторный сброс по тому же токену должен возвращать 400 Bad Request");
    assert.equal(res.body?.success, false);
    assert.equal(res.body?.message, "Этот токен сброса пароля уже был использован");
    assert.equal(users[0].token_version, 1, "token_version не должен был измениться");
  } finally {
    supabase.from = origFrom;
  }
});

// ==============================================================================
// 4. КРИТЕРИЙ 3 ТЗ: ВЫХОД СО ВСЕХ УСТРОЙСТВ (logout-all)
// ==============================================================================

test("Критерий 3 (а): роут POST /api/auth/logout-all зарегистрирован в authRoutes с middleware authenticateToken", () => {
  const logoutAllLayer = authRoutes.stack.find(
    (layer) => layer.route && layer.route.path === "/logout-all" && layer.route.methods.post
  );
  assert.ok(logoutAllLayer, "Роут POST /logout-all должен быть зарегистрирован");
  assert.equal(typeof logoutAll, "function", "logoutAll должен быть функцией-контроллером");

  // Проверяем наличие middleware аутентификации перед контроллером
  const hasAuthMiddleware = logoutAllLayer.route.stack.some(
    (handler) => handler.name === "authenticateToken" || handler.handle === authenticateToken
  );
  assert.ok(hasAuthMiddleware, "POST /logout-all обязан быть защищён authenticateToken");
});

test("Критерий 3 (б): вызов logoutAll без авторизации возвращает 401 Unauthorized", async () => {
  const req = { user: null };
  const res = createMockRes();

  await logoutAll(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body?.success, false);
  assert.equal(res.body?.message, "Требуется авторизация");
});

test("Критерий 3 (в): вызов logoutAll инкрементирует token_version в БД и возвращает 200 OK", async () => {
  const origFrom = supabase.from;
  const user = {
    id: "user-logout-001",
    email: "logout-test@example.com",
    token_version: 2,
  };

  const { mockFrom, users } = setupMockDb({ initialUsers: [user] });
  supabase.from = mockFrom;

  try {
    const req = { user: { id: user.id, token_version: 2 } };
    const res = createMockRes();

    await logoutAll(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.success, true);
    assert.equal(res.body?.message, "Все активные сессии успешно завершены");
    assert.equal(users[0].token_version, 3, "token_version в БД должен инкрементироваться с 2 до 3");
  } finally {
    supabase.from = origFrom;
  }
});

test("Критерий 3 (г): после вызова logoutAll текущий токен (tv: N) получает 401 Unauthorized при обращении к защищённым эндпоинтам", async () => {
  const origFrom = supabase.from;
  const user = {
    id: "user-logout-002",
    email: "current-session@example.com",
    account_type: "personal",
    role: "user",
    token_version: 1,
  };

  const currentToken = generateToken({
    id: user.id,
    accountType: user.account_type,
    email: user.email,
    tokenVersion: 1,
  });

  const { mockFrom, users } = setupMockDb({ initialUsers: [user] });
  supabase.from = mockFrom;

  try {
    // До logoutAll токен валиден
    const preCheck = await runAuthMiddleware(currentToken);
    assert.equal(preCheck.nextCalled, true);

    // Вызываем logoutAll с этим токеном
    const req = { user: { id: user.id, token_version: 1 } };
    const res = createMockRes();
    await logoutAll(req, res);
    assert.equal(res.statusCode, 200);

    // После logoutAll: тот же самый токен даёт 401
    const postCheck = await runAuthMiddleware(currentToken);
    assert.equal(postCheck.statusCode, 401, "Текущий токен после logoutAll должен получать 401");
    assert.equal(
      postCheck.body?.message,
      "Сессия отозвана или устарела. Пожалуйста, выполните вход заново"
    );
    assert.equal(postCheck.nextCalled, false);
  } finally {
    supabase.from = origFrom;
  }
});

test("Критерий 3 (д): после вызова logoutAll все предыдущие токены других сессий пользователя получают 401 Unauthorized", async () => {
  const origFrom = supabase.from;
  const user = {
    id: "user-multi-session",
    email: "multi-session@example.com",
    account_type: "realtor",
    role: "user",
    token_version: 1,
  };

  // Сессия A (текущий телефон), Сессия B (ноутбук), Сессия C (старый токен tv: 0)
  const tokenSessionA = generateToken({ id: user.id, tokenVersion: 1 });
  const tokenSessionB = generateToken({ id: user.id, tokenVersion: 1 });
  const tokenSessionC = generateToken({ id: user.id, tokenVersion: 0 });

  const { mockFrom, users } = setupMockDb({ initialUsers: [user] });
  supabase.from = mockFrom;

  try {
    // Сессии A и B активны
    const checkA = await runAuthMiddleware(tokenSessionA);
    const checkB = await runAuthMiddleware(tokenSessionB);
    assert.equal(checkA.nextCalled, true);
    assert.equal(checkB.nextCalled, true);

    // Пользователь нажимает "Выйти со всех устройств" с Сессии A
    const req = { user: { id: user.id, token_version: 1 } };
    const res = createMockRes();
    await logoutAll(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(users[0].token_version, 2);

    // Проверяем ВСЕ сессии: Сессия A -> 401, Сессия B -> 401, Сессия C -> 401
    const postA = await runAuthMiddleware(tokenSessionA);
    const postB = await runAuthMiddleware(tokenSessionB);
    const postC = await runAuthMiddleware(tokenSessionC);

    assert.equal(postA.statusCode, 401, "Сессия A должна быть отозвана (401)");
    assert.equal(postB.statusCode, 401, "Сессия B (другое устройство) должна быть отозвана (401)");
    assert.equal(postC.statusCode, 401, "Сессия C (старая версия) должна быть отозвана (401)");
    assert.equal(postA.nextCalled, false);
    assert.equal(postB.nextCalled, false);
    assert.equal(postC.nextCalled, false);
  } finally {
    supabase.from = origFrom;
  }
});

// ==============================================================================
// 5. КРИТЕРИЙ 4 ТЗ: НОВЫЙ ТОКЕН С АКТУАЛЬНЫМ TOKEN_VERSION
// ==============================================================================

test("Критерий 4 (а): новый токен, выпущенный с актуальным token_version после сброса пароля, успешно авторизует пользователя (200 OK)", async () => {
  const origFrom = supabase.from;
  const user = {
    id: "user-new-token-001",
    email: "fresh-token-pwd@example.com",
    account_type: "personal",
    role: "user",
    token_version: 1, // увеличенная версия после сброса
  };

  const { mockFrom } = setupMockDb({ initialUsers: [user] });
  supabase.from = mockFrom;

  try {
    // Токен со старой версией tv: 0 отклоняется
    const oldToken = generateToken({ id: user.id, tokenVersion: 0 });
    const oldCheck = await runAuthMiddleware(oldToken);
    assert.equal(oldCheck.statusCode, 401);

    // Новый токен с актуальной версией tv: 1 авторизуется успешно
    const newToken = generateToken({
      id: user.id,
      accountType: user.account_type,
      email: user.email,
      tokenVersion: user.token_version,
    });

    const newCheck = await runAuthMiddleware(newToken);
    assert.equal(newCheck.nextCalled, true, "Новый токен с актуальным tv должен пройти проверку");
    assert.equal(newCheck.user?.id, user.id);
    assert.equal(newCheck.user?.token_version, 1);
  } finally {
    supabase.from = origFrom;
  }
});

test("Критерий 4 (б): новый токен, выпущенный с актуальным token_version после logoutAll, успешно авторизует пользователя (200 OK)", async () => {
  const origFrom = supabase.from;
  const user = {
    id: "user-new-token-002",
    email: "fresh-token-logout@example.com",
    account_type: "agency",
    role: "user",
    token_version: 3, // после logoutAll версия стала 3
  };

  const { mockFrom } = setupMockDb({ initialUsers: [user] });
  supabase.from = mockFrom;

  try {
    // Токены версий 0, 1, 2 отклоняются
    for (const tv of [0, 1, 2]) {
      const revokedToken = generateToken({ id: user.id, tokenVersion: tv });
      const revokedCheck = await runAuthMiddleware(revokedToken);
      assert.equal(revokedCheck.statusCode, 401, `Токен с устаревшим tv=${tv} обязан отклоняться с 401`);
    }

    // Новый логин генерирует токен с актуальным tv: 3
    const freshToken = generateToken({
      id: user.id,
      accountType: user.account_type,
      email: user.email,
      tokenVersion: user.token_version,
    });

    const freshCheck = await runAuthMiddleware(freshToken);
    assert.equal(freshCheck.nextCalled, true, "Свежий токен с tv=3 обязан авторизовать пользователя");
    assert.equal(freshCheck.user?.id, user.id);
    assert.equal(freshCheck.user?.token_version, 3);
  } finally {
    supabase.from = origFrom;
  }
});

test("Критерий 4 (в): успешная авторизация корректно прокидывает req.user с актуальным token_version, role и account_type", async () => {
  const origFrom = supabase.from;
  const user = {
    id: "user-props-001",
    email: "props@example.com",
    account_type: "developer",
    role: "admin",
    token_version: 7,
  };

  const { mockFrom } = setupMockDb({ initialUsers: [user] });
  supabase.from = mockFrom;

  try {
    const token = generateToken({
      id: user.id,
      accountType: user.account_type,
      email: user.email,
      tokenVersion: 7,
    });

    const check = await runAuthMiddleware(token);

    assert.equal(check.nextCalled, true);
    assert.ok(check.user, "req.user должен быть заполнен");
    assert.equal(check.user.id, user.id);
    assert.equal(check.user.role, "admin", "Роль должна подтягиваться из БД");
    assert.equal(check.user.account_type, "developer");
    assert.equal(check.user.token_version, 7, "token_version в req.user должен совпадать с версией из БД");
  } finally {
    supabase.from = origFrom;
  }
});
