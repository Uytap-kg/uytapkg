import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { supabase } from "../config/db.js";

dotenv.config();

if (!process.env.JWT_SECRET) {
  console.error("❌ CRITICAL ERROR: JWT_SECRET environment variable is missing!");
  throw new Error("JWT_SECRET environment variable is not defined in .env");
}

const JWT_SECRET = process.env.JWT_SECRET;

// Генерация JWT токена
export const generateToken = (payload) => {
  return jwt.sign(
    {
      ...payload,
      typ: "access",
      tv: payload?.tokenVersion ?? payload?.tv ?? 0,
    },
    JWT_SECRET,
    { expiresIn: "1d", algorithm: "HS256" }
  );
};

// In-memory кэш Auth-middleware (Дефект 2.1)
export const AUTH_CACHE_TTL_MS = 60 * 1000; // 60 секунд
export const MAX_AUTH_CACHE_SIZE = 5000;
export const userAuthCache = new Map();

export function invalidateUserAuthCache(userId) {
  if (userId) {
    userAuthCache.delete(String(userId));
  }
}

export function clearUserAuthCache() {
  userAuthCache.clear();
}

// Middleware для проверки токена доступа
export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Требуется авторизация. Токен отсутствует.",
    });
  }

  jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }, async (err, decodedUser) => {
    if (err) {
      return res.status(403).json({
        success: false,
        message: "Недействительный или истекший токен авторизации.",
      });
    }

    // Проверяем тип токена
    if (decodedUser.typ !== "access") {
      return res.status(401).json({
        success: false,
        message: "Недействительный тип токена",
      });
    }

    try {
      const userId = String(decodedUser.id);
      const now = Date.now();
      const tokenVersion = decodedUser.tv ?? 0;

      let dbUser = null;
      let userRole = "user";

      // 1. Проверяем наличие валидной записи в кэше
      const cached = userAuthCache.get(userId);
      if (
        cached &&
        now - cached.cachedAt < AUTH_CACHE_TTL_MS &&
        cached.token_version === tokenVersion
      ) {
        dbUser = cached;
        userRole = cached.role || "user";
      } else {
        // 2. Если в кэше нет или версия не совпадает — запрос в БД
        const { data: fetchedUser, error: dbError } = await supabase
          .from("users")
          .select("role, account_type, token_version, email")
          .eq("id", decodedUser.id)
          .single();

        if (dbError) {
          if (dbError.code === "PGRST204") {
            console.warn(
              "⚠️ WARNING: Column 'role' is missing in 'users' table. Please run the following SQL in your Supabase SQL Editor:\n" +
              "ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'admin'));"
            );
          } else if (dbError.code === "PGRST116") {
            return res.status(404).json({
              success: false,
              message: "Пользователь не найден в системе.",
            });
          } else {
            console.error("Database error during user fetch:", dbError);
            return res.status(500).json({
              success: false,
              message: "Ошибка базы данных при проверке пользователя.",
            });
          }
        } else if (fetchedUser) {
          userRole = fetchedUser.role || "user";
          dbUser = fetchedUser;

          userAuthCache.set(userId, {
            role: userRole,
            account_type: fetchedUser.account_type,
            token_version: fetchedUser.token_version ?? 0,
            email: fetchedUser.email,
            cachedAt: now,
          });

          if (userAuthCache.size > MAX_AUTH_CACHE_SIZE) {
            for (const [uid, item] of userAuthCache.entries()) {
              if (now - item.cachedAt >= AUTH_CACHE_TTL_MS) {
                userAuthCache.delete(uid);
              }
            }
          }
        }
      }

      if (dbUser && dbUser.token_version !== tokenVersion) {
        return res.status(401).json({
          success: false,
          message: "Сессия отозвана или устарела. Пожалуйста, выполните вход заново",
        });
      }

      req.user = {
        ...decodedUser,
        role: userRole,
        account_type: dbUser?.account_type || decodedUser.accountType || decodedUser.account_type,
        accountType: dbUser?.account_type || decodedUser.accountType || decodedUser.account_type,
        email: dbUser?.email || decodedUser.email,
        token_version: dbUser?.token_version ?? 0,
      };
      next();
    } catch (dbQueryError) {
      console.error("Database user fetch error in auth middleware:", dbQueryError);
      return res.status(500).json({
        success: false,
        message: "Ошибка сервера при проверке прав доступа.",
      });
    }
  });
};

// Middleware для проверки роли admin
export const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Доступ запрещён. Требуются права администратора.",
    });
  }
  next();
};

/**
 * Опциональная авторизация: если передан заголовок Authorization, декодирует токен,
 * проверяет существование пользователя и актуальность token_version в БД/кэше.
 * При любой ошибке, удалённом пользователе или отозванном токене выставляет req.user = null
 * и передаёт управление дальше.
 */
export const optionalAuth = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    req.user = null;
    return next();
  }

  jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }, async (err, decodedUser) => {
    if (err || !decodedUser || decodedUser.typ !== "access" || !decodedUser.id) {
      req.user = null;
      return next();
    }

    try {
      const userId = String(decodedUser.id);
      const now = Date.now();
      const tokenVersion = decodedUser.tv ?? 0;

      let dbUser = null;
      let userRole = "user";

      const cached = userAuthCache.get(userId);
      if (
        cached &&
        now - cached.cachedAt < AUTH_CACHE_TTL_MS &&
        cached.token_version === tokenVersion
      ) {
        dbUser = cached;
        userRole = cached.role || "user";
      } else {
        const { data: fetchedUser, error: dbError } = await supabase
          .from("users")
          .select("role, account_type, token_version, email")
          .eq("id", decodedUser.id)
          .single();

        if (dbError || !fetchedUser) {
          req.user = null;
          return next();
        }

        userRole = fetchedUser.role || "user";
        dbUser = fetchedUser;

        userAuthCache.set(userId, {
          role: userRole,
          account_type: fetchedUser.account_type,
          token_version: fetchedUser.token_version ?? 0,
          email: fetchedUser.email,
          cachedAt: now,
        });

        if (userAuthCache.size > MAX_AUTH_CACHE_SIZE) {
          for (const [uid, item] of userAuthCache.entries()) {
            if (now - item.cachedAt >= AUTH_CACHE_TTL_MS) {
              userAuthCache.delete(uid);
            }
          }
        }
      }

      if (!dbUser || (dbUser.token_version ?? 0) !== tokenVersion) {
        req.user = null;
        return next();
      }

      req.user = {
        ...decodedUser,
        role: userRole,
        account_type: dbUser?.account_type || decodedUser.accountType || decodedUser.account_type,
        accountType: dbUser?.account_type || decodedUser.accountType || decodedUser.account_type,
        email: dbUser?.email || decodedUser.email,
        token_version: dbUser?.token_version ?? 0,
      };
      return next();
    } catch {
      req.user = null;
      return next();
    }
  });
};
