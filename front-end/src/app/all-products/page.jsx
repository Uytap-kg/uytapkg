"use client";

import { Home } from "lucide-react";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useLanguage } from "@/context/LanguageContext";

import {
  getListings,
  getFavorites,
  addFavorite,
  removeFavorite,
} from "@/utils/api";

import { mapListingData, formatRegion } from "@/utils/mapListingData";

import ApartmentFilters from "./components/ApartmentFilters/ApartmentFilters";
import HouseFilters from "./components/HouseFilters/HouseFilters";
import CottageFilters from "./components/CottageFilters/CottageFilters";
import LandFilters from "./components/LandFilters/LandFilters";
import RoomFilters from "./components/RoomFilters/RoomFilters";
import CommercialFilters from "./components/CommercialFilters/CommercialFilters";
import ParkingFilters from "./components/ParkingFilters/ParkingFilters";

import ProductsFilters from "./components/ProductsFilters/ProductsFilters";
import ProductsResults from "./components/ProductsResults/ProductsResults";

import styles from "./AllProducts.module.css";
import Footer from "@/components/pageComponents/footer/Footer";

/* =========================================================
   CATEGORIES
========================================================= */

const categories = [
  {
    value: "apartment",
    labelKey: "allProducts.categories.apartment",
  },
  {
    value: "house",
    labelKey: "allProducts.categories.house",
  },
  {
    value: "cottage",
    labelKey: "allProducts.categories.cottage",
  },
  {
    value: "land",
    labelKey: "allProducts.categories.land",
  },
  {
    value: "room",
    labelKey: "allProducts.categories.room",
  },
  {
    value: "commercial",
    labelKey: "allProducts.categories.commercial",
  },
  {
    value: "parking",
    labelKey: "allProducts.categories.parking",
  },
];

const categoryComponents = {
  apartment: ApartmentFilters,
  house: HouseFilters,
  cottage: CottageFilters,
  land: LandFilters,
  room: RoomFilters,
  commercial: CommercialFilters,
  parking: ParkingFilters,
};

/* =========================================================
   API MAPS
========================================================= */

const categoryApiMap = {
  apartment: "Квартира",
  house: "Дом",
  cottage: "Коттедж",
  land: "Участок",
  room: "Комнаты",
  commercial: "Коммерция",
  parking: "Паркинг/гараж",
};

const dealApiMap = {
  sale: "Продажа",
  rent: "Сниму в аренду",
};

/* =========================================================
   DEFAULT FILTERS
========================================================= */

const DEFAULT_FILTERS = {
  propertyType: "apartment",
  dealType: "sale",

  city: "Все",
  region: "",
  country: "",
  district: "",
  searchQuery: "",

  currency: "USD",

  priceFrom: "",
  priceTo: "",

  areaFrom: "",
  areaTo: "",

  rooms: "Все",

  beachDistanceFrom: "",
  beachDistanceTo: "",

  urgentOnly: false,

  series: [],
  floor: [],
  condition: [],
  walls: [],
  heating: [],
  documents: [],
  furniture: [],
  offerType: [],

  residentialComplex: [],

  rentalPeriod: [],

  amenities: [],
  communications: [],
  technicalParameters: [],
};

/* =========================================================
   FEATURE KEYS
========================================================= */

const featureKeys = [
  "series",
  "floor",
  "condition",
  "walls",
  "heating",
  "documents",
  "furniture",
  "offerType",

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

const arrayFeatureKeys = [
  "series",
  "floor",
  "condition",
  "walls",
  "heating",
  "documents",
  "furniture",
  "offerType",

  "residentialComplex",

  "rentalPeriod",

  "amenities",
  "communications",
  "technicalParameters",
];

const arrayFilterKeys = ["amenities", "communications", "technicalParameters"];

const ignoredUrlKeys = [
  "propertyType",
  "category",
  "dealType",

  "city",
  "settlement",
  "region",
  "country",
  "district",

  "currency",

  "priceFrom",
  "priceTo",

  "areaFrom",
  "areaTo",

  "rooms",

  "beachDistanceFrom",
  "beachDistanceTo",

  "urgentOnly",
  "searchQuery",

  ...arrayFeatureKeys,
];

/* =========================================================
   ISSYK-KUL
========================================================= */

const ISSYK_KUL_CITIES = [
  "каракол",
  "чолпон-ата",
  "чолпоната",
  "бостери",
  "тамчы",
  "чон-сары-ой",
  "чон сары ой",
  "чоң-сары-ой",
  "сары-ой",
  "сары ой",
  "боконбаево",
  "барскоон",
  "тамга",
  "каджи-сай",
  "каджисай",
  "тосор",
  "ананьево",
  "пристань-пржевальск",
  "рыбачье",
  "балыкчы",
  "иссык-куль",
  "иссыккуль",
  "семеновка",
  "семеновское",
  "григорьевка",
  "курменты",
  "каракуль",
  "дархан",
  "тюп",
  "кызыл-суу",
  "покровка",
];

function normalizeLocationValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function getWordStem(word) {
  const clean = String(word || "")
    .toLowerCase()
    .replace(/[^a-zа-яёөүң0-9]/g, "");
  if (clean.length <= 3) return clean;
  return clean.replace(
    /(ый|ий|ое|ее|ая|яя|ые|ие|ом|ем|ым|им|ой|ей|ам|ям|ах|ях|ов|ев|ей|ок|ек|ул|у|ю|а|я|е|о|ы|и|дор|дөр|тор|төр|лор|лөр|дар|дер)$/g,
    "",
  );
}

function isIssykKulValue(value) {
  const normalized = normalizeLocationValue(value);

  if (!normalized) {
    return false;
  }

  if (
    normalized === "issyk kul" ||
    normalized === "issyk kul oblast" ||
    normalized === "issyk kul region" ||
    normalized.includes("issyk kul")
  ) {
    return true;
  }

  if (normalized.includes("иссык куль") || normalized.includes("иссыккуль")) {
    return true;
  }

  return false;
}

function isIssykKulLocation(filters) {
  const city = normalizeLocationValue(filters?.city);
  const region = normalizeLocationValue(filters?.region);
  const country = normalizeLocationValue(filters?.country);
  const district = normalizeLocationValue(filters?.district);

  if (isIssykKulValue(region)) {
    return true;
  }

  if (isIssykKulValue(city)) {
    return true;
  }

  if (
    city &&
    ISSYK_KUL_CITIES.some((name) => {
      const normalizedName = normalizeLocationValue(name);

      return (
        city === normalizedName ||
        city.includes(normalizedName) ||
        normalizedName.includes(city)
      );
    })
  ) {
    return true;
  }

  if (isIssykKulValue(district)) {
    return true;
  }

  if (isIssykKulValue(country)) {
    return true;
  }

  return false;
}

/* =========================================================
   NORMALIZERS
========================================================= */

function normalizePropertyType(value) {
  if (!value) {
    return "apartment";
  }

  if (categoryComponents[value]) {
    return value;
  }

  const found = Object.keys(categoryApiMap).find(
    (key) =>
      String(categoryApiMap[key]).toLowerCase() === String(value).toLowerCase(),
  );

  return found || "apartment";
}

function normalizeDealType(value) {
  if (!value) {
    return "sale";
  }

  if (value === "Продажа") {
    return "sale";
  }

  if (value === "Сниму в аренду") {
    return "rent";
  }

  return value === "rent" ? "rent" : "sale";
}

function normalizeArrayValue(value) {
  if (Array.isArray(value)) {
    return value.filter(
      (item) =>
        item !== undefined && item !== null && String(item).trim() !== "",
    );
  }

  if (value === undefined || value === null || String(value).trim() === "") {
    return [];
  }

  return [value];
}

function matchesMultiValue(selected, itemValue) {
  const selectedValues = normalizeArrayValue(selected);

  if (selectedValues.length === 0) {
    return true;
  }

  const itemValues = normalizeArrayValue(itemValue);

  if (itemValues.length === 0) {
    return false;
  }

  const normalizedSelected = selectedValues.map((value) =>
    String(value).trim().toLowerCase(),
  );

  const normalizedItem = itemValues.map((value) =>
    String(value).trim().toLowerCase(),
  );

  return normalizedSelected.some((selectedValue) =>
    normalizedItem.some(
      (itemValue) =>
        itemValue === selectedValue ||
        itemValue.includes(selectedValue) ||
        selectedValue.includes(itemValue),
    ),
  );
}

function matchesArrayFilter(selected, itemValue) {
  const selectedValues = normalizeArrayValue(selected);

  if (selectedValues.length === 0) {
    return true;
  }

  const itemValues = normalizeArrayValue(itemValue);

  if (itemValues.length === 0) {
    return false;
  }

  const normalizedItem = itemValues.map((value) =>
    String(value).trim().toLowerCase(),
  );

  return selectedValues.every((selectedValue) => {
    const normalizedSelected = String(selectedValue).trim().toLowerCase();

    return normalizedItem.some(
      (itemValue) =>
        itemValue === normalizedSelected ||
        itemValue.includes(normalizedSelected),
    );
  });
}

/* =========================================================
   COMPONENT
========================================================= */

export default function AllProducts() {
  useEffect(() => {
    document.title =
      "Все объявления по недвижимости в Кыргызстане — Купить и снять | UyTap";
  }, []);

  const { t } = useLanguage();

  const router = useRouter();
  const searchParams = useSearchParams();

  const [searchMode, setSearchMode] = useState("filters");

  const [filters, setFilters] = useState(DEFAULT_FILTERS);

  const [listingsList, setListingsList] = useState([]);

  const [favIds, setFavIds] = useState(new Set());

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");

  /* =======================================================
     TRANSLATED CATEGORIES
  ======================================================= */

  const translatedCategories = useMemo(
    () =>
      categories.map((category) => ({
        value: category.value,
        label: t(category.labelKey),
      })),
    [t],
  );

  const categoryLabels = useMemo(
    () => ({
      apartment: t("allProducts.categories.apartment"),
      house: t("allProducts.categories.house"),
      cottage: t("allProducts.categories.cottage"),
      land: t("allProducts.categories.land"),
      room: t("allProducts.categories.room"),
      commercial: t("allProducts.categories.commercial"),
      parking: t("allProducts.categories.parking"),
    }),
    [t],
  );

  /* =======================================================
     URL → FILTERS
  ======================================================= */

  useEffect(() => {
    const propertyType = normalizePropertyType(
      searchParams.get("propertyType") || searchParams.get("category"),
    );

    const dealType = normalizeDealType(searchParams.get("dealType"));

    const parseArrayParam = (key) => {
      const value = searchParams.get(key);

      if (!value) {
        return [];
      }

      return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    };

    const nextFilters = {
      ...DEFAULT_FILTERS,

      propertyType,
      dealType,

      city: searchParams.get("city") || searchParams.get("settlement") || "Все",

      region: searchParams.get("region") || "",

      country: searchParams.get("country") || "",

      district: searchParams.get("district") || "",

      searchQuery: searchParams.get("searchQuery") || "",

      currency: searchParams.get("currency") || "USD",

      priceFrom: searchParams.get("priceFrom") || "",

      priceTo: searchParams.get("priceTo") || "",

      areaFrom: searchParams.get("areaFrom") || "",

      areaTo: searchParams.get("areaTo") || "",

      rooms: searchParams.get("rooms") || "Все",

      beachDistanceFrom: searchParams.get("beachDistanceFrom") || "",

      beachDistanceTo: searchParams.get("beachDistanceTo") || "",

      urgentOnly: searchParams.get("urgentOnly") === "true",

      series: parseArrayParam("series"),

      floor: parseArrayParam("floor"),

      condition: parseArrayParam("condition"),

      walls: parseArrayParam("walls"),

      heating: parseArrayParam("heating"),

      documents: parseArrayParam("documents"),

      furniture: parseArrayParam("furniture"),

      offerType: parseArrayParam("offerType"),

      residentialComplex: parseArrayParam("residentialComplex"),

      rentalPeriod: parseArrayParam("rentalPeriod"),

      amenities: parseArrayParam("amenities"),

      communications: parseArrayParam("communications"),

      technicalParameters: parseArrayParam("technicalParameters"),
    };

    for (const [key, value] of searchParams.entries()) {
      if (ignoredUrlKeys.includes(key)) {
        continue;
      }

      if (!value) {
        continue;
      }

      nextFilters[key] = value;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFilters(nextFilters);
  }, [searchParams]);

  /* =======================================================
     UPDATE FILTER
  ======================================================= */

  function updateFilter(key, value) {
    setFilters((prev) => {
      const next = {
        ...prev,
        [key]: value,
      };

      if (key === "dealType") {
        if (value === "rent") {
          next.documents = [];
          next.offerType = [];
        } else {
          next.rentalPeriod = [];
        }
      }

      return next;
    });
  }

  /* =======================================================
     UPDATE URL
  ======================================================= */

  function updateUrl(nextFilters) {
    const params = new URLSearchParams();

    if (nextFilters.propertyType) {
      params.set("propertyType", nextFilters.propertyType);
    }

    if (nextFilters.dealType) {
      params.set("dealType", nextFilters.dealType);
    }

    if (nextFilters.city && nextFilters.city !== "Все") {
      params.set("city", nextFilters.city);
    }

    if (nextFilters.region) {
      params.set("region", nextFilters.region);
    }

    if (nextFilters.country) {
      params.set("country", nextFilters.country);
    }

    if (nextFilters.district) {
      params.set("district", nextFilters.district);
    }

    if (nextFilters.searchQuery) {
      params.set("searchQuery", nextFilters.searchQuery);
    }

    if (nextFilters.currency) {
      params.set("currency", nextFilters.currency);
    }

    const simpleKeys = [
      "priceFrom",
      "priceTo",
      "areaFrom",
      "areaTo",
      "rooms",
      "beachDistanceFrom",
      "beachDistanceTo",
    ];

    for (const key of simpleKeys) {
      const value = nextFilters[key];

      if (
        value &&
        value !== "Все" &&
        value !== "Любой" &&
        value !== "Любая" &&
        value !== "Любые" &&
        value !== "Любое"
      ) {
        params.set(key, String(value));
      }
    }

    /* =====================================================
       URGENT
    ===================================================== */

    if (nextFilters.urgentOnly) {
      params.set("urgentOnly", "true");
    }

    /* =====================================================
       ARRAY FILTERS
    ===================================================== */

    for (const key of arrayFeatureKeys) {
      const value = normalizeArrayValue(nextFilters[key]);

      if (value.length > 0) {
        params.set(key, value.join(","));
      }
    }

    const query = params.toString();

    router.replace(query ? `/all-products?${query}` : "/all-products", {
      scroll: false,
    });
  }

  /* =======================================================
     SMART SEARCH
  ======================================================= */

  async function handleSmartSearch(data) {
    if (!data) {
      return;
    }

    const parsed = data.filters || data;

    const next = {
      ...filters,
    };

    if (parsed.propertyType) {
      next.propertyType = normalizePropertyType(parsed.propertyType);
    }

    if (parsed.dealType) {
      next.dealType = normalizeDealType(parsed.dealType);
    }

    if (parsed.region) {
      next.region = parsed.region;
    }

    if (parsed.city) {
      next.city = parsed.city;
    }

    if (parsed.country) {
      next.country = parsed.country;
    }

    if (parsed.district) {
      next.district = parsed.district;
    }

    if (parsed.searchQuery !== undefined && parsed.searchQuery !== null) {
      next.searchQuery = String(parsed.searchQuery);
    } else {
      next.searchQuery = "";
    }

    if (parsed.currency) {
      next.currency = parsed.currency;
    }

    const cityText = String(next.city || "").toLowerCase();

    const regionText = String(next.region || "").toLowerCase();

    const isIssykKul =
      regionText === "issyk_kul" ||
      (cityText.includes("иссык") && cityText.includes("куль"));

    if (isIssykKul) {
      next.region = "ISSYK_KUL";
      next.city = "Иссык-Куль";
    }

    if (parsed.priceFrom !== undefined && parsed.priceFrom !== null) {
      next.priceFrom = String(parsed.priceFrom);
    }

    if (parsed.priceTo !== undefined && parsed.priceTo !== null) {
      next.priceTo = String(parsed.priceTo);
    }

    if (parsed.minPrice !== undefined && parsed.minPrice !== null) {
      next.priceFrom = String(parsed.minPrice);
    }

    if (parsed.maxPrice !== undefined && parsed.maxPrice !== null) {
      next.priceTo = String(parsed.maxPrice);
    }

    if (parsed.areaFrom !== undefined && parsed.areaFrom !== null) {
      next.areaFrom = String(parsed.areaFrom);
    }

    if (parsed.areaTo !== undefined && parsed.areaTo !== null) {
      next.areaTo = String(parsed.areaTo);
    }

    if (parsed.minArea !== undefined && parsed.minArea !== null) {
      next.areaFrom = String(parsed.minArea);
    }

    if (parsed.maxArea !== undefined && parsed.maxArea !== null) {
      next.areaTo = String(parsed.maxArea);
    }

    if (parsed.rooms !== undefined && parsed.rooms !== null) {
      const rooms = Number(parsed.rooms);

      if (!Number.isNaN(rooms)) {
        next.rooms = rooms >= 4 ? "4+" : String(rooms);
      } else {
        next.rooms = String(parsed.rooms);
      }
    }

    if (
      parsed.beachDistanceFrom !== undefined &&
      parsed.beachDistanceFrom !== null
    ) {
      next.beachDistanceFrom = String(parsed.beachDistanceFrom);
    }

    if (
      parsed.beachDistanceTo !== undefined &&
      parsed.beachDistanceTo !== null
    ) {
      next.beachDistanceTo = String(parsed.beachDistanceTo);
    }

    /* =====================================================
       SMART SEARCH → URGENT
    ===================================================== */

    if (parsed.urgentOnly !== undefined && parsed.urgentOnly !== null) {
      next.urgentOnly = Boolean(parsed.urgentOnly);
    }

    for (const key of featureKeys) {
      if (
        parsed[key] !== undefined &&
        parsed[key] !== null &&
        parsed[key] !== ""
      ) {
        if (arrayFeatureKeys.includes(key)) {
          next[key] = normalizeArrayValue(parsed[key]);
        } else {
          next[key] = parsed[key];
        }
      }
    }

    for (const key of arrayFilterKeys) {
      if (parsed[key] !== undefined && parsed[key] !== null) {
        next[key] = normalizeArrayValue(parsed[key]);
      }
    }

    setFilters(next);

    updateUrl(next);
  }

  /* =======================================================
     LOAD LISTINGS
  ======================================================= */

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        setLoading(true);
        setError("");

        const token =
          typeof window !== "undefined"
            ? localStorage.getItem("uytap_token")
            : null;

        const [listingsResponse, favoritesResponse] = await Promise.all([
          getListings({
            page: 1,
            limit: 500,
          }),

          token ? getFavorites(token) : Promise.resolve(null),
        ]);

        if (cancelled) {
          return;
        }

        if (!listingsResponse?.success) {
          throw new Error(
            listingsResponse?.message || "Не удалось загрузить объявления",
          );
        }

        setListingsList(
          Array.isArray(listingsResponse.data) ? listingsResponse.data : [],
        );

        if (
          favoritesResponse?.success &&
          Array.isArray(favoritesResponse.data)
        ) {
          setFavIds(
            new Set(favoritesResponse.data.map((item) => String(item.id))),
          );
        } else {
          setFavIds(new Set());
        }
      } catch (err) {
        console.error(err);

        if (!cancelled) {
          setError(err?.message || "Ошибка соединения с сервером");

          setListingsList([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      cancelled = true;
    };
  }, []);

  /* =======================================================
     MAP LISTINGS
  ======================================================= */

  const mappedListings = useMemo(() => {
    return listingsList
      .map((item) => {
        try {
          return mapListingData(item);
        } catch (err) {
          console.error("Ошибка mapListingData:", err);

          return null;
        }
      })
      .filter(Boolean);
  }, [listingsList]);

  /* =======================================================
     FAVORITES
  ======================================================= */

  async function handleFavoriteClick(item) {
    const token =
      typeof window !== "undefined"
        ? localStorage.getItem("uytap_token")
        : null;

    if (!token) {
      router.push("/login");
      return;
    }

    const id = String(item.id);

    const isFavorite = favIds.has(id);

    try {
      if (isFavorite) {
        const response = await removeFavorite(token, id);

        if (response?.success) {
          setFavIds((prev) => {
            const next = new Set(prev);

            next.delete(id);

            return next;
          });
        }
      } else {
        const response = await addFavorite(token, id);

        if (response?.success) {
          setFavIds((prev) => {
            const next = new Set(prev);

            next.add(id);

            return next;
          });
        }
      }
    } catch (err) {
      console.error("Favorite error:", err);
    }
  }

  /* =======================================================
     FILTER LISTINGS
  ======================================================= */

  const filteredListings = useMemo(() => {
    return mappedListings
      .filter((item) => {
        /* =================================================
           URGENT STATUS FILTER
        ================================================= */

        const itemStatus = String(item?.status || "")
          .trim()
          .toLowerCase();

        if (filters.urgentOnly && itemStatus !== "urgent") {
          return false;
        }

        /* =================================================
           CATEGORY
        ================================================= */

        const selectedType = categoryApiMap[filters.propertyType];

        const itemType = String(item.type || "")
          .trim()
          .toLowerCase();

        const matchesCategory =
          !selectedType || itemType === selectedType.toLowerCase();

        /* =================================================
           DEAL
        ================================================= */

        const selectedDeal = dealApiMap[filters.dealType];

        const itemDeal = String(item.dealType || "")
          .trim()
          .toLowerCase();

        const matchesDeal =
          !selectedDeal || itemDeal === selectedDeal.toLowerCase();

        /* =================================================
           CITY & SETTLEMENT
        ================================================= */

        const matchesCity = (() => {
          const targetCityOrSettlement =
            filters.city && filters.city !== "Все"
              ? filters.city
              : filters.settlement && filters.settlement !== "Все"
                ? filters.settlement
                : null;

          if (!targetCityOrSettlement) {
            return true;
          }

          const selected = normalizeLocationValue(targetCityOrSettlement);

          const values = [
            item.location,
            item.city,
            item.region,
            item.address,
            item.country,
            item.district,
          ]
            .filter(Boolean)
            .map(normalizeLocationValue);

          if (
            isIssykKulValue(selected) ||
            ISSYK_KUL_CITIES.some(
              (city) =>
                selected === normalizeLocationValue(city) ||
                selected.includes(normalizeLocationValue(city)),
            )
          ) {
            return values.some((value) => {
              if (isIssykKulValue(value)) {
                return true;
              }

              return ISSYK_KUL_CITIES.some((city) => {
                const normalizedCity = normalizeLocationValue(city);

                return (
                  value === normalizedCity || value.includes(normalizedCity)
                );
              });
            });
          }

          if (selected === "турция") {
            return values.some(
              (value) =>
                value.includes("турци") ||
                value.includes("turkey") ||
                value.includes("алань") ||
                value.includes("антал") ||
                value.includes("стамбул") ||
                value.includes("мерсин") ||
                value.includes("измир"),
            );
          }

          return values.some((value) => value.includes(selected));
        })();

        /* =================================================
           REGION
        ================================================= */

        const matchesRegion = (() => {
          if (!filters.region) {
            return true;
          }

          const selRegion = normalizeLocationValue(filters.region);
          const selRegionFormatted = normalizeLocationValue(
            formatRegion(filters.region),
          );
          if (!selRegion && !selRegionFormatted) return true;

          const values = [
            item.region,
            item.raw?.region,
            item.location,
            item.country,
            item.raw?.country,
          ]
            .filter(Boolean)
            .map(normalizeLocationValue);

          if (selRegion === "turkey" || selRegionFormatted.includes("турци")) {
            return values.some(
              (v) => v.includes("turkey") || v.includes("турци"),
            );
          }

          if (
            selRegion === "bishkek" ||
            selRegionFormatted.includes("бишкек")
          ) {
            return values.some(
              (v) => v.includes("bishkek") || v.includes("бишкек"),
            );
          }

          if (
            selRegion === "issyk_kul" ||
            isIssykKulValue(selRegion) ||
            isIssykKulValue(selRegionFormatted)
          ) {
            return values.some(
              (v) =>
                isIssykKulValue(v) ||
                v.includes("issyk") ||
                v.includes("иссык") ||
                v.includes("ысык"),
            );
          }

          return values.some(
            (v) =>
              (selRegion && (v.includes(selRegion) || selRegion.includes(v))) ||
              (selRegionFormatted &&
                (v.includes(selRegionFormatted) ||
                  selRegionFormatted.includes(v))),
          );
        })();

        /* =================================================
           DISTRICT
        ================================================= */

        const matchesDistrict = (() => {
          if (!filters.district) {
            return true;
          }

          const selDistrict = normalizeLocationValue(filters.district);
          if (!selDistrict) return true;

          const values = [
            item.district,
            item.raw?.district,
            item.address,
            item.location,
            item.title,
            item.description,
          ]
            .filter(Boolean)
            .map(normalizeLocationValue);

          if (
            values.some(
              (v) => v.includes(selDistrict) || selDistrict.includes(v),
            )
          ) {
            return true;
          }

          const selTokens = selDistrict
            .split(/[\s,.-]+/)
            .map(getWordStem)
            .filter((s) => s.length >= 3);

          if (selTokens.length === 0) return false;

          const allValueWords = values
            .join(" ")
            .split(/[\s,.-]+/)
            .map(getWordStem)
            .filter(Boolean);

          return selTokens.every((token) =>
            allValueWords.some((w) => w.includes(token) || token.includes(w)),
          );
        })();

        /* =================================================
           KEYWORD / SEARCH QUERY (e.g. "студия", "евродвушка")
        ================================================= */

        const matchesSearchQuery = (() => {
          if (!filters.searchQuery || !String(filters.searchQuery).trim()) {
            return true;
          }

          const rawQuery = String(filters.searchQuery).trim().toLowerCase();
          const queryTokens = rawQuery
            .split(/[\s,.-]+/)
            .map(getWordStem)
            .filter((s) => s.length >= 3);

          if (queryTokens.length === 0) {
            return true;
          }

          const haystack = [
            item.title,
            item.description,
            item.address,
            item.district,
            item.location,
            item.type,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

          const haystackWords = haystack
            .split(/[\s,.-]+/)
            .map(getWordStem)
            .filter(Boolean);

          return queryTokens.every(
            (token) =>
              haystack.includes(token) ||
              haystackWords.some((w) => w.includes(token) || token.includes(w)),
          );
        })();

        /* =================================================
           ROOMS
        ================================================= */

        const matchesRooms = (() => {
          if (!filters.rooms || filters.rooms === "Все") {
            return true;
          }

          const itemRooms = Number(item.rooms);

          if (filters.rooms === "4+") {
            return itemRooms >= 4;
          }

          return itemRooms === Number(filters.rooms);
        })();

        /* =================================================
           PRICE
        ================================================= */

        const matchesPrice = (() => {
          const price = Number(item.rawPrice);

          const min = filters.priceFrom ? Number(filters.priceFrom) : null;

          const max = filters.priceTo ? Number(filters.priceTo) : null;

          if (min !== null && !Number.isNaN(min) && price < min) {
            return false;
          }

          if (max !== null && !Number.isNaN(max) && price > max) {
            return false;
          }

          return true;
        })();

        /* =================================================
           AREA
        ================================================= */

        const matchesArea = (() => {
          const area = Number(item.rawArea);

          const min = filters.areaFrom ? Number(filters.areaFrom) : null;

          const max = filters.areaTo ? Number(filters.areaTo) : null;

          if (min !== null && !Number.isNaN(min) && area < min) {
            return false;
          }

          if (max !== null && !Number.isNaN(max) && area > max) {
            return false;
          }

          return true;
        })();

        /* =================================================
           BEACH DISTANCE
        ================================================= */

        const matchesBeach = (() => {
          if (!filters.beachDistanceFrom && !filters.beachDistanceTo) {
            return true;
          }

          if (!isIssykKulLocation(filters)) {
            return true;
          }

          const rawDistance =
            item.beachDistanceFrom ??
            item.beachDistance ??
            item.beach_distance ??
            item.distanceToBeach ??
            item.distance_to_beach ??
            item.features?.beachDistance ??
            item.features?.beach_distance ??
            item.features?.distanceToBeach ??
            item.features?.distance_to_beach;

          const distance = Number(rawDistance);

          if (
            rawDistance === undefined ||
            rawDistance === null ||
            rawDistance === ""
          ) {
            return true;
          }

          if (Number.isNaN(distance)) {
            return true;
          }

          const min = filters.beachDistanceFrom
            ? Number(filters.beachDistanceFrom)
            : null;

          const max = filters.beachDistanceTo
            ? Number(filters.beachDistanceTo)
            : null;

          if (min !== null && !Number.isNaN(min) && distance < min) {
            return false;
          }

          if (max !== null && !Number.isNaN(max) && distance > max) {
            return false;
          }

          return true;
        })();

        /* =================================================
           ARRAY FEATURES
        ================================================= */

        for (const key of arrayFeatureKeys) {
          const selected = filters[key];

          if (!Array.isArray(selected) || selected.length === 0) {
            continue;
          }

          const itemValue = item[key] ?? item.features?.[key];

          if (
            ["amenities", "communications", "technicalParameters"].includes(key)
          ) {
            if (!matchesArrayFilter(selected, itemValue)) {
              return false;
            }

            continue;
          }

          if (!matchesMultiValue(selected, itemValue)) {
            return false;
          }
        }

        /* =================================================
           SIMPLE FEATURES
        ================================================= */

        for (const key of featureKeys) {
          if (arrayFeatureKeys.includes(key)) {
            continue;
          }

          const selected = filters[key];

          if (
            !selected ||
            selected === "Любой" ||
            selected === "Любая" ||
            selected === "Любые" ||
            selected === "Любое"
          ) {
            continue;
          }

          const itemValue = item[key] ?? item.features?.[key];

          if (itemValue === undefined || itemValue === null) {
            return false;
          }

          if (
            !String(itemValue)
              .toLowerCase()
              .includes(String(selected).toLowerCase())
          ) {
            return false;
          }
        }

        /* =================================================
           FINAL FILTER RESULT
        ================================================= */

        return (
          matchesCategory &&
          matchesDeal &&
          matchesRegion &&
          matchesCity &&
          matchesDistrict &&
          matchesRooms &&
          matchesPrice &&
          matchesArea &&
          matchesBeach &&
          matchesSearchQuery
        );
      })
      .sort((a, b) => {
        const priority = {
          vip: 0,
          urgent: 1,
          top: 2,
          regular: 3,
        };

        return (
          (priority[String(a.status || "").toLowerCase()] ?? 3) -
          (priority[String(b.status || "").toLowerCase()] ?? 3)
        );
      });
  }, [mappedListings, filters]);

  /* =======================================================
     CATEGORY FILTER
  ======================================================= */

  const CategoryFilters =
    categoryComponents[filters.propertyType] || ApartmentFilters;

  /* =======================================================
     BEACH
  ======================================================= */

  const showBeachDistance = useMemo(
    () => isIssykKulLocation(filters),
    [filters],
  );

  /* =======================================================
     RESET
  ======================================================= */

  function resetFilters() {
    setFilters({
      ...DEFAULT_FILTERS,
    });

    router.replace("/all-products", {
      scroll: false,
    });
  }

  /* =======================================================
     HAS FILTERS
  ======================================================= */

  const hasFilters =
    filters.propertyType !== "apartment" ||
    filters.dealType !== "sale" ||
    filters.city !== "Все" ||
    Boolean(filters.searchQuery) ||
    Boolean(filters.priceFrom) ||
    Boolean(filters.priceTo) ||
    Boolean(filters.areaFrom) ||
    Boolean(filters.areaTo) ||
    Boolean(filters.beachDistanceFrom) ||
    Boolean(filters.beachDistanceTo) ||
    Object.entries(filters).some(([key, value]) => {
      if (
        [
          "propertyType",
          "dealType",
          "city",
          "currency",
          "searchQuery",
          "priceFrom",
          "priceTo",
          "areaFrom",
          "areaTo",
          "beachDistanceFrom",
          "beachDistanceTo",
        ].includes(key)
      ) {
        return false;
      }

      if (Array.isArray(value)) {
        return value.length > 0;
      }

      return Boolean(value);
    });

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <main className={styles.page}>
      <div className={styles.glow} />

      <header className={styles.header}>
        <div className={styles.headerTop}>
          <button
            type="button"
            className={styles.homeButton}
            onClick={() => router.push("/")}
          >
            <Home size={17} />
            {t("allProducts.home")}
          </button>

          <div className={styles.badge}>
            <span />
            {t("allProducts.badge")}
          </div>
        </div>

        <h1>
          {t("allProducts.title")}
          <span> {t("allProducts.titleAccent")}</span>
        </h1>

        <p>{t("allProducts.description")}</p>
      </header>

      <div className={styles.container}>
        <ProductsFilters
          searchMode={searchMode}
          setSearchMode={setSearchMode}
          filters={filters}
          updateFilter={updateFilter}
          updateUrl={updateUrl}
          handleSmartSearch={handleSmartSearch}
          resetFilters={resetFilters}
          hasFilters={hasFilters}
          categories={translatedCategories}
          categoryLabels={categoryLabels}
          CategoryFilters={CategoryFilters}
          showBeachDistance={showBeachDistance}
        />

        <ProductsResults
          loading={loading}
          error={error}
          listings={filteredListings}
          favIds={favIds}
          onFavoriteClick={handleFavoriteClick}
          hasFilters={hasFilters}
          onReset={resetFilters}
          searchQuery={filters.searchQuery}
          onClearSearchQuery={() => updateFilter("searchQuery", "")}
        />
      </div>
      <Footer />
    </main>
  );
}
