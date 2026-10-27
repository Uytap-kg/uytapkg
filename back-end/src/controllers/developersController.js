import { supabase } from "../config/db.js";
import { getOrSetPublicCache } from "../utils/publicCache.js";

const DEVELOPER_COLUMNS =
  "id, user_id, company_name, logo_url, description, website, is_verified, created_at";
const DEV_COMPLEX_COLUMNS =
  "id, developer_id, name, description, country, region, city, district, address, completion_status, completion_date, housing_class, registry_link, cover_photo, features, created_at";
const DEV_COMPLEX_COLUMNS_LEGACY =
  "id, developer_id, name, description, region, city, address, completion_status, completion_date, housing_class, registry_link, cover_photo, features, created_at";

const MAX_PAGE = 1000;
const MAX_LIMIT = 100;
const PUBLIC_DEVELOPERS_CACHE_TTL_MS = 45 * 1000;

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
      residential_complexes: Array.isArray(dev.residential_complexes)
        ? dev.residential_complexes.slice(0, MAX_LIMIT)
        : [],
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
    const pageNum = Math.min(MAX_PAGE, Math.max(1, parseInt(page, 10) || 1));
    const limitNum = Math.min(MAX_LIMIT, Math.max(1, parseInt(limit, 10) || 100));
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    const payload = await getOrSetPublicCache(
      "developers",
      `list:${pageNum}:${limitNum}`,
      PUBLIC_DEVELOPERS_CACHE_TTL_MS,
      async () => {
        let { data, error, count } = await supabase
          .from("developers")
          .select(
            `
            ${DEVELOPER_COLUMNS},
            residential_complexes (${DEV_COMPLEX_COLUMNS})
          `,
            { count: "exact" }
          )
          .order("company_name", { ascending: true })
          .range(from, to);

        if (error && (error.code === "42703" || error.message?.includes("does not exist") || error.message?.includes("column"))) {
          const fallbackRes = await supabase
            .from("developers")
            .select(
              `
              ${DEVELOPER_COLUMNS},
              residential_complexes (${DEV_COMPLEX_COLUMNS_LEGACY})
            `,
              { count: "exact" }
            )
            .order("company_name", { ascending: true })
            .range(from, to);
          data = fallbackRes.data;
          error = fallbackRes.error;
          count = fallbackRes.count;
        }

        if (error) {
          const err = new Error("Ошибка при получении списка застройщиков");
          err.dbError = error;
          throw err;
        }

        const enriched = await attachProfileData(data);

        return {
          success: true,
          data: enriched,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total: count ?? enriched.length,
            hasMore: count ? to + 1 < count : false,
          },
        };
      }
    );

    return res.json(payload);
  } catch (error) {
    console.error("Get Developers Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка при получении списка застройщиков",
      requestId: req?.id,
    });
  }
};

// =======================================================
// 2. Получить одного застройщика по ID с его ЖК (GET /api/developers/:id)
// =======================================================
export const getDeveloperById = async (req, res) => {
  try {
    const { id } = req.params;

    const enriched = await getOrSetPublicCache(
      "developers",
      `byId:${id}`,
      PUBLIC_DEVELOPERS_CACHE_TTL_MS,
      async () => {
        let { data, error } = await supabase
          .from("developers")
          .select(`
            ${DEVELOPER_COLUMNS},
            residential_complexes (${DEV_COMPLEX_COLUMNS})
          `)
          .eq("id", id)
          .maybeSingle();

        if (error && (error.code === "42703" || error.message?.includes("does not exist") || error.message?.includes("column"))) {
          const fallbackRes = await supabase
            .from("developers")
            .select(`
              ${DEVELOPER_COLUMNS},
              residential_complexes (${DEV_COMPLEX_COLUMNS_LEGACY})
            `)
            .eq("id", id)
            .maybeSingle();
          data = fallbackRes.data;
          error = fallbackRes.error;
        }

        if (error) {
          const err = new Error("Ошибка при получении данных застройщика");
          err.dbError = error;
          throw err;
        }

        if (!data) {
          return null;
        }

        const [item] = await attachProfileData([data]);
        return item;
      }
    );

    if (!enriched) {
      return res.status(404).json({
        success: false,
        message: "Застройщик не найден",
      });
    }

    return res.json({
      success: true,
      data: enriched,
    });
  } catch (error) {
    console.error("Get Developer By Id Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при получении застройщика",
      requestId: req?.id,
    });
  }
};
