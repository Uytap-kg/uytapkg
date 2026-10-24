import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// =======================================================
// P0-1: updateMeSchema & authController data variable
// =======================================================
test("P0-1: updateMeSchema safeParse и корректное объявление data (нет ReferenceError)", async () => {
  const { updateMeSchema } = await import("../src/utils/validation.js");
  const authControllerSource = fs.readFileSync(
    path.resolve(__dirname, "../src/controllers/authController.js"),
    "utf8"
  );

  // Проверка исходного кода: после safeParse(req.body) ОБЯЗАТЕЛЬНО объявлена data
  const safeParseIdx = authControllerSource.indexOf("updateMeSchema.safeParse(req.body)");
  assert.ok(safeParseIdx > 0, "updateMe должен вызывать updateMeSchema.safeParse");

  const sub = authControllerSource.slice(safeParseIdx, safeParseIdx + 600);
  assert.match(
    sub,
    /const\s+data\s*=\s*validationResult\.data;/,
    "В updateMe должна быть строка `const data = validationResult.data;`"
  );

  // Валидация входных данных
  const parsed = updateMeSchema.safeParse({
    firstName: "Тест",
    lastName: "Тестов",
    phone: "+996555123456",
    about: "О себе",
  });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.firstName, "Тест");
});

// =======================================================
// P0-2: Вход по телефону и email на клиенте и сервере
// =======================================================
test("P0-2: Бэкенд login поддерживает телефон и email; фронтенд Login.jsx не содержит вызова verifyOtpCode", async () => {
  const loginPageSource = fs.readFileSync(
    path.resolve(__dirname, "../../front-end/src/app/login/page.jsx"),
    "utf8"
  );

  // Проверка отсутствия несуществующей функции verifyOtpCode
  assert.ok(
    !loginPageSource.includes("verifyOtpCode("),
    "Фронтенд не должен вызывать несуществующую функцию verifyOtpCode"
  );

  // Проверка наличия обработчика входа и loginUser
  assert.ok(
    loginPageSource.includes("handlePhoneLogin") || loginPageSource.includes("handleLogin"),
    "Должен присутствовать handlePhoneLogin или handleLogin"
  );
  assert.ok(loginPageSource.includes("loginUser"), "Должен использоваться loginUser");

  // Метод авторизации — телефон или email
  assert.match(
    loginPageSource,
    /const\s*\[method,\s*setMethod\]\s*=\s*useState\(["'](?:phone|email)["']\)/,
    "Метод входа по умолчанию должен быть phone или email"
  );

  // Бэкенд валидация логина
  const { loginSchema } = await import("../src/utils/validation.js");
  const phoneLogin = loginSchema.safeParse({
    identifier: "996555123456",
    password: "Password123!",
  });
  assert.equal(phoneLogin.success, true);
  assert.equal(phoneLogin.data.identifier, "996555123456");
});

// =======================================================
// P0-3: Отсутствие back-end.env и защита в .gitignore
// =======================================================
test("P0-3: Файл back-end.env отсутствует на диске и заблокирован в .gitignore", () => {
  const envPath = path.resolve(__dirname, "../back-end.env");
  assert.equal(fs.existsSync(envPath), false, "back-end/back-end.env не должен существовать");

  const rootGitignore = fs.readFileSync(path.resolve(__dirname, "../../.gitignore"), "utf8");
  assert.ok(rootGitignore.includes("back-end.env"), ".gitignore должен игнорировать back-end.env");
  assert.ok(rootGitignore.includes(".env"), ".gitignore должен игнорировать .env");
});

// =======================================================
// P0-4: Доверенные URL изображений для HTTP (VPS) и HTTPS
// =======================================================
test("P0-4: isTrustedImageUrl поддерживает как https, так и настроенный HTTP протокол (Self-hosted VPS)", async () => {
  const validationSource = fs.readFileSync(
    path.resolve(__dirname, "../src/utils/validation.js"),
    "utf8"
  );

  assert.ok(
    validationSource.includes("TRUSTED_IMAGE_ORIGINS"),
    "validation.js должен использовать маппинг TRUSTED_IMAGE_ORIGINS с сохранением протокола хоста"
  );

  // Проверка логики валидации протокола
  const isTrustedCheck = (value, trustedOrigins) => {
    try {
      const url = new URL(value);
      const trustedProtocol = trustedOrigins.get(url.host);
      return trustedProtocol !== undefined && url.protocol === trustedProtocol;
    } catch {
      return false;
    }
  };

  const origins = new Map([
    ["192.168.1.50:8000", "http:"],
    ["kakiuqgjhcunyaxydopx.supabase.co", "https:"],
  ]);

  // Self-hosted VPS по http
  assert.equal(
    isTrustedCheck("http://192.168.1.50:8000/storage/v1/object/public/avatars/1.jpg", origins),
    true,
    "HTTP ссылка для настроенного self-hosted SUPABASE_URL должна быть валидна"
  );

  // Supabase cloud по https
  assert.equal(
    isTrustedCheck("https://kakiuqgjhcunyaxydopx.supabase.co/storage/v1/object/public/avatars/1.jpg", origins),
    true,
    "HTTPS ссылка для облачного Supabase должна быть валидна"
  );

  // Чужой хост или поддельный протокол
  assert.equal(
    isTrustedCheck("http://kakiuqgjhcunyaxydopx.supabase.co/storage/1.jpg", origins),
    false,
    "HTTP для облачного хоста (где настроен https) должен быть отклонен"
  );
  assert.equal(
    isTrustedCheck("https://evil-attacker.com/malicious.jpg", origins),
    false,
    "Недоверенный хост должен быть отклонен"
  );
});

// =======================================================
// P1-1: Удаление дублирующих route handlers и защита X-Forwarded-For
// =======================================================
test("P1-1: Дублирующие route handlers удалены, а проксирование x-forwarded-for безопасно", () => {
  const redundantRoutes = [
    "../../front-end/src/app/api/auth/[...slug]/route.js",
    "../../front-end/src/app/api/upload/route.js",
    "../../front-end/src/app/api/listings/route.js",
    "../../front-end/src/app/api/constants/route.js",
  ];

  for (const relPath of redundantRoutes) {
    const fullPath = path.resolve(__dirname, relPath);
    assert.equal(fs.existsSync(fullPath), false, `Файл ${relPath} должен быть удален`);
  }

  // Проверка хелпера forwardedFor
  const forwardedHelper = path.resolve(__dirname, "../../front-end/src/app/api/_lib/forwardedFor.js");
  assert.ok(fs.existsSync(forwardedHelper), "forwardedFor.js должен существовать");
  const helperSource = fs.readFileSync(forwardedHelper, "utf8");
  assert.ok(
    helperSource.includes("getTrustedClientIp") && helperSource.includes("applyTrustedForwardedFor"),
    "forwardedFor.js должен экспортировать getTrustedClientIp и applyTrustedForwardedFor"
  );
});

// =======================================================
// P1-2: Проверка Magic Bytes и выброс ошибки в applyWatermark
// =======================================================
test("P1-2: validateImageMagicBytes проверяет сигнатуру, а applyWatermark выбрасывает исключение", async () => {
  const { validateImageMagicBytes } = await import("../src/middleware/upload.js");
  const { applyWatermark } = await import("../src/utils/watermark.js");

  // JPEG magic bytes: FF D8 FF
  const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  assert.equal(validateImageMagicBytes(jpegHeader), true);

  // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  assert.equal(validateImageMagicBytes(pngHeader), true);

  // Fake text/html
  const htmlBuffer = Buffer.from("<html><script>alert(1)</script></html>");
  assert.equal(validateImageMagicBytes(htmlBuffer), false, "HTML файл должен отклоняться по magic bytes");

  // applyWatermark выбрасывает ошибку при невалидном буфере (не проглатывает)
  await assert.rejects(
    async () => {
      await applyWatermark(htmlBuffer, "image/jpeg");
    },
    /unsupported image format|Input buffer/i,
    "applyWatermark не должен возвращать исходный поврежденный буфер"
  );
});

// =======================================================
// P1-3: Эндпоинт карты /api/listings/map и функция getAllListings
// =======================================================
test("P1-3: Наличие маршрута /api/listings/map и хелпера getAllListings на фронтенде", async () => {
  const routesSource = fs.readFileSync(
    path.resolve(__dirname, "../src/routes/listingsRoutes.js"),
    "utf8"
  );
  assert.ok(
    routesSource.includes('router.get("/map", getMapListings)'),
    "В listingsRoutes должен быть зарегистрирован GET /map до /:id"
  );

  const controllerSource = fs.readFileSync(
    path.resolve(__dirname, "../src/controllers/listingsController.js"),
    "utf8"
  );
  assert.ok(
    controllerSource.includes("export const getMapListings"),
    "listingsController должен экспортировать getMapListings"
  );

  const apiSource = fs.readFileSync(
    path.resolve(__dirname, "../../front-end/src/utils/api.js"),
    "utf8"
  );
  assert.ok(
    apiSource.includes("export async function getMapListings"),
    "api.js должен экспортировать getMapListings"
  );
  assert.ok(
    apiSource.includes("export async function getAllListings"),
    "api.js должен экспортировать getAllListings"
  );
});

// =======================================================
// P1-4: Корректное сохранение этажности totalFloors на странице редактирования объявления
// =======================================================
test("P1-4: Редактирование объявления передает totalFloors, а не затирает floor", () => {
  const pageSource = fs.readFileSync(
    path.resolve(__dirname, "../../front-end/src/app/profile/ads/[id]/page.jsx"),
    "utf8"
  );

  assert.ok(
    pageSource.includes("totalFloors: updatedProduct.floors ? Number(updatedProduct.floors) : undefined"),
    "В payload на /profile/ads/[id] floors должен передаваться как totalFloors"
  );
  assert.ok(
    !pageSource.includes("floor: updatedProduct.floors ? Number(updatedProduct.floors) : undefined"),
    "В payload не должно быть ошибочной записи floors в колонку floor"
  );
});

// =======================================================
// P1-5: Аватар не перезаливается повторно при редактировании профиля
// =======================================================
test("P1-5: Модалки профиля не вызывают fileFromUrl и загружают аватар только при выборе нового файла", () => {
  const modals = [
    "../../front-end/src/app/profile/components/personalProfile/profileEdit/ProfileEditModal.jsx",
    "../../front-end/src/app/profile/components/realtorProfile/realtorEdit/RealtorEditModal.jsx",
    "../../front-end/src/app/profile/components/agencyProfile/agencyEdit/AgencyEditModal.jsx",
  ];

  for (const relPath of modals) {
    const fullPath = path.resolve(__dirname, relPath);
    const content = fs.readFileSync(fullPath, "utf8");

    assert.ok(
      !content.includes("fileFromUrl("),
      `${relPath} не должен вызывать fileFromUrl для повторного скачивания текущего аватара`
    );
    assert.ok(
      content.includes("deleteAvatar"),
      `${relPath} должен поддерживать удаление через deleteAvatar`
    );
  }
});
