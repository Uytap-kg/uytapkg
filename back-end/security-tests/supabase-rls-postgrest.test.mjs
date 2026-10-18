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
