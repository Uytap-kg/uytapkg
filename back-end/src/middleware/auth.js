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

  // Явно ограничиваем допустимый алгоритм подписи — jsonwebtoken по
  // умолчанию доверяет алгоритму, указанному в самом токене (поле `alg`
  // в заголовке), а не жёстко привязывает его к вызову. Без этой опции
  // теоретическая atack-поверхность на смену алгоритма (например, если бы
  // где-то в системе также использовался RS256 с публичным ключом) была
  // бы шире, чем нужно — сейчас мы всегда подписываем только HS256 (см.
  // generateToken выше), поэтому verify должен проверять только его.
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
      // Подтягиваем роль, тип аккаунта и версию токена пользователя из базы данных
      const { data: dbUser, error: dbError } = await supabase
        .from("users")
        .select("role, account_type, token_version")
        .eq("id", decodedUser.id)
        .single();

      let userRole = "user";

      if (dbError) {
        // PGRST204: колонка 'role' отсутствует в БД
        if (dbError.code === "PGRST204") {
          console.warn(
            "⚠️ WARNING: Column 'role' is missing in 'users' table. Please run the following SQL in your Supabase SQL Editor:\n" +
            "ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'admin'));"
          );
        } else if (dbError.code === "PGRST116") {
          // PGRST116: запись не найдена
          return res.status(404).json({
            success: false,
            message: "Пользователь не найден в системе.",
          });
        } else {
          // Другая ошибка базы данных
          console.error("Database error during user fetch:", dbError);
          return res.status(500).json({
            success: false,
            message: "Ошибка базы данных при проверке пользователя.",
          });
        }
      } else if (dbUser) {
        userRole = dbUser.role || "user";
      }

      // Сравниваем версионность токена: если версия в БД не совпадает с версией в токене
      if (dbUser && dbUser.token_version !== (decodedUser.tv ?? 0)) {
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

