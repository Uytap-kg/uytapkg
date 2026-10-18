import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import {
  api,
  isTestDbConfigured,
  SKIP_NO_TEST_DB_REASON,
  supabaseAdmin,
} from "./helpers.mjs";
import { verifyOtp } from "../src/controllers/authController.js";
import { generateToken } from "../src/middleware/auth.js";

test(
  "Verify-OTP: unauthenticated email verification updates both is_email_verified and is_verified to true",
  { skip: !isTestDbConfigured ? SKIP_NO_TEST_DB_REASON : false },
  async () => {
    const email = `verify-test-${Date.now()}@example.local`;
    const phone = `+996555${Math.floor(100000 + Math.random() * 900000)}`;
    const secret = process.env.OTP_SECRET || process.env.JWT_SECRET || "local-test-otp-secret-with-at-least-32-chars-long";
    const rawCode = "654321";
    const codeHash = crypto.createHmac("sha256", secret).update(rawCode).digest("hex");

    let userId = null;
    try {
      // 1. Создаём пользователя с is_verified: false, is_email_verified: false
      const { data: newUser, error: userErr } = await supabaseAdmin
        .from("users")
        .insert({
          email,
          phone,
          password_hash: "$2b$10$abcdefghijklmnopqrstuu",
          account_type: "personal",
          is_verified: false,
          is_email_verified: false,
        })
        .select("id")
        .single();
      assert.ifError(userErr);
      userId = newUser.id;

      // 2. Создаём запись email_verifications
      const { error: otpErr } = await supabaseAdmin.from("email_verifications").insert({
        email,
        code_hash: codeHash,
        type: "registration",
        attempts: 0,
        is_used: false,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      });
      assert.ifError(otpErr);

      // 3. Вызываем POST /api/auth/verify-otp без авторизации (сценарий завершения регистрации)
      const res = await api("/api/auth/verify-otp", {
        method: "POST",
        body: { email, code: rawCode },
      });

      assert.equal(res.status, 200, `Expected 200, got: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.success, true);
      assert.equal(res.body.user?.isVerified, true, "Returned user payload must have isVerified: true");

      // 4. Проверяем состояние записи в PostgreSQL
      const { data: updatedUser } = await supabaseAdmin
        .from("users")
        .select("is_verified, is_email_verified")
        .eq("id", userId)
        .single();

      assert.equal(updatedUser.is_email_verified, true, "is_email_verified in DB must be true");
      assert.equal(updatedUser.is_verified, true, "is_verified in DB must be updated to true upon OTP verification");
    } finally {
      if (userId) {
        await supabaseAdmin.from("email_verifications").delete().eq("email", email);
        await supabaseAdmin.from("users").delete().eq("id", userId);
      }
    }
  }
);

test(
  "Verify-OTP: authenticated session properly sets req.user and marks user as verified",
  { skip: !isTestDbConfigured ? SKIP_NO_TEST_DB_REASON : false },
  async () => {
    const email = `auth-session-${Date.now()}@example.local`;
    const phone = `+996555${Math.floor(100000 + Math.random() * 900000)}`;
    const secret = process.env.OTP_SECRET || process.env.JWT_SECRET || "local-test-otp-secret-with-at-least-32-chars-long";
    const rawCode = "112233";
    const codeHash = crypto.createHmac("sha256", secret).update(rawCode).digest("hex");

    let userId = null;
    try {
      const { data: newUser, error: userErr } = await supabaseAdmin
        .from("users")
        .insert({
          email,
          phone,
          password_hash: "$2b$10$abcdefghijklmnopqrstuu",
          account_type: "personal",
          is_verified: false,
          is_email_verified: false,
        })
        .select("id")
        .single();
      assert.ifError(userErr);
      userId = newUser.id;

      const token = generateToken({
        id: userId,
        email,
        accountType: "personal",
        role: "user",
      });

      const { error: otpErr } = await supabaseAdmin.from("email_verifications").insert({
        email,
        code_hash: codeHash,
        type: "registration",
        attempts: 0,
        is_used: false,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      });
      assert.ifError(otpErr);

      // Отправляем с заголовком Authorization: Bearer <token>
      const res = await api("/api/auth/verify-otp", {
        method: "POST",
        token,
        body: { email, code: rawCode },
      });

      assert.equal(res.status, 200, `Expected 200, got: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.success, true);

      const { data: updatedUser } = await supabaseAdmin
        .from("users")
        .select("is_verified, is_email_verified")
        .eq("id", userId)
        .single();

      assert.equal(updatedUser.is_verified, true, "is_verified must be true");
    } finally {
      if (userId) {
        await supabaseAdmin.from("email_verifications").delete().eq("email", email);
        await supabaseAdmin.from("users").delete().eq("id", userId);
      }
    }
  }
);
