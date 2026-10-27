import express from "express";
import rateLimit from "express-rate-limit";
import { BoundedSharedRateLimitStore } from "../utils/sharedState.js";
import { ipKeyGenerator } from "./authRoutes.js";
import {
  createPayment,
  createPromotionPayment,
  getPaymentStatus,
  cancelPayment,
  handleResultUrl,
} from "../controllers/paymentsController.js";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();

// Ограничиваем создание платежей, чтобы нельзя было заспамить O!Dengi
// счетами или перебирать суммы (20 попыток за 15 минут на IP)
const createPaymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => ipKeyGenerator(req),
  validate: { xForwardedForHeader: false },
  store: new BoundedSharedRateLimitStore({
    prefix: "rl:pay_create:",
    windowMs: 15 * 60 * 1000,
    maxEntries: 5000,
    syncShared: true,
  }),
  message: {
    success: false,
    message: "Слишком много попыток оплаты. Попробуйте снова через 15 минут.",
  },
});

// Опрос статуса дергается фронтендом каждые несколько секунд, лимит мягче
const statusLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => ipKeyGenerator(req),
  validate: { xForwardedForHeader: false },
  store: new BoundedSharedRateLimitStore({
    prefix: "rl:pay_status:",
    windowMs: 60 * 1000,
    maxEntries: 5000,
  }),
});

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => ipKeyGenerator(req),
  validate: { xForwardedForHeader: false },
  store: new BoundedSharedRateLimitStore({
    prefix: "rl:pay_webhook:",
    windowMs: 60 * 1000,
    maxEntries: 5000,
  }),
  message: { success: false, message: "Слишком много запросов" },
});

router.post("/create", authenticateToken, createPaymentLimiter, createPayment);
router.post(
  "/promotion/create",
  authenticateToken,
  createPaymentLimiter,
  createPromotionPayment
);
router.get("/:orderId/status", authenticateToken, statusLimiter, getPaymentStatus);
router.post("/:orderId/cancel", authenticateToken, cancelPayment);

// Публичный callback от O!Dengi (result_url) — без авторизации
router.post("/webhook", webhookLimiter, handleResultUrl);

export default router;
