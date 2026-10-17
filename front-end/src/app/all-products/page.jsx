"use client";

import { Home } from "lucide-react";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useLanguage } from "@/context/LanguageContext";

import {
  getListings,
  getFavorites,
  addFavorite,
  removeFavorite,
} from "@/utils/api";

import { mapListingData } from "@/utils/mapListingData";

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

  if (value === "all") {
    return "all";
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

/* =========================================================
   URL ↔ FILTERS PARSER & BUILDER
========================================================= */

function parseUrlToFilters(searchParams) {
  const rawPropertyType =
    searchParams.get("propertyType") || searchParams.get("category");
  const propertyType = rawPropertyType
    ? normalizePropertyType(rawPropertyType)
    : "apartment";

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

  return nextFilters;
}

function buildApiFilters(f) {
  const params = {};

  if (f.propertyType && f.propertyType !== "all") {
    params.propertyType = f.propertyType;
  }

  if (f.dealType && f.dealType !== "Все") {
    params.dealType = f.dealType;
  }

  if (f.city && f.city !== "Все") {
    params.city = f.city;
  }

  if (f.region) {
    params.region = f.region;
  }

  if (f.district) {
    params.district = f.district;
  }

  if (f.country) {
    params.country = f.country;
  }

  if (f.searchQuery) {
    params.searchQuery = f.searchQuery;
  }

  if (f.currency) {
    params.currency = f.currency;
  }

  if (f.priceFrom) {
    params.minPrice = f.priceFrom;
  }

  if (f.priceTo) {
    params.maxPrice = f.priceTo;
  }

  if (f.areaFrom) {
    params.minArea = f.areaFrom;
  }

  if (f.areaTo) {
    params.maxArea = f.areaTo;
  }

  if (f.rooms && f.rooms !== "Все") {
    params.rooms = f.rooms;
  }

  if (f.urgentOnly) {
    params.urgentOnly = "true";
  }

  if (f.beachDistanceFrom) {
    params.beachDistanceFrom = f.beachDistanceFrom;
  }

  if (f.beachDistanceTo) {
    params.beachDistanceTo = f.beachDistanceTo;
  }

  // Характеристики категорий (features)
  for (const key of featureKeys) {
    const val = f[key];
    if (
      val === undefined ||
      val === null ||
      val === "" ||
      val === "Любой" ||
      val === "Любая" ||
      val === "Любые" ||
      val === "Любое"
    ) {
      continue;
    }

    if (Array.isArray(val)) {
      if (val.length > 0) {
        params[key] = val.join(",");
      }
    } else {
      params[key] = String(val);
    }
  }

  for (const key of arrayFilterKeys) {
    const val = f[key];
    if (Array.isArray(val) && val.length > 0) {
      params[key] = val.join(",");
    }
  }

  return params;
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
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const [favIds, setFavIds] = useState(new Set());

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const abortControllerRef = useRef(null);
  const reqIdRef = useRef(0);
  const initialScrollRestoredRef = useRef(false);

  const listingsRef = useRef(listingsList);
  const searchParamsString = searchParams.toString();
  const searchParamsRef = useRef(searchParamsString);

  useEffect(() => {
    listingsRef.current = listingsList;
  }, [listingsList]);

  useEffect(() => {
    searchParamsRef.current = searchParamsString;
  }, [searchParamsString]);

  /* =======================================================
     FETCH LISTINGS (SERVER PAGINATION & FILTERING)
  ======================================================= */

  const fetchListings = useCallback(
    async (
      appliedFilters,
      targetPage,
      targetLimit,
      { isLoadMore = false, targetScrollY = 0 } = {},
    ) => {
      if (isLoadMore) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setError("");
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
      }

      const controller = new AbortController();
      if (!isLoadMore) {
        abortControllerRef.current = controller;
      }
      const currentReqId = ++reqIdRef.current;

      try {
        const apiParams = buildApiFilters(appliedFilters);
        apiParams.page = targetPage;
        apiParams.limit = targetLimit;

        const token =
          typeof window !== "undefined"
            ? localStorage.getItem("uytap_token")
            : null;

        const [res, favRes] = await Promise.all([
          getListings(apiParams, { signal: controller.signal }),
          token && !isLoadMore ? getFavorites(token) : Promise.resolve(null),
        ]);

        if (currentReqId !== reqIdRef.current) return;

        if (!res?.success) {
          throw new Error(res?.message || "Не удалось загрузить объявления");
        }

        const rawList = Array.isArray(res.data) ? res.data : [];
        const serverTotal = res.pagination?.total ?? rawList.length;

        if (isLoadMore) {
          setListingsList((prev) => {
            const existingIds = new Set(prev.map((i) => i.id));
            const filteredNew = rawList.filter((i) => !existingIds.has(i.id));
            return [...prev, ...filteredNew];
          });
          setPage(targetPage);
        } else {
          setListingsList(rawList);
          setTotal(serverTotal);
          setPage(targetPage);

          if (targetScrollY > 0) {
            requestAnimationFrame(() => {
              window.scrollTo({ top: targetScrollY, behavior: "instant" });
            });
          }
        }

        if (
          favRes?.success &&
          Array.isArray(favRes.data)
        ) {
          setFavIds(
            new Set(favRes.data.map((item) => String(item.id))),
          );
        }
      } catch (err) {
        if (err.name === "AbortError") return;
        if (currentReqId !== reqIdRef.current) return;
        console.error("Fetch listings error:", err);
        if (!isLoadMore) {
          setError(err?.message || "Ошибка соединения с сервером");
          setListingsList([]);
          setTotal(0);
        }
      } finally {
        if (currentReqId === reqIdRef.current) {
          if (isLoadMore) {
            setLoadingMore(false);
          } else {
            setLoading(false);
          }
        }
      }
    },
    [],
  );

  /* =======================================================
     SESSION STORAGE FOR BACK BUTTON & SCROLL RESTORATION
  ======================================================= */

  useEffect(() => {
    const saveCatalogState = () => {
      try {
        if (listingsRef.current.length > 0) {
          sessionStorage.setItem(
            "uytap_catalog_state",
            JSON.stringify({
              filterKey: searchParamsRef.current,
              loadedCount: listingsRef.current.length,
              scrollY: window.scrollY || 0,
              timestamp: Date.now(),
            }),
          );
        }
      } catch (e) {
        // Игнорируем ошибки квот / режима инкогнито
      }
    };

    window.addEventListener("beforeunload", saveCatalogState);
    return () => {
      window.removeEventListener("beforeunload", saveCatalogState);
      saveCatalogState();
    };
  }, []);

  /* =======================================================
     URL SEARCHPARAMS → LOAD LISTINGS
  ======================================================= */

  useEffect(() => {
    let initialLimit = 20;
    let initialScrollY = 0;

    if (!initialScrollRestoredRef.current) {
      initialScrollRestoredRef.current = true;
      try {
        const rawSaved = sessionStorage.getItem("uytap_catalog_state");
        if (rawSaved) {
          const saved = JSON.parse(rawSaved);
          const isFresh = Date.now() - saved.timestamp < 15 * 60 * 1000; // 15 минут TTL
          const isSameFilter = saved.filterKey === searchParamsString;

          if (isFresh && isSameFilter && saved.loadedCount > 0) {
            initialLimit = Math.min(100, Math.max(20, saved.loadedCount));
            initialScrollY = saved.scrollY || 0;
          }
          sessionStorage.removeItem("uytap_catalog_state");
        }
      } catch (e) {
        // Игнорируем ошибки парсинга
      }
    }

    const nextFilters = parseUrlToFilters(searchParams);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFilters(nextFilters);
    fetchListings(nextFilters, 1, initialLimit, {
      isLoadMore: false,
      targetScrollY: initialScrollY,
    });
  }, [searchParamsString, fetchListings, searchParams]);

  /* =======================================================
     UPDATE FILTER & URL
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

  function updateUrl(nextFilters) {
    const params = new URLSearchParams();

    if (nextFilters.propertyType && nextFilters.propertyType !== "all") {
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

    if (nextFilters.urgentOnly) {
      params.set("urgentOnly", "true");
    }

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
     SMART SEARCH HANDLERS
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
    } else {
      next.propertyType = "all";
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

  function handleRemoveSmartFilter(filterKey) {
    setFilters((prev) => {
      const next = { ...prev };
      if (filterKey === "propertyType") {
        next.propertyType = "all";
      } else if (filterKey === "dealType") {
        next.dealType = "sale";
      } else if (filterKey === "location") {
        next.city = "Все";
        next.region = "";
        next.district = "";
        next.country = "";
      } else if (filterKey === "district") {
        next.district = "";
      } else if (filterKey === "rooms") {
        next.rooms = "Все";
      } else if (filterKey === "price") {
        next.priceFrom = "";
        next.priceTo = "";
      } else if (filterKey === "area") {
        next.areaFrom = "";
        next.areaTo = "";
      } else if (filterKey === "searchQuery") {
        next.searchQuery = "";
      } else if (filterKey === "beachDistance") {
        next.beachDistanceFrom = "";
        next.beachDistanceTo = "";
      } else {
        if (Array.isArray(next[filterKey])) {
          next[filterKey] = [];
        } else {
          delete next[filterKey];
        }
      }
      updateUrl(next);
      return next;
    });
  }

  function handleClearSearchQuery() {
    setFilters((prev) => {
      const next = { ...prev, searchQuery: "" };
      updateUrl(next);
      return next;
    });
  }

  function handleLoadMore() {
    if (loadingMore || loading || listingsList.length >= total) return;
    const nextPage = page + 1;
    fetchListings(filters, nextPage, 20, { isLoadMore: true });
  }

  function handleRetry() {
    fetchListings(filters, 1, 20, { isLoadMore: false });
  }

  /* =======================================================
     MAP LISTINGS (TRANSFORM RAW SERVER DATA)
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

  const hasMore = listingsList.length < total && listingsList.length > 0;

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
     CATEGORY FILTERS COMPONENT
  ======================================================= */

  const CategoryFilters =
    categoryComponents[filters.propertyType] || ApartmentFilters;

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
     BEACH DISTANCE VISIBILITY
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
     HAS FILTERS CHECK
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
    Boolean(filters.urgentOnly) ||
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
          "urgentOnly",
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
          handleRemoveSmartFilter={handleRemoveSmartFilter}
          resetFilters={resetFilters}
          hasFilters={hasFilters}
          categories={translatedCategories}
          categoryLabels={categoryLabels}
          CategoryFilters={CategoryFilters}
          showBeachDistance={showBeachDistance}
        />

        <ProductsResults
          loading={loading}
          loadingMore={loadingMore}
          error={error}
          onRetry={handleRetry}
          listings={mappedListings}
          total={total}
          hasMore={hasMore}
          onLoadMore={handleLoadMore}
          favIds={favIds}
          onFavoriteClick={handleFavoriteClick}
          hasFilters={hasFilters}
          onReset={resetFilters}
          searchQuery={filters.searchQuery}
          onClearSearchQuery={handleClearSearchQuery}
        />
      </div>
      <Footer />
    </main>
  );
}
