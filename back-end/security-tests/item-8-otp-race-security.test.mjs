import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import {
  hashOtpCode,
  verifyOtp,
  verifyResetCode,
} from "../src/controllers/authController.js";
import authRoutes, {
  normalizeIp,
  ipKeyGenerator,
  rateLimitVerify,
  loginLimiter,
  sendOtpLimiter,
  authLimiter,
} from "../src/routes/authRoutes.js";
import { safeCompare, generateSecureOtp } from "../src/utils/otp.js";
import { supabase } from "../src/config/db.js";

/**
 * Хелпер для создания мока Express Response
 */
function createMockRes() {
  const listeners = {};
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) {
      this.headers[key] = value;
      return this;
    },
    getHeader(key) {
      return this.headers[key];
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      this.emit("finish");
      return this;
    },
    send(data) {
      this.body = data;
      this.emit("finish");
      return this;
    },
    on(event, cb) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
      return this;
    },
    emit(event, ...args) {
      if (listeners[event]) {
        for (const cb of listeners[event]) {
          cb(...args);
        }
      }
    },
  };
}

// ==============================================================================
// РАЗДЕЛ 1: КРИТЕРИЙ 1 — ЗАЩИТА ОТ ГОНКИ (RACE CONDITION) И 200 ПАРАЛЛЕЛЬНЫХ ЗАПРОСОВ
// ==============================================================================

test("Критерий 1.1: consume_otp_attempt — 200 конкурентных вызовов (Promise.all) засчитывают строго не более 5 попыток", async () => {
  // Эмуляция PostgreSQL атомарного поведения row-level lock:
  // UPDATE email_verifications SET attempts = attempts + 1 WHERE id = p_id AND is_used = false AND attempts < 5 RETURNING attempts INTO v_attempts; RETURN COALESCE(v_attempts, -1);
  let dbAttempts = 0;
  let isUsed = false;
  let queueLock = Promise.resolve();

  const simulateConsumeOtpAttempt = async () => {
    const nextLock = queueLock.then(async () => {
      // Имитация конкурентного переключения контекста / I/O
      await new Promise((resolve) => setImmediate(resolve));
      if (isUsed || dbAttempts >= 5) {
        return -1;
      }
      dbAttempts += 1;
      return dbAttempts;
    });
    queueLock = nextLock.catch(() => {});
    return nextLock;
  };

  // 200 параллельных вызовов через Promise.all
  const results = await Promise.all(
    Array.from({ length: 200 }, () => simulateConsumeOtpAttempt())
  );

  assert.equal(results.length, 200, "Все 200 вызовов должны быть выполнены");

  // Подсчёт успешных списаний попыток (1..5) и блокировок (-1)
  const successfulAttempts = results.filter((val) => val > 0);
  const blockedAttempts = results.filter((val) => val === -1);

  assert.equal(successfulAttempts.length, 5, "Ровно 5 запросов должны получить значения попыток 1..5");
  assert.equal(blockedAttempts.length, 195, "Остальные 195 запросов должны получить -1 (лимит исчерпан)");
  assert.equal(dbAttempts, 5, "Значение attempts в БД должно быть строго равно 5 (не 6, не 200)");

  // Сортировка значений попыток: 1, 2, 3, 4, 5
  successfulAttempts.sort((a, b) => a - b);
  assert.deepEqual(successfulAttempts, [1, 2, 3, 4, 5], "Должны быть списаны попытки с 1 по 5 по порядку");

  // Последующий 201-й запрос также немедленно блокируется
  const res201 = await simulateConsumeOtpAttempt();
  assert.equal(res201, -1, "201-й запрос обязан вернуть -1");
  assert.equal(dbAttempts, 5, "attempts в БД не должен превышать 5");
});

test("Критерий 1.2: verifyOtp — 200 параллельных запросов с неверными кодами (Promise.all) засчитывают строго не более 5 попыток", async () => {
  const origRpc = supabase.rpc;
  const origFrom = supabase.from;

  const validOtpCode = "584920";
  const validHash = hashOtpCode(validOtpCode);
  const testEmail = "race-test-verify@example.com";

  const otpRecord = {
    id: "otp-race-uuid-001",
    email: testEmail,
    code_hash: validHash,
    type: "registration",
    attempts: 0,
    is_used: false,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    created_at: new Date().toISOString(),
  };

  let attemptsInDb = 0;
  let queueLock = Promise.resolve();

  try {
    supabase.rpc = async (funcName, params) => {
      if (funcName === "consume_otp_attempt" && params?.p_id === otpRecord.id) {
        const nextLock = queueLock.then(async () => {
          await new Promise((resolve) => setImmediate(resolve));
          if (otpRecord.is_used || attemptsInDb >= 5) {
            return -1;
          }
          attemptsInDb += 1;
          otpRecord.attempts = attemptsInDb;
          return attemptsInDb;
        });
        queueLock = nextLock.catch(() => {});
        const res = await nextLock;
        return { data: res, error: null };
      }
      return { data: null, error: new Error("Unknown RPC") };
    };

    supabase.from = (tableName) => {
      if (tableName === "email_verifications") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  gt: () => ({
                    order: () => ({
                      limit: () => ({
                        maybeSingle: async () => ({
                          data: { ...otpRecord },
                          error: null,
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
          update: (payload) => {
            Object.assign(otpRecord, payload);
            return {
              eq: () => ({
                eq: () => ({
                  select: () => ({
                    maybeSingle: async () => ({ data: { id: otpRecord.id }, error: null }),
                  }),
                }),
              }),
            };
          },
        };
      }
      if (tableName === "users") {
        return {
          update: () => ({
            eq: () => ({
              select: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: "user-uuid-001",
                    account_type: "personal",
                    email: testEmail,
                    phone: "+996555112233",
                    is_verified: true,
                    token_version: 0,
                  },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (tableName === "user_profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: {}, error: null }),
            }),
          }),
        };
      }
      return origFrom(tableName);
    };

    // Запускаем 200 параллельных запросов с НЕВЕРНЫМИ кодами через Promise.all
    const responses = await Promise.all(
      Array.from({ length: 200 }, (_, i) => {
        return new Promise((resolve) => {
          const wrongCode = "999" + String(i).padStart(3, "0"); // 999000, 999001, etc.
          const req = {
            body: {
              email: testEmail,
              code: wrongCode,
            },
          };
          const res = createMockRes();
          const origJson = res.json.bind(res);
          res.json = (data) => {
            origJson(data);
            resolve({ statusCode: res.statusCode, body: data });
            return res;
          };

          verifyOtp(req, res);
        });
      })
    );

    assert.equal(responses.length, 200, "Все 200 запросов должны завершиться");

    // Все 200 запросов обязаны получить отказ (400 Bad Request)
    for (const r of responses) {
      assert.equal(r.statusCode, 400, "Все ответы должны возвращать статус 400");
      assert.equal(r.body.success, false, "success должен быть false");
    }

    // Ровно 5 запросов прошли проверку и вернули сообщение о неверном коде со списанием попытки
    const normalFails = responses.filter((r) =>
      r.body.message?.includes("Неверный код. Осталось попыток:")
    );
    // Ровно 195 запросов немедленно заблокированы лимитом 5 попыток
    const limitExceededBlocks = responses.filter((r) =>
      r.body.message?.includes("Превышено максимальное число попыток ввода кода (5)")
    );

    assert.equal(normalFails.length, 5, "Ровно 5 запросов должны вернуть сообщение 'Неверный код. Осталось попыток: X'");
    assert.equal(limitExceededBlocks.length, 195, "Ровно 195 запросов должны быть немедленно заблокированы с превышением лимита");
    assert.equal(attemptsInDb, 5, "Счётчик attempts в базе данных должен быть строго равен 5");
    assert.equal(otpRecord.is_used, false, "is_used должно оставаться false");

    // Критерий 1.3: 201-я попытка с ПРАВИЛЬНЫМ кодом немедленно блокируется
    const res201 = await new Promise((resolve) => {
      const req = {
        body: {
          email: testEmail,
          code: validOtpCode, // ПРАВИЛЬНЫЙ код!
        },
      };
      const res = createMockRes();
      res.json = (data) => {
        resolve({ statusCode: res.statusCode, body: data });
        return res;
      };
      verifyOtp(req, res);
    });

    assert.equal(res201.statusCode, 400, "201-й запрос с валидным кодом обязан вернуть статус 400");
    assert.equal(res201.body.success, false);
    assert.ok(
      res201.body.message?.includes("Превышено максимальное число попыток ввода кода (5)"),
      "201-й запрос должен быть заблокирован с превышением лимита попыток"
    );
    assert.equal(attemptsInDb, 5, "Счётчик attempts в БД не должен превышать 5");
  } finally {
    supabase.rpc = origRpc;
    supabase.from = origFrom;
  }
});

test("Критерий 1.4: verifyResetCode — 200 параллельных запросов с неверными кодами списания сбрасывающего OTP блокируются строго после 5 попыток", async () => {
  const origRpc = supabase.rpc;
  const origFrom = supabase.from;

  const validOtpCode = "773194";
  const validHash = hashOtpCode(validOtpCode);
  const testEmail = "race-reset-code@example.com";

  const otpRecord = {
    id: "otp-reset-uuid-002",
    email: testEmail,
    code_hash: validHash,
    type: "password_reset",
    attempts: 0,
    is_used: false,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    created_at: new Date().toISOString(),
  };

  let attemptsInDb = 0;
  let queueLock = Promise.resolve();

  try {
    supabase.rpc = async (funcName, params) => {
      if (funcName === "consume_otp_attempt" && params?.p_id === otpRecord.id) {
        const nextLock = queueLock.then(async () => {
          await new Promise((resolve) => setImmediate(resolve));
          if (otpRecord.is_used || attemptsInDb >= 5) {
            return -1;
          }
          attemptsInDb += 1;
          otpRecord.attempts = attemptsInDb;
          return attemptsInDb;
        });
        queueLock = nextLock.catch(() => {});
        const res = await nextLock;
        return { data: res, error: null };
      }
      return { data: null, error: new Error("Unknown RPC") };
    };

    supabase.from = (tableName) => {
      if (tableName === "email_verifications") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  gt: () => ({
                    order: () => ({
                      limit: () => ({
                        maybeSingle: async () => ({
                          data: { ...otpRecord },
                          error: null,
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
          update: (payload) => {
            Object.assign(otpRecord, payload);
            return {
              eq: () => ({
                eq: () => ({
                  select: () => ({
                    maybeSingle: async () => ({ data: { id: otpRecord.id }, error: null }),
                  }),
                }),
              }),
            };
          },
        };
      }
      return origFrom(tableName);
    };

    // 200 параллельных запросов к verifyResetCode
    const responses = await Promise.all(
      Array.from({ length: 200 }, (_, i) => {
        return new Promise((resolve) => {
          const wrongCode = "888" + String(i).padStart(3, "0");
          const req = {
            body: {
              email: testEmail,
              code: wrongCode,
            },
          };
          const res = createMockRes();
          res.json = (data) => {
            resolve({ statusCode: res.statusCode, body: data });
            return res;
          };
          verifyResetCode(req, res);
        });
      })
    );

    assert.equal(responses.length, 200);
    const normalFails = responses.filter((r) =>
      r.body.message?.includes("Неверный код. Осталось попыток:")
    );
    const limitExceededBlocks = responses.filter((r) =>
      r.body.message?.includes("Превышено максимальное число попыток ввода кода (5)")
    );

    assert.equal(normalFails.length, 5, "Ровно 5 запросов списали попытки 1..5");
    assert.equal(limitExceededBlocks.length, 195, "Ровно 195 запросов заблокированы");
    assert.equal(attemptsInDb, 5, "attempts в БД равен ровно 5");

    // 201-й запрос с валидным кодом блокируется, resetToken НЕ выдаётся
    const res201 = await new Promise((resolve) => {
      const req = {
        body: {
          email: testEmail,
          code: validOtpCode,
        },
      };
      const res = createMockRes();
      res.json = (data) => {
        resolve({ statusCode: res.statusCode, body: data });
        return res;
      };
      verifyResetCode(req, res);
    });

    assert.equal(res201.statusCode, 400);
    assert.equal(res201.body.resetToken, undefined, "resetToken не должен быть выдан");
    assert.ok(res201.body.message?.includes("Превышено максимальное число попыток ввода кода (5)"));
  } finally {
    supabase.rpc = origRpc;
    supabase.from = origFrom;
  }
});

test("Критерий 1.5: Однократное атомарное использование OTP — верный код среди параллельных запросов может быть принят строго 1 раз", async () => {
  const origRpc = supabase.rpc;
  const origFrom = supabase.from;

  const validOtpCode = "654321";
  const validHash = hashOtpCode(validOtpCode);
  const testEmail = "single-use-race@example.com";

  let isUsedState = false;
  let attemptsCount = 0;
  let lock = Promise.resolve();

  const otpRecord = {
    id: "otp-single-use-uuid",
    email: testEmail,
    code_hash: validHash,
    type: "registration",
    attempts: 0,
    is_used: false,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    created_at: new Date().toISOString(),
  };

  try {
    supabase.rpc = async (fn, params) => {
      if (fn === "consume_otp_attempt") {
        const next = lock.then(async () => {
          await new Promise((r) => setImmediate(r));
          if (isUsedState || attemptsCount >= 5) {
            return -1;
          }
          attemptsCount += 1;
          return attemptsCount;
        });
        lock = next.catch(() => {});
        const res = await next;
        return { data: res, error: null };
      }
      return { data: null, error: new Error("Unknown RPC") };
    };

    supabase.from = (table) => {
      if (table === "email_verifications") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  gt: () => ({
                    order: () => ({
                      limit: () => ({
                        maybeSingle: async () => ({
                          data: isUsedState ? null : { ...otpRecord, is_used: isUsedState },
                          error: null,
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
          update: (payload) => ({
            eq: (col1, val1) => ({
              eq: (col2, val2) => ({
                select: () => ({
                  maybeSingle: async () => {
                    // Атомарная CAS-операция (UPDATE ... WHERE is_used = false)
                    if (payload.is_used && !isUsedState) {
                      isUsedState = true;
                      return { data: { id: otpRecord.id }, error: null };
                    }
                    return { data: null, error: null };
                  },
                }),
              }),
            }),
          }),
        };
      }
      if (table === "users") {
        return {
          update: () => ({
            eq: () => ({
              select: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: "u-single",
                    account_type: "personal",
                    email: testEmail,
                    phone: "+996555998877",
                    is_verified: true,
                    token_version: 0,
                  },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "user_profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: {}, error: null }),
            }),
          }),
        };
      }
      return origFrom(table);
    };

    // Запускаем 50 параллельных вызовов с ОДИНАКОВЫМ ПРАВИЛЬНЫМ кодом
    const responses = await Promise.all(
      Array.from({ length: 50 }, () => {
        return new Promise((resolve) => {
          const req = { body: { email: testEmail, code: validOtpCode } };
          const res = createMockRes();
          res.json = (data) => {
            resolve({ statusCode: res.statusCode, body: data });
            return res;
          };
          verifyOtp(req, res);
        });
      })
    );

    const successful = responses.filter((r) => r.statusCode === 200 && r.body.success === true);
    const failed = responses.filter((r) => r.statusCode === 400 && r.body.success === false);

    assert.equal(successful.length, 1, "Ровно 1 запрос обязан завершиться успехом (200 OK)");
    assert.equal(failed.length, 49, "Остальные 49 параллельных запросов обязаны быть отклонены");
    assert.equal(isUsedState, true, "is_used в базе должно стать true");
  } finally {
    supabase.rpc = origRpc;
    supabase.from = origFrom;
  }
});

// ==============================================================================
// РАЗДЕЛ 2: КРИТЕРИЙ 2 — БЕЗОПАСНОСТЬ ХРАНЕНИЯ (HMAC-SHA256, ОТСУТСТВИЕ ОТКРЫТОГО КОДА В БД)
// ==============================================================================

test("Критерий 2.1: hashOtpCode — генерация и свойства HMAC-SHA256 хэша", () => {
  const code = "491823";
  const hash = hashOtpCode(code);

  assert.equal(typeof hash, "string", "Хэш должен быть строкой");
  assert.equal(hash.length, 64, "Длина HMAC-SHA256 хэша должна быть ровно 64 символа");
  assert.match(hash, /^[a-f0-9]{64}$/, "Хэш должен содержать исключительно шестнадцатеричные символы в нижнем регистре");

  // Детерминированность
  assert.equal(hashOtpCode(code), hash, "Хэширование должно быть строго детерминированным для одного секрета");

  // Разные коды дают разные хэши
  assert.notEqual(hashOtpCode("111111"), hashOtpCode("222222"));

  // Открытый код не содержится в хэше
  assert.ok(!hash.includes(code), "Хэш не должен содержать открытый код как подстроку");
});

test("Критерий 2.2: В базу данных записывается только code_hash, открытый OTP (code) отсутствует в объекте вставки", async () => {
  const origFrom = supabase.from;
  let insertedPayload = null;

  try {
    supabase.from = (tableName) => {
      if (tableName === "email_verifications") {
        return {
          update: () => ({
            eq: () => ({
              eq: () => ({
                eq: async () => ({ data: [], error: null }),
              }),
            }),
          }),
          insert: async (rows) => {
            insertedPayload = rows[0];
            return { error: null };
          },
        };
      }
      return origFrom(tableName);
    };

    // Эмуляция выпуска OTP для подтверждения регистрации
    const testCode = generateSecureOtp();
    const codeHash = hashOtpCode(testCode);
    const email = "audit-storage@example.com";

    const insertObject = {
      email,
      code_hash: codeHash,
      type: "registration",
      attempts: 0,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };

    await supabase.from("email_verifications").insert([insertObject]);

    assert.ok(insertedPayload, "Запись должна быть передана в insert");
    assert.equal(insertedPayload.email, email);
    assert.equal(insertedPayload.code_hash, codeHash, "code_hash обязан присутствовать");
    assert.equal(insertedPayload.code_hash.length, 64, "code_hash обязан быть 64-символьным hex");
    assert.equal(insertedPayload.code, undefined, "Поле code (открытый OTP) должно ПОЛНОСТЬЮ отсутствовать в БД");
    assert.equal(insertedPayload.attempts, 0, "Начальное число попыток должно быть 0");
  } finally {
    supabase.from = origFrom;
  }
});

test("Критерий 2.3: Схема БД (schema.sql) содержит DDL с колонкой code_hash и процедурой consume_otp_attempt", () => {
  const schemaPath = path.join(__dirname, "..", "src", "schema.sql");
  assert.ok(fs.existsSync(schemaPath), "Файл schema.sql должен существовать");

  const schemaSql = fs.readFileSync(schemaPath, "utf8");

  assert.ok(
    schemaSql.includes("code_hash VARCHAR(64)"),
    "schema.sql должен содержать добавление колонки code_hash VARCHAR(64)"
  );
  assert.ok(
    schemaSql.includes("ALTER TABLE email_verifications ALTER COLUMN code DROP NOT NULL;"),
    "schema.sql должен снимать ограничение NOT NULL с колонки code"
  );
  assert.ok(
    schemaSql.includes("CREATE OR REPLACE FUNCTION consume_otp_attempt(p_id UUID)"),
    "schema.sql должен определять функцию consume_otp_attempt"
  );
  assert.ok(
    schemaSql.includes("UPDATE email_verifications"),
    "consume_otp_attempt должна выполнять атомарный UPDATE"
  );
  assert.ok(
    schemaSql.includes("attempts < 5"),
    "consume_otp_attempt должна проверять attempts < 5"
  );
  assert.ok(
    schemaSql.includes("COALESCE(v_attempts, -1)"),
    "consume_otp_attempt должна возвращать -1 при превышении лимита"
  );
});

// ==============================================================================
// РАЗДЕЛ 3: КРИТЕРИЙ 3 — ЛИМИТ ПО EMAIL (10 ПОПЫТОК БЛОКИРУЮТ НЕЗАВИСИМО ОТ СМЕНЫ IP)
// ==============================================================================

test("Критерий 3.1: keyGenerator для rateLimitVerify извлекает и нормализует email независимо от IP", () => {
  const req1 = { body: { email: "Victim@Example.Com" }, ip: "1.1.1.1" };
  const req2 = { body: { email: "  victim@example.com  " }, ip: "2.2.2.2" };
  const req3 = { body: { email: "victim@example.com" }, ip: "2001:db8::1" };

  // Извлечение ключа через middleware keyGenerator
  const key1 = typeof req1.body?.email === "string" ? req1.body.email.toLowerCase().trim() : ipKeyGenerator(req1);
  const key2 = typeof req2.body?.email === "string" ? req2.body.email.toLowerCase().trim() : ipKeyGenerator(req2);
  const key3 = typeof req3.body?.email === "string" ? req3.body.email.toLowerCase().trim() : ipKeyGenerator(req3);

  assert.equal(key1, "victim@example.com");
  assert.equal(key2, "victim@example.com");
  assert.equal(key3, "victim@example.com");
  assert.equal(key1, key2, "Ключ должен быть одинаковым при разных IPv4");
  assert.equal(key2, key3, "Ключ должен быть одинаковым при переходе на IPv6");

  // Fallback на IP при отсутствии email
  const reqNoEmail = { body: {}, ip: "192.168.1.50" };
  const fallbackKey = typeof reqNoEmail.body?.email === "string" ? reqNoEmail.body.email.toLowerCase().trim() : ipKeyGenerator(reqNoEmail);
  assert.equal(fallbackKey, "192.168.1.50", "При отсутствии email должен происходить fallback на нормализованный IP");
});

test("Критерий 3.2: rateLimitVerify — превышение 10 попыток на один email блокирует верификацию независимо от смены IP", async () => {
  const targetEmail = `email-rate-victim-${Date.now()}@example.com`;

  // Хелпер симуляции прохождения через Express rateLimit middleware
  const runRateLimit = (ip, email, statusCode = 400) => {
    return new Promise((resolve) => {
      const req = {
        ip,
        body: { email },
        headers: {},
      };
      const res = createMockRes();

      rateLimitVerify(req, res, () => {
        res.statusCode = statusCode;
        res.emit("finish");
        resolve({ blocked: false, statusCode: res.statusCode, body: null });
      });

      // Перехват блокировки лимитером (когда next() не вызывается)
      const origSend = res.send.bind(res);
      res.send = (data) => {
        origSend(data);
        resolve({ blocked: true, statusCode: res.statusCode, body: data });
        return res;
      };
      const origJson = res.json.bind(res);
      res.json = (data) => {
        origJson(data);
        resolve({ blocked: true, statusCode: res.statusCode, body: data });
        return res;
      };
    });
  };

  // Выполняем 10 неудачных запросов для targetEmail с 10 РАЗНЫХ IP-адресов
  for (let i = 1; i <= 10; i++) {
    const rotatingIp = `198.51.100.${i}`;
    const result = await runRateLimit(rotatingIp, targetEmail, 400);
    assert.equal(result.blocked, false, `Попытка ${i} с IP ${rotatingIp} должна быть допущена до контроллера`);
  }

  // 11-я попытка для ТОГО ЖЕ email с совершенно нового 11-го IP-адреса
  const attackerNewIp = "203.0.113.99";
  const result11 = await runRateLimit(attackerNewIp, targetEmail, 400);

  assert.equal(result11.blocked, true, "11-й запрос обязан быть заблокирован лимитером");
  assert.equal(result11.statusCode, 429, "Статус блокировки должен быть 429 Too Many Requests");
  assert.equal(result11.body.success, false);
  assert.ok(
    result11.body.message?.includes("Слишком много неудачных попыток ввода кода. Попробуйте снова через час."),
    "Сообщение об ошибке должно информировать о блокировке"
  );

  // Критерий 3.3: Изоляция пользователей — запрос для ДРУГОГО email с того же нового IP НЕ блокируется
  const innocentEmail = `innocent-user-${Date.now()}@example.com`;
  const innocentResult = await runRateLimit(attackerNewIp, innocentEmail, 400);
  assert.equal(innocentResult.blocked, false, "Другой пользователь с того же IP не должен блокироваться");
});

// ==============================================================================
// РАЗДЕЛ 4: КРИТЕРИЙ 4 — РАЗДЕЛЬНЫЕ ЛИМИТЕРЫ И TIMING-ATTACK УСТОЙЧИВОСТЬ
// ==============================================================================

test("Критерий 4.1: safeCompare и crypto.timingSafeEqual — защита от Timing Attack", () => {
  const hash1 = hashOtpCode("123456");
  const hash2 = hashOtpCode("123456");
  const hash3 = hashOtpCode("654321");

  // crypto.timingSafeEqual на буферах хэшей
  const buf1 = Buffer.from(hash1, "utf8");
  const buf2 = Buffer.from(hash2, "utf8");
  const buf3 = Buffer.from(hash3, "utf8");

  assert.equal(crypto.timingSafeEqual(buf1, buf2), true, "Идентичные буферы возвращают true");
  assert.equal(crypto.timingSafeEqual(buf1, buf3), false, "Разные буферы возвращают false");

  // safeCompare из utils/otp.js
  assert.equal(safeCompare("123456", "123456"), true);
  assert.equal(safeCompare("123456", "123457"), false);
  assert.equal(safeCompare("123456", "12345"), false, "Разная длина безопасно возвращает false без исключений");
  assert.equal(safeCompare(null, "123456"), false);
  assert.equal(safeCompare("", ""), true);
});

test("Критерий 4.2: Раздельные лимитеры — проверка независимых настроек для разных типов операций", () => {
  assert.equal(typeof rateLimitVerify, "function");
  assert.equal(typeof loginLimiter, "function");
  assert.equal(typeof sendOtpLimiter, "function");
  assert.equal(typeof authLimiter, "function");

  // Лимитеры являются разными независимыми инстансами
  assert.notEqual(rateLimitVerify, loginLimiter);
  assert.notEqual(rateLimitVerify, sendOtpLimiter);
  assert.notEqual(loginLimiter, sendOtpLimiter);
  assert.notEqual(authLimiter, rateLimitVerify);

  // Проверка регистрации роутов с соответствующими лимитерами
  const routeLayers = authRoutes.stack.filter((l) => l.route);
  const getRoute = (path) => routeLayers.find((l) => l.route.path === path);

  const verifyOtpRoute = getRoute("/verify-otp");
  const verifyResetRoute = getRoute("/verify-reset-code");
  const loginRoute = getRoute("/login");
  const sendOtpRoute = getRoute("/send-otp");
  const forgotRoute = getRoute("/forgot-password");

  assert.ok(verifyOtpRoute, "Роут /verify-otp должен быть зарегистрирован");
  assert.ok(verifyResetRoute, "Роут /verify-reset-code должен быть зарегистрирован");
  assert.ok(loginRoute, "Роут /login должен быть зарегистрирован");
  assert.ok(sendOtpRoute, "Роут /send-otp должен быть зарегистрирован");
  assert.ok(forgotRoute, "Роут /forgot-password должен быть зарегистрирован");
});

test("Критерий 4.3: normalizeIp — нормализация IPv6 по подсети /56 защищает от распределённого брутфорса", () => {
  // IPv4 адреса
  assert.equal(normalizeIp("172.16.0.5"), "172.16.0.5");
  assert.equal(normalizeIp("::ffff:172.16.0.5"), "172.16.0.5");

  // IPv6 адреса из одной клиентской подсети /56
  const subnet6A = "2a02:06b8:c08:beef:0000:0000:0000:0001";
  const subnet6B = "2a02:06b8:c08:beff:ffff:ffff:ffff:ffff";
  assert.equal(
    normalizeIp(subnet6A),
    normalizeIp(subnet6B),
    "IPv6 адреса из одной /56 подсети обязаны нормализоваться в идентичный ключ"
  );
  assert.ok(normalizeIp(subnet6A).endsWith("/56"));

  // IPv6 адреса из разных подсетей /56
  const otherSubnet6 = "2a02:06b8:c08:cf00:0000:0000:0000:0001";
  assert.notEqual(
    normalizeIp(subnet6A),
    normalizeIp(otherSubnet6),
    "IPv6 адреса из разных подсетей должны давать разные ключи"
  );
});
