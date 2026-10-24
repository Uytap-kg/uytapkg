import { randomUUID } from "crypto";
import { supabase } from "../config/db.js";
import { getImageExtension } from "../middleware/upload.js";

/** Имя публичного бакета в Supabase Storage (создать вручную в Dashboard). */
export const AVATARS_BUCKET = "avatars";

/**
 * Извлекает путь объекта внутри бакета из публичного URL Supabase Storage.
 */
export const extractStoragePath = (publicUrl, bucket = AVATARS_BUCKET) => {
  if (!publicUrl || typeof publicUrl !== "string") return null;
  const marker = `/object/public/${bucket}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return null;
  return publicUrl.slice(idx + marker.length).split("?")[0];
};

/**
 * Загружает буфер файла в бакет и возвращает публичный URL.
 */
export const uploadImageToStorage = async (objectPath, file) => {
  const { error } = await supabase.storage.from(AVATARS_BUCKET).upload(objectPath, file.buffer, {
    contentType: file.mimetype,
    upsert: false,
    cacheControl: "3600",
  });

  if (error) {
    throw new Error(error.message || "Не удалось загрузить файл в хранилище");
  }

  const { data } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(objectPath);
  return { publicUrl: data.publicUrl, objectPath };
};

/** Аватар авторизованного пользователя: `{userId}/{timestamp}.{ext}` */
export const uploadAvatarToStorage = async (userId, file) => {
  const ext = getImageExtension(file);
  const objectPath = `${userId}/${Date.now()}.${ext}`;
  return uploadImageToStorage(objectPath, file);
};

/** Публичная загрузка (регистрация, объявления и т.п.): `uploads/{uuid}.{ext}` (или с заданным префиксом) */
export const uploadPublicImageToStorage = async (file, prefix = "uploads") => {
  const ext = file.extension || getImageExtension(file);
  const objectPath = `${prefix}/${randomUUID()}.${ext}`;
  return uploadImageToStorage(objectPath, file);
};

/**
 * Изолированная анонимная загрузка аватара/логотипа при регистрации:
 * складывается в отдельную временную папку/префикс `avatars/pending/` (`pending/{uuid}.{ext}` в бакете `avatars`).
 */
export const uploadPendingAvatarToStorage = async (file) => {
  return uploadPublicImageToStorage(file, "pending");
};

export const uploadAnonymousImageToStorage = uploadPendingAvatarToStorage;

/**
 * Очищает файлы из временной папки `pending/` бакета `avatars`, которые:
 * 1) Старше maxAgeMs (по умолчанию 24 часа);
 * 2) Не используются ни в user_profiles (avatar_url), ни в developers (logo_url).
 */
export const cleanupOrphanedPendingAvatars = async (maxAgeMs = 24 * 60 * 60 * 1000) => {
  try {
    const { data: files, error } = await supabase.storage.from(AVATARS_BUCKET).list("pending", {
      limit: 100,
      sortBy: { column: "created_at", order: "asc" },
    });

    if (error) {
      console.warn("Storage cleanup pending: list error:", error.message);
      return { cleanedCount: 0 };
    }

    if (!files || files.length === 0) {
      return { cleanedCount: 0 };
    }

    const now = Date.now();
    const staleFiles = files.filter((f) => {
      if (!f.created_at) return false;
      const age = now - new Date(f.created_at).getTime();
      return age >= maxAgeMs;
    });

    if (staleFiles.length === 0) {
      return { cleanedCount: 0 };
    }

    const pendingPaths = staleFiles
      .map((f) => ({ name: f.name, path: `pending/${f.name}` }))
      .filter((item) => /^[a-zA-Z0-9._/-]+$/.test(item.path));

    const toDelete = [];
    const profileSelectProbe = supabase.from("user_profiles").select("avatar_url");

    // Пакетная проверка (P2-06): 2 запроса вместо до 200 последовательных SELECT в цикле
    if (profileSelectProbe && typeof profileSelectProbe.or === "function" && pendingPaths.length > 0) {
      const avatarClauses = pendingPaths.map((p) => `avatar_url.ilike.%${p.path}%`).join(",");
      const logoClauses = pendingPaths.map((p) => `logo_url.ilike.%${p.path}%`).join(",");

      const [{ data: usedProfiles }, { data: usedDevelopers }] = await Promise.all([
        supabase.from("user_profiles").select("avatar_url").or(avatarClauses),
        supabase.from("developers").select("logo_url").or(logoClauses),
      ]);

      const usedUrls = [
        ...(usedProfiles || []).map((r) => r.avatar_url).filter(Boolean),
        ...(usedDevelopers || []).map((r) => r.logo_url).filter(Boolean),
      ];

      for (const item of pendingPaths) {
        const isReferenced = usedUrls.some((url) => url.includes(item.path));
        if (!isReferenced) {
          toDelete.push(item.path);
        }
      }
    } else {
      // Фолбэк для окружений/моков без поддержки .or()
      for (const file of staleFiles) {
        const pendingPath = `pending/${file.name}`;

        const { data: userWithAvatar } = await supabase
          .from("user_profiles")
          .select("id")
          .ilike("avatar_url", `%${pendingPath}%`)
          .limit(1);

        if (userWithAvatar && userWithAvatar.length > 0) {
          continue;
        }

        const { data: devWithLogo } = await supabase
          .from("developers")
          .select("id")
          .ilike("logo_url", `%${pendingPath}%`)
          .limit(1);

        if (devWithLogo && devWithLogo.length > 0) {
          continue;
        }

        toDelete.push(pendingPath);
      }
    }

    if (toDelete.length > 0) {
      const { error: removeError } = await supabase.storage.from(AVATARS_BUCKET).remove(toDelete);
      if (removeError) {
        console.warn("Storage cleanup pending: remove error:", removeError.message);
      } else {
        return { cleanedCount: toDelete.length };
      }
    }

    return { cleanedCount: 0 };
  } catch (err) {
    console.error("Storage cleanup pending: unhandled error:", err);
    return { cleanedCount: 0 };
  }
};


/**
 * Удаляет файл из Storage, если URL принадлежит нашему бакету.
 */
export const removeImageFromStorage = async (imageUrl) => {
  const objectPath = extractStoragePath(imageUrl);
  if (!objectPath) return;

  const { error } = await supabase.storage.from(AVATARS_BUCKET).remove([objectPath]);
  if (error) {
    console.warn("Не удалось удалить файл из Storage:", error.message);
  }
};

/**
 * Приватный бакет для документов верификации застройщиков (паспорта,
 * регистрационные документы и т.п.). Создать вручную в Supabase Dashboard
 * БЕЗ публичного доступа — в отличие от `avatars`, файлы отсюда должны
 * открываться только через подписанные ссылки (createSignedUrl).
 */
export const VERIFICATION_DOCS_BUCKET = "verification-docs";

/** Загружает документ верификации в приватный бакет: `{userId}/{uuid}.{ext}` */
export const uploadVerificationDocumentToStorage = async (userId, file) => {
  const ext = getImageExtension(file);
  const objectPath = `${userId}/${randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from(VERIFICATION_DOCS_BUCKET)
    .upload(objectPath, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
      cacheControl: "3600",
    });

  if (error) {
    throw new Error(error.message || "Не удалось загрузить документ в хранилище");
  }

  return { objectPath };
};

/** Подписанная временная ссылка для просмотра документа верификации (владелец/админ). */
export const getVerificationDocumentSignedUrl = async (objectPath, expiresInSeconds = 600) => {
  if (!objectPath || typeof objectPath !== "string") return null;

  const { data, error } = await supabase.storage
    .from(VERIFICATION_DOCS_BUCKET)
    .createSignedUrl(objectPath, expiresInSeconds);

  if (error) {
    console.warn("Не удалось создать подписанную ссылку на документ верификации:", error.message);
    return null;
  }

  return data?.signedUrl || null;
};

/** Удаляет документ верификации из приватного бакета по пути объекта. */
export const removeVerificationDocumentFromStorage = async (objectPath) => {
  if (!objectPath || typeof objectPath !== "string") return;

  const { error } = await supabase.storage.from(VERIFICATION_DOCS_BUCKET).remove([objectPath]);
  if (error) {
    console.warn("Не удалось удалить документ верификации из Storage:", error.message);
  }
};

/** Публичный бакет для изображений рекламных баннеров (создан программно). */
export const BANNERS_BUCKET = "banners";

/** Загружает изображение баннера: `{uuid}.{ext}`, возвращает публичный URL. */
export const uploadBannerImageToStorage = async (file) => {
  const ext = getImageExtension(file);
  const objectPath = `${randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from(BANNERS_BUCKET)
    .upload(objectPath, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
      cacheControl: "3600",
    });

  if (error) {
    throw new Error(error.message || "Не удалось загрузить изображение баннера");
  }

  const { data } = supabase.storage.from(BANNERS_BUCKET).getPublicUrl(objectPath);
  return { publicUrl: data.publicUrl, objectPath };
};

/** Удаляет изображение баннера из Storage, если URL принадлежит бакету `banners`. */
export const removeBannerImageFromStorage = async (imageUrl) => {
  const objectPath = extractStoragePath(imageUrl, BANNERS_BUCKET);
  if (!objectPath) return;

  const { error } = await supabase.storage.from(BANNERS_BUCKET).remove([objectPath]);
  if (error) {
    console.warn("Не удалось удалить изображение баннера из Storage:", error.message);
  }
};
