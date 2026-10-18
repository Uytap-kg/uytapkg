import { supabase } from "../config/db.js";

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
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 100));
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    const { data, error } = await supabase
      .from("lawyers")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      console.error("Get Lawyers Error:", error);
      return res.status(500).json({
        success: false,
        message: "Ошибка при получении списка юристов",
      });
    }

    return res.json({
      success: true,
      data: (data || []).map(toPublicLawyer),
    });
  } catch (error) {
    console.error("Get Lawyers Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при получении юристов",
    });
  }
};
