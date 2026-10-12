import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  mapRowToBanner,
  isValidUuid,
  incrementBannerStat,
} from "../src/utils/bannersStore.js";
import bannersRouter from "../src/routes/bannersRoutes.js";
import * as bannersController from "../src/controllers/bannersController.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("BannersStore: исходный код не содержит withWriteLock и обращений к banners.json в Storage", () => {
  const storeFilePath = path.resolve(__dirname, "../src/utils/bannersStore.js");
  const content = fs.readFileSync(storeFilePath, "utf8");

  assert.equal(
    content.includes("withWriteLock"),
    false,
    "bannersStore.js не должен содержать withWriteLock"
  );
  assert.equal(
    content.includes("banners.json"),
    false,
    "bannersStore.js не должен содержать обращений к banners.json"
  );
  assert.equal(
    content.includes("APP_SETTINGS_BUCKET"),
    false,
    "bannersStore.js не должен импортировать или использовать APP_SETTINGS_BUCKET"
  );
  assert.equal(
    content.includes("writeQueue"),
    false,
    "bannersStore.js не должен содержать очереди промисов writeQueue"
  );
});

test("BannersStore: isValidUuid корректно валидирует UUID v4", () => {
  assert.equal(isValidUuid("79998188-662d-419b-ab38-028fef65163f"), true);
  assert.equal(isValidUuid("e42e47e8-4663-4b62-bb4e-7b7501a3cf88"), true);
  assert.equal(isValidUuid("not-a-uuid"), false);
  assert.equal(isValidUuid(""), false);
  assert.equal(isValidUuid(null), false);
  assert.equal(isValidUuid(undefined), false);
  assert.equal(isValidUuid(123), false);
});

test("BannersStore: mapRowToBanner корректно преобразует snake_case БД в camelCase DTO", () => {
  const row = {
    id: "79998188-662d-419b-ab38-028fef65163f",
    title: "Тестовый баннер",
    image_url: "https://supabase.co/storage/v1/object/public/banners/test.webp",
    image_position_x: 75,
    image_position_y: 25,
    link_url: "https://example.com/promo",
    start_date: "2026-09-01",
    end_date: "2026-10-31",
    is_active: true,
    views_count: 142,
    clicks_count: 18,
    created_at: "2026-09-01T10:00:00.000Z",
    updated_at: "2026-09-15T12:00:00.000Z",
  };

  const banner = mapRowToBanner(row);

  assert.equal(banner.id, "79998188-662d-419b-ab38-028fef65163f");
  assert.equal(banner.title, "Тестовый баннер");
  assert.equal(banner.imageUrl, "https://supabase.co/storage/v1/object/public/banners/test.webp");
  assert.equal(banner.imagePositionX, 75);
  assert.equal(banner.imagePositionY, 25);
  assert.equal(banner.link, "https://example.com/promo");
  assert.equal(banner.startDate, "2026-09-01");
  assert.equal(banner.endDate, "2026-10-31");
  assert.equal(banner.active, true);
  assert.equal(banner.viewsCount, 142);
  assert.equal(banner.clicksCount, 18);
  assert.equal(banner.createdAt, "2026-09-01T10:00:00.000Z");
  assert.equal(banner.updatedAt, "2026-09-15T12:00:00.000Z");
});

test("BannersStore: mapRowToBanner подставляет дефолтные значения из миграции для пустых/старых колонок", () => {
  const partialRow = {
    id: "79998188-662d-419b-ab38-028fef65163f",
    title: "Старый баннер без новых полей",
    image_url: "https://example.com/old.jpg",
    link_url: null,
    is_active: null,
    views_count: null,
    clicks_count: null,
    created_at: null,
    updated_at: null,
    image_position_x: null,
    image_position_y: null,
    start_date: null,
    end_date: null,
  };

  const banner = mapRowToBanner(partialRow);

  assert.equal(banner.imagePositionX, 50, "Дефолт image_position_x должен быть 50");
  assert.equal(banner.imagePositionY, 50, "Дефолт image_position_y должен быть 50");
  assert.equal(banner.active, true, "Дефолт is_active должен быть true");
  assert.equal(banner.viewsCount, 0, "Дефолт views_count должен быть 0");
  assert.equal(banner.clicksCount, 0, "Дефолт clicks_count должен быть 0");
  assert.equal(banner.link, null);
  assert.equal(banner.endDate, null);
  assert.ok(typeof banner.startDate === "string" && banner.startDate.length === 10);
  assert.ok(typeof banner.createdAt === "string");
  assert.ok(typeof banner.updatedAt === "string");
});

test("BannersStore: mapRowToBanner возвращает null для пустого входа", () => {
  assert.equal(mapRowToBanner(null), null);
  assert.equal(mapRowToBanner(undefined), null);
});

test("BannersStore: incrementBannerStat валидирует входные параметры перед обращением к RPC", async () => {
  await assert.rejects(
    async () => {
      await incrementBannerStat("not-a-uuid", "view");
    },
    /Некорректный ID баннера/
  );

  await assert.rejects(
    async () => {
      await incrementBannerStat(null, "view");
    },
    /Некорректный ID баннера/
  );

  await assert.rejects(
    async () => {
      await incrementBannerStat("79998188-662d-419b-ab38-028fef65163f", "invalid_metric");
    },
    /Недопустимый тип метрики/
  );
});

test("BannersController & Routes: экспорты и роуты зарегистрированы корректно", () => {
  assert.equal(typeof bannersController.getPublicBanners, "function");
  assert.equal(typeof bannersController.getAdminBanners, "function");
  assert.equal(typeof bannersController.uploadBannerImage, "function");
  assert.equal(typeof bannersController.createBanner, "function");
  assert.equal(typeof bannersController.updateBanner, "function");
  assert.equal(typeof bannersController.toggleBanner, "function");
  assert.equal(typeof bannersController.deleteBanner, "function");
  assert.equal(typeof bannersController.trackBannerView, "function");
  assert.equal(typeof bannersController.trackBannerClick, "function");

  assert.ok(bannersRouter, "bannersRouter должен быть экспортирован");
});
