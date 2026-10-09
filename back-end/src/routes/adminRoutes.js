import express from "express";
import {
  getDashboardStats,
  listPayments,
  updatePricing,
  listLawyers,
  createLawyer,
  updateLawyer,
  deleteLawyer,
  listDevelopersAdmin,
  verifyDeveloperAdmin,
  listInstagramRequestsAdmin,
  completeInstagramRequestAdmin,
} from "../controllers/adminController.js";
import {
  searchUsersByPhone,
  listDefaultTariffs,
  updateDefaultTariffPeriod,
  toggleDefaultTariff,
  listIndividualTariffs,
  createIndividualTariff,
  updateIndividualTariff,
  toggleIndividualTariff,
} from "../controllers/tariffsController.js";
import {
  getAdminBanners,
  uploadBannerImage,
  createBanner,
  updateBanner,
  toggleBanner,
  deleteBanner,
} from "../controllers/bannersController.js";
import { authenticateToken, requireAdmin } from "../middleware/auth.js";
import { uploadBannerImage as uploadBannerImageFile } from "../middleware/upload.js";
import { refulfillPayment } from "../controllers/paymentsController.js";

const router = express.Router();

// multer-обёртка с человекочитаемыми ошибками — тот же паттерн, что и
// у остальных загрузок файлов в проекте (см. authRoutes.js).
const handleBannerImageUpload = (req, res, next) => {
  uploadBannerImageFile(req, res, (err) => {
    if (err) {
      const isLimit = err.code === "LIMIT_FILE_SIZE";
      return res.status(400).json({
        success: false,
        message: isLimit
          ? "Размер изображения не должен превышать 5 МБ"
          : err.message || "Ошибка загрузки файла",
      });
    }
    next();
  });
};

// Все роуты в этом файле — только для role='admin'.
router.get("/stats", authenticateToken, requireAdmin, getDashboardStats);

router.get("/payments", authenticateToken, requireAdmin, listPayments);
router.post("/payments/:id/refulfill", authenticateToken, requireAdmin, refulfillPayment);

// Изменение цен тарифов и услуг (чтение — публичное, /api/settings/pricing)
router.put("/pricing", authenticateToken, requireAdmin, updatePricing);

// Поиск пользователя по номеру телефона (модалка выдачи тарифа)
router.get("/users/search", authenticateToken, requireAdmin, searchUsersByPhone);

// Дефолтные тарифы (start/optimal/business), купленные через оплату
router.get("/tariffs/default", authenticateToken, requireAdmin, listDefaultTariffs);
router.patch(
  "/tariffs/default/:id/period",
  authenticateToken,
  requireAdmin,
  updateDefaultTariffPeriod
);
router.patch("/tariffs/default/:id/toggle", authenticateToken, requireAdmin, toggleDefaultTariff);

// Индивидуальные тарифы, выданные вручную одному пользователю
router.get("/tariffs/individual", authenticateToken, requireAdmin, listIndividualTariffs);
router.post("/tariffs/individual", authenticateToken, requireAdmin, createIndividualTariff);
router.put("/tariffs/individual/:id", authenticateToken, requireAdmin, updateIndividualTariff);
router.patch(
  "/tariffs/individual/:id/toggle",
  authenticateToken,
  requireAdmin,
  toggleIndividualTariff
);

router.get("/lawyers", authenticateToken, requireAdmin, listLawyers);
router.post("/lawyers", authenticateToken, requireAdmin, createLawyer);
router.put("/lawyers/:id", authenticateToken, requireAdmin, updateLawyer);
router.delete("/lawyers/:id", authenticateToken, requireAdmin, deleteLawyer);

// Управление верификацией застройщиков
router.get("/developers", authenticateToken, requireAdmin, listDevelopersAdmin);
router.put("/developers/:id/verify", authenticateToken, requireAdmin, verifyDeveloperAdmin);

// Заявки на публикацию объявлений в Instagram
router.get("/instagram-requests", authenticateToken, requireAdmin, listInstagramRequestsAdmin);
router.patch(
  "/instagram-requests/:id/complete",
  authenticateToken,
  requireAdmin,
  completeInstagramRequestAdmin
);

// Управление рекламными баннерами (публичное чтение — /api/banners)
router.get("/banners", authenticateToken, requireAdmin, getAdminBanners);
router.post(
  "/banners/upload-image",
  authenticateToken,
  requireAdmin,
  handleBannerImageUpload,
  uploadBannerImage
);
router.post("/banners", authenticateToken, requireAdmin, createBanner);
router.put("/banners/:id", authenticateToken, requireAdmin, updateBanner);
router.patch("/banners/:id/toggle", authenticateToken, requireAdmin, toggleBanner);
router.delete("/banners/:id", authenticateToken, requireAdmin, deleteBanner);

export default router;
