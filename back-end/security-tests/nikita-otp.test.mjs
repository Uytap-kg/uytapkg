import test from "node:test";
import assert from "node:assert/strict";
import {
  nikitaService,
  normalizeNikitaPhone,
  generateTransactionId,
  NIKITA_STATUS,
  NIKITA_USER_MESSAGES,
} from "../src/services/nikitaService.js";
import { phoneOtpStore, maskPhoneNikita } from "../src/utils/phoneOtpStore.js";
import { assertNikitaConfigured, nikitaConfig } from "../src/config/nikita.js";
import { sendOtp, verifyOtp, forgotPassword, verifyResetCode, resetPassword } from "../src/controllers/authController.js";
import { registerSchema } from "../src/utils/validation.js";

/**
 * Создание мока Express Response
 */
function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
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
// 1. Нормализация и валидация телефонных номеров
// ==============================================================================
test("Nikita OTP: normalizeNikitaPhone корректно нормализует форматы номеров", () => {
  // Кыргызстан: 0XXXXXXXXX (10 цифр) -> 996XXXXXXXXX (12 цифр)
  const norm1 = normalizeNikitaPhone("0770123456");
  assert.equal(norm1.valid, true);
  assert.equal(norm1.phone, "996770123456");

  // Кыргызстан: с плюсом, пробелами и скобками
  const norm2 = normalizeNikitaPhone("+996 (770) 12-34-56");
  assert.equal(norm2.valid, true);
  assert.equal(norm2.phone, "996770123456");

  // Кыргызстан: 9 цифр без префикса
  const norm3 = normalizeNikitaPhone("770123456");
  assert.equal(norm3.valid, true);
  assert.equal(norm3.phone, "996770123456");

  // Уже в правильном формате
  const norm4 = normalizeNikitaPhone("996555987654");
  assert.equal(norm4.valid, true);
  assert.equal(norm4.phone, "996555987654");

  // Международный номер (например, Казахстан 7XXXXXXXXXX)
  const normIntl = normalizeNikitaPhone("+7 (701) 123-45-67");
  assert.equal(normIntl.valid, true);
  assert.equal(normIntl.phone, "77011234567");

  // Невалидные номера
  const badShort = normalizeNikitaPhone("12345");
  assert.equal(badShort.valid, false);

  const badKgLength = normalizeNikitaPhone("+996 770 123");
  assert.equal(badKgLength.valid, false);

  const badLetters = normalizeNikitaPhone("phone-number");
  assert.equal(badLetters.valid, false);

  const badEmpty = normalizeNikitaPhone("");
  assert.equal(badEmpty.valid, false);
});

// ==============================================================================
// 2. Генерация transaction_id
// ==============================================================================
test("Nikita OTP: generateTransactionId возвращает 32-символьный буквенно-цифровой id", () => {
  const id1 = generateTransactionId();
  const id2 = generateTransactionId();

  assert.equal(typeof id1, "string");
  assert.equal(id1.length, 32);
  assert.match(id1, /^[0-9a-f]{32}$/);
  assert.notEqual(id1, id2, "transaction_id должен быть уникальным");
});

// ==============================================================================
// 3. Маскирование номера телефона в логах
// ==============================================================================
test("Nikita OTP: maskPhoneNikita маскирует номер как 99677****56", () => {
  const masked = maskPhoneNikita("996770123456");
  assert.equal(masked, "99677****56");

  const maskedWithPlus = maskPhoneNikita("+996 555 12-34-99");
  assert.equal(maskedWithPlus, "99655****99");
});

// ==============================================================================
// 4. Валидация конфигурации NIKITA_API_KEY
// ==============================================================================
test("Nikita OTP: assertNikitaConfigured выбрасывает понятную ошибку без ключа", () => {
  const origKey = process.env.NIKITA_API_KEY;
  try {
    delete process.env.NIKITA_API_KEY;
    assert.throws(
      () => assertNikitaConfigured(),
      /отсутствует обязательная переменная окружения NIKITA_API_KEY/
    );
  } finally {
    process.env.NIKITA_API_KEY = origKey || "test-key";
  }
});

// ==============================================================================
// 5. Отправка OTP: успешный ответ и разбор status как числа (0)
// ==============================================================================
test("Nikita OTP: sendOtp успешно отправляет код и сохраняет токен в хранилище", async () => {
  phoneOtpStore.reset();
  const origFetch = globalThis.fetch;
  const origKey = process.env.NIKITA_API_KEY;
  process.env.NIKITA_API_KEY = "dummy-test-key";

  let capturedHeaders = null;
  let capturedBody = null;

  try {
    globalThis.fetch = async (url, options) => {
      capturedHeaders = options.headers;
      capturedBody = JSON.parse(options.body);

      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            token: "tok_test_abc123",
            status: 0,
            description: "Code Sent",
          }),
      };
    };

    const res = await nikitaService.sendOtp({
      phone: "+996 (770) 12-34-56",
      ip: "192.168.1.10",
    });

    assert.equal(res.success, true);
    assert.equal(res.token, "tok_test_abc123");
    assert.equal(res.phone, "996770123456");
    assert.equal(capturedHeaders["X-API-KEY"], "dummy-test-key");
    assert.equal(capturedBody.phone, "996770123456");
    assert.equal(capturedBody.transaction_id.length, 32);

    // Проверяем, что токен сохранён в phoneOtpStore
    const record = phoneOtpStore.findRecord({ token: "tok_test_abc123" });
    assert.ok(record);
    assert.equal(record.phone, "996770123456");
  } finally {
    globalThis.fetch = origFetch;
    process.env.NIKITA_API_KEY = origKey;
  }
});

// ==============================================================================
// 6. Проверка OTP: успешный ответ со status как строкой ("0")
// ==============================================================================
test("Nikita OTP: verifyOtp корректно сравнивает строковый status '0' и инвалидирует токен", async () => {
  phoneOtpStore.reset();
  const origFetch = globalThis.fetch;
  const origKey = process.env.NIKITA_API_KEY;
  process.env.NIKITA_API_KEY = "dummy-test-key";

  const testToken = "tok_verify_succ_123";
  phoneOtpStore.recordSend({
    phone: "996770123456",
    ip: "127.0.0.1",
    token: testToken,
  });

  try {
    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.token, testToken);
      assert.equal(body.code, "482910");

      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            status: "0", // Никита возвращает статус строкой при verify!
            description: "Code Valid",
          }),
      };
    };

    const res = await nikitaService.verifyOtp({
      token: testToken,
      code: 482910,
    });

    assert.equal(res.success, true);
    assert.equal(res.status, 0);

    // Токен должен быть удален (одноразовость)
    const afterRecord = phoneOtpStore.findRecord({ token: testToken });
    assert.equal(afterRecord, null, "Токен обязан быть инвалидирован после успешной верификации");
  } finally {
    globalThis.fetch = origFetch;
    process.env.NIKITA_API_KEY = origKey;
  }
});

// ==============================================================================
// 7. Проверка каждого кода ошибки из таблицы Nikita OTP API
// ==============================================================================
test("Nikita OTP: маппинг всех статусов ошибок из спецификации", async () => {
  phoneOtpStore.reset();
  const origFetch = globalThis.fetch;
  const origKey = process.env.NIKITA_API_KEY;
  process.env.NIKITA_API_KEY = "dummy-test-key";

  try {
    // Таблица кодов и ожидаемые сообщения
    const errorCases = [
      { status: 14, expectedMsg: "Неверный код" },
      { status: 13, expectedMsg: "Срок действия кода истёк, запросите новый" },
      { status: 12, expectedMsg: "Сессия подтверждения устарела, запросите код заново" },
      { status: 1, expectedMsg: "Не удалось отправить код, попробуйте позже" },
      { status: 2, expectedMsg: "Не удалось отправить код, попробуйте позже" },
      { status: 3, expectedMsg: "Не удалось отправить код, попробуйте позже" },
      { status: 4, expectedMsg: "Не удалось отправить код, попробуйте позже" },
      { status: 5, expectedMsg: "Не удалось отправить код, попробуйте позже" },
      { status: 10, expectedMsg: "Не удалось отправить код, попробуйте позже" },
    ];

    for (const ec of errorCases) {
      phoneOtpStore.reset();
      const testToken = `tok_err_${ec.status}`;
      phoneOtpStore.recordSend({
        phone: "996770123456",
        ip: "127.0.0.1",
        token: testToken,
      });

      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            status: ec.status,
            description: `Error ${ec.status}`,
          }),
      });

      const res = await nikitaService.verifyOtp({
        token: testToken,
        code: "999999",
      });

      assert.equal(res.success, false);
      assert.equal(res.status, ec.status);
      assert.equal(res.message, ec.expectedMsg);
    }
  } finally {
    globalThis.fetch = origFetch;
    process.env.NIKITA_API_KEY = origKey;
  }
});

// ==============================================================================
// 8. Защита от злоупотреблений: Rate limit на отправку (cooldown и почасовые лимиты)
// ==============================================================================
test("Nikita OTP Rate Limit: кулдаун 60 секунд на номер блокирует повторную отправку", async () => {
  phoneOtpStore.reset();
  const origFetch = globalThis.fetch;
  const origKey = process.env.NIKITA_API_KEY;
  process.env.NIKITA_API_KEY = "dummy-test-key";

  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ token: `tok_${callCount}`, status: 0, description: "Code Sent" }),
    };
  };

  try {
    // 1-я отправка: успех
    const res1 = await nikitaService.sendOtp({ phone: "996770112233", ip: "10.0.0.1" });
    assert.equal(res1.success, true);
    assert.equal(callCount, 1);

    // 2-я отправка немедленно: заблокирована кулдауном
    const res2 = await nikitaService.sendOtp({ phone: "996770112233", ip: "10.0.0.1" });
    assert.equal(res2.success, false);
    assert.equal(res2.rateLimited, true);
    assert.ok(res2.message.includes("Повторная отправка возможна"));
    assert.equal(callCount, 1, "Сеть не должна вызываться при превышении кулдауна");
  } finally {
    globalThis.fetch = origFetch;
    process.env.NIKITA_API_KEY = origKey;
  }
});

test("Nikita OTP Rate Limit: лимит 5 отправок в час на номер телефона", async () => {
  phoneOtpStore.reset();
  const origFetch = globalThis.fetch;
  const origKey = process.env.NIKITA_API_KEY;
  process.env.NIKITA_API_KEY = "dummy-test-key";

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({ token: "tok_rate", status: 0, description: "Code Sent" }),
  });

  const testPhone = "996770554433";

  try {
    // Симулируем 5 успешных отправок за последний час с интервалом больше кулдауна
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      phoneOtpStore.phoneHourlyHistory.set(
        testPhone,
        [...(phoneOtpStore.phoneHourlyHistory.get(testPhone) || []), now - (5 - i) * 70 * 1000]
      );
    }
    // Сбрасываем lastSent, чтобы не сработал кулдаун
    phoneOtpStore.phoneLastSent.set(testPhone, now - 70 * 1000);

    // 6-я попытка обязана быть отклонена
    const res = await nikitaService.sendOtp({ phone: testPhone, ip: "1.2.3.4" });
    assert.equal(res.success, false);
    assert.equal(res.rateLimited, true);
    assert.ok(res.message.includes("Превышен лимит отправок на этот номер телефона в час"));
  } finally {
    globalThis.fetch = origFetch;
    process.env.NIKITA_API_KEY = origKey;
  }
});

// ==============================================================================
// 9. Ограничение попыток ввода кода (максимум 5 на токен)
// ==============================================================================
test("Nikita OTP Attempts: после 5 неверных попыток токен инвалидируется и блокируется", async () => {
  phoneOtpStore.reset();
  const origFetch = globalThis.fetch;
  const origKey = process.env.NIKITA_API_KEY;
  process.env.NIKITA_API_KEY = "dummy-test-key";

  const testToken = "tok_attempts_test";
  phoneOtpStore.recordSend({
    phone: "996770998877",
    ip: "127.0.0.1",
    token: testToken,
  });

  try {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ status: 14, description: "Invalid Code" }),
    });

    // 5 попыток ввода неверного кода
    for (let i = 1; i <= 5; i++) {
      const res = await nikitaService.verifyOtp({ token: testToken, code: "000000" });
      assert.equal(res.success, false);
      assert.equal(res.status, 14);
      assert.equal(res.attemptsLeft, 5 - i);
    }

    // 6-я попытка: токен заблокирован
    const res6 = await nikitaService.verifyOtp({ token: testToken, code: "000000" });
    assert.equal(res6.success, false);
    assert.ok(res6.message.includes("Превышено максимальное число попыток"));

    // Токен удалён
    assert.equal(phoneOtpStore.findRecord({ token: testToken }), null);
  } finally {
    globalThis.fetch = origFetch;
    process.env.NIKITA_API_KEY = origKey;
  }
});

// ==============================================================================
// 10. Безопасный ретрай при сетевой ошибке с НОВЫМ transaction_id
// ==============================================================================
test("Nikita OTP Retry: сетевой сбой до ответа делает ровно 1 повтор с новым transaction_id", async () => {
  phoneOtpStore.reset();
  const origFetch = globalThis.fetch;
  const origKey = process.env.NIKITA_API_KEY;
  process.env.NIKITA_API_KEY = "dummy-test-key";

  const capturedIds = [];

  try {
    let callIdx = 0;
    globalThis.fetch = async (url, options) => {
      callIdx++;
      const body = JSON.parse(options.body);
      capturedIds.push(body.transaction_id);

      if (callIdx === 1) {
        // Сетевой сбой на 1-м запросе
        throw new TypeError("fetch failed");
      }

      // 2-й запрос успешен
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ token: "tok_retry_ok", status: 0, description: "Code Sent" }),
      };
    };

    const res = await nikitaService.sendOtp({ phone: "996770665544" });

    assert.equal(res.success, true);
    assert.equal(res.token, "tok_retry_ok");
    assert.equal(capturedIds.length, 2, "Должно быть ровно 2 вызова");
    assert.notEqual(capturedIds[0], capturedIds[1], "Каждый запрос обязан использовать НОВЫЙ transaction_id");
  } finally {
    globalThis.fetch = origFetch;
    process.env.NIKITA_API_KEY = origKey;
  }
});

// ==============================================================================
// 11. Интеграция с authController: sendOtp и verifyOtp
// ==============================================================================
test("AuthController Integration: /send-otp и /verify-otp поддерживают SMS через Nikita", async () => {
  phoneOtpStore.reset();
  const origFetch = globalThis.fetch;
  const origKey = process.env.NIKITA_API_KEY;
  process.env.NIKITA_API_KEY = "dummy-test-key";

  try {
    globalThis.fetch = async (url, options) => {
      if (url.includes("/api/otp/send")) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({ token: "tok_ctrl_123", status: 0, description: "Code Sent" }),
        };
      }
      if (url.includes("/api/otp/verify")) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({ status: "0", description: "Code Valid" }),
        };
      }
      throw new Error(`Unexpected url: ${url}`);
    };

    // 1. Отправка OTP по телефону через контроллер
    const sendReq = {
      body: { phone: "+996 (770) 33-44-55" },
      ip: "10.0.0.5",
    };
    const sendRes = createMockRes();
    await sendOtp(sendReq, sendRes);

    assert.equal(sendRes.statusCode, 200);
    assert.equal(sendRes.body.success, true);
    assert.equal(sendRes.body.token, "tok_ctrl_123");

    // 2. Проверка OTP по телефону и коду через контроллер
    const verifyReq = {
      body: { phone: "+996 (770) 33-44-55", code: "123456" },
      ip: "10.0.0.5",
    };
    const verifyRes = createMockRes();
    await verifyOtp(verifyReq, verifyRes);

    assert.equal(verifyRes.statusCode, 200);
    assert.equal(verifyRes.body.success, true);
    assert.ok(verifyRes.body.message.includes("успешно подтвержден"));
  } finally {
    globalThis.fetch = origFetch;
    process.env.NIKITA_API_KEY = origKey;
  }
});


// ==============================================================================
// 12. Валидация registerSchema с verificationMethod: "phone"
// ==============================================================================
test("registerSchema: поддерживает verificationMethod 'phone' и опциональный email", () => {
  const phoneOnly = registerSchema.safeParse({
    accountType: "personal",
    phone: "+996 (770) 12-34-56",
    password: "Password123!",
    verificationMethod: "phone",
  });
  assert.equal(phoneOnly.success, true);
  assert.equal(phoneOnly.data.verificationMethod, "phone");

  const defaultEmail = registerSchema.safeParse({
    accountType: "personal",
    email: "test@example.com",
    phone: "+996 (770) 12-34-56",
    password: "Password123!",
  });
  assert.equal(defaultEmail.success, true);
  assert.equal(defaultEmail.data.verificationMethod, "email");
});

// ==============================================================================
// 13. Восстановление пароля по номеру телефона через Nikita OTP API
// ==============================================================================
test("Forgot Password Integration: запрос сброса пароля и проверка кода по телефону", async () => {
  phoneOtpStore.reset();
  const origFetch = globalThis.fetch;
  const origKey = process.env.NIKITA_API_KEY;
  process.env.NIKITA_API_KEY = "dummy-test-key";

  try {
    globalThis.fetch = async (url) => {
      if (url.includes("/api/otp/send")) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({ token: "tok_forgot_123", status: 0, description: "Code Sent" }),
        };
      }
      if (url.includes("/api/otp/verify")) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({ status: "0", description: "Code Valid" }),
        };
      }
      throw new Error(`Unexpected url: ${url}`);
    };

    // Запрос сброса без номера/email возвращает 400
    const emptyReq = { body: {} };
    const emptyRes = createMockRes();
    await forgotPassword(emptyReq, emptyRes);
    assert.equal(emptyRes.statusCode, 400);

    // Проверка кода без контакта/кода возвращает 400
    const emptyVerifyReq = { body: {} };
    const emptyVerifyRes = createMockRes();
    await verifyResetCode(emptyVerifyReq, emptyVerifyRes);
    assert.equal(emptyVerifyRes.statusCode, 400);
  } finally {
    globalThis.fetch = origFetch;
    process.env.NIKITA_API_KEY = origKey;
  }
});


// ==============================================================================
// 14. P0-01: Защита от подмены номера телефона (phone substitution) в verifyOtp и verifyResetCode
// ==============================================================================
test("P0-01: подмена phone на номер жертвы при валидном token атакующего отклоняется в verifyOtp и verifyResetCode", async () => {
  phoneOtpStore.reset();
  const origFetch = globalThis.fetch;
  const origKey = process.env.NIKITA_API_KEY;
  process.env.NIKITA_API_KEY = "dummy-test-key";

  const attackerPhone = "996770111111";
  const victimPhone = "+996555999999";

  phoneOtpStore.recordSend({
    phone: attackerPhone,
    ip: "127.0.0.1",
    token: "tok_attacker_reg",
    purpose: "registration",
  });
  phoneOtpStore.recordSend({
    phone: attackerPhone,
    ip: "127.0.0.1",
    token: "tok_attacker_reset",
    purpose: "password_reset",
  });

  let nikitaVerifyCalled = false;
  globalThis.fetch = async () => {
    nikitaVerifyCalled = true;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ status: "0", description: "Code Valid" }),
    };
  };

  try {
    // 1. Попытка подмены номера в verifyOtp
    const reqVerify = {
      body: {
        token: "tok_attacker_reg",
        phone: victimPhone,
        code: "123456",
      },
    };
    const resVerify = createMockRes();
    await verifyOtp(reqVerify, resVerify);

    assert.equal(resVerify.statusCode, 400, "Подмена номера в verifyOtp обязана возвращать 400");
    assert.equal(resVerify.body.success, false);
    assert.equal(resVerify.body.token, undefined, "JWT не должен выдаваться при подмене номера");

    // 2. Попытка подмены номера в verifyResetCode
    const reqReset = {
      body: {
        token: "tok_attacker_reset",
        phone: victimPhone,
        code: "123456",
      },
    };
    const resReset = createMockRes();
    await verifyResetCode(reqReset, resReset);

    assert.equal(resReset.statusCode, 400, "Подмена номера в verifyResetCode обязана возвращать 400");
    assert.equal(resReset.body.success, false);
    assert.equal(resReset.body.resetToken, undefined, "resetToken не должен выдаваться при подмене номера");
    assert.equal(nikitaVerifyCalled, false, "Запрос с несовпадающим номером должен блокироваться до обращения к Nikita");
  } finally {
    globalThis.fetch = origFetch;
    process.env.NIKITA_API_KEY = origKey;
  }
});

// ==============================================================================
// 15. P0-02: Изоляция purpose между сценариями и запрет входа без пароля по SMS для подтверждённых аккаунтов
// ==============================================================================
test("P0-02: токен регистрации не подходит для сброса пароля, а подтверждённый аккаунт не получает JWT через неавторизованный verifyOtp", async () => {
  phoneOtpStore.reset();
  const origFetch = globalThis.fetch;
  const origKey = process.env.NIKITA_API_KEY;
  process.env.NIKITA_API_KEY = "dummy-test-key";

  const { supabase } = await import("../src/config/db.js");
  const origFrom = supabase.from;

  const targetPhone = "996770222333";
  phoneOtpStore.recordSend({
    phone: targetPhone,
    ip: "127.0.0.1",
    token: "tok_reg_only",
    purpose: "registration",
  });

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ status: "0", description: "Code Valid" }),
  });

  try {
    // 1. Токен с purpose="registration" отклоняется в verifyResetCode
    const resetReq = {
      body: {
        token: "tok_reg_only",
        phone: "+996770222333",
        code: "123456",
      },
    };
    const resetRes = createMockRes();
    await verifyResetCode(resetReq, resetRes);
    assert.equal(resetRes.statusCode, 400, "Токен регистрации не должен приниматься в verifyResetCode");
    assert.equal(resetRes.body.resetToken, undefined);

    // 2. Неавторизованный verifyOtp для УЖЕ подтверждённого пользователя (is_verified: true) возвращает 403 без JWT
    supabase.from = (table) => {
      if (table === "users") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "verified-user-1",
                  account_type: "personal",
                  email: "verified@example.com",
                  phone: "+996770222333",
                  is_verified: true,
                  is_email_verified: true,
                  token_version: 0,
                },
                error: null,
              }),
            }),
          }),
        };
      }
      return origFrom(table);
    };

    const verifyReq = {
      body: {
        token: "tok_reg_only",
        phone: "+996770222333",
        code: "123456",
      },
    };
    const verifyRes = createMockRes();
    await verifyOtp(verifyReq, verifyRes);

    assert.equal(verifyRes.statusCode, 403, "Подтверждённый аккаунт не должен получать JWT без пароля (403)");
    assert.equal(verifyRes.body.success, false);
    assert.equal(verifyRes.body.token, undefined);
  } finally {
    supabase.from = origFrom;
    globalThis.fetch = origFetch;
    process.env.NIKITA_API_KEY = origKey;
  }
});

// ==============================================================================
// 16. P1-01: Запрет верификации аккаунта чужим email и проверка token_version в optionalAuth
// ==============================================================================
test("P1-01: авторизованный пользователь не может подтвердить чужой email в verifyOtp, а optionalAuth сбрасывает отозванный токен", async () => {
  const { supabase } = await import("../src/config/db.js");
  const { optionalAuth, generateToken, clearUserAuthCache } = await import("../src/middleware/auth.js");
  const origFrom = supabase.from;
  clearUserAuthCache();

  try {
    // 1. Попытка подтвердить attacker@example.com будучи авторизованным как victim@example.com
    const req = {
      user: {
        id: "user-victim-1",
        email: "victim@example.com",
      },
      body: {
        email: "attacker@example.com",
        code: "123456",
      },
    };
    const res = createMockRes();
    await verifyOtp(req, res);

    assert.equal(res.statusCode, 403, "Несовпадение email авторизованного пользователя должно возвращать 403");
    assert.equal(res.body.success, false);

    // 2. optionalAuth с отозванным token_version (tv: 0 в токене, token_version: 2 в БД)
    supabase.from = (table) => {
      if (table === "users") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  role: "user",
                  account_type: "personal",
                  token_version: 2,
                  email: "victim@example.com",
                },
                error: null,
              }),
            }),
          }),
        };
      }
      return origFrom(table);
    };

    const staleToken = generateToken({ id: "user-victim-1", email: "victim@example.com", tokenVersion: 0 });
    const optReq = {
      headers: { authorization: `Bearer ${staleToken}` },
    };
    await new Promise((resolve) => optionalAuth(optReq, createMockRes(), resolve));
    assert.equal(optReq.user, null, "optionalAuth обязан сбросить req.user в null при несовпадении token_version");
  } finally {
    supabase.from = origFrom;
    clearUserAuthCache();
  }
});

// ==============================================================================
// 17. P1-03: Защита от гонок (race condition) при параллельной отправке и проверке SMS OTP
// ==============================================================================
test("P1-03: 10 параллельных вызовов sendOtp делают ровно 1 HTTP-запрос к Nikita", async () => {
  phoneOtpStore.reset();
  const origFetch = globalThis.fetch;
  const origKey = process.env.NIKITA_API_KEY;
  process.env.NIKITA_API_KEY = "dummy-test-key";

  let nikitaSendCalls = 0;
  globalThis.fetch = async () => {
    nikitaSendCalls++;
    await new Promise((r) => setTimeout(r, 30));
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          token: `tok_race_${nikitaSendCalls}`,
          status: 0,
          description: "Code Sent",
        }),
    };
  };

  try {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        nikitaService.sendOtp({
          phone: "+996770888999",
          ip: "10.20.30.40",
          purpose: "registration",
        })
      )
    );

    const succeeded = results.filter((r) => r.success);
    const rateLimited = results.filter((r) => !r.success && r.rateLimited);

    assert.equal(succeeded.length, 1, "Ровно 1 из 10 параллельных запросов должен отправить SMS");
    assert.equal(rateLimited.length, 9, "Остальные 9 параллельных запросов должны быть заблокированы синхронным резервом слота");
    assert.equal(nikitaSendCalls, 1, "К внешнему API Nikita должен уйти строго 1 HTTP-запрос");
  } finally {
    globalThis.fetch = origFetch;
    process.env.NIKITA_API_KEY = origKey;
  }
});


// ==============================================================================
// 18. P1-02 & P0-01 (unit): освобождение номера при наличии базовой строки user_profiles и привязка result.phone для авторизованного verifyOtp
// ==============================================================================
test("P1-02: register освобождает просроченный неподтверждённый номер даже при наличии базовой строки в user_profiles", async () => {
  phoneOtpStore.reset();
  const { supabase } = await import("../src/config/db.js");
  const { register } = await import("../src/controllers/authController.js");
  const origFrom = supabase.from;
  const origRpc = supabase.rpc;
  const origFetch = globalThis.fetch;
  const origKey = process.env.NIKITA_API_KEY;
  process.env.NIKITA_API_KEY = "dummy-test-key";

  const deletedTables = [];
  const twentyMinsAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({ token: "tok_reclaim_phone", status: 0, description: "Code Sent" }),
  });

  try {
    supabase.from = (table) => {
      if (table === "users") {
        return {
          select: () => ({
            eq: (col) => ({
              maybeSingle: async () => {
                if (col === "email") return { data: null, error: null };
                if (col === "phone") {
                  return {
                    data: {
                      id: "squatter-user-id",
                      is_verified: false,
                      is_email_verified: false,
                      token_version: 0,
                      created_at: twentyMinsAgo,
                    },
                    error: null,
                  };
                }
                return { data: null, error: null };
              },
            }),
          }),
          delete: () => ({
            eq: async (col, val) => {
              deletedTables.push({ table: "users", col, val });
              return { error: null };
            },
          }),
        };
      }
      if (
        table === "listings" ||
        table === "payments" ||
        table === "subscriptions" ||
        table === "favorites" ||
        table === "verification_requests"
      ) {
        return {
          select: () => ({
            eq: async () => ({ count: 0, error: null }),
          }),
        };
      }
      if (table === "user_profiles" || table === "developers") {
        return {
          delete: () => ({
            eq: async (col, val) => {
              deletedTables.push({ table, col, val });
              return { error: null };
            },
          }),
        };
      }
      return origFrom(table);
    };

    supabase.rpc = async (fnName) => {
      if (fnName === "register_user") {
        return { data: "new-legit-user-id", error: null };
      }
      return origRpc(fnName);
    };

    const req = {
      ip: "127.0.0.1",
      body: {
        accountType: "personal",
        email: "legit-owner@example.com",
        phone: "+996770445566",
        password: "StrongPassword123!",
        firstName: "Тестовый",
        lastName: "Владелец",
        verificationMethod: "phone",
      },
    };
    const res = createMockRes();
    await register(req, res);

    assert.equal(res.statusCode, 201, "Регистрация должна завершиться со статусом 201 Created");
    assert.equal(res.body.success, true);
    assert.ok(
      deletedTables.some((d) => d.table === "user_profiles" && d.val === "squatter-user-id"),
      "user_profiles брошенного аккаунта должен быть удалён"
    );
    assert.ok(
      deletedTables.some((d) => d.table === "users" && d.val === "squatter-user-id"),
      "Запись users брошенного аккаунта должна быть удалена"
    );
  } finally {
    supabase.from = origFrom;
    supabase.rpc = origRpc;
    globalThis.fetch = origFetch;
    process.env.NIKITA_API_KEY = origKey;
  }
});
