import pg from "pg";

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
});

async function run() {
  await client.connect();

  console.log("=== 1. PUBLIC FUNCTIONS & SECURITY TYPE ===");
  const routinesRes = await client.query(`
    SELECT routine_name, routine_type, security_type
    FROM information_schema.routines
    WHERE specific_schema = 'public'
      AND routine_name NOT LIKE '%similarity%' 
      AND routine_name NOT LIKE '%trgm%'
    ORDER BY routine_name;
  `);
  for (const r of routinesRes.rows) {
    console.log(`- ${r.routine_name} (${r.routine_type}, security: ${r.security_type})`);
  }

  console.log("\n=== 2. FUNCTION PRIVILEGES (anon, authenticated, public) ===");
  const privsRes = await client.query(`
    SELECT 
      p.proname as function_name,
      pg_catalog.pg_get_function_identity_arguments(p.oid) as args,
      p.prosecdef as is_security_definer,
      r.rolname as grantee,
      has_function_privilege(r.oid, p.oid, 'EXECUTE') as has_execute
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN (
      SELECT oid, rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'public')
    ) r
    WHERE n.nspname = 'public' 
      AND p.proname NOT LIKE '%similarity%' 
      AND p.proname NOT LIKE '%trgm%'
    ORDER BY p.proname, r.rolname;
  `);
  console.table(privsRes.rows.filter(r => r.has_execute));

  console.log("\n=== 3. STORAGE BUCKETS ===");
  try {
    const bucketsRes = await client.query(`SELECT id, name, public, file_size_limit, allowed_mime_types FROM storage.buckets;`);
    console.table(bucketsRes.rows);
  } catch (e) {
    console.log("Error querying storage.buckets:", e.message);
  }

  console.log("\n=== 4. STORAGE POLICIES ===");
  try {
    const polRes = await client.query(`SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'storage';`);
    console.table(polRes.rows);
  } catch (e) {
    console.log("Error querying storage policies:", e.message);
  }

  console.log("\n=== 5. TABLES WITH RLS STATUS ===");
  const tablesRes = await client.query(`
    SELECT 
      schemaname,
      tablename,
      rowsecurity
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename;
  `);
  console.table(tablesRes.rows);
  console.log(`Total public tables: ${tablesRes.rows.length}`);

  await client.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
