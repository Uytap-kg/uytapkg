import express from "express";
import {
  getPublicBanners,
  trackBannerView,
  trackBannerClick,
} from "../controllers/bannersController.js";

const router = express.Router();

// Публичный список активных рекламных баннеров — без авторизации,
// используется главной страницей. Управление — только через
// /api/admin/banners (роль admin).
router.get("/", getPublicBanners);

// Фиксация просмотров и кликов по баннеру (без авторизации)
router.post("/:id/view", trackBannerView);
router.post("/:id/click", trackBannerClick);

export default router;
