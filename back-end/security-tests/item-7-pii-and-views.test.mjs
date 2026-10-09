import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  sanitizeAuthorPII,
  shouldIncrementView,
  viewsThrottleMap,
  VIEW_THROTTLE_MS,
  getClientIp,
} from "../src/controllers/listingsController.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// =======================================================
// 1. Тестирование разграничения доступа (Access Control / IDOR Protection)
// =======================================================
test("Access Control: анонимные пользователи и чужие аккаунты не имеют доступа к draft, moderation, hidden и expired", () => {
  // Эмуляция логики проверки доступа из getListingById
  const checkListingAccess = (listing, user) => {
    const userId = user?.id;
    const userRole = user?.role;
    const isOwner = Boolean(userId && listing.user_id === userId);
    const isAdmin = userRole === "admin";

    if (!isOwner && !isAdmin) {
      const isExpired = listing.expires_at && new Date(listing.expires_at).getTime() <= Date.now();
      if (listing.status !== "active" || isExpired) {
        return { status: 404, allowed: false };
      }
    }
    return { status: 200, allowed: true };
  };

  const pastDate = new Date(Date.now() - 3600000).toISOString();
  const futureDate = new Date(Date.now() + 3600000).toISOString();

  const authorId = "author-uuid-1111";
  const stranger = { id: "stranger-uuid-2222", role: "user" };
  const owner = { id: authorId, role: "user" };
  const admin = { id: "admin-uuid-9999", role: "admin" };
  const anonymous = null;

  // 1.1 Анонимный пользователь
  assert.equal(checkListingAccess({ user_id: authorId, status: "draft", expires_at: futureDate }, anonymous).status, 404);
  assert.equal(checkListingAccess({ user_id: authorId, status: "moderation", expires_at: futureDate }, anonymous).status, 404);
  assert.equal(checkListingAccess({ user_id: authorId, status: "hidden", expires_at: futureDate }, anonymous).status, 404);
  assert.equal(checkListingAccess({ user_id: authorId, status: "active", expires_at: pastDate }, anonymous).status, 404);
  assert.equal(checkListingAccess({ user_id: authorId, status: "active", expires_at: futureDate }, anonymous).status, 200);
  assert.equal(checkListingAccess({ user_id: authorId, status: "active", expires_at: null }, anonymous).status, 200);

  // 1.2 Чужой пользователь (не владелец)
  assert.equal(checkListingAccess({ user_id: authorId, status: "draft", expires_at: futureDate }, stranger).status, 404);
  assert.equal(checkListingAccess({ user_id: authorId, status: "moderation", expires_at: futureDate }, stranger).status, 404);
  assert.equal(checkListingAccess({ user_id: authorId, status: "hidden", expires_at: futureDate }, stranger).status, 404);
  assert.equal(checkListingAccess({ user_id: authorId, status: "active", expires_at: pastDate }, stranger).status, 404);
  assert.equal(checkListingAccess({ user_id: authorId, status: "active", expires_at: futureDate }, stranger).status, 200);

  // 1.3 Владелец видит свои объявления в ЛЮБОМ статусе
  assert.equal(checkListingAccess({ user_id: authorId, status: "draft", expires_at: futureDate }, owner).status, 200);
  assert.equal(checkListingAccess({ user_id: authorId, status: "moderation", expires_at: futureDate }, owner).status, 200);
  assert.equal(checkListingAccess({ user_id: authorId, status: "hidden", expires_at: futureDate }, owner).status, 200);
  assert.equal(checkListingAccess({ user_id: authorId, status: "active", expires_at: pastDate }, owner).status, 200);

  // 1.4 Администратор видит чужие объявления в ЛЮБОМ статусе
  assert.equal(checkListingAccess({ user_id: authorId, status: "draft", expires_at: futureDate }, admin).status, 200);
  assert.equal(checkListingAccess({ user_id: authorId, status: "moderation", expires_at: futureDate }, admin).status, 200);
  assert.equal(checkListingAccess({ user_id: authorId, status: "hidden", expires_at: futureDate }, admin).status, 200);
  assert.equal(checkListingAccess({ user_id: authorId, status: "active", expires_at: pastDate }, admin).status, 200);
});

// =======================================================
// 2. Тестирование фильтрации PII (PII Sanitization)
// =======================================================
test("PII Filtering: полное удаление email и условное сокрытие phone", () => {
  // 2.1 Частный продавец (personal) без флага показа телефона: email удаляется, phone -> null
  const personalAuthor = {
    id: "user-personal",
    account_type: "personal",
    email: "seller@personal.com",
    phone: "+996555111222",
    is_verified: true,
  };
  const sanitizedPersonal = sanitizeAuthorPII(personalAuthor);
  assert.equal(sanitizedPersonal.email, undefined, "Email должен быть полностью удален из объекта");
  assert.equal("email" in sanitizedPersonal, false, "Ключ email не должен существовать");
  assert.equal(sanitizedPersonal.phone, null, "Телефон частного продавца должен быть скрыт (null)");

  // 2.2 Частный продавец (personal) с флагом show_phone: true
  const personalWithShowPhone = {
    id: "user-personal-optin",
    account_type: "personal",
    email: "seller2@personal.com",
    phone: "+996555333444",
    show_phone: true,
  };
  const sanitizedOptin = sanitizeAuthorPII(personalWithShowPhone);
  assert.equal(sanitizedOptin.email, undefined, "Email должен быть полностью удален");
  assert.equal(sanitizedOptin.phone, "+996555333444", "Телефон должен показываться при show_phone = true");

  // 2.3 Частный продавец с флагом в user_profiles
  const personalWithProfileOptin = {
    id: "user-personal-profile-optin",
    account_type: "personal",
    email: "seller3@personal.com",
    phone: "+996555555666",
    user_profiles: { show_phone: true, first_name: "Иван" },
  };
  const sanitizedProfileOptin = sanitizeAuthorPII(personalWithProfileOptin);
  assert.equal(sanitizedProfileOptin.email, undefined);
  assert.equal(sanitizedProfileOptin.phone, "+996555555666");

  // 2.4 Бизнес-аккаунты: email удаляется, phone всегда отдается
  const businessRoles = ["agency", "developer", "realtor"];
  for (const role of businessRoles) {
    const businessAuthor = {
      id: `user-${role}`,
      account_type: role,
      email: `${role}@company.com`,
      phone: `+996777${role.length}0000`,
    };
    const sanitizedBiz = sanitizeAuthorPII(businessAuthor);
    assert.equal(sanitizedBiz.email, undefined, `Email для ${role} должен быть удален`);
    assert.equal(sanitizedBiz.phone, businessAuthor.phone, `Телефон для ${role} должен сохраняться`);
  }
});

// =======================================================
// 3. Тестирование защиты от накрутки просмотров (Views Anti-Spam & Throttle)
// =======================================================
test("Views Protection: защита от спама просмотров (1 инкремент с одного IP за 10 минут)", () => {
  viewsThrottleMap.clear();

  const ipA = "192.168.1.100";
  const ipB = "192.168.1.101";
  const listingId1 = "listing-aaa";
  const listingId2 = "listing-bbb";

  // Первый просмотр с ipA для listingId1 -> разрешен
  assert.equal(shouldIncrementView(ipA, listingId1), true, "Первый просмотр с IP должен быть учтен");

  // Повторный просмотр сразу же с того же IP для того же объявления -> заблокирован (тротлинг)
  assert.equal(shouldIncrementView(ipA, listingId1), false, "Повторный просмотр в пределах 10 минут должен быть заблокирован");

  // Другое объявление с того же IP -> разрешено
  assert.equal(shouldIncrementView(ipA, listingId2), true, "Просмотр другого объявления с того же IP должен быть учтен");

  // Другой IP для первого объявления -> разрешено
  assert.equal(shouldIncrementView(ipB, listingId1), true, "Просмотр с другого IP должен быть учтен");

  // Эмуляция истечения 10 минут (600_000 мс)
  const key = `${ipA}:${listingId1}`;
  viewsThrottleMap.set(key, Date.now() - (VIEW_THROTTLE_MS + 1000));
  assert.equal(shouldIncrementView(ipA, listingId1), true, "Просмотр после истечения 10 минут должен быть учтен");
});

test("Views Protection: просмотры владельца не должны учитываться", () => {
  const listing = {
    id: "listing-test-view",
    user_id: "author-owner-id",
    status: "active",
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    views_count: 10,
  };

  const simulateViewIncrement = (listingItem, currentUser, ip) => {
    const isOwner = Boolean(currentUser?.id && listingItem.user_id === currentUser.id);
    const isListingActive =
      listingItem.status === "active" &&
      (!listingItem.expires_at || new Date(listingItem.expires_at).getTime() > Date.now());

    if (!isOwner && isListingActive) {
      if (shouldIncrementView(ip, listingItem.id)) {
        return listingItem.views_count + 1;
      }
    }
    return listingItem.views_count;
  };

  viewsThrottleMap.clear();

  // 1. Просмотр владельца: счётчик НЕ изменяется
  const ownerUser = { id: "author-owner-id", role: "user" };
  const viewsAfterOwner = simulateViewIncrement(listing, ownerUser, "10.0.0.1");
  assert.equal(viewsAfterOwner, 10, "Просмотр владельца не должен увеличивать views_count");

  // 2. Просмотр стороннего пользователя: счётчик увеличивается
  const strangerUser = { id: "stranger-user-id", role: "user" };
  const viewsAfterStranger = simulateViewIncrement(listing, strangerUser, "10.0.0.2");
  assert.equal(viewsAfterStranger, 11, "Просмотр посетителя должен увеличивать views_count");

  // 3. Повторный просмотр тем же сторонним пользователем с того же IP: счётчик НЕ увеличивается (защита от накрутки)
  const viewsAfterSpam = simulateViewIncrement(listing, strangerUser, "10.0.0.2");
  assert.equal(viewsAfterSpam, 10, "Спам-просмотр с того же IP не должен увеличивать views_count");
});

// =======================================================
// 4. Тестирование извлечения IP клиента (Proxy & Headers Handling)
// =======================================================
test("IP Extraction: getClientIp корректно извлекает IP из x-forwarded-for, x-real-ip и req.ip", () => {
  // Через x-forwarded-for с цепочкой прокси
  const reqWithForwarded = {
    headers: { "x-forwarded-for": "203.0.113.195, 70.41.3.18, 150.172.238.178" },
  };
  assert.equal(getClientIp(reqWithForwarded), "203.0.113.195");

  // Через x-real-ip
  const reqWithRealIp = {
    headers: { "x-real-ip": "198.51.100.42" },
  };
  assert.equal(getClientIp(reqWithRealIp), "198.51.100.42");

  // Напрямую через req.ip
  const reqWithDirectIp = {
    headers: {},
    ip: "192.0.2.1",
  };
  assert.equal(getClientIp(reqWithDirectIp), "192.0.2.1");

  // Fallback при отсутствии данных
  assert.equal(getClientIp(null), "unknown");
});

// =======================================================
// 5. Тестирование файлов схемы и миграции
// =======================================================
test("Migration & Schema: наличие миграции 007_pii_and_views.sql и функции increment_views в schema.sql", () => {
  const migrationPath = path.resolve(__dirname, "../src/migrations/007_pii_and_views.sql");
  assert.ok(fs.existsSync(migrationPath), "Файл миграции 007_pii_and_views.sql должен существовать");

  const migrationContent = fs.readFileSync(migrationPath, "utf8");
  assert.ok(
    migrationContent.includes("CREATE OR REPLACE FUNCTION increment_views"),
    "Миграция должна содержать функцию increment_views"
  );
  assert.ok(
    migrationContent.includes("show_phone"),
    "Миграция должна добавлять колонку show_phone"
  );

  const schemaPath = path.resolve(__dirname, "../src/schema.sql");
  assert.ok(fs.existsSync(schemaPath), "Файл schema.sql должен существовать");

  const schemaContent = fs.readFileSync(schemaPath, "utf8");
  assert.ok(
    schemaContent.includes("increment_views"),
    "schema.sql должен содержать функцию increment_views"
  );
  assert.ok(
    schemaContent.includes("show_phone"),
    "schema.sql должен содержать колонку show_phone в таблице users"
  );
});
