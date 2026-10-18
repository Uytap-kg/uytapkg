import crypto from "crypto";
import { supabase } from "../../config/db.js";
import { calculateTariffTotal } from "../../constants/tariffs.js";
import { getPricingSettings } from "../../utils/pricingSettings.js";
import { activateSubscription, getActiveSubscription } from "../subscriptionsService.js";
import { applyPromotion } from "../promotionsService.js";
import {
  getPromotionOrderByOrderId,
  markPromotionOrderStatus,
} from "../../utils/promotionOrders.js";
import * as odengi from "../odengiService.js";
import { odengiConfig } from "../../config/odengi.js";
import { alerts } from "../../utils/alerts.js";
import { logger } from "../../utils/logger.js";
import * as repo from "./paymentsRepo.js";

export const PROMOTION_TARIFF_PREFIX = "promo_";

export const SERVICE_TITLES = {
  vip: "VIP-размещение",
  top: "Поднятие в ТОП",
  urgent: "Срочная публикация",
  instagram: "Instagram-продвижение",
};

// Троттлинг синхронного поллинга статуса платежа в O!Dengi
export const ODENGI_THROTTLE_MS = 10000;
export const MAX_THROTTLE_MAP_SIZE = 10000;
export const providerCheckThrottleMap = new Map();

export function clearProviderCheckThrottleMap() {
  providerCheckThrottleMap.clear();
}

// Время удержания lease выдачи услуги (2 минуты)
export const FULFILL_LEASE_MS = 2 * 60 * 1000;

let odengiClient = odengi;
export function setOdengiClient(client) {
  odengiClient = client;
}
export function resetOdengiClient() {
  odengiClient = odengi;
}
export function getOdengiClient() {
  return odengiClient;
}

export function generateOrderId() {
  return `UT${Date.now()}${crypto.randomBytes(6).toString("hex")}`;
}

export function toPublicPayment(payment) {
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
    qrUrl: payment.qr_url,
    paylink_url: payment.paylink_url,
    linkApp: payment.link_app,
    paidAt: payment.paid_at,
    createdAt: payment.created_at,
  };
}

/**
 * 1. Создать платёж за тарифную подписку PRO.
 */
export async function createSubscriptionPayment({ userId, tariffId, months }) {
  if (!tariffId || months === undefined) {
    return { error: "bad_request", message: "tariffId и months обязательны" };
  }

  // Защита активного индивидуального тарифа
  const currentSub = await getActiveSubscription(userId);
  if (currentSub?.is_individual) {
    return {
      error: "conflict",
      message:
        "У вас активен персональный корпоративный тариф. Для смены тарифа обратитесь к администратору",
    };
  }

  // Расчёт суммы только на сервере
  const pricing = await getPricingSettings();
  const calc = calculateTariffTotal(tariffId, months, pricing);

  if (!calc || calc.total <= 0) {
    return { error: "bad_request", message: "Неизвестный тариф или период оплаты" };
  }

  const orderId = generateOrderId();
  const amountKopecks = Math.round(calc.total * 100);

  const { data: payment, error: insertError } = await repo.createPendingPayment({
    userId,
    orderId,
    tariffId: calc.tariff.id,
    months: calc.months,
    amountKopecks,
  });

  if (insertError || !payment) {
    logger.error("Create Payment Insert Error", { error: insertError?.message });
    return { error: "db_error", message: "Не удалось создать платёж" };
  }

  let invoice;
  try {
    invoice = await odengiClient.createInvoice({
      orderId,
      description: `UyTap PRO — тариф ${calc.tariff.title}, ${calc.months} мес.`,
      amountKopecks,
    });
  } catch (providerError) {
    logger.error("O!Dengi createInvoice Error", { error: providerError?.message });
    await repo.updatePaymentStatus(payment.id, "failed");
    return {
      error: "service_unavailable",
      message: "Платёжный сервис временно недоступен. Попробуйте позже.",
    };
  }

  const { data: updated, error: updateError } = await repo.updatePaymentInvoice(
    payment.id,
    invoice
  );

  if (updateError || !updated) {
    logger.error("Update Payment After Invoice Error", { error: updateError?.message });
    return { error: "db_error", message: "Не удалось сохранить данные счёта" };
  }

  return {
    data: {
      ...toPublicPayment(updated),
      tariffTitle: calc.tariff.title,
      pricePerMonth: calc.pricePerMonth,
      discountPercent: calc.discountPercent,
    },
  };
}

/**
 * 2. Создать платёж за разовое продвижение объявления (атомарно через RPC).
 */
export async function createPromotionPayment({ userId, listingId, serviceType, days: inputDays }) {
  const days = serviceType === "instagram" ? 1 : inputDays || 1;

  // Проверка принадлежности объявления
  const { data: listing, error: listingError } = await supabase
    .from("listings")
    .select("id, user_id, title")
    .eq("id", listingId)
    .maybeSingle();

  if (listingError || !listing) {
    return { error: "not_found", message: "Объявление не найдено" };
  }

  if (listing.user_id !== userId) {
    return {
      error: "forbidden",
      message: "Вы можете продвигать только свои объявления",
    };
  }

  // Расчёт стоимости
  const pricing = await getPricingSettings();
  const pricePerUnit = Number(pricing.services?.[serviceType]);

  if (!Number.isFinite(pricePerUnit) || pricePerUnit <= 0) {
    return { error: "bad_request", message: "Неизвестная услуга продвижения" };
  }

  const total = serviceType === "instagram" ? pricePerUnit : pricePerUnit * days;
  const orderId = generateOrderId();
  const amountKopecks = Math.round(total * 100);
  const tariffId = `${PROMOTION_TARIFF_PREFIX}${serviceType}`;

  // Атомарное создание payments + promotion_orders
  const { data: payment, error: insertError } = await repo.createPromotionPaymentRecord({
    userId,
    orderId,
    tariffId,
    days,
    amountKopecks,
    listingId,
    serviceType,
  });

  if (insertError || !payment) {
    logger.error("Create Promotion Payment Insert Error", { error: insertError?.message });
    return { error: "db_error", message: "Не удалось создать платёж" };
  }

  let invoice;
  try {
    invoice = await odengiClient.createInvoice({
      orderId,
      description: `UyTap — ${SERVICE_TITLES[serviceType]}${
        serviceType === "instagram" ? "" : `, ${days} дн.`
      } — «${listing.title}»`,
      amountKopecks,
    });
  } catch (providerError) {
    logger.error("O!Dengi createInvoice Error (promotion)", {
      error: providerError?.message,
    });
    await repo.updatePaymentStatus(payment.id, "failed");
    return {
      error: "service_unavailable",
      message: "Платёжный сервис временно недоступен. Попробуйте позже.",
    };
  }

  const { data: updated, error: updateError } = await repo.updatePaymentInvoice(
    payment.id,
    invoice
  );

  if (updateError || !updated) {
    logger.error("Update Promotion Payment After Invoice Error", {
      error: updateError?.message,
    });
    return { error: "db_error", message: "Не удалось сохранить данные счёта" };
  }

  return {
    data: {
      ...toPublicPayment(updated),
      serviceType,
      serviceTitle: SERVICE_TITLES[serviceType],
      listingId,
      listingTitle: listing.title,
      days,
      pricePerUnit,
    },
  };
}

/**
 * 3. Выдача оплаченной услуги (подписка или продвижение).
 * Защищена lease-блокировкой через fulfilling_at.
 */
export async function fulfillPayment(payment) {
  if (!payment) return null;
  if (payment.fulfilled_at) {
    return payment;
  }

  const leaseCutoff = new Date(Date.now() - FULFILL_LEASE_MS).toISOString();
  const { data: claimedRow, error: claimError } = await repo.claimPaymentFulfillment(
    payment.id,
    leaseCutoff
  );

  if (claimError) {
    if (claimError.code === "42703" || claimError.code === "PGRST204") {
      console.warn(
        "⚠️ payments.fulfilling_at отсутствует — примените миграцию 20261013000100_payment_fulfillment_lease.sql. Выдача идёт без блокировки."
      );
    } else {
      console.error("Fulfill Payment claim DB error:", claimError);
      return payment;
    }
  } else if (!claimedRow) {
    // Другой параллельный процесс уже выдаёт (или выдал) услугу
    const { data: latest } = await repo.findPaymentById(payment.id);
    return latest || payment;
  } else {
    payment = claimedRow;
  }

  const nextAttempts = (payment.fulfill_attempts || 0) + 1;
  const now = new Date().toISOString();

  try {
    if (payment.tariff_id?.startsWith(PROMOTION_TARIFF_PREFIX)) {
      const order = await getPromotionOrderByOrderId(payment.order_id);
      if (!order) {
        throw new Error(`Заказ на продвижение для order_id ${payment.order_id} не найден`);
      }
      await applyPromotion(order);
    } else {
      await activateSubscription(
        payment.user_id,
        payment.tariff_id,
        payment.months,
        payment.order_id || payment.id
      );
    }

    const { data: updated, error: updateError } = await repo.markPaymentFulfilled(
      payment.id,
      nextAttempts,
      now
    );

    if (updateError) {
      console.error("Fulfill Payment update success DB error:", updateError);
      return {
        ...payment,
        fulfilled_at: now,
        fulfill_attempts: nextAttempts,
        fulfill_error: null,
        updated_at: now,
      };
    }

    return (
      updated || {
        ...payment,
        fulfilled_at: now,
        fulfill_attempts: nextAttempts,
        fulfill_error: null,
        updated_at: now,
      }
    );
  } catch (error) {
    const errorMessage = error?.message || String(error);
    console.error(`Fulfill Payment Error for payment ${payment.id}:`, error);

    if (nextAttempts >= 3) {
      console.error(
        `[CRITICAL PAYMENT ALERT] Fulfillment failed >3 times for payment ${payment.id}:`,
        payment.id,
        error
      );
      try {
        await alerts.critical(`Критический сбой выдачи услуги (>3 попыток)`, {
          paymentId: payment.id,
          orderId: payment.order_id,
          attempts: nextAttempts,
        });
      } catch (alertErr) {
        // Safe guard against alert dispatcher errors
      }
    }

    // ВАЖНО: статус платежа ОБЯЗАН оставаться "approved"! Не переводить в failed/canceled.
    const { data: updated, error: updateError } = await repo.markPaymentFulfillFailed(
      payment.id,
      nextAttempts,
      errorMessage,
      now
    );

    if (updateError) {
      console.error("Fulfill Payment update error DB failed:", updateError);
    }

    return (
      updated || {
        ...payment,
        fulfill_attempts: nextAttempts,
        fulfill_error: errorMessage,
        updated_at: now,
      }
    );
  }
}

/**
 * 4. Сверка статуса платежа с O!Dengi и инициирование выдачи услуги при подтверждении.
 */
export async function reconcilePaymentStatus(payment) {
  if (payment.status === "approved") {
    if (!payment.fulfilled_at) {
      return await fulfillPayment(payment);
    }
    return payment;
  }

  if (payment.status === "canceled" || payment.status === "failed") {
    return payment;
  }

  // Троттлинг синхронного обращения к O!Dengi
  const now = Date.now();
  const lastCheck = providerCheckThrottleMap.get(payment.order_id);
  if (lastCheck && now - lastCheck < ODENGI_THROTTLE_MS) {
    return payment;
  }

  providerCheckThrottleMap.set(payment.order_id, now);

  if (providerCheckThrottleMap.size > MAX_THROTTLE_MAP_SIZE) {
    for (const [key, timestamp] of providerCheckThrottleMap.entries()) {
      if (now - timestamp >= ODENGI_THROTTLE_MS) {
        providerCheckThrottleMap.delete(key);
      }
    }
  }

  const statusData = await odengiClient.statusPayment({
    invoiceId: payment.invoice_id,
    orderId: payment.order_id,
  });

  const paymentAttempt = Array.isArray(statusData?.payments)
    ? statusData.payments[statusData.payments.length - 1]
    : null;

  const providerStatus = paymentAttempt?.status || statusData?.status;

  if (providerStatus === "approved") {
    const { data: claimed } = await repo.claimPaymentApproved(payment.id, {
      transId: paymentAttempt?.trans_id || null,
      paidAt: paymentAttempt?.date_pay
        ? new Date(paymentAttempt.date_pay).toISOString()
        : new Date().toISOString(),
      providerResponse: statusData,
    });

    if (claimed) {
      return await fulfillPayment(claimed);
    } else {
      const { data: latest } = await repo.findPaymentById(payment.id);
      if (latest) {
        if (!latest.fulfilled_at) {
          return await fulfillPayment(latest);
        }
        return latest;
      }
    }
  } else if (providerStatus === "canceled") {
    const { data: updated } = await repo.markPaymentCanceledByProvider(payment.id, statusData);
    if (updated) return updated;
  }

  return payment;
}

/**
 * 5. Получить статус платежа по orderId и userId.
 */
export async function getPaymentStatusService({ orderId, userId }) {
  const { data: payment, error } = await repo.findPaymentByOrderIdAndUser(orderId, userId);

  if (error) {
    logger.error("Get Payment Status Error", { error: error.message });
    return { error: "db_error", message: "Ошибка при получении статуса платежа" };
  }

  if (!payment) {
    return { error: "not_found", message: "Платёж не найден" };
  }

  let current = payment;
  try {
    current = await reconcilePaymentStatus(payment);
  } catch (providerError) {
    logger.error("Reconcile Payment Status Error", { error: providerError?.message });
  }

  return { data: toPublicPayment(current) };
}

/**
 * 6. Отмена неоплаченного счёта пользователем.
 */
export async function cancelPaymentService({ orderId, userId }) {
  const { data: payment, error } = await repo.findPaymentByOrderIdAndUser(orderId, userId);

  if (error || !payment) {
    return { error: "not_found", message: "Платёж не найден" };
  }

  if (payment.status !== "processing" && payment.status !== "pending") {
    return { error: "conflict", message: "Этот платёж нельзя отменить" };
  }

  let current = payment;
  try {
    current = await reconcilePaymentStatus(payment);
  } catch (providerError) {
    logger.error("Cancel Payment Reconcile Error", { error: providerError?.message });
  }

  if (current.status === "approved") {
    return {
      error: "already_approved",
      message: "Платёж уже подтверждён и не может быть отменён",
      data: toPublicPayment(current),
    };
  }

  if (current.status !== "processing" && current.status !== "pending") {
    return { success: true };
  }

  if (current.invoice_id) {
    try {
      await odengiClient.invoiceCancel({ invoiceId: current.invoice_id });
    } catch (providerError) {
      logger.error("O!Dengi invoiceCancel Error", { error: providerError?.message });
    }
  }

  await repo.cancelPaymentRecord(current.id);

  if (current.tariff_id?.startsWith(PROMOTION_TARIFF_PREFIX)) {
    try {
      await markPromotionOrderStatus(current.order_id, "canceled");
    } catch (orderError) {
      logger.error("Cancel Payment Mark Promotion Order Canceled Error", {
        error: orderError?.message,
      });
    }
  }

  return { success: true };
}

export function verifyOdengiWebhookHash(body) {
  if (!body || typeof body !== "object") return false;
  const incomingHash = body.hash;
  if (!incomingHash || typeof incomingHash !== "string") {
    return true; // хэш не передан
  }

  const secret = odengiConfig.password;
  if (!secret) return false;

  // 1. Формат O!Dengi { cmd, version, sid, mktime, lang, data, hash }
  if (body.cmd && body.data) {
    const payload = {
      cmd: body.cmd,
      version: body.version,
      sid: body.sid,
      mktime: body.mktime,
      lang: body.lang,
      data: body.data,
    };
    const expected = crypto.createHmac("md5", secret).update(JSON.stringify(payload)).digest("hex");
    return expected.toLowerCase() === incomingHash.toLowerCase();
  }

  // 2. Формат JSON без hash
  const copy = { ...body };
  delete copy.hash;
  const expected = crypto.createHmac("md5", secret).update(JSON.stringify(copy)).digest("hex");
  if (expected.toLowerCase() === incomingHash.toLowerCase()) {
    return true;
  }

  // 3. Формат HMAC от order_id
  const orderId = body.order_id || body.data?.order_id;
  if (orderId) {
    const orderExpected = crypto.createHmac("md5", secret).update(String(orderId)).digest("hex");
    if (orderExpected.toLowerCase() === incomingHash.toLowerCase()) {
      return true;
    }
  }

  return false;
}

/**
 * 7. Обработка входящего webhook от O!Dengi с валидацией подписи.
 */
export async function handleWebhookService(orderId, body = null) {
  if (
    !orderId ||
    typeof orderId !== "string" ||
    orderId.length > 100 ||
    !/^[a-zA-Z0-9_\-]+$/.test(orderId)
  ) {
    return { invalid: true, message: "Некорректный order_id" };
  }

  if (body && body.hash) {
    const isHashValid = verifyOdengiWebhookHash(body);
    if (!isHashValid) {
      logger.warn("Webhook rejected: invalid HMAC hash", { orderId });
      return { invalid: true, message: "Неверная подпись webhook" };
    }
  }

  const { data: payment } = await repo.findPaymentByOrderId(orderId);

  if (payment) {
    try {
      await reconcilePaymentStatus(payment);
    } catch (providerError) {
      logger.error("Result URL Reconcile Error", { error: providerError?.message });
    }
  }

  return { success: true };
}

/**
 * 8. Повторная выдача услуги администратором (refulfill).
 */
export async function refulfillPaymentService(id) {
  if (!id) {
    return { error: "bad_request", message: "ID платежа обязателен" };
  }

  const { data: payment, error } = await repo.findPaymentById(id);

  if (error) {
    logger.error("Refulfill Payment DB Error", { error: error.message });
    return { error: "db_error", message: "Ошибка при получении платежа" };
  }

  if (!payment) {
    return { error: "not_found", message: "Платёж не найден" };
  }

  if (payment.status !== "approved") {
    return {
      error: "bad_request",
      message: "Повторная выдача услуги возможна только для оплаченных (approved) платежей",
    };
  }

  const updatedPayment = await fulfillPayment(payment);

  return {
    success: true,
    data: {
      ...updatedPayment,
      ...toPublicPayment(updatedPayment),
    },
  };
}
