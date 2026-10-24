import rateLimit from "express-rate-limit";
import { BoundedSharedRateLimitStore } from "../utils/sharedState.js";
import { ipKeyGenerator } from "../routes/authRoutes.js";

/**
 * Раздельные лимитеры для публичных тяжёлых эндпоинтов чтения (отдельно от auth).
 * Значения подобраны с запасом для обычного пользователя (листание каталога, фильтров, карты),
 * но отсекают парсинг и флуд запросами к БД.
 */

// 1. Публичный каталог, карточки объявлений, ЖК, застройщики: 120 запросов в минуту с одного IP
export const publicCatalogLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyGenerator: (req) => ipKeyGenerator(req),
  validate: { xForwardedForHeader: false },
  store: new BoundedSharedRateLimitStore({
    prefix: "rl:pub_catalog:",
    windowMs: 60 * 1000,
    maxEntries: 15000,
  }),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Слишком много запросов к каталогу. Подождите немного и попробуйте снова.",
  },
});

// 2. Выдача карты (/api/listings/map — до 1000 объектов за запрос): 60 запросов в минуту с одного IP
export const publicMapLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => ipKeyGenerator(req),
  validate: { xForwardedForHeader: false },
  store: new BoundedSharedRateLimitStore({
    prefix: "rl:pub_map:",
    windowMs: 60 * 1000,
    maxEntries: 10000,
  }),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Слишком много запросов к карте. Подождите немного и попробуйте снова.",
  },
});

// 3. Публичный профиль продавца (/api/auth/users/:id): 60 запросов в минуту с одного IP
export const publicProfileLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => ipKeyGenerator(req),
  validate: { xForwardedForHeader: false },
  store: new BoundedSharedRateLimitStore({
    prefix: "rl:pub_profile:",
    windowMs: 60 * 1000,
    maxEntries: 10000,
  }),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Слишком много запросов к профилю. Попробуйте позже.",
  },
});

// 4. Счётчики просмотров и кликов баннеров (/api/banners/:id/view, /api/banners/:id/click): 60 в минуту с IP
export const bannerStatsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => ipKeyGenerator(req),
  validate: { xForwardedForHeader: false },
  store: new BoundedSharedRateLimitStore({
    prefix: "rl:banner_stats:",
    windowMs: 60 * 1000,
    maxEntries: 10000,
  }),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Слишком много запросов. Попробуйте позже.",
  },
});
