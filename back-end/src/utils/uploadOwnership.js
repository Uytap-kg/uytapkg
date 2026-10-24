import { supabase } from "../config/db.js";
import { extractStoragePath } from "./storage.js";

// =======================================================
// Реестр "кто и когда загрузил этот файл в Storage" — закрывает две
// проблемы разом:
//
// 1. IDOR на удаление файлов: trustedImageUrl (validation.js) проверяет
//    только ХОСТ ссылки, не то, кто и как её загрузил. Без этого реестра
//    злоумышленник мог бы подставить публичный URL чужого фото
//    объявления/ЖК в СВОИ photos/images (валидация хоста это пропускала
//    бы), а затем удалить/обновить свою запись — removeImageFromStorage
//    выполняется с сервисными правами и стирает файл из Storage
//    независимо от того, кому он реально принадлежит.
// 2. Обход водяного знака: фото, загруженные через публичный
//    /api/upload (без водяного знака, для логотипов/аватаров при
//    регистрации), не попадают в этот реестр — значит их нельзя
//    подставить в photos объявления/images ЖК в обход
//    /api/upload/listing-photo и /api/upload/complex-photo, которые
//    водяной знак накладывают всегда.
//
// Записи хранятся напрямую в таблице Postgres `upload_ownership`.
// =======================================================

/**
 * Фиксирует владельца загруженного файла в таблице upload_ownership.
 * Вызывается сразу после успешной загрузки в Storage через авторизованные эндпоинты.
 * Best-effort: при ошибке логирует, не прерывая ответ клиенту.
 */
export async function recordUploadOwner(objectPath, userId) {
  if (!objectPath || !userId) return;

  try {
    const { error } = await supabase.from("upload_ownership").upsert({
      object_path: objectPath,
      user_id: userId,
      uploaded_at: new Date().toISOString(),
    });

    if (error) {
      console.error("Не удалось записать владельца загруженного файла в БД:", error);
    }
  } catch (err) {
    console.error("Не удалось записать владельца загруженного файла:", err);
  }
}

/**
 * Проверяет, принадлежит ли данный objectPath указанному пользователю.
 * Возвращает true, только если в upload_ownership есть запись с совпадающим user_id.
 */
export async function isUploadOwnedBy(objectPath, userId) {
  if (!objectPath || !userId) return false;

  // Файлы из временного анонимного хранилища (avatars/pending/) никогда не могут быть частью объявлений или ЖК
  if (objectPath.startsWith("pending/") || objectPath.includes("/pending/")) {
    return false;
  }

  try {
    const { data, error } = await supabase
      .from("upload_ownership")
      .select("user_id")
      .eq("object_path", objectPath)
      .maybeSingle();

    if (error) {
      console.error("Ошибка проверки владельца файла в БД:", error);
      return false;
    }

    return data?.user_id === userId;
  } catch (err) {
    console.error("Ошибка проверки владельца файла:", err);
    return false;
  }
}

/**
 * Проверяет массив публичных URL (photos объявления / images ЖК) — true,
 * только если КАЖДЫЙ из них был загружен именно этим пользователем.
 * Пустой массив считается валидным.
 */
export async function verifyAllOwnedBy(urls, userId) {
  if (!Array.isArray(urls) || urls.length === 0) return true;
  if (!userId) return false;

  const objectPaths = [];
  for (const url of urls) {
    const objectPath = extractStoragePath(url);
    if (!objectPath || objectPath.startsWith("pending/") || objectPath.includes("/pending/")) {
      return false;
    }
    objectPaths.push(objectPath);
  }

  const uniquePaths = [...new Set(objectPaths)];
  if (uniquePaths.length === 0) return true;

  // Пакетный запрос (1 SELECT .in() вместо N последовательных запросов)
  try {
    const selectChain = supabase.from("upload_ownership").select("user_id");
    if (selectChain && typeof selectChain.in === "function") {
      const { data, error } = await selectChain.in("object_path", uniquePaths);
      if (error || !Array.isArray(data)) {
        return false;
      }
      return data.length === uniquePaths.length && data.every((row) => row.user_id === userId);
    }
  } catch {
    // Фолбэк ниже для простых моков в unit-тестах
  }

  for (const objectPath of uniquePaths) {
    // eslint-disable-next-line no-await-in-loop -- фолбэк для моков без .in()
    const owned = await isUploadOwnedBy(objectPath, userId);
    if (!owned) return false;
  }

  return true;
}
