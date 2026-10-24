import express from "express";
import { getDevelopers, getDeveloperById } from "../controllers/developersController.js";
import { publicCatalogLimiter } from "../middleware/publicRateLimiters.js";

const router = express.Router();

router.get("/", publicCatalogLimiter, getDevelopers);
router.get("/:id", publicCatalogLimiter, getDeveloperById);

export default router;
