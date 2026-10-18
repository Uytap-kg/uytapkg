import { test } from "node:test";
import assert from "node:assert/strict";

const POSTGREST_URL = process.env.TEST_SUPABASE_URL || "http://127.0.0.1:54321";
const ANON_KEY =
  process.env.TEST_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

test("Supabase PostgREST RLS Audit: Anonymous client cannot read sensitive tables directly", async () => {
  const sensitiveTables = [
    "users",
    "user_profiles",
    "payments",
    "email_verifications",
    "upload_ownership",
    "listings",
  ];

  for (const table of sensitiveTables) {
    const res = await fetch(`${POSTGREST_URL}/rest/v1/${table}?select=*`, {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
      },
    });

    assert.ok(
      [200, 401, 403, 404].includes(res.status),
      `Unexpected status ${res.status} for table ${table}`
    );

    if (res.status === 200) {
      const data = await res.json();
      assert.equal(
        Array.isArray(data) && data.length === 0,
        true,
        `RLS VIOLATION: PostgREST leaked ${data.length} records from table '${table}' to anonymous client!`
      );
    }
  }
});

test("Supabase PostgREST RLS Audit: Anonymous client cannot insert or mutate database records directly", async () => {
  const res = await fetch(`${POSTGREST_URL}/rest/v1/users`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      email: "hacker-direct-insert@example.com",
      phone: "+996555000000",
      account_type: "personal",
    }),
  });

  // PostgREST должен отклонить запрос с ошибкой RLS (401/403/42501)
  assert.ok(
    [401, 403].includes(res.status),
    `Direct INSERT into users must be rejected by RLS (got HTTP ${res.status})`
  );

  const body = await res.json();
  assert.match(
    body.message || body.error || "",
    /row-level security|violates/i,
    "Expected row-level security error message"
  );
});

test("Supabase PostgREST RPC Audit: Anonymous client cannot execute sensitive RPC functions directly", async () => {
  const sensitiveRpcs = [
    { name: "register_user", payload: {} },
    { name: "activate_subscription_atomic", payload: {} },
    { name: "reclaim_unverified_user", payload: {} },
    { name: "refund_tariff_boost_atomic", payload: {} },
    { name: "refund_tariff_listing_atomic", payload: {} },
    { name: "create_promotion_payment", payload: {} },
    { name: "consume_otp_attempt", payload: {} },
    { name: "create_listing_with_limit", payload: {} },
  ];

  for (const rpc of sensitiveRpcs) {
    const res = await fetch(`${POSTGREST_URL}/rest/v1/rpc/${rpc.name}`, {
      method: "POST",
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(rpc.payload),
    });

    // Должна быть ошибка авторизации / запрет выполнения (401, 403, 404) или permission denied
    assert.ok(
      [401, 403, 404].includes(res.status),
      `RPC '${rpc.name}' must NOT be executable by anon role (got HTTP ${res.status})`
    );

    const body = await res.json().catch(() => ({}));
    const message = body.message || body.hint || body.details || "";
    if (res.status === 403 || res.status === 401) {
      assert.match(
        message,
        /permission denied|privilege|forbidden/i,
        `Expected permission denied message for RPC '${rpc.name}'`
      );
    }
  }
});

test("Supabase Storage Audit: Anonymous client cannot list objects or delete files directly", async () => {
  const SERVICE_KEY =
    process.env.SUPABASE_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

  const canaryPath = `audit-storage-canary-${Date.now()}.txt`;

  // 1. Создаём проверочный объект с сервисными правами
  const uploadRes = await fetch(`${POSTGREST_URL}/storage/v1/object/avatars/${canaryPath}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "text/plain",
    },
    body: "sensitive-canary-content",
  });
  assert.ok([200, 201].includes(uploadRes.status), "Canary file should be uploaded by service_role");

  try {
    // 2. Анонимный клиент пытается получить список файлов в бакете avatars
    const listRes = await fetch(`${POSTGREST_URL}/storage/v1/object/list/avatars`, {
      method: "POST",
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefix: "", search: canaryPath }),
    });

    if (listRes.status === 200) {
      const listData = await listRes.json();
      assert.equal(
        Array.isArray(listData) && listData.length === 0,
        true,
        `STORAGE LEAK: Anonymous client can list files! Found ${listData.length} files.`
      );
    } else {
      assert.ok([401, 403].includes(listRes.status));
    }

    // 3. Анонимный клиент пытается удалить проверочный файл
    const deleteRes = await fetch(`${POSTGREST_URL}/storage/v1/object/avatars`, {
      method: "DELETE",
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefixes: [canaryPath] }),
    });

    if (deleteRes.status === 200) {
      const deletedItems = await deleteRes.json();
      assert.equal(
        Array.isArray(deletedItems) && deletedItems.length === 0,
        true,
        "STORAGE VIOLATION: Anonymous client deleted file from storage!"
      );
    } else {
      assert.ok([401, 403].includes(deleteRes.status));
    }

    // 4. Проверяем, что файл действительно остался в хранилище (не удалён анонимом)
    const checkRes = await fetch(`${POSTGREST_URL}/storage/v1/object/list/avatars`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefix: "", search: canaryPath }),
    });
    const checkData = await checkRes.json();
    assert.ok(
      Array.isArray(checkData) && checkData.some((f) => f.name === canaryPath),
      "Canary file must still exist in storage because anon has no delete privileges"
    );
  } finally {
    // 5. Очищаем проверочный файл сервисным ключом
    await fetch(`${POSTGREST_URL}/storage/v1/object/avatars`, {
      method: "DELETE",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefixes: [canaryPath] }),
    });
  }
});

