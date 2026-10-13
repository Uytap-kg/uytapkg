import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import pg from "pg";
const { Pool } = pg;

import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config();

if (!process.env.SUPABASE_URL) {
  console.error("❌ CRITICAL ERROR: SUPABASE_URL environment variable is missing!");
  throw new Error("SUPABASE_URL environment variable is not defined in .env");
}

if (!process.env.SUPABASE_KEY) {
  console.error("❌ CRITICAL ERROR: SUPABASE_KEY environment variable is missing!");
  throw new Error("SUPABASE_KEY environment variable is not defined in .env");
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

// Пул TCP-соединений через pg (Дефект 2.2)
export let dbPool = null;

if (process.env.DATABASE_URL) {
  try {
    dbPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    dbPool.on("error", (err) => {
      console.error("Unexpected error on idle pg client in dbPool:", err);
    });
  } catch (poolErr) {
    console.warn("⚠️ Failed to initialize dbPool with DATABASE_URL, fallback to null:", poolErr.message);
    dbPool = null;
  }
} else {
  // Graceful degradation: если DATABASE_URL отсутствует в переменных окружения,
  // dbPool равен null, чтобы тесты и окружения без прямого доступа к 5432 порту
  // продолжали работать через @supabase/supabase-js.
  dbPool = null;
}

export function setDbPool(pool) {
  dbPool = pool;
}

export async function queryPool(text, params) {
  if (!dbPool) {
    throw new Error("DATABASE_URL is not configured; dbPool is unavailable");
  }
  return dbPool.query(text, params);
}
