import test from "node:test";
import assert from "node:assert/strict";
import { BASE_URL } from "./helpers.mjs";
import { normalizeNikitaPhone } from "../src/services/nikitaService.js";
import { phoneOtpStore } from "../src/utils/phoneOtpStore.js";

test("Send Limits: normalizeNikitaPhone strictly allows only Kyrgyz numbers (+996)", () => {
  // Номера других стран (США, РФ, Великобритания) должны отклоняться ДО вызова провайдера
  const foreignNumbers = [
    "+14155552671", // США
    "+79991234567", // РФ
    "+447911123456", // Великобритания
    "998901234567", // Узбекистан
    "77012345678", // Казахстан
  ];

  for (const num of foreignNumbers) {
    const res = normalizeNikitaPhone(num);
    assert.equal(
      res.valid,
      false,
      `Foreign number ${num} must be rejected before reaching SMS gateway`
    );
  }

  // Корректные форматы Кыргызстана должны успешно проходить валидацию
  const validKgNumbers = [
    "+996 700 123 456",
    "0700123456",
    "996555123456",
    "700123456",
  ];

  for (const num of validKgNumbers) {
    const res = normalizeNikitaPhone(num);
    assert.equal(res.valid, true, `Valid KG number ${num} must be accepted`);
    assert.match(res.phone, /^996\d{9}$/, "Must be normalized to 996XXXXXXXXX");
  }
});

test("Send Limits: Per-phone daily limit (max 10 in 24h) and cooldown (60s)", () => {
  phoneOtpStore.reset();
  const phone = "996700111222";
  const ip = "192.0.2.1";

  // 1. Первая отправка разрешена
  const firstCheck = phoneOtpStore.checkSendLimits({ phone, ip });
  assert.equal(firstCheck.allowed, true);
  phoneOtpStore.recordSend({ phone, ip, token: "token-1" });

  // 2. Повторная отправка немедленно — блокируется кулдауном 60с
  const cooldownCheck = phoneOtpStore.checkSendLimits({ phone, ip });
  assert.equal(cooldownCheck.allowed, false);
  assert.equal(cooldownCheck.reason, "cooldown");

  // Симулируем 10 отправок на один номер в течение суток
  phoneOtpStore.reset();
  const now = Date.now();
  for (let i = 0; i < 10; i++) {
    phoneOtpStore.recordSend({
      phone,
      ip: `192.0.2.${i + 10}`,
      token: `token-${i}`,
      sentAt: now - (i + 1) * 2 * 60 * 60 * 1000, // распределены по суткам (каждые 2 часа)
    });
  }

  // 11-я отправка за сутки должна быть заблокирована суточным лимитом
  const dailyCheck = phoneOtpStore.checkSendLimits({ phone, ip: "192.0.2.99" });
  assert.equal(
    dailyCheck.allowed,
    false,
    "11th SMS to the same phone within 24h must be blocked by daily limit"
  );
  assert.equal(dailyCheck.reason, "phone_daily_limit");
});

test("Send Limits: IP limits (10/min, 60/hr) protect provider without blocking mobile operators", () => {
  phoneOtpStore.reset();
  const sharedCarrierIp = "192.0.2.55";

  // Отправляем 10 SMS с одного IP за 1 минуту
  for (let i = 0; i < 10; i++) {
    const check = phoneOtpStore.checkSendLimits({
      phone: `9967000000${i.toString().padStart(2, "0")}`,
      ip: sharedCarrierIp,
    });
    assert.equal(check.allowed, true, `Request ${i + 1} should be allowed`);
    phoneOtpStore.recordSend({
      phone: `9967000000${i.toString().padStart(2, "0")}`,
      ip: sharedCarrierIp,
      token: `token-ip-${i}`,
    });
  }

  // 11-й запрос за минуту с этого же IP должен быть отклонен (защита от флуда/скриптов)
  const minuteFloodCheck = phoneOtpStore.checkSendLimits({
    phone: "996700000099",
    ip: sharedCarrierIp,
  });
  assert.equal(
    minuteFloodCheck.allowed,
    false,
    "11th SMS from same IP in 1 minute must be blocked"
  );
  assert.equal(minuteFloodCheck.reason, "ip_minute_limit");
});

test("Send Limits: Global daily SMS ceiling for the whole service protects provider balance", () => {
  phoneOtpStore.reset();
  const globalCeiling = 500;

  // Заполняем историю сервиса до суточного потолка
  const now = Date.now();
  for (let i = 0; i < globalCeiling; i++) {
    phoneOtpStore.recordServiceSms(now - i * 1000);
  }

  // Запрос на отправку SMS при исчерпанном суточном потолке сервиса должен быть отклонён
  const check = phoneOtpStore.checkSendLimits({
    phone: "996700999888",
    ip: "192.0.2.123",
  });

  assert.equal(
    check.allowed,
    false,
    "Global service daily ceiling must reject new SMS when reached"
  );
  assert.equal(check.reason, "service_daily_limit");
});

test("Send Limits (API Integration): POST /api/auth/send-otp with non-Kyrgyz phone is rejected with 400", async () => {
  const res = await fetch(`${BASE_URL}/api/auth/send-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: "+14155552671" }),
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.success, false);
  assert.match(data.message, /Кыргызстан/i);
});
