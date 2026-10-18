import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import {
  api,
  isTestDbConfigured,
  SKIP_NO_TEST_DB_REASON,
  registerTestUser,
  deleteTestUser,
  supabaseAdmin,
} from "./helpers.mjs";

test(
  "Payments Security: Strict DB pricing, IDOR protection, State machine transitions, Webhook signature & Idempotency",
  { skip: !isTestDbConfigured ? SKIP_NO_TEST_DB_REASON : false },
  async () => {
    const userA = await registerTestUser();
    const userB = await registerTestUser();

    let createdOrderId = null;

    try {
      // ------------------------------------------------------------------------
      // 1. ПОДМЕНА СУММЫ И ВАЛЮТЫ: Клиент передаёт заниженную сумму и валюту USD
      // ------------------------------------------------------------------------
      const tamperRes = await api("/api/payments/create", {
        method: "POST",
        token: userA.token,
        body: {
          tariffId: "start",
          months: 1,
          amount: 1, // Попытка купить за 1 сом/копейку
          currency: "USD", // Попытка подменить валюту
        },
      });

      assert.equal(tamperRes.status, 201, `Failed to create payment: ${JSON.stringify(tamperRes.body)}`);
      createdOrderId = tamperRes.body.data.orderId;

      // Проверяем запись в БД: сумма должна быть взята строго из тарифа (390 сом = 39000 копеек)
      const { data: dbPayment } = await supabaseAdmin
        .from("payments")
        .select("*")
        .eq("order_id", createdOrderId)
        .single();

      assert.ok(dbPayment);
      assert.equal(
        dbPayment.amount,
        39000,
        `EXPLOIT: Payment amount in DB was tampered to ${dbPayment.amount} instead of 39000!`
      );
      assert.equal(dbPayment.status, "processing");

      // ------------------------------------------------------------------------
      // 2. IDOR ЗАЩИТА: Пользователь B не имеет права смотреть или отменять счёт А
      // ------------------------------------------------------------------------
      // Попытка B запросить статус счёта А
      const idorStatusRes = await api(`/api/payments/${createdOrderId}/status`, {
        method: "GET",
        token: userB.token,
      });
      assert.equal(
        idorStatusRes.status,
        404,
        "IDOR: User B must not be able to view User A's payment status"
      );

      // Попытка B отменить счёт А
      const idorCancelRes = await api(`/api/payments/${createdOrderId}/cancel`, {
        method: "POST",
        token: userB.token,
      });
      assert.equal(
        idorCancelRes.status,
        404,
        "IDOR: User B must not be able to cancel User A's payment"
      );

      // ------------------------------------------------------------------------
      // 3. ЗАЩИТА WEBHOOK: Валидация подписи (хэша)
      // ------------------------------------------------------------------------
      // Атакующий шлёт webhook с поддельным хэшем
      const fakeHashRes = await api("/api/payments/webhook", {
        method: "POST",
        body: {
          order_id: createdOrderId,
          hash: "deadbeef000011112222333344445555",
        },
      });
      assert.equal(
        fakeHashRes.status,
        400,
        "Webhook with invalid signature hash must be rejected with 400 Bad Request"
      );

      // ------------------------------------------------------------------------
      // 4. ПЕРЕХОДЫ СТАТУСОВ: Отменённый счёт (canceled) нельзя перевести в approved
      // ------------------------------------------------------------------------
      // Пользователь А отменяет свой счёт
      const cancelRes = await api(`/api/payments/${createdOrderId}/cancel`, {
        method: "POST",
        token: userA.token,
      });
      assert.equal(cancelRes.status, 200, "Owner should be able to cancel own pending payment");

      const { data: canceledPayment } = await supabaseAdmin
        .from("payments")
        .select("status")
        .eq("order_id", createdOrderId)
        .single();
      assert.equal(canceledPayment.status, "canceled");

      // Теперь эмулируем провайдерский webhook или reconcile попытку подтвердить уже отменённый платёж
      const mockSecret = process.env.ODENGI_PASSWORD || "test_password";
      const validHash = crypto
        .createHmac("md5", mockSecret)
        .update(JSON.stringify({ order_id: createdOrderId }))
        .digest("hex");

      const delayedWebhookRes = await api("/api/payments/webhook", {
        method: "POST",
        body: {
          order_id: createdOrderId,
          hash: validHash,
        },
      });
      assert.ok([200, 400].includes(delayedWebhookRes.status));

      // Проверяем в БД: статус ДОЛЖЕН остаться "canceled", ни в коем случае не "approved"!
      const { data: postWebhookPayment } = await supabaseAdmin
        .from("payments")
        .select("status, fulfilled_at")
        .eq("order_id", createdOrderId)
        .single();

      assert.equal(
        postWebhookPayment.status,
        "canceled",
        "STATE MACHINE VIOLATION: Canceled payment was resurrected to approved!"
      );
      assert.equal(
        postWebhookPayment.fulfilled_at,
        null,
        "Canceled payment must never have fulfilled_at set"
      );

      // ------------------------------------------------------------------------
      // 5. ИДЕМПОТЕНТНОСТЬ WEBHOOK: Повторные webhook не вызывают сбоев и повторных начислений
      // ------------------------------------------------------------------------
      const secondPaymentRes = await api("/api/payments/create", {
        method: "POST",
        token: userA.token,
        body: { tariffId: "start", months: 1 },
      });
      assert.equal(secondPaymentRes.status, 201);
      const secondOrderId = secondPaymentRes.body.data.orderId;

      // Эмулируем одобрение в mock-шлюзе
      await fetch("http://127.0.0.1:5055/test/set-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: secondOrderId, status: "approved" }),
      });

      const secondHash = crypto
        .createHmac("md5", mockSecret)
        .update(JSON.stringify({ order_id: secondOrderId }))
        .digest("hex");

      // 1-й webhook
      const wb1 = await api("/api/payments/webhook", {
        method: "POST",
        body: { order_id: secondOrderId, hash: secondHash },
      });
      assert.equal(wb1.status, 200);

      // 2-й webhook (дубликат)
      const wb2 = await api("/api/payments/webhook", {
        method: "POST",
        body: { order_id: secondOrderId, hash: secondHash },
      });
      assert.equal(wb2.status, 200, "Duplicate webhook must respond with 200 OK without errors");

      const { data: approvedPayment } = await supabaseAdmin
        .from("payments")
        .select("status, fulfilled_at, fulfill_attempts")
        .eq("order_id", secondOrderId)
        .single();

      assert.equal(approvedPayment.status, "approved");
      assert.ok(approvedPayment.fulfilled_at);
      assert.equal(
        approvedPayment.fulfill_attempts,
        1,
        "Duplicate webhook must not increment fulfill_attempts or re-apply service"
      );
    } finally {
      if (createdOrderId) {
        await supabaseAdmin.from("payments").delete().eq("order_id", createdOrderId);
      }
      await deleteTestUser(userA.user.id);
      await deleteTestUser(userB.user.id);
    }
  }
);
