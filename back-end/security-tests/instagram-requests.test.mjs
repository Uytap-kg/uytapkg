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
