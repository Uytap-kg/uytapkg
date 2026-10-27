import fs from "node:fs";
import crypto from "node:crypto";
import { supabase, dbPool } from "../config/db.js";
import { setBoundedMap, evictExpiredAndCapMap } from "./boundedMap.js";

const PROCESS_HOLDER_ID = `${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
const MAX_LOCAL_RATE_COUNTERS = 20000;
const localCounters = new Map();

/**
 * Проверка, доступен ли реальный (или явно замоканный под RPC) клиент БД для общих счётчиков.
 * Если SUPABASE_URL указывает на dummy.supabase.co в модульных тестах и supabase.rpc не переопределён,
 * используем быстрый fallback, чтобы не делать сетевых таймаутов в офлайн-тестах.
 */
const initialSupabaseRpc = supabase?.rpc;
const initialGlobalFetch = globalThis.fetch;
function isLiveOrMockedRpcAvailable() {
  if (!supabase || typeof supabase.rpc !== "function") return false;
  if (supabase.rpc !== initialSupabaseRpc) return true;
  if (process.env.ENABLE_DB_SHARED_STATE_IN_TESTS === "true") return true;
  const url = process.env.SUPABASE_URL || "";
  if (!url || url.includes("dummy.supabase.co")) return false;
  // Если запущен встроенный раннер node --test (NODE_TEST_CONTEXT) или подменён globalThis.fetch
  if (
    process.env.NODE_TEST_CONTEXT ||
    process.env.NODE_ENV === "test" ||
    globalThis.fetch !== initialGlobalFetch ||
    process.execArgv.includes("--test") ||
    process.argv.includes("--test")
  ) {
    return false;
  }
  return true;
}

/**
 * Опциональное файловое общее хранилище для локального многопроцессного тестирования
 * (когда запущено 2+ процесса Node.js на одной машине с SHARED_STATE_FILE без внешнего Redis/Supabase).
 */
function withSharedFileState(mutatorFn) {
  const filePath = process.env.SHARED_STATE_FILE;
  if (!filePath) return null;
  const lockPath = `${filePath}.lock`;
  let fd = null;

  for (let i = 0; i < 60; i++) {
    try {
      fd = fs.openSync(lockPath, "wx");
      break;
    } catch {
      // Короткая пауза ожидания снятия блокировки соседним процессом
      const start = Date.now();
      while (Date.now() - start < 2) {
        // spin 2ms
      }
    }
  }

  try {
    let state = { counters: {}, otpSessions: {}, cronLeases: {} };
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, "utf8");
        if (raw.trim()) {
          state = JSON.parse(raw);
          state.counters = state.counters || {};
          state.otpSessions = state.otpSessions || {};
          state.cronLeases = state.cronLeases || {};
        }
      } catch {
        // ignore parse errors on transient read
      }
    }

    const result = mutatorFn(state);
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(state), "utf8");
    try {
      fs.renameSync(tmpPath, filePath);
    } catch {
      fs.writeFileSync(filePath, JSON.stringify(state), "utf8");
      try {
        fs.unlinkSync(tmpPath);
      } catch {}
    }
    return result;
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {}
      try {
        fs.unlinkSync(lockPath);
      } catch {}
    }
  }
}

/**
 * Локальная (bounded in-memory) проверка и инкремент счётчика с верхним пределом размера Map.
 */
export function checkAndIncrementLocalCounter(key, windowMs, maxCount, increment = 1, now = Date.now()) {
  const safeWindow = Math.max(1000, Number(windowMs) || 60000);
  const safeMax = Math.max(1, Number(maxCount) || 1);
  const inc = Number.isFinite(increment) ? Math.floor(increment) : 1;

  const existing = localCounters.get(key);
  if (inc <= 0) {
    if (!existing || existing.resetAt <= now) {
      return {
        allowed: true,
        count: 0,
        retryAfterSec: 0,
        resetAt: new Date(now + safeWindow),
      };
    }
    const allowed = existing.count < safeMax;
    return {
      allowed,
      count: existing.count,
      retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      resetAt: new Date(existing.resetAt),
    };
  }

  let entry = existing;
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + safeWindow };
  }

  if (entry.count + inc > safeMax) {
    setBoundedMap(localCounters, key, entry, MAX_LOCAL_RATE_COUNTERS, (m) =>
      evictExpiredAndCapMap(m, MAX_LOCAL_RATE_COUNTERS, (v) => v.resetAt <= now)
    );
    return {
      allowed: false,
      count: entry.count,
      retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
      resetAt: new Date(entry.resetAt),
    };
  }

  entry.count += inc;
  setBoundedMap(localCounters, key, entry, MAX_LOCAL_RATE_COUNTERS, (m) =>
    evictExpiredAndCapMap(m, MAX_LOCAL_RATE_COUNTERS, (v) => v.resetAt <= now)
  );

  return {
    allowed: true,
    count: entry.count,
    retryAfterSec: 0,
    resetAt: new Date(entry.resetAt),
  };
}

/**
 * Межпроцессная атомарная проверка и инкремент счётчика лимита или суточной квоты.
 * Использует PostgreSQL RPC `check_and_increment_rate_limit` (или SHARED_STATE_FILE в локальных тестах),
 * с безопасным fallback на ограниченное in-memory хранилище.
 */
export async function checkAndIncrementRateLimit(key, windowMs, maxCount, increment = 1) {
  const safeWindow = Math.max(1000, Number(windowMs) || 60000);
  const safeMax = Math.max(1, Number(maxCount) || 1);
  const inc = Number.isFinite(increment) ? Math.floor(increment) : 1;
  const now = Date.now();

  // 1. Локальное многопроцессное файловое состояние (для интеграционных тестов 2+ процессов)
  if (process.env.SHARED_STATE_FILE) {
    const fileRes = withSharedFileState((state) => {
      const existing = state.counters[key];
      if (inc <= 0) {
        if (!existing || existing.resetAt <= now) {
          return { allowed: true, count: 0, retryAfterSec: 0, resetAt: new Date(now + safeWindow) };
        }
        const allowed = existing.count < safeMax;
        return {
          allowed,
          count: existing.count,
          retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
          resetAt: new Date(existing.resetAt),
        };
      }
      let entry = existing;
      if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + safeWindow };
      }
      if (entry.count + inc > safeMax) {
        state.counters[key] = entry;
        return {
          allowed: false,
          count: entry.count,
          retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
          resetAt: new Date(entry.resetAt),
        };
      }
      entry.count += inc;
      state.counters[key] = entry;
      return {
        allowed: true,
        count: entry.count,
        retryAfterSec: 0,
        resetAt: new Date(entry.resetAt),
      };
    });
    if (fileRes) {
      checkAndIncrementLocalCounter(key, safeWindow, safeMax, inc, now);
      return fileRes;
    }
  }

  // 2. Атомарный RPC в PostgreSQL (основной продакшн-путь)
  if (isLiveOrMockedRpcAvailable()) {
    try {
      const { data, error } = await supabase.rpc("check_and_increment_rate_limit", {
        p_key: String(key).slice(0, 255),
        p_window_ms: safeWindow,
        p_max_count: safeMax,
        p_increment: inc,
      });

      if (!error && data && typeof data.allowed === "boolean") {
        return {
          allowed: data.allowed,
          count: Number(data.count ?? 0),
          retryAfterSec: Number(data.retry_after_sec ?? 0),
          resetAt: data.reset_at ? new Date(data.reset_at) : new Date(now + safeWindow),
        };
      }
    } catch {
      // При недоступности RPC деградируем на локальный ограниченный счётчик
    }
  }

  // 3. Fallback на локальный ограниченный счётчик
  return checkAndIncrementLocalCounter(key, safeWindow, safeMax, inc, now);
}

/**
 * Сброс локальных и файловых счётчиков (для тестов)
 */
export function resetAllRateLimitCounters() {
  localCounters.clear();
  if (process.env.SHARED_STATE_FILE) {
    withSharedFileState((state) => {
      state.counters = {};
    });
  }
}

/**
 * Хранилище для express-rate-limit с жёстким потолком размера в памяти (FIFO)
 * и синхронизацией между процессами через PostgreSQL / SHARED_STATE_FILE.
 */
export class BoundedSharedRateLimitStore {
  constructor({ prefix = "rl:", windowMs = 60000, maxEntries = 10000, syncShared = false } = {}) {
    this.prefix = prefix;
    this.windowMs = windowMs;
    this.maxEntries = maxEntries;
    this.syncShared = syncShared;
    this.localHits = new Map();
  }

  init(options) {
    if (options?.windowMs) {
      this.windowMs = options.windowMs;
    }
  }

  _purgeExpired(now = Date.now()) {
    evictExpiredAndCapMap(this.localHits, this.maxEntries, (entry) => entry.resetTime <= now);
  }

  async increment(key) {
    const fullKey = `${this.prefix}${key}`;
    const now = Date.now();

    if (this.syncShared && (process.env.SHARED_STATE_FILE || isLiveOrMockedRpcAvailable())) {
      // В режиме syncShared инкрементируем в общем хранилище с большим потолком,
      // чтобы express-rate-limit сам применил свой `max`
      const sharedRes = await checkAndIncrementRateLimit(fullKey, this.windowMs, 1000000, 1);
      if (sharedRes) {
        const resetTime = sharedRes.resetAt instanceof Date ? sharedRes.resetAt : new Date(now + this.windowMs);
        setBoundedMap(
          this.localHits,
          key,
          { totalHits: sharedRes.count, resetTime: resetTime.getTime() },
          this.maxEntries,
          () => this._purgeExpired(now)
        );
        return {
          totalHits: sharedRes.count,
          resetTime,
        };
      }
    }

    let entry = this.localHits.get(key);
    if (!entry || entry.resetTime <= now) {
      entry = {
        totalHits: 0,
        resetTime: now + this.windowMs,
      };
    }
    entry.totalHits += 1;

    setBoundedMap(this.localHits, key, entry, this.maxEntries, () => this._purgeExpired(now));

    return {
      totalHits: entry.totalHits,
      resetTime: new Date(entry.resetTime),
    };
  }

  async decrement(key) {
    const entry = this.localHits.get(key);
    if (entry && entry.totalHits > 0) {
      entry.totalHits -= 1;
    }
  }

  async resetKey(key) {
    this.localHits.delete(key);
    const fullKey = `${this.prefix}${key}`;
    localCounters.delete(fullKey);
    if (process.env.SHARED_STATE_FILE) {
      withSharedFileState((state) => {
        delete state.counters[fullKey];
      });
    }
  }

  async resetAll() {
    this.localHits.clear();
  }
}

/**
 * Работа с общими сессиями SMS OTP (PostgreSQL `phone_otp_sessions` / SHARED_STATE_FILE).
 */
export async function saveSharedPhoneOtpSession(session) {
  if (!session || !session.token) return;

  if (process.env.SHARED_STATE_FILE) {
    withSharedFileState((state) => {
      state.otpSessions[session.token] = { ...session };
    });
  }

  if (isLiveOrMockedRpcAvailable() && typeof supabase.from === "function") {
    try {
      await supabase.from("phone_otp_sessions").upsert(
        {
          token: session.token,
          phone: session.phone,
          code_hash: session.codeHash || null,
          transaction_id: session.transactionId || null,
          purpose: session.purpose || "verification",
          attempts: session.attempts || 0,
          max_attempts: session.maxAttempts || 5,
          verified: Boolean(session.verified),
          verified_at: session.verifiedAt ? new Date(session.verifiedAt).toISOString() : null,
          reset_verified: Boolean(session.resetVerified),
          reset_verified_at: session.resetVerifiedAt ? new Date(session.resetVerifiedAt).toISOString() : null,
          used: Boolean(session.used),
          created_at: new Date(session.createdAt || Date.now()).toISOString(),
          expires_at: new Date(session.expiresAt || Date.now() + 600000).toISOString(),
        },
        { onConflict: "token" }
      );
    } catch {
      // ignore if table not present in offline mock
    }
  }
}

export async function loadSharedPhoneOtpSession({ token, phone }) {
  if (process.env.SHARED_STATE_FILE) {
    const found = withSharedFileState((state) => {
      if (token && state.otpSessions[token]) {
        return state.otpSessions[token];
      }
      if (phone) {
        const candidates = Object.values(state.otpSessions)
          .filter((s) => s.phone === phone)
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        return candidates[0] || null;
      }
      return null;
    });
    if (found) return found;
  }

  if (isLiveOrMockedRpcAvailable() && typeof supabase.from === "function") {
    try {
      let query = supabase.from("phone_otp_sessions").select("*");
      if (token) {
        query = query.eq("token", token);
      } else if (phone) {
        query = query.eq("phone", phone).order("created_at", { ascending: false }).limit(1);
      } else {
        return null;
      }
      const { data, error } = await query.maybeSingle();
      if (!error && data) {
        return {
          token: data.token,
          phone: data.phone,
          codeHash: data.code_hash || null,
          transactionId: data.transaction_id || null,
          purpose: data.purpose || "verification",
          attempts: Number(data.attempts || 0),
          maxAttempts: Number(data.max_attempts || 5),
          verified: Boolean(data.verified),
          verifiedAt: data.verified_at ? new Date(data.verified_at).getTime() : null,
          resetVerified: Boolean(data.reset_verified),
          resetVerifiedAt: data.reset_verified_at ? new Date(data.reset_verified_at).getTime() : null,
          used: Boolean(data.used),
          createdAt: new Date(data.created_at).getTime(),
          expiresAt: new Date(data.expires_at).getTime(),
        };
      }
    } catch {
      // ignore
    }
  }

  return null;
}

export async function deleteSharedPhoneOtpSession(token) {
  if (!token) return;

  if (process.env.SHARED_STATE_FILE) {
    withSharedFileState((state) => {
      delete state.otpSessions[token];
    });
  }

  if (isLiveOrMockedRpcAvailable() && typeof supabase.from === "function") {
    try {
      await supabase.from("phone_otp_sessions").delete().eq("token", token);
    } catch {
      // ignore
    }
  }
}

export async function consumeSharedPhoneOtpAttempt(token, maxAttempts = 5) {
  if (!token) return null;

  if (process.env.SHARED_STATE_FILE) {
    const attempts = withSharedFileState((state) => {
      const s = state.otpSessions[token];
      if (!s) return -1;
      if (s.used || Date.now() > s.expiresAt || s.attempts >= maxAttempts) {
        return -1;
      }
      s.attempts = (s.attempts || 0) + 1;
      return s.attempts;
    });
    if (typeof attempts === "number") return attempts;
  }

  if (isLiveOrMockedRpcAvailable()) {
    try {
      const { data, error } = await supabase.rpc("consume_phone_otp_attempt", {
        p_token: token,
        p_max_attempts: maxAttempts,
      });
      if (!error && typeof data === "number") {
        return data;
      }
    } catch {
      // fallback
    }
  }

  return null;
}

/**
 * Захват межпроцессной блокировки (lease) для фоновых задач cron.
 */
export async function tryAcquireCronLease(
  jobName = "periodic_maintenance",
  holderIdOrLeaseMs = PROCESS_HOLDER_ID,
  maybeLeaseSec = 840
) {
  const now = Date.now();
  const holderId =
    typeof holderIdOrLeaseMs === "string" ? holderIdOrLeaseMs : PROCESS_HOLDER_ID;
  const leaseMs =
    typeof holderIdOrLeaseMs === "number"
      ? holderIdOrLeaseMs
      : (Number(maybeLeaseSec) || 840) * 1000;

  if (process.env.SHARED_STATE_FILE) {
    const acquired = withSharedFileState((state) => {
      const existing = state.cronLeases[jobName];
      if (existing && existing.lockedUntil > now && existing.holderId !== holderId) {
        return false;
      }
      state.cronLeases[jobName] = {
        holderId,
        lockedUntil: now + leaseMs,
        updatedAt: now,
      };
      return true;
    });
    if (typeof acquired === "boolean") return acquired;
  }

  if (isLiveOrMockedRpcAvailable()) {
    try {
      const { data, error } = await supabase.rpc("try_acquire_cron_lease", {
        p_job_name: jobName,
        p_holder_id: holderId,
        p_lease_ms: leaseMs,
      });
      if (!error && typeof data === "boolean") {
        return data;
      }
    } catch {
      // fallback
    }
  }

  if (dbPool && typeof dbPool.query === "function" && isLiveOrMockedRpcAvailable()) {
    try {
      const res = await dbPool.query(
        "SELECT public.try_acquire_cron_lease($1, $2, $3) AS acquired",
        [jobName, holderId, leaseMs]
      );
      if (res?.rows?.[0] && typeof res.rows[0].acquired === "boolean") {
        return res.rows[0].acquired;
      }
    } catch {
      // fallback
    }
  }

  return true;
}

export async function releaseCronLease(
  jobName = "periodic_maintenance",
  holderId = PROCESS_HOLDER_ID
) {
  if (process.env.SHARED_STATE_FILE) {
    withSharedFileState((state) => {
      if (state.cronLeases[jobName]?.holderId === holderId) {
        delete state.cronLeases[jobName];
      }
    });
  }

  if (isLiveOrMockedRpcAvailable()) {
    try {
      await supabase.rpc("release_cron_lease", {
        p_job_name: jobName,
        p_holder_id: holderId,
      });
    } catch {}
  }
}

export async function cleanupExpiredSharedState() {
  const now = Date.now();
  evictExpiredAndCapMap(localCounters, MAX_LOCAL_RATE_COUNTERS, (v) => v.resetAt <= now);

  if (process.env.SHARED_STATE_FILE) {
    withSharedFileState((state) => {
      for (const [k, v] of Object.entries(state.counters || {})) {
        if (!v || v.resetAt <= now) delete state.counters[k];
      }
      for (const [k, s] of Object.entries(state.otpSessions || {})) {
        if (!s || s.expiresAt <= now) delete state.otpSessions[k];
      }
    });
  }

  if (isLiveOrMockedRpcAvailable() && typeof supabase.from === "function") {
    const nowIso = new Date(now).toISOString();
    try {
      await supabase.from("phone_otp_sessions").delete().lte("expires_at", nowIso);
      await supabase.from("rate_limit_counters").delete().lte("reset_at", nowIso);
    } catch {
      // ignore
    }
  }
}


/**
 * Откат ранее зарезервированного инкремента счётчика (например, если SMS не была отправлена).
 * Best-effort: ошибки не пробрасываются, чтобы не ломать основной поток.
 */
export async function releaseRateLimit(key, decrement = 1) {
  const dec = Number.isFinite(decrement) ? Math.floor(decrement) : 1;
  if (dec <= 0) return;
  const now = Date.now();

  const entry = localCounters.get(key);
  if (entry && entry.resetAt > now) {
    entry.count = Math.max(0, entry.count - dec);
  }

  if (process.env.SHARED_STATE_FILE) {
    withSharedFileState((state) => {
      const existing = state.counters[key];
      if (existing && existing.resetAt > now) {
        existing.count = Math.max(0, existing.count - dec);
      }
    });
    return;
  }

  if (isLiveOrMockedRpcAvailable()) {
    try {
      await supabase.rpc("release_rate_limit", {
        p_key: String(key).slice(0, 255),
        p_decrement: dec,
      });
    } catch {
      // Откат не критичен: счётчик истечёт сам по окну
    }
  }
}
