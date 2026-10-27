import express from "express";
import {
  getComplexes,
  getComplexById,
  getComplexListings,
  getMyComplexes,
  createComplex,
  updateComplex,
  deleteComplex,
} from "../controllers/complexesController.js";
import { authenticateToken } from "../middleware/auth.js";
import { publicCatalogLimiter } from "../middleware/publicRateLimiters.js";

const router = express.Router();

// Публичные маршруты
router.get("/", publicCatalogLimiter, getComplexes);
router.get("/my", authenticateToken, getMyComplexes); // Собственные ЖК застройщика (должен идти до :id)
router.get("/:id", publicCatalogLimiter, getComplexById);
router.get("/:id/listings", publicCatalogLimiter, getComplexListings);

// Защищенные маршруты (только для застройщиков)
router.post("/", authenticateToken, createComplex);
router.put("/:id", authenticateToken, updateComplex);
router.delete("/:id", authenticateToken, deleteComplex);

export default router;
