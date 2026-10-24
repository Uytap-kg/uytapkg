import express from "express";
import rateLimit from "express-rate-limit";
import { aiSearch, aiGenerateDescription } from "../controllers/aiController.js";
import { authenticateToken } from "../middleware/auth.js";
import { BoundedSharedRateLimitStore } from "../utils/sharedState.js";
import { ipKeyGenerator } from "./authRoutes.js";

const router = express.Router();

// Оба эндпоинта дергают платный внешний Gemini API — без лимита это
// открытая дыра для финансовой DoS-атаки (можно было слать запросы без
// ограничений и накручивать счёт за API). aiSearch используется
// анонимными посетителями (умный поиск на главной), поэтому остаётся
// публичным, но с лимитом на IP; генерация описания используется только
// при создании объявления — доступна лишь авторизованным пользователям.
const aiSearchLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  keyGenerator: (req) => ipKeyGenerator(req),
  validate: { xForwardedForHeader: false },
  store: new BoundedSharedRateLimitStore({
    prefix: "rl:ai_search:",
    windowMs: 5 * 60 * 1000,
    maxEntries: 5000,
    syncShared: true,
  }),
  message: {
    success: false,
    message: "Слишком много запросов умного поиска. Попробуйте снова через несколько минут.",
  },
});

const aiDescriptionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => ipKeyGenerator(req),
  validate: { xForwardedForHeader: false },
  store: new BoundedSharedRateLimitStore({
    prefix: "rl:ai_desc:",
    windowMs: 15 * 60 * 1000,
    maxEntries: 5000,
    syncShared: true,
  }),
  message: {
    success: false,
    message: "Слишком много запросов генерации описания. Попробуйте снова через 15 минут.",
  },
});

router.post("/search", aiSearchLimiter, aiSearch);
router.post(
  "/generate-description",
  authenticateToken,
  aiDescriptionLimiter,
  aiGenerateDescription
);

export default router;
