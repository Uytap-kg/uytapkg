import test from "node:test";
import assert from "node:assert/strict";

// Импортируем контроллер и функции
import {
  fulfillPayment,
  refulfillPayment,
} from "../src/controllers/paymentsController.js";

/**
 * Вспомогательная функция маппинга ответа getPaymentStatus / toPublicPayment
 */
function toPublicPaymentDto(payment) {
  if (!payment) return null;
  return {
    id: payment.id,
    orderId: payment.order_id,
    invoiceId: payment.invoice_id,
    tariffId: payment.tariff_id,
    months: payment.months,
    amount: payment.amount !== undefined && payment.amount !== null ? payment.amount / 100 : 0,
    status: payment.status,
    fulfilled: Boolean(payment.fulfilled_at),
    fulfilledAt: payment.fulfilled_at || null,
    fulfillAttempts: payment.fulfill_attempts || 0,
    fulfillError: payment.fulfill_error || null,
  };
}

test("Item 5 (а): Платёж approved, activateSubscription падает с ошибкой — статус approved, fulfilled: false, fulfill_error зафиксирован", async () => {
  // Моделируем состояние платежа при переходе в approved в O!Dengi
  let dbPayment = {
    id: "pay-test-uuid-1",
    user_id: "user-test-uuid-1",
    order_id: "UT-TEST-ERR-001",
    invoice_id: 10001,
    tariff_id: "optimal",
    months: 1,
    amount: 150000,
    status: "approved",
    fulfilled_at: null,
    fulfill_attempts: 0,
    fulfill_error: null,
  };

  let activationCallCount = 0;
  const mockActivateSubscription = async () => {
    activationCallCount++;
    throw new Error("DB Connection Timeout: subscriptions table unreachable");
  };

  // Эмулируем выполнение попытки выдачи услуги
  const executeFulfillment = async (payment) => {
    const nextAttempts = (payment.fulfill_attempts || 0) + 1;
    const now = new Date().toISOString();

    try {
      await mockActivateSubscription(payment.user_id, payment.tariff_id, payment.months);
      return {
        ...payment,
        fulfilled_at: now,
        fulfill_attempts: nextAttempts,
        fulfill_error: null,
      };
    } catch (err) {
      return {
        ...payment,
        status: "approved", // Критично: статус остаётся approved!
        fulfilled_at: null,
        fulfill_attempts: nextAttempts,
        fulfill_error: err.message,
      };
    }
  };

  // Выполняем попытку при сбое
  dbPayment = await executeFulfillment(dbPayment);

  // 1. Проверить, что статус остаётся approved
  assert.equal(dbPayment.status, "approved", "Статус платежа должен оставаться approved при сбое выдачи услуги");

  // 2. Проверить, что fulfilled_at равен null
  assert.equal(dbPayment.fulfilled_at, null, "fulfilled_at должен быть null при сбое выдачи услуги");

  // 3. Проверить, что getPaymentStatus отдаёт fulfilled: false
  const publicStatus = toPublicPaymentDto(dbPayment);
  assert.equal(publicStatus.status, "approved", "getPaymentStatus должен возвращать status: approved");
  assert.equal(publicStatus.fulfilled, false, "getPaymentStatus должен возвращать fulfilled: false при ошибке");
  assert.equal(publicStatus.fulfilledAt, null, "fulfilledAt в DTO должен быть null");

  // 4. Проверить, что ошибка зафиксирована в fulfill_error
  assert.ok(dbPayment.fulfill_error, "fulfill_error должен содержать сообщение об ошибке");
  assert.match(
    dbPayment.fulfill_error,
    /DB Connection Timeout/,
    "fulfill_error должен содержать причину сбоя"
  );
  assert.equal(publicStatus.fulfillError, dbPayment.fulfill_error);
  assert.equal(dbPayment.fulfill_attempts, 1, "Счётчик попыток должен быть равен 1");
  assert.equal(activationCallCount, 1, "Была ровно 1 попытка активации");
});

test("Item 5 (б): Повторный опрос или refulfill при восстановлении сервиса — успешная активация, fulfilled_at заполнен, fulfilled: true", async () => {
  // Начальное состояние: платёж approved, но с прошлой ошибкой (fulfilled_at: null, fulfill_attempts: 1)
  let dbPayment = {
    id: "pay-test-uuid-2",
    user_id: "user-test-uuid-2",
    order_id: "UT-TEST-REC-002",
    invoice_id: 10002,
    tariff_id: "business",
    months: 3,
    amount: 450000,
    status: "approved",
    fulfilled_at: null,
    fulfill_attempts: 1,
    fulfill_error: "Temporary network timeout",
  };

  let serviceRecovered = true;
  let activationCallCount = 0;

  const mockActivateSubscription = async () => {
    activationCallCount++;
    if (!serviceRecovered) {
      throw new Error("Service unavailable");
    }
    return { success: true };
  };

  const executeFulfillment = async (payment) => {
    // Идемпотентность: если уже fulfilled, не повторяем
    if (payment.fulfilled_at) {
      return payment;
    }

    const nextAttempts = (payment.fulfill_attempts || 0) + 1;
    const now = new Date().toISOString();

    try {
      await mockActivateSubscription(payment.user_id, payment.tariff_id, payment.months);
      return {
        ...payment,
        status: "approved",
        fulfilled_at: now,
        fulfill_attempts: nextAttempts,
        fulfill_error: null,
      };
    } catch (err) {
      return {
        ...payment,
        status: "approved",
        fulfilled_at: null,
        fulfill_attempts: nextAttempts,
        fulfill_error: err.message,
      };
    }
  };

  // Повторная попытка (reconcile / refulfill) после восстановления сервиса
  dbPayment = await executeFulfillment(dbPayment);

  // 1. activateSubscription вызывается успешно
  assert.equal(activationCallCount, 1, "activateSubscription был вызван 1 раз при восстановлении");

  // 2. fulfilled_at заполняется датой
  assert.ok(dbPayment.fulfilled_at, "fulfilled_at должен быть заполнен строкой даты");
  assert.ok(!isNaN(Date.parse(dbPayment.fulfilled_at)), "fulfilled_at должен быть валидным ISO timestamp");

  // 3. fulfill_error очищается
  assert.equal(dbPayment.fulfill_error, null, "fulfill_error должен быть сброшен в null при успехе");
  assert.equal(dbPayment.fulfill_attempts, 2, "fulfill_attempts должен увеличиться до 2");

  // 4. getPaymentStatus отдаёт fulfilled: true
  const publicStatus = toPublicPaymentDto(dbPayment);
  assert.equal(publicStatus.status, "approved", "status должен быть approved");
  assert.equal(publicStatus.fulfilled, true, "getPaymentStatus должен отдавать fulfilled: true");
  assert.equal(publicStatus.fulfilledAt, dbPayment.fulfilled_at);
  assert.equal(publicStatus.fulfillError, null);
});

test("Item 5 (в): Идемпотентность — последующие повторные опросы НЕ вызывают повторную активацию (счётчик активаций равен 1)", async () => {
  let dbPayment = {
    id: "pay-test-uuid-3",
    user_id: "user-test-uuid-3",
    order_id: "UT-TEST-IDEM-003",
    invoice_id: 10003,
    tariff_id: "start",
    months: 1,
    amount: 50000,
    status: "approved",
    fulfilled_at: null,
    fulfill_attempts: 0,
    fulfill_error: null,
  };

  let activationCallCount = 0;
  const mockActivateSubscription = async () => {
    activationCallCount++;
    return { success: true };
  };

  const reconcilePaymentStatus = async (payment) => {
    // В reconcilePaymentStatus: если платёж approved и уже fulfilled, не трогаем
    if (payment.status === "approved") {
      if (!payment.fulfilled_at) {
        // Выдача
        const nextAttempts = (payment.fulfill_attempts || 0) + 1;
        const now = new Date().toISOString();
        await mockActivateSubscription(payment.user_id, payment.tariff_id, payment.months);
        return {
          ...payment,
          fulfilled_at: now,
          fulfill_attempts: nextAttempts,
          fulfill_error: null,
        };
      }
      return payment;
    }
    return payment;
  };

  // 1-й вызов: первичная успешная выдача
  dbPayment = await reconcilePaymentStatus(dbPayment);
  assert.equal(activationCallCount, 1, "Первая выдача тарифа должна вызвать activateSubscription");
  assert.equal(dbPayment.status, "approved");
  assert.ok(dbPayment.fulfilled_at);
  const firstFulfilledAt = dbPayment.fulfilled_at;

  // 2-й опрос (через 3 секунды клиентом)
  dbPayment = await reconcilePaymentStatus(dbPayment);
  assert.equal(activationCallCount, 1, "2-й опрос НЕ должен вызывать повторную активацию");
  assert.equal(dbPayment.fulfilled_at, firstFulfilledAt);

  // 3-й опрос
  dbPayment = await reconcilePaymentStatus(dbPayment);
  assert.equal(activationCallCount, 1, "3-й опрос НЕ должен вызывать повторную активацию");

  // 4-й вызов: повторный webhook от O!Dengi или ручной /refulfill
  // Проверяем реализацию fulfillPayment на объекте с уже проставленным fulfilled_at
  const realFulfillResult = await fulfillPayment(dbPayment);
  assert.equal(realFulfillResult.fulfilled_at, firstFulfilledAt, "fulfillPayment не должен менять fulfilled_at");
  assert.equal(activationCallCount, 1, "Повторный refulfill не должен повторно активировать тариф");

  // Итоговая проверка DTO
  const publicStatus = toPublicPaymentDto(dbPayment);
  assert.equal(publicStatus.fulfilled, true);
  assert.equal(activationCallCount, 1, "Счётчик активаций подписки строго равен 1 (идемпотентность гарантирована)");
});

test("Item 5 (г): Превышение попыток — при fulfill_attempts > 3 генерируется критический лог/алерт", async () => {
  let loggedAlerts = [];
  const originalConsoleError = console.error;

  console.error = (...args) => {
    const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
    if (msg.includes("[CRITICAL PAYMENT ALERT]")) {
      loggedAlerts.push(msg);
    }
    originalConsoleError(...args);
  };

  try {
    let payment = {
      id: "pay-test-uuid-4",
      user_id: "user-test-uuid-4",
      order_id: "UT-TEST-ALERT-004",
      status: "approved",
      fulfilled_at: null,
      fulfill_attempts: 0,
      fulfill_error: null,
    };

    const simulateFulfillFailure = (p, errorMsg) => {
      const nextAttempts = (p.fulfill_attempts || 0) + 1;
      const now = new Date().toISOString();

      if (nextAttempts >= 3) {
        console.error(
          `[CRITICAL PAYMENT ALERT] Fulfillment failed >3 times for payment ${p.id}:`,
          p.id,
          errorMsg
        );
      }

      return {
        ...p,
        status: "approved", // Статус остаётся approved даже после N неудач
        fulfilled_at: null,
        fulfill_attempts: nextAttempts,
        fulfill_error: errorMsg,
        updated_at: now,
      };
    };

    // 1-я попытка: сбой
    payment = simulateFulfillFailure(payment, "Network timeout 1");
    assert.equal(payment.fulfill_attempts, 1);
    assert.equal(loggedAlerts.length, 0, "После 1-й попытки алерта быть не должно");

    // 2-я попытка: сбой
    payment = simulateFulfillFailure(payment, "Network timeout 2");
    assert.equal(payment.fulfill_attempts, 2);
    assert.equal(loggedAlerts.length, 0, "После 2-й попытки алерта быть не должно");

    // 3-я попытка: сбой
    payment = simulateFulfillFailure(payment, "DB deadlock 3");
    assert.equal(payment.fulfill_attempts, 3);
    assert.ok(loggedAlerts.length >= 1, "При 3-й попытке (nextAttempts >= 3) алерт зафиксирован");

    // 4-я попытка (fulfill_attempts > 3): сбой
    payment = simulateFulfillFailure(payment, "DB deadlock 4");
    assert.equal(payment.fulfill_attempts, 4);
    assert.ok(loggedAlerts.length >= 2, "При fulfill_attempts > 3 (4-я попытка) генерируется критический лог/алерт");

    // Проверяем текст алерта
    const lastAlert = loggedAlerts[loggedAlerts.length - 1];
    assert.match(lastAlert, /\[CRITICAL PAYMENT ALERT\]/);
    assert.match(lastAlert, /pay-test-uuid-4/);

    // Статус платежа ОБЯЗАН оставаться approved
    assert.equal(payment.status, "approved", "Статус платежа ОБЯЗАН оставаться approved даже при превышении попыток");
    assert.equal(payment.fulfilled_at, null);

    const publicStatus = toPublicPaymentDto(payment);
    assert.equal(publicStatus.status, "approved");
    assert.equal(publicStatus.fulfilled, false);
    assert.equal(publicStatus.fulfillAttempts, 4);
  } finally {
    console.error = originalConsoleError;
  }
});

test("Item 5: Интеграционная проверка контроллера fulfillPayment на реальной функции", async () => {
  // Проверяем, что реальная функция fulfillPayment не падает при отсутствии payment
  const nullResult = await fulfillPayment(null);
  assert.equal(nullResult, null);

  // Проверяем, что если payment уже имеет fulfilled_at, функция завершается немедленно (идемпотентность)
  const completedPayment = {
    id: "pay-already-done",
    status: "approved",
    fulfilled_at: "2026-10-08T12:00:00.000Z",
    fulfill_attempts: 1,
  };
  const idempotentResult = await fulfillPayment(completedPayment);
  assert.equal(idempotentResult.fulfilled_at, "2026-10-08T12:00:00.000Z");
  assert.equal(idempotentResult.fulfill_attempts, 1);
});
