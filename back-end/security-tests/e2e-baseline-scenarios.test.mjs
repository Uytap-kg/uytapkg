import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { BASE_URL, supabaseAdmin, isTestDbConfigured, SKIP_NO_TEST_DB_REASON } from "./helpers.mjs";

const TEST_SECRET = process.env.OTP_SECRET || "local-test-otp-secret-with-at-least-32-chars-long";

test("E2E Scenario: Full product user lifecycle (Register -> Email OTP -> SMS OTP -> Login -> Create Listing -> Payment)", async (t) => {
  if (!isTestDbConfigured) {
    t.skip(SKIP_NO_TEST_DB_REASON);
    return;
  }

  const uniqueId = Date.now().toString().slice(-6);
  const email = `e2e_user_${uniqueId}@uytap.local`;
  const phone = `996700${uniqueId}`;
  const password = "ValidPassword123!";

  // ============================================================================
  // Шаг 1: Регистрация (POST /api/auth/register)
  // ============================================================================
  const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      phone,
      password,
      accountType: "personal",
      firstName: "Тестовый",
      lastName: "Пользователь",
    }),
  });

  const regData = await regRes.json();
  assert.equal(regRes.status, 201, `Registration should succeed: ${JSON.stringify(regData)}`);
  assert.equal(regData.success, true);
  assert.equal(regData.needVerification, true);

  // ============================================================================
  // Шаг 2: Подтверждение Email OTP (POST /api/auth/verify-otp)
  // ============================================================================
  const emailCode = "123456";
  const codeHash = crypto.createHmac("sha256", TEST_SECRET).update(emailCode).digest("hex");

  await supabaseAdmin
    .from("email_verifications")
    .update({ code_hash: codeHash })
    .eq("email", email)
    .eq("type", "registration")
    .eq("is_used", false);

  const verifyEmailRes = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code: emailCode }),
  });

  const verifyEmailData = await verifyEmailRes.json();
  assert.equal(verifyEmailRes.status, 200, `Email OTP should verify: ${JSON.stringify(verifyEmailData)}`);
  assert.ok(verifyEmailData.token, "Must return JWT token");
  const authToken = verifyEmailData.token;
  const userId = verifyEmailData.user.id;

  // ============================================================================
  // Шаг 3: Отправка и подтверждение SMS OTP через мок Nikita
  // ============================================================================
  const sendSmsRes = await fetch(`${BASE_URL}/api/auth/send-otp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ phone }),
  });

  const sendSmsData = await sendSmsRes.json();
  assert.equal(sendSmsRes.status, 200, `SMS send should succeed: ${JSON.stringify(sendSmsData)}`);
  const smsToken = sendSmsData.token;
  assert.ok(smsToken, "Must receive SMS session token");

  // Перехватываем сгенерированный код из mock-сервера Nikita (порт 5056)
  const lastOtpRes = await fetch(`http://127.0.0.1:5056/test/last-otp?token=${smsToken}`);
  const lastOtpData = await lastOtpRes.json();
  assert.ok(lastOtpData.record?.code, "Mock Nikita must intercept SMS code");
  const interceptedSmsCode = lastOtpData.record.code;

  // Подтверждаем SMS OTP
  const verifySmsRes = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({
      token: smsToken,
      phone,
      code: interceptedSmsCode,
    }),
  });

  const verifySmsData = await verifySmsRes.json();
  assert.equal(verifySmsRes.status, 200, `SMS OTP should verify: ${JSON.stringify(verifySmsData)}`);
  assert.equal(verifySmsData.success, true);

  // ============================================================================
  // Шаг 4: Вход в систему (POST /api/auth/login)
  // ============================================================================
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identifier: email,
      password,
    }),
  });

  const loginData = await loginRes.json();
  assert.equal(loginRes.status, 200, `Login should succeed: ${JSON.stringify(loginData)}`);
  assert.ok(loginData.token);
  const activeToken = loginData.token;

  // ============================================================================
  // Шаг 5: Основное действие — Создание объявления (POST /api/listings)
  // ============================================================================
  const listingRes = await fetch(`${BASE_URL}/api/listings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${activeToken}`,
    },
    body: JSON.stringify({
      title: `Тестовая квартира ${uniqueId}`,
      description: "Просторная тестовая квартира в центре города",
      propertyType: "apartment",
      dealType: "sale",
      region: "Чуйская область",
      price: 65000,
      currency: "USD",
      city: "Бишкек",
      address: "ул. Токтогула, 125",
      rooms: 2,
      area: 65,
    }),
  });

  const listingData = await listingRes.json();
  assert.equal(listingRes.status, 201, `Listing creation should succeed: ${JSON.stringify(listingData)}`);
  const listingId = listingData.data?.id || listingData.listing?.id;
  assert.ok(listingId, "Listing ID must be returned");

  // ============================================================================
  // Шаг 6: Оплата в Sandbox O!Dengi (POST /api/payments/promotion/create)
  // ============================================================================
  const paymentRes = await fetch(`${BASE_URL}/api/payments/promotion/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${activeToken}`,
    },
    body: JSON.stringify({
      listingId,
      serviceType: "vip",
      days: 7,
    }),
  });

  const paymentData = await paymentRes.json();
  assert.equal(paymentRes.status, 201, `Payment init should succeed: ${JSON.stringify(paymentData)}`);
  const orderId = paymentData.data?.orderId || paymentData.data?.order_id || paymentData.orderId;
  assert.ok(orderId, "Must return orderId for webhook");

  // Имитируем успешный Webhook от O!Dengi (порт 5055)
  const webhookPayload = {
    order_id: orderId,
    version: 1005,
    mktime: String(Date.now()),
    sid: "test_sid",
    cmd: "paymentResult",
    data: {
      order_id: orderId,
      status: "approved",
      amount: paymentData.data?.amount || 350,
      currency: "KGS",
    },
  };

  const webhookRes = await fetch(`${BASE_URL}/api/payments/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(webhookPayload),
  });

  assert.equal(webhookRes.status, 200, "Webhook must be processed successfully");

  // Проверяем идемпотентность повторного webhook
  const duplicateWebhookRes = await fetch(`${BASE_URL}/api/payments/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(webhookPayload),
  });

  assert.equal(duplicateWebhookRes.status, 200, "Duplicate webhook must be idempotent");

  // ============================================================================
  // Шаг 7: Повторный вход в систему (POST /api/auth/login)
  // ============================================================================
  const reloginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identifier: email,
      password,
    }),
  });

  const reloginData = await reloginRes.json();
  assert.equal(reloginRes.status, 200, "Re-login must succeed");
  assert.ok(reloginData.token, "Re-login must return valid token");

  // ============================================================================
  // Шаг 8: Сценарий с отменой / отказом оплаты (POST /api/payments/:orderId/cancel)
  // ============================================================================
  const cancelPaymentRes = await fetch(`${BASE_URL}/api/payments/promotion/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${reloginData.token}`,
    },
    body: JSON.stringify({
      listingId,
      serviceType: "top",
      days: 7,
    }),
  });

  const cancelPaymentData = await cancelPaymentRes.json();
  assert.equal(cancelPaymentRes.status, 201, "Second payment must be created");
  const cancelOrderId = cancelPaymentData.data?.orderId || cancelPaymentData.data?.order_id;
  assert.ok(cancelOrderId);

  // Пользователь отменяет платёж
  const doCancelRes = await fetch(`${BASE_URL}/api/payments/${cancelOrderId}/cancel`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${reloginData.token}`,
    },
  });

  assert.equal(doCancelRes.status, 200, "Payment cancel must return 200");

  // Проверяем статус отменённого платежа
  const statusRes = await fetch(`${BASE_URL}/api/payments/${cancelOrderId}/status`, {
    headers: {
      Authorization: `Bearer ${reloginData.token}`,
    },
  });
  const statusData = await statusRes.json();
  assert.equal(statusRes.status, 200);
  assert.equal(statusData.data?.status, "canceled", "Payment status must be canceled");

  // ============================================================================
  // Шаг 9: Сценарий администратора (просмотр статистики и платежей)
  // ============================================================================
  const adminId = crypto.randomUUID();
  const adminEmail = `admin-${Date.now()}@uytap.local`;
  const adminPhone = `+996555${Math.floor(100000 + Math.random() * 900000)}`;
  const { error: adminInsertErr } = await supabaseAdmin.from("users").insert({
    id: adminId,
    email: adminEmail,
    phone: adminPhone,
    password_hash: "test_admin_hash",
    account_type: "personal",
    role: "admin",
    is_verified: true,
  });
  assert.ifError(adminInsertErr);

  const jwtSecret = process.env.JWT_SECRET || "super-secret-jwt-token-with-at-least-32-characters-long";
  const { default: jwt } = await import("jsonwebtoken");
  const adminJwt = jwt.sign(
    { id: adminId, email: adminEmail, role: "admin", typ: "access", tv: 0 },
    jwtSecret,
    { expiresIn: "1h", algorithm: "HS256" }
  );

  const adminStatsRes = await fetch(`${BASE_URL}/api/admin/stats`, {
    headers: {
      Authorization: `Bearer ${adminJwt}`,
    },
  });
  assert.equal(adminStatsRes.status, 200, "Admin can get stats");
  const statsData = await adminStatsRes.json();
  assert.equal(statsData.success, true);

  const adminPaymentsRes = await fetch(`${BASE_URL}/api/admin/payments`, {
    headers: {
      Authorization: `Bearer ${adminJwt}`,
    },
  });
  assert.equal(adminPaymentsRes.status, 200, "Admin can list payments");

  // Обычный пользователь не должен иметь доступа к админке (403)
  const nonAdminRes = await fetch(`${BASE_URL}/api/admin/stats`, {
    headers: {
      Authorization: `Bearer ${reloginData.token}`,
    },
  });
  assert.equal(nonAdminRes.status, 403, "Non-admin user must receive 403 Forbidden");

  // Очистка тестовых данных в БД
  try {
    if (adminId) {
      await supabaseAdmin.from("users").delete().eq("id", adminId);
    }
    if (listingId) {
      await supabaseAdmin.from("listings").delete().eq("id", listingId);
    }
    if (userId) {
      await supabaseAdmin.from("users").delete().eq("id", userId);
    }
  } catch (err) {
    console.error("Cleanup error:", err);
  }
});
