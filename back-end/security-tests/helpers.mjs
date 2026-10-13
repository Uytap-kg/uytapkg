// Общие утилиты для security-тестов (PoC эксплойтов).
// ИЗОЛЯЦИЯ ОТ БОЕВОЙ БД: Ни один тест не имеет права ходить в боевой Supabase.
// Для запуска интеграционных тестов требуются переменные окружения:
// TEST_SUPABASE_URL и TEST_SUPABASE_KEY (только локальный инстанс http://127.0.0.1 или localhost).
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

export const BASE_URL = process.env.SECURITY_TEST_BASE_URL || "http://localhost:5000";

export const isTestDbConfigured = Boolean(
  process.env.TEST_SUPABASE_URL && process.env.TEST_SUPABASE_KEY
);

export const SKIP_NO_TEST_DB_REASON =
  "Не заданы TEST_SUPABASE_URL и TEST_SUPABASE_KEY (интеграционный тест изолирован от боевой базы данных)";

/**
 * Валидация безопасности тестового окружения.
 * Защищает от случайного указания боевого Supabase в TEST_SUPABASE_URL.
 */
export function checkTestDatabaseSafety() {
  const testUrl = process.env.TEST_SUPABASE_URL;
  const prodUrl = process.env.SUPABASE_URL;

  if (!testUrl) return;

  const isLocal =
    testUrl.includes("127.0.0.1") ||
    testUrl.includes("localhost") ||
    testUrl.startsWith("http://local");

  if (!isLocal) {
    if ((prodUrl && testUrl === prodUrl) || testUrl.includes(".supabase.co")) {
      throw new Error(
        "КРИТИЧЕСКАЯ ОШИБКА БЕЗОПАСНОСТИ: отказ запускать тесты против боевой БД! TEST_SUPABASE_URL указывает на облачный домен Supabase (*.supabase.co). Разрешены только локальные адреса (http://127.0.0.1 или localhost)."
      );
    }
  }
}

function initTestSupabaseClient() {
  if (!isTestDbConfigured) {
    return null;
  }
  checkTestDatabaseSafety();
  return createClient(
    process.env.TEST_SUPABASE_URL,
    process.env.TEST_SUPABASE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

export const supabaseAdmin = initTestSupabaseClient();

const LOG_PATH = path.join(__dirname, "SECURITY_LOG.md");

export function logDbOp(entry) {
  try {
    const line = `- ${new Date().toISOString()} ${entry}\n`;
    fs.appendFileSync(LOG_PATH, line, "utf-8");
  } catch (e) {
    // Безопасное игнорирование при отсутствии доступа к файлу
  }
}

export async function api(pathname, { method = "GET", token, body, headers = {}, isForm = false } = {}) {
  const finalHeaders = { ...headers };
  if (token) finalHeaders["Authorization"] = `Bearer ${token}`;
  let finalBody = body;
  if (body && !isForm) {
    finalHeaders["Content-Type"] = "application/json";
    finalBody = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers: finalHeaders,
    body: finalBody,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // не JSON ответ
  }
  return { status: res.status, body: json, res };
}

function randSuffix() {
  return crypto.randomBytes(4).toString("hex");
}

/**
 * Регистрирует нового тестового пользователя через публичный API.
 */
export async function registerTestUser({ accountType = "personal", prefix = "sectest" } = {}) {
  const suffix = randSuffix();
  const email = `${prefix}-${suffix}@example-security-test.local`;
  const phone = `05${Math.floor(100000000 + Math.random() * 899999999)}`.slice(0, 9);
  const password = "TestPass123!";

  const payload = {
    accountType,
    email,
    phone,
    password,
    firstName: "SecTest",
    lastName: "User",
  };

  if (accountType === "developer") {
    payload.companyName = "SecTest Dev Co";
    payload.inn = "00000000000000";
    payload.officeAddress = "Test Address";
  }

  const { status, body } = await api("/api/auth/register", { method: "POST", body: payload });

  if (status !== 201 || !body?.success) {
    throw new Error(`Failed to register test user: ${status} ${JSON.stringify(body)}`);
  }

  logDbOp(`CREATE users id=${body.user?.id} email=${email} (test account, accountType=${accountType})`);

  return { token: body.token, user: body.user, email, phone, password };
}

/** 
 * Удаляет тестового пользователя (и связанные строки) через тестовый Supabase.
 */
export async function deleteTestUser(userId) {
  if (!userId || !supabaseAdmin) return;

  const { data: listings } = await supabaseAdmin
    .from("listings")
    .select("id")
    .eq("user_id", userId);

  const listingIds = (listings || []).map((l) => l.id);

  if (listingIds.length > 0) {
    await supabaseAdmin.from("listing_photos").delete().in("listing_id", listingIds);
    await supabaseAdmin.from("favorites").delete().in("listing_id", listingIds);
    await supabaseAdmin.from("listings").delete().in("id", listingIds);
    logDbOp(`DELETE listings ids=${listingIds.join(",")} (cleanup, owner ${userId})`);
  }

  await supabaseAdmin.from("favorites").delete().eq("user_id", userId);
  await supabaseAdmin.from("payments").delete().eq("user_id", userId);
  await supabaseAdmin.from("user_profiles").delete().eq("user_id", userId);
  await supabaseAdmin.from("developers").delete().eq("user_id", userId);
  await supabaseAdmin.from("users").delete().eq("id", userId);

  logDbOp(`DELETE users id=${userId} (cleanup)`);
}

/** 
 * Удаляет отдельное объявление по id через тестовый Supabase.
 */
export async function deleteTestListing(listingId) {
  if (!listingId || !supabaseAdmin) return;
  await supabaseAdmin.from("listing_photos").delete().eq("listing_id", listingId);
  await supabaseAdmin.from("favorites").delete().eq("listing_id", listingId);
  await supabaseAdmin.from("listings").delete().eq("id", listingId);
  logDbOp(`DELETE listings id=${listingId} (cleanup)`);
}

export function baseListingPayload(overrides = {}) {
  return {
    title: "Security test listing " + randSuffix(),
    description: "PoC listing created by automated security test, will be deleted.",
    propertyType: "apartment",
    dealType: "sale",
    region: "Бишкек",
    city: "Бишкек",
    price: 100000,
    currency: "KGS",
    area: 50,
    rooms: 2,
    ...overrides,
  };
}
