import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import {
  api,
  isTestDbConfigured,
  SKIP_NO_TEST_DB_REASON,
  supabaseAdmin,
} from "./helpers.mjs";
import { generateToken } from "../src/middleware/auth.js";
import { hashOtpCode } from "../src/controllers/authController.js";

test(
  "Verify-OTP: email verification updates is_email_verified to true while keeping is_verified false (phone unverified)",
  { skip: !isTestDbConfigured ? SKIP_NO_TEST_DB_REASON : false },
  async () => {
    const email = `verify-test-${Date.now()}@example.local`;
    const phone = `+996555${Math.floor(100000 + Math.random() * 900000)}`;
    const rawCode = "654321";
    const codeHash = hashOtpCode(rawCode);

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

      // 3. Вызываем POST /api/auth/verify-otp без авторизации (сценарий подтверждения email)
      const res = await api("/api/auth/verify-otp", {
        method: "POST",
        body: { email, code: rawCode },
      });

      assert.equal(res.status, 200, `Expected 200, got: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.success, true);
      assert.equal(res.body.user?.isEmailVerified, true, "Returned user payload must have isEmailVerified: true");
      assert.equal(res.body.user?.isVerified, false, "Returned user payload must keep isVerified: false until phone verification");

      // 4. Проверяем состояние записи в PostgreSQL
      const { data: updatedUser } = await supabaseAdmin
        .from("users")
        .select("is_verified, is_email_verified")
        .eq("id", userId)
        .single();

      assert.equal(updatedUser.is_email_verified, true, "is_email_verified in DB must be true");
      assert.equal(updatedUser.is_verified, false, "is_verified in DB must remain false after email-only verification");
    } finally {
      if (userId) {
        await supabaseAdmin.from("email_verifications").delete().eq("email", email);
        await supabaseAdmin.from("users").delete().eq("id", userId);
      }
    }
  }
);

test(
  "Verify-OTP: authenticated user can verify email without altering phone verification status",
  { skip: !isTestDbConfigured ? SKIP_NO_TEST_DB_REASON : false },
  async () => {
    const email = `auth-session-${Date.now()}@example.local`;
    const phone = `+996555${Math.floor(100000 + Math.random() * 900000)}`;
    const rawCode = "112233";
    const codeHash = hashOtpCode(rawCode);

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

      assert.equal(updatedUser.is_email_verified, true, "is_email_verified must be true");
      assert.equal(updatedUser.is_verified, false, "is_verified must remain false");
    } finally {
      if (userId) {
        await supabaseAdmin.from("email_verifications").delete().eq("email", email);
        await supabaseAdmin.from("users").delete().eq("id", userId);
      }
    }
  }
);

test(
  "Phone Security: authenticated user cannot bind another user's phone, and phone change resets is_verified",
  { skip: !isTestDbConfigured ? SKIP_NO_TEST_DB_REASON : false },
  async () => {
    const userAEmail = `user-a-${Date.now()}@example.local`;
    const userBEmail = `user-b-${Date.now()}@example.local`;
    const phoneA = `+996555${Math.floor(100000 + Math.random() * 900000)}`;
    const phoneB = `+996777${Math.floor(100000 + Math.random() * 900000)}`;

    let userAId = null;
    let userBId = null;

    try {
      // Создаем пользователя А (верифицирован)
      const { data: userA } = await supabaseAdmin
        .from("users")
        .insert({
          email: userAEmail,
          phone: phoneA,
          password_hash: "$2b$10$abcdefghijklmnopqrstuu",
          account_type: "personal",
          is_verified: true,
          is_email_verified: true,
        })
        .select("id")
        .single();
      userAId = userA.id;

      // Создаем пользователя B (с другим телефоном)
      const { data: userB } = await supabaseAdmin
        .from("users")
        .insert({
          email: userBEmail,
          phone: phoneB,
          password_hash: "$2b$10$abcdefghijklmnopqrstuu",
          account_type: "personal",
          is_verified: true,
          is_email_verified: true,
        })
        .select("id")
        .single();
      userBId = userB.id;

      const tokenA = generateToken({
        id: userAId,
        email: userAEmail,
        accountType: "personal",
        role: "user",
      });

      // 1. Попытка пользователя А запросить SMS OTP на чужой телефон (phoneB)
      const sendOtpRes = await api("/api/auth/send-otp", {
        method: "POST",
        token: tokenA,
        body: { phone: phoneB },
      });
      assert.equal(sendOtpRes.status, 400, "Must reject send-otp for phone already owned by another user");
      assert.equal(sendOtpRes.body.message, "Этот номер телефона уже привязан к другому аккаунту");

      // 2. Попытка пользователя А обновить свой профиль на чужой телефон (phoneB)
      const updateProfileRes = await api("/api/auth/me", {
        method: "PUT",
        token: tokenA,
        body: { phone: phoneB },
      });
      assert.equal(updateProfileRes.status, 400, "Must reject profile phone update to another user's phone");

      // 3. Пользователь А меняет телефон на свой собственный новый (уникальный)
      const newPhoneA = `+996500${Math.floor(100000 + Math.random() * 900000)}`;
      const validUpdateRes = await api("/api/auth/me", {
        method: "PUT",
        token: tokenA,
        body: { phone: newPhoneA },
      });
      assert.equal(validUpdateRes.status, 200);

      // Проверяем: при смене номера is_verified сбросился в false
      const { data: refreshedUserA } = await supabaseAdmin
        .from("users")
        .select("phone, is_verified, is_email_verified")
        .eq("id", userAId)
        .single();

      assert.equal(refreshedUserA.phone, newPhoneA);
      assert.equal(
        refreshedUserA.is_verified,
        false,
        "is_verified must reset to false when phone is changed until re-verified"
      );
      assert.equal(refreshedUserA.is_email_verified, true, "is_email_verified remains true");
    } finally {
      if (userAId) await supabaseAdmin.from("users").delete().eq("id", userAId);
      if (userBId) await supabaseAdmin.from("users").delete().eq("id", userBId);
    }
  }
);
