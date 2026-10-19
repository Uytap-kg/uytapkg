import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Locate migrations directory across mono-repo structures
function findMigrationsDir() {
  const candidates = [
    path.resolve(__dirname, "../../supabase/migrations"),
    path.resolve(__dirname, "../supabase/migrations"),
    path.resolve(__dirname, "../migrations"),
    path.resolve(process.cwd(), "supabase/migrations"),
    path.resolve(process.cwd(), "../supabase/migrations"),
  ];

  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      return dir;
    }
  }

  throw new Error(
    `Could not find migrations directory. Checked locations:\n${candidates.join("\n")}`
  );
}

async function run() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("❌ ERROR: DATABASE_URL environment variable is not defined.");
    process.exit(1);
  }

  const migrationsDir = findMigrationsDir();
  console.log(`📁 Using migrations directory: ${migrationsDir}`);

  const useSsl =
    databaseUrl.includes("render.com") ||
    databaseUrl.includes("supabase.co") ||
    process.env.DB_SSL === "true" ||
    process.env.NODE_ENV === "production";

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();
    console.log(" Connected to PostgreSQL database.");

    // 1. Ensure required roles and extensions exist for standalone PostgreSQL (Render PG)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          CREATE ROLE anon NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          CREATE ROLE authenticated NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
          CREATE ROLE service_role NOLOGIN;
        END IF;
      END $$;
      CREATE EXTENSION IF NOT EXISTS pg_trgm;
    `);

    // 2. Ensure schema migrations tracking table exists in public schema
    await client.query(`
      CREATE TABLE IF NOT EXISTS public._schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Read already applied migrations
    const res = await client.query("SELECT version FROM public._schema_migrations ORDER BY version ASC;");
    const appliedVersions = new Set(res.rows.map((r) => r.version));

    // 4. Find all sql migration files sorted alphabetically
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const pending = files.filter((f) => !appliedVersions.has(f));

    if (pending.length === 0) {
      console.log(`✅ Schema is up to date. (${appliedVersions.size} migrations already applied)`);
      await client.end();
      process.exit(0);
    }

    console.log(`Found ${pending.length} pending migrations to apply.`);

    for (const file of pending) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, "utf-8");

      console.log(` Applying migration: ${file}...`);
      const startTime = Date.now();

      await client.query("BEGIN;");
      try {
        await client.query(sql);
        // Reset search_path so public schema is always searchable
        await client.query("SET search_path TO public, \"$user\";");
        await client.query(
          "INSERT INTO public._schema_migrations (version, applied_at) VALUES ($1, CURRENT_TIMESTAMP);",
          [file]
        );
        await client.query("COMMIT;");
        console.log(` Applied ${file} in ${Date.now() - startTime}ms.`);
      } catch (migrationErr) {
        await client.query("ROLLBACK;");
        console.error(`❌ Migration failed in ${file}:`, migrationErr.message);
        throw migrationErr;
      }
    }

    console.log(`🎉 Successfully applied all ${pending.length} pending migrations.`);
    await client.end();
    process.exit(0);
  } catch (err) {
    console.error("❌ Fatal migration error:", err.message);
    try {
      await client.end();
    } catch {
      // ignore
    }
    process.exit(1);
  }
}

run();
