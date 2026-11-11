import { supabase } from "../config/db.js";
import { getOrSetPublicCache } from "../utils/publicCache.js";
import { getPublicPhone } from "../utils/publicContact.js";
import logger from "../utils/logger.js";

// Публичный каталог риэлторов (страница /realtors).
// Отдаём только витринные поля: никаких email, ИНН, документов верификации,
// роли и служебных флагов. Телефон — по общему правилу publicContact.js.

const MAX_PAGE = 1000;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 24;
const PUBLIC_REALTORS_CACHE_TTL_MS = 45 * 1000;

const REALTOR_USER_COLUMNS = "id, account_type, phone, show_phone, is_verified, created_at";
const REALTOR_PROFILE_COLUMNS = "user_id, first_name, last_name, company_name, avatar_url";

function toPublicRealtor(user, profile) {
  return {
    id: user.id,
    firstName: profile?.first_name || "",
    lastName: profile?.last_name || "",
    companyName: profile?.company_name || "",
    avatarUrl: profile?.avatar_url || null,
    phone: getPublicPhone(user, profile),
    isVerified: user.is_verified === true,
    createdAt: user.created_at,
  };
}

// =======================================================
// GET /api/realtors?page=1&limit=24
// =======================================================
export const getRealtors = async (req, res) => {
  try {
    const { page = 1, limit = DEFAULT_LIMIT } = req.query || {};
    const pageNum = Math.min(MAX_PAGE, Math.max(1, parseInt(page, 10) || 1));
    const limitNum = Math.min(MAX_LIMIT, Math.max(1, parseInt(limit, 10) || DEFAULT_LIMIT));
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    const payload = await getOrSetPublicCache(
      "realtors",
      `list:${pageNum}:${limitNum}`,
      PUBLIC_REALTORS_CACHE_TTL_MS,
      async () => {
        // Только обычные пользователи (не админы) с подтверждённым контактом —
        // недорегистрированные аккаунты (не прошли OTP) в каталог не попадают,
        // по тому же условию, что и блокировка входа в login().
        const { data: users, error, count } = await supabase
          .from("users")
          .select(REALTOR_USER_COLUMNS, { count: "exact" })
          .eq("account_type", "realtor")
          .eq("role", "user")
          .or("is_email_verified.eq.true,is_verified.eq.true")
          .order("is_verified", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to);

        if (error) {
          const err = new Error("Ошибка при получении списка риэлторов");
          err.dbError = error;
          throw err;
        }

        const rows = users || [];
        let profilesByUserId = new Map();

        if (rows.length > 0) {
          const { data: profiles, error: profilesError } = await supabase
            .from("user_profiles")
            .select(REALTOR_PROFILE_COLUMNS)
            .in("user_id", rows.map((u) => u.id));

          if (profilesError) {
            const err = new Error("Ошибка при получении профилей риэлторов");
            err.dbError = profilesError;
            throw err;
          }

          profilesByUserId = new Map((profiles || []).map((p) => [p.user_id, p]));
        }

        const total = typeof count === "number" ? count : from + rows.length;

        return {
          success: true,
          data: rows.map((u) => toPublicRealtor(u, profilesByUserId.get(u.id))),
          pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            hasMore: to + 1 < total,
          },
        };
      }
    );

    return res.json(payload);
  } catch (error) {
    logger.error("Get Realtors Controller Error:", error?.dbError || error);
    return res.status(500).json({
      success: false,
      message: "Ошибка при получении списка риэлторов",
      requestId: req?.id,
    });
  }
};
