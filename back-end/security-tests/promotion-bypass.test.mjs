// ПРОВЕРКА: может ли обычный (неадминский) пользователь бесплатно выдать
// себе платное продвижение (VIP/ТОП/Срочно) и/или обойти модерацию,
// не проходя оплату — просто через тело запроса на создание/редактирование
// объявления.
//
// Затрагиваемые файлы:
//   back-end/src/controllers/listingsController.js (createListing, updateListing)
//   back-end/src/utils/validation.js (createListingSchema.listingType,
//                                      updateListingSchema.promotionStatus/isUrgent/status)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  api,
  registerTestUser,
  deleteTestUser,
  deleteTestListing,
  baseListingPayload,
  isTestDbConfigured,
  SKIP_NO_TEST_DB_REASON,
} from "./helpers.mjs";

test(
  "Free promotion bypass: POST /api/listings with listingType=vip grants VIP without payment",
  { skip: !isTestDbConfigured ? SKIP_NO_TEST_DB_REASON : false },
  async () => {
    const { token, user } = await registerTestUser();
    let listingId = null;
    try {
      const payload = baseListingPayload({ listingType: "vip" });
      const { status, body } = await api("/api/listings", { method: "POST", token, body: payload });

      assert.equal(status, 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);
      listingId = body.data.id;

      assert.equal(
        body.data.promotion_status,
        "vip",
        "listing should NOT have been created with paid VIP status without payment, but it was"
      );
    } finally {
      if (listingId) await deleteTestListing(listingId);
      await deleteTestUser(user.id);
    }
  }
);

test(
  "Free promotion bypass: POST /api/listings with listingType=urgent grants is_urgent without payment",
  { skip: !isTestDbConfigured ? SKIP_NO_TEST_DB_REASON : false },
  async () => {
    const { token, user } = await registerTestUser();
    let listingId = null;
    try {
      const payload = baseListingPayload({ listingType: "urgent" });
      const { status, body } = await api("/api/listings", { method: "POST", token, body: payload });

      assert.equal(status, 201);
      listingId = body.data.id;

      assert.equal(
        body.data.is_urgent,
        true,
        "listing should NOT have been created with paid 'urgent' flag without payment, but it was"
      );
    } finally {
      if (listingId) await deleteTestListing(listingId);
      await deleteTestUser(user.id);
    }
  }
);

test(
  "Free promotion bypass: PUT /api/listings/:id lets owner self-grant promotionStatus=vip/isUrgent after creation, no payment",
  { skip: !isTestDbConfigured ? SKIP_NO_TEST_DB_REASON : false },
  async () => {
    const { token, user } = await registerTestUser();
    let listingId = null;
    try {
      // Создаём обычное (regular, неоплаченное) объявление
      const createRes = await api("/api/listings", { method: "POST", token, body: baseListingPayload() });
      assert.equal(createRes.status, 201);
      listingId = createRes.body.data.id;
      assert.equal(createRes.body.data.promotion_status, "regular");
      assert.equal(createRes.body.data.is_urgent, false);

      // Пытаемся сами себе выставить VIP + Срочно через PUT, без всякой оплаты
      const updateRes = await api(`/api/listings/${listingId}`, {
        method: "PUT",
        token,
        body: { promotionStatus: "vip", isUrgent: true },
      });

      assert.equal(updateRes.status, 200, `expected 200, got ${updateRes.status}: ${JSON.stringify(updateRes.body)}`);
      assert.equal(
        updateRes.body.data.promotion_status,
        "vip",
        "owner should NOT be able to self-grant promotion_status via PUT without payment/admin, but they can"
      );
      assert.equal(
        updateRes.body.data.is_urgent,
        true,
        "owner should NOT be able to self-grant is_urgent via PUT without payment/admin, but they can"
      );
    } finally {
      if (listingId) await deleteTestListing(listingId);
      await deleteTestUser(user.id);
    }
  }
);

test(
  "Moderation bypass: PUT /api/listings/:id lets owner set status away from 'moderation' to 'active' themselves",
  { skip: !isTestDbConfigured ? SKIP_NO_TEST_DB_REASON : false },
  async () => {
    const { token, user } = await registerTestUser();
    let listingId = null;
    try {
      const createRes = await api("/api/listings", { method: "POST", token, body: baseListingPayload() });
      assert.equal(createRes.status, 201);
      listingId = createRes.body.data.id;

      // Симулируем, что объявление отправлено на модерацию
      const toModeration = await api(`/api/listings/${listingId}`, {
        method: "PUT",
        token,
        body: { status: "moderation" },
      });
      assert.equal(toModeration.status, 200);
      assert.equal(toModeration.body.data.status, "moderation");

      const selfApprove = await api(`/api/listings/${listingId}`, {
        method: "PUT",
        token,
        body: { status: "active" },
      });
      assert.equal(selfApprove.status, 200);
      assert.equal(
        selfApprove.body.data.status,
        "active",
        "owner should NOT be able to move their own listing out of 'moderation' without admin approval, but they can"
      );
    } finally {
      if (listingId) await deleteTestListing(listingId);
      await deleteTestUser(user.id);
    }
  }
);
