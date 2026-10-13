import test from "node:test";
import assert from "node:assert/strict";
import { fulfillPayment } from "../src/services/payments/paymentsService.js";
import { supabase } from "../src/config/db.js";

test("Concurrent Fulfillment: два параллельных вызова fulfillPayment активируют подписку ровно один раз", async () => {
  const origFrom = supabase.from.bind(supabase);
  const origRpc = supabase.rpc?.bind(supabase);

  let atomicActivationCalls = 0;
  let leaseClaimAttempts = 0;

  // Имитация состояния платежа в БД
  let dbPayment = {
    id: "pay-concurrent-uuid-1",
    user_id: "user-concurrent-1",
    order_id: "UT-CONCURRENT-001",
    tariff_id: "optimal",
    months: 1,
    amount: 150000,
    status: "approved",
    fulfilled_at: null,
    fulfilling_at: null,
    fulfill_attempts: 0,
    fulfill_error: null,
  };

  // Мокируем supabase
  supabase.from = (table) => {
    if (table === "payments") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { ...dbPayment },
              error: null,
            }),
          }),
        }),
        update: (updatePayload) => ({
          eq: () => ({
            is: () => ({
              or: () => ({
                select: () => ({
                  maybeSingle: async () => {
                    leaseClaimAttempts++;
                    // Атомарный lease-захват: только первый поток получает запись
                    if (updatePayload.fulfilling_at !== undefined) {
                      if (dbPayment.fulfilled_at || dbPayment.fulfilling_at) {
                        return { data: null, error: null };
                      }
                      dbPayment.fulfilling_at = updatePayload.fulfilling_at;
                      return { data: { ...dbPayment }, error: null };
                    }
                    return { data: null, error: null };
                  },
                }),
              }),
            }),
            select: () => ({
              maybeSingle: async () => {
                Object.assign(dbPayment, updatePayload);
                return { data: { ...dbPayment }, error: null };
              },
            }),
          }),
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
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: { id: "sub-new-1", user_id: "user-concurrent-1" },
              error: null,
            }),
          }),
        }),
      };
    }

    if (table === "processed_subscription_payments") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
        insert: async () => ({ error: null }),
      };
    }

    if (table === "tariff_plans" || table === "service_prices") {
      return {
        select: () => Promise.resolve({ data: [], error: null }),
      };
    }

    return origFrom(table);
  };

  supabase.rpc = async (fn, params) => {
    if (fn === "activate_subscription_atomic") {
      atomicActivationCalls++;
      return { data: { id: "sub-atomic-1" }, error: null };
    }
    return { data: null, error: null };
  };

  try {
    const paymentArg = { ...dbPayment };

    // Одновременный запуск двух параллельных запросов на выдачу
    const [res1, res2] = await Promise.all([
      fulfillPayment(paymentArg),
      fulfillPayment(paymentArg),
    ]);

    // Проверяем, что lease пытались захватить оба потока
    assert.ok(leaseClaimAttempts >= 2, "Оба потока должны были попытаться захватить lease");

    // Проверяем, что атомарная активация подписки вызвана строго один раз
    assert.equal(
      atomicActivationCalls,
      1,
      "Бизнес-логика активации подписки должна выполниться строго 1 раз"
    );

    // Оба вызова возвращают объект платежа
    assert.ok(res1);
    assert.ok(res2);
    // Хотя бы один (победитель lease) содержит fulfilled_at
    assert.ok(res1.fulfilled_at || res2.fulfilled_at);
  } finally {
    supabase.from = origFrom;
    supabase.rpc = origRpc;
  }
});

test("Concurrent Fulfillment: повторный вызов с уже выставленным fulfilled_at завершается немедленно без обращений к БД", async () => {
  const alreadyDonePayment = {
    id: "pay-already-done",
    user_id: "user-done",
    status: "approved",
    fulfilled_at: "2026-10-13T12:00:00.000Z",
    fulfill_attempts: 1,
  };

  let dbCalled = false;
  const origFrom = supabase.from.bind(supabase);
  supabase.from = () => {
    dbCalled = true;
    return origFrom("payments");
  };

  try {
    const result = await fulfillPayment(alreadyDonePayment);
    assert.equal(result.fulfilled_at, "2026-10-13T12:00:00.000Z");
    assert.equal(dbCalled, false, "БД не должна опрашиваться для уже выполненного платежа");
  } finally {
    supabase.from = origFrom;
  }
});
