import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  mapRowToRequest,
  formatRequestWithDetails,
  isValidUuid,
  createInstagramRequest,
} from "../src/utils/instagramRequests.js";
import * as adminController from "../src/controllers/adminController.js";
import adminRouter from "../src/routes/adminRoutes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("InstagramRequests: исходный код не содержит withWriteLock и обращений к instagram-requests.json в Storage", () => {
  const storeFilePath = path.resolve(__dirname, "../src/utils/instagramRequests.js");
  const content = fs.readFileSync(storeFilePath, "utf8");

  assert.equal(
    content.includes("withWriteLock"),
    false,
    "instagramRequests.js не должен содержать withWriteLock"
  );
  assert.equal(
    content.includes("instagram-requests.json"),
    false,
    "instagramRequests.js не должен содержать обращений к instagram-requests.json"
  );
  assert.equal(
    content.includes("APP_SETTINGS_BUCKET"),
    false,
    "instagramRequests.js не должен импортировать или использовать APP_SETTINGS_BUCKET"
  );
  assert.equal(
    content.includes("writeQueue"),
    false,
    "instagramRequests.js не должен содержать очереди промисов writeQueue"
  );
});

test("InstagramRequests: isValidUuid корректно проверяет UUID", () => {
  assert.equal(isValidUuid("c7a4e69b-891a-4c2e-9d22-1d5427976829"), true);
  assert.equal(isValidUuid("0e5b9f7a-8b1a-4d2c-9a1b-123456789abc"), true);
  assert.equal(isValidUuid("not-valid-uuid"), false);
  assert.equal(isValidUuid(""), false);
  assert.equal(isValidUuid(null), false);
  assert.equal(isValidUuid(undefined), false);
});

test("InstagramRequests: mapRowToRequest корректно преобразует snake_case БД в camelCase DTO", () => {
  const row = {
    id: "c7a4e69b-891a-4c2e-9d22-1d5427976829",
    listing_id: "0e5b9f7a-8b1a-4d2c-9a1b-123456789abc",
    user_id: "1f2e3d4c-5b6a-7890-abcd-ef0123456789",
    status: "pending",
    created_at: "2026-08-05T14:30:00.000Z",
    published_at: null,
    updated_at: "2026-08-05T14:30:00.000Z",
    published_by: null,
    notes: null,
  };

  const dto = mapRowToRequest(row);

  assert.equal(dto.id, "c7a4e69b-891a-4c2e-9d22-1d5427976829");
  assert.equal(dto.listingId, "0e5b9f7a-8b1a-4d2c-9a1b-123456789abc");
  assert.equal(dto.userId, "1f2e3d4c-5b6a-7890-abcd-ef0123456789");
  assert.equal(dto.status, "pending");
  assert.equal(dto.createdAt, "2026-08-05T14:30:00.000Z");
  assert.equal(dto.publishedAt, null);
  assert.equal(dto.updatedAt, "2026-08-05T14:30:00.000Z");
  assert.equal(dto.publishedBy, null);
  assert.equal(dto.notes, null);
});

test("InstagramRequests: formatRequestWithDetails корректно форматирует вложенные данные для админки", () => {
  const nestedRequest = {
    id: "c7a4e69b-891a-4c2e-9d22-1d5427976829",
    status: "pending",
    created_at: "2026-08-05T14:30:00.000Z",
    published_at: null,
    listing: {
      id: "0e5b9f7a-8b1a-4d2c-9a1b-123456789abc",
      title: "2-комнатная квартира в центре",
      price: 65000,
      currency: "USD",
      property_type: "apartment",
      deal_type: "sale",
      region: "Чуйская область",
      city: "Бишкек",
      district: "Первомайский",
      address: "ул. Токтогула, 125",
      rooms: 2,
      area: 60,
      promotion_status: "regular",
      is_urgent: true,
      listing_photos: [
        { url: "https://photos.com/2.jpg", is_main: false, display_order: 1 },
        { url: "https://photos.com/main.jpg", is_main: true, display_order: 0 },
      ],
    },
    user: {
      id: "1f2e3d4c-5b6a-7890-abcd-ef0123456789",
      email: "owner@example.com",
      phone: "+996555112233",
      user_profiles: [
        {
          first_name: "Азамат",
          last_name: "Бакиров",
          company_name: null,
        },
      ],
    },
  };

  const formatted = formatRequestWithDetails(nestedRequest);

  assert.equal(formatted.id, "c7a4e69b-891a-4c2e-9d22-1d5427976829");
  assert.equal(formatted.status, "pending");
  assert.equal(formatted.createdAt, "2026-08-05T14:30:00.000Z");
  assert.equal(formatted.publishedAt, null);

  assert.equal(formatted.listing.id, "0e5b9f7a-8b1a-4d2c-9a1b-123456789abc");
  assert.equal(formatted.listing.title, "2-комнатная квартира в центре");
  assert.equal(formatted.listing.image, "https://photos.com/main.jpg", "Главная фотография должна выбираться по is_main");
  assert.equal(formatted.listing.price, 65000);
  assert.equal(formatted.listing.currency, "USD");
  assert.equal(formatted.listing.propertyType, "apartment");
  assert.equal(formatted.listing.isUrgent, true);

  assert.equal(formatted.user.name, "Азамат Бакиров");
  assert.equal(formatted.user.phone, "+996555112233");
});

test("InstagramRequests: formatRequestWithDetails корректно обрабатывает удалённое объявление и пустой профиль", () => {
  const missingListingRequest = {
    id: "c7a4e69b-891a-4c2e-9d22-1d5427976829",
    status: "published",
    created_at: "2026-08-05T14:30:00.000Z",
    published_at: "2026-08-06T10:00:00.000Z",
    listing: null,
    user: {
      id: "1f2e3d4c-5b6a-7890-abcd-ef0123456789",
      email: "user@example.com",
      phone: null,
      user_profiles: [],
    },
  };

  const formatted = formatRequestWithDetails(missingListingRequest);

  assert.equal(formatted.listing, null);
  assert.equal(formatted.user.name, "user@example.com");
  assert.equal(formatted.user.phone, null);
  assert.equal(formatted.status, "published");
  assert.equal(formatted.publishedAt, "2026-08-06T10:00:00.000Z");
});

test("InstagramRequests: createInstagramRequest валидирует входные UUID", async () => {
  await assert.rejects(
    async () => {
      await createInstagramRequest({ listingId: "not-a-uuid", userId: "1f2e3d4c-5b6a-7890-abcd-ef0123456789" });
    },
    (err) => err.status === 400 && /Некорректный ID объявления/.test(err.message)
  );

  await assert.rejects(
    async () => {
      await createInstagramRequest({ listingId: "0e5b9f7a-8b1a-4d2c-9a1b-123456789abc", userId: "invalid" });
    },
    (err) => err.status === 400 && /Некорректный ID пользователя/.test(err.message)
  );
});

test("AdminController & Routes: контроллеры и роуты заявок Instagram зарегистрированы", () => {
  assert.equal(typeof adminController.listInstagramRequestsAdmin, "function");
  assert.equal(typeof adminController.completeInstagramRequestAdmin, "function");
  assert.equal(typeof adminController.createInstagramRequestAdmin, "function");
  assert.ok(adminRouter, "adminRouter должен быть экспортирован");
});

test("applyPromotion: при serviceType === 'instagram' создаёт запись в instagram_requests и переводит заказ в fulfillment_pending", async () => {
  const { applyPromotion } = await import("../src/services/promotionsService.js");
  const { supabase } = await import("../src/config/db.js");

  const origFrom = supabase.from;
  const insertedInstagram = [];
  const updatedOrders = [];

  supabase.from = (table) => {
    if (table === "listings") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                id: "0e5b9f7a-8b1a-4d2c-9a1b-123456789abc",
                status: "active",
                user_id: "1f2e3d4c-5b6a-4890-a1cd-ef0123456789",
              },
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === "instagram_requests") {
      return {
        insert: (payload) => {
          insertedInstagram.push(payload);
          return {
            select: () => ({
              single: async () => ({
                data: {
                  id: "c7a4e69b-891a-4c2e-9d22-1d5427976829",
                  listing_id: payload.listing_id,
                  user_id: payload.user_id,
                  status: "pending",
                  created_at: new Date().toISOString(),
                },
                error: null,
              }),
            }),
          };
        },
      };
    }
    if (table === "promotion_orders") {
      return {
        update: (updates) => {
          updatedOrders.push(updates);
          return {
            eq: () => ({
              select: () => {
                const res = async () => ({
                  data: {
                    order_id: "UT-TEST-ORDER-1",
                    status: updates.status,
                    applied_at: updates.applied_at,
                  },
                  error: null,
                });
                return { single: res, maybeSingle: res };
              },
            }),
          };
        },
      };
    }
    return origFrom.call(supabase, table);
  };

  try {
    await applyPromotion({
      orderId: "UT-TEST-ORDER-1",
      listingId: "0e5b9f7a-8b1a-4d2c-9a1b-123456789abc",
      userId: "1f2e3d4c-5b6a-4890-a1cd-ef0123456789",
      serviceType: "instagram",
      days: 1,
    });

    assert.equal(insertedInstagram.length, 1, "Должна быть создана одна запись в instagram_requests");
    assert.equal(insertedInstagram[0].listing_id, "0e5b9f7a-8b1a-4d2c-9a1b-123456789abc");
    assert.equal(insertedInstagram[0].user_id, "1f2e3d4c-5b6a-4890-a1cd-ef0123456789");
    assert.equal(insertedInstagram[0].status, "pending");

    assert.equal(updatedOrders.length, 1, "Статус заказа должен быть обновлен");
    assert.equal(updatedOrders[0].status, "fulfillment_pending");
  } finally {
    supabase.from = origFrom;
  }
});

test("applyPromotion: при повторном вызове (код 23505) не падает с ошибкой, а переводит заказ в fulfillment_pending", async () => {
  const { applyPromotion } = await import("../src/services/promotionsService.js");
  const { supabase } = await import("../src/config/db.js");

  const origFrom = supabase.from;
  const updatedOrders = [];

  supabase.from = (table) => {
    if (table === "listings") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                id: "0e5b9f7a-8b1a-4d2c-9a1b-123456789abc",
                status: "active",
                user_id: "1f2e3d4c-5b6a-4890-a1cd-ef0123456789",
              },
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === "instagram_requests") {
      return {
        insert: () => {
          return {
            select: () => ({
              single: async () => ({
                data: null,
                error: { code: "23505", message: "unique constraint violation" },
              }),
            }),
          };
        },
      };
    }
    if (table === "promotion_orders") {
      return {
        update: (updates) => {
          updatedOrders.push(updates);
          return {
            eq: () => ({
              select: () => {
                const res = async () => ({
                  data: {
                    order_id: "UT-TEST-ORDER-2",
                    status: updates.status,
                    applied_at: updates.applied_at,
                  },
                  error: null,
                });
                return { single: res, maybeSingle: res };
              },
            }),
          };
        },
      };
    }
    return origFrom.call(supabase, table);
  };

  try {
    await applyPromotion({
      orderId: "UT-TEST-ORDER-2",
      listingId: "0e5b9f7a-8b1a-4d2c-9a1b-123456789abc",
      userId: "1f2e3d4c-5b6a-4890-a1cd-ef0123456789",
      serviceType: "instagram",
      days: 1,
    });

    assert.equal(updatedOrders.length, 1);
    assert.equal(updatedOrders[0].status, "fulfillment_pending");
  } finally {
    supabase.from = origFrom;
  }
});

test("completeInstagramRequestAdmin: обновляет заявку в published и синхронизирует promotion_orders в applied", async () => {
  const { completeInstagramRequestAdmin } = await import("../src/controllers/adminController.js");
  const { supabase } = await import("../src/config/db.js");

  const origFrom = supabase.from;
  const updatedOrders = [];

  supabase.from = (table) => {
    if (table === "instagram_requests") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                id: "c7a4e69b-891a-4c2e-9d22-1d5427976829",
                listing_id: "0e5b9f7a-8b1a-4d2c-9a1b-123456789abc",
                user_id: "1f2e3d4c-5b6a-7890-abcd-ef0123456789",
                status: "pending",
                created_at: new Date().toISOString(),
              },
              error: null,
            }),
          }),
        }),
        update: (payload) => ({
          eq: () => ({
            select: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "c7a4e69b-891a-4c2e-9d22-1d5427976829",
                  listing_id: "0e5b9f7a-8b1a-4d2c-9a1b-123456789abc",
                  status: payload.status,
                  published_at: payload.published_at,
                  published_by: payload.published_by,
                },
                error: null,
              }),
            }),
          }),
        }),
      };
    }
    if (table === "promotion_orders") {
      return {
        update: (updates) => {
          updatedOrders.push(updates);
          return {
            eq: () => ({
              eq: () => ({
                eq: async () => ({ error: null }),
              }),
            }),
          };
        },
      };
    }
    return origFrom.call(supabase, table);
  };

  try {
    let responseStatus = 200;
    let responseBody = null;
    const req = {
      params: { id: "c7a4e69b-891a-4c2e-9d22-1d5427976829" },
      user: { id: "admin-user-uuid" },
    };
    const res = {
      status: (code) => {
        responseStatus = code;
        return res;
      },
      json: (data) => {
        responseBody = data;
        return res;
      },
    };

    await completeInstagramRequestAdmin(req, res);

    assert.equal(responseStatus, 200);
    assert.equal(responseBody.success, true);
    assert.equal(responseBody.data.status, "published");
    assert.equal(updatedOrders.length, 1, "Должен быть обновлен заказ promotion_orders");
    assert.equal(updatedOrders[0].status, "applied");
  } finally {
    supabase.from = origFrom;
  }
});


test("P1-06: createListing с listingType='instagram' создаёт черновик с needsPayment=true и НЕ создаёт бесплатную заявку в instagram_requests", async () => {
  const { createListing } = await import("../src/controllers/listingsController.js");
  const { supabase } = await import("../src/config/db.js");
  const origFrom = supabase.from;

  let instagramInsertCalled = false;
  let insertedListingStatus = null;

  supabase.from = (table) => {
    if (table === "listings") {
      return {
        select: () => ({
          eq: () => ({
            eq: async () => ({ count: 0, error: null }),
          }),
        }),
        insert: (rows) => {
          insertedListingStatus = rows[0]?.status;
          return {
            select: () => ({
              single: async () => ({
                data: {
                  id: "0e5b9f7a-8b1a-4d2c-9a1b-123456789abc",
                  ...rows[0],
                },
                error: null,
              }),
            }),
          };
        },
      };
    }
    if (table === "instagram_requests") {
      return {
        insert: () => {
          instagramInsertCalled = true;
          throw new Error("instagram_requests не должен создаваться бесплатно в createListing!");
        },
      };
    }
    return origFrom(table);
  };

  try {
    let statusCode = 200;
    let body = null;
    const req = {
      user: { id: "1f2e3d4c-5b6a-4890-a1cd-ef0123456789", account_type: "personal" },
      body: {
        title: "Тестовая квартира для Instagram",
        description: "Описание тестовой квартиры",
        propertyType: "apartment",
        dealType: "sale",
        region: "Бишкек",
        city: "Бишкек",
        price: 75000,
        currency: "USD",
        area: 65,
        rooms: 2,
        listingType: "instagram",
      },
    };
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        body = data;
        return this;
      },
    };

    await createListing(req, res);

    assert.equal(statusCode, 201);
    assert.equal(insertedListingStatus, "draft", "Объявление с listingType='instagram' обязано создаваться со статусом draft до оплаты");
    assert.equal(body.needsPayment, true, "needsPayment обязан быть true");
    assert.deepEqual(body.promotion, { serviceType: "instagram", days: 1 });
    assert.equal(instagramInsertCalled, false, "Бесплатная заявка в instagram_requests не должна создаваться при создании объявления");
  } finally {
    supabase.from = origFrom;
  }
});
