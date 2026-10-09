import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

test("Item 11: Миграция 011_p2_slots_and_rpc.sql и schema.sql содержат create_listing_with_limit", () => {
  const migrationPath = path.join(rootDir, "src", "migrations", "011_p2_slots_and_rpc.sql");
  const schemaPath = path.join(rootDir, "src", "schema.sql");

  assert.ok(fs.existsSync(migrationPath), "Файл 011_p2_slots_and_rpc.sql должен существовать");
  assert.ok(fs.existsSync(schemaPath), "Файл schema.sql должен существовать");

  const migrationSql = fs.readFileSync(migrationPath, "utf-8");
  const schemaSql = fs.readFileSync(schemaPath, "utf-8");

  // Проверка обязательных компонентов RPC create_listing_with_limit
  assert.ok(migrationSql.includes("FUNCTION create_listing_with_limit"), "Миграция должна объявлять create_listing_with_limit");
  assert.ok(migrationSql.includes("pg_advisory_xact_lock(hashtext(p_user_id::text))"), "Миграция должна использовать advisory lock на p_user_id");
  assert.ok(migrationSql.includes("LIMIT_EXCEEDED"), "Миграция должна выбрасывать исключение LIMIT_EXCEEDED");
  assert.ok(migrationSql.includes("status = 'active'"), "Миграция должна проверять статус active");
  assert.ok(migrationSql.includes("expires_at > CURRENT_TIMESTAMP"), "Миграция должна проверять неистёкшие объявления");

  assert.ok(schemaSql.includes("FUNCTION create_listing_with_limit"), "schema.sql должен содержать create_listing_with_limit");
  assert.ok(schemaSql.includes("pg_advisory_xact_lock"), "schema.sql должен содержать pg_advisory_xact_lock");
});

test("Item 11: listingsController.js вызывает create_listing_with_limit и не содержит постпроверку с откатом в createListing", () => {
  const controllerPath = path.join(rootDir, "src", "controllers", "listingsController.js");
  const controllerCode = fs.readFileSync(controllerPath, "utf-8");

  assert.ok(controllerCode.includes('create_listing_with_limit'), "listingsController должен вызывать create_listing_with_limit");
  assert.ok(controllerCode.includes('LIMIT_EXCEEDED'), "listingsController должен обрабатывать LIMIT_EXCEEDED");
  
  // Проверяем, что в createListing убран ненадежный откат с delete().eq("id", newListing.id)
  const createListingFunc = controllerCode.slice(
    controllerCode.indexOf("export const createListing ="),
    controllerCode.indexOf("export const getListingById =") > 0 
      ? controllerCode.indexOf("export const updateListing =") 
      : controllerCode.length
  );

  assert.ok(
    !createListingFunc.includes("Create Listing: active listings limit race detected, rolling back"),
    "createListing не должен содержать старый блок 'постпроверки с откатом'"
  );
});

test("Item 12: Атомарные запросы GREATEST и идемпотентность возвратов (operationId)", () => {
  const servicePath = path.join(rootDir, "src", "services", "subscriptionsService.js");
  const serviceCode = fs.readFileSync(servicePath, "utf-8");
  const migrationPath = path.join(rootDir, "src", "migrations", "011_p2_slots_and_rpc.sql");
  const migrationSql = fs.readFileSync(migrationPath, "utf-8");

  // Проверка миграции
  assert.ok(migrationSql.includes("processed_refund_operations"), "Миграция должна создавать таблицу processed_refund_operations");
  assert.ok(migrationSql.includes("refund_tariff_listing_atomic"), "Миграция должна содержать RPC refund_tariff_listing_atomic");
  assert.ok(migrationSql.includes("refund_tariff_boost_atomic"), "Миграция должна содержать RPC refund_tariff_boost_atomic");
  assert.ok(migrationSql.includes("GREATEST(listings_used - 1, 0)"), "Миграция должна использовать GREATEST для listings_used");
  assert.ok(migrationSql.includes("GREATEST(vip_boosts_used - 1, 0)"), "Миграция должна использовать GREATEST для vip_boosts_used");
  assert.ok(migrationSql.includes("GREATEST(top_boosts_used - 1, 0)"), "Миграция должна использовать GREATEST для top_boosts_used");

  // Проверка subscriptionsService.js
  assert.ok(serviceCode.includes("export async function refundTariffBoost(userId, boostType, operationId = null)"), "refundTariffBoost должен принимать operationId");
  assert.ok(serviceCode.includes("export async function refundTariffListing(userId, operationId = null)"), "refundTariffListing должен принимать operationId");
  assert.ok(serviceCode.includes("refund_tariff_listing_atomic"), "subscriptionsService должен вызывать refund_tariff_listing_atomic");
  assert.ok(serviceCode.includes("refund_tariff_boost_atomic"), "subscriptionsService должен вызывать refund_tariff_boost_atomic");
});

test("Item 13: consumeTariffListing устраняет fail-open при ошибках БД", async () => {
  const servicePath = path.join(rootDir, "src", "services", "subscriptionsService.js");
  const serviceCode = fs.readFileSync(servicePath, "utf-8");

  // Проверка кода на отсутствие безусловного granted: true при ошибках
  assert.ok(!serviceCode.includes('// Если колонка ещё не создана в БД, не блокируем создание аварийно\n    return { hasSubscription: true, granted: true'), "Безусловный fail-open должен быть удалён");
  assert.ok(serviceCode.includes('reason: "db_error"'), "При ошибках БД должен возвращаться reason: 'db_error'");
  assert.ok(serviceCode.includes('isMissingColumn && isDev'), "Fallback разрешён только при отсутствии колонки и только в dev окружении");
});
