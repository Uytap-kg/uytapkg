import express from "express";
import { getRealtors } from "../controllers/realtorsController.js";
import { publicCatalogLimiter } from "../middleware/publicRateLimiters.js";

const router = express.Router();

// Публичный каталог риэлторов для страницы /realtors.
// Профиль конкретного риэлтора — GET /api/auth/users/:id (authRoutes.js).
router.get("/", publicCatalogLimiter, getRealtors);

export default router;
