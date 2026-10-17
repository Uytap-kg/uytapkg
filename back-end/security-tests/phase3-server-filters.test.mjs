import test from "node:test";
import assert from "node:assert/strict";

import { applyListingFilters } from "../src/controllers/listingsController.js";
import { DEFAULT_USD_TO_KGS } from "../src/constants/pricing.js";
import { FEATURE_KEYS } from "../src/constants/features.js";
import { UI_TO_DB_PROPERTY_TYPE, COTTAGE_HOUSE_TYPE } from "../src/constants/propertyTypes.js";

/**
 * Создаёт мок объекта запроса Supabase для отслеживания всех вызовов фильтров
 */
function createMockQuery() {
  const calls = {
    eq: [],
    neq: [],
    gte: [],
    lte: [],
    gt: [],
    lt: [],
    in: [],
    or: [],
    contains: [],
    ilike: [],
  };

  const queryMock = {
    _calls: calls,
    eq(col, val) {
      calls.eq.push({ col, val });
      return queryMock;
    },
    neq(col, val) {
      calls.neq.push({ col, val });
      return queryMock;
    },
    gte(col, val) {
      calls.gte.push({ col, val });
      return queryMock;
    },
    lte(col, val) {
      calls.lte.push({ col, val });
      return queryMock;
    },
    gt(col, val) {
      calls.gt.push({ col, val });
      return queryMock;
    },
    lt(col, val) {
      calls.lt.push({ col, val });
      return queryMock;
    },
    in(col, val) {
      calls.in.push({ col, val });
      return queryMock;
    },
    or(filterStr) {
      calls.or.push(filterStr);
      return queryMock;
    },
    contains(col, val) {
      calls.contains.push({ col, val });
      return queryMock;
    },
    ilike(col, val) {
      calls.ilike.push({ col, val });
      return queryMock;
    },
  };

  return queryMock;
}

test("Phase 3: urgentOnly фильтрует только активные и неистёкшие срочные объявления", () => {
  // 1. urgentOnly не задан
  const qNone = createMockQuery();
  applyListingFilters(qNone, {});
  assert.equal(qNone._calls.eq.find((c) => c.col === "is_urgent"), undefined);
  assert.equal(qNone._calls.or.some((c) => c.includes("urgent_expires_at")), false);

  // 2. urgentOnly = false
  const qFalse = createMockQuery();
  applyListingFilters(qFalse, { urgentOnly: false });
  assert.equal(qFalse._calls.eq.find((c) => c.col === "is_urgent"), undefined);

  // 3. urgentOnly = true (булево)
  const qTrue = createMockQuery();
  applyListingFilters(qTrue, { urgentOnly: true });
  assert.deepEqual(qTrue._calls.eq.find((c) => c.col === "is_urgent"), { col: "is_urgent", val: true });
  assert.ok(
    qTrue._calls.or.some((c) => c.includes("urgent_expires_at.is.null") && c.includes("urgent_expires_at.gt.")),
    "Должен проверять urgent_expires_at is null или > now()"
  );

  // 4. urgentOnly = "true" (строка из query param)
  const qStrTrue = createMockQuery();
  applyListingFilters(qStrTrue, { urgentOnly: "true" });
  assert.deepEqual(qStrTrue._calls.eq.find((c) => c.col === "is_urgent"), { col: "is_urgent", val: true });
  assert.ok(qStrTrue._calls.or.some((c) => c.includes("urgent_expires_at.is.null")));
});

test("Phase 3: propertyType корректно маршрутизирует все типы недвижимости, включая cottage и parking", () => {
  // 1. apartment
  const qApartment = createMockQuery();
  applyListingFilters(qApartment, { propertyType: "apartment" });
  assert.deepEqual(qApartment._calls.eq.find((c) => c.col === "property_type"), { col: "property_type", val: "apartment" });

  // 2. land
  const qLand = createMockQuery();
  applyListingFilters(qLand, { propertyType: "land" });
  assert.deepEqual(qLand._calls.eq.find((c) => c.col === "property_type"), { col: "property_type", val: "land" });

  // 3. commercial
  const qCommercial = createMockQuery();
  applyListingFilters(qCommercial, { propertyType: "commercial" });
  assert.deepEqual(qCommercial._calls.eq.find((c) => c.col === "property_type"), { col: "property_type", val: "commercial" });

  // 4. room
  const qRoom = createMockQuery();
  applyListingFilters(qRoom, { propertyType: "room" });
  assert.deepEqual(qRoom._calls.eq.find((c) => c.col === "property_type"), { col: "property_type", val: "room" });

  // 5. parking -> garage
  const qParking = createMockQuery();
  applyListingFilters(qParking, { propertyType: "parking" });
  assert.deepEqual(qParking._calls.eq.find((c) => c.col === "property_type"), { col: "property_type", val: "garage" });

  // 6. garage -> garage
  const qGarage = createMockQuery();
  applyListingFilters(qGarage, { propertyType: "garage" });
  assert.deepEqual(qGarage._calls.eq.find((c) => c.col === "property_type"), { col: "property_type", val: "garage" });

  // 7. cottage -> property_type='house' AND features->>houseType='Коттедж'
  const qCottage = createMockQuery();
  applyListingFilters(qCottage, { propertyType: "cottage" });
  assert.deepEqual(qCottage._calls.eq.find((c) => c.col === "property_type"), { col: "property_type", val: "house" });
  assert.deepEqual(qCottage._calls.eq.find((c) => c.col === "features->>houseType"), {
    col: "features->>houseType",
    val: COTTAGE_HOUSE_TYPE,
  });

  // 8. house -> property_type='house' AND NULL-safe исключение Коттеджей
  const qHouse = createMockQuery();
  applyListingFilters(qHouse, { propertyType: "house" });
  assert.deepEqual(qHouse._calls.eq.find((c) => c.col === "property_type"), { col: "property_type", val: "house" });
  assert.ok(
    qHouse._calls.or.some((c) => c.includes("features->>houseType.is.null") && c.includes(`features->>houseType.neq.${COTTAGE_HOUSE_TYPE}`)),
    "house должен включать строки с NULL houseType и строки с houseType != Коттедж"
  );

  // 9. all или пустой -> нет фильтра
  const qAll = createMockQuery();
  applyListingFilters(qAll, { propertyType: "all" });
  assert.equal(qAll._calls.eq.find((c) => c.col === "property_type"), undefined);
});

test("Phase 3: Мультивалютная фильтрация цен KGS ↔ USD", () => {
  // 1. Валюта USD: границы конвертируются в KGS по курсу 87
  const qUsd = createMockQuery();
  applyListingFilters(qUsd, { currency: "USD", minPrice: 1000, maxPrice: 5000 });
  const usdOr = qUsd._calls.or.find((c) => c.includes("currency.eq.USD"));
  assert.ok(usdOr, "Должен быть сформирован or-фильтр для мультивалютного диапазона");
  assert.ok(usdOr.includes("price.gte.1000"), "Прямая граница USD min");
  assert.ok(usdOr.includes("price.lte.5000"), "Прямая граница USD max");
  assert.ok(usdOr.includes(`price.gte.${1000 * DEFAULT_USD_TO_KGS}`), "Сконвертированная граница KGS min (87000)");
  assert.ok(usdOr.includes(`price.lte.${5000 * DEFAULT_USD_TO_KGS}`), "Сконвертированная граница KGS max (435000)");
  assert.ok(usdOr.includes("currency.is.null"), "Объявления с NULL валютой трактуются как USD");

  // 2. Валюта KGS: границы конвертируются в USD с делением на 87 и округлением до 2 знаков
  const qKgs = createMockQuery();
  applyListingFilters(qKgs, { currency: "KGS", minPrice: 87000, maxPrice: 435000 });
  const kgsOr = qKgs._calls.or.find((c) => c.includes("currency.eq.KGS"));
  assert.ok(kgsOr);
  assert.ok(kgsOr.includes("price.gte.87000"), "Прямая граница KGS min");
  assert.ok(kgsOr.includes("price.lte.435000"), "Прямая граница KGS max");
  assert.ok(kgsOr.includes("price.gte.1000"), "Сконвертированная граница USD min (87000 / 87 = 1000)");
  assert.ok(kgsOr.includes("price.lte.5000"), "Сконвертированная граница USD max (435000 / 87 = 5000)");

  // 3. Только minPrice
  const qMinOnly = createMockQuery();
  applyListingFilters(qMinOnly, { currency: "USD", minPrice: 2000 });
  const minOnlyOr = qMinOnly._calls.or.find((c) => c.includes("currency.eq.USD"));
  assert.ok(minOnlyOr.includes("price.gte.2000"));
  assert.ok(!minOnlyOr.includes("price.lte."));

  // 4. Только maxPrice (через priceTo)
  const qMaxOnly = createMockQuery();
  applyListingFilters(qMaxOnly, { currency: "USD", priceTo: 3000 });
  const maxOnlyOr = qMaxOnly._calls.or.find((c) => c.includes("currency.eq.USD"));
  assert.ok(maxOnlyOr.includes("price.lte.3000"));
  assert.ok(!maxOnlyOr.includes("price.gte."));

  // 5. Без currency: прямое сравнение колонки price
  const qNoCur = createMockQuery();
  applyListingFilters(qNoCur, { minPrice: 1500, maxPrice: 3500 });
  assert.deepEqual(qNoCur._calls.gte.find((c) => c.col === "price"), { col: "price", val: 1500 });
  assert.deepEqual(qNoCur._calls.lte.find((c) => c.col === "price"), { col: "price", val: 3500 });

  // 6. Currency без цен: фильтр не накладывается
  const qCurOnly = createMockQuery();
  applyListingFilters(qCurOnly, { currency: "USD" });
  assert.equal(qCurOnly._calls.or.some((c) => c.includes("currency")), false);
  assert.equal(qCurOnly._calls.gte.find((c) => c.col === "price"), undefined);
});

test("Phase 3: Множественные вызовы query.or() не затирают друг друга", () => {
  const qCombined = createMockQuery();
  applyListingFilters(qCombined, {
    searchQuery: "Бишкек",
    currency: "USD",
    minPrice: 50000,
    urgentOnly: true,
    propertyType: "house",
  });

  // Должны присутствовать 4 независимых вызова .or():
  // 1. Полнотекстовый поиск по title, district, city
  // 2. Мультивалютная фильтрация цен
  // 3. urgent_expires_at is null или > now()
  // 4. houseType is null или neq.Коттедж
  assert.equal(qCombined._calls.or.length, 4, "Должно быть ровно 4 or-вызова без затирания");
  assert.ok(qCombined._calls.or.some((c) => c.includes("title.ilike.")));
  assert.ok(qCombined._calls.or.some((c) => c.includes("currency.eq.USD")));
  assert.ok(qCombined._calls.or.some((c) => c.includes("urgent_expires_at.is.null")));
  assert.ok(qCombined._calls.or.some((c) => c.includes("features->>houseType.is.null")));
});

test("Phase 3: Характеристики categories (features JSONB) по белому списку", () => {
  // 1. Массивные фильтры (amenities, communications) и фильтры по скалярным полям (walls, condition)
  const qFeatures = createMockQuery();
  applyListingFilters(qFeatures, {
    amenities: ["Wi-Fi", "Кондиционер"],
    walls: ["Кирпич", "Монолит"],
    condition: "Евроремонт",
    nonWhitelistedKey: "malicious_injection",
    "features->>inject": "drop table",
  });

  // amenities -> contains 'features' { amenities: ['Wi-Fi', 'Кондиционер'] }
  const amenCall = qFeatures._calls.contains.find((c) => c.col === "features" && c.val.amenities);
  assert.ok(amenCall, "Должен накладываться contains на features.amenities");
  assert.deepEqual(amenCall.val.amenities, ["Wi-Fi", "Кондиционер"]);

  // walls -> in 'features->>walls' ['Кирпич', 'Монолит']
  const wallsCall = qFeatures._calls.in.find((c) => c.col === "features->>walls");
  assert.ok(wallsCall, "Должен накладываться in на features->>walls");
  assert.deepEqual(wallsCall.val, ["Кирпич", "Монолит"]);

  // condition -> contains 'features' { condition: 'Евроремонт' }
  const condCall = qFeatures._calls.contains.find((c) => c.col === "features" && c.val.condition);
  assert.ok(condCall, "Должен накладываться contains на features.condition");
  assert.equal(condCall.val.condition, "Евроремонт");

  // Не входящие в белый список ключи НЕ должны быть переданы
  assert.equal(qFeatures._calls.contains.find((c) => c.val.nonWhitelistedKey), undefined);
  assert.equal(qFeatures._calls.eq.find((c) => c.col?.includes("inject")), undefined);

  // 2. Этаж (floor): числовое значение и диапазон 10+
  const qFloorExact = createMockQuery();
  applyListingFilters(qFloorExact, { floor: "5" });
  assert.ok(qFloorExact._calls.or.some((c) => c.includes("floor.eq.5") && c.includes("features->>floor.eq.5")));

  const qFloorPlus = createMockQuery();
  applyListingFilters(qFloorPlus, { floor: "10+" });
  assert.ok(qFloorPlus._calls.or.some((c) => c.includes("floor.gte.10")));
});

test("Phase 3: Расстояние до пляжа (resort_filters)", () => {
  const qBeach = createMockQuery();
  applyListingFilters(qBeach, {
    beachDistanceFrom: "100",
    beachDistanceTo: "500",
  });

  assert.deepEqual(qBeach._calls.gte.find((c) => c.col === "resort_filters->beachDistanceFrom"), {
    col: "resort_filters->beachDistanceFrom",
    val: 100,
  });
  assert.deepEqual(qBeach._calls.lte.find((c) => c.col === "resort_filters->beachDistanceTo"), {
    col: "resort_filters->beachDistanceTo",
    val: 500,
  });
});
