import bcrypt from "bcryptjs";
import { supabase } from "../src/config/db.js";

async function main() {
  const args = process.argv.slice(2);
  const command = args[0]?.toLowerCase();

  const printUsage = () => {
    console.log(`
==================================================
        Управление администраторами UyTap
==================================================
Использование:
  npm run admin list
      Показать список текущих администраторов и пользователей

  npm run admin set <email>
      Сделать существующего пользователя администратором

  npm run admin create <email> <password> [телефон]
      Создать нового пользователя с правами администратора

  npm run admin password <email> <new_password>
      Сменить пароль администратору или пользователю

  npm run admin remove <email>
      Снять права администратора (установить role = 'user')
==================================================
Примеры:
  npm run admin list
  npm run admin set isaev.ali.kanybekovich@gmail.com
  npm run admin create admin@uytap.kg MySecurePass123! +996555123456
  npm run admin password admin@uytap.kg NewSecurePass123!
==================================================
`);
  };

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  try {
    if (command === "list") {
      const { data: admins, error: adminsError } = await supabase
        .from("users")
        .select("id, email, phone, role, is_email_verified, account_type, created_at")
        .eq("role", "admin");

      if (adminsError) throw adminsError;

      console.log("\n--- Список администраторов (role = 'admin') ---");
      if (!admins || admins.length === 0) {
        console.log("В базе данных пока НЕТ ни одного администратора.");
      } else {
        admins.forEach((u, i) => {
          console.log(
            `${i + 1}. Email: ${u.email} | Телефон: ${u.phone} | Подтверждён: ${u.is_email_verified} | ID: ${u.id}`
          );
        });
      }

      const { data: users, error: usersError } = await supabase
        .from("users")
        .select("id, email, phone, role, is_email_verified")
        .limit(10);

      if (usersError) throw usersError;

      console.log("\n--- Последние пользователи в системе (до 10 записей) ---");
      users.forEach((u, i) => {
        console.log(
          `${i + 1}. [${u.role || "user"}] ${u.email} (${u.phone || "без тел."}) | email_verified: ${u.is_email_verified}`
        );
      });
      console.log("");
      return;
    }

    if (command === "set" || command === "promote") {
      const email = args[1]?.trim().toLowerCase();
      if (!email) {
        console.error("❌ Ошибка: укажите email пользователя. Пример: npm run admin set user@example.com");
        return;
      }

      const { data: user, error: findError } = await supabase
        .from("users")
        .select("id, email, role")
        .eq("email", email)
        .maybeSingle();

      if (findError) throw findError;
      if (!user) {
        console.error(`❌ Пользователь с email "${email}" не найден.`);
        console.log("💡 Используйте команду 'create', чтобы создать нового: npm run admin create <email> <password>");
        return;
      }

      const { error: updateError } = await supabase
        .from("users")
        .update({
          role: "admin",
          is_email_verified: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);

      if (updateError) throw updateError;

      console.log(`\n✅ Успешно! Пользователю "${email}" назначена роль администратора (role = 'admin')`);
      console.log("Также подтверждён email (is_email_verified = true).");
      console.log("Теперь вы можете войти в панель администратора: /admin/login\n");
      return;
    }

    if (command === "create") {
      const email = args[1]?.trim().toLowerCase();
      const password = args[2];
      const phone = args[3]?.trim() || `+996000${Math.floor(100000 + Math.random() * 900000)}`;

      if (!email || !password) {
        console.error("❌ Ошибка: укажите email и пароль. Пример: npm run admin create admin@example.com MyPass123! [+996...]");
        return;
      }

      // Проверка на существующего пользователя
      const { data: existingUser } = await supabase
        .from("users")
        .select("id, email")
        .eq("email", email)
        .maybeSingle();

      if (existingUser) {
        console.error(`❌ Пользователь с email "${email}" уже существует!`);
        console.log(`💡 Чтобы назначить его администратором, используйте: npm run admin set ${email}`);
        return;
      }

      const passwordHash = await bcrypt.hash(password, 10);

      const { data: newUser, error: insertError } = await supabase
        .from("users")
        .insert([
          {
            email,
            phone,
            password_hash: passwordHash,
            role: "admin",
            account_type: "personal",
            is_verified: true,
            is_email_verified: true,
            token_version: 0,
          },
        ])
        .select()
        .single();

      if (insertError) throw insertError;

      // Создаём запись в user_profiles
      await supabase.from("user_profiles").insert([
        {
          user_id: newUser.id,
          first_name: "Администратор",
          last_name: "Системы",
        },
      ]);

      console.log(`\n✅ Администратор успешно создан!`);
      console.log(`Email (Логин): ${email}`);
      console.log(`Пароль:        ${password}`);
      console.log(`Телефон:       ${phone}`);
      console.log(`Роль:          admin`);
      console.log(`\nТеперь вы можете войти в панель администратора: /admin/login\n`);
      return;
    }

    if (command === "password") {
      const email = args[1]?.trim().toLowerCase();
      const newPassword = args[2];

      if (!email || !newPassword) {
        console.error("❌ Ошибка: укажите email и новый пароль. Пример: npm run admin password user@example.com NewPass123!");
        return;
      }

      const { data: user, error: findError } = await supabase
        .from("users")
        .select("id, email, token_version")
        .eq("email", email)
        .maybeSingle();

      if (findError) throw findError;
      if (!user) {
        console.error(`❌ Пользователь с email "${email}" не найден.`);
        return;
      }

      const passwordHash = await bcrypt.hash(newPassword, 10);
      const nextTokenVersion = (user.token_version || 0) + 1;

      const { error: updateError } = await supabase
        .from("users")
        .update({
          password_hash: passwordHash,
          token_version: nextTokenVersion,
          is_email_verified: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);

      if (updateError) throw updateError;

      console.log(`\n✅ Пароль для "${email}" успешно обновлён!`);
      console.log(`Старые токены и сессии были отозваны.\n`);
      return;
    }

    if (command === "remove") {
      const email = args[1]?.trim().toLowerCase();
      if (!email) {
        console.error("❌ Ошибка: укажите email. Пример: npm run admin remove user@example.com");
        return;
      }

      const { data: user, error: findError } = await supabase
        .from("users")
        .select("id, email")
        .eq("email", email)
        .maybeSingle();

      if (findError) throw findError;
      if (!user) {
        console.error(`❌ Пользователь с email "${email}" не найден.`);
        return;
      }

      const { error: updateError } = await supabase
        .from("users")
        .update({
          role: "user",
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);

      if (updateError) throw updateError;

      console.log(`\n✅ Роль администратора для "${email}" снята (установлено role = 'user').\n`);
      return;
    }

    console.error(`❌ Неизвестная команда "${command}".`);
    printUsage();
  } catch (err) {
    console.error("❌ Произошла ошибка:", err.message || err);
  }
}

main();
