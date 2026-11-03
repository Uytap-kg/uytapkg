"use client";

import Image from "next/image";

import {
  Home,
  Building2,
  Ruler,
  BedDouble,
  UserRound,
  Phone,
  ShieldCheck,
  Tag,
  Layers3,
  Flame,
  CarFront,
  Zap,
  Droplets,
  FileCheck,
  MapPin,
  Bath,
  Sofa,
  CheckCircle2,
  DoorOpen,
  Compass,
  LandPlot,
  Store,
  Map,
  PawPrint,
  CircleDollarSign,
  Waves,
} from "lucide-react";

import { useLanguage } from "@/context/LanguageContext";
import styles from "./ProductInfo.module.css";

/*
|--------------------------------------------------------------------------
| HELPERS
|--------------------------------------------------------------------------
*/

function normalize(value) {
  if (value === null || value === undefined) return "";

  return String(value).trim().toLowerCase().replace(/ё/g, "е");
}

function hasValue(value) {
  if (value === null || value === undefined) return false;

  if (typeof value === "string") {
    return value.trim() !== "";
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return true;
}

/*
|--------------------------------------------------------------------------
| RAW VALUE
|--------------------------------------------------------------------------
*/

function getRawValue(product, ...keys) {
  const raw = product?.rawFeatures || {};

  for (const key of keys) {
    if (hasValue(raw[key])) {
      return raw[key];
    }

    if (hasValue(product?.[key])) {
      return product[key];
    }
  }

  return null;
}

/*
|--------------------------------------------------------------------------
| FORMAT
|--------------------------------------------------------------------------
*/

function formatValue(value, t) {
  if (!hasValue(value)) {
    return null;
  }

  if (typeof value === "boolean") {
    return value ? t("productInfo.yes") : t("productInfo.no");
  }

  if (Array.isArray(value)) {
    const values = value
      .filter((item) => hasValue(item))
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
      .map(([key, item]) => {
        return `${formatFieldLabel(key, t)}: ${formatValue(item, t)}`;
      });

    return entries.length ? entries.join(", ") : null;
  }

  return String(value).trim();
}

function formatDistance(value, t) {
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

  if (formatted.includes("м")) {
    return formatted;
  }

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

/*
|--------------------------------------------------------------------------
| FIELD LABELS
|--------------------------------------------------------------------------
*/

function getFieldLabels(t) {
  return {
    type: t("productInfo.fields.type"),
    category: t("productInfo.fields.category"),

    property_type: t("productInfo.fields.propertyType"),
    propertyType: t("productInfo.fields.propertyType"),

    residentialComplex: t("productInfo.fields.residentialComplex"),
    residential_complex: t("productInfo.fields.residentialComplex"),
    residentialComplexName: t("productInfo.fields.residentialComplex"),
    residential_complex_name: t("productInfo.fields.residentialComplex"),
    complex: t("productInfo.fields.residentialComplex"),
    complexName: t("productInfo.fields.residentialComplex"),
    complex_name: t("productInfo.fields.residentialComplex"),
    zhk: t("productInfo.fields.residentialComplex"),
    zhkName: t("productInfo.fields.residentialComplex"),

    developer: t("productInfo.fields.developer"),
    developerName: t("productInfo.fields.developer"),
    developer_name: t("productInfo.fields.developer"),
    developerOrComplex: t("productInfo.fields.developerOrComplex"),
    developer_or_complex: t("productInfo.fields.developerOrComplex"),

    series: t("productInfo.fields.series"),
    apartmentSeries: t("productInfo.fields.series"),
    apartment_series: t("productInfo.fields.series"),

    rooms: t("productInfo.fields.rooms"),
    roomCount: t("productInfo.fields.rooms"),
    room_count: t("productInfo.fields.rooms"),

    area: t("productInfo.fields.area"),
    totalArea: t("productInfo.fields.totalArea"),
    total_area: t("productInfo.fields.totalArea"),

    landArea: t("productInfo.fields.landArea"),
    land_area: t("productInfo.fields.landArea"),
    areaSotka: t("productInfo.fields.landArea"),
    area_sotka: t("productInfo.fields.landArea"),
    plotArea: t("productInfo.fields.landArea"),
    plot_area: t("productInfo.fields.landArea"),

    floor: t("productInfo.fields.floor"),
    currentFloor: t("productInfo.fields.floor"),
    current_floor: t("productInfo.fields.floor"),

    floors: t("productInfo.fields.floors"),
    totalFloors: t("productInfo.fields.floors"),
    total_floors: t("productInfo.fields.floors"),

    condition: t("productInfo.fields.condition"),
    repair: t("productInfo.fields.repair"),

    walls: t("productInfo.fields.walls"),
    wallMaterial: t("productInfo.fields.walls"),
    wall_material: t("productInfo.fields.walls"),

    heating: t("productInfo.fields.heating"),
    sewerage: t("productInfo.fields.sewerage"),
    water: t("productInfo.fields.water"),
    electricity: t("productInfo.fields.electricity"),
    gas: t("productInfo.fields.gas"),

    documents: t("productInfo.fields.documents"),
    furniture: t("productInfo.fields.furniture"),

    bathroom: t("productInfo.fields.bathroom"),
    bathrooms: t("productInfo.fields.bathrooms"),
    bathroomCount: t("productInfo.fields.bathrooms"),
    bathroom_count: t("productInfo.fields.bathrooms"),
    privateBathroom: t("productInfo.fields.privateBathroom"),
    private_bathroom: t("productInfo.fields.privateBathroom"),

    ceilingHeight: t("productInfo.fields.ceilingHeight"),
    ceiling_height: t("productInfo.fields.ceilingHeight"),

    parking: t("productInfo.fields.parking"),
    parkingType: t("productInfo.fields.parkingType"),
    parking_type: t("productInfo.fields.parkingType"),

    view: t("productInfo.fields.view"),
    orientation: t("productInfo.fields.orientation"),

    purpose: t("productInfo.fields.purpose"),
    fence: t("productInfo.fields.fence"),
    terrain: t("productInfo.fields.terrain"),
    communications: t("productInfo.fields.communications"),
    landLocation: t("productInfo.fields.landLocation"),
    land_location: t("productInfo.fields.landLocation"),

    houseType: t("productInfo.fields.houseType"),
    house_type: t("productInfo.fields.houseType"),

    roomsInApartment: t("productInfo.fields.roomsInApartment"),
    rooms_in_apartment: t("productInfo.fields.roomsInApartment"),

    roomLocation: t("productInfo.fields.roomLocation"),
    room_location: t("productInfo.fields.roomLocation"),

    premisesType: t("productInfo.fields.premisesType"),
    premises_type: t("productInfo.fields.premisesType"),

    technicalParameters: t("productInfo.fields.technicalParameters"),
    technical_parameters: t("productInfo.fields.technicalParameters"),

    firstLine: t("productInfo.fields.firstLine"),
    first_line: t("productInfo.fields.firstLine"),

    separateEntrance: t("productInfo.fields.separateEntrance"),
    separate_entrance: t("productInfo.fields.separateEntrance"),

    rentalBusiness: t("productInfo.fields.rentalBusiness"),
    rental_business: t("productInfo.fields.rentalBusiness"),

    material: t("productInfo.fields.material"),

    gates: t("productInfo.fields.gates"),
    gateType: t("productInfo.fields.gateType"),
    gate_type: t("productInfo.fields.gateType"),

    truckAccess: t("productInfo.fields.truckAccess"),
    truck_access: t("productInfo.fields.truckAccess"),

    offerType: t("productInfo.fields.offerType"),
    offer_type: t("productInfo.fields.offerType"),

    pets: t("productInfo.fields.pets"),

    construction: t("productInfo.fields.construction"),
    constructionType: t("productInfo.fields.construction"),
    construction_type: t("productInfo.fields.construction"),

    beachDistance: t("productInfo.fields.beachDistance"),
    beach_distance: t("productInfo.fields.beachDistance"),

    entrances: t("productInfo.fields.entrances"),
    entranceCount: t("productInfo.fields.entrances"),
    entrance_count: t("productInfo.fields.entrances"),

    yardArea: t("productInfo.fields.yardArea"),
    yard_area: t("productInfo.fields.yardArea"),

    landWidth: t("productInfo.fields.landWidth"),
    land_width: t("productInfo.fields.landWidth"),

    landLength: t("productInfo.fields.landLength"),
    land_length: t("productInfo.fields.landLength"),

    dealType: t("productInfo.fields.dealType"),
    deal_type: t("productInfo.fields.dealType"),

    rentalPeriod: t("productInfo.fields.rentalPeriod"),
    rental_period: t("productInfo.fields.rentalPeriod"),

    amenities: t("productInfo.fields.amenities"),

    country: t("productInfo.fields.country"),
    region: t("productInfo.fields.region"),
    city: t("productInfo.fields.city"),
    settlement: t("productInfo.fields.settlement"),
    district: t("productInfo.fields.district"),
    address: t("productInfo.fields.address"),
  };
}

/*
|--------------------------------------------------------------------------
| FIELD LABEL
|--------------------------------------------------------------------------
*/

function formatFieldLabel(key, t) {
  if (!key) return "";

  const fieldLabels = getFieldLabels(t);

  if (fieldLabels[key]) {
    return fieldLabels[key];
  }

  return String(key)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

/*
|--------------------------------------------------------------------------
| FIELD ICON
|--------------------------------------------------------------------------
*/

function getFieldIcon(key) {
  const normalized = normalize(key);

  if (
    normalized.includes("complex") ||
    normalized.includes("zhk") ||
    normalized.includes("developer")
  ) {
    return Building2;
  }

  if (normalized.includes("room")) {
    return BedDouble;
  }

  if (
    normalized.includes("area") ||
    normalized.includes("square") ||
    normalized.includes("площад")
  ) {
    return Ruler;
  }

  if (normalized.includes("floor")) {
    return Layers3;
  }

  if (normalized.includes("heating") || normalized.includes("отоп")) {
    return Flame;
  }

  if (
    normalized.includes("water") ||
    normalized.includes("вода") ||
    normalized.includes("sewer")
  ) {
    return Droplets;
  }

  if (normalized.includes("electric") || normalized.includes("электр")) {
    return Zap;
  }

  if (normalized.includes("document")) {
    return FileCheck;
  }

  if (normalized.includes("parking") || normalized.includes("garage")) {
    return CarFront;
  }

  if (normalized.includes("bath") || normalized.includes("сануз")) {
    return Bath;
  }

  if (normalized.includes("furniture") || normalized.includes("мебел")) {
    return Sofa;
  }

  if (normalized.includes("wall") || normalized.includes("material")) {
    return Building2;
  }

  if (normalized.includes("house") || normalized.includes("дом")) {
    return Home;
  }

  if (normalized.includes("land") || normalized.includes("участ")) {
    return LandPlot;
  }

  if (normalized.includes("entrance") || normalized.includes("вход")) {
    return DoorOpen;
  }

  if (normalized.includes("view") || normalized.includes("orientation")) {
    return Compass;
  }

  if (normalized.includes("beach") || normalized.includes("пляж")) {
    return Waves;
  }

  if (normalized.includes("pet") || normalized.includes("живот")) {
    return PawPrint;
  }

  if (normalized.includes("offer") || normalized.includes("deal")) {
    return CircleDollarSign;
  }

  return Tag;
}

/*
|--------------------------------------------------------------------------
| CATEGORY
|--------------------------------------------------------------------------
*/

function getCategoryKey(product) {
  const rawCategory = normalize(
    getRawValue(product, "property_type", "propertyType", "category", "type"),
  );

  if (rawCategory.includes("квартир")) {
    return "apartment";
  }

  if (rawCategory.includes("коттедж")) {
    return "cottage";
  }

  if (rawCategory.includes("дом") || rawCategory.includes("особняк")) {
    return "house";
  }

  if (rawCategory.includes("участ") || rawCategory.includes("зем")) {
    return "land";
  }

  if (rawCategory.includes("комнат") || rawCategory.includes("комната")) {
    return "room";
  }

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

/*
|--------------------------------------------------------------------------
| CATEGORY CONFIG
|--------------------------------------------------------------------------
*/

function getCategoryConfig(t) {
  return {
    apartment: [
      ["series", t("productInfo.fields.series"), Tag],
      ["rooms", t("productInfo.fields.rooms"), BedDouble],
      ["area", t("productInfo.fields.area"), Ruler],
      ["floor", t("productInfo.fields.floor"), Layers3],
      ["floors", t("productInfo.fields.floors"), Layers3],
      ["condition", t("productInfo.fields.condition"), Home],
      ["walls", t("productInfo.fields.walls"), Building2],
      ["heating", t("productInfo.fields.heating"), Flame],
      ["furniture", t("productInfo.fields.furniture"), Sofa],
      ["bathroom", t("productInfo.fields.bathroom"), Bath],
      ["bathrooms", t("productInfo.fields.bathrooms"), Bath],
      ["ceilingHeight", t("productInfo.fields.ceilingHeight"), Ruler],
      ["view", t("productInfo.fields.view"), Compass],
      ["orientation", t("productInfo.fields.orientation"), Compass],
      ["parking", t("productInfo.fields.parking"), CarFront],
      ["documents", t("productInfo.fields.documents"), FileCheck],
      ["offerType", t("productInfo.fields.offerType"), CircleDollarSign],
    ],

    house: [
      ["houseType", t("productInfo.fields.houseType"), Home],
      ["area", t("productInfo.fields.area"), Ruler],
      ["landArea", t("productInfo.fields.landArea"), LandPlot],
      ["floors", t("productInfo.fields.floors"), Layers3],
      ["rooms", t("productInfo.fields.rooms"), BedDouble],
      ["heating", t("productInfo.fields.heating"), Flame],
      ["sewerage", t("productInfo.fields.sewerage"), Droplets],
      ["water", t("productInfo.fields.water"), Droplets],
      ["electricity", t("productInfo.fields.electricity"), Zap],
      ["gas", t("productInfo.fields.gas"), Flame],
      ["bathrooms", t("productInfo.fields.bathrooms"), Bath],
      ["parking", t("productInfo.fields.parking"), CarFront],
      ["documents", t("productInfo.fields.documents"), FileCheck],
      ["offerType", t("productInfo.fields.offerType"), CircleDollarSign],
    ],

    cottage: [
      ["houseType", t("productInfo.fields.type"), Home],
      ["area", t("productInfo.fields.area"), Ruler],
      ["landArea", t("productInfo.fields.landArea"), LandPlot],
      ["floors", t("productInfo.fields.floors"), Layers3],
      ["rooms", t("productInfo.fields.rooms"), BedDouble],
      ["heating", t("productInfo.fields.heating"), Flame],
      ["sewerage", t("productInfo.fields.sewerage"), Droplets],
      ["water", t("productInfo.fields.water"), Droplets],
      ["electricity", t("productInfo.fields.electricity"), Zap],
      ["gas", t("productInfo.fields.gas"), Flame],
      ["bathrooms", t("productInfo.fields.bathrooms"), Bath],
      ["parking", t("productInfo.fields.parking"), CarFront],
      ["documents", t("productInfo.fields.documents"), FileCheck],
      ["offerType", t("productInfo.fields.offerType"), CircleDollarSign],
    ],

    land: [
      ["purpose", t("productInfo.fields.purpose"), Map],
      ["landArea", t("productInfo.fields.landArea"), LandPlot],
      ["fence", t("productInfo.fields.fence"), LandPlot],
      ["landLocation", t("productInfo.fields.landLocation"), MapPin],
      ["terrain", t("productInfo.fields.terrain"), Compass],
      ["communications", t("productInfo.fields.communications"), Zap],
      ["water", t("productInfo.fields.water"), Droplets],
      ["electricity", t("productInfo.fields.electricity"), Zap],
      ["gas", t("productInfo.fields.gas"), Flame],
      ["documents", t("productInfo.fields.documents"), FileCheck],
      ["offerType", t("productInfo.fields.offerType"), CircleDollarSign],
    ],

    room: [
      ["roomLocation", t("productInfo.fields.roomLocation"), MapPin],
      ["area", t("productInfo.fields.area"), Ruler],
      ["roomsInApartment", t("productInfo.fields.roomsInApartment"), BedDouble],
      ["floor", t("productInfo.fields.floor"), Layers3],
      ["floors", t("productInfo.fields.floors"), Layers3],
      ["condition", t("productInfo.fields.condition"), Home],
      ["walls", t("productInfo.fields.walls"), Building2],
      ["heating", t("productInfo.fields.heating"), Flame],
      ["privateBathroom", t("productInfo.fields.privateBathroom"), Bath],
      ["furniture", t("productInfo.fields.furniture"), Sofa],
      ["documents", t("productInfo.fields.documents"), FileCheck],
      ["offerType", t("productInfo.fields.offerType"), CircleDollarSign],
    ],

    commercial: [
      ["area", t("productInfo.fields.area"), Ruler],
      ["floor", t("productInfo.fields.floor"), Layers3],
      ["condition", t("productInfo.fields.condition"), Home],
      ["walls", t("productInfo.fields.walls"), Building2],
      ["heating", t("productInfo.fields.heating"), Flame],
      ["premisesType", t("productInfo.fields.premisesType"), Store],
      ["technicalParameters", t("productInfo.fields.technicalParameters"), Tag],
      ["firstLine", t("productInfo.fields.firstLine"), Store],
      ["separateEntrance", t("productInfo.fields.separateEntrance"), DoorOpen],
      ["rentalBusiness", t("productInfo.fields.rentalBusiness"), Store],
      ["parking", t("productInfo.fields.parking"), CarFront],
      ["documents", t("productInfo.fields.documents"), FileCheck],
      ["offerType", t("productInfo.fields.offerType"), CircleDollarSign],
    ],

    parking: [
      ["area", t("productInfo.fields.area"), Ruler],
      ["ceilingHeight", t("productInfo.fields.ceilingHeight"), Ruler],
      ["parkingType", t("productInfo.fields.parkingType"), CarFront],
      ["material", t("productInfo.fields.material"), Building2],
      ["gates", t("productInfo.fields.gates"), DoorOpen],
      ["truckAccess", t("productInfo.fields.truckAccess"), CarFront],
      ["gateType", t("productInfo.fields.gateType"), DoorOpen],
      ["documents", t("productInfo.fields.documents"), FileCheck],
      ["offerType", t("productInfo.fields.offerType"), CircleDollarSign],
    ],
  };
}

/*
|--------------------------------------------------------------------------
| SERIES
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| RENT
|--------------------------------------------------------------------------
*/

function isRent(product) {
  const dealType = normalize(getRawValue(product, "dealType", "deal_type"));

  return (
    dealType.includes("аренд") ||
    dealType.includes("сним") ||
    dealType === "rent"
  );
}

/*
|--------------------------------------------------------------------------
| CHARACTERISTICS
|--------------------------------------------------------------------------
*/

function buildCharacteristics(product, t) {
  const categoryKey = getCategoryKey(product);
  const categoryConfig = getCategoryConfig(t);
  const config = categoryConfig[categoryKey] || [];

  const rent = isRent(product);

  const result = [];
  const usedKeys = new Set();

  const addCharacteristic = (key, label, Icon, value) => {
    if (!hasValue(value)) return;

    const formatted = formatValue(value, t);

    if (!formatted) return;

    if (usedKeys.has(key)) return;

    usedKeys.add(key);

    result.push({
      key,
      label,
      value: formatted,
      icon: Icon || getFieldIcon(key),
    });
  };

  /*
   * --------------------------------------------------------
   * CATEGORY FIELDS
   * --------------------------------------------------------
   */

  for (const [key, label, Icon] of config) {
    if (rent && (key === "documents" || key === "offerType")) {
      continue;
    }

    let value = getRawValue(product, key);

    if (!hasValue(value)) {
      continue;
    }

    if (key === "series") {
      value = formatSeries(value, t);
    }

    if (key === "ceilingHeight") {
      value = formatHeight(value, t);
    }

    if (key === "area") {
      value = formatArea(value, t);
    }

    if (key === "landArea" || key === "areaSotka" || key === "plotArea") {
      value = formatArea(value, t, true);
    }

    addCharacteristic(key, label, Icon, value);
  }

  /*
   * --------------------------------------------------------
   * RESIDENTIAL COMPLEX
   * --------------------------------------------------------
   */

  const complex = getRawValue(
    product,
    "residentialComplex",
    "residential_complex",
    "residentialComplexName",
    "residential_complex_name",
    "complex",
    "complexName",
    "complex_name",
    "zhk",
    "zhkName",
  );

  if (hasValue(complex)) {
    result.unshift({
      key: "residentialComplex",
      label: t("productInfo.fields.residentialComplex"),
      value: formatValue(complex, t),
      icon: Building2,
    });

    usedKeys.add("residentialComplex");
    usedKeys.add("residential_complex");
    usedKeys.add("residentialComplexName");
    usedKeys.add("residential_complex_name");
    usedKeys.add("complex");
    usedKeys.add("complexName");
    usedKeys.add("complex_name");
    usedKeys.add("zhk");
    usedKeys.add("zhkName");
  }

  /*
   * --------------------------------------------------------
   * DEVELOPER
   * --------------------------------------------------------
   */

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
      Building,
      developer,
    );

    usedKeys.add("developerName");
    usedKeys.add("developer_name");
  }

  /*
   * --------------------------------------------------------
   * PETS
   * --------------------------------------------------------
   */

  if (categoryKey === "apartment" && rent) {
    const pets = getRawValue(product, "pets");

    if (hasValue(pets)) {
      addCharacteristic("pets", t("productInfo.fields.pets"), PawPrint, pets);
    }
  }

  /*
   * --------------------------------------------------------
   * GENERIC RAW FEATURES
   * --------------------------------------------------------
   */

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
      ].includes(key)
    ) {
      return;
    }

    if (usedKeys.has(key)) {
      return;
    }

    if (!hasValue(value)) {
      return;
    }

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
      key === "landArea" ||
      key === "land_area" ||
      key === "areaSotka" ||
      key === "area_sotka" ||
      key === "plotArea" ||
      key === "plot_area"
    ) {
      formattedValue = formatArea(value, t, true);
    }

    addCharacteristic(
      key,
      formatFieldLabel(key, t),
      getFieldIcon(key),
      formattedValue,
    );
  });

  return result;
}

/*
|--------------------------------------------------------------------------
| AMENITIES
|--------------------------------------------------------------------------
*/

function getAmenities(product) {
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

  if (hasValue(value)) {
    return [String(value)];
  }

  return [];
}

/*
|--------------------------------------------------------------------------
| LOCATION
|--------------------------------------------------------------------------
*/

function getLocationParts(product) {
  const city = String(
    getRawValue(product, "city") || product?.city || "",
  ).trim();
  const region = String(
    getRawValue(product, "region") || product?.region || "",
  ).trim();
  const district = String(
    getRawValue(product, "district") || product?.district || "",
  ).trim();
  const settlement = String(
    getRawValue(product, "settlement") || product?.settlement || "",
  ).trim();

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

  if (parts.length > 0) {
    return parts;
  }

  if (product?.location && product.location !== "Кыргызстан") {
    return [product.location];
  }

  if (product?.address && String(product.address).trim()) {
    return [String(product.address).trim()];
  }

  return [];
}

function getLocationDetails(product, t) {
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

/*
|--------------------------------------------------------------------------
| COMPONENT
|--------------------------------------------------------------------------
*/

export default function ProductInfo({ product, router }) {
  const { t } = useLanguage();

  const characteristics = buildCharacteristics(product, t);

  const amenities = getAmenities(product);

  const locationParts = getLocationParts(product);
  const locationDetails = getLocationDetails(product, t);

  const beachDistance = getRawValue(product, "beachDistance", "beach_distance");

  const category = getRawValue(product, "category");

  const type = getRawValue(product, "type", "propertyType", "property_type");

  const dealType = getRawValue(product, "dealType", "deal_type");

  const rentalPeriod = getRawValue(product, "rentalPeriod", "rental_period");

  const listingType = getRawValue(product, "listingType", "listing_type");

  const createdAt = getRawValue(product, "createdAt", "created_at");

  return (
    <div className={styles.contentGrid}>
      <div className={styles.mainContent}>
        {/* DESCRIPTION */}

        {(product.description || product.title) && (
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div className={styles.sectionIcon}>
                <Home />
              </div>

              <div>
                <span>{t("productInfo.sections.about")}</span>
                <h2>{t("productInfo.sections.description")}</h2>
              </div>
            </div>

            <p className={styles.description}>
              {product.description || t("productInfo.descriptionNotSpecified")}
            </p>
          </section>
        )}

        {/* CHARACTERISTICS */}

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionIcon}>
              <Building2 />
            </div>

            <div>
              <span>{t("productInfo.sections.details")}</span>
              <h2>{t("productInfo.sections.characteristics")}</h2>
            </div>
          </div>

          {characteristics.length > 0 ? (
            <div className={styles.characteristics}>
              {characteristics.map((item) => {
                const Icon = item.icon;

                return (
                  <div className={styles.characteristic} key={item.key}>
                    <div className={styles.characteristicIcon}>
                      <Icon size={19} />
                    </div>

                    <div>
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={styles.emptyBlock}>
              <CheckCircle2 size={20} />
              <span>
                {t("productInfo.additionalCharacteristicsNotSpecified")}
              </span>
            </div>
          )}
        </section>

        {/* AMENITIES */}

        {amenities.length > 0 && (
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div className={styles.sectionIcon}>
                <ShieldCheck />
              </div>

              <div>
                <span>{t("productInfo.sections.additional")}</span>
                <h2>{t("productInfo.sections.amenities")}</h2>
              </div>
            </div>

            <div className={styles.amenities}>
              {amenities.map((item, index) => (
                <div className={styles.amenity} key={`${item}-${index}`}>
                  <CheckCircle2 size={17} />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* LOCATION */}

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionIcon}>
              <MapPin />
            </div>

            <div>
              <span>{t("productInfo.sections.location")}</span>
              <h2>{t("productInfo.sections.address")}</h2>
            </div>
          </div>

          <div className={styles.addressCard}>
            <div className={styles.addressIcon}>
              <MapPin />
            </div>

            <div className={styles.addressContent}>
              <strong>
                {locationParts.length
                  ? locationParts.join(", ")
                  : t("productInfo.locationNotSpecified")}
              </strong>

              {product.address && !locationParts.includes(product.address) && (
                <p>{product.address}</p>
              )}

              {product.latitude != null && product.longitude != null && (
                <div className={styles.coordinates}>
                  <Compass size={14} />
                  {t("productInfo.coordinatesSpecified")}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* SIDEBAR */}

      <aside className={styles.sidebar}>
        {/* INFORMATION */}

        <div className={styles.sideCard}>
          <div className={styles.sideTop}>
            <Tag />
            <span>{t("productInfo.sidebar.information")}</span>
          </div>

          {hasValue(category) && (
            <div className={styles.sideRow}>
              <span>{t("productInfo.fields.category")}</span>
              <strong>{formatValue(category, t)}</strong>
            </div>
          )}

          {hasValue(type) && (
            <div className={styles.sideRow}>
              <span>{t("productInfo.fields.type")}</span>
              <strong>{formatValue(type, t)}</strong>
            </div>
          )}

          {hasValue(dealType) && (
            <div className={styles.sideRow}>
              <span>{t("productInfo.fields.dealType")}</span>
              <strong>{formatValue(dealType, t)}</strong>
            </div>
          )}

          {hasValue(rentalPeriod) && (
            <div className={styles.sideRow}>
              <span>{t("productInfo.fields.rentalPeriod")}</span>
              <strong>{formatValue(rentalPeriod, t)}</strong>
            </div>
          )}

          {hasValue(listingType) && (
            <div className={styles.sideRow}>
              <span>{t("productInfo.fields.listingType")}</span>
              <strong>{formatValue(listingType, t)}</strong>
            </div>
          )}

          {hasValue(createdAt) && (
            <div className={styles.sideRow}>
              <span>{t("productInfo.fields.publicationDate")}</span>
              <strong>{formatValue(createdAt, t)}</strong>
            </div>
          )}

          {hasValue(beachDistance) && (
            <div className={styles.sideRow}>
              <span>{t("productInfo.fields.beachDistance")}</span>
              <strong>{formatDistance(beachDistance, t)}</strong>
            </div>
          )}
        </div>

        {/* LOCATION */}

        {locationDetails.length > 0 && (
          <div className={styles.sideCard}>
            <div className={styles.sideTop}>
              <MapPin />
              <span>{t("productInfo.sidebar.location")}</span>
            </div>

            {locationDetails.map((item, index) => (
              <div className={styles.sideRow} key={`${item.label}-${index}`}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        )}

        {/* OWNER */}

        {product.owner && (
          <div className={styles.ownerSideCard}>
            <div className={styles.ownerSideHeader}>
              <UserRound />
              {t("productInfo.owner.title")}
            </div>

            <div className={styles.ownerSideProfile}>
              <div className={styles.ownerSideAvatar}>
                <Image
                  src={
                    product.owner.avatar || "https://i.pravatar.cc/150?img=12"
                  }
                  alt={product.owner.name || t("productInfo.owner.title")}
                  fill
                  sizes="55px"
                />
              </div>

              <div>
                <strong>{product.owner.name}</strong>

                <span>
                  {product.owner.role || t("productInfo.owner.defaultRole")}
                </span>
              </div>
            </div>

            {product.owner.phone && (
              <a
                href={`https://wa.me/${String(product.owner.phone).replace(/\D/g, "")}?text=${encodeURIComponent(
                  `Здравствуйте! Я пишу вам по поводу вашего объявления на сайте uytap.kg. Подскажите, пожалуйста, оно ещё актуально?`,
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.phoneButton}
              >
                <Phone size={16} />
                {product.owner.phone}
              </a>
            )}
            
            {product.owner.id && (
              <button
                type="button"
                onClick={() =>
                  router.push(`/public-profile/${product.owner.id}`)
                }
              >
                {t("productInfo.owner.contact")}
              </button>
            )}
          </div>
        )}

        {/* LAWYER */}

        <div className={styles.lawyerCard}>
          <div className={styles.lawyerIcon}>
            <ShieldCheck size={22} />
          </div>

          <div className={styles.lawyerContent}>
            <strong>{t("productInfo.lawyer.title")}</strong>

            <p>{t("productInfo.lawyer.description")}</p>
          </div>

          <button
            type="button"
            className={styles.lawyerButton}
            onClick={() => router.push("/lawyers")}
          >
            {t("productInfo.lawyer.button")}
          </button>
        </div>
      </aside>
    </div>
  );
}
