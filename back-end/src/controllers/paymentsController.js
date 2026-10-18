import { createPromotionPaymentSchema } from "../utils/validation.js";
import { logger } from "../utils/logger.js";
import {
  createSubscriptionPayment,
  createPromotionPayment as createPromotionPaymentService,
  getPaymentStatusService,
  cancelPaymentService,
  handleWebhookService,
  refulfillPaymentService,
  fulfillPayment,
  reconcilePaymentStatus,
  setOdengiClient,
  resetOdengiClient,
  providerCheckThrottleMap,
  ODENGI_THROTTLE_MS,
  FULFILL_LEASE_MS,
  clearProviderCheckThrottleMap,
  MAX_THROTTLE_MAP_SIZE,
} from "../services/payments/paymentsService.js";

// =======================================================
// Реэкспорт для сохранения полной обратной совместимости с существующими тестами
// =======================================================
export {
  fulfillPayment,
  reconcilePaymentStatus,
  setOdengiClient,
  resetOdengiClient,
  providerCheckThrottleMap,
  ODENGI_THROTTLE_MS,
  FULFILL_LEASE_MS,
  clearProviderCheckThrottleMap,
  MAX_THROTTLE_MAP_SIZE,
};

// =======================================================
// 1. Создать платёж и выставить счёт в O!Dengi (POST /api/payments/create)
// =======================================================
export const createPayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const { tariffId, months } = req.body || {};

    const result = await createSubscriptionPayment({ userId, tariffId, months });

    if (result.error) {
      if (result.error === "bad_request") {
        return res.status(400).json({ success: false, message: result.message });
      }
      if (result.error === "conflict") {
        return res.status(409).json({ success: false, message: result.message });
      }
      if (result.error === "service_unavailable") {
        return res.status(503).json({ success: false, message: result.message });
      }
      return res.status(500).json({ success: false, message: result.message || "Ошибка сервера" });
    }

    return res.status(201).json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    logger.error("Create Payment Controller Error", { error: error.message, stack: error.stack });
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при создании платежа",
    });
  }
};

// =======================================================
// 1.1 Разовая покупка продвижения объявления (POST /api/payments/promotion/create)
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

    const { listingId, serviceType, days } = validationResult.data;

    const result = await createPromotionPaymentService({
      userId,
      listingId,
      serviceType,
      days,
    });

    if (result.error) {
      if (result.error === "not_found") {
        return res.status(404).json({ success: false, message: result.message });
      }
      if (result.error === "forbidden") {
        return res.status(403).json({ success: false, message: result.message });
      }
      if (result.error === "bad_request") {
        return res.status(400).json({ success: false, message: result.message });
      }
      if (result.error === "service_unavailable") {
        return res.status(503).json({ success: false, message: result.message });
      }
      return res.status(500).json({ success: false, message: result.message || "Ошибка сервера" });
    }

    return res.status(201).json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    logger.error("Create Promotion Payment Controller Error", {
      error: error.message,
      stack: error.stack,
    });
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при создании платежа",
    });
  }
};

// =======================================================
// 2. Проверить статус платежа (GET /api/payments/:orderId/status)
// =======================================================
export const getPaymentStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    const { orderId } = req.params;

    const result = await getPaymentStatusService({ orderId, userId });

    if (result.error) {
      if (result.error === "not_found") {
        return res.status(404).json({ success: false, message: result.message });
      }
      return res.status(500).json({ success: false, message: result.message });
    }

    return res.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    logger.error("Get Payment Status Controller Error", {
      error: error.message,
      stack: error.stack,
    });
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

    const result = await cancelPaymentService({ orderId, userId });

    if (result.error) {
      if (result.error === "not_found") {
        return res.status(404).json({ success: false, message: result.message });
      }
      if (result.error === "conflict") {
        return res.status(409).json({ success: false, message: result.message });
      }
      if (result.error === "already_approved") {
        return res.status(409).json({
          success: false,
          message: result.message,
          data: result.data,
        });
      }
      return res.status(500).json({ success: false, message: result.message });
    }

    return res.json({ success: true });
  } catch (error) {
    logger.error("Cancel Payment Controller Error", {
      error: error.message,
      stack: error.stack,
    });
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при отмене платежа",
    });
  }
};

// =======================================================
// 4. Callback от O!Dengi об изменении статуса счёта (POST /api/payments/webhook)
// =======================================================
export const handleResultUrl = async (req, res) => {
  try {
    const orderId = req.body?.order_id || req.body?.data?.order_id;
    const result = await handleWebhookService(orderId, req.body);

    if (result.invalid) {
      return res.status(400).json({ success: false, message: result.message || "Некорректный запрос" });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    logger.error("Result URL Handler Error", { error: error.message, stack: error.stack });
    return res.status(200).json({ success: true });
  }
};

// =======================================================
// 5. Повторная выдача услуги администратором (POST /api/admin/payments/:id/refulfill)
// =======================================================
export const refulfillPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await refulfillPaymentService(id);

    if (result.error) {
      if (result.error === "bad_request") {
        return res.status(400).json({ success: false, message: result.message });
      }
      if (result.error === "not_found") {
        return res.status(404).json({ success: false, message: result.message });
      }
      return res.status(500).json({ success: false, message: result.message });
    }

    return res.json(result);
  } catch (error) {
    logger.error("Refulfill Payment Controller Error", {
      error: error.message,
      stack: error.stack,
    });
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при повторной выдаче услуги",
    });
  }
};
