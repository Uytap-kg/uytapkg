import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { BASE_URL, supabaseAdmin, isTestDbConfigured, SKIP_NO_TEST_DB_REASON } from "./helpers.mjs";
import { phoneOtpStore } from "../src/utils/phoneOtpStore.js";
import { verifyKeyGenerator } from "../src/routes/authRoutes.js";

test("OTP Verification: Rate limiter key uses composite 'IP + identifier' to prevent DoS of legitimate user", () => {
  const reqAttacker = {
    ip: "198.51.100.10",
    body: { phone: "996700123456", code: "000000" },
  };

  const reqVictim = {
    ip: "203.0.113.20",
    body: { phone: "996700123456", code: "123456" },
  };

  const attackerKey = verifyKeyGenerator(reqAttacker);
  const victimKey = verifyKeyGenerator(reqVictim);

  // Ключи должны быть РАЗНЫМИ! Иначе злоумышленник заблокирует проверку для жертвы со своего IP
  assert.notEqual(
    attackerKey,
    victimKey,
    "Rate limiter key must combine client IP and target identifier to prevent DoS"
  );
  assert.match(attackerKey, /198\.51\.100\.10/, "Attacker key must include attacker IP");
  assert.match(victimKey, /203\.0\.113\.20/, "Victim key must include victim IP");
});

test("OTP Verification: SMS OTP token burns atomically on 5th failed attempt", async () => {
  phoneOtpStore.reset();
  const phone = "996700111333";
  const token = "test-token-burn-5";

  phoneOtpStore.recordSend({
    phone,
    ip: "127.0.0.1",
    token,
  });

  // Первые 4 попытки возвращают allowed: true с уменьшением attemptsLeft
  for (let i = 1; i <= 4; i++) {
    const res = phoneOtpStore.registerAttempt(token);
    assert.equal(res.allowed, true, `Attempt ${i} should be allowed`);
    assert.equal(res.attempts, i);
  }

  // 5-я попытка (последняя разрешённая)
  const fifth = phoneOtpStore.registerAttempt(token);
  assert.equal(fifth.allowed, true, "5th attempt is allowed");
  assert.equal(fifth.attemptsLeft, 0);

  // 6-я попытка — код должен быть полностью сожжён (удалён)
  const sixth = phoneOtpStore.registerAttempt(token);
  assert.equal(sixth.allowed, false, "6th attempt must be rejected");
  assert.equal(phoneOtpStore.findRecord({ token }), null, "Token must be deleted from memory");
});

test("OTP Verification: Concurrency race condition — 50 parallel requests allow at most 5 attempts", async () => {
  phoneOtpStore.reset();
  const phone = "996700999000";
  const token = "race-token-50";

  phoneOtpStore.recordSend({
    phone,
    ip: "127.0.0.1",
    token,
  });

  // Запускаем 50 параллельных проверок через Promise.all
  const promises = Array.from({ length: 50 }, (_, i) =>
    Promise.resolve().then(() => phoneOtpStore.registerAttempt(token))
  );

  const results = await Promise.all(promises);

  const allowedCount = results.filter((r) => r.allowed).length;
  const rejectedCount = results.filter((r) => !r.allowed).length;

  assert.equal(allowedCount, 5, "Strictly at most 5 attempts must be allowed across 50 concurrent requests");
  assert.equal(rejectedCount, 45, "Remaining 45 concurrent requests must be rejected");
  assert.equal(phoneOtpStore.findRecord({ token }), null, "Token must be burned after race condition");
});

test("OTP Verification (Email DB Concurrency): 50 parallel RPC attempts allow at most 5 increments", async (t) => {
  if (!isTestDbConfigured) {
    t.skip(SKIP_NO_TEST_DB_REASON);
    return;
  }

  const email = `race-test-${Date.now()}@uytap.local`;
  const code = "123456";
  const secret = process.env.OTP_SECRET || "local-test-otp-secret-with-at-least-32-chars-long";
  const codeHash = crypto.createHmac("sha256", secret).update(code).digest("hex");

  // Создаём запись верификации email в БД
  const { data: rec, error } = await supabaseAdmin
    .from("email_verifications")
    .insert([
      {
        email,
        code_hash: codeHash,
        type: "registration",
        attempts: 0,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      },
    ])
    .select("id")
    .single();

  assert.equal(error, null);
  const verifyId = rec.id;

  // 50 параллельных вызовов consume_otp_attempt RPC
  const promises = Array.from({ length: 50 }, () =>
    supabaseAdmin.rpc("consume_otp_attempt", { p_id: verifyId })
  );

  const responses = await Promise.all(promises);
  const attemptsArray = responses.map((r) => r.data);

  // Ровно 5 вызовов должны вернуть число 1, 2, 3, 4, 5. Все остальные 45 должны вернуть -1.
  const successfulAttempts = attemptsArray.filter((a) => a > 0 && a <= 5);
  const rejectedAttempts = attemptsArray.filter((a) => a === -1);

  assert.equal(successfulAttempts.length, 5, "Strictly 5 increments must succeed in PostgreSQL");
  assert.equal(rejectedAttempts.length, 45, "Remaining 45 parallel attempts must return -1");
});
