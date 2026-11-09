/* =========================================================
   FEATURE KEYS
========================================================= */

export const featureKeys = [
  "series",
  "floor",
  "condition",
  "walls",
  "heating",
  "documents",
  "furniture",
  "offerType",
  "pets",

  "residentialComplex",

  "houseType",
  "floors",
  "sewerage",
  "water",
  "electricity",

  "purpose",
  "fence",
  "location",
  "terrain",

  "roomsInApartment",
  "privateBathroom",
  "roomLocation",

  "premisesType",
  "firstLine",
  "separateEntrance",
  "rentalBusiness",

  "ceilingHeight",
  "parkingType",
  "material",
  "security",
  "gates",
  "inspectionPit",
  "basement",
  "truckAccess",
  "gateType",

  "rentalPeriod",
];

export const arrayFilterKeys = [
  "amenities",
  "communications",
  "technicalParameters",
];

export const arrayFeatureKeys = [...featureKeys, ...arrayFilterKeys];

export const LONG_RENTAL_PERIODS = ["Помесячно", "На долгий срок"];
export const DAILY_RENTAL_PERIODS = ["Посуточно"];

const ROOMS_PROPERTY_TYPES = ["apartment", "house", "cottage", "room"];
const LOCATION_KEYS = ["country", "region", "city", "settlement", "district"];

function isFilled(value) {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value) && value !== "Все";
}

/* =========================================================
   FILTER CHANGES
   Убирает значения, которые перестали подходить к новому
   выбору: их полей уже не видно, а условие осталось бы в запросе.
========================================================= */

export function applyFilterChange(prev, key, value) {
  const next = { ...prev, [key]: value };

  if (key === "propertyType" && value !== prev.propertyType) {
    for (const featureKey of arrayFeatureKeys) {
      next[featureKey] = [];
    }

    next.rentPeriod = "";

    if (!ROOMS_PROPERTY_TYPES.includes(value)) {
      next.rooms = "Все";
    }
  }

  if (key === "dealType") {
    if (value === "rent") {
      next.documents = [];
      next.offerType = [];
    } else {
      next.rentalPeriod = [];
      next.rentPeriod = "";
      next.pets = [];
    }
  }

  if (key === "rentalPeriod" && isFilled(value)) {
    next.rentPeriod = "";
  }

  if (LOCATION_KEYS.includes(key) && isFilled(value)) {
    next.locationQuery = "";
  }

  return next;
}

export function applyFilterChanges(prev, changes) {
  return Object.entries(changes).reduce(
    (current, [key, value]) => applyFilterChange(current, key, value),
    prev,
  );
}
