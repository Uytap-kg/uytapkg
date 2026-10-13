// ПРОВЕРКА IDOR: может ли пользователь B редактировать/удалять объявление
// пользователя A, и может ли пользователь B посмотреть/отменить платёж
// пользователя A, просто зная/угадывая ID.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  api,
  registerTestUser,
  deleteTestUser,
  deleteTestListing,
  baseListingPayload,
  supabaseAdmin,
  logDbOp,
  isTestDbConfigured,
  SKIP_NO_TEST_DB_REASON,
} from "./helpers.mjs";

test(
  "IDOR check: user B cannot update user A's listing",
  { skip: !isTestDbConfigured ? SKIP_NO_TEST_DB_REASON : false },
  async () => {
    const userA = await registerTestUser();
    const userB = await registerTestUser();
    let listingId = null;
    try {
      const createRes = await api("/api/listings", {
        method: "POST",
        token: userA.token,
        body: baseListingPayload(),
      });
      assert.equal(createRes.status, 201);
      listingId = createRes.body.data.id;

      const attackRes = await api(`/api/listings/${listingId}`, {
        method: "PUT",
        token: userB.token,
        body: { title: "Hijacked by user B " + Date.now() },
      });

      assert.equal(attackRes.status, 403, `expected 403, got ${attackRes.status}: ${JSON.stringify(attackRes.body)}`);
    } finally {
      if (listingId) await deleteTestListing(listingId);
      await deleteTestUser(userA.user.id);
      await deleteTestUser(userB.user.id);
    }
  }
);

test(
  "IDOR check: user B cannot delete user A's listing",
  { skip: !isTestDbConfigured ? SKIP_NO_TEST_DB_REASON : false },
  async () => {
    const userA = await registerTestUser();
    const userB = await registerTestUser();
    let listingId = null;
    try {
      const createRes = await api("/api/listings", {
        method: "POST",
        token: userA.token,
        body: baseListingPayload(),
      });
      assert.equal(createRes.status, 201);
      listingId = createRes.body.data.id;

      const attackRes = await api(`/api/listings/${listingId}`, {
        method: "DELETE",
        token: userB.token,
      });

      assert.equal(attackRes.status, 403, `expected 403, got ${attackRes.status}: ${JSON.stringify(attackRes.body)}`);
    } finally {
      if (listingId) await deleteTestListing(listingId);
      await deleteTestUser(userA.user.id);
      await deleteTestUser(userB.user.id);
    }
  }
);

test(
  "IDOR check: user B cannot view user A's payment status by order_id",
  { skip: !isTestDbConfigured ? SKIP_NO_TEST_DB_REASON : false },
  async () => {
    const userA = await registerTestUser();
    const userB = await registerTestUser();
    let paymentRowId = null;
    const orderId = `SECTEST-${Date.now()}`;
    try {
      // Вставляем платёж напрямую (эмулируем состояние "processing"), т.к.
      // POST /api/payments/create в этом окружении всегда падает 503 —
      // ODENGI_SID пуст в .env (sandbox без реальных кредов), реальный вызов
      // к O!Dengi не проходит. Проверяем именно авторизационную логику
      // getPaymentStatus/cancelPayment, а не сам платёжный шлюз.
      const { data, error } = await supabaseAdmin
        .from("payments")
        .insert({
          user_id: userA.user.id,
          order_id: orderId,
          tariff_id: "start",
          months: 1,
          amount: 10000,
          status: "processing",
        })
        .select()
        .single();
      assert.equal(error, null, JSON.stringify(error));
      paymentRowId = data.id;
      logDbOp(`CREATE payments id=${paymentRowId} order_id=${orderId} user=${userA.user.id} (test row, status=processing)`);

      const attackRes = await api(`/api/payments/${orderId}/status`, { token: userB.token });
      assert.equal(attackRes.status, 404, `expected 404 (not found for this user), got ${attackRes.status}: ${JSON.stringify(attackRes.body)}`);

      const cancelAttack = await api(`/api/payments/${orderId}/cancel`, { method: "POST", token: userB.token });
      assert.equal(cancelAttack.status, 404, `expected 404, got ${cancelAttack.status}: ${JSON.stringify(cancelAttack.body)}`);
    } finally {
      if (paymentRowId) {
        await supabaseAdmin.from("payments").delete().eq("id", paymentRowId);
        logDbOp(`DELETE payments id=${paymentRowId} (cleanup)`);
      }
      await deleteTestUser(userA.user.id);
      await deleteTestUser(userB.user.id);
    }
  }
);

test(
  "Cross-account promotion purchase is blocked (cannot buy promotion for someone else's listing)",
  { skip: !isTestDbConfigured ? SKIP_NO_TEST_DB_REASON : false },
  async () => {
    const userA = await registerTestUser();
    const userB = await registerTestUser();
    let listingId = null;
    try {
      const createRes = await api("/api/listings", {
        method: "POST",
        token: userA.token,
        body: baseListingPayload(),
      });
      assert.equal(createRes.status, 201);
      listingId = createRes.body.data.id;

      const attackRes = await api("/api/payments/promotion/create", {
        method: "POST",
        token: userB.token,
        body: { listingId, serviceType: "vip", days: 7 },
      });

      assert.equal(attackRes.status, 403, `expected 403, got ${attackRes.status}: ${JSON.stringify(attackRes.body)}`);
    } finally {
      if (listingId) await deleteTestListing(listingId);
      await deleteTestUser(userA.user.id);
      await deleteTestUser(userB.user.id);
    }
  }
);
