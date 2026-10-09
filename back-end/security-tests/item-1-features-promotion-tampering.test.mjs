import test from "node:test";
import assert from "node:assert/strict";

import {
  updateListing,
  getListingById,
  getListings,
  sanitizeFeatures,
} from "../src/controllers/listingsController.js";
import { resolvePromotionExpiry } from "../src/services/promotionsService.js";
import { supabase } from "../src/config/db.js";

/**
 * Создаёт мок объекта ответа Express (res)
 */
function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
}

// ==============================================================================
// КРИТЕРИЙ 1: ВЛАДЕЛЕЦ VIP ОТПРАВЛЯЕТ PUT { features: {} }
// ==============================================================================
test("Критерий 1: Владелец VIP объявления отправляет PUT { features: {} } — promotion_expires_at и статус VIP в БД не удаляются и не меняются", async () => {
  const origFrom = supabase.from;
  let capturedUpdates = null;

  const validFutureDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const existingListing = {
    id: "listing-vip-001",
    user_id: "user-owner-001",
    status: "active",
    promotion_status: "vip",
    promotion_expires_at: validFutureDate,
    is_urgent: true,
    urgent_expires_at: validFutureDate,
    features: {
      balcony: true,
      parking: true,
      residentialComplexId: "complex-uuid-1",
    },
    title: "Тестовая VIP квартира в центре",
    price: 150000,
    currency: "USD",
    property_type: "apartment",
    deal_type: "sale",
    region: "Бишкек",
  };

  try {
    supabase.from = (table) => {
      assert.equal(table, "listings", "Запросы должны адресоваться к таблице listings");
      return {
        select: () => ({
          eq: (col, id) => {
            assert.equal(col, "id");
            assert.equal(id, "listing-vip-001");
            return {
              single: async () => ({
                data: { ...existingListing },
                error: null,
              }),
            };
          },
        }),
        update: (updates) => {
          capturedUpdates = updates;
          return {
            eq: (col, id) => {
              assert.equal(col, "id");
              assert.equal(id, "listing-vip-001");
              return {
                select: () => ({
                  single: async () => ({
                    data: {
                      ...existingListing,
                      ...updates,
                      // features обновляются, а promotion_status и promotion_expires_at сохраняются
                      promotion_status: existingListing.promotion_status,
                      promotion_expires_at: existingListing.promotion_expires_at,
                      is_urgent: existingListing.is_urgent,
                      urgent_expires_at: existingListing.urgent_expires_at,
                    },
                    error: null,
                  }),
                }),
              };
            },
          };
        },
      };
    };

    const req = {
      params: { id: "listing-vip-001" },
      user: { id: "user-owner-001", role: "personal", account_type: "personal" },
      body: {
        features: {},
      },
    };
    const res = createMockRes();

    await updateListing(req, res);

    // 1. Проверяем HTTP ответ
    assert.equal(res.statusCode, 200, `Ожидался HTTP 200, получено: ${res.statusCode}`);
    assert.equal(res.body?.success, true, "Ответ контроллера должен иметь success: true");

    // 2. Проверяем, что в объект обновления БД НЕ попали поля сброса или затирания промо-статусов
    assert.ok(capturedUpdates, "Объект updates должен быть передан в supabase.update()");
    assert.equal(
      capturedUpdates.promotion_status,
      undefined,
      "updates.promotion_status НЕ должен передаваться в update() при редактировании features"
    );
    assert.equal(
      capturedUpdates.promotion_expires_at,
      undefined,
      "updates.promotion_expires_at НЕ должен передаваться в update() при редактировании features"
    );
    assert.equal(
      capturedUpdates.is_urgent,
      undefined,
      "updates.is_urgent НЕ должен передаваться в update()"
    );
    assert.equal(
      capturedUpdates.urgent_expires_at,
      undefined,
      "updates.urgent_expires_at НЕ должен передаваться в update()"
    );

    // 3. Проверяем, что в возвращённых данных статус и срок VIP не удалились и не изменились
    const responseData = res.body.data;
    assert.equal(responseData.promotion_status, "vip", "Статус VIP должен остаться неизменным");
    assert.equal(
      responseData.promotion_expires_at,
      validFutureDate,
      "promotion_expires_at должен остаться неизменным"
    );
    assert.equal(responseData.is_urgent, true, "Флаг is_urgent должен остаться неизменным");
    assert.equal(
      responseData.urgent_expires_at,
      validFutureDate,
      "urgent_expires_at должен остаться неизменным"
    );
  } finally {
    supabase.from = origFrom;
  }
});

// ==============================================================================
// КРИТЕРИЙ 2: ИНЪЕКЦИЯ promotionExpiresAt / urgentExpiresAt ИГНОРИРУЕТСЯ И САНИТИЗИРУЕТСЯ
// ==============================================================================
test("Критерий 2 (а): Владелец отправляет PUT { features: { promotionExpiresAt: '9999-12-31', urgentExpiresAt: '9999-12-31' } } — инъекция игнорируется, даты экспирации и статус не продлеваются", async () => {
  const origFrom = supabase.from;
  let capturedUpdates = null;

  const originalExpiry = "2026-10-15T12:00:00.000Z";

  const existingListing = {
    id: "listing-vip-002",
    user_id: "user-owner-002",
    status: "active",
    promotion_status: "vip",
    promotion_expires_at: originalExpiry,
    is_urgent: true,
    urgent_expires_at: originalExpiry,
    features: {
      wifi: true,
    },
    title: "Тестовая квартира для проверки инъекции",
    price: 80000,
    currency: "USD",
    property_type: "apartment",
    deal_type: "sale",
    region: "Бишкек",
  };

  try {
    supabase.from = (table) => {
      assert.equal(table, "listings");
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: { ...existingListing },
              error: null,
            }),
          }),
        }),
        update: (updates) => {
          capturedUpdates = updates;
          return {
            eq: () => ({
              select: () => ({
                single: async () => ({
                  data: {
                    ...existingListing,
                    ...updates,
                    promotion_status: existingListing.promotion_status,
                    promotion_expires_at: existingListing.promotion_expires_at,
                    is_urgent: existingListing.is_urgent,
                    urgent_expires_at: existingListing.urgent_expires_at,
                  },
                  error: null,
                }),
              }),
            }),
          };
        },
      };
    };

    const req = {
      params: { id: "listing-vip-002" },
      user: { id: "user-owner-002", role: "personal", account_type: "personal" },
      body: {
        features: {
          wifi: true,
          balcony: true,
          promotionExpiresAt: "9999-12-31T23:59:59.999Z",
          urgentExpiresAt: "9999-12-31T23:59:59.999Z",
          promotion_expires_at: "9999-12-31T23:59:59.999Z",
          urgent_expires_at: "9999-12-31T23:59:59.999Z",
        },
      },
    };
    const res = createMockRes();

    await updateListing(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.success, true);

    // 1. Проверяем, что санитизация вырезала системные поля из features
    assert.ok(capturedUpdates.features, "features должны присутствовать в updates");
    assert.equal(
      capturedUpdates.features.promotionExpiresAt,
      undefined,
      "promotionExpiresAt должен быть полностью удалён из updates.features"
    );
    assert.equal(
      capturedUpdates.features.urgentExpiresAt,
      undefined,
      "urgentExpiresAt должен быть полностью удалён из updates.features"
    );
    assert.equal(
      capturedUpdates.features.promotion_expires_at,
      undefined,
      "promotion_expires_at должен быть удалён из updates.features"
    );
    assert.equal(
      capturedUpdates.features.urgent_expires_at,
      undefined,
      "urgent_expires_at должен быть удалён из updates.features"
    );
    assert.equal(capturedUpdates.features.wifi, true, "Легитимные features (wifi) сохраняются");
    assert.equal(capturedUpdates.features.balcony, true, "Легитимные features (balcony) сохраняются");

    // 2. Проверяем, что даты и статусы в колонках БД не продлены и не переписаны значением 9999-12-31
    assert.equal(capturedUpdates.promotion_expires_at, undefined);
    assert.equal(capturedUpdates.urgent_expires_at, undefined);
    assert.equal(capturedUpdates.promotion_status, undefined);
    assert.equal(capturedUpdates.is_urgent, undefined);

    const responseData = res.body.data;
    assert.equal(
      responseData.promotion_expires_at,
      originalExpiry,
      "promotion_expires_at НЕ должен быть продлен до 9999 года"
    );
    assert.equal(
      responseData.urgent_expires_at,
      originalExpiry,
      "urgent_expires_at НЕ должен быть продлен до 9999 года"
    );
    assert.equal(responseData.promotion_status, "vip", "Статус продвижения остался vip");
  } finally {
    supabase.from = origFrom;
  }
});

test("Критерий 2 (б): Попытка прямой передачи promotionExpiresAt/urgentExpiresAt/promotionStatus на верхнем уровне PUT отклоняется с 403 Forbidden", async () => {
  const origFrom = supabase.from;

  const existingListing = {
    id: "listing-vip-003",
    user_id: "user-owner-003",
    status: "active",
    promotion_status: "regular",
    promotion_expires_at: null,
    is_urgent: false,
    urgent_expires_at: null,
    features: {},
    title: "Тестовая обычная квартира",
  };

  try {
    supabase.from = (table) => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { ...existingListing },
            error: null,
          }),
        }),
      }),
    });

    const maliciousPayloads = [
      { promotionExpiresAt: "9999-12-31" },
      { promotion_expires_at: "9999-12-31" },
      { urgentExpiresAt: "9999-12-31" },
      { urgent_expires_at: "9999-12-31" },
      { promotionStatus: "vip" },
      { isUrgent: true },
    ];

    for (const body of maliciousPayloads) {
      const req = {
        params: { id: "listing-vip-003" },
        user: { id: "user-owner-003", role: "personal", account_type: "personal" },
        body,
      };
      const res = createMockRes();

      await updateListing(req, res);

      assert.equal(
        res.statusCode,
        403,
        `Попытка передачи ${JSON.stringify(body)} должна блокироваться с HTTP 403`
      );
      assert.equal(res.body?.success, false);
      assert.match(
        res.body?.message,
        /Изменение VIP\/ТОП\/Срочно доступно только через оплату/,
        "Сообщение об ошибке должно указывать на запрет изменения промо-параметров"
      );
    }
  } finally {
    supabase.from = origFrom;
  }
});

test("Критерий 2 (в): sanitizeFeatures изолированно удаляет все формы системных ключей сроков и комплексов", () => {
  const dirty = {
    pool: true,
    view: "sea",
    promotionExpiresAt: "9999-12-31",
    urgentExpiresAt: "9999-12-31",
    promotion_expires_at: "9999-12-31",
    urgent_expires_at: "9999-12-31",
    residentialComplexId: "00000000-0000-0000-0000-000000000000",
    residential_complex_id: "00000000-0000-0000-0000-000000000000",
  };

  const clean = sanitizeFeatures(dirty);

  assert.deepStrictEqual(clean, { pool: true, view: "sea" });
  assert.equal(clean.promotionExpiresAt, undefined);
  assert.equal(clean.urgentExpiresAt, undefined);
  assert.equal(clean.promotion_expires_at, undefined);
  assert.equal(clean.urgent_expires_at, undefined);
  assert.equal(clean.residentialComplexId, undefined);
  assert.equal(clean.residential_complex_id, undefined);

  // Проверка граничных случаев
  assert.deepStrictEqual(sanitizeFeatures(null), {});
  assert.deepStrictEqual(sanitizeFeatures(undefined), {});
  assert.deepStrictEqual(sanitizeFeatures([]), {});
  assert.deepStrictEqual(sanitizeFeatures("not-an-object"), {});
});

// ==============================================================================
// КРИТЕРИЙ 3: FAIL-CLOSED ПРИ NULL / ОТСУТСТВУЮЩИХ ДАТАХ В КОЛОНКАХ
// ==============================================================================
test("Критерий 3: Fail-Closed — если у объявления promotion_status='vip'/'top' (или is_urgent=true), а срок в колонке отсутствует (null) — resolvePromotionExpiry отдаёт объявление как regular (is_urgent=false)", () => {
  // 1. VIP без даты в колонке (null)
  const vipNullDate = {
    promotion_status: "vip",
    promotion_expires_at: null,
  };
  const res1 = resolvePromotionExpiry(vipNullDate);
  assert.equal(res1.promotionStatus, "regular", "VIP с promotion_expires_at=null должен стать regular");
  assert.equal(res1.changed, true, "Флаг changed должен быть true");

  // 2. TOP без даты в колонке (null)
  const topNullDate = {
    promotion_status: "top",
    promotion_expires_at: null,
  };
  const res2 = resolvePromotionExpiry(topNullDate);
  assert.equal(res2.promotionStatus, "regular", "TOP с promotion_expires_at=null должен стать regular");
  assert.equal(res2.changed, true);

  // 3. is_urgent=true без даты в колонке (null)
  const urgentNullDate = {
    is_urgent: true,
    urgent_expires_at: null,
  };
  const res3 = resolvePromotionExpiry(urgentNullDate);
  assert.equal(res3.isUrgent, false, "is_urgent=true с urgent_expires_at=null должен стать false");
  assert.equal(res3.changed, true);

  // 4. Поле promotion_expires_at равно undefined
  const vipUndefinedDate = {
    promotion_status: "vip",
  };
  const res4 = resolvePromotionExpiry(vipUndefinedDate);
  assert.equal(res4.promotionStatus, "regular", "VIP без поля promotion_expires_at должен стать regular");
  assert.equal(res4.changed, true);

  // 5. Невалидная строка даты (NaN при Date parse)
  const vipInvalidDate = {
    promotion_status: "vip",
    promotion_expires_at: "not-a-valid-date-string",
  };
  const res5 = resolvePromotionExpiry(vipInvalidDate);
  assert.equal(res5.promotionStatus, "regular", "VIP с невалидной датой должен стать regular");
  assert.equal(res5.changed, true);

  // 6. Попытка обмана: колонки в БД null, но в features подсунуты фиктивные даты '9999-12-31'
  const spoofedInFeatures = {
    promotion_status: "vip",
    promotion_expires_at: null,
    is_urgent: true,
    urgent_expires_at: null,
    features: {
      promotionExpiresAt: "9999-12-31T23:59:59.999Z",
      urgentExpiresAt: "9999-12-31T23:59:59.999Z",
    },
  };
  const res6 = resolvePromotionExpiry(spoofedInFeatures);
  assert.equal(
    res6.promotionStatus,
    "regular",
    "resolvePromotionExpiry ОБЯЗАН игнорировать features и возвращать regular при null в колонке"
  );
  assert.equal(
    res6.isUrgent,
    false,
    "resolvePromotionExpiry ОБЯЗАН игнорировать features и возвращать is_urgent=false при null в колонке"
  );
  assert.equal(res6.changed, true);

  // 7. Легитимный активный VIP с будущей датой в колонке БД — сохраняется
  const legitimateActiveVip = {
    promotion_status: "vip",
    promotion_expires_at: new Date(Date.now() + 86400000).toISOString(),
    is_urgent: true,
    urgent_expires_at: new Date(Date.now() + 86400000).toISOString(),
  };
  const res7 = resolvePromotionExpiry(legitimateActiveVip);
  assert.equal(res7.promotionStatus, "vip", "Легитимный VIP должен сохранять статус vip");
  assert.equal(res7.isUrgent, true, "Легитимный urgent должен оставаться true");
  assert.equal(res7.changed, false, "changed должен быть false");
});

// ==============================================================================
// КРИТЕРИЙ 4: ИСТЕЧЕНИЕ СРОКА — НА ЧТЕНИИ ОБЪЯВЛЕНИЕ ОТДАЁТСЯ КАК REGULAR
// ДАЖЕ ЕСЛИ FEATURES ПУСТОЕ ИЛИ ОТСУТСТВУЕТ
// ==============================================================================
test("Критерий 4 (а): resolvePromotionExpiry — после наступления срока объявление отдаётся как regular, даже если поле features пустое или отсутствует", () => {
  const pastDate = new Date(Date.now() - 3600000).toISOString(); // 1 час назад

  // Случай 1: features пустой объект {}
  const expiredWithEmptyFeatures = {
    promotion_status: "vip",
    promotion_expires_at: pastDate,
    features: {},
  };
  const res1 = resolvePromotionExpiry(expiredWithEmptyFeatures);
  assert.equal(res1.promotionStatus, "regular", "Истёкший VIP с features={} должен стать regular");
  assert.equal(res1.changed, true);

  // Случай 2: features = null
  const expiredWithNullFeatures = {
    promotion_status: "vip",
    promotion_expires_at: pastDate,
    features: null,
  };
  const res2 = resolvePromotionExpiry(expiredWithNullFeatures);
  assert.equal(res2.promotionStatus, "regular", "Истёкший VIP с features=null должен стать regular");
  assert.equal(res2.changed, true);

  // Случай 3: features отсутствует (undefined)
  const expiredWithoutFeatures = {
    promotion_status: "top",
    promotion_expires_at: pastDate,
  };
  const res3 = resolvePromotionExpiry(expiredWithoutFeatures);
  assert.equal(res3.promotionStatus, "regular", "Истёкший TOP без features должен стать regular");
  assert.equal(res3.changed, true);

  // Случай 4: is_urgent истёк, features отсутствует
  const expiredUrgent = {
    is_urgent: true,
    urgent_expires_at: pastDate,
  };
  const res4 = resolvePromotionExpiry(expiredUrgent);
  assert.equal(res4.isUrgent, false, "Истёкший is_urgent без features должен стать false");
  assert.equal(res4.changed, true);
});

test("Критерий 4 (б): Чтение объявления через getListingById — истёкшее объявление отдаётся как regular, даже если features пустое или отсутствует", async () => {
  const origFrom = supabase.from;
  const pastDate = new Date(Date.now() - 7200000).toISOString(); // 2 часа назад

  const expiredListingInDb = {
    id: "listing-expired-001",
    user_id: "user-111",
    status: "active",
    promotion_status: "vip",
    promotion_expires_at: pastDate,
    is_urgent: true,
    urgent_expires_at: pastDate,
    features: {}, // features пустое!
    views_count: 5,
    expires_at: new Date(Date.now() + 86400000 * 30).toISOString(),
  };

  try {
    supabase.from = (table) => {
      assert.equal(table, "listings");
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: { ...expiredListingInDb },
              error: null,
            }),
          }),
        }),
        update: () => ({
          eq: () => Promise.resolve({ data: null, error: null }),
        }),
      };
    };

    const req = { params: { id: "listing-expired-001" } };
    const res = createMockRes();

    await getListingById(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.success, true);

    const receivedListing = res.body?.data;
    assert.equal(
      receivedListing.promotion_status,
      "regular",
      "На чтении истёкший VIP обязан быть замаскирован в regular"
    );
    assert.equal(
      receivedListing.is_urgent,
      false,
      "На чтении истёкший is_urgent обязан быть замаскирован в false"
    );
  } finally {
    supabase.from = origFrom;
  }
});

test("Критерий 4 (в): Чтение списка объявлений через getListings — истёкшие объявления отдаются как regular с приоритетом regular", async () => {
  const origFrom = supabase.from;
  const pastDate = new Date(Date.now() - 7200000).toISOString();
  const futureDate = new Date(Date.now() + 86400000 * 5).toISOString();

  const mockDbListings = [
    {
      id: "listing-expired-vip",
      status: "active",
      promotion_status: "vip",
      promotion_expires_at: pastDate, // Истёк!
      is_urgent: false,
      features: null, // features отсутствует/null
      created_at: new Date(Date.now() - 100000).toISOString(),
      expires_at: futureDate,
    },
    {
      id: "listing-active-vip",
      status: "active",
      promotion_status: "vip",
      promotion_expires_at: futureDate, // Активен!
      is_urgent: false,
      features: {},
      created_at: new Date(Date.now() - 200000).toISOString(),
      expires_at: futureDate,
    },
  ];

  try {
    supabase.from = (table) => {
      return {
        select: () => ({
          eq: () => ({
            gt: () => ({
              order: () => ({
                range: async () => ({
                  data: mockDbListings,
                  count: 2,
                  error: null,
                }),
              }),
            }),
          }),
        }),
      };
    };

    const req = { query: {} };
    const res = createMockRes();

    await getListings(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.success, true);
    const listings = res.body?.data;

    // listing-active-vip должен остаться vip
    const active = listings.find((l) => l.id === "listing-active-vip");
    assert.equal(active.promotion_status, "vip");

    // listing-expired-vip должен стать regular
    const expired = listings.find((l) => l.id === "listing-expired-vip");
    assert.equal(
      expired.promotion_status,
      "regular",
      "Истёкшее объявление в общем списке должно отдаваться как regular"
    );

    // В сортировке активный VIP (приоритет 0) должен идти раньше истёкшего regular (приоритет 3)
    assert.equal(listings[0].id, "listing-active-vip");
    assert.equal(listings[1].id, "listing-expired-vip");
  } finally {
    supabase.from = origFrom;
  }
});
