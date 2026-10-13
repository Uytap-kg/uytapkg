import test from "node:test";
import assert from "node:assert/strict";

import {
  reconcilePaymentStatus,
  providerCheckThrottleMap,
  clearProviderCheckThrottleMap,
  setOdengiClient,
  resetOdengiClient,
  ODENGI_THROTTLE_MS,
  MAX_THROTTLE_MAP_SIZE,
} from "../src/controllers/paymentsController.js";

test("Дефект 2.4: Первый вызов для pending платежа вызывает odengi.statusPayment и заполняет карту троттлинга", async () => {
  clearProviderCheckThrottleMap();

  let statusPaymentCalls = 0;
  setOdengiClient({
    statusPayment: async ({ orderId }) => {
      statusPaymentCalls++;
      return {
        status: "pending",
        order_id: orderId,
      };
    },
  });

  try {
    const payment = {
      id: "pay-1",
      order_id: "order-test-1",
      invoice_id: "inv-1",
      status: "pending",
    };

    const res = await reconcilePaymentStatus(payment);
    assert.equal(res.status, "pending");
    assert.equal(statusPaymentCalls, 1, "Первый вызов должен обратиться к odengi.statusPayment");
    assert.ok(providerCheckThrottleMap.has("order-test-1"), "Карта троттлинга должна зафиксировать order-test-1");
  } finally {
    resetOdengiClient();
    clearProviderCheckThrottleMap();
  }
});

test("Дефект 2.4: Частый повторный поллинг (< 10 сек) НЕ вызывает внешний шлюз O!Dengi и возвращает текущий платёж", async () => {
  clearProviderCheckThrottleMap();

  let statusPaymentCalls = 0;
  setOdengiClient({
    statusPayment: async ({ orderId }) => {
      statusPaymentCalls++;
      return {
        status: "pending",
        order_id: orderId,
      };
    },
  });

  try {
    const payment = {
      id: "pay-2",
      order_id: "order-test-2",
      invoice_id: "inv-2",
      status: "pending",
    };

    // 1-й вызов — делает запрос
    await reconcilePaymentStatus(payment);
    assert.equal(statusPaymentCalls, 1);

    // 2-й, 3-й, 4-й вызовы сразу следом — должны быть затроттлены
    const res2 = await reconcilePaymentStatus(payment);
    const res3 = await reconcilePaymentStatus(payment);
    const res4 = await reconcilePaymentStatus(payment);

    assert.equal(res2.id, "pay-2");
    assert.equal(res3.id, "pay-2");
    assert.equal(res4.id, "pay-2");
    assert.equal(statusPaymentCalls, 1, "statusPayment не должен вызываться чаще 1 раза в 10 секунд");
  } finally {
    resetOdengiClient();
    clearProviderCheckThrottleMap();
  }
});

test("Дефект 2.4: По истечении 10 секунд троттлинг сбрасывается и новый запрос к O!Dengi разрешается", async () => {
  clearProviderCheckThrottleMap();

  let statusPaymentCalls = 0;
  setOdengiClient({
    statusPayment: async ({ orderId }) => {
      statusPaymentCalls++;
      return {
        status: "pending",
        order_id: orderId,
      };
    },
  });

  try {
    const payment = {
      id: "pay-3",
      order_id: "order-test-3",
      invoice_id: "inv-3",
      status: "pending",
    };

    // 1-й вызов
    await reconcilePaymentStatus(payment);
    assert.equal(statusPaymentCalls, 1);

    // Имитируем прошествие 10 секунд (ODENGI_THROTTLE_MS + 1)
    providerCheckThrottleMap.set("order-test-3", Date.now() - (ODENGI_THROTTLE_MS + 500));

    // 2-й вызов после истечения таймаута
    await reconcilePaymentStatus(payment);
    assert.equal(statusPaymentCalls, 2, "После истечения 10 секунд должен произойти повторный запрос к шлюзу");
  } finally {
    resetOdengiClient();
    clearProviderCheckThrottleMap();
  }
});

test("Дефект 2.4: Платежи в статусах approved и canceled никогда не обращаются к O!Dengi", async () => {
  let statusPaymentCalls = 0;
  setOdengiClient({
    statusPayment: async () => {
      statusPaymentCalls++;
      return { status: "approved" };
    },
  });

  try {
    const approvedPayment = {
      id: "pay-app",
      order_id: "order-app",
      status: "approved",
      fulfilled_at: new Date().toISOString(),
    };
    const canceledPayment = {
      id: "pay-can",
      order_id: "order-can",
      status: "canceled",
    };

    await reconcilePaymentStatus(approvedPayment);
    await reconcilePaymentStatus(canceledPayment);

    assert.equal(statusPaymentCalls, 0, "Для approved и canceled статус шлюз вызываться не должен");
  } finally {
    resetOdengiClient();
  }
});

test("Дефект 2.4: Memory Leak Protection очищает устаревшие записи при превышении MAX_THROTTLE_MAP_SIZE", async () => {
  clearProviderCheckThrottleMap();

  const now = Date.now();
  // Заполняем карту старыми записями
  for (let i = 0; i < MAX_THROTTLE_MAP_SIZE + 50; i++) {
    providerCheckThrottleMap.set(`order-old-${i}`, now - (ODENGI_THROTTLE_MS + 1000));
  }

  assert.ok(providerCheckThrottleMap.size > MAX_THROTTLE_MAP_SIZE);

  setOdengiClient({
    statusPayment: async () => ({ status: "pending" }),
  });

  try {
    const freshPayment = {
      id: "pay-leak-test",
      order_id: "order-leak-test",
      invoice_id: "inv-leak",
      status: "pending",
    };

    await reconcilePaymentStatus(freshPayment);

    // Устаревшие записи должны быть удалены
    assert.equal(
      providerCheckThrottleMap.size,
      1,
      "Все устаревшие записи должны быть очищены из карты троттлинга"
    );
    assert.ok(providerCheckThrottleMap.has("order-leak-test"));
  } finally {
    resetOdengiClient();
    clearProviderCheckThrottleMap();
  }
});
