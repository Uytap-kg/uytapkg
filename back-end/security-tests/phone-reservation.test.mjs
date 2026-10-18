import { test } from "node:test";
import assert from "node:assert/strict";
import {
  api,
  isTestDbConfigured,
  SKIP_NO_TEST_DB_REASON,
  supabaseAdmin,
} from "./helpers.mjs";

test(
  "Phone Reservation A: подтверждённый номер нельзя забрать (409 Conflict)",
  { skip: !isTestDbConfigured ? SKIP_NO_TEST_DB_REASON : false },
  async () => {
    const verifiedEmail = `verified-owner-${Date.now()}@example.local`;
    const attackerEmail = `attacker-${Date.now()}@example.local`;
    const phone = `+996555${Math.floor(100000 + Math.random() * 900000)}`;

    let ownerId = null;
    try {
      // 1. Создаём подтверждённого пользователя
      const { data: owner, error } = await supabaseAdmin
        .from("users")
        .insert({
          email: verifiedEmail,
          phone,
          password_hash: "$2b$10$abcdefghijklmnopqrstuu",
          account_type: "personal",
          is_verified: true,
          is_email_verified: true,
        })
        .select("id")
        .single();
      assert.ifError(error);
      ownerId = owner.id;

      // 2. Злоумышленник пытается зарегистрироваться с тем же подтверждённым номером
      const res = await api("/api/auth/register", {
        method: "POST",
        body: {
          accountType: "personal",
          email: attackerEmail,
          phone,
          password: "StrongPassword123!",
          firstName: "Attacker",
          lastName: "User",
        },
      });

      assert.equal(res.status, 409, "Подтверждённый номер обязан быть защищён (409 Conflict)");
      assert.equal(res.body.success, false);
      assert.match(res.body.message, /номер.*телефон|уже существует/i);
    } finally {
      if (ownerId) await supabaseAdmin.from("users").delete().eq("id", ownerId);
    }
  }
);

test(
  "Phone Reservation B: неподтверждённый свежий номер нельзя забрать, пока не истёк таймер (409 Conflict)",
  { skip: !isTestDbConfigured ? SKIP_NO_TEST_DB_REASON : false },
  async () => {
    const unverifiedEmail = `fresh-unverified-${Date.now()}@example.local`;
    const secondUserEmail = `second-user-${Date.now()}@example.local`;
    const phone = `+996555${Math.floor(100000 + Math.random() * 900000)}`;

    let initialUserId = null;
    try {
      // 1. Создаём свежего неподтверждённого пользователя (создан только что)
      const { data: initialUser, error } = await supabaseAdmin
        .from("users")
        .insert({
          email: unverifiedEmail,
          phone,
          password_hash: "$2b$10$abcdefghijklmnopqrstuu",
          account_type: "personal",
          is_verified: false,
          is_email_verified: false,
          created_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      assert.ifError(error);
      initialUserId = initialUser.id;

      // 2. Другой пользователь пытается занять этот же свежий номер до истечения таймера
      const res = await api("/api/auth/register", {
        method: "POST",
        body: {
          accountType: "personal",
          email: secondUserEmail,
          phone,
          password: "StrongPassword123!",
          firstName: "Second",
          lastName: "User",
        },
      });

      assert.equal(res.status, 409, "Свежий неподтверждённый номер нельзя забрать до таймера (409 Conflict)");
      assert.equal(res.body.success, false);
      assert.match(res.body.message, /зарезервирован|уже существует/i);
    } finally {
      if (initialUserId) await supabaseAdmin.from("users").delete().eq("id", initialUserId);
    }
  }
);

test(
  "Phone Reservation C: неподтверждённый просроченный номер освобождается и разрешает регистрацию (201 Created)",
  { skip: !isTestDbConfigured ? SKIP_NO_TEST_DB_REASON : false },
  async () => {
    const abandonedEmail = `abandoned-${Date.now()}@example.local`;
    const legitimateEmail = `legitimate-${Date.now()}@example.local`;
    const phone = `+996555${Math.floor(100000 + Math.random() * 900000)}`;

    let legitimateUserId = null;
    let abandonedUserId = null;
    try {
      // 1. Создаём брошенную регистрацию (возраст 20 минут, таймер 10 минут)
      const twentyMinsAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      const { data: abandonedUser, error } = await supabaseAdmin
        .from("users")
        .insert({
          email: abandonedEmail,
          phone,
          password_hash: "$2b$10$abcdefghijklmnopqrstuu",
          account_type: "personal",
          is_verified: false,
          is_email_verified: false,
          created_at: twentyMinsAgo,
        })
        .select("id")
        .single();
      assert.ifError(error);
      abandonedUserId = abandonedUser.id;

      // 2. Законный владелец регистрируется со своим номером
      const res = await api("/api/auth/register", {
        method: "POST",
        body: {
          accountType: "personal",
          email: legitimateEmail,
          phone,
          password: "StrongPassword123!",
          firstName: "Legitimate",
          lastName: "Owner",
        },
      });

      assert.equal(
        res.status,
        201,
        `Неподтверждённый просроченный номер должен быть освобождён для регистрации (ожидался 201, получен ${res.status}: ${JSON.stringify(res.body)})`
      );
      assert.equal(res.body.success, true);
      assert.equal(res.body.needVerification, true);

      // Проверяем, что в базе старый брошенный аккаунт освободил номер, а новый создан
      const { data: usersWithPhone } = await supabaseAdmin
        .from("users")
        .select("id, email")
        .eq("phone", phone);

      assert.equal(usersWithPhone.length, 1, "Ровно одна актуальная запись должна обладать номером");
      assert.equal(usersWithPhone[0].email, legitimateEmail);
      legitimateUserId = usersWithPhone[0].id;
    } finally {
      if (abandonedUserId) await supabaseAdmin.from("users").delete().eq("id", abandonedUserId);
      if (legitimateUserId) await supabaseAdmin.from("users").delete().eq("id", legitimateUserId);
      await supabaseAdmin.from("email_verifications").delete().eq("email", legitimateEmail);
      await supabaseAdmin.from("email_verifications").delete().eq("email", abandonedEmail);
    }
  }
);
