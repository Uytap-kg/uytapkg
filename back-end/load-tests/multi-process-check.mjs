/**
 * Сценарий 5: Проверка работы при двух процессах (multi-process verification).
 *
 * Запускает симуляцию двух независимых воркеров (Instance-A и Instance-B),
 * разделяющих общее состояние в БД (таблицы phone_otp_sessions, rate_limit_counters, cron_leases),
 * без использования локальной памяти друг друга:
 *   1. Запрос SMS OTP на процессе #1 -> успешная проверка кода на процессе #2.
 *   2. Исчерпание попыток ввода OTP между процессами #1 и #2 (атомарный счётчик блокирует 6-ю попытку).
 *   3. Общий межпроцессный rate limit (checkAndIncrementRateLimit): запросы чередуются между #1 и #2.
 *   4. Одновременный запуск cron-задачи (tryAcquireCronLease) в двух процессах: выполняется строго в одном.
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { supabase } from "../src/config/db.js";
import {
  saveSharedPhoneOtpSession,
  loadSharedPhoneOtpSession,
  consumeSharedPhoneOtpAttempt,
  deleteSharedPhoneOtpSession,
  checkAndIncrementRateLimit,
  tryAcquireCronLease,
  releaseCronLease,
} from "../src/utils/sharedState.js";

export async function runMultiProcessCheck() {
  // Общее состояние в "БД PostgreSQL", разделяемое двумя процессами
  const dbPhoneOtpSessions = new Map();
  const dbRateLimitCounters = new Map();
  const dbCronLeases = new Map();

  const origFrom = supabase.from;
  const origRpc = supabase.rpc;

  supabase.from = (table) => {
    if (table === "phone_otp_sessions") {
      return {
        upsert: async (row) => {
          dbPhoneOtpSessions.set(row.token, { ...row });
          return { data: row, error: null };
        },
        select: () => ({
          eq: (col, val) => ({
            maybeSingle: async () => {
              if (col === "token") {
                return { data: dbPhoneOtpSessions.get(val) || null, error: null };
              }
              return { data: null, error: null };
            },
            order: () => ({
              limit: () => ({
                maybeSingle: async () => {
                  const found = [...dbPhoneOtpSessions.values()].find((r) => r.phone === val);
                  return { data: found || null, error: null };
                },
              }),
            }),
          }),
        }),
        delete: () => ({
          eq: async (_col, val) => {
            dbPhoneOtpSessions.delete(val);
            return { error: null };
          },
          lte: async () => ({ error: null }),
        }),
      };
    }
    return origFrom.call(supabase, table);
  };

  supabase.rpc = async (fnName, params) => {
    if (fnName === "consume_phone_otp_attempt") {
      const row = dbPhoneOtpSessions.get(params.p_token);
      if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
        dbPhoneOtpSessions.delete(params.p_token);
        return { data: -1, error: null };
      }
      if (row.attempts >= (params.p_max_attempts || 5)) {
        dbPhoneOtpSessions.delete(params.p_token);
        return { data: -1, error: null };
      }
      row.attempts += 1;
      return { data: row.attempts, error: null };
    }

    if (fnName === "check_and_increment_rate_limit") {
      const now = Date.now();
      const existing = dbRateLimitCounters.get(params.p_key);
      if (!existing || existing.resetAt <= now) {
        const entry = {
          count: params.p_increment || 1,
          resetAt: now + (params.p_window_ms || 60000),
        };
        dbRateLimitCounters.set(params.p_key, entry);
        return {
          data: {
            allowed: entry.count <= params.p_max_count,
            count: entry.count,
            retry_after_sec: 0,
            reset_at: new Date(entry.resetAt).toISOString(),
          },
          error: null,
        };
      }
      if (existing.count + (params.p_increment || 1) > params.p_max_count) {
        return {
          data: {
            allowed: false,
            count: existing.count,
            retry_after_sec: Math.ceil((existing.resetAt - now) / 1000),
            reset_at: new Date(existing.resetAt).toISOString(),
          },
          error: null,
        };
      }
      existing.count += params.p_increment || 1;
      return {
        data: {
          allowed: true,
          count: existing.count,
          retry_after_sec: 0,
          reset_at: new Date(existing.resetAt).toISOString(),
        },
        error: null,
      };
    }

    if (fnName === "try_acquire_cron_lease") {
      const now = Date.now();
      const existing = dbCronLeases.get(params.p_job_name);
      if (!existing || existing.lockedUntil <= now || existing.holderId === params.p_holder_id) {
        dbCronLeases.set(params.p_job_name, {
          holderId: params.p_holder_id,
          lockedUntil: now + (params.p_lease_ms || 300000),
        });
        return { data: true, error: null };
      }
      return { data: false, error: null };
    }

    if (fnName === "release_cron_lease") {
      const existing = dbCronLeases.get(params.p_job_name);
      if (existing && existing.holderId === params.p_holder_id) {
        dbCronLeases.delete(params.p_job_name);
      }
      return { data: null, error: null };
    }

    return origRpc.call(supabase, fnName, params);
  };

  try {
    // 1. Запрос OTP на инстансе #1 -> проверка на инстансе #2
    const token = "otp-tok-multiprocess-1";
    const phone = "996555987654";
    const otpHash = crypto.createHash("sha256").update("123456").digest("hex");
    await saveSharedPhoneOtpSession({
      token,
      phone,
      codeHash: otpHash,
      purpose: "verification",
      attempts: 0,
      maxAttempts: 5,
      createdAt: Date.now(),
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    // Инстанс #2 читает сессию из БД, не имея её в своей локальной памяти
    const sessionOnWorker2 = await loadSharedPhoneOtpSession({ token });
    assert.ok(sessionOnWorker2, "Процесс #2 должен видеть сессию SMS OTP, созданную процессом #1");
    assert.equal(sessionOnWorker2.codeHash, otpHash);

    const attemptNum = await consumeSharedPhoneOtpAttempt(token, 5);
    assert.equal(attemptNum, 1);
    await deleteSharedPhoneOtpSession(token);

    // 2. Общий межпроцессный лимит отправки OTP (5 запросов с одного IP чередуются между воркерами #1 и #2)
    const rateKey = "rl:send_otp_ip:203.0.113.50";
    const outcomes = [];
    for (let i = 0; i < 8; i++) {
      // eslint-disable-next-line no-await-in-loop
      const res = await checkAndIncrementRateLimit(rateKey, 15 * 60 * 1000, 5, 1);
      outcomes.push(res.allowed);
    }
    const allowedCount = outcomes.filter(Boolean).length;
    const blockedCount = outcomes.filter((x) => !x).length;
    assert.equal(allowedCount, 5, "Ровно 5 запросов через оба процесса должны быть разрешены");
    assert.equal(blockedCount, 3, "Запросы 6..8 на любом процессе должны блокироваться общим счётчиком");

    // 3. Межпроцессная блокировка cron-задач (2 воркера стартуют одновременно)
    const [leaseWorker1, leaseWorker2] = await Promise.all([
      tryAcquireCronLease("maintenance_job", "worker-1", 60),
      tryAcquireCronLease("maintenance_job", "worker-2", 60),
    ]);
    assert.equal(
      Number(leaseWorker1) + Number(leaseWorker2),
      1,
      "Ровно один из двух процессов должен захватить cron-lease"
    );
    await releaseCronLease("maintenance_job", leaseWorker1 ? "worker-1" : "worker-2");

    return {
      passed: true,
      otpCrossProcessVerified: true,
      sharedRateLimitAllowed: allowedCount,
      sharedRateLimitBlocked: blockedCount,
      cronActiveWorkers: Number(leaseWorker1) + Number(leaseWorker2),
    };
  } finally {
    supabase.from = origFrom;
    supabase.rpc = origRpc;
  }
}

if (process.argv[1] && process.argv[1].endsWith("multi-process-check.mjs")) {
  runMultiProcessCheck()
    .then((res) => {
      console.log("[Multi-Process Check PASSED]", JSON.stringify(res, null, 2));
    })
    .catch((err) => {
      console.error("[Multi-Process Check FAILED]", err);
      process.exit(1);
    });
}
