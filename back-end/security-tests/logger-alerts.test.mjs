import test from "node:test";
import assert from "node:assert/strict";
import { maskEmail, maskPhone, sanitize, logger } from "../src/utils/logger.js";
import { requestContext } from "../src/middleware/requestContext.js";
import { alerts, clearAlertDeduplicationCache } from "../src/utils/alerts.js";

test("Logger B-1: maskEmail корректно маскирует адреса электронной почты", () => {
  assert.equal(maskEmail("user@example.com"), "u***@example.com");
  assert.equal(maskEmail("admin.service@uytap.kg"), "a***@uytap.kg");
  assert.equal(maskEmail("не email строка"), "не email строка");
  assert.equal(maskEmail(null), null);
});

test("Logger B-1: maskPhone корректно маскирует телефонные номера", () => {
  assert.equal(maskPhone("+996555123456"), "+996***456");
  assert.equal(maskPhone("0555123456"), "055***456");
  assert.equal(maskPhone("обычный текст"), "обычный текст");
});

test("Logger B-1: sanitize рекурсивно вырезает секреты и токены", () => {
  const input = {
    user: "john",
    password: "SuperSecretPassword123!",
    token: "jwt.access.token.secret",
    apiKey: "gemini-api-key-value",
    nested: {
      refreshToken: "refresh.secret",
      otp: "123456",
      email: "test@example.com",
      phone: "+996700112233",
    },
    authorization: "Bearer eyJhbGciOi...",
  };

  const cleaned = sanitize(input);
  assert.equal(cleaned.password, "[REDACTED]");
  assert.equal(cleaned.token, "[REDACTED]");
  assert.equal(cleaned.apiKey, "[REDACTED]");
  assert.equal(cleaned.authorization, "[REDACTED]");
  assert.equal(cleaned.nested.refreshToken, "[REDACTED]");
  assert.equal(cleaned.nested.otp, "[REDACTED]");
  assert.equal(cleaned.nested.email, "t***@example.com");
  assert.equal(cleaned.nested.phone, "+996***233");
  assert.equal(cleaned.user, "john");
});

test("Logger B-1: sanitize безопасно обрабатывает циклические ссылки", () => {
  const circularObj = { name: "test" };
  circularObj.self = circularObj;

  const cleaned = sanitize(circularObj);
  assert.equal(cleaned.name, "test");
  assert.equal(cleaned.self, "[Circular]");
});

test("RequestContext B-1: middleware генерирует X-Request-Id если он отсутствует", () => {
  const req = { headers: {}, method: "GET", url: "/api/health" };
  let headerSet = null;
  const res = {
    setHeader(name, val) {
      if (name === "X-Request-Id") headerSet = val;
    },
    on() {},
  };

  let nextCalled = false;
  requestContext(req, res, () => {
    nextCalled = true;
  });

  assert.ok(nextCalled, "next() должен быть вызван");
  assert.ok(req.id, "req.id должен быть выставлен");
  assert.equal(headerSet, req.id, "Заголовок X-Request-Id должен совпадать с req.id");
});

test("RequestContext B-1: middleware сохраняет входящий X-Request-Id", () => {
  const incomingId = "custom-req-id-12345";
  const req = { headers: { "x-request-id": incomingId }, method: "POST", url: "/api/auth/login" };
  let headerSet = null;
  const res = {
    setHeader(name, val) {
      if (name === "X-Request-Id") headerSet = val;
    },
    on() {},
  };

  requestContext(req, res, () => {});

  assert.equal(req.id, incomingId);
  assert.equal(headerSet, incomingId);
});

test("Alerts B-2: молча деградирует при отсутствии TELEGRAM токенов", async () => {
  const origToken = process.env.ALERT_TELEGRAM_BOT_TOKEN;
  const origChat = process.env.ALERT_TELEGRAM_CHAT_ID;
  delete process.env.ALERT_TELEGRAM_BOT_TOKEN;
  delete process.env.ALERT_TELEGRAM_CHAT_ID;

  clearAlertDeduplicationCache();
  try {
    const result = await alerts.critical("Test alert without env", { error: "test" });
    assert.equal(result, false, "Должен вернуть false при отсутствии настроек Telegram");
  } finally {
    if (origToken) process.env.ALERT_TELEGRAM_BOT_TOKEN = origToken;
    if (origChat) process.env.ALERT_TELEGRAM_CHAT_ID = origChat;
  }
});

test("Alerts B-2: дедупликация повторных алертов в окне 5 минут", async () => {
  clearAlertDeduplicationCache();
  process.env.ALERT_TELEGRAM_BOT_TOKEN = "fake-test-token";
  process.env.ALERT_TELEGRAM_CHAT_ID = "fake-test-chat";

  let fetchCount = 0;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCount++;
    return { ok: true, status: 200 };
  };

  try {
    const res1 = await alerts.warn("Payment warning test", { orderId: "UT001" });
    assert.equal(res1, true);
    assert.equal(fetchCount, 1, "Первый вызов должен отправить запрос в Telegram");

    // Повторный вызов с тем же сообщением должен быть пропущен дедупликатором
    const res2 = await alerts.warn("Payment warning test", { orderId: "UT001" });
    assert.equal(res2, false);
    assert.equal(fetchCount, 1, "Повторный вызов в течение 5 минут должен быть отфильтрован");
  } finally {
    globalThis.fetch = origFetch;
    delete process.env.ALERT_TELEGRAM_BOT_TOKEN;
    delete process.env.ALERT_TELEGRAM_CHAT_ID;
  }
});
