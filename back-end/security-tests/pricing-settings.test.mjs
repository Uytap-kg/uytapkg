import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_PRICING,
  normalizePricing,
  invalidatePricingCache,
  getPricingSettings,
  savePricingSettings,
} from "../src/utils/pricingSettings.js";
import { getTariff, calculateTariffTotal } from "../src/constants/tariffs.js";
import { pricingSchema } from "../src/utils/validation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("PricingSettings: исходный код не содержит обращений к pricing.json и Storage download/upload", () => {
  const filePath = path.resolve(__dirname, "../src/utils/pricingSettings.js");
  const content = fs.readFileSync(filePath, "utf8");

  assert.equal(
    content.includes("pricing.json"),
    false,
    "pricingSettings.js не должен содержать обращений к pricing.json"
  );
  assert.equal(
    content.includes(".download("),
    false,
    "pricingSettings.js не должен вызывать .download() из Storage"
  );
  assert.equal(
    content.includes(".upload("),
    false,
    "pricingSettings.js не должен вызывать .upload() в Storage"
  );
  assert.equal(
    content.includes("ensureBucket"),
    false,
    "pricingSettings.js не должен создавать Storage бакет ensureBucket"
  );
});

test("PricingSettings: normalizePricing приводит структуру к каноническому формату", () => {
  const normalized = normalizePricing(null);

  assert.deepEqual(normalized, DEFAULT_PRICING);
  assert.equal(normalized.tariffs.start.price, 390);
  assert.equal(normalized.tariffs.start.activeListings, 5);
  assert.equal(normalized.tariffs.optimal.price, 790);
  assert.equal(normalized.tariffs.business.price, 1890);
  assert.equal(normalized.tariffs.developer.mode, "individual");
  assert.equal(normalized.tariffs.developer.value, null);
  assert.equal(normalized.services.vip, 290);
  assert.equal(normalized.services.urgent, 70);
  assert.equal(normalized.services.top, 190);
  assert.equal(normalized.services.instagram, 390);
});

test("PricingSettings: валидация схемы pricingSchema корректно принимает канонический объект", () => {
  const result = pricingSchema.safeParse(DEFAULT_PRICING);
  assert.equal(result.success, true, "DEFAULT_PRICING должен быть валиден по pricingSchema");
});

test("PricingSettings: getTariff и calculateTariffTotal корректно работают с каноническим pricing", () => {
  const pricing = normalizePricing(DEFAULT_PRICING);

  const startTariff = getTariff("start", pricing);
  assert.ok(startTariff);
  assert.equal(startTariff.id, "start");
  assert.equal(startTariff.title, "СТАРТ");
  assert.equal(startTariff.price, 390);
  assert.equal(startTariff.activeListings, 5);

  // Расчёт стоимости за 1 месяц (скидка 0%)
  const total1m = calculateTariffTotal("start", 1, pricing);
  assert.equal(total1m.total, 390);
  assert.equal(total1m.discountPercent, 0);

  // Расчёт стоимости за 12 месяцев (скидка 35%)
  const total12m = calculateTariffTotal("start", 12, pricing);
  assert.equal(total12m.discountPercent, 35);
  const expectedMonthly = Math.round(390 * (1 - 0.35)); // 254
  assert.equal(total12m.total, expectedMonthly * 12);
});

test("PricingSettings: invalidatePricingCache сбрасывает кэш", () => {
  assert.equal(typeof invalidatePricingCache, "function");
  invalidatePricingCache();
});

test("PricingSettings: экспорт функций сохранения и чтения", () => {
  assert.equal(typeof getPricingSettings, "function");
  assert.equal(typeof savePricingSettings, "function");
});
