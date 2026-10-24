import test from "node:test";
import assert from "node:assert/strict";

import { supabase } from "../src/config/db.js";
import { activateSubscription } from "../src/services/subscriptionsService.js";
import {
  createSubscriptionPayment,
  fulfillPayment,
  handleWebhookService,
  getPaymentStatusService,
  setOdengiClient,
  resetOdengiClient,
  clearProviderCheckThrottleMap,
  MAX_PENDING_PAYMENTS_PER_USER,
} from "../src/services/payments/paymentsService.js";

test("P2-07: При сбое RPC activate_subscription_atomic не происходит неатомарный upsert, а платёж остаётся в approved для безопасной довыдачи", async () => {
  const origFrom = supabase.from;
  const origRpc = supabase.rpc;

  let upsertCalled = false;
  let markFailedPayload = null;

  try {
    supabase.from = (table) => {
      if (table === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
          upsert: () => {
            upsertCalled = true;
            return {
              select: () => ({
                maybeSingle: async () => ({ data: {}, error: null }),
              }),
            };
          },
        };
      }
      if (table === "processed_subscription_payments") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      if (table === "tariff_plans" || table === "service_prices") {
        return { select: async () => ({ data: [], error: null }) };
      }
      if (table === "payments") {
        return {
          update: (payload) => ({
            eq: () => ({
              is: () => ({
                or: () => ({
                  select: () => ({
                    maybeSingle: async () => ({
                      data: {
                        id: "pay-p207-1",
                        order_id: "UT-P207-1",
                        user_id: "user-p207",
                        tariff_id: "optimal",
                        months: 1,
                        status: "approved",
                        fulfilled_at: null,
                        fulfill_attempts: 0,
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
              select: () => ({
                maybeSingle: async () => {
                  markFailedPayload = payload;
                  return {
                    data: {
                      id: "pay-p207-1",
                      order_id: "UT-P207-1",
                      user_id: "user-p207",
                      tariff_id: "optimal",
                      months: 1,
                      status: "approved",
                      fulfilled_at: null,
                      ...payload,
                    },
                    error: null,
                  };
                },
              }),
            }),
          }),
        };
      }
      return { select: async () => ({ data: [], error: null }) };
    };

    supabase.rpc = async (fn) => {
      if (fn === "activate_subscription_atomic") {
        return {
          data: null,
          error: { code: "40001", message: "serialization_failure / deadlock detected" },
        };
      }
      return { data: null, error: null };
    };

    const payment = {
      id: "pay-p207-1",
      order_id: "UT-P207-1",
      user_id: "user-p207",
      tariff_id: "optimal",
      months: 1,
      status: "approved",
      fulfilled_at: null,
      fulfill_attempts: 0,
    };

    const res = await fulfillPayment(payment);

    assert.equal(upsertCalled, false, "Неатомарный upsert на subscriptions НЕ должен вызываться при ошибке RPC");
    assert.equal(res.status, "approved", "Статус платежа должен остаться approved");
    assert.equal(res.fulfilled_at, null, "fulfilled_at должен остаться null для последующей довыдачи");
    assert.equal(markFailedPayload?.fulfilling_at, null, "Lease fulfilling_at должен быть освобождён");
    assert.equal(res.fulfill_attempts, 1);
  } finally {
    supabase.from = origFrom;
    supabase.rpc = origRpc;
  }
});

test("Stage 4 (Двойной клик): Два параллельных запроса создания счёта от одного пользователя создают только 1 счёт в O!Dengi", async () => {
  const origFrom = supabase.from;
  const paymentsDb = [];
  let odengiCreateCalls = 0;

  try {
    setOdengiClient({
      createInvoice: async ({ orderId }) => {
        odengiCreateCalls++;
        await new Promise((r) => setTimeout(r, 20));
        return {
          invoice_id: `INV-${orderId}`,
          qr: "https://qr.odengi.kg/test",
          paylink_url: "https://pay.odengi.kg/test",
        };
      },
    });

    supabase.from = (table) => {
      if (table === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      if (table === "tariff_plans" || table === "service_prices") {
        return { select: async () => ({ data: [], error: null }) };
      }
      if (table === "payments") {
        return {
          select: () => ({
            eq: (_col, userId) => ({
              in: (_sCol, statuses) => {
                const chain = {
                  gte: () => chain,
                  order: () => chain,
                  limit: async () => ({
                    data: paymentsDb.filter(
                      (p) => p.user_id === userId && statuses.includes(p.status)
                    ),
                    error: null,
                  }),
                };
                return chain;
              },
            }),
          }),
          insert: (row) => ({
            select: () => ({
              single: async () => {
                const record = {
                  id: `pay-${paymentsDb.length + 1}`,
                  ...row,
                  created_at: new Date().toISOString(),
                };
                paymentsDb.push(record);
                return { data: record, error: null };
              },
            }),
          }),
          update: (patch) => ({
            eq: (_col, id) => ({
              select: () => ({
                single: async () => {
                  const idx = paymentsDb.findIndex((p) => p.id === id);
                  if (idx !== -1) {
                    paymentsDb[idx] = { ...paymentsDb[idx], ...patch };
                  }
                  return { data: paymentsDb[idx], error: null };
                },
                maybeSingle: async () => {
                  const idx = paymentsDb.findIndex((p) => p.id === id);
                  if (idx !== -1) {
                    paymentsDb[idx] = { ...paymentsDb[idx], ...patch };
                  }
                  return { data: paymentsDb[idx], error: null };
                },
              }),
            }),
          }),
        };
      }
      return { select: async () => ({ data: [], error: null }) };
    };

    const [res1, res2] = await Promise.all([
      createSubscriptionPayment({ userId: "user-dbl-1", tariffId: "optimal", months: 1 }),
      createSubscriptionPayment({ userId: "user-dbl-1", tariffId: "optimal", months: 1 }),
    ]);

    assert.ok(res1.data, "Первый запрос должен вернуть данные счёта");
    assert.ok(res2.data, "Второй параллельный запрос должен вернуть данные счёта");
    assert.equal(odengiCreateCalls, 1, "В O!Dengi должен быть выставлен ровно 1 счёт при двойном клике");
    assert.equal(res1.data.orderId, res2.data.orderId, "Оба ответа должны возвращать один и тот же orderId");
    assert.equal(res2.data.deduplicated, true, "Второй ответ должен быть помечен как дедуплицированный");
  } finally {
    supabase.from = origFrom;
    resetOdengiClient();
  }
});

test("Stage 4 (Лимит открытых счетов): Превышение MAX_PENDING_PAYMENTS_PER_USER блокирует спам создания счетов в O!Dengi", async () => {
  const origFrom = supabase.from;
  let odengiCalls = 0;

  try {
    setOdengiClient({
      createInvoice: async () => {
        odengiCalls++;
        return { invoice_id: "INV-SPAM" };
      },
    });

    const existingOpen = Array.from({ length: MAX_PENDING_PAYMENTS_PER_USER }, (_, i) => ({
      id: `open-${i}`,
      user_id: "user-spam-1",
      order_id: `UT-OPEN-${i}`,
      tariff_id: "start",
      months: i + 1,
      amount: 39000 * (i + 1),
      status: "processing",
      invoice_id: `INV-${i}`,
      created_at: new Date().toISOString(),
    }));

    supabase.from = (table) => {
      if (table === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      if (table === "tariff_plans" || table === "service_prices") {
        return { select: async () => ({ data: [], error: null }) };
      }
      if (table === "payments") {
        return {
          select: () => ({
            eq: () => ({
              in: () => {
                const chain = {
                  gte: () => chain,
                  order: () => chain,
                  limit: async () => ({ data: existingOpen, error: null }),
                };
                return chain;
              },
            }),
          }),
        };
      }
      return { select: async () => ({ data: [], error: null }) };
    };

    const res = await createSubscriptionPayment({
      userId: "user-spam-1",
      tariffId: "business",
      months: 1,
    });

    assert.equal(res.error, "too_many_pending", "При превышении лимита открытых счетов должен возвращаться too_many_pending");
    assert.equal(odengiCalls, 0, "Шлюз O!Dengi не должен вызываться при превышении лимита открытых счетов");
  } finally {
    supabase.from = origFrom;
    resetOdengiClient();
  }
});

test("Stage 4 (Параллельные вебхуки + опрос статуса клиентом): 2 вебхука и 1 поллинг по одному order_id выдают подписку строго 1 раз", async () => {
  const origFrom = supabase.from;
  const origRpc = supabase.rpc;
  clearProviderCheckThrottleMap();

  let paymentRow = {
    id: "pay-race-wh-1",
    order_id: "UT_RACE_WH_001",
    invoice_id: "INV_RACE_001",
    user_id: "user-race-wh",
    tariff_id: "optimal",
    months: 1,
    amount: 79000,
    status: "processing",
    fulfilled_at: null,
    fulfilling_at: null,
    fulfill_attempts: 0,
  };

  let rpcActivateCalls = 0;
  const processedPaymentIds = new Set();

  try {
    setOdengiClient({
      statusPayment: async () => {
        await new Promise((r) => setTimeout(r, 10));
        return {
          status: "approved",
          amount: 79000,
          payments: [{ status: "approved", amount: 79000, trans_id: "TX-1" }],
        };
      },
    });

    supabase.from = (table) => {
      if (table === "payments") {
        return {
          select: () => ({
            eq: (col, val) => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: paymentRow.order_id === val ? { ...paymentRow } : null,
                  error: null,
                }),
              }),
              maybeSingle: async () => ({
                data:
                  paymentRow.id === val || paymentRow.order_id === val
                    ? { ...paymentRow }
                    : null,
                error: null,
              }),
            }),
          }),
          update: (patch) => ({
            eq: (_col, id) => {
              if (id !== paymentRow.id) {
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
                      if (!allowedStatuses.includes(paymentRow.status)) {
                        return { data: null, error: null };
                      }
                      paymentRow = { ...paymentRow, ...patch };
                      return { data: { ...paymentRow }, error: null };
                    },
                  }),
                }),
                is: (_fCol, expectedNull) => ({
                  or: () => ({
                    select: () => ({
                      maybeSingle: async () => {
                        if (paymentRow.fulfilled_at !== expectedNull || paymentRow.fulfilling_at !== null) {
                          return { data: null, error: null };
                        }
                        paymentRow = { ...paymentRow, ...patch };
                        return { data: { ...paymentRow }, error: null };
                      },
                    }),
                  }),
                }),
                select: () => ({
                  maybeSingle: async () => {
                    paymentRow = { ...paymentRow, ...patch };
                    return { data: { ...paymentRow }, error: null };
                  },
                }),
              };
            },
          }),
        };
      }
      if (table === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      if (table === "processed_subscription_payments") {
        return {
          select: () => ({
            eq: (_col, val) => ({
              maybeSingle: async () => ({
                data: processedPaymentIds.has(val) ? { payment_id: val } : null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "tariff_plans" || table === "service_prices") {
        return { select: async () => ({ data: [], error: null }) };
      }
      return { select: async () => ({ data: [], error: null }) };
    };

    supabase.rpc = async (fn, params) => {
      if (fn === "activate_subscription_atomic") {
        rpcActivateCalls++;
        processedPaymentIds.add(params.p_payment_id);
        return {
          data: {
            id: "sub-1",
            user_id: params.p_user_id,
            tariff_id: params.p_tariff_id,
            expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
            is_active: true,
          },
          error: null,
        };
      }
      return { data: null, error: null };
    };

    const [wh1, wh2, pollRes] = await Promise.all([
      handleWebhookService("UT_RACE_WH_001"),
      handleWebhookService("UT_RACE_WH_001"),
      getPaymentStatusService({ orderId: "UT_RACE_WH_001", userId: "user-race-wh" }),
    ]);

    assert.equal(wh1.success, true);
    assert.equal(wh2.success, true);
    assert.ok(pollRes.data);
    assert.equal(rpcActivateCalls, 1, "activate_subscription_atomic должен быть вызван строго 1 раз");
    assert.equal(paymentRow.status, "approved");
    assert.ok(paymentRow.fulfilled_at, "fulfilled_at должен быть проставлен");
  } finally {
    supabase.from = origFrom;
    supabase.rpc = origRpc;
    resetOdengiClient();
    clearProviderCheckThrottleMap();
  }
});

test("Stage 4 (Одновременная покупка двух разных тарифов): сериализация по userId сохраняет Pro-Rata дни первого тарифа при апгрейде на второй", async () => {
  const origFrom = supabase.from;
  const origRpc = supabase.rpc;

  const userId = "user-two-tariffs";
  let currentSub = null;
  const processedIds = new Set();

  try {
    supabase.from = (table) => {
      if (table === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: currentSub ? { ...currentSub } : null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "processed_subscription_payments") {
        return {
          select: () => ({
            eq: (_col, val) => ({
              maybeSingle: async () => ({
                data: processedIds.has(val) ? { payment_id: val } : null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "tariff_plans" || table === "service_prices") {
        return { select: async () => ({ data: [], error: null }) };
      }
      return { select: async () => ({ data: [], error: null }) };
    };

    supabase.rpc = async (fn, params) => {
      if (fn === "activate_subscription_atomic") {
        await new Promise((r) => setTimeout(r, 15));
        processedIds.add(params.p_payment_id);
        const expiresAt = new Date(Date.now() + params.p_days * 86400000).toISOString();
        currentSub = {
          id: "sub-2t",
          user_id: params.p_user_id,
          tariff_id: params.p_tariff_id,
          expires_at: expiresAt,
          is_active: true,
          is_individual: false,
        };
        return { data: { ...currentSub }, error: null };
      }
      return { data: null, error: null };
    };

    const [resStart, resOptimal] = await Promise.all([
      activateSubscription(userId, "start", 1, "PAY-START-1"),
      activateSubscription(userId, "optimal", 1, "PAY-OPTIMAL-1"),
    ]);

    assert.equal(resStart.tariffId, "start");
    assert.equal(resOptimal.tariffId, "optimal");

    // Второй вызов (optimal) должен был увидеть уже активированный start (30 дней по 390 сом)
    // и сконвертировать его остаток в дни optimal (~14-15 дней) + 30 дней = ~44-45 дней (> 40 дней, а не просто 30!)
    const finalDays = (new Date(currentSub.expires_at).getTime() - Date.now()) / 86400000;
    assert.ok(
      finalDays >= 43 && finalDays <= 46,
      `Итоговый срок после одновременной покупки start + optimal должен учитывать Pro-Rata (~44.8 дн.), получено: ${finalDays.toFixed(2)}`
    );
  } finally {
    supabase.from = origFrom;
    supabase.rpc = origRpc;
  }
});
