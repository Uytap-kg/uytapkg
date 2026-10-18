import { test } from "node:test";
import assert from "node:assert/strict";
import { sendOtpEmail } from "../src/services/emailService.js";

test("OTP Console Logging: In production mode, OTP codes must NEVER be written to stdout or stderr", async () => {
  const originalEnv = process.env.NODE_ENV;
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  let captured = "";
  const appendLog = (...args) => {
    captured += args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ") + "\n";
  };

  const secretCode = "741963";

  try {
    process.env.NODE_ENV = "production";
    console.log = appendLog;
    console.error = appendLog;
    console.warn = appendLog;

    let threw = false;
    try {
      await sendOtpEmail("test-leak@example.com", secretCode, "registration");
    } catch (err) {
      threw = true;
      assert.match(
        err.message,
        /не настроен|провайдер/i,
        "Production without mailer should reject with safe configuration error"
      );
    }

    // В продакшене без почтового шлюза функция обязана выбросить ошибку
    assert.equal(threw, true, "sendEmailOtp must fail fast in production if mailer is unconfigured");

    // Ни в одном потоке stdout/stderr не должно быть кода
    assert.equal(
      captured.includes(secretCode),
      false,
      `SECURITY LEAK: Found raw OTP code ${secretCode} in logs:\n${captured}`
    );
  } finally {
    process.env.NODE_ENV = originalEnv;
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  }
});
