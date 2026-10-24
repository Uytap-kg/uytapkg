import { supabase } from "../config/db.js";
import { getOrSetPublicCache } from "../utils/publicCache.js";

const LAWYER_COLUMNS =
  "id, last_name, first_name, middle_name, specialization, experience, phone, whatsapp, description, is_active, created_at";
const MAX_PAGE = 1000;
const MAX_LIMIT = 100;
const PUBLIC_LAWYERS_CACHE_TTL_MS = 60 * 1000;

export function toPublicLawyer(row) {
  return {
    id: row.id,
    lastName: row.last_name,
    firstName: row.first_name,
    middleName: row.middle_name,
    specialization: row.specialization,
    experience: row.experience,
    phone: row.phone,
    whatsapp: row.whatsapp,
    description: row.description,
    active: row.is_active,
    createdAt: row.created_at,
  };
}

// =======================================================
// Публичный список юристов — только активные (GET /api/lawyers)
// Используется на странице /lawyers
// =======================================================
export const getLawyers = async (req, res) => {
  try {
    const { page = 1, limit = 100 } = req.query;
    const pageNum = Math.min(MAX_PAGE, Math.max(1, parseInt(page, 10) || 1));
    const limitNum = Math.min(MAX_LIMIT, Math.max(1, parseInt(limit, 10) || 100));
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    const payload = await getOrSetPublicCache(
      "lawyers",
      `list:${pageNum}:${limitNum}`,
      PUBLIC_LAWYERS_CACHE_TTL_MS,
      async () => {
        const { data, error, count } = await supabase
          .from("lawyers")
          .select(LAWYER_COLUMNS, { count: "exact" })
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .range(from, to);

        if (error) {
          const err = new Error("Ошибка при получении списка юристов");
          err.dbError = error;
          throw err;
        }

        const items = (data || []).map(toPublicLawyer);

        return {
          success: true,
          data: items,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total: count ?? items.length,
            hasMore: count ? to + 1 < count : false,
          },
        };
      }
    );

    return res.json(payload);
  } catch (error) {
    console.error("Get Lawyers Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка при получении списка юристов",
      requestId: req?.id,
    });
  }
};
