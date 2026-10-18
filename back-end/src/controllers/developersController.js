import { supabase } from "../config/db.js";

// Реальный аватар застройщика загружается через редактирование профиля и
// хранится в user_profiles.avatar_url — колонка developers.logo_url почти
// всегда пустая (никто в коде её не заполняет), поэтому раньше каталог
// показывал заглушку вместо загруженного лого. Верификация тоже считается
// не по developers.is_verified (эта колонка нигде не обновляется), а по
// users.is_verified + JSON-полю verificationStatus внутри user_profiles.about
// — той же логике, что использует админка (см. adminController.js).
async function attachProfileData(developers) {
  const list = developers || [];
  const userIds = list.map((d) => d.user_id).filter(Boolean);

  if (userIds.length === 0) {
    return list.map((d) => ({ ...d, avatarUrl: null, verificationStatus: "none" }));
  }

  const [{ data: users }, { data: profiles }] = await Promise.all([
    supabase.from("users").select("id, is_verified").in("id", userIds),
    supabase.from("user_profiles").select("user_id, avatar_url, about").in("user_id", userIds),
  ]);

  const usersMap = new Map((users || []).map((u) => [u.id, u]));
  const profilesMap = new Map((profiles || []).map((p) => [p.user_id, p]));

  return list.map((dev) => {
    const user = usersMap.get(dev.user_id);
    const profile = profilesMap.get(dev.user_id);

    let aboutMeta = {};
    if (profile?.about && profile.about.startsWith("{") && profile.about.endsWith("}")) {
      try {
        aboutMeta = JSON.parse(profile.about);
      } catch (e) {}
    }

    const verificationStatus =
      aboutMeta.verificationStatus || (user?.is_verified ? "approved" : "none");

    return {
      ...dev,
      avatarUrl: profile?.avatar_url || null,
      verificationStatus,
      isVerified: Boolean(user?.is_verified),
    };
  });
}

// =======================================================
// 1. Получить список всех застройщиков с их ЖК (GET /api/developers)
// =======================================================
export const getDevelopers = async (req, res) => {
  try {
    const { page = 1, limit = 100 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 100));
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    const { data, error } = await supabase
      .from("developers")
      .select(`
        *,
        residential_complexes (*)
      `)
      .order("company_name", { ascending: true })
      .range(from, to);

    if (error) {
      console.error("Get Developers Error:", error);
      return res.status(500).json({
        success: false,
        message: "Ошибка при получении списка застройщиков",
      });
    }

    const enriched = await attachProfileData(data);

    return res.json({
      success: true,
      data: enriched,
    });
  } catch (error) {
    console.error("Get Developers Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при получении застройщиков",
    });
  }
};

// =======================================================
// 2. Получить одного застройщика по ID с его ЖК (GET /api/developers/:id)
// =======================================================
export const getDeveloperById = async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("developers")
      .select(`
        *,
        residential_complexes (*)
      `)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("Get Developer By Id Error:", error);
      return res.status(500).json({
        success: false,
        message: "Ошибка при получении данных застройщика",
      });
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Застройщик не найден",
      });
    }

    const [enriched] = await attachProfileData([data]);

    return res.json({
      success: true,
      data: enriched,
    });
  } catch (error) {
    console.error("Get Developer By Id Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при получении застройщика",
    });
  }
};
