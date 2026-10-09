import crypto from "crypto";
import { supabase } from "../config/db.js";
import { calculateTariffTotal } from "../constants/tariffs.js";
import { getPricingSettings } from "../utils/pricingSettings.js";
import { createPromotionPaymentSchema } from "../utils/validation.js";
import * as odengi from "../services/odengiService.js";
import { activateSubscription, getActiveSubscription } from "../services/subscriptionsService.js";
import { applyPromotion } from "../services/promotionsService.js";
import {
  createPromotionOrder,
  getPromotionOrderByOrderId,
  markPromotionOrderStatus,
} from "../utils/promotionOrders.js";

// Разовые покупки продвижения объявления используют ту же таблицу
// `payments`, что и подписки PRO, но с tariff_id вида "promo_<serviceType>"
// (см. createPromotionPayment) — этим префиксом reconcilePaymentStatus
// отличает, что делать после подтверждения оплаты: активировать подписку
// или применить продвижение к конкретному объявлению.
const PROMOTION_TARIFF_PREFIX = "promo_";

const SERVICE_TITLES = {
  vip: "VIP-размещение",
  top: "Поднятие в ТОП",
  urgent: "Срочная публикация",
  instagram: "Instagram-продвижение",
};

function generateOrderId() {
  return `UT${Date.now()}${crypto.randomBytes(6).toString("hex")}`;
}

function toPublicPayment(payment) {
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
    paylinkUrl: payment.paylink_url,
    linkApp: payment.link_app,
    paidAt: payment.paid_at,
    createdAt: payment.created_at,
  };
}

// =======================================================
// 1. Создать платёж и выставить счёт в O!Dengi (POST /api/payments/create)
// =======================================================
export const createPayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const { tariffId, months } = req.body || {};

    if (!tariffId || months === undefined) {
      return res.status(400).json({
        success: false,
        message: "tariffId и months обязательны",
      });
    }

    // Защита активного индивидуального тарифа:
    // покупка дефолтного тарифа отклоняется с 409 Conflict
    const currentSub = await getActiveSubscription(userId);
    if (currentSub?.is_individual) {
      return res.status(409).json({
        success: false,
        message: "У вас активен персональный корпоративный тариф. Для смены тарифа обратитесь к администратору",
      });
    }

    // Сумма считается ТОЛЬКО на сервере, по актуальным ценам из настроек —
    // клиенту нельзя доверять цену
    const pricing = await getPricingSettings();
    const calc = calculateTariffTotal(tariffId, months, pricing);

    if (!calc || calc.total <= 0) {
      return res.status(400).json({
        success: false,
        message: "Неизвестный тариф или период оплаты",
      });
    }

    const orderId = generateOrderId();
    const amountKopecks = Math.round(calc.total * 100);

    const { data: payment, error: insertError } = await supabase
      .from("payments")
      .insert({
        user_id: userId,
        order_id: orderId,
        tariff_id: calc.tariff.id,
        months: calc.months,
        amount: amountKopecks,
        status: "pending",
      })
      .select()
      .single();

    if (insertError) {
      console.error("Create Payment Insert Error:", insertError);
      return res.status(500).json({
        success: false,
        message: "Не удалось создать платёж",
      });
    }

    let invoice;
    try {
      invoice = await odengi.createInvoice({
        orderId,
        description: `UyTap PRO — тариф ${calc.tariff.title}, ${calc.months} мес.`,
        amountKopecks,
      });
    } catch (providerError) {
      console.error("O!Dengi createInvoice Error:", providerError);

      await supabase
        .from("payments")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", payment.id);

      return res.status(503).json({
        success: false,
        message: "Платёжный сервис временно недоступен. Попробуйте позже.",
      });
    }

    const { data: updated, error: updateError } = await supabase
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
      .eq("id", payment.id)
      .select()
      .single();

    if (updateError) {
      console.error("Update Payment After Invoice Error:", updateError);
      return res.status(500).json({
        success: false,
        message: "Не удалось сохранить данные счёта",
      });
    }

    return res.status(201).json({
      success: true,
      data: {
        ...toPublicPayment(updated),
        tariffTitle: calc.tariff.title,
        pricePerMonth: calc.pricePerMonth,
        discountPercent: calc.discountPercent,
      },
    });
  } catch (error) {
    console.error("Create Payment Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при создании платежа",
    });
  }
};

// =======================================================
// 1.1 Разовая покупка продвижения объявления
//     (POST /api/payments/promotion/create)
// =======================================================
export const createPromotionPayment = async (req, res) => {
  try {
    const userId = req.user.id;

    const validationResult = createPromotionPaymentSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        message: validationResult.error.issues[0]?.message || "Некорректные данные запроса",
      });
    }

    const { listingId, serviceType } = validationResult.data;
    // Instagram — фиксированная разовая услуга без срока; для остальных
    // по умолчанию 1 день, если клиент не указал явно.
    const days = serviceType === "instagram" ? 1 : validationResult.data.days || 1;

    // Продвигать можно только своё объявление — иначе любой пользователь
    // мог бы платно "прокачать" чужую карточку (или наоборот, оплатить и
    // получить эффект не на том объявлении).
    const { data: listing, error: listingError } = await supabase
      .from("listings")
      .select("id, user_id, title")
      .eq("id", listingId)
      .maybeSingle();

    if (listingError || !listing) {
      return res.status(404).json({
        success: false,
        message: "Объявление не найдено",
      });
    }

    if (listing.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: "Вы можете продвигать только свои объявления",
      });
    }

    // Сумма считается ТОЛЬКО на сервере, по актуальным ценам из настроек —
    // клиенту нельзя доверять цену. vip/top/urgent — цена за день × дни;
    // instagram — фиксированная разовая цена (см. /pricing на фронте).
    const pricing = await getPricingSettings();
    const pricePerUnit = Number(pricing.services?.[serviceType]);

    if (!Number.isFinite(pricePerUnit) || pricePerUnit <= 0) {
      return res.status(400).json({
        success: false,
        message: "Неизвестная услуга продвижения",
      });
    }

    const total = serviceType === "instagram" ? pricePerUnit : pricePerUnit * days;

    const orderId = generateOrderId();
    const amountKopecks = Math.round(total * 100);
    const tariffId = `${PROMOTION_TARIFF_PREFIX}${serviceType}`;

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
      console.error("Create Promotion Payment Insert Error:", insertError);
      return res.status(500).json({
        success: false,
        message: "Не удалось создать платёж",
      });
    }

    // Записываем, к какому объявлению относится покупка, ДО создания счёта
    // в O!Dengi — чтобы запись гарантированно уже существовала к моменту,
    // когда реконсиляция статуса найдёт этот orderId.
    await createPromotionOrder({ orderId, userId, listingId, serviceType, days });

    let invoice;
    try {
      invoice = await odengi.createInvoice({
        orderId,
        description: `UyTap — ${SERVICE_TITLES[serviceType]}${
          serviceType === "instagram" ? "" : `, ${days} дн.`
        } — «${listing.title}»`,
        amountKopecks,
      });
    } catch (providerError) {
      console.error("O!Dengi createInvoice Error (promotion):", providerError);

      await supabase
        .from("payments")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", payment.id);

      return res.status(503).json({
        success: false,
        message: "Платёжный сервис временно недоступен. Попробуйте позже.",
      });
    }

    const { data: updated, error: updateError } = await supabase
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
      .eq("id", payment.id)
      .select()
      .single();

    if (updateError) {
      console.error("Update Promotion Payment After Invoice Error:", updateError);
      return res.status(500).json({
        success: false,
        message: "Не удалось сохранить данные счёта",
      });
    }

    return res.status(201).json({
      success: true,
      data: {
        ...toPublicPayment(updated),
        serviceType,
        serviceTitle: SERVICE_TITLES[serviceType],
        listingId,
        listingTitle: listing.title,
        days,
        pricePerUnit,
      },
    });
  } catch (error) {
    console.error("Create Promotion Payment Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при создании платежа",
    });
  }
};

// =======================================================
// Выдача оплаченной услуги (подписка или продвижение).
// Вынесена отдельно от фиксации approved, чтобы сбой при выдаче услуги
// (сеть, упавшая БД, ошибка в applyPromotion) не приводил к потере факта оплаты.
// Статус платежа в БД остаётся "approved", а ошибка сохраняется в fulfill_error.
// =======================================================
export async function fulfillPayment(payment) {
  if (!payment) return null;
  if (payment.fulfilled_at) {
    return payment;
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
      await activateSubscription(payment.user_id, payment.tariff_id, payment.months, payment.order_id || payment.id);
    }

    const { data: updated, error: updateError } = await supabase
      .from("payments")
      .update({
        fulfilled_at: now,
        fulfill_attempts: nextAttempts,
        fulfill_error: null,
        updated_at: now,
      })
      .eq("id", payment.id)
      .select()
      .maybeSingle();

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

    return updated || {
      ...payment,
      fulfilled_at: now,
      fulfill_attempts: nextAttempts,
      fulfill_error: null,
      updated_at: now,
    };
  } catch (error) {
    const errorMessage = error?.message || String(error);
    console.error(`Fulfill Payment Error for payment ${payment.id}:`, error);

    if (nextAttempts >= 3) {
      console.error(
        `[CRITICAL PAYMENT ALERT] Fulfillment failed >3 times for payment ${payment.id}:`,
        payment.id,
        error
      );
    }

    // ВАЖНО: статус платежа ОБЯЗАН оставаться "approved"! Не переводить в failed/canceled.
    const { data: updated, error: updateError } = await supabase
      .from("payments")
      .update({
        fulfill_attempts: nextAttempts,
        fulfill_error: errorMessage,
        updated_at: now,
      })
      .eq("id", payment.id)
      .select()
      .maybeSingle();

    if (updateError) {
      console.error("Fulfill Payment update error DB failed:", updateError);
    }

    return updated || {
      ...payment,
      fulfill_attempts: nextAttempts,
      fulfill_error: errorMessage,
      updated_at: now,
    };
  }
}

// Сверяет статус платежа с O!Dengi и, если он подтверждён:
// 1) сначала атомарно фиксирует статус "approved" в БД;
// 2) только затем вызывает fulfillPayment(payment) для выдачи услуги.
//
// Если платёж уже approved, но ещё не fulfilled (!payment.fulfilled_at),
// запускает повторную попытку fulfillPayment(payment).
async function reconcilePaymentStatus(payment) {
  if (payment.status === "approved") {
    if (!payment.fulfilled_at) {
      return await fulfillPayment(payment);
    }
    return payment;
  }

  if (payment.status === "canceled") {
    return payment;
  }

  const statusData = await odengi.statusPayment({
    invoiceId: payment.invoice_id,
    orderId: payment.order_id,
  });

  const paymentAttempt = Array.isArray(statusData?.payments)
    ? statusData.payments[statusData.payments.length - 1]
    : null;

  const providerStatus = paymentAttempt?.status || statusData?.status;

  if (providerStatus === "approved") {
    // Шаг 1: Атомарно фиксируем переход в approved, trans_id, paid_at в БД.
    // Факт оплаты надёжно фиксируется ДО вызова выдачи услуги.
    const { data: claimed } = await supabase
      .from("payments")
      .update({
        status: "approved",
        trans_id: paymentAttempt?.trans_id || null,
        paid_at: paymentAttempt?.date_pay
          ? new Date(paymentAttempt.date_pay).toISOString()
          : new Date().toISOString(),
        provider_response: statusData,
        updated_at: new Date().toISOString(),
      })
      .eq("id", payment.id)
      .neq("status", "approved")
      .select()
      .maybeSingle();

    // Шаг 2: Только после фиксации approved вызываем fulfillPayment
    if (claimed) {
      return await fulfillPayment(claimed);
    } else {
      // Если параллельный запрос уже перевёл статус в approved, проверяем актуальную запись в БД
      const { data: latest } = await supabase
        .from("payments")
        .select("*")
        .eq("id", payment.id)
        .maybeSingle();

      if (latest) {
        if (!latest.fulfilled_at) {
          return await fulfillPayment(latest);
        }
        return latest;
      }
    }
  } else if (providerStatus === "canceled") {
    const { data: updated } = await supabase
      .from("payments")
      .update({
        status: "canceled",
        provider_response: statusData,
        updated_at: new Date().toISOString(),
      })
      .eq("id", payment.id)
      .select()
      .maybeSingle();

    if (updated) return updated;
  }

  return payment;
}

// =======================================================
// 2. Проверить статус платежа (GET /api/payments/:orderId/status)
// =======================================================
export const getPaymentStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    const { orderId } = req.params;

    const { data: payment, error } = await supabase
      .from("payments")
      .select("*")
      .eq("order_id", orderId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.error("Get Payment Status Error:", error);
      return res.status(500).json({
        success: false,
        message: "Ошибка при получении статуса платежа",
      });
    }

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Платёж не найден",
      });
    }

    let current = payment;
    try {
      current = await reconcilePaymentStatus(payment);
    } catch (providerError) {
      console.error("Reconcile Payment Status Error:", providerError);
      // Отдаём последний известный статус из БД, если O!Dengi недоступен
    }

    return res.json({
      success: true,
      data: toPublicPayment(current),
    });
  } catch (error) {
    console.error("Get Payment Status Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при получении статуса платежа",
    });
  }
};

// =======================================================
// 3. Отменить неоплаченный счёт (POST /api/payments/:orderId/cancel)
// =======================================================
export const cancelPayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const { orderId } = req.params;

    const { data: payment, error } = await supabase
      .from("payments")
      .select("*")
      .eq("order_id", orderId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error || !payment) {
      return res.status(404).json({
        success: false,
        message: "Платёж не найден",
      });
    }

    if (payment.status !== "processing" && payment.status !== "pending") {
      return res.status(409).json({
        success: false,
        message: "Этот платёж нельзя отменить",
      });
    }

    // Перепроверяем реальный статус в O!Dengi ПЕРЕД отменой — если
    // пользователь успел оплатить счёт в приложении банка/O!Dengi (сеть
    // задержала обновление UI) и в этот же момент нажал "Отменить" на
    // сайте, наивная отмена молча похоронила бы уже прошедший платёж:
    // reconcilePaymentStatus в дальнейшем сразу выходит по условию
    // status === "canceled", ничего больше не проверяя, — деньги были бы
    // списаны у пользователя без активации тарифа/продвижения.
    let current = payment;
    try {
      current = await reconcilePaymentStatus(payment);
    } catch (providerError) {
      console.error("Cancel Payment — Reconcile Before Cancel Error:", providerError);
      // O!Dengi недоступен — не блокируем отмену неоплаченного (по нашим
      // данным) счёта из-за временной недоступности провайдера.
    }

    if (current.status === "approved") {
      return res.status(409).json({
        success: false,
        message: "Платёж уже подтверждён и не может быть отменён",
        data: toPublicPayment(current),
      });
    }

    if (current.status !== "processing" && current.status !== "pending") {
      // reconcilePaymentStatus уже перевёл его в canceled/иной терминальный
      // статус (например, провайдер сам отменил просроченный счёт).
      return res.json({ success: true });
    }

    if (current.invoice_id) {
      try {
        await odengi.invoiceCancel({ invoiceId: current.invoice_id });
      } catch (providerError) {
        console.error("O!Dengi invoiceCancel Error:", providerError);
      }
    }

    await supabase
      .from("payments")
      .update({ status: "canceled", updated_at: new Date().toISOString() })
      .eq("id", current.id)
      .neq("status", "approved");

    // Синхронизируем связанный заказ продвижения — иначе он навсегда
    // остаётся "pending" в promotion-orders.json (безвредно с точки зрения
    // применения продвижения, т.к. до него доходит только approved-платёж,
    // но засоряет список заказов в админке устаревшими "зависшими" записями).
    if (current.tariff_id?.startsWith(PROMOTION_TARIFF_PREFIX)) {
      try {
        await markPromotionOrderStatus(current.order_id, "canceled");
      } catch (orderError) {
        console.error("Cancel Payment — Mark Promotion Order Canceled Error:", orderError);
      }
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("Cancel Payment Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при отмене платежа",
    });
  }
};

// =======================================================
// 4. Callback от O!Dengi об изменении статуса счёта (POST /api/payments/webhook)
//
// Это ПУБЛИЧНЫЙ эндпоинт без авторизации — его дергает сервер O!Dengi,
// а не наш фронтенд. Поэтому тело запроса НЕ считается источником
// истины: мы используем его только как триггер "проверь этот order_id
// прямо сейчас" и всегда перепроверяем реальный статус через
// statusPayment (server-to-server) перед тем, как активировать тариф.
// =======================================================
export const handleResultUrl = async (req, res) => {
  try {
    const orderId = req.body?.order_id;

    if (
      !orderId ||
      typeof orderId !== "string" ||
      orderId.length > 100 ||
      !/^[a-zA-Z0-9_\-]+$/.test(orderId)
    ) {
      return res.status(400).json({ success: false });
    }

    const { data: payment } = await supabase
      .from("payments")
      .select("*")
      .eq("order_id", orderId)
      .maybeSingle();

    if (payment) {
      try {
        await reconcilePaymentStatus(payment);
      } catch (providerError) {
        console.error("Result URL Reconcile Error:", providerError);
      }
    }

    // O!Dengi не обрабатывает наш ответ на callback, но отвечаем 200 OK
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Result URL Handler Error:", error);
    return res.status(200).json({ success: true });
  }
};

// =======================================================
// 5. Повторная выдача услуги администратором (POST /api/admin/payments/:id/refulfill)
// =======================================================
export const refulfillPayment = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "ID платежа обязателен",
      });
    }

    const { data: payment, error } = await supabase
      .from("payments")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("Refulfill Payment DB Error:", error);
      return res.status(500).json({
        success: false,
        message: "Ошибка при получении платежа",
      });
    }

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Платёж не найден",
      });
    }

    if (payment.status !== "approved") {
      return res.status(400).json({
        success: false,
        message: "Повторная выдача услуги возможна только для оплаченных (approved) платежей",
      });
    }

    const updatedPayment = await fulfillPayment(payment);

    return res.json({
      success: true,
      data: {
        ...updatedPayment,
        ...toPublicPayment(updatedPayment),
      },
    });
  } catch (error) {
    console.error("Refulfill Payment Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при повторной выдаче услуги",
    });
  }
};

