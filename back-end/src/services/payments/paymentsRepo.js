import { supabase } from "../../config/db.js";
import { createPromotionOrder } from "../../utils/promotionOrders.js";

/**
 * Создать базовую запись платежа в статусе 'pending' (для подписок PRO).
 */
export async function createPendingPayment({
  userId,
  orderId,
  tariffId,
  months,
  amountKopecks,
}) {
  return await supabase
    .from("payments")
    .insert({
      user_id: userId,
      order_id: orderId,
      tariff_id: tariffId,
      months,
      amount: amountKopecks,
      status: "pending",
    })
    .select()
    .single();
}

/**
 * Атомарно создать платёж и заказ продвижения.
 * Сначала пытается вызвать RPC create_promotion_payment; при отсутствии функции
 * в БД (старая схема в тестах/локально) безопасно деградирует до последовательной вставки.
 */
export async function createPromotionPaymentRecord({
  userId,
  orderId,
  tariffId,
  days,
  amountKopecks,
  listingId,
  serviceType,
}) {
  const { data: rpcPayment, error: rpcError } = await supabase.rpc(
    "create_promotion_payment",
    {
      p_user_id: userId,
      p_order_id: orderId,
      p_tariff_id: tariffId,
      p_days: days,
      p_amount: amountKopecks,
      p_listing_id: listingId,
      p_service_type: serviceType,
    }
  );

  if (!rpcError && rpcPayment) {
    return { data: rpcPayment, error: null };
  }

  // Если RPC отсутствует в БД (код 42883 или PGRST202), используем последовательную вставку
  if (
    rpcError &&
    (rpcError.code === "42883" ||
      rpcError.code === "PGRST202" ||
      rpcError.message?.includes("function") ||
      rpcError.message?.includes("not found"))
  ) {
    const { data: payment, error: insertError } = await supabase
      .from("payments")
      .insert({
        user_id: userId,
        order_id: orderId,
        tariff_id: tariffId,
        months: days,
        amount: amountKopecks,
        status: "pending",
      })
      .select()
      .single();

    if (insertError) {
      return { data: null, error: insertError };
    }

    try {
      await createPromotionOrder({ orderId, userId, listingId, serviceType, days });
    } catch (orderError) {
      console.error("paymentsRepo: createPromotionOrder fallback error:", orderError);
    }

    return { data: payment, error: null };
  }

  return { data: null, error: rpcError };
}

/**
 * Найти платёж по ID.
 */
export async function findPaymentById(id) {
  return await supabase
    .from("payments")
    .select("*")
    .eq("id", id)
    .maybeSingle();
}

/**
 * Найти платёж по order_id.
 */
export async function findPaymentByOrderId(orderId) {
  return await supabase
    .from("payments")
    .select("*")
    .eq("order_id", orderId)
    .maybeSingle();
}

/**
 * Найти платёж по order_id и user_id.
 */
export async function findPaymentByOrderIdAndUser(orderId, userId) {
  return await supabase
    .from("payments")
    .select("*")
    .eq("order_id", orderId)
    .eq("user_id", userId)
    .maybeSingle();
}

/**
 * Атомарный захват lease для выдачи услуги.
 */
export async function claimPaymentFulfillment(paymentId, leaseCutoff) {
  return await supabase
    .from("payments")
    .update({ fulfilling_at: new Date().toISOString() })
    .eq("id", paymentId)
    .is("fulfilled_at", null)
    .or(`fulfilling_at.is.null,fulfilling_at.lt.${leaseCutoff}`)
    .select()
    .maybeSingle();
}

/**
 * Зафиксировать успешную выдачу услуги.
 */
export async function markPaymentFulfilled(paymentId, nextAttempts, now) {
  return await supabase
    .from("payments")
    .update({
      fulfilled_at: now,
      fulfilling_at: null,
      fulfill_attempts: nextAttempts,
      fulfill_error: null,
      updated_at: now,
    })
    .eq("id", paymentId)
    .select()
    .maybeSingle();
}

/**
 * Зафиксировать сбой выдачи услуги (статус остаётся approved!).
 */
export async function markPaymentFulfillFailed(paymentId, nextAttempts, errorMessage, now) {
  return await supabase
    .from("payments")
    .update({
      fulfill_attempts: nextAttempts,
      fulfill_error: errorMessage,
      fulfilling_at: null,
      updated_at: now,
    })
    .eq("id", paymentId)
    .select()
    .maybeSingle();
}

/**
 * Атомарно перевести платёж в approved при подтверждении от шлюза O!Dengi.
 */
export async function claimPaymentApproved(paymentId, { transId, paidAt, providerResponse }) {
  return await supabase
    .from("payments")
    .update({
      status: "approved",
      trans_id: transId || null,
      paid_at: paidAt || new Date().toISOString(),
      provider_response: providerResponse,
      updated_at: new Date().toISOString(),
    })
    .eq("id", paymentId)
    .neq("status", "approved")
    .select()
    .maybeSingle();
}

/**
 * Обновить данные выставленного счёта O!Dengi (статус processing).
 */
export async function updatePaymentInvoice(paymentId, invoice) {
  return await supabase
    .from("payments")
    .update({
      invoice_id: invoice.invoice_id,
      qr_url: invoice.qr || invoice.emv_qr || null,
      paylink_url: invoice.paylink_url || null,
      link_app: invoice.link_app || null,
      provider_response: invoice,
      status: "processing",
      updated_at: new Date().toISOString(),
    })
    .eq("id", paymentId)
    .select()
    .single();
}

/**
 * Обновить статус платежа.
 */
export async function updatePaymentStatus(paymentId, status, extraFields = {}) {
  return await supabase
    .from("payments")
    .update({
      status,
      updated_at: new Date().toISOString(),
      ...extraFields,
    })
    .eq("id", paymentId)
    .select()
    .maybeSingle();
}

/**
 * Отменить платёж пользователем (только если он ещё не approved).
 */
export async function cancelPaymentRecord(paymentId) {
  return await supabase
    .from("payments")
    .update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("id", paymentId)
    .neq("status", "approved");
}

/**
 * Отменить платёж по ответу провайдера O!Dengi.
 */
export async function markPaymentCanceledByProvider(paymentId, providerResponse) {
  return await supabase
    .from("payments")
    .update({
      status: "canceled",
      provider_response: providerResponse,
      updated_at: new Date().toISOString(),
    })
    .eq("id", paymentId)
    .select()
    .maybeSingle();
}
