import { supabase } from "../config/db.js";
import { sanitizeAuthorPII, maskExpiredPromotion } from "./listingsController.js";

// =======================================================
// 1. Добавить объявление в избранное (POST /api/favorites)
// =======================================================
export const addFavorite = async (req, res) => {
  try {
    const userId = req.user.id;
    const { listingId } = req.body;

    if (!listingId) {
      return res.status(400).json({
        success: false,
        message: "listingId обязателен в теле запроса",
      });
    }

    // Разрешаем добавлять в избранное ТОЛЬКО опубликованные активные объявления (status === 'active')
    const { data: listing, error: listingError } = await supabase
      .from("listings")
      .select("id, status")
      .eq("id", listingId)
      .eq("status", "active")
      .maybeSingle();

    if (listingError || !listing || listing.status !== "active") {
      return res.status(404).json({
        success: false,
        message: "Объявление не найдено",
      });
    }

    // Пытаемся добавить в избранное
    const { error: insertError } = await supabase
      .from("favorites")
      .insert({
        user_id: userId,
        listing_id: listingId,
      });

    if (insertError) {
      // 23505 = unique_violation (UNIQUE (user_id, listing_id))
      if (insertError.code === "23505") {
        return res.status(409).json({
          success: false,
          message: "Объявление уже добавлено в избранное",
        });
      }
      console.error("Add Favorite Error:", insertError);
      return res.status(500).json({
        success: false,
        message: "Ошибка при добавлении в избранное",
      });
    }

    return res.status(201).json({
      success: true,
      message: "Объявление добавлено в избранное",
    });
  } catch (error) {
    console.error("Add Favorite Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при добавлении в избранное",
    });
  }
};

// =======================================================
// 2. Удалить объявление из избранного (DELETE /api/favorites/:listingId)
// =======================================================
export const removeFavorite = async (req, res) => {
  try {
    const userId = req.user.id;
    const { listingId } = req.params;

    if (!listingId) {
      return res.status(400).json({
        success: false,
        message: "listingId обязателен в параметрах запроса",
      });
    }

    // Удаляем запись
    const { data, error } = await supabase
      .from("favorites")
      .delete()
      .eq("user_id", userId)
      .eq("listing_id", listingId)
      .select();

    if (error) {
      console.error("Remove Favorite Error:", error);
      return res.status(500).json({
        success: false,
        message: "Ошибка при удалении из избранного",
      });
    }

    // Если ничего не удалено (записи не существовало)
    if (!data || data.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Объявление не найдено в избранном",
      });
    }

    return res.json({
      success: true,
      message: "Объявление удалено из избранного",
    });
  } catch (error) {
    console.error("Remove Favorite Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при удалении из избранного",
    });
  }
};

// =======================================================
// 3. Получить список избранного пользователя (GET /api/favorites)
// =======================================================
export const getFavorites = async (req, res) => {
  try {
    const userId = req.user.id;

    // Делаем JOIN с listings, listing_photos и users
    const { data, error } = await supabase
      .from("favorites")
      .select(`
        user_id,
        listing_id,
        listings (
          *,
          listing_photos (id, url, is_main, display_order),
          users (id, phone, show_phone, is_verified, account_type)
        )
      `)
      .eq("user_id", userId);

    if (error) {
      console.error("Get Favorites Error:", error);
      return res.status(500).json({
        success: false,
        message: "Ошибка при получении списка избранного",
      });
    }

    // Отдаём только активные неистёкшие объявления, применяя sanitizeAuthorPII и maskExpiredPromotion (P1-07)
    const nowMs = Date.now();
    const listings = (data || [])
      .map((fav) => fav.listings)
      .filter((item) => {
        if (!item || item.status !== "active") return false;
        if (item.expires_at && new Date(item.expires_at).getTime() <= nowMs) return false;
        return true;
      })
      .map((item) => {
        const copy = { ...item };
        if (copy.users) {
          copy.users = Array.isArray(copy.users)
            ? copy.users.map(sanitizeAuthorPII)
            : sanitizeAuthorPII(copy.users);
        }
        return maskExpiredPromotion(copy);
      });

    return res.json({
      success: true,
      data: listings,
    });
  } catch (error) {
    console.error("Get Favorites Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при получении избранного",
    });
  }
};
