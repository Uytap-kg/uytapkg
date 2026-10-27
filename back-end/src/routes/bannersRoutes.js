import express from "express";
import {
  getPublicBanners,
  trackBannerView,
  trackBannerClick,
} from "../controllers/bannersController.js";
import { publicCatalogLimiter, bannerStatsLimiter } from "../middleware/publicRateLimiters.js";

const router = express.Router();

// Публичный список активных рекламных баннеров — без авторизации,
// используется главной страницей. Управление — только через
// /api/admin/banners (роль admin).
router.get("/", publicCatalogLimiter, getPublicBanners);

// Фиксация просмотров и кликов по баннеру (с защитой от накрутки и rate limit)
router.post("/:id/view", bannerStatsLimiter, trackBannerView);
router.post("/:id/click", bannerStatsLimiter, trackBannerClick);

export default router;
