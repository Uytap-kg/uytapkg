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
import { sendOtp, verifyOtp } from "../src/controllers/authController.js";

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
