import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import { supabase } from "../src/config/db.js";
import { generateToken } from "../src/middleware/auth.js";
import { normalizePhone } from "../src/utils/validation.js";

// Допустимые типы аккаунтов и роли
const VALID_ACCOUNT_TYPES = ["personal", "realtor", "agency", "developer"];
const VALID_ROLES = ["user", "admin"];

function printHelp() {
  console.log(`
========================================================================
         UyTap — Безопасное создание / регистрация пользователей
========================================================================

Назначение:
  Вставка пользователя любого типа (personal, realtor, agency, developer, admin)
  напрямую в базу данных с мгновенным подтверждением email и верификацией.
  Пользователь может сразу войти по логину и паролю без прохождения OTP.

Использование:

  1. Интерактивный режим (пошаговый опрос в терминале):
     npm run user:create

  2. Быстрый запуск одной командой через флаги:
     npm run user:create -- --type=<тип> --email=<email> --password=<пароль> [опции]

Опции и флаги:
  --type, -t         Тип аккаунта: personal | realtor | agency | developer (по умолчанию: personal)
  --role, -r         Роль: user | admin (по умолчанию: user)
  --admin            Короткий флаг для назначения роли admin
  --email, -e        Email пользователя (обязателен при запуске без интерактивного режима)
  --password, -p     Пароль пользователя (обязателен при запуске без интерактивного режима)
  --phone            Телефон в формате Кыргызстана (+996...) или автогенерация по умолчанию
  --name             Имя или ФИО пользователя / директора
  --first-name       Имя
  --last-name        Фамилия
  --company          Название компании (для риелтора, агентства или застройщика)
  --inn              ИНН компании (для агентства или застройщика)
  --address          Фактический адрес офиса
  --about            Описание / О себе
  --website          Веб-сайт компании
  --force, -f        Если пользователь с таким email уже есть: обновить пароль и подтвердить
  --help, -h         Показать эту справку

Примеры:
  # Создать частного пользователя:
  npm run user:create -- --type=personal --email=user@test.kg --password=pass123 --name="Алексей Иванов"

  # Создать проверенного риелтора:
  npm run user:create -- --type=realtor --email=realtor@test.kg --password=pass123 --name="Азамат Беков" --company="Агентство Ключ"

  # Создать агентство недвижимости:
  npm run user:create -- --type=agency --email=agency@test.kg --password=pass123 --company="Bishkek Real Estate" --inn="12345678901234"

  # Создать застройщика (с карточкой в таблице developers):
  npm run user:create -- --type=developer --email=elite@test.kg --password=pass123 --company="Elite House" --address="Бишкек, ул. Абдрахманова 170"

  # Создать системного администратора:
  npm run user:create -- --admin --email=admin@test.kg --password=superpass --name="Супер Администратор"

  # Обновить пароль и верифицировать уже существующего пользователя:
  npm run user:create -- --email=user@test.kg --password=newpass --force
========================================================================
`);
}

function parseCliArgs(rawArgs) {
  const options = {};
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--admin") {
      options.role = "admin";
    } else if (arg === "--force" || arg === "-f") {
      options.force = true;
    } else if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        const val = arg.slice(eqIdx + 1);
        options[key] = val;
      } else {
        const key = arg.slice(2);
        const next = rawArgs[i + 1];
        if (next && !next.startsWith("-")) {
          options[key] = next;
          i++;
        } else {
          options[key] = true;
        }
      }
    } else if (arg.startsWith("-")) {
      const short = arg.slice(1);
      if (short === "t" && rawArgs[i + 1]) options.type = rawArgs[++i];
      else if (short === "e" && rawArgs[i + 1]) options.email = rawArgs[++i];
      else if (short === "p" && rawArgs[i + 1]) options.password = rawArgs[++i];
      else if (short === "r" && rawArgs[i + 1]) options.role = rawArgs[++i];
    }
  }
  return options;
}

function generateRandomPhone() {
  const prefixes = ["555", "700", "770", "500", "990"];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const num = Math.floor(100000 + Math.random() * 900000);
  return `+996${prefix}${num}`;
}

async function runInteractive() {
  const rl = readline.createInterface({ input, output });

  try {
    console.log("\n=======================================================");
    console.log("        UyTap — Мастер создания пользователей");
    console.log("=======================================================\n");

    console.log("Выберите тип аккаунта:");
    console.log("  [1] Частное лицо (personal) — собственник / покупатель");
    console.log("  [2] Риелтор (realtor)");
    console.log("  [3] Агентство недвижимости (agency)");
    console.log("  [4] Застройщик (developer) — ЖК, квартиры, аналитика");
    console.log("  [5] Администратор (admin) — полный доступ к админ-панели\n");

    const typeChoice = (await rl.question("Ваш выбор [1-5] (по умолчанию 1): ")).trim();
    let accountType = "personal";
    let role = "user";

    switch (typeChoice) {
      case "2":
        accountType = "realtor";
        break;
      case "3":
        accountType = "agency";
        break;
      case "4":
        accountType = "developer";
        break;
      case "5":
        accountType = "personal";
        role = "admin";
        break;
      default:
        accountType = "personal";
        break;
    }

    let email = "";
    while (!email || !email.includes("@")) {
      email = (await rl.question("Email (логин для входа): ")).trim();
      if (!email.includes("@")) {
        console.log("⚠️ Введите корректный адрес email (например: user@uytap.kg)");
      }
    }

    let password = "";
    while (!password || password.length < 6) {
      password = (await rl.question("Пароль (минимум 6 символов): ")).trim();
      if (password.length < 6) {
        console.log("⚠️ Пароль должен быть длиной не менее 6 символов");
      }
    }

    const phoneInput = (
      await rl.question("Телефон (+996... или нажмите Enter для автогенерации): ")
    ).trim();

    const data = {
      accountType,
      role,
      email,
      password,
      phone: phoneInput || null,
    };

    if (accountType === "personal") {
      data.firstName = (await rl.question("Имя (по умолчанию Алексей): ")).trim() || "Алексей";
      data.lastName = (await rl.question("Фамилия (по умолчанию Иванов): ")).trim() || "Иванов";
    } else if (accountType === "realtor") {
      data.firstName = (await rl.question("ФИО риелтора (по умолчанию Азамат Беков): ")).trim() || "Азамат Беков";
      data.companyName = (await rl.question("Агентство или частная практика (Enter, если частный): ")).trim() || "Частный риелтор";
    } else if (accountType === "agency") {
      data.companyName = (await rl.question("Название агентства (по умолчанию Агентство Недвижимости): ")).trim() || "Агентство Недвижимости";
      data.firstName = (await rl.question("ФИО директора / представителя: ")).trim() || "Руководитель Агентства";
      data.inn = (await rl.question("ИНН компании (Enter для автогенерации): ")).trim() || "12345678901234";
      data.officeAddress = (await rl.question("Адрес офиса: ")).trim() || "г. Бишкек";
    } else if (accountType === "developer") {
      data.companyName = (await rl.question("Название компании-застройщика: ")).trim() || "Строительная Компания";
      data.inn = (await rl.question("ИНН застройщика (Enter для автогенерации): ")).trim() || "12345678901234";
      data.officeAddress = (await rl.question("Адрес офиса продаж: ")).trim() || "г. Бишкек";
      data.website = (await rl.question("Веб-сайт (Enter, если нет): ")).trim() || null;
    }

    return data;
  } finally {
    rl.close();
  }
}

async function createUser(userData, options = {}) {
  const accountType = userData.accountType || "personal";
  const role = userData.role || "user";
  const email = userData.email.toLowerCase().trim();
  const password = userData.password;
  const isForce = Boolean(options.force);

  if (!VALID_ACCOUNT_TYPES.includes(accountType)) {
    throw new Error(`Недопустимый account_type "${accountType}". Допустимы: ${VALID_ACCOUNT_TYPES.join(", ")}`);
  }
  if (!VALID_ROLES.includes(role)) {
    throw new Error(`Недопустимая role "${role}". Допустимы: ${VALID_ROLES.join(", ")}`);
  }

  // 1. Проверяем, существует ли пользователь с таким email
  const { data: existingUser, error: checkError } = await supabase
    .from("users")
    .select("id, email, phone, role, account_type, token_version")
    .eq("email", email)
    .maybeSingle();

  if (checkError) {
    throw new Error(`Ошибка базы данных при проверке email: ${checkError.message}`);
  }

  const saltRounds = 10;
  const passwordHash = await bcrypt.hash(password, saltRounds);

  // Сценарий обновления (если пользователь уже существует и передан --force)
  if (existingUser) {
    if (!isForce) {
      console.log(`\n⚠️  Пользователь с email "${email}" уже существует в базе! (ID: ${existingUser.id})`);
      console.log("   Текущий тип:", existingUser.account_type, "| Роль:", existingUser.role);
      console.log("\n💡 Чтобы обновить ему пароль, роль и подтвердить email без создания дубликата,");
      console.log("   запустите команду с флагом --force (-f):");
      console.log(`   npm run user:create -- --email=${email} --password="${password}" --force\n`);
      return null;
    }

    console.log(`\n🔄 Обновляем существующего пользователя "${email}" (ID: ${existingUser.id})...`);

    const nextTokenVersion = (existingUser.token_version || 0) + 1;
    const { error: updateError } = await supabase
      .from("users")
      .update({
        password_hash: passwordHash,
        account_type: accountType,
        role: role,
        is_email_verified: true,
        is_verified: true,
        token_version: nextTokenVersion,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingUser.id);

    if (updateError) {
      throw new Error(`Ошибка обновления пользователя в users: ${updateError.message}`);
    }

    // Обновляем профиль
    const profilePayload = {
      user_id: existingUser.id,
      first_name: userData.firstName || null,
      last_name: userData.lastName || null,
      company_name: userData.companyName || null,
      inn: userData.inn || null,
      office_address: userData.officeAddress || null,
      about: userData.about || null,
      updated_at: new Date().toISOString(),
    };

    const { error: profileError } = await supabase
      .from("user_profiles")
      .upsert(profilePayload, { onConflict: "user_id" });

    if (profileError) {
      console.warn("⚠️ Предупреждение при обновлении профиля:", profileError.message);
    }

    // Если застройщик — синхронизируем developers
    if (accountType === "developer") {
      const devPayload = {
        user_id: existingUser.id,
        company_name: userData.companyName || "Застройщик",
        description: userData.about || null,
        phone: existingUser.phone,
        email: email,
        website: userData.website || null,
        is_verified: true,
      };
      await supabase.from("developers").upsert(devPayload, { onConflict: "user_id" });
    }

    const token = generateToken({
      id: existingUser.id,
      accountType: accountType,
      email: email,
      role: role,
      tokenVersion: nextTokenVersion,
    });

    return {
      id: existingUser.id,
      email,
      phone: existingUser.phone,
      accountType,
      role,
      token,
      isUpdated: true,
    };
  }

  // Сценарий создания нового пользователя
  let phone = userData.phone ? normalizePhone(userData.phone) : null;
  if (!phone) {
    phone = generateRandomPhone();
  }

  // Проверка уникальности телефона
  const { data: existingPhone } = await supabase
    .from("users")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();

  if (existingPhone) {
    phone = generateRandomPhone();
  }

  console.log(`\n⏳ Создаём пользователя ${email} в базе данных...`);

  // 1. Вставка в users
  const { data: newUser, error: insertUserError } = await supabase
    .from("users")
    .insert([
      {
        account_type: accountType,
        role: role,
        email: email,
        phone: phone,
        password_hash: passwordHash,
        is_verified: true,
        is_email_verified: true,
        show_phone: true,
        token_version: 0,
      },
    ])
    .select()
    .single();

  if (insertUserError || !newUser) {
    throw new Error(`Ошибка сохранения в таблицу users: ${insertUserError?.message || "неизвестная ошибка"}`);
  }

  // 2. Вставка в user_profiles
  const profilePayload = {
    user_id: newUser.id,
    first_name: userData.firstName || (accountType === "personal" ? "Пользователь" : null),
    last_name: userData.lastName || null,
    company_name: userData.companyName || null,
    inn: userData.inn || null,
    office_address: userData.officeAddress || null,
    about: userData.about || null,
  };

  const { error: insertProfileError } = await supabase
    .from("user_profiles")
    .insert([profilePayload]);

  if (insertProfileError) {
    console.warn("⚠️ Предупреждение при записи user_profiles:", insertProfileError.message);
  }

  // 3. Если застройщик — создаём запись в таблице developers
  if (accountType === "developer") {
    const devPayload = {
      user_id: newUser.id,
      company_name: userData.companyName || "Застройщик",
      description: userData.about || null,
      phone: phone,
      email: email,
      website: userData.website || null,
      is_verified: true,
    };

    const { error: insertDevError } = await supabase
      .from("developers")
      .insert([devPayload]);

    if (insertDevError) {
      console.warn("⚠️ Предупреждение при записи developers:", insertDevError.message);
    }
  }

  // 4. Генерация валидного JWT-токена
  const token = generateToken({
    id: newUser.id,
    accountType: newUser.account_type,
    email: newUser.email,
    role: newUser.role,
    tokenVersion: 0,
  });

  return {
    id: newUser.id,
    email: newUser.email,
    phone: newUser.phone,
    accountType: newUser.account_type,
    role: newUser.role,
    token,
    isUpdated: false,
  };
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const cliOptions = parseCliArgs(rawArgs);

  if (cliOptions.help) {
    printHelp();
    return;
  }

  try {
    let userData = null;

    // Если email и password переданы флагами — используем их
    if (cliOptions.email && cliOptions.password) {
      let accountType = cliOptions.type || cliOptions.accountType || "personal";
      let role = cliOptions.role || "user";

      // Если указан тип admin, маппим на personal + role=admin
      if (accountType === "admin") {
        accountType = "personal";
        role = "admin";
      }

      userData = {
        accountType,
        role,
        email: cliOptions.email,
        password: cliOptions.password,
        phone: cliOptions.phone || null,
        firstName: cliOptions.firstName || cliOptions["first-name"] || cliOptions.name || null,
        lastName: cliOptions.lastName || cliOptions["last-name"] || null,
        companyName: cliOptions.companyName || cliOptions["company-name"] || cliOptions.company || null,
        inn: cliOptions.inn || null,
        officeAddress: cliOptions.officeAddress || cliOptions["office-address"] || cliOptions.address || null,
        about: cliOptions.about || cliOptions.desc || cliOptions.description || null,
        website: cliOptions.website || null,
      };
    } else {
      // Иначе интерактивный опрос
      userData = await runInteractive();
    }

    if (!userData) {
      return;
    }

    const result = await createUser(userData, cliOptions);
    if (!result) {
      return;
    }

    console.log("\n=======================================================");
    if (result.isUpdated) {
      console.log("   ✅ ПОЛЬЗОВАТЕЛЬ УСПЕШНО ОБНОВЛЁН И АКТИВИРОВАН!");
    } else {
      console.log("   🎉 ПОЛЬЗОВАТЕЛЬ УСПЕШНО СОЗДАН И АКТИВИРОВАН!");
    }
    console.log("=======================================================");
    console.log(`🆔 ID в базе:       ${result.id}`);
    console.log(`📧 Email (Логин):   ${result.email}`);
    console.log(`🔑 Пароль:          ${userData.password}`);
    console.log(`📱 Телефон:         ${result.phone}`);
    console.log(`🏷️  Тип аккаунта:    ${result.accountType}`);
    console.log(`👑 Роль:            ${result.role}`);
    console.log(`✅ Email подтверждён: ДА (is_email_verified = true, без OTP)`);
    console.log(`⭐ Верифицирован:   ДА (is_verified = true)`);
    console.log("-------------------------------------------------------");
    console.log("🌐 Вход через браузер:");
    console.log("   Откройте страницу /login, введите email и пароль — вход моментальный!");
    if (result.role === "admin") {
      console.log("   Панель администратора доступна по адресу: /admin/login");
    }
    console.log("-------------------------------------------------------");
    console.log("🎫 Готовый JWT Access Token для API / Postman:");
    console.log(result.token);
    console.log("=======================================================\n");
  } catch (err) {
    console.error("\n❌ Ошибка при создании пользователя:", err.message || err);
    process.exit(1);
  }
}

export { createUser, parseCliArgs, generateRandomPhone, VALID_ACCOUNT_TYPES, VALID_ROLES };

const isDirectRun =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isDirectRun) {
  main();
}

