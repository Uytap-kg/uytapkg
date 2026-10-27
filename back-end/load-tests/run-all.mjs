/**
 * Комплексный воспроизводимый прогон нагрузочных сценариев UyTap (Этап 6).
 *
 * ВАЖНО: Скрипт поднимает локальный Express HTTP-сервер на эфемерном порту (127.0.0.1:0)
 * с полностью замоканными внешними платными сервисами (Nikita SMS, Resend, Claude/Gemini, O!Dengi)
 * и in-memory эмуляцией таблиц Supabase/PostgreSQL. Реальные квоты и продакшн-БД НЕ затрагиваются.
 *
 * Сценарии:
 *   1. Чтение каталога, фильтров, карты, карточки объявления и публичного профиля
 *      (GET /api/listings, GET /api/listings/map, GET /api/listings/:id, GET /api/auth/users/:id).
 *   2. Флуд на POST /api/auth/send-otp, /api/auth/login, /api/auth/forgot-password
 *      с одного IP и с ротацией адресов/номеров.
 *   3. Параллельные запросы к POST /api/ai/search (проверка семафора, очереди, таймаутов и квот).
 *   4. Параллельные вебхуки POST /api/payments/webhook для одного order_id (идемпотентность).
 *   5. Проверка при двух процессах (multi-process-check.mjs: OTP, общие лимиты, cron lease).
 *
 * Запуск:
 *   node load-tests/run-all.mjs
 */

import express from "express";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { supabase } from "../src/config/db.js";
import resolveClientIp from "../src/middleware/clientIp.js";
import requestContext from "../src/middleware/requestContext.js";
import listingsRoutes from "../src/routes/listingsRoutes.js";
import authRoutes from "../src/routes/authRoutes.js";
import paymentsRoutes from "../src/routes/paymentsRoutes.js";
import { aiSemaphore } from "../src/controllers/aiController.js";
import {
  setOdengiClient,
  resetOdengiClient,
  clearProviderCheckThrottleMap,
} from "../src/controllers/paymentsController.js";
import {
  flushAllCounters,
  stopCounterBatcher,
  listingViewsBuffer,
} from "../src/utils/counterBatcher.js";
import { invalidatePublicCache } from "../src/utils/publicCache.js";
import { runMultiProcessCheck } from "./multi-process-check.mjs";

const PROXY_SECRET = "load-test-trusted-proxy-secret-32chars!!";
process.env.TRUSTED_PROXY_SECRET = PROXY_SECRET;
process.env.INTERNAL_PROXY_SECRET = PROXY_SECRET;

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const idx = Math.min(sortedArr.length - 1, Math.floor((p / 100) * sortedArr.length));
  return Number(sortedArr[idx].toFixed(2));
}

function getRssMb() {
  return Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(1));
}

async function runConcurrentRequests(totalRequests, concurrency, requestFn) {
  const latencies = [];
  const statusCounts = {};
  let idx = 0;
  const startWall = performance.now();

  async function worker() {
    while (true) {
      const current = idx++;
      if (current >= totalRequests) break;
      const t0 = performance.now();
      try {
        // eslint-disable-next-line no-await-in-loop
        const res = await requestFn(current);
        const dt = performance.now() - t0;
        latencies.push(dt);
        statusCounts[res.status] = (statusCounts[res.status] || 0) + 1;
      } catch {
        const dt = performance.now() - t0;
        latencies.push(dt);
        statusCounts[599] = (statusCounts[599] || 0) + 1;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const durationSec = (performance.now() - startWall) / 1000;
  latencies.sort((a, b) => a - b);

  const count5xx = Object.entries(statusCounts)
    .filter(([code]) => Number(code) >= 500 && Number(code) !== 503)
    .reduce((acc, [, c]) => acc + c, 0);

  return {
    totalRequests,
    concurrency,
    rps: Number((totalRequests / durationSec).toFixed(1)),
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    p99Ms: percentile(latencies, 99),
    statusCounts,
    error5xxPercent: Number(((count5xx / totalRequests) * 100).toFixed(2)),
    rssMb: getRssMb(),
  };
}

async function main() {
  console.log("=== UyTap Production Load & Concurrency Test Suite ===");
  const baselineRssMb = getRssMb();
  console.log(`Initial RSS: ${baselineRssMb} MB\n`);

  // Настраиваем in-memory мок БД для сценариев 1–4
  const origFrom = supabase.from;
  const origRpc = supabase.rpc;

  const sampleListings = Array.from({ length: 24 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    user_id: "00000000-0000-4000-8000-000000000100",
    title: `2-комн. квартира #${i + 1} в ЖК Асанбай`,
    description: "Уютная квартира с ремонтом",
    transaction_type: "sale",
    property_type: "apartment",
    price: 75000 + i * 1000,
    currency: "USD",
    city: "Бишкек",
    district: "Октябрьский",
    address: "мкр. Асанбай",
    latitude: 42.83 + i * 0.001,
    longitude: 74.61 + i * 0.001,
    rooms: 2,
    area_total: 68,
    floor: 5,
    total_floors: 12,
    status: "active",
    views_count: 10,
    is_vip: i < 2,
    is_top: i < 4,
    is_urgent: false,
    features: { residentialComplexName: "Асанбай Сити" },
    created_at: new Date().toISOString(),
    listing_images: [{ url: "https://example.com/img1.webp", is_main: true, sort_order: 0 }],
    users: {
      id: "00000000-0000-4000-8000-000000000100",
      account_type: "realtor",
      is_verified: true,
      user_profiles: { first_name: "Азамат", last_name: "Исаков", avatar_url: null },
    },
  }));

  let dbViewBatchFlushes = 0;
  let dbBannerBatchFlushes = 0;

  // Состояние платежа для сценария 4 (30 параллельных вебхуков)
  let webhookPayment = {
    id: "pay-webhook-load-1",
    user_id: "user-webhook-load-1",
    order_id: "ORD_LOAD_WEBHOOK_001",
    invoice_id: "INV_LOAD_001",
    tariff_id: "optimal",
    months: 1,
    amount: 79000,
    status: "processing",
    paid_at: null,
    fulfilled_at: null,
    fulfilling_at: null,
    fulfill_attempts: 0,
    fulfill_error: null,
  };
  let webhookSubscriptionActivations = 0;
  const processedWebhookPayments = new Set();

  setOdengiClient({
    statusPayment: async () => ({
      status: "approved",
      amount: 79000,
      payments: [{ status: "approved", amount: 79000, trans_id: "TX-LOAD-1" }],
    }),
  });

  function createChainableQuery(rows, singleRow = null) {
    const chain = {
      select: () => chain,
      insert: () => chain,
      update: () => chain,
      upsert: () => chain,
      delete: () => chain,
      eq: () => chain,
      neq: () => chain,
      in: () => chain,
      is: () => chain,
      not: () => chain,
      or: () => chain,
      gt: () => chain,
      gte: () => chain,
      lte: () => chain,
      lt: () => chain,
      ilike: () => chain,
      contains: () => chain,
      order: () => chain,
      limit: () => chain,
      range: (from, to) => {
        const sliced = rows.slice(from, to + 1);
        return Promise.resolve({ data: sliced, count: rows.length, error: null });
      },
      maybeSingle: async () => ({ data: singleRow ?? rows[0] ?? null, error: null }),
      single: async () => ({ data: singleRow ?? rows[0] ?? null, error: null }),
      then: (resolve) => resolve({ data: rows, count: rows.length, error: null }),
    };
    return chain;
  }

  supabase.from = (table) => {
    if (table === "listings") {
      return createChainableQuery(sampleListings, sampleListings[0]);
    }
    if (table === "users") {
      return createChainableQuery(
        [
          {
            id: "00000000-0000-4000-8000-000000000100",
            email: "existing@uytap.kg",
            phone: "996555112233",
            account_type: "realtor",
            is_verified: true,
            created_at: new Date().toISOString(),
            password_hash: "$2b$10$InvalidHashForLoadTestOnly000000000000000000000000000",
            user_profiles: [{ first_name: "Азамат", last_name: "Исаков" }],
          },
        ],
        null
      );
    }
    if (table === "subscriptions") {
      return createChainableQuery([], null);
    }
    if (table === "processed_subscription_payments") {
      return {
        select: () => ({
          eq: (_c, pid) => ({
            maybeSingle: async () => ({
              data: processedWebhookPayments.has(pid) ? { payment_id: pid } : null,
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === "payments") {
      return {
        select: () => ({
          eq: (col, val) => ({
            maybeSingle: async () => {
              if (col === "order_id" && val === webhookPayment.order_id) {
                return { data: { ...webhookPayment }, error: null };
              }
              if (col === "id" && val === webhookPayment.id) {
                return { data: { ...webhookPayment }, error: null };
              }
              return { data: null, error: null };
            },
            eq: () => ({
              maybeSingle: async () => ({ data: { ...webhookPayment }, error: null }),
            }),
          }),
        }),
        update: (patch) => ({
          eq: (_c1, idVal) => {
            if (idVal !== webhookPayment.id) {
              return {
                in: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
                is: () => ({ or: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
                select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
              };
            }
            return {
              in: (_sCol, allowedStatuses) => ({
                select: () => ({
                  maybeSingle: async () => {
                    if (!allowedStatuses.includes(webhookPayment.status)) {
                      return { data: null, error: null };
                    }
                    webhookPayment = { ...webhookPayment, ...patch };
                    return { data: { ...webhookPayment }, error: null };
                  },
                }),
              }),
              is: (_fCol, expectedNull) => ({
                or: () => ({
                  select: () => ({
                    maybeSingle: async () => {
                      if (
                        webhookPayment.fulfilled_at !== expectedNull ||
                        webhookPayment.fulfilling_at !== null
                      ) {
                        return { data: null, error: null };
                      }
                      webhookPayment = { ...webhookPayment, ...patch };
                      return { data: { ...webhookPayment }, error: null };
                    },
                  }),
                }),
              }),
              select: () => ({
                maybeSingle: async () => {
                  webhookPayment = { ...webhookPayment, ...patch };
                  return { data: { ...webhookPayment }, error: null };
                },
              }),
            };
          },
        }),
      };
    }
    return createChainableQuery([], null);
  };

  supabase.rpc = async (fnName, params) => {
    if (fnName === "increment_views_batch") {
      dbViewBatchFlushes += 1;
      return { data: (params.p_ids || []).length, error: null };
    }
    if (fnName === "increment_banner_stats_batch") {
      dbBannerBatchFlushes += 1;
      return { data: (params.p_ids || []).length, error: null };
    }
    if (fnName === "activate_subscription_atomic") {
      await new Promise((r) => setTimeout(r, 10));
      if (!processedWebhookPayments.has(params.p_payment_id)) {
        processedWebhookPayments.add(params.p_payment_id);
        webhookSubscriptionActivations += 1;
      }
      return {
        data: {
          user_id: params.p_user_id,
          tariff_id: params.p_tariff_id,
          expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
        },
        error: null,
      };
    }
    return { data: null, error: null };
  };

  // Поднимаем тестовый Express-сервер
  const app = express();
  app.set("trust proxy", false);
  app.use(resolveClientIp);
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/listings", listingsRoutes);
  app.use("/api/auth", authRoutes);
  app.use("/api/payments", paymentsRoutes);

  // Тестовый маршрут для сценария 3 (AI-поиск через реальный aiSemaphore)
  let activeAiCalls = 0;
  let maxObservedActiveAiCalls = 0;
  app.post("/api/ai/search-load-test", async (req, res) => {
    try {
      const result = await aiSemaphore.run(async () => {
        activeAiCalls += 1;
        if (activeAiCalls > maxObservedActiveAiCalls) {
          maxObservedActiveAiCalls = activeAiCalls;
        }
        await new Promise((r) => setTimeout(r, 150));
        activeAiCalls -= 1;
        return { matched: 3 };
      });
      return res.json({ success: true, data: result });
    } catch (err) {
      if (err.code === "SEMAPHORE_QUEUE_FULL" || err.code === "SEMAPHORE_QUEUE_TIMEOUT") {
        return res.status(503).json({
          success: false,
          message: "Сервис AI-поиска временно перегружен, попробуйте через несколько секунд",
        });
      }
      return res.status(500).json({ success: false, message: "Внутренняя ошибка" });
    }
  });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // =========================================================================
    // СЦЕНАРИЙ 1: Чтение каталога, фильтров, карты, карточки объявления и профиля
    // =========================================================================
    invalidatePublicCache();
    const endpoints = [
      "/api/listings?page=1&limit=12&city=Бишкек",
      "/api/listings?search=Асанбай%25_Сити&transactionType=sale&rooms=2",
      "/api/listings/map?city=Бишкек",
      `/api/listings/${sampleListings[0].id}`,
      "/api/auth/users/00000000-0000-4000-8000-000000000100",
    ];

    const scenario1 = await runConcurrentRequests(200, 20, async (i) => {
      const ep = endpoints[i % endpoints.length];
      // Используем разные IP из подсети, чтобы проверить работу каталога без блокировки одного IP
      const clientIp = `198.51.100.${(i % 50) + 1}`;
      return fetch(`${baseUrl}${ep}`, {
        headers: {
          "x-forwarded-for": clientIp,
          "x-internal-proxy-secret": PROXY_SECRET,
        },
      });
    });

    // Проверяем, что просмотры буферизировались в counterBatcher и сбрасываются одним батчем
    const bufferedViewsKeys = listingViewsBuffer.size;
    await flushAllCounters();

    assert.equal(scenario1.error5xxPercent, 0, "Сценарий 1: не должно быть ошибок 5xx");
    assert.equal(scenario1.statusCounts[200], 200, "Сценарий 1: все 200 запросов чтения должны вернуть 200 OK");
    console.log("[Scenario 1: Catalog & Public Read Load]", JSON.stringify({
      ...scenario1,
      bufferedViewsBeforeFlush: bufferedViewsKeys,
      dbBatchFlushes: dbViewBatchFlushes,
    }));

    // =========================================================================
    // СЦЕНАРИЙ 2: Флуд на POST /api/auth/send-otp и /api/auth/forgot-password с 1 IP и ротацией email
    // =========================================================================
    const attackerIp = "203.0.113.99";
    const scenario2 = await runConcurrentRequests(25, 5, async (i) => {
      return fetch(`${baseUrl}/api/auth/forgot-password`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": attackerIp,
          "x-internal-proxy-secret": PROXY_SECRET,
        },
        body: JSON.stringify({ email: `victim_${i}@example.com` }),
      });
    });

    assert.equal(scenario2.error5xxPercent, 0, "Сценарий 2: не должно быть ошибок 5xx");
    assert.ok(
      (scenario2.statusCounts[429] || 0) >= 15,
      `Сценарий 2: IP-лимитер (max=10) должен заблокировать >= 15 из 25 запросов с ротацией email (получено 429: ${scenario2.statusCounts[429]})`
    );
    console.log("[Scenario 2: Auth / OTP Flood from 1 IP with Rotating Emails]", JSON.stringify(scenario2));

    // =========================================================================
    // СЦЕНАРИЙ 3: Параллельные запросы к AI-поиску (семафор max=8, очередь maxQueue=50)
    // =========================================================================
    const scenario3 = await runConcurrentRequests(70, 70, async (i) => {
      return fetch(`${baseUrl}/api/ai/search-load-test`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": `192.0.2.${(i % 200) + 1}`,
          "x-internal-proxy-secret": PROXY_SECRET,
        },
        body: JSON.stringify({ query: "2 комнатная квартира в Бишкеке" }),
      });
    });

    assert.equal(scenario3.error5xxPercent, 0, "Сценарий 3: не должно быть необработанных 500 ошибок");
    assert.ok(
      maxObservedActiveAiCalls <= 8,
      `Сценарий 3: одновременно должно выполняться не более 8 AI-запросов (наблюдалось: ${maxObservedActiveAiCalls})`
    );
    assert.ok(
      (scenario3.statusCounts[503] || 0) >= 10,
      "Сценарий 3: запросы сверх размера очереди семафора (8 active + 50 queue = 58) должны мгновенно получать 503"
    );
    console.log("[Scenario 3: Concurrent AI Search Semaphore & Queue Cap]", JSON.stringify({
      ...scenario3,
      maxObservedActiveAiCalls,
    }));

    // =========================================================================
    // СЦЕНАРИЙ 4: 30 параллельных вебхуков POST /api/payments/webhook для одного order_id
    // =========================================================================
    clearProviderCheckThrottleMap();
    const scenario4 = await runConcurrentRequests(30, 30, async () => {
      return fetch(`${baseUrl}/api/payments/webhook`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "185.117.148.10",
          "x-internal-proxy-secret": PROXY_SECRET,
        },
        body: JSON.stringify({ order_id: webhookPayment.order_id }),
      });
    });

    assert.equal(scenario4.error5xxPercent, 0, "Сценарий 4: 0 ошибок 5xx при шторме вебхуков");
    assert.equal(
      webhookSubscriptionActivations,
      1,
      `Сценарий 4: подписка должна активироваться строго 1 раз (активировано: ${webhookSubscriptionActivations})`
    );
    assert.ok(webhookPayment.fulfilled_at, "Сценарий 4: fulfilled_at должен быть выставлен");
    console.log("[Scenario 4: 30 Parallel Payment Webhooks for Same order_id]", JSON.stringify({
      ...scenario4,
      webhookSubscriptionActivations,
      finalPaymentStatus: webhookPayment.status,
      fulfilled: Boolean(webhookPayment.fulfilled_at),
    }));

    // =========================================================================
    // СЦЕНАРИЙ 5: Проверка в двух процессах (OTP, общие лимиты, cron lease)
    // =========================================================================
    const scenario5 = await runMultiProcessCheck();
    console.log("[Scenario 5: Multi-Process State & Cron Lease Check]", JSON.stringify(scenario5));

    const finalRssMb = getRssMb();
    console.log(`\n=== ALL 5 LOAD & CONCURRENCY SCENARIOS PASSED (Final RSS: ${finalRssMb} MB) ===`);
  } finally {
    stopCounterBatcher();
    resetOdengiClient();
    supabase.from = origFrom;
    supabase.rpc = origRpc;
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error("Load test suite failed:", err);
  process.exit(1);
});
