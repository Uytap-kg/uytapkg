import express from "express";
import {
  getListings,
  getMapListings,
  getListingById,
  createListing,
  getMyListings,
  updateListing,
  deleteListing,
  promoteListingWithTariff,
  renewListing,
} from "../controllers/listingsController.js";
import { authenticateToken } from "../middleware/auth.js";
import { publicCatalogLimiter, publicMapLimiter } from "../middleware/publicRateLimiters.js";

const router = express.Router();

router.get("/", publicCatalogLimiter, getListings);
router.get("/map", publicMapLimiter, getMapListings);
router.get("/my", authenticateToken, getMyListings);
router.get("/:id", publicCatalogLimiter, getListingById);
router.post("/", authenticateToken, createListing);
router.put("/:id", authenticateToken, updateListing);
router.delete("/:id", authenticateToken, deleteListing);
router.post("/:id/promote-with-tariff", authenticateToken, promoteListingWithTariff);
router.post("/:id/renew", authenticateToken, renewListing);

export default router;
