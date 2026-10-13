import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { supabase } from "../config/db.js";
import { registerSchema, loginSchema, updateMeSchema, normalizePhone } from "../utils/validation.js";
import { generateSecureOtp, safeCompare } from "../utils/otp.js";
import { sendOtpEmail } from "../services/emailService.js";
import { generateToken, invalidateUserAuthCache } from "../middleware/auth.js";
import {
  uploadAvatarToStorage,
  removeImageFromStorage,
  uploadVerificationDocumentToStorage,
  getVerificationDocumentSignedUrl,
  extractStoragePath,
} from "../utils/storage.js";

const VERIFICATION_DOC_KEYS = ["document1", "document2", "document3"];

// Фиктивный bcrypt-хэш для холостого сравнения при login с несуществующим
// email/телефоном — см. login() ниже. Не привязан ни к какому реальному
// паролю, нужен только чтобы bcrypt.compare занимал сравнимое время.
const DUMMY_PASSWORD_HASH = "$2b$10$lEkmTFU5DlI2cBvqjktdyeOPlkMnP949VUGStMDpYydnIdHBDaEda";

async function syncDeveloperRecord(userId, accountType, profile, phone, email) {
  try {
    if (accountType !== "developer") {
      // Удаляем из застройщиков, если тип аккаунта сменился
      await supabase
        .from("developers")
        .delete()
        .eq("user_id", userId);
      return;
    }

    const { data: dev } = await supabase
      .from("developers")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();

    let bioText = profile?.about || "";
    if (bioText.startsWith("{") && bioText.endsWith("}")) {
      try {
        const parsed = JSON.parse(bioText);
        bioText = parsed.bio || "";
      } catch (e) {}
    }

    const devData = {
      user_id: userId,
      company_name: profile?.company_name || "Застройщик",
      logo_url: profile?.avatar_url || null,
      description: bioText || null,
      phone: phone || null,
      email: email || null,
      website: profile?.website || null,
    };

    if (dev) {
      await supabase
        .from("developers")
        .update(devData)
        .eq("id", dev.id);
    } else {
      await supabase
        .from("developers")
        .insert([devData]);
    }
  } catch (err) {
    console.error("Error syncing developer record:", err);
  }
}

// =======================================================
// Email OTP: константы и вспомогательные функции
// =======================================================
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_TTL_MS = 10 * 60 * 1000; // срок жизни кода — 10 минут
const OTP_MAX_ATTEMPTS = 5; // неверных попыток на один код
const OTP_RESEND_COOLDOWN_MS = 60 * 1000; // не чаще 1 отправки в 60 секунд
const OTP_HOURLY_LIMIT = 5; // не более 5 кодов в час на email

/**
 * Хэширование одноразового OTP-кода (HMAC-SHA256).
 * Защищает от утечки кодов при чтении БД (коды не хранятся в открытом виде).
 */
export function hashOtpCode(code) {
  const secret = process.env.OTP_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("OTP_SECRET или JWT_SECRET должен быть задан");
  }
  return crypto.createHmac("sha256", secret).update(String(code)).digest("hex");
}

// Защита от параллельных запросов на один email внутри процесса
const otpInFlight = new Set();

// Проверка кулдауна и часового лимита отправки кодов для email.
// Возвращает { message } при превышении, иначе null.
async function checkOtpSendLimits(email, type = "registration") {
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  let query = supabase
    .from("email_verifications")
    .select("created_at")
    .eq("email", email)
    .gte("created_at", hourAgo)
    .order("created_at", { ascending: false });

  if (type) {
    query = query.eq("type", type);
  }

  const { data: recent, error } = await query;

  if (error) throw error;
  if (!recent || recent.length === 0) return null;

  const sinceLast = Date.now() - new Date(recent[0].created_at).getTime();
  if (sinceLast < OTP_RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((OTP_RESEND_COOLDOWN_MS - sinceLast) / 1000);
    return { message: `Повторная отправка возможна через ${wait} секунд` };
  }

  if (recent.length >= OTP_HOURLY_LIMIT) {
    return { message: "Слишком много запросов. Попробуйте позже" };
  }

  return null;
}

// Инвалидирует все прежние коды регистрации, создаёт новый и отправляет на почту.
// В БД сохраняется только HMAC-SHA256 хэш (code_hash), открытый код отправляется исключительно на email.
async function issueRegistrationOtp(email) {
  await supabase
    .from("email_verifications")
    .update({ is_used: true })
    .eq("email", email)
    .eq("type", "registration")
    .eq("is_used", false);

  const code = generateSecureOtp();
  const codeHash = hashOtpCode(code);
  const { error } = await supabase.from("email_verifications").insert([
    {
      email,
      code_hash: codeHash,
      type: "registration",
      attempts: 0,
      expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
    },
  ]);
  if (error) throw error;

  await sendOtpEmail(email, code, "registration");
}

// Инвалидирует все прежние коды сброса пароля, создаёт новый и отправляет на почту.
// В БД сохраняется только HMAC-SHA256 хэш (code_hash), открытый код отправляется исключительно на email.
async function issuePasswordResetOtp(email) {
  await supabase
    .from("email_verifications")
    .update({ is_used: true })
    .eq("email", email)
    .eq("type", "password_reset")
    .eq("is_used", false);

  const code = generateSecureOtp();
  const codeHash = hashOtpCode(code);
  const { error } = await supabase.from("email_verifications").insert([
    {
      email,
      code_hash: codeHash,
      type: "password_reset",
      attempts: 0,
      expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
    },
  ]);
  if (error) throw error;

  await sendOtpEmail(email, code, "password_reset");
}

// Лимиты + выпуск кода под блокировкой на email.
// Возвращает { message } при превышении лимита, иначе null.
// dryRun — только проверить лимиты, ничего не отправляя.
async function guardedIssueOtp(email, { type = "registration", dryRun = false } = {}) {
  const flightKey = `${type}:${email}`;
  if (otpInFlight.has(flightKey) || otpInFlight.has(email)) {
    return { message: "Повторная отправка возможна через 60 секунд" };
  }
  otpInFlight.add(flightKey);
  try {
    const limited = await checkOtpSendLimits(email, type);
    if (limited) return limited;
    if (!dryRun) {
      if (type === "password_reset") {
        await issuePasswordResetOtp(email);
      } else {
        await issueRegistrationOtp(email);
      }
    }
    return null;
  } finally {
    otpInFlight.delete(flightKey);
  }
}

// Данные user_profiles для регистрации по типу аккаунта.
// avatar_url кладём для ЛЮБОГО типа аккаунта — это единое поле:
// у personal/realtor это фото профиля, у agency/developer — логотип компании.
function buildProfileData(userId, data) {
  const {
    accountType,
    firstName,
    lastName,
    fullName,
    companyName,
    directorName,
    inn,
    officeAddress,
    agencyName,
    about,
    avatarUrl,
  } = data;

  const profileData = {
    user_id: userId,
    about: about || null,
  };

  if (avatarUrl) {
    profileData.avatar_url = avatarUrl;
  }

  if (accountType === "personal") {
    profileData.first_name = firstName || null;
    profileData.last_name = lastName || null;
  } else if (accountType === "realtor") {
    profileData.first_name = fullName || firstName || null;
    profileData.company_name = agencyName || companyName || null;
  } else if (accountType === "developer") {
    profileData.company_name = companyName || null;
    profileData.inn = inn || null;
    profileData.office_address = officeAddress || null;
  } else if (accountType === "agency") {
    profileData.company_name = companyName || null;
    profileData.first_name = directorName || null;
    profileData.inn = inn || null;
    profileData.office_address = officeAddress || null;
  }

  return profileData;
}

// =======================================================
// 1. Регистрация нового пользователя
// =======================================================
export const register = async (req, res) => {
  try {
    // Валидация входящих данных
    const validationResult = registerSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        message: "Ошибка валидации данных",
        errors: validationResult.error.errors.map((e) => e.message),
      });
    }

    const {
      accountType,
      email,
      phone,
      password,
      firstName,
      lastName,
      fullName,
      companyName,
      directorName,
      inn,
      officeAddress,
      agencyName,
      about,
      avatarUrl, // фото профиля (для personal/realtor) или логотип (для agency/developer)
    } = validationResult.data;

    const normalizedEmail = email.toLowerCase().trim();
    const formattedPhone = normalizePhone(phone);

    // 1. Проверка существования Email или Телефона в базе
    //
    // Два отдельных .eq() вместо одного .or(`email.eq.${a},phone.eq.${b}`) —
    // .or() у supabase-js собирает строку фильтра PostgREST из сырой
    // конкатенации, а identifier/phone не ограничены по символам (только
    // минимальная длина в zod), так что запятая в значении превращалась бы
    // в дополнительное условие фильтра (PostgREST filter injection).
    const { data: existingByEmail, error: emailCheckError } = await supabase
      .from("users")
      .select("id, is_email_verified, created_at")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (emailCheckError) {
      console.error("Supabase error during email check:", emailCheckError);
    }

    // Подтверждённый аккаунт — настоящий конфликт.
    if (existingByEmail && existingByEmail.is_email_verified !== false) {
      return res.status(409).json({
        success: false,
        message: "Пользователь с таким Email уже зарегистрирован",
      });
    }

    const { data: existingByPhone, error: phoneCheckError } = await supabase
      .from("users")
      .select("id")
      .eq("phone", formattedPhone)
      .maybeSingle();

    if (phoneCheckError) {
      console.error("Supabase error during phone check:", phoneCheckError);
    }

    if (existingByPhone && existingByPhone.id !== existingByEmail?.id) {
      return res.status(409).json({
        success: false,
        message: "Пользователь с таким номером телефона уже существует",
      });
    }

    // 2. Хэширование пароля
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Защита от блокировки чужого email (griefing): email занят, но
    // НЕ подтверждён — это либо брошенная регистрация, либо попытка
    // занять чужую почту. Вместо вечного 409 перезаписываем пароль и
    // данные профиля на новые (независимо от возраста: кто бы ни
    // зарегистрировал аккаунт ранее, управлять им сможет только тот,
    // кто получит код на почту) и отправляем новый код.
    if (existingByEmail) {
      const limit = await guardedIssueOtp(normalizedEmail, { dryRun: true });
      if (limit) {
        return res.status(429).json({ success: false, message: limit.message });
      }

      const { data: takenOver, error: takeoverError } = await supabase
        .from("users")
        .update({
          account_type: accountType,
          phone: formattedPhone,
          password_hash: passwordHash,
          is_email_verified: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingByEmail.id)
        .eq("is_email_verified", false)
        .select("id, account_type, email, phone")
        .maybeSingle();

      if (takeoverError || !takenOver) {
        console.error("Error updating unverified user:", takeoverError);
        return res.status(500).json({
          success: false,
          message: "Не удалось обновить регистрацию. Попробуйте позже.",
        });
      }

      const profileUpdate = buildProfileData(takenOver.id, validationResult.data);
      const { data: existingProfileRow } = await supabase
        .from("user_profiles")
        .select("id")
        .eq("user_id", takenOver.id)
        .maybeSingle();

      if (existingProfileRow) {
        // Обнуляем поля прежней регистрации, чтобы не осталось чужих данных
        const { error } = await supabase
          .from("user_profiles")
          .update({
            first_name: null,
            last_name: null,
            company_name: null,
            inn: null,
            office_address: null,
            avatar_url: null,
            ...profileUpdate,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", takenOver.id);
        if (error) console.warn("Warning: Could not update user profile details:", error);
      } else {
        const { error } = await supabase.from("user_profiles").insert([profileUpdate]);
        if (error) console.warn("Warning: Could not create user profile details:", error);
      }

      await syncDeveloperRecord(takenOver.id, takenOver.account_type, profileUpdate, takenOver.phone, takenOver.email);

      const limited = await guardedIssueOtp(normalizedEmail);
      if (limited) {
        return res.status(429).json({ success: false, message: limited.message });
      }

      return res.status(200).json({
        success: true,
        needVerification: true,
        email: normalizedEmail,
      });
    }

    // 3. Создание записи в таблице `users` (email пока НЕ подтверждён)
    const { data: newUser, error: createError } = await supabase
      .from("users")
      .insert([
        {
          account_type: accountType,
          email: normalizedEmail,
          phone: formattedPhone,
          password_hash: passwordHash,
          is_verified: false,
          is_email_verified: false,
        },
      ])
      .select("id, account_type, email, phone, is_verified, created_at, token_version")
      .single();

    if (createError || !newUser) {
      console.error("Error inserting user:", createError);
      return res.status(500).json({
        success: false,
        message: "Ошибка сохранения пользователя в базе данных. Проверьте, созданы ли таблицы в БД.",
      });
    }

    // 4. Подготовка данных профиля
    const profileData = buildProfileData(newUser.id, validationResult.data);

    // 5. Сохранение профиля в `user_profiles`
    try {
      const { error } = await supabase
        .from("user_profiles")
        .insert([profileData])
        .select()
        .single();

      if (error) {
        console.warn("Warning: Could not create user profile details:", error);
      }
    } catch (profileError) {
      console.warn("Warning: Could not create user profile details:", profileError);
    }

    // Синхронизируем запись в таблице застройщиков
    await syncDeveloperRecord(newUser.id, newUser.account_type, profileData, newUser.phone, newUser.email);

    // 6. Генерация и отправка OTP. JWT НЕ выдаётся до подтверждения email.
    const limited = await guardedIssueOtp(normalizedEmail);
    if (limited) {
      return res.status(429).json({ success: false, message: limited.message });
    }

    return res.status(201).json({
      success: true,
      needVerification: true,
      email: normalizedEmail,
    });
  } catch (error) {
    console.error("Register Error:", error);
    return res.status(500).json({
      success: false,
      message: "Внутренняя ошибка сервера при регистрации",
    });
  }
};

// =======================================================
// 2. Вход в аккаунт (Login)
// =======================================================
export const login = async (req, res) => {
  try {
    const validationResult = loginSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        message: "Заполните логин и пароль",
      });
    }

    const { identifier, password } = validationResult.data;
    const normalizedIdentifier = identifier.trim().toLowerCase();
    const formattedPhone = normalizePhone(identifier);

    // Поиск по Email или Телефону — два отдельных .eq() вместо одного
    // .or(`email.eq.${a},phone.eq.${b}`): identifier не ограничен по
    // символам, и сырая подстановка в .or() позволяла бы внедрить
    // произвольное дополнительное условие фильтра PostgREST (например,
    // "x,role.eq.admin" превращалось бы в доп. условие "role.eq.admin").
    const { data: userByEmail, error: emailLookupError } = await supabase
      .from("users")
      .select("*")
      .eq("email", normalizedIdentifier)
      .maybeSingle();

    if (emailLookupError) {
      console.error("Login Lookup By Email Error:", emailLookupError);
    }

    let user = userByEmail;

    if (!user) {
      const { data: userByPhone, error: phoneLookupError } = await supabase
        .from("users")
        .select("*")
        .eq("phone", formattedPhone)
        .maybeSingle();

      if (phoneLookupError) {
        console.error("Login Lookup By Phone Error:", phoneLookupError);
      }

      user = userByPhone;
    }

    if (!user) {
      // Холостой bcrypt.compare против фиктивного хэша — bcrypt.compare
      // на найденном пользователе доминирует время ответа (~100мс против
      // ~2мс без него), и без этого разница во времени ответа выдавала
      // бы, существует ли email/телефон в базе (timing attack на
      // перебор базы контактов), даже не зная пароль.
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);

      return res.status(401).json({
        success: false,
        message: "Неверный Email/телефон или пароль",
      });
    }

    // Проверка совпадения пароля
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Неверный Email/телефон или пароль",
      });
    }

    // Блокировка входа без подтверждённого email. Проверяем ПОСЛЕ пароля,
    // чтобы не раскрывать статус аккаунта тому, кто пароля не знает.
    if (user.is_email_verified === false) {
      return res.status(403).json({
        success: false,
        needVerification: true,
        email: user.email,
        message: "Подтвердите email перед входом в аккаунт",
      });
    }

    // Загрузка профиля пользователя (включая avatar_url — фото/логотип)
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    // Генерация токена
    const token = generateToken({
      id: user.id,
      accountType: user.account_type,
      email: user.email,
      tokenVersion: user.token_version || 0,
    });

    return res.json({
      success: true,
      message: "Авторизация успешна",
      token,
      user: {
        id: user.id,
        accountType: user.account_type,
        email: user.email,
        phone: user.phone,
        isVerified: user.is_verified,
        profile: profile || {},
      },
    });
  } catch (error) {
    console.error("Login Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при попытке входа",
    });
  }
};

// =======================================================
// 3. Получение текущего профиля авторизованного пользователя
function formatProfileWithMetadata(profile) {
  if (!profile) return {};
  const formatted = { ...profile };
  const aboutText = formatted.about || "";
  if (aboutText.startsWith("{") && aboutText.endsWith("}")) {
    try {
      const parsed = JSON.parse(aboutText);
      formatted.about = parsed.bio || "";
      formatted.actualAddress = parsed.actualAddress || "";
      formatted.website = parsed.website || "";
      formatted.socials = parsed.socials || {};
      formatted.region = parsed.region || "";
    } catch (e) {}
  }
  return formatted;
}

// =======================================================
// 3a. Получение данных текущего авторизованного пользователя
// =======================================================
export const getMe = async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, account_type, email, phone, is_verified, role, created_at")
      .eq("id", userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({
        success: false,
        message: "Пользователь не найден",
      });
    }

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    return res.json({
      success: true,
      user: {
        id: user.id,
        accountType: user.account_type,
        email: user.email,
        phone: user.phone,
        isVerified: user.is_verified,
        role: user.role || "user",
        profile: formatProfileWithMetadata(profile),
      },
    });
  } catch (error) {
    console.error("GetMe Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при получении данных профиля",
    });
  }
};

// =======================================================
// 3b. Обновление профиля авторизованного пользователя
// =======================================================
export const updateMe = async (req, res) => {
  try {
    const userId = req.user.id;

    const validationResult = updateMeSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        message: "Ошибка валидации данных",
        errors: validationResult.error.errors.map((e) => e.message),
      });
    }

    const data = validationResult.data;
    const hasUserUpdates = data.phone !== undefined || data.accountType !== undefined;
    const profileFieldKeys = [
      "firstName",
      "lastName",
      "about",
      "avatarUrl",
      "fullName",
      "companyName",
      "directorName",
      "inn",
      "officeAddress",
      "agencyName",
      "actualAddress",
      "website",
      "socials",
      "region"
    ];
    const hasProfileUpdates =
      profileFieldKeys.some((key) => data[key] !== undefined) || data.accountType !== undefined;

    if (!hasUserUpdates && !hasProfileUpdates) {
      return res.status(400).json({
        success: false,
        message: "Не переданы поля для обновления",
      });
    }

    const { data: currentUser, error: currentUserError } = await supabase
      .from("users")
      .select("id, account_type, email, phone, is_verified, created_at")
      .eq("id", userId)
      .single();

    if (currentUserError || !currentUser) {
      return res.status(404).json({
        success: false,
        message: "Пользователь не найден",
      });
    }

    const { data: currentProfile } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    // Валидация обязательных полей для бизнес-ролей
    const targetAccountType = data.accountType || currentUser.account_type;
    if (targetAccountType === "realtor") {
      const finalFullName = data.fullName || data.firstName || currentProfile?.first_name;
      const finalInn = data.inn || currentProfile?.inn;
      const finalPhone = data.phone || currentUser.phone;
      const finalAbout = data.about || currentProfile?.about;

      if (!finalFullName || finalFullName.trim() === "") return res.status(400).json({ success: false, message: "ФИО обязательно для риэлтора" });
      if (!finalInn || finalInn.trim() === "") return res.status(400).json({ success: false, message: "ИНН обязателен для риэлтора" });
      if (!finalPhone || finalPhone.trim() === "") return res.status(400).json({ success: false, message: "Телефон обязателен для риэлтора" });
      if (!finalAbout || finalAbout.trim() === "") return res.status(400).json({ success: false, message: "Описание обязательно для риэлтора" });
    } else if (targetAccountType === "agency") {
      const finalName = data.companyName || data.agencyName || currentProfile?.company_name;
      const finalInn = data.inn || currentProfile?.inn;
      const finalOffice = data.officeAddress || currentProfile?.office_address;
      const finalPhone = data.phone || currentUser.phone;

      if (!finalName || finalName.trim() === "") return res.status(400).json({ success: false, message: "Название агентства обязательно" });
      if (!finalInn || finalInn.trim() === "") return res.status(400).json({ success: false, message: "ИНН обязателен для агентства" });
      if (!finalOffice || finalOffice.trim() === "") return res.status(400).json({ success: false, message: "Юридический адрес обязателен для агентства" });
      if (!finalPhone || finalPhone.trim() === "") return res.status(400).json({ success: false, message: "Телефон обязателен для агентства" });
    } else if (targetAccountType === "developer") {
      const finalName = data.companyName || currentProfile?.company_name;
      const finalInn = data.inn || currentProfile?.inn;
      const finalOffice = data.officeAddress || currentProfile?.office_address;
      const finalPhone = data.phone || currentUser.phone;

      if (!finalName || finalName.trim() === "") return res.status(400).json({ success: false, message: "Название компании застройщика обязательно" });
      if (!finalInn || finalInn.trim() === "") return res.status(400).json({ success: false, message: "ИНН обязателен для застройщика" });
      if (!finalOffice || finalOffice.trim() === "") return res.status(400).json({ success: false, message: "Юридический адрес обязателен для застройщика" });
      if (!finalPhone || finalPhone.trim() === "") return res.status(400).json({ success: false, message: "Телефон обязателен для застройщика" });
    }

    const userUpdates = {};
    if (data.phone !== undefined) {
      const formattedPhone = normalizePhone(data.phone);
      const { data: phoneConflict } = await supabase
        .from("users")
        .select("id")
        .eq("phone", formattedPhone)
        .neq("id", userId)
        .maybeSingle();

      if (phoneConflict) {
        return res.status(400).json({
          success: false,
          message: "Пользователь с таким номером телефона уже существует",
        });
      }
      userUpdates.phone = formattedPhone;
    }

    if (data.accountType !== undefined) {
      userUpdates.account_type = data.accountType;
    }

    if (Object.keys(userUpdates).length > 0) {
      userUpdates.updated_at = new Date().toISOString();
      const { error: userUpdateError } = await supabase
        .from("users")
        .update(userUpdates)
        .eq("id", userId);

      if (userUpdateError) {
        console.error("UpdateMe user error:", userUpdateError);
        return res.status(500).json({
          success: false,
          message: "Не удалось обновить данные пользователя",
        });
      }
    }

    const profileUpdates = {};

    // Разбираем metadata из `about` колонки для не-personal аккаунтов
    const existingAbout = currentProfile?.about || "";
    let existingMetadata = {};
    if (existingAbout.startsWith("{") && existingAbout.endsWith("}")) {
      try {
        existingMetadata = JSON.parse(existingAbout);
      } catch (e) {}
    }

    const metadata = {
      bio: data.about !== undefined ? data.about : (existingMetadata.bio || existingAbout),
      actualAddress: data.actualAddress !== undefined ? data.actualAddress : (existingMetadata.actualAddress || ""),
      website: data.website !== undefined ? data.website : (existingMetadata.website || ""),
      socials: data.socials !== undefined ? data.socials : (existingMetadata.socials || {}),
      region: data.region !== undefined ? data.region : (existingMetadata.region || ""),
    };

    // Верификация застройщика хранится в этом же JSON — сохраняем эти поля,
    // иначе обычное редактирование профиля (сайт, соцсети и т.п.) стирало бы
    // статус/документы поданной заявки.
    if (existingMetadata.verificationStatus !== undefined) {
      metadata.verificationStatus = existingMetadata.verificationStatus;
    }
    if (existingMetadata.verificationDocs !== undefined) {
      metadata.verificationDocs = existingMetadata.verificationDocs;
    }
    if (existingMetadata.rejectionReason !== undefined) {
      metadata.rejectionReason = existingMetadata.rejectionReason;
    }

    const hasExtraUpdates =
      data.about !== undefined ||
      data.actualAddress !== undefined ||
      data.website !== undefined ||
      data.socials !== undefined ||
      data.region !== undefined;

    if (targetAccountType === "personal") {
      if (data.about !== undefined) profileUpdates.about = data.about;
    } else {
      if (hasExtraUpdates) {
        profileUpdates.about = JSON.stringify(metadata);
      }
    }

    if (data.inn !== undefined) profileUpdates.inn = data.inn;
    if (data.officeAddress !== undefined) profileUpdates.office_address = data.officeAddress;
    if (data.lastName !== undefined) profileUpdates.last_name = data.lastName;

    if (data.firstName !== undefined) profileUpdates.first_name = data.firstName;
    if (data.fullName !== undefined) profileUpdates.first_name = data.fullName;
    if (data.directorName !== undefined) profileUpdates.first_name = data.directorName;

    if (data.companyName !== undefined) profileUpdates.company_name = data.companyName;
    if (data.agencyName !== undefined) profileUpdates.company_name = data.agencyName;

    if (data.avatarUrl !== undefined) {
      const oldAvatarUrl = currentProfile?.avatar_url;
      const avatarChanged = oldAvatarUrl !== data.avatarUrl;

      // Новый avatarUrl (не то же самое значение, что уже сохранено)
      // обязан быть загружен именно ЭТИМ пользователем через
      // /api/auth/avatar — путь объекта там всегда `${userId}/...`.
      // Без этой проверки trustedImageUrl (validation.js) пропустил бы
      // ЛЮБУЮ ссылку с нашего Storage-хоста, включая чужой аватар/фото —
      // а замена аватара удаляет предыдущий файл (см. removeImageFromStorage
      // ниже) с сервисными правами, т.е. позволяла бы стереть чужой файл.
      if (avatarChanged && data.avatarUrl) {
        const objectPath = extractStoragePath(data.avatarUrl);
        if (!objectPath || !objectPath.startsWith(`${userId}/`)) {
          return res.status(400).json({
            success: false,
            message: "Фото профиля должно быть загружено вами через форму профиля",
          });
        }
      }

      profileUpdates.avatar_url = data.avatarUrl;

      if (oldAvatarUrl && avatarChanged) {
        await removeImageFromStorage(oldAvatarUrl);
      }
    }

    let profile = currentProfile;

    if (Object.keys(profileUpdates).length > 0) {
      profileUpdates.updated_at = new Date().toISOString();

      if (currentProfile) {
        const { data: updatedProfile, error: profileError } = await supabase
          .from("user_profiles")
          .update(profileUpdates)
          .eq("user_id", userId)
          .select()
          .single();

        if (profileError) {
          console.error("UpdateMe profile error:", profileError);
          return res.status(500).json({
            success: false,
            message: "Не удалось обновить профиль",
          });
        }
        profile = updatedProfile;
      } else {
        const { data: insertedProfile, error: profileError } = await supabase
          .from("user_profiles")
          .insert([{ user_id: userId, ...profileUpdates }])
          .select()
          .single();

        if (profileError) {
          console.error("UpdateMe profile insert error:", profileError);
          return res.status(500).json({
            success: false,
            message: "Не удалось создать профиль",
          });
        }
        profile = insertedProfile;
      }
    }

    const { data: updatedUser, error: fetchUserError } = await supabase
      .from("users")
      .select("id, account_type, email, phone, is_verified, created_at")
      .eq("id", userId)
      .single();

    if (!fetchUserError && updatedUser) {
      await syncDeveloperRecord(userId, updatedUser.account_type, profile, updatedUser.phone, updatedUser.email);
    }

    if (fetchUserError || !updatedUser) {
      return res.status(500).json({
        success: false,
        message: "Не удалось получить обновлённые данные пользователя",
      });
    }

    invalidateUserAuthCache(userId);

    return res.json({
      success: true,
      message: "Профиль успешно обновлён",
      user: {
        id: updatedUser.id,
        accountType: updatedUser.account_type,
        email: updatedUser.email,
        phone: updatedUser.phone,
        isVerified: updatedUser.is_verified,
        profile: formatProfileWithMetadata(profile),
      },
    });
  } catch (error) {
    console.error("UpdateMe Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при обновлении профиля",
    });
  }
};

// =======================================================
// 4. Загрузка аватара / логотипа (multipart, поле `avatar`)
// =======================================================
export const uploadUserAvatar = async (req, res) => {
  try {
    const userId = req.user.id;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Файл аватара не передан. Ожидается поле формы `avatar`.",
      });
    }

    const { data: existingProfile, error: profileSelectError } = await supabase
      .from("user_profiles")
      .select("id, avatar_url")
      .eq("user_id", userId)
      .maybeSingle();

    if (profileSelectError) {
      console.warn("Upload Avatar profile select warning:", profileSelectError);
    }

    const { publicUrl } = await uploadAvatarToStorage(userId, req.file);

    const { data, error } = await supabase
      .from("user_profiles")
      .upsert(
        {
          user_id: userId,
          avatar_url: publicUrl,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      )
      .select()
      .single();

    if (error) {
      console.error("Avatar profile upsert error:", error);
      return res.status(500).json({
        success: false,
        message: "Файл загружен, но не удалось сохранить профиль",
      });
    }

    const profile = data;

    // Синхронизируем логотип в таблице developers, если аккаунт - застройщик
    if (req.user.account_type === "developer") {
      const { error: devLogoError } = await supabase
        .from("developers")
        .update({ logo_url: publicUrl })
        .eq("user_id", userId);

      if (devLogoError) {
        console.warn("Не удалось обновить logo_url в developers:", devLogoError);
      }
    }

    if (existingProfile?.avatar_url && existingProfile.avatar_url !== publicUrl) {
      await removeImageFromStorage(existingProfile.avatar_url);
    }

    return res.json({
      success: true,
      message: "Аватар успешно загружен",
      avatar_url: publicUrl,
      profile,
    });
  } catch (error) {
    console.error("Upload Avatar Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Ошибка сервера при загрузке аватара",
    });
  }
};

// =======================================================
// 5. Удаление аватара
// =======================================================
export const deleteUserAvatar = async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: existingProfile } = await supabase
      .from("user_profiles")
      .select("avatar_url")
      .eq("user_id", userId)
      .maybeSingle();

    if (!existingProfile?.avatar_url) {
      return res.status(404).json({
        success: false,
        message: "Аватар не установлен",
      });
    }

    const oldUrl = existingProfile.avatar_url;

    const { data: profile, error } = await supabase
      .from("user_profiles")
      .update({ avatar_url: null, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        success: false,
        message: "Не удалось удалить аватар из профиля",
      });
    }

    if (req.user.account_type === "developer") {
      await supabase
        .from("developers")
        .update({ logo_url: null })
        .eq("user_id", userId);
    }

    await removeImageFromStorage(oldUrl);

    return res.json({
      success: true,
      message: "Аватар удалён",
      profile,
    });
  } catch (error) {
    console.error("Delete Avatar Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при удалении аватара",
    });
  }
};

// =======================================================
// 6. Email OTP: повторная отправка (sendOtp) и проверка (verifyOtp)
//
// Раньше здесь была заглушка для телефона (с бэкдором "1111"/"1234").
// Теперь — подтверждение email при регистрации.
// =======================================================
export const sendOtp = async (req, res) => {
  try {
    const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase().trim() : "";
    if (!email || !EMAIL_REGEX.test(email) || email.length > 255) {
      return res.status(400).json({ success: false, message: "Укажите корректный email" });
    }

    // Отправляем только неподтверждённым аккаунтам. Для остальных отвечаем
    // так же, как при успехе, — чтобы эндпоинт не выдавал, какие email
    // зарегистрированы, и не использовался для спама чужих ящиков.
    const { data: user } = await supabase
      .from("users")
      .select("id, is_email_verified")
      .eq("email", email)
      .maybeSingle();

    if (!user || user.is_email_verified !== false) {
      return res.json({ success: true, message: "Если аккаунт существует, код отправлен" });
    }

    const limit = await guardedIssueOtp(email);
    if (limit) {
      return res.status(429).json({ success: false, message: limit.message });
    }

    return res.json({ success: true, message: "Код подтверждения отправлен", email });
  } catch (error) {
    console.error("Send OTP Error:", error);
    return res.status(500).json({
      success: false,
      message: "Не удалось отправить код подтверждения",
    });
  }
};

export const verifyOtp = async (req, res) => {
  try {
    const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase().trim() : "";
    const code = typeof req.body?.code === "string" || typeof req.body?.code === "number"
      ? String(req.body.code).trim()
      : "";

    if (!email || !code) {
      return res.status(400).json({ success: false, message: "Укажите email и код" });
    }

    // Последний активный код: только он может быть валидным
    const { data: record, error: findError } = await supabase
      .from("email_verifications")
      .select("*")
      .eq("email", email)
      .eq("type", "registration")
      .eq("is_used", false)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findError) {
      console.error("Verify OTP lookup error:", findError);
    }

    if (!record) {
      return res.status(400).json({
        success: false,
        message: "Код не найден или срок его действия истек",
      });
    }

    // Атомарный инкремент попыток в БД ДО проверки кода (защита от race condition и брутфорса)
    const { data: attemptsCount, error: rpcError } = await supabase.rpc("consume_otp_attempt", {
      p_id: record.id,
    });

    if (rpcError) {
      console.error("consume_otp_attempt RPC error:", rpcError);
    }

    const attempts = typeof attemptsCount === "number" ? attemptsCount : -1;

    // Если функция вернула -1 или attempts > 5: немедленно возвращаем 400 Bad Request
    if (attempts === -1 || attempts > OTP_MAX_ATTEMPTS) {
      return res.status(400).json({
        success: false,
        message: "Превышено максимальное число попыток ввода кода (5). Запросите новый код",
      });
    }

    // Сравнение HMAC-SHA256 хэшей через crypto.timingSafeEqual
    const inputHash = hashOtpCode(code);
    const expectedHash = record.code_hash || (record.code ? hashOtpCode(record.code) : "");

    const bufInput = Buffer.from(inputHash, "utf8");
    const bufExpected = Buffer.from(expectedHash, "utf8");

    const isMatch = bufInput.length === bufExpected.length && crypto.timingSafeEqual(bufInput, bufExpected);

    if (!isMatch) {
      const attemptsLeft = Math.max(0, OTP_MAX_ATTEMPTS - attempts);
      return res.status(400).json({
        success: false,
        message: `Неверный код. Осталось попыток: ${attemptsLeft}`,
        attemptsLeft,
      });
    }

    // Код верный: атомарно ставим is_used = true (защита от двойного использования при гонке)
    const { data: consumed } = await supabase
      .from("email_verifications")
      .update({ is_used: true })
      .eq("id", record.id)
      .eq("is_used", false)
      .select("id")
      .maybeSingle();

    if (!consumed) {
      return res.status(400).json({
        success: false,
        message: "Код не найден или срок его действия истек",
      });
    }

    const { data: user, error: userError } = await supabase
      .from("users")
      .update({ is_email_verified: true, updated_at: new Date().toISOString() })
      .eq("email", email)
      .select("id, account_type, email, phone, is_verified, token_version")
      .maybeSingle();

    if (userError || !user) {
      console.error("Verify OTP user update error:", userError);
      return res.status(500).json({
        success: false,
        message: "Не удалось подтвердить email",
      });
    }

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    const token = generateToken({
      id: user.id,
      accountType: user.account_type,
      email: user.email,
      tokenVersion: user.token_version || 0,
    });

    return res.json({
      success: true,
      message: "Email подтвержден",
      token,
      user: {
        id: user.id,
        accountType: user.account_type,
        email: user.email,
        phone: user.phone,
        isVerified: user.is_verified,
        profile: profile || {},
      },
    });
  } catch (error) {
    console.error("Verify OTP Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при проверке кода",
    });
  }
};

// =======================================================
// 6a. Восстановление пароля через Email OTP
// =======================================================

/**
 * Шаг 1: Запрос кода сброса пароля (POST /api/auth/forgot-password)
 *
 * Требования безопасности:
 * 1. User Enumeration: если email не найден, возвращаем 200 с нейтральным сообщением,
 *    не раскрывая наличие аккаунта в системе.
 * 2. Email-бомбинг: кулдаун 60 секунд между запросами и лимит не более 5 кодов в час на один email.
 */
export const forgotPassword = async (req, res) => {
  try {
    const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase().trim() : "";
    if (!email || !EMAIL_REGEX.test(email) || email.length > 255) {
      return res.status(400).json({ success: false, message: "Укажите корректный email" });
    }

    // Ищем пользователя в базе данных
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, is_email_verified")
      .eq("email", email)
      .maybeSingle();

    if (userError) {
      console.error("Forgot password user lookup error:", userError);
    }

    // Защита от User Enumeration:
    // Если аккаунт не найден — не возвращаем 404, а возвращаем 200 с одинаковым ответом.
    if (!user) {
      return res.json({
        success: true,
        message: "Если аккаунт существует, код отправлен на почту",
      });
    }

    // Проверяем лимиты и отправляем код сброса пароля (type = 'password_reset')
    const limit = await guardedIssueOtp(email, { type: "password_reset" });
    if (limit) {
      return res.status(429).json({ success: false, message: limit.message });
    }

    return res.json({
      success: true,
      message: "Если аккаунт существует, код отправлен на почту",
    });
  } catch (error) {
    console.error("Forgot Password Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при запросе сброса пароля",
    });
  }
};

/**
 * Шаг 2: Проверка 6-значного кода сброса пароля (POST /api/auth/verify-reset-code)
 *
 * Требования безопасности:
 * 1. Защита от брутфорса: attempts <= 5, safeCompare (timingSafeEqual). На 5-й попытке код аннулируется.
 * 2. Выдача одноразового signed JWT resetToken со сроком жизни 10 минут,
 *    содержащего { email, codeId, purpose: 'password_reset' }.
 */
export const verifyResetCode = async (req, res) => {
  try {
    const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase().trim() : "";
    const code = typeof req.body?.code === "string" || typeof req.body?.code === "number"
      ? String(req.body.code).trim()
      : "";

    if (!email || !code) {
      return res.status(400).json({ success: false, message: "Укажите email и код" });
    }

    // Ищем последний активный код типа 'password_reset'
    const { data: record, error: findError } = await supabase
      .from("email_verifications")
      .select("*")
      .eq("email", email)
      .eq("type", "password_reset")
      .eq("is_used", false)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findError) {
      console.error("Verify reset code lookup error:", findError);
    }

    if (!record) {
      return res.status(400).json({
        success: false,
        message: "Код не найден или срок его действия истек",
      });
    }

    // Атомарный инкремент попыток в БД ДО проверки кода (защита от race condition и брутфорса)
    const { data: attemptsCount, error: rpcError } = await supabase.rpc("consume_otp_attempt", {
      p_id: record.id,
    });

    if (rpcError) {
      console.error("consume_otp_attempt RPC error:", rpcError);
    }

    const attempts = typeof attemptsCount === "number" ? attemptsCount : -1;

    // Если функция вернула -1 или attempts > 5: немедленно возвращаем 400 Bad Request
    if (attempts === -1 || attempts > OTP_MAX_ATTEMPTS) {
      return res.status(400).json({
        success: false,
        message: "Превышено максимальное число попыток ввода кода (5). Запросите новый код",
      });
    }

    // Сравнение HMAC-SHA256 хэшей через crypto.timingSafeEqual
    const inputHash = hashOtpCode(code);
    const expectedHash = record.code_hash || (record.code ? hashOtpCode(record.code) : "");

    const bufInput = Buffer.from(inputHash, "utf8");
    const bufExpected = Buffer.from(expectedHash, "utf8");

    const isMatch = bufInput.length === bufExpected.length && crypto.timingSafeEqual(bufInput, bufExpected);

    if (!isMatch) {
      const attemptsLeft = Math.max(0, OTP_MAX_ATTEMPTS - attempts);
      return res.status(400).json({
        success: false,
        message: `Неверный код. Осталось попыток: ${attemptsLeft}`,
        attemptsLeft,
      });
    }

    // При совпадении кода: атомарно ставим is_used = true
    const { data: consumed } = await supabase
      .from("email_verifications")
      .update({ is_used: true })
      .eq("id", record.id)
      .eq("is_used", false)
      .select("id")
      .maybeSingle();

    if (!consumed) {
      return res.status(400).json({
        success: false,
        message: "Код не найден или срок его действия истек",
      });
    }

    // Код верный! Генерируем подписанный JWT resetToken со сроком жизни 10 минут
    const resetToken = jwt.sign(
      {
        email,
        codeId: record.id,
        purpose: "password_reset",
      },
      process.env.JWT_SECRET,
      { expiresIn: "10m", algorithm: "HS256" }
    );

    return res.json({
      success: true,
      message: "Код подтвержден",
      resetToken,
    });
  } catch (error) {
    console.error("Verify Reset Code Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при проверке кода",
    });
  }
};

/**
 * Шаг 3: Установка нового пароля (POST /api/auth/reset-password)
 *
 * Требования безопасности:
 * 1. Защита от подмены email (Account Takeover): принимается только при наличии валидного resetToken,
 *    подписанного JWT_SECRET и содержащего { email, codeId, purpose: 'password_reset' }.
 * 2. Защита от повторного использования (Replay Attack): код в email_verifications помечается reset_completed = true.
 *    Нельзя использовать один и тот же resetToken повторно.
 * 3. Валидация пароля: 6–72 символа, хэширование через bcryptjs (10 раундов).
 */
export const resetPassword = async (req, res) => {
  try {
    const resetToken =
      req.body?.resetToken ||
      (req.headers["authorization"]?.startsWith("Bearer ")
        ? req.headers["authorization"].slice(7)
        : null);

    const newPassword =
      typeof req.body?.newPassword === "string"
        ? req.body.newPassword
        : typeof req.body?.password === "string"
        ? req.body.password
        : "";

    if (!resetToken || typeof resetToken !== "string") {
      return res.status(400).json({
        success: false,
        message: "Токен сброса пароля не передан",
      });
    }

    // 1. Проверяем подпись и срок действия JWT resetToken
    let decoded;
    try {
      decoded = jwt.verify(resetToken, process.env.JWT_SECRET, { algorithms: ["HS256"] });
    } catch (jwtErr) {
      return res.status(400).json({
        success: false,
        message: "Недействительный или истекший токен сброса пароля",
      });
    }

    if (
      !decoded ||
      decoded.purpose !== "password_reset" ||
      !decoded.email ||
      !decoded.codeId
    ) {
      return res.status(400).json({
        success: false,
        message: "Некорректный токен сброса пароля",
      });
    }

    // 2. Валидация пароля (6–72 символа)
    if (!newPassword || newPassword.length < 6 || newPassword.length > 72) {
      return res.status(400).json({
        success: false,
        message: "Пароль должен содержать от 6 до 72 символов",
      });
    }

    // 3. Защита от Replay Attack: проверяем код в email_verifications по codeId
    const { data: codeRecord, error: codeErr } = await supabase
      .from("email_verifications")
      .select("*")
      .eq("id", decoded.codeId)
      .eq("email", decoded.email)
      .eq("type", "password_reset")
      .maybeSingle();

    if (codeErr || !codeRecord) {
      return res.status(400).json({
        success: false,
        message: "Запись сброса пароля не найдена",
      });
    }

    // Токен действителен, только если код был верифицирован (is_used = true)
    // и ещё не использовался для финальной установки пароля (reset_completed != true)
    if (!codeRecord.is_used || codeRecord.reset_completed) {
      return res.status(400).json({
        success: false,
        message: "Этот токен сброса пароля уже был использован",
      });
    }

    if (new Date(codeRecord.expires_at).getTime() < Date.now()) {
      return res.status(400).json({
        success: false,
        message: "Срок действия кода сброса пароля истек",
      });
    }

    // Атомарно помечаем reset_completed = true (защита от гонки и Replay Attack)
    const { data: consumedCode, error: consumeError } = await supabase
      .from("email_verifications")
      .update({ reset_completed: true })
      .eq("id", decoded.codeId)
      .eq("reset_completed", false)
      .select("id")
      .maybeSingle();

    if (consumeError || !consumedCode) {
      return res.status(400).json({
        success: false,
        message: "Этот токен сброса пароля уже был использован",
      });
    }

    // 4. Хэширование нового пароля (bcryptjs, 10 раундов)
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(newPassword, saltRounds);

    // Считываем актуальную версию токена пользователя
    const { data: userToReset } = await supabase
      .from("users")
      .select("id, token_version")
      .eq("email", decoded.email)
      .maybeSingle();

    const nextTokenVersion = (userToReset?.token_version || 0) + 1;

    // 5. Обновляем password_hash, инкрементируем token_version (отзыв всех выданных токенов)
    // и помечаем email как подтверждённый
    const { data: updatedUser, error: updateError } = await supabase
      .from("users")
      .update({
        password_hash: passwordHash,
        token_version: nextTokenVersion,
        is_email_verified: true,
        updated_at: new Date().toISOString(),
      })
      .eq("email", decoded.email)
      .select("id, email, token_version")
      .maybeSingle();

    if (updateError || !updatedUser) {
      console.error("Reset password user update error:", updateError);
      return res.status(500).json({
        success: false,
        message: "Не удалось обновить пароль пользователя",
      });
    }

    invalidateUserAuthCache(updatedUser?.id || userToReset?.id);

    return res.json({
      success: true,
      message: "Пароль успешно изменен",
    });
  } catch (error) {
    console.error("Reset Password Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при смене пароля",
    });
  }
};

/**
 * Завершение всех активных сессий пользователя (POST /api/auth/logout-all)
 * Инкрементирует token_version в БД, благодаря чему все ранее выданные
 * JWT-токены пользователя немедленно становятся недействительными.
 */
export const logoutAll = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Требуется авторизация",
      });
    }

    // Считываем актуальный token_version пользователя из БД
    const { data: user, error: fetchError } = await supabase
      .from("users")
      .select("token_version")
      .eq("id", userId)
      .maybeSingle();

    if (fetchError || !user) {
      return res.status(404).json({
        success: false,
        message: "Пользователь не найден",
      });
    }

    const currentVersion = user.token_version ?? req.user?.token_version ?? 0;
    const nextVersion = (currentVersion || 0) + 1;

    const { error: updateError } = await supabase
      .from("users")
      .update({
        token_version: nextVersion,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (updateError) {
      console.error("Logout-all update error:", updateError);
      return res.status(500).json({
        success: false,
        message: "Не удалось завершить сессии",
      });
    }

    invalidateUserAuthCache(userId);

    return res.status(200).json({
      success: true,
      message: "Все активные сессии успешно завершены",
    });
  } catch (error) {
    console.error("Logout-all Error:", error);
    return res.status(500).json({
      success: false,
      message: "Внутренняя ошибка сервера при завершении сессий",
    });
  }
};

// =======================================================
// 7. Получение публичного профиля пользователя по ID
// =======================================================
export const getUserPublicProfile = async (req, res) => {
  try {
    const { id } = req.params;

    let user = null;
    const { data: userRow } = await supabase
      .from("users")
      .select("id, account_type, email, phone, is_verified, created_at")
      .eq("id", id)
      .maybeSingle();

    if (userRow) {
      user = userRow;
    } else {
      // Попробуем поискать по developers.id
      const { data: devRow } = await supabase
        .from("developers")
        .select("user_id")
        .eq("id", id)
        .maybeSingle();

      if (devRow && devRow.user_id) {
        const { data: userByDev } = await supabase
          .from("users")
          .select("id, account_type, email, phone, is_verified, created_at")
          .eq("id", devRow.user_id)
          .maybeSingle();
        user = userByDev;
      }
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Пользователь не найден",
      });
    }

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    // Fetch active listings for this user
    const { data: listings } = await supabase
      .from("listings")
      .select(`
        *,
        listing_photos (id, url, is_main, display_order)
      `)
      .eq("user_id", user.id)
      .eq("status", "active")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });

    // If developer, fetch complexes!
    let complexes = [];
    if (user.account_type === "developer") {
      const { data: devRow } = await supabase
        .from("developers")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (devRow) {
        const { data: devComplexes } = await supabase
          .from("residential_complexes")
          .select("*")
          .eq("developer_id", devRow.id)
          .order("created_at", { ascending: false });
        complexes = devComplexes || [];
      }
    }

    const isBusinessAccount = ["agency", "developer", "realtor"].includes(user.account_type);

    return res.json({
      success: true,
      user: {
        id: user.id,
        type: user.account_type,
        email: isBusinessAccount ? user.email : null,
        phone: isBusinessAccount ? user.phone : null,
        isVerified: user.is_verified,
        createdAt: user.created_at,
        profile: formatProfileWithMetadata(profile),
        ads: listings || [],
        complexes: complexes || []
      }
    });
  } catch (error) {
    console.error("GetUserPublicProfile Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при получении публичного профиля",
    });
  }
};

// =======================================================
// 10. Загрузка, подача и статус заявки на верификацию застройщика
// =======================================================

// 10a. Загрузка одного документа верификации (POST /api/auth/verify-documents)
// Документы — чувствительные данные (паспорт, регистрационные бумаги),
// поэтому эндпоинт защищён авторизацией и хранит файлы в приватном бакете
// (в отличие от публичного /api/upload, который отдаёт открытые ссылки).
export const uploadVerificationDocument = async (req, res) => {
  try {
    if (req.user.account_type !== "developer") {
      return res.status(403).json({
        success: false,
        message: "Загрузка документов верификации доступна только застройщикам",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Файл не передан. Ожидается поле формы `document`.",
      });
    }

    const { objectPath } = await uploadVerificationDocumentToStorage(req.user.id, req.file);
    const signedUrl = await getVerificationDocumentSignedUrl(objectPath);

    return res.json({
      success: true,
      path: objectPath,
      previewUrl: signedUrl,
    });
  } catch (error) {
    console.error("Upload Verification Document Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Ошибка сервера при загрузке документа",
    });
  }
};

// 10b. Подача заявки на верификацию (POST /api/auth/verify-request)
export const submitVerificationRequest = async (req, res) => {
  try {
    const userId = req.user.id;

    if (req.user.account_type !== "developer") {
      return res.status(403).json({
        success: false,
        message: "Верификация доступна только аккаунтам застройщика",
      });
    }

    const { documents } = req.body;

    if (!documents || typeof documents !== "object" || Array.isArray(documents)) {
      return res.status(400).json({
        success: false,
        message: "Необходимо передать загруженные документы для проверки",
      });
    }

    // Принимаем только ожидаемые ключи, и только пути, которые
    // uploadVerificationDocument выдал именно этому пользователю —
    // это не даёт подставить чужой документ или произвольную ссылку.
    const sanitizedDocuments = {};
    for (const key of VERIFICATION_DOC_KEYS) {
      const value = documents[key];
      if (typeof value !== "string" || !value.startsWith(`${userId}/`)) {
        return res.status(400).json({
          success: false,
          message: "Все документы должны быть загружены через /verify-documents перед отправкой заявки",
        });
      }
      sanitizedDocuments[key] = value;
    }

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    let aboutMeta = {};
    if (profile?.about && profile.about.startsWith("{") && profile.about.endsWith("}")) {
      try {
        aboutMeta = JSON.parse(profile.about);
      } catch (e) {}
    } else if (profile?.about) {
      aboutMeta = { bio: profile.about };
    }

    aboutMeta.verificationStatus = "pending";
    aboutMeta.verificationDocs = sanitizedDocuments;
    aboutMeta.rejectionReason = "";

    const updatedAbout = JSON.stringify(aboutMeta);

    if (profile) {
      await supabase
        .from("user_profiles")
        .update({ about: updatedAbout })
        .eq("id", profile.id);
    } else {
      await supabase
        .from("user_profiles")
        .insert([{ user_id: userId, about: updatedAbout }]);
    }

    await supabase
      .from("users")
      .update({ is_verified: false })
      .eq("id", userId);

    return res.json({
      success: true,
      message: "Заявка на верификацию успешно отправлена на рассмотрение",
      status: "pending",
    });
  } catch (error) {
    console.error("Submit Verification Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при отправке заявки на верификацию",
    });
  }
};

export const getVerificationStatus = async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: user } = await supabase
      .from("users")
      .select("id, is_verified")
      .eq("id", userId)
      .single();

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("about")
      .eq("user_id", userId)
      .maybeSingle();

    let aboutMeta = {};
    if (profile?.about && profile.about.startsWith("{") && profile.about.endsWith("}")) {
      try {
        aboutMeta = JSON.parse(profile.about);
      } catch (e) {}
    }

    let status = aboutMeta.verificationStatus || (user?.is_verified ? "approved" : "none");
    if (user?.is_verified) {
      status = "approved";
    }

    // `documents` содержит пути хранилища (нужны, чтобы повторно отправить
    // заявку без переза­грузки файлов — путь сам по себе не даёт доступа,
    // бакет приватный). `previewUrls` — временные подписанные ссылки для
    // просмотра владельцем.
    let documents = null;
    let previewUrls = null;
    if (aboutMeta.verificationDocs && typeof aboutMeta.verificationDocs === "object") {
      documents = {};
      previewUrls = {};
      for (const key of VERIFICATION_DOC_KEYS) {
        const path = aboutMeta.verificationDocs[key];
        if (path) {
          documents[key] = path;
          previewUrls[key] = await getVerificationDocumentSignedUrl(path);
        }
      }
    }

    return res.json({
      success: true,
      isVerified: Boolean(user?.is_verified),
      status,
      documents,
      previewUrls,
      rejectionReason: aboutMeta.rejectionReason || "",
    });
  } catch (error) {
    console.error("Get Verification Status Error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при получении статуса верификации",
    });
  }
};
