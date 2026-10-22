import { supabase } from "../config/db.js";
import { createComplexSchema, updateComplexSchema } from "../utils/validation.js";
import { verifyAllOwnedBy } from "../utils/uploadOwnership.js";

// Если developers.logo_url пуст, подставляем user_profiles.avatar_url застройщика
async function resolveDeveloperLogos(complexes) {
  try {
    const missing = (complexes || []).filter(
      (c) => c.developers && !c.developers.logo_url && c.developers.user_id,
    );
    if (!missing.length) return complexes;

    const userIds = [...new Set(missing.map((c) => c.developers.user_id))];
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("user_id, avatar_url")
      .in("user_id", userIds);

    const avatarByUser = new Map(
      (profiles || []).filter((p) => p.avatar_url).map((p) => [p.user_id, p.avatar_url]),
    );

    for (const c of missing) {
      const avatar = avatarByUser.get(c.developers.user_id);
      if (avatar) c.developers.logo_url = avatar;
    }
  } catch (err) {
    console.warn("resolveDeveloperLogos warning:", err);
  }
  return complexes;
}

// Нормализует поля локации ЖК (country, district, cityKey) на верхний уровень объекта
export function normalizeComplexRow(c) {
  if (!c || typeof c !== "object") return c;
  const features = (c.features && typeof c.features === "object") ? c.features : {};
  return {
    ...c,
    country: c.country || features.country || "kyrgyzstan",
    district: c.district || features.district || null,
    cityKey: features.cityKey || null,
  };
}


// =======================================================
// 1. Получение списка ЖК (GET /api/complexes)
// =======================================================
export const getComplexes = async (req, res) => {
  try {
    const { page = 1, limit = 100, country, city, district } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 100));
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    let query = supabase
      .from("residential_complexes")
      .select(
        `
        *,
        developers (id, user_id, company_name, logo_url, is_verified),
        complex_layouts (*)
      `,
        { count: "exact" }
      );

    if (country && typeof country === "string") {
      const cleanCountry = country.replace(/[,()]/g, " ").trim().slice(0, 50);
      if (cleanCountry) {
        const isKg = /^(kyrgyzstan|кыргызстан|kg)$/i.test(cleanCountry);
        const isTr = /^(turkey|турция|tr|türkiye)$/i.test(cleanCountry);
        if (isKg) {
          query = query.or("country.ilike.%kyrgyzstan%,country.ilike.%кыргызстан%,features->>country.ilike.%kyrgyzstan%,features->>country.ilike.%кыргызстан%");
        } else if (isTr) {
          query = query.or("country.ilike.%turkey%,country.ilike.%турция%,features->>country.ilike.%turkey%,features->>country.ilike.%турция%");
        } else {
          query = query.or(`country.ilike.%${cleanCountry}%,features->>country.ilike.%${cleanCountry}%`);
        }
      }
    }

    if (city && typeof city === "string") {
      const cleanCity = city.replace(/[,()]/g, " ").trim().slice(0, 100);
      if (cleanCity) {
        query = query.or(`city.ilike.%${cleanCity}%,features->>city.ilike.%${cleanCity}%,address.ilike.%${cleanCity}%`);
      }
    }

    if (district && typeof district === "string") {
      const cleanDistrict = district.replace(/[,()]/g, " ").trim().slice(0, 100);
      if (cleanDistrict) {
        query = query.or(`district.ilike.%${cleanDistrict}%,features->>district.ilike.%${cleanDistrict}%,address.ilike.%${cleanDistrict}%`);
      }
    }

    const { data: complexes, error, count } = await query
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      return res.status(500).json({ success: false, message: "Ошибка загрузки жилых комплексов" });
    }

    const resolved = await resolveDeveloperLogos(complexes);

    const normalized = (resolved || []).map(normalizeComplexRow);

    return res.json({
      success: true,
      data: normalized,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count ?? resolved.length,
        hasMore: count ? to + 1 < count : false,
      },
    });
  } catch (error) {
    console.error("Get Complexes Error:", error);
    return res.status(500).json({ success: false, message: "Ошибка сервера при загрузке ЖК" });
  }
};

// =======================================================
// 2. Получение конкретного ЖК по ID (GET /api/complexes/:id)
// =======================================================
export const getComplexById = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: complex, error } = await supabase
      .from("residential_complexes")
      .select(`
        *,
        developers (*),
        complex_layouts (*)
      `)
      .eq("id", id)
      .single();

    if (error || !complex) {
      return res.status(404).json({ success: false, message: "Жилой комплекс не найден" });
    }

    if (complex.developers) await resolveDeveloperLogos([complex]);
    return res.json({ success: true, data: normalizeComplexRow(complex) });
  } catch (error) {
    console.error("Get Complex By ID Error:", error);
    return res.status(500).json({ success: false, message: "Ошибка сервера при загрузке ЖК" });
  }
};

// =======================================================
// 3. Объявления квартир, привязанных к конкретному ЖК
//    (GET /api/complexes/:id/listings)
//
// Привязка хранится в listings.features.residentialComplexId (в таблице
// listings нет отдельной колонки под это — см. createListing/updateListing
// в listingsController.js), поэтому фильтруем через JSON-путь Postgres.
// Публичный эндпоинт — отдаём только активные объявления.
// =======================================================
export const getComplexListings = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: complex } = await supabase
      .from("residential_complexes")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (!complex) {
      return res.status(404).json({
        success: false,
        message: "Жилой комплекс не найден",
      });
    }

    const { data: listings, error } = await supabase
      .from("listings")
      .select(`
        *,
        listing_photos (id, url, is_main, display_order)
      `)
      .eq("status", "active")
      .gt("expires_at", new Date().toISOString())
      .eq("features->>residentialComplexId", id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Get Complex Listings Error:", error);
      return res.status(500).json({
        success: false,
        message: "Ошибка при получении квартир жилого комплекса",
      });
    }

    return res.json({
      success: true,
      data: listings || [],
    });
  } catch (error) {
    console.error("Get Complex Listings Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при получении квартир жилого комплекса",
    });
  }
};

// =======================================================
// 4. Получение собственных ЖК застройщика (GET /api/complexes/my)
// =======================================================
export const getMyComplexes = async (req, res) => {
  try {
    const { data: developer } = await supabase
      .from("developers")
      .select("id")
      .eq("user_id", req.user.id)
      .maybeSingle();

    if (!developer) {
      return res.json({
        success: true,
        data: [],
      });
    }

    const { data: complexes, error } = await supabase
      .from("residential_complexes")
      .select(`
        *,
        developers (id, user_id, company_name, logo_url, is_verified),
        complex_layouts (*)
      `)
      .eq("developer_id", developer.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Get My Complexes Error:", error);
      return res.status(500).json({
        success: false,
        message: "Ошибка при получении списка ваших жилых комплексов",
      });
    }

    const resolved = await resolveDeveloperLogos(complexes || []);
    return res.json({
      success: true,
      data: (resolved || []).map(normalizeComplexRow),
    });
  } catch (error) {
    console.error("Get My Complexes Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при получении жилых комплексов",
    });
  }
};

// =======================================================
// 5. Создание жилого комплекса (POST /api/complexes)
// =======================================================
export const createComplex = async (req, res) => {
  try {
    // Проверяем тип аккаунта
    if (req.user.account_type !== "developer") {
      return res.status(403).json({
        success: false,
        message: "Только пользователи с аккаунтом застройщика могут создавать ЖК",
      });
    }

    // Ищем id застройщика по user_id
    let { data: developer, error: devError } = await supabase
      .from("developers")
      .select("id")
      .eq("user_id", req.user.id)
      .maybeSingle();

    if (devError) {
      console.error("Error fetching developer profile:", devError);
    }

    if (!developer) {
      // Автоматически создаем запись в developers, если ее нет
      const { data: newDev, error: createDevError } = await supabase
        .from("developers")
        .insert({
          user_id: req.user.id,
          company_name: req.user.companyName || req.user.profile?.company_name || "Новый застройщик",
        })
        .select()
        .single();

      if (createDevError || !newDev) {
        return res.status(400).json({
          success: false,
          message: "Не удалось создать профиль застройщика",
        });
      }
      developer = newDev;
    }

    // Валидация входных данных через Zod
    const validationResult = createComplexSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        message: "Ошибка валидации данных жилого комплекса",
        errors: validationResult.error.errors.map((e) => e.message),
      });
    }

    const {
      name,
      description,
      country,
      region,
      city,
      cityKey,
      district,
      address,
      latitude,
      longitude,
      status,
      class: housingClass,
      completionDate,
      floors,
      blocks,
      apartments,
      parking,
      ceilingHeight,
      construction,
      area,
      areaSotka,
      documentsUrl,
      amenities,
      images,
      features,
    } = validationResult.data;

    // Каждое фото ЖК должно быть загружено именно этим пользователем через
    // /api/upload/complex-photo (водяной знак) — та же проверка и по той же
    // причине, что и у photos объявления в listingsController.createListing.
    if (!(await verifyAllOwnedBy(images, req.user.id))) {
      return res.status(400).json({
        success: false,
        message: "Все фото должны быть загружены вами через форму загрузки ЖК",
      });
    }

    // Мапинг статусов
    let completion_status = "building";
    if (status === "Проект" || status === "planning") completion_status = "building";
    if (status === "Строительство" || status === "construction") completion_status = "building";
    if (status === "Сдан" || status === "completed") completion_status = "completed";

    const cover_photo = Array.isArray(images) && images.length > 0 ? images[0] : null;

    // TODO: Временное решение для сохранения площади территории в двух единицах измерения (area в кв.м и areaSotka в сотках). Требуется обсудить единый стандарт измерения.
    const resolvedCountry = (country && String(country).trim()) || "kyrgyzstan";
    const resolvedDistrict = (district && String(district).trim()) || null;
    const resolvedCityKey = (cityKey && String(cityKey).trim()) || null;

    const complexData = {
      developer_id: developer.id,
      name: name || "Без названия",
      description: description || "",
      country: resolvedCountry,
      region: region || city || "Бишкек",
      city: city || "Бишкек",
      district: resolvedDistrict,
      address: address || "",
      completion_status,
      completion_date: completionDate || "",
      housing_class: housingClass || "Комфорт",
      cover_photo,
      features: {
        ...(features || {}),
        country: resolvedCountry,
        district: resolvedDistrict,
        cityKey: resolvedCityKey,
        latitude: latitude ?? (features && features.latitude) ?? null,
        longitude: longitude ?? (features && features.longitude) ?? null,
        floors: floors || null,
        blocks: blocks || null,
        apartments: apartments || null,
        parking: parking || null,
        ceilingHeight: ceilingHeight || null,
        construction: construction || null,
        area: area || null,
        areaSotka: areaSotka || null,
        documentsUrl: documentsUrl || null,
        amenities: amenities || [],
        images: images || [],
      },
    };

    let { data: newComplex, error: complexError } = await supabase
      .from("residential_complexes")
      .insert([complexData])
      .select()
      .single();

    if (complexError && (complexError.message?.includes("column") || complexError.code === "42703" || complexError.message?.includes("country") || complexError.message?.includes("district"))) {
      const fallbackData = { ...complexData };
      delete fallbackData.country;
      delete fallbackData.district;
      const fallbackResult = await supabase
        .from("residential_complexes")
        .insert([fallbackData])
        .select()
        .single();
      newComplex = fallbackResult.data;
      complexError = fallbackResult.error;
    }

    if (complexError) {
      console.error("Create Complex Error:", complexError);
      return res.status(400).json({
        success: false,
        message: "Ошибка при создании жилого комплекса: " + complexError.message,
      });
    }

    return res.status(201).json({
      success: true,
      message: "Жилой комплекс успешно создан",
      data: newComplex,
    });
  } catch (error) {
    console.error("Create Complex Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при создании жилого комплекса",
    });
  }
};

// =======================================================
// 6. Обновление жилого комплекса (PUT /api/complexes/:id)
// =======================================================
export const updateComplex = async (req, res) => {
  try {
    const { id } = req.params;

    // Проверяем тип аккаунта
    if (req.user.account_type !== "developer") {
      return res.status(403).json({
        success: false,
        message: "Только застройщики могут редактировать ЖК",
      });
    }

    // Ищем id застройщика по user_id
    const { data: developer } = await supabase
      .from("developers")
      .select("id")
      .eq("user_id", req.user.id)
      .single();

    if (!developer) {
      return res.status(403).json({
        success: false,
        message: "Профиль застройщика не найден",
      });
    }

    // Проверяем существование ЖК и его владельца
    const { data: complex, error: fetchError } = await supabase
      .from("residential_complexes")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !complex) {
      return res.status(404).json({
        success: false,
        message: "Жилой комплекс не найден",
      });
    }

    if (complex.developer_id !== developer.id && req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Вы не являетесь владельцем этого жилого комплекса",
      });
    }

    // Валидация входных данных через Zod
    const validationResult = updateComplexSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        message: "Ошибка валидации данных жилого комплекса",
        errors: validationResult.error.errors.map((e) => e.message),
      });
    }

    const {
      name,
      description,
      country,
      region,
      city,
      cityKey,
      district,
      address,
      latitude,
      longitude,
      status,
      class: housingClass,
      completionDate,
      floors,
      blocks,
      apartments,
      parking,
      ceilingHeight,
      construction,
      area,
      areaSotka,
      documentsUrl,
      amenities,
    } = validationResult.data;

    const incomingImages = validationResult.data.images ?? req.body.images;
    let finalImages = complex.features?.images || [];
    let finalCover = complex.cover_photo;

    if (Array.isArray(incomingImages) && incomingImages.length > 0) {
      if (incomingImages.some((img) => typeof img !== "string" || img.startsWith("blob:"))) {
        return res.status(400).json({
          success: false,
          message: "Некорректные ссылки на фотографии",
        });
      }
      // Проверяем владение только новыми изображениями
      const newImages = incomingImages.filter((img) => !finalImages.includes(img));
      if (newImages.length > 0 && !(await verifyAllOwnedBy(newImages, req.user.id))) {
        return res.status(400).json({
          success: false,
          message: "Все новые фото должны быть загружены через форму загрузки ЖК",
        });
      }
      finalImages = incomingImages;
      finalCover = incomingImages[0] || finalCover;
    }

    let completion_status = complex.completion_status;
    if (status) {
      if (status === "Проект" || status === "planning") completion_status = "building";
      if (status === "Строительство" || status === "construction") completion_status = "building";
      if (status === "Сдан" || status === "completed") completion_status = "completed";
    }

    const resolvedCountry =
      country !== undefined ? (country && String(country).trim()) || "kyrgyzstan" : undefined;
    const resolvedDistrict =
      district !== undefined ? (district && String(district).trim()) || null : undefined;
    const resolvedCityKey =
      cityKey !== undefined ? (cityKey && String(cityKey).trim()) || null : undefined;

    const nextFeatures = {
      ...(complex.features || {}),
      latitude: latitude !== undefined ? latitude : complex.features?.latitude,
      longitude: longitude !== undefined ? longitude : complex.features?.longitude,
      floors: floors !== undefined ? floors : complex.features?.floors,
      blocks: blocks !== undefined ? blocks : complex.features?.blocks,
      apartments: apartments !== undefined ? apartments : complex.features?.apartments,
      parking: parking !== undefined ? parking : complex.features?.parking,
      ceilingHeight: ceilingHeight !== undefined ? ceilingHeight : complex.features?.ceilingHeight,
      construction: construction !== undefined ? construction : complex.features?.construction,
      area: area !== undefined ? area : complex.features?.area,
      areaSotka: areaSotka !== undefined ? areaSotka : complex.features?.areaSotka,
      documentsUrl:
        documentsUrl !== undefined
          ? (typeof documentsUrl === "string" ? documentsUrl.trim() || null : documentsUrl)
          : complex.features?.documentsUrl,
      amenities: amenities || complex.features?.amenities || [],
      images: finalImages,
    };
    if (resolvedCountry !== undefined) nextFeatures.country = resolvedCountry;
    if (resolvedDistrict !== undefined) nextFeatures.district = resolvedDistrict;
    if (resolvedCityKey !== undefined) nextFeatures.cityKey = resolvedCityKey;

    const updateData = {
      name: name || complex.name,
      description: description !== undefined ? description : complex.description,
      region: region || city || complex.region,
      city: city || complex.city,
      address: address || complex.address,
      completion_status,
      completion_date: completionDate !== undefined ? completionDate : complex.completion_date,
      housing_class: housingClass || complex.housing_class,
      features: nextFeatures,
      cover_photo: finalCover,
    };
    if (resolvedCountry !== undefined) updateData.country = resolvedCountry;
    if (resolvedDistrict !== undefined) updateData.district = resolvedDistrict;

    let { data: updatedComplex, error: updateError } = await supabase
      .from("residential_complexes")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (updateError && (updateError.message?.includes("column") || updateError.code === "42703" || updateError.message?.includes("country") || updateError.message?.includes("district"))) {
      const fallbackData = { ...updateData };
      delete fallbackData.country;
      delete fallbackData.district;
      const fallbackResult = await supabase
        .from("residential_complexes")
        .update(fallbackData)
        .eq("id", id)
        .select()
        .single();
      updatedComplex = fallbackResult.data;
      updateError = fallbackResult.error;
    }

    if (updateError) {
      console.error("Update Complex Error:", updateError);
      return res.status(400).json({
        success: false,
        message: "Ошибка при обновлении жилого комплекса",
      });
    }

    return res.json({
      success: true,
      message: "Жилой комплекс успешно обновлен",
      data: updatedComplex,
    });
  } catch (error) {
    console.error("Update Complex Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при обновлении жилого комплекса",
    });
  }
};

// =======================================================
// 7. Удаление жилого комплекса (DELETE /api/complexes/:id)
// =======================================================
export const deleteComplex = async (req, res) => {
  try {
    const { id } = req.params;

    // Проверяем тип аккаунта
    if (req.user.account_type !== "developer") {
      return res.status(403).json({
        success: false,
        message: "Только застройщики могут удалять ЖК",
      });
    }

    // Ищем id застройщика по user_id
    const { data: developer } = await supabase
      .from("developers")
      .select("id")
      .eq("user_id", req.user.id)
      .single();

    if (!developer) {
      return res.status(403).json({
        success: false,
        message: "Профиль застройщика не найден",
      });
    }

    // Проверяем существование ЖК и его владельца
    const { data: complex, error: fetchError } = await supabase
      .from("residential_complexes")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !complex) {
      return res.status(404).json({
        success: false,
        message: "Жилой комплекс не найден",
      });
    }

    if (complex.developer_id !== developer.id && req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Вы не являетесь владельцем этого жилого комплекса",
      });
    }

    // Удаляем планировки
    await supabase.from("complex_layouts").delete().eq("complex_id", id);

    // Удаляем сам комплекс
    const { error: deleteError } = await supabase
      .from("residential_complexes")
      .delete()
      .eq("id", id);

    if (deleteError) {
      console.error("Delete Complex Error:", deleteError);
      return res.status(400).json({
        success: false,
        message: "Ошибка при удалении жилого комплекса",
      });
    }

    return res.json({
      success: true,
      message: "Жилой комплекс успешно удален",
    });
  } catch (error) {
    console.error("Delete Complex Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при удалении жилого комплекса",
    });
  }
};
