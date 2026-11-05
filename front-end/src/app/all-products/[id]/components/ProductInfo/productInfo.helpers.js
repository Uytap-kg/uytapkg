import {
  getFieldIcon,
  getFieldLabel,
  getCategoryConfig,
} from "./productInfo.config";

export function normalize(value) {
  if (value === null || value === undefined) return "";

  return String(value).trim().toLowerCase().replace(/ё/g, "е");
}

export function hasValue(value) {
  if (value === null || value === undefined) return false;

  if (typeof value === "string") return value.trim() !== "";

  if (Array.isArray(value)) return value.length > 0;

  return true;
}

export function getRawValue(product, ...keys) {
  const raw = product?.rawFeatures || {};

  for (const key of keys) {
    if (hasValue(raw[key])) return raw[key];
    if (hasValue(product?.[key])) return product[key];
  }

  return null;
}

export function formatValue(value, t) {
  if (!hasValue(value)) return null;

  if (typeof value === "boolean") {
    return value ? t("productInfo.yes") : t("productInfo.no");
  }

  if (Array.isArray(value)) {
    const values = value
      .filter(hasValue)
      .map((item) => {
        if (typeof item === "object" && item !== null) {
          return (
            item.name ||
            item.title ||
            item.label ||
            item.value ||
            JSON.stringify(item)
          );
        }

        return String(item);
      })
      .map((item) => String(item).trim())
      .filter(Boolean);

    return values.length ? values.join(", ") : null;
  }

  if (typeof value === "object" && value !== null) {
    if (value.name) return String(value.name);
    if (value.title) return String(value.title);
    if (value.label) return String(value.label);
    if (value.value !== undefined) return formatValue(value.value, t);

    const entries = Object.entries(value)
      .filter(([, item]) => hasValue(item))
      .map(
        ([key, item]) => `${getFieldLabel(key, t)}: ${formatValue(item, t)}`,
      );

    return entries.length ? entries.join(", ") : null;
  }

  return String(value).trim();
}

export function formatDistance(value, t) {
  const formatted = formatValue(value, t);

  if (!formatted) return null;

  if (
    formatted.includes("м") ||
    formatted.includes("км") ||
    formatted.includes("метр")
  ) {
    return formatted;
  }

  return `${formatted} ${t("productInfo.units.meter")}`;
}

function formatHeight(value, t) {
  const formatted = formatValue(value, t);

  if (!formatted) return null;
  if (formatted.includes("м")) return formatted;

  return `${formatted} ${t("productInfo.units.meter")}`;
}

function formatArea(value, t, land = false) {
  const formatted = formatValue(value, t);

  if (!formatted) return null;

  if (
    formatted.includes("м²") ||
    formatted.includes("м2") ||
    formatted.includes("сот")
  ) {
    return formatted;
  }

  return land
    ? `${formatted} ${t("productInfo.units.sotka")}`
    : `${formatted} ${t("productInfo.units.squareMeter")}`;
}

function formatSeries(value, t) {
  if (!value) return null;

  const normalized = normalize(value);

  const labels = {
    "106_normal": t("productInfo.series.106Normal"),
    "106_improved": t("productInfo.series.106Improved"),
    "107_normal": t("productInfo.series.107Normal"),
    "107_improved": t("productInfo.series.107Improved"),

    "106_обычная": t("productInfo.series.106Normal"),
    "106_улучшенная": t("productInfo.series.106Improved"),
    "107_обычная": t("productInfo.series.107Normal"),
    "107_улучшенная": t("productInfo.series.107Improved"),

    new_building: t("productInfo.series.newBuilding"),
    newbuilding: t("productInfo.series.newBuilding"),

    elite: t("productInfo.series.elite"),
    элитка: t("productInfo.series.elite"),

    individual: t("productInfo.series.individual"),
    individualka: t("productInfo.series.individual"),
    индивидуалка: t("productInfo.series.individual"),

    сталинка: t("productInfo.series.stalinka"),
    хрущевка: t("productInfo.series.khrushchevka"),
    пентхаус: t("productInfo.series.penthouse"),
  };

  return (
    labels[normalized] ||
    labels[normalized.replace(/\s+/g, "_")] ||
    String(value).trim()
  );
}

export function getCategoryKey(product) {
  const rawCategory = normalize(
    getRawValue(product, "property_type", "propertyType", "category", "type"),
  );

  if (rawCategory.includes("квартир")) return "apartment";
  if (rawCategory.includes("коттедж")) return "cottage";

  if (rawCategory.includes("дом") || rawCategory.includes("особняк")) {
    return "house";
  }

  if (rawCategory.includes("участ") || rawCategory.includes("зем")) {
    return "land";
  }

  if (rawCategory.includes("комнат")) return "room";

  if (
    rawCategory.includes("коммерц") ||
    rawCategory.includes("офис") ||
    rawCategory.includes("магазин")
  ) {
    return "commercial";
  }

  if (rawCategory.includes("паркинг") || rawCategory.includes("гараж")) {
    return "parking";
  }

  return "apartment";
}

export function isRent(product) {
  const dealType = normalize(getRawValue(product, "dealType", "deal_type"));

  return (
    dealType.includes("аренд") ||
    dealType.includes("сним") ||
    dealType === "rent"
  );
}

export function buildCharacteristics(product, t) {
  const categoryKey = getCategoryKey(product);
  const categoryConfig = getCategoryConfig(t);
  const config = categoryConfig[categoryKey] || [];
  const rent = isRent(product);

  const result = [];
  const usedKeys = new Set();

  const addCharacteristic = (key, label, Icon, value) => {
    if (!hasValue(value) || usedKeys.has(key)) return;

    const formatted = formatValue(value, t);

    if (!formatted) return;

    usedKeys.add(key);

    result.push({
      key,
      label,
      value: formatted,
      icon: Icon || getFieldIcon(key),
    });
  };

  for (const [key, label, Icon] of config) {
    if (rent && (key === "documents" || key === "offerType")) {
      continue;
    }

    let value = getRawValue(product, key);

    if (!hasValue(value)) continue;

    if (key === "series") value = formatSeries(value, t);
    if (key === "ceilingHeight") value = formatHeight(value, t);
    if (key === "area") value = formatArea(value, t);

    if (key === "landArea" || key === "areaSotka" || key === "plotArea") {
      value = formatArea(value, t, true);
    }

    addCharacteristic(key, label, Icon, value);
  }

  const complexKeys = [
    "residentialComplex",
    "residential_complex",
    "residentialComplexName",
    "residential_complex_name",
    "complex",
    "complexName",
    "complex_name",
    "zhk",
    "zhkName",
  ];

  const complex = getRawValue(product, ...complexKeys);

  if (hasValue(complex)) {
    result.unshift({
      key: "residentialComplex",
      label: t("productInfo.fields.residentialComplex"),
      value: formatValue(complex, t),
      icon: getFieldIcon("residentialComplex"),
    });

    complexKeys.forEach((key) => usedKeys.add(key));
  }

  const developer = getRawValue(
    product,
    "developer",
    "developerName",
    "developer_name",
  );

  if (hasValue(developer)) {
    addCharacteristic(
      "developer",
      t("productInfo.fields.developer"),
      getFieldIcon("developer"),
      developer,
    );

    usedKeys.add("developerName");
    usedKeys.add("developer_name");
  }

  if (categoryKey === "apartment" && rent) {
    const pets = getRawValue(product, "pets");

    if (hasValue(pets)) {
      addCharacteristic(
        "pets",
        t("productInfo.fields.pets"),
        getFieldIcon("pets"),
        pets,
      );
    }
  }

  const raw = product?.rawFeatures || {};

  Object.entries(raw).forEach(([key, value]) => {
    if (
      [
        "amenities",
        "images",
        "photos",
        "gallery",
        "latitude",
        "longitude",
        "lat",
        "lng",
        "lon",
      ].includes(key)
    ) {
      return;
    }

    if (usedKeys.has(key) || !hasValue(value)) return;

    const normalizedKey = normalize(key);

    if (
      normalizedKey.startsWith("id") ||
      normalizedKey.endsWith("id") ||
      normalizedKey.includes("createdat") ||
      normalizedKey.includes("updatedat") ||
      normalizedKey.includes("deletedat") ||
      normalizedKey.includes("expiresat") ||
      normalizedKey.includes("verificationstatus") ||
      normalizedKey.includes("verificationdocs") ||
      normalizedKey.includes("rejectionreason")
    ) {
      return;
    }

    let formattedValue = value;

    if (
      key === "series" ||
      key === "apartmentSeries" ||
      key === "apartment_series"
    ) {
      formattedValue = formatSeries(value, t);
    }

    if (key === "ceilingHeight" || key === "ceiling_height") {
      formattedValue = formatHeight(value, t);
    }

    if (key === "area" || key === "totalArea" || key === "total_area") {
      formattedValue = formatArea(value, t);
    }

    if (
      [
        "landArea",
        "land_area",
        "areaSotka",
        "area_sotka",
        "plotArea",
        "plot_area",
      ].includes(key)
    ) {
      formattedValue = formatArea(value, t, true);
    }

    addCharacteristic(
      key,
      getFieldLabel(key, t),
      getFieldIcon(key),
      formattedValue,
    );
  });

  return result;
}

export function getAmenities(product) {
  const raw = product?.rawFeatures || {};

  const value =
    raw.amenities ?? product?.amenities ?? raw.features ?? product?.features;

  if (Array.isArray(value)) {
    return value
      .filter(Boolean)
      .map((item) => {
        if (typeof item === "object" && item !== null) {
          return item.name || item.title || item.label || item.value || null;
        }

        return String(item);
      })
      .filter(Boolean);
  }

  if (hasValue(value)) return [String(value)];

  return [];
}

export function getLocationParts(product) {
  const city = String(getRawValue(product, "city") || "").trim();
  const region = String(getRawValue(product, "region") || "").trim();
  const district = String(getRawValue(product, "district") || "").trim();
  const settlement = String(getRawValue(product, "settlement") || "").trim();

  const parts = [];

  const isBishkek =
    city.toLowerCase() === "бишкек" ||
    region.toLowerCase() === "бишкек" ||
    region.toLowerCase().includes("бишкек");

  const isOshCity =
    (city.toLowerCase() === "ош" &&
      !region.toLowerCase().includes("область")) ||
    region.toLowerCase() === "ош";

  if (isBishkek) {
    parts.push("Бишкек");

    if (district && district.toLowerCase() !== "бишкек") {
      parts.push(district);
    }
  } else if (isOshCity) {
    parts.push("Ош");

    if (district && district.toLowerCase() !== "ош") {
      parts.push(district);
    }
  } else {
    const mainCity = city || settlement;

    if (mainCity) parts.push(mainCity);

    if (district && district.toLowerCase() !== mainCity.toLowerCase()) {
      parts.push(district);
    }

    if (
      region &&
      region !== "Кыргызстан" &&
      (!mainCity || !region.toLowerCase().includes(mainCity.toLowerCase()))
    ) {
      parts.push(region);
    }
  }

  if (parts.length > 0) return parts;

  if (product?.location && product.location !== "Кыргызстан") {
    return [product.location];
  }

  if (product?.address && String(product.address).trim()) {
    return [String(product.address).trim()];
  }

  return [];
}

export function getLocationDetails(product, t) {
  const items = [];

  const country = getRawValue(product, "country");
  const region = getRawValue(product, "region");
  const city = getRawValue(product, "city");
  const settlement = getRawValue(product, "settlement");
  const district = getRawValue(product, "district");

  if (hasValue(country)) {
    items.push({
      label: t("productInfo.location.country"),
      value: String(country).trim(),
    });
  }

  if (hasValue(region) && region !== "Кыргызстан") {
    items.push({
      label: t("productInfo.location.region"),
      value: String(region).trim(),
    });
  }

  if (hasValue(city)) {
    items.push({
      label: t("productInfo.location.city"),
      value: String(city).trim(),
    });
  }

  if (hasValue(settlement)) {
    items.push({
      label: t("productInfo.location.settlement"),
      value: String(settlement).trim(),
    });
  }

  if (hasValue(district)) {
    items.push({
      label: t("productInfo.location.district"),
      value: String(district).trim(),
    });
  }

  return items;
}

export function getTwoGisUrl(product, locationParts) {
  const rawLatitude = getRawValue(product, "latitude", "lat");
  const rawLongitude = getRawValue(product, "longitude", "lng", "lon");

  const latitude =
    rawLatitude !== null && rawLatitude !== "" ? Number(rawLatitude) : NaN;

  const longitude =
    rawLongitude !== null && rawLongitude !== "" ? Number(rawLongitude) : NaN;

  const hasCoordinates =
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180;

  if (hasCoordinates) {
    return `https://2gis.kg/geo/${longitude},${latitude}`;
  }

  const addressParts = [product?.address, ...locationParts].filter(hasValue);

  const address = [
    ...new Set(addressParts.map((part) => String(part).trim())),
  ].join(", ");

  if (address) {
    return `https://2gis.kg/search/${encodeURIComponent(address)}`;
  }

  return null;
}
