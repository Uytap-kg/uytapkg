import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createComplexSchema, updateComplexSchema } from "../src/utils/validation.js";
import { normalizeComplexRow } from "../src/controllers/complexesController.js";
import { BISHKEK_DISTRICTS, LOCATIONS_BY_REGION } from "../src/constants/locations.js";
import { getConstants } from "../src/controllers/constantsController.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("1. Zod Validation: createComplexSchema accepts country, district, cityKey with length safety", () => {
  const validData = {
    name: "ЖК Тестовый",
    country: "kyrgyzstan",
    region: "BISHKEK",
    city: "Бишкек",
    district: "Верхний Джал",
    cityKey: "bishkek",
    address: "ул. Ахунбаева 100",
  };

  const parsed = createComplexSchema.safeParse(validData);
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.country, "kyrgyzstan");
  assert.equal(parsed.data.district, "Верхний Джал");
  assert.equal(parsed.data.cityKey, "bishkek");

  // Rejects excessively long country/district (protection against DoS / memory bloat)
  const tooLongData = {
    name: "ЖК Тестовый",
    country: "A".repeat(51),
    district: "B".repeat(101),
  };
  const invalid = createComplexSchema.safeParse(tooLongData);
  assert.equal(invalid.success, false);
});

test("2. Zod Validation: updateComplexSchema allows partial updates to location", () => {
  const updateOnlyDistrict = {
    district: "Магистраль",
  };
  const parsed = updateComplexSchema.safeParse(updateOnlyDistrict);
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.district, "Магистраль");
});

test("3. normalizeComplexRow: guarantees country, district, cityKey at root level (Dual-Layer compatibility)", () => {
  // Case A: Row has direct columns (migrated database)
  const rowFromColumns = {
    id: "uuid-1",
    name: "ЖК Южный",
    country: "kyrgyzstan",
    district: "Верхний Джал",
    features: { floors: 12 },
  };
  const normalizedA = normalizeComplexRow(rowFromColumns);
  assert.equal(normalizedA.country, "kyrgyzstan");
  assert.equal(normalizedA.district, "Верхний Джал");

  // Case B: Row has location in features JSONB (unmigrated database or fallback)
  const rowFromFeatures = {
    id: "uuid-2",
    name: "ЖК Стамбул Плаза",
    country: null,
    district: null,
    features: { country: "turkey", district: "Кадыкёй", cityKey: "istanbul" },
  };
  const normalizedB = normalizeComplexRow(rowFromFeatures);
  assert.equal(normalizedB.country, "turkey");
  assert.equal(normalizedB.district, "Кадыкёй");
  assert.equal(normalizedB.cityKey, "istanbul");

  // Case C: Legacy row with neither column nor features location
  const rowLegacy = {
    id: "uuid-3",
    name: "Старый ЖК",
    region: "BISHKEK",
    city: "Бишкек",
  };
  const normalizedC = normalizeComplexRow(rowLegacy);
  assert.equal(normalizedC.country, "kyrgyzstan"); // Safe default
  assert.equal(normalizedC.district, null);
});

test("4. Constants: BISHKEK_DISTRICTS contains all 39 districts and getConstants returns them", () => {
  // Verify key new districts from frontend are present
  const requiredDistricts = [
    "Верхний Джал",
    "Средний Джал",
    "Нижний Джал",
    "Магистраль",
    "Золотой квадрат",
    "Орто-Сай",
    "Кок-Жар",
    "Тунгуч",
    "Вефа",
    "ЦУМ",
    "Асанбай",
  ];

  for (const d of requiredDistricts) {
    assert.ok(
      BISHKEK_DISTRICTS.includes(d),
      `District "${d}" must be present in BISHKEK_DISTRICTS`
    );
  }

  assert.ok(
    BISHKEK_DISTRICTS.length >= 39,
    `BISHKEK_DISTRICTS should have at least 39 districts, got ${BISHKEK_DISTRICTS.length}`
  );

  // Verify getConstants() API controller
  let responseData = null;
  const mockRes = {
    status(code) {
      assert.equal(code, 200);
      return this;
    },
    json(body) {
      responseData = body;
      return this;
    },
  };

  getConstants({}, mockRes);
  assert.equal(responseData?.success, true);
  const bishkekFromApi = responseData.data.locationsByRegion.BISHKEK;
  assert.ok(Array.isArray(bishkekFromApi));
  assert.ok(bishkekFromApi.includes("Верхний Джал"));
});

test("5. Real Scenario: ResidentialComplexSelect matching logic against normalized complexes", () => {
  function normalize(value) {
    return String(value || "")
      .toLocaleLowerCase("ru")
      .replace(/ё/g, "е")
      .replace(/[.,;:]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function matchesLocation(complex, { country, city, district, region }) {
    const complexCity = normalize(complex.city);
    const complexDistrict = normalize(complex.district);
    const complexCountry = normalize(complex.country);
    const complexRegion = normalize(complex.region);
    const complexAddress = normalize(complex.address);

    const selectedCity = normalize(city);
    const selectedDistrict = normalize(district);
    const selectedRegion = normalize(region);

    const addressAndLocation = [
      complexAddress,
      complexCity,
      complexDistrict,
      complexRegion,
    ]
      .filter(Boolean)
      .join(" ");

    if (complexCountry && country) {
      const countryAliases = {
        kyrgyzstan: ["кыргызстан", "киргизия", "kyrgyzstan", "kg"],
        turkey: ["турция", "turkey", "türkiye", "tr"],
      };
      const aliases = countryAliases[country] || [normalize(country)];
      if (!aliases.some((alias) => complexCountry.includes(normalize(alias)))) {
        return false;
      }
    }

    if (selectedCity) {
      const cityMatches =
        complexCity === selectedCity ||
        complexCity.includes(selectedCity) ||
        selectedCity.includes(complexCity) ||
        (!complexCity && addressAndLocation.includes(selectedCity));
      if (!cityMatches) return false;
    }

    if (selectedDistrict) {
      const districtMatches =
        complexDistrict === selectedDistrict ||
        (complexDistrict && complexDistrict.includes(selectedDistrict)) ||
        (complexDistrict && selectedDistrict.includes(complexDistrict)) ||
        complexAddress.includes(selectedDistrict);
      if (!districtMatches) return false;
    }

    return true;
  }

  // Complex 1: In Bishkek, district "Верхний Джал"
  const complexBishkekDjal = normalizeComplexRow({
    id: "1",
    name: "Иска-Строй Джал",
    country: "kyrgyzstan",
    city: "Бишкек",
    district: "Верхний Джал",
    address: "ул. Ахунбаева 120",
  });

  // Complex 2: In Bishkek, district "Асанбай"
  const complexBishkekAsanbay = normalizeComplexRow({
    id: "2",
    name: "Элит Хаус Асанбай",
    country: "kyrgyzstan",
    city: "Бишкек",
    district: "Асанбай",
    address: "ул. Токомбаева 45",
  });

  // Complex 3: In Turkey, Istanbul
  const complexTurkey = normalizeComplexRow({
    id: "3",
    name: "Bosphorus View",
    country: "turkey",
    city: "Стамбул",
    district: "Кадыкёй",
    address: "Bagdat Ave 50",
  });

  // Test 5.1: Listing in Bishkek, district "Верхний Джал"
  const filterDjal = {
    country: "kyrgyzstan",
    city: "Бишкек",
    district: "Верхний Джал",
  };
  assert.equal(matchesLocation(complexBishkekDjal, filterDjal), true, "Djal complex must match Djal listing");
  assert.equal(matchesLocation(complexBishkekAsanbay, filterDjal), false, "Asanbay complex must NOT match Djal listing");
  assert.equal(matchesLocation(complexTurkey, filterDjal), false, "Turkey complex must NOT match KG listing");

  // Test 5.2: Listing in Bishkek without district filter
  const filterAllBishkek = {
    country: "kyrgyzstan",
    city: "Бишкек",
  };
  assert.equal(matchesLocation(complexBishkekDjal, filterAllBishkek), true);
  assert.equal(matchesLocation(complexBishkekAsanbay, filterAllBishkek), true);
  assert.equal(matchesLocation(complexTurkey, filterAllBishkek), false);

  // Test 5.3: Listing in Turkey
  const filterTurkey = {
    country: "turkey",
    city: "Стамбул",
  };
  assert.equal(matchesLocation(complexTurkey, filterTurkey), true);
  assert.equal(matchesLocation(complexBishkekDjal, filterTurkey), false);
});

test("6. High-load Database Migration File: Check valid SQL and index definitions", () => {
  const migrationPath = path.resolve(
    __dirname,
    "../../supabase/migrations/20261021000000_residential_complexes_location_and_indexes.sql"
  );
  assert.ok(fs.existsSync(migrationPath), "Migration SQL file must exist");
  const sql = fs.readFileSync(migrationPath, "utf8");

  assert.ok(sql.includes("ADD COLUMN IF NOT EXISTS country"));
  assert.ok(sql.includes("ADD COLUMN IF NOT EXISTS district"));
  assert.ok(sql.includes("idx_residential_complexes_location"));
  assert.ok(sql.includes("idx_residential_complexes_created_at"));
  assert.ok(sql.includes("idx_residential_complexes_dev_created"));
});
