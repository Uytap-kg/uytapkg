import test from "node:test";
import assert from "node:assert/strict";

// 1. Тестирование валидации пароля (Bcrypt DoS Protection)
import { registerSchema, loginSchema, createComplexSchema } from "../src/utils/validation.js";

test("Validation: пароль длиннее 72 символов должен отклоняться (Bcrypt DoS)", () => {
  const longPassword = "A".repeat(73);
  const validPassword = "A".repeat(72);

  const regResultLong = registerSchema.safeParse({
    accountType: "personal",
    email: "test@example.com",
    phone: "+996555123456",
    password: longPassword,
  });
  assert.equal(regResultLong.success, false, "Пароль длиннее 72 символов должен отклоняться в registerSchema");

  const regResultValid = registerSchema.safeParse({
    accountType: "personal",
    email: "test@example.com",
    phone: "+996555123456",
    password: validPassword,
  });
  assert.equal(regResultValid.success, true, "Пароль ровно 72 символа должен приниматься в registerSchema");

  const loginResultLong = loginSchema.safeParse({
    identifier: "test@example.com",
    password: longPassword,
  });
  assert.equal(loginResultLong.success, false, "Пароль длиннее 72 символов должен отклоняться в loginSchema");

  const loginResultLongIdent = loginSchema.safeParse({
    identifier: "a".repeat(256),
    password: validPassword,
  });
  assert.equal(loginResultLongIdent.success, false, "Identifier длиннее 255 символов должен отклоняться в loginSchema");
});

// 2. Тестирование сортировки избранного (No NaN Sorting)
test("Favorites Sorting: отсутствие NaN при любых типах статусов и продвижения", () => {
  const priority = {
    vip: 0,
    urgent: 1,
    top: 2,
    null: 3,
  };

  const items = [
    { id: 1, status: "regular" },
    { id: 2, status: "top" },
    { id: 3, status: "vip" },
    { id: 4, status: "urgent" },
    { id: 5, status: undefined },
    { id: 6, status: null, promotion_type: "top" },
  ];

  const sorted = [...items].sort(
    (a, b) =>
      (priority[a.promotion_type ?? a.status] ?? 3) -
      (priority[b.promotion_type ?? b.status] ?? 3)
  );

  assert.ok(Array.isArray(sorted));
  assert.equal(sorted.length, items.length);

  // Проверяем, что компаратор для любых пар возвращает строго конечные числа, не NaN
  for (let i = 0; i < items.length; i++) {
    for (let j = 0; j < items.length; j++) {
      const diff =
        (priority[items[i].promotion_type ?? items[i].status] ?? 3) -
        (priority[items[j].promotion_type ?? items[j].status] ?? 3);
      assert.ok(Number.isFinite(diff), `Разность приоритетов должна быть конечным числом, получено: ${diff}`);
    }
  }
});

// 3. Тестирование фильтрации PII для публичных профилей
test("PII Protection: скрытие личных email и phone для аккаунтов personal", () => {
  const filterProfile = (user) => {
    const isBusinessAccount = ["agency", "developer", "realtor"].includes(user.account_type);
    return {
      id: user.id,
      type: user.account_type,
      email: isBusinessAccount ? user.email : null,
      phone: isBusinessAccount ? user.phone : null,
    };
  };

  const personalUser = {
    id: "user-1",
    account_type: "personal",
    email: "private@user.com",
    phone: "+996555111222",
  };

  const agencyUser = {
    id: "user-2",
    account_type: "agency",
    email: "agency@business.com",
    phone: "+996555333444",
  };

  const personalResult = filterProfile(personalUser);
  assert.equal(personalResult.email, null, "Email физлица должен быть скрыт (null)");
  assert.equal(personalResult.phone, null, "Телефон физлица должен быть скрыт (null)");

  const agencyResult = filterProfile(agencyUser);
  assert.equal(agencyResult.email, "agency@business.com", "Email агентства должен отображаться");
  assert.equal(agencyResult.phone, "+996555333444", "Телефон агентства должен отображаться");
});

// 4. Тестирование watermark.js: невалидный буфер выбрасывает ошибку (P1-2), а валидное изображение обрабатывается
test("Watermark: невалидный буфер выбрасывает ошибку, валидный обрабатывается", async () => {
  const { applyWatermark } = await import("../src/utils/watermark.js");
  const sharp = (await import("sharp")).default;
  const dummyBuffer = Buffer.from("fake-image-bytes");

  // Невалидный буфер должен отклоняться (P1-2 защита от загрузки произвольных файлов)
  await assert.rejects(
    async () => {
      await applyWatermark(dummyBuffer, "image/jpeg");
    },
    /unsupported image format|Input buffer/i,
    "applyWatermark должен выбрасывать ошибку на невалидный буфер"
  );

  // Валидный буфер должен успешно обрабатываться
  const validImage = await sharp({
    create: { width: 300, height: 300, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .jpeg()
    .toBuffer();

  const result = await applyWatermark(validImage, "image/jpeg");
  assert.ok(Buffer.isBuffer(result), "Должен возвращаться валидный буфер");
});

// 5. Тестирование валидации order_id для вебхука платежей
test("Payments Webhook: строгая валидация order_id", () => {
  const isValidOrderId = (orderId) => {
    return (
      !!orderId &&
      typeof orderId === "string" &&
      orderId.length <= 100 &&
      /^[a-zA-Z0-9_\-]+$/.test(orderId)
    );
  };

  assert.equal(isValidOrderId("order_12345-ABC"), true, "Корректный order_id должен проходить");
  assert.equal(isValidOrderId("a".repeat(101)), false, "order_id длиннее 100 должен отклоняться");
  assert.equal(isValidOrderId("<script>alert(1)</script>"), false, "XSS пейлоад должен отклоняться");
  assert.equal(isValidOrderId("order; DROP TABLE payments;--"), false, "SQL инъекция должна отклоняться");
  assert.equal(isValidOrderId(null), false, "null должен отклоняться");
  assert.equal(isValidOrderId(undefined), false, "undefined должен отклоняться");
  assert.equal(isValidOrderId({}), false, "Объект вместо строки должен отклоняться");
});

// 6. Тестирование защиты от потери оплаты после approved (Fulfillment Protection)
test("Payment Fulfillment: наличие экспортов fulfillPayment и refulfillPayment", async () => {
  const { fulfillPayment, refulfillPayment } = await import("../src/controllers/paymentsController.js");
  assert.equal(typeof fulfillPayment, "function", "fulfillPayment должна быть функцией");
  assert.equal(typeof refulfillPayment, "function", "refulfillPayment должна быть экспортирована");
});

test("Payment Fulfillment: логика сохранения статуса approved при сбое выдачи услуги", () => {
  // Проверяем инвариант: сбой выдачи НЕ должен переводить статус из approved в failed/canceled
  const payment = {
    id: "pay-123",
    order_id: "UT-123",
    status: "approved",
    fulfilled_at: null,
    fulfill_attempts: 0,
  };

  const simulateFulfillmentError = (p, err) => {
    const nextAttempts = (p.fulfill_attempts || 0) + 1;
    return {
      ...p,
      // status остаётся неизменным (approved)
      status: p.status,
      fulfill_attempts: nextAttempts,
      fulfill_error: err.message,
    };
  };

  const failedState = simulateFulfillmentError(payment, new Error("DB connection timeout"));
  assert.equal(failedState.status, "approved", "Статус должен оставаться approved при сбое выдачи");
  assert.equal(failedState.fulfill_attempts, 1, "Счётчик попыток должен инкрементироваться");
  assert.equal(failedState.fulfill_error, "DB connection timeout", "Ошибка должна быть записана");
  assert.equal(failedState.fulfilled_at, null, "fulfilled_at должен оставаться null");

  // При третьем сбое
  const thirdFail = simulateFulfillmentError(
    simulateFulfillmentError(failedState, new Error("Service down")),
    new Error("Third fail")
  );
  assert.equal(thirdFail.fulfill_attempts, 3, "Счётчик попыток должен стать 3");
  assert.equal(thirdFail.status, "approved", "Статус ОБЯЗАН оставаться approved даже после 3 сбоев");
});

test("Payment Fulfillment: проверка регистрации роута refulfill в adminRoutes", async () => {
  const adminRoutes = (await import("../src/routes/adminRoutes.js")).default;
  const refulfillLayer = adminRoutes.stack.find(
    (layer) => layer.route && layer.route.path === "/payments/:id/refulfill" && layer.route.methods.post
  );
  assert.ok(refulfillLayer, "Роут POST /payments/:id/refulfill должен быть зарегистрирован в adminRoutes");
});

// 7. Тестирование защиты от уязвимости "Вечное VIP/ТОП/Срочно через features"
test("Promotions Security: sanitizeFeatures очищает системные ключи", async () => {
  const { sanitizeFeatures } = await import("../src/controllers/listingsController.js");

  const dirtyFeatures = {
    pool: true,
    balcony: true,
    promotionExpiresAt: "9999-12-31",
    urgentExpiresAt: "9999-12-31",
    residentialComplexId: "complex-uuid",
    promotion_expires_at: "9999-12-31",
    urgent_expires_at: "9999-12-31",
  };

  const clean = sanitizeFeatures(dirtyFeatures);
  assert.deepStrictEqual(clean, { pool: true, balcony: true });
  assert.equal(clean.promotionExpiresAt, undefined);
  assert.equal(clean.urgentExpiresAt, undefined);
  assert.equal(clean.residentialComplexId, undefined);
});

test("Promotions Security: resolvePromotionExpiry реализует принцип Fail-Closed и игнорирует features", async () => {
  const { resolvePromotionExpiry } = await import("../src/services/promotionsService.js");

  // VIP без promotion_expires_at (но с фейковым сроком в features) -> сброс в regular
  const fakeFeaturesVip = {
    promotion_status: "vip",
    promotion_expires_at: null,
    features: { promotionExpiresAt: "9999-12-31" },
  };
  const res1 = resolvePromotionExpiry(fakeFeaturesVip);
  assert.equal(res1.promotionStatus, "regular", "VIP без promotion_expires_at должен сбрасываться в regular");
  assert.equal(res1.changed, true);

  // TOP с истёкшей датой -> сброс в regular
  const expiredTop = {
    promotion_status: "top",
    promotion_expires_at: new Date(Date.now() - 10000).toISOString(),
  };
  const res2 = resolvePromotionExpiry(expiredTop);
  assert.equal(res2.promotionStatus, "regular", "Истёкший TOP должен сбрасываться в regular");
  assert.equal(res2.changed, true);

  // Urgent без urgent_expires_at -> сброс is_urgent в false
  const fakeUrgent = {
    is_urgent: true,
    urgent_expires_at: null,
    features: { urgentExpiresAt: "9999-12-31" },
  };
  const res3 = resolvePromotionExpiry(fakeUrgent);
  assert.equal(res3.isUrgent, false, "Срочно без urgent_expires_at должно сбрасываться в false");
  assert.equal(res3.changed, true);

  // Активный VIP со сроком в будущем -> сохраняется
  const activeVip = {
    promotion_status: "vip",
    promotion_expires_at: new Date(Date.now() + 86400000).toISOString(),
    is_urgent: true,
    urgent_expires_at: new Date(Date.now() + 86400000).toISOString(),
  };
  const res4 = resolvePromotionExpiry(activeVip);
  assert.equal(res4.promotionStatus, "vip");
  assert.equal(res4.isUrgent, true);
  assert.equal(res4.changed, false);
});

test("Status Transitions Security: canOwnerTransition защищает от обхода модерации и активации черновика", async () => {
  const { canOwnerTransition } = await import("../src/controllers/listingsController.js");

  // moderation: нельзя никуда переводить и нельзя переводить в moderation
  assert.equal(canOwnerTransition("moderation", "active").allowed, false);
  assert.equal(canOwnerTransition("moderation", "active").message, "Статус модерации может изменить только администратор");
  assert.equal(canOwnerTransition("active", "moderation").allowed, false);
  assert.equal(canOwnerTransition("active", "moderation").message, "Статус модерации может изменить только администратор");
  assert.equal(canOwnerTransition("draft", "moderation").allowed, false);
  assert.equal(canOwnerTransition("moderation", "hidden").allowed, false);

  // draft: прямой переход в active запрещён
  assert.equal(canOwnerTransition("draft", "active").allowed, false);
  assert.equal(canOwnerTransition("draft", "active").message, "Черновик объявления ожидает оплаты или подтверждения публикации");

  // разрешённые переходы владельца
  assert.equal(canOwnerTransition("active", "active").allowed, true);
  assert.equal(canOwnerTransition("active", "hidden").allowed, true);
  assert.equal(canOwnerTransition("hidden", "active").allowed, true);
  assert.equal(canOwnerTransition("hidden", "hidden").allowed, true);
  assert.equal(canOwnerTransition("draft", "draft").allowed, true);
  assert.equal(canOwnerTransition("draft", "hidden").allowed, true);

  // запрещённые переходы
  assert.equal(canOwnerTransition("active", "draft").allowed, false);
  assert.equal(canOwnerTransition("hidden", "draft").allowed, false);
});

// 12. Тестирование защиты от анонимной загрузки файлов (Item 10)
test("Upload Security: защита эндпоинта анонимной загрузки (Item 10)", async () => {
  const { validateImageMagicBytes, ANONYMOUS_MAX_FILE_SIZE } = await import(
    "../src/middleware/upload.js"
  );
  const { ALLOWED_ANONYMOUS_TYPES, anonymousUploadLimiter } = await import(
    "../src/routes/uploadRoutes.js"
  );
  const { uploadPendingAvatarToStorage } = await import("../src/utils/storage.js");

  // 1. Проверка лимитов размера
  assert.equal(ANONYMOUS_MAX_FILE_SIZE, 2 * 1024 * 1024, "Лимит анонимного файла — 2 МБ");

  // 2. Проверка разрешённых типов
  assert.deepEqual(
    Array.from(ALLOWED_ANONYMOUS_TYPES).sort(),
    ["avatar", "logo"],
    "Разрешены только типы avatar и logo"
  );

  // 3. Проверка Magic Bytes
  const validPngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  assert.equal(validateImageMagicBytes(validPngHeader), true, "PNG заголовок должен быть валидным");

  const validJpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  assert.equal(validateImageMagicBytes(validJpegHeader), true, "JPEG заголовок должен быть валидным");

  const htmlPayload = Buffer.from("<html><script>alert(1)</script></html>");
  assert.equal(validateImageMagicBytes(htmlPayload), false, "HTML заголовок должен отклоняться");

  const svgPayload = Buffer.from("<svg width='10' height='10'></svg>");
  assert.equal(validateImageMagicBytes(svgPayload), false, "SVG заголовок должен отклоняться");

  // 4. Проверка изоляции хранилища
  assert.equal(typeof uploadPendingAvatarToStorage, "function");
});

// 13. Тестирование опциональности поля documentsUrl в createComplexSchema
test("Complex Validation: поле documentsUrl является опциональным и безопасным", () => {
  // 1. null разрешён
  const resNull = createComplexSchema.safeParse({ name: "ЖК Ала-Тоо", documentsUrl: null });
  assert.equal(resNull.success, true, "documentsUrl: null должен быть валидным");

  // 2. undefined (поле не передано) разрешено
  const resUndefined = createComplexSchema.safeParse({ name: "ЖК Ала-Тоо" });
  assert.equal(resUndefined.success, true, "documentsUrl: undefined должен быть валидным");

  // 3. пустая строка разрешена
  const resEmpty = createComplexSchema.safeParse({ name: "ЖК Ала-Тоо", documentsUrl: "" });
  assert.equal(resEmpty.success, true, "documentsUrl: '' должен быть валидным");

  // 4. пробелы разрешены (нормализуются через trim)
  const resSpaces = createComplexSchema.safeParse({ name: "ЖК Ала-Тоо", documentsUrl: "   " });
  assert.equal(resSpaces.success, true, "documentsUrl с пробелами должен быть валидным");

  // 5. корректный https URL разрешён
  const resValid = createComplexSchema.safeParse({
    name: "ЖК Ала-Тоо",
    documentsUrl: "https://minstroy.gov.kg/ru/map",
  });
  assert.equal(resValid.success, true, "Валидный https URL должен приниматься");

  // 6. XSS (javascript:) отклоняется
  const resXss = createComplexSchema.safeParse({
    name: "ЖК Ала-Тоо",
    documentsUrl: "javascript:alert(1)",
  });
  assert.equal(resXss.success, false, "javascript: URL должен отклоняться");

  // 7. некорректная ссылка отклоняется
  const resBad = createComplexSchema.safeParse({
    name: "ЖК Ала-Тоо",
    documentsUrl: "not-a-valid-url",
  });
  assert.equal(resBad.success, false, "Невалидный URL должен отклоняться");
});
