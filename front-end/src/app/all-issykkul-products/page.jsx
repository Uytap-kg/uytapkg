"use client";

import { MapPin, Search, X, Home, DoorOpen } from "lucide-react";

import { useRouter } from "next/navigation";
import { useMemo, useState, useEffect } from "react";

import {
  getListings,
  getAllListings,
  getFavorites,
  addFavorite,
  removeFavorite,
} from "@/utils/api";

import { mapListingData } from "@/utils/mapListingData";

import { useLanguage } from "@/context/LanguageContext";

import styles from "./IssykKulProducts.module.css";
import CustomSelect from "@/components/ui/customSelect/CustomSelect";
import ListingCard from "@/components/ui/ListingCard/ListingCard";

const categories = [
  { value: "Все", label: "Все" },
  { value: "Дом", label: "Дома" },
  { value: "Квартира", label: "Квартиры" },
  { value: "Коттедж", label: "Коттеджи" },
  { value: "Участок", label: "Участки" },
  { value: "Коммерция", label: "Коммерция" },
  { value: "Паркинг/гараж", label: "Паркинг" },
  { value: "Комнаты", label: "Комнаты" },
];

const dealTypes = [
  { value: "Все", label: "Все объявления" },
  { value: "Продажа", label: "Продажа" },
  { value: "Сниму в аренду", label: "Сниму в аренду" },
];

const cityOptions = [
  "Все",
  "Каракол",
  "Чолпон-Ата",
  "Бостери",
  "Чон-Сары-Ой",
  "Боконбаево",
];

const roomOptions = ["Все", "1", "2", "3", "4+"];

const normalize = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const normalizeCategory = (value) => {
  const normalized = normalize(value);

  const aliases = {
    дом: "дом",
    дома: "дом",

    квартира: "квартира",
    квартиры: "квартира",

    коттедж: "коттедж",
    коттеджи: "коттедж",

    участок: "участок",
    участки: "участок",

    коммерция: "коммерция",

    "паркинг/гараж": "паркинг/гараж",
    паркинг: "паркинг/гараж",
    гараж: "паркинг/гараж",

    комнаты: "комнаты",
    комната: "комнаты",
  };

  return aliases[normalized] || normalized;
};

const normalizeDeal = (value) => {
  const normalized = normalize(value);

  if (
    normalized === "продажа" ||
    normalized === "продам" ||
    normalized === "куплю"
  ) {
    return "продажа";
  }

  if (
    normalized === "сниму в аренду" ||
    normalized === "аренда" ||
    normalized === "сниму" ||
    normalized === "сдам"
  ) {
    return "сниму в аренду";
  }

  return normalized;
};

export default function IssykKulProducts() {
  useEffect(() => {
    document.title =
      "Недвижимость на Иссык-Куле — Курортное жилье и дома | UyTap";
  }, []);
  
  const router = useRouter();
  const { t } = useLanguage();

  /*
   * =========================================================
   * TRANSLATIONS
   * =========================================================
   */

  const getTranslation = (key, fallback) => {
    const translated = t(key);

    return translated === key ? fallback : translated;
  };

  const translatedCategories = useMemo(
    () =>
      categories.map((category) => ({
        value: category.value,
        label: getTranslation(
          `issykKulProducts.categories.${category.value}`,
          category.label,
        ),
      })),
    [t],
  );

  const translatedDealTypes = useMemo(
    () =>
      dealTypes.map((deal) => ({
        value: deal.value,
        label: getTranslation(
          `issykKulProducts.dealTypes.${deal.value}`,
          deal.label,
        ),
      })),
    [t],
  );

  const translatedCityOptions = useMemo(
    () =>
      cityOptions.map((city) => ({
        value: city,
        label: getTranslation(`issykKulProducts.cities.${city}`, city),
      })),
    [t],
  );

  const translatedRoomOptions = useMemo(
    () =>
      roomOptions.map((room) => ({
        value: room,
        label: getTranslation(`issykKulProducts.rooms.${room}`, room),
      })),
    [t],
  );

  /*
   * =========================================================
   * DRAFT FILTERS
   * =========================================================
   */

  const [search, setSearch] = useState("");

  const [activeCategory, setActiveCategory] = useState("Все");
  const [dealType, setDealType] = useState("Все");

  const [city, setCity] = useState("Все");
  const [rooms, setRooms] = useState("Все");

  const [priceFrom, setPriceFrom] = useState("");
  const [priceTo, setPriceTo] = useState("");

  const [areaFrom, setAreaFrom] = useState("");
  const [areaTo, setAreaTo] = useState("");

  /*
   * =========================================================
   * APPLIED FILTERS
   * =========================================================
   */

  const [appliedFilters, setAppliedFilters] = useState({
    search: "",
    activeCategory: "Все",
    dealType: "Все",
    city: "Все",
    rooms: "Все",
    priceFrom: "",
    priceTo: "",
    areaFrom: "",
    areaTo: "",
  });

  /*
   * =========================================================
   * DATA
   * =========================================================
   */

  const [listingsList, setListingsList] = useState([]);
  const [favIds, setFavIds] = useState(new Set());

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /*
   * =========================================================
   * LOAD DATA
   * =========================================================
   */

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        setLoading(true);
        setError("");

        const token = localStorage.getItem("uytap_token");

        const [listingsResponse, favoritesResponse] = await Promise.all([
          getAllListings({
            region: "issyk",
          }),

          token ? getFavorites(token) : Promise.resolve(null),
        ]);

        if (cancelled) return;

        if (!listingsResponse?.success) {
          throw new Error(
            listingsResponse?.message ||
              t("issykKulProducts.errors.loadListings"),
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
        console.error("Failed to load listings:", err);

        if (!cancelled) {
          setError(err?.message || t("issykKulProducts.errors.connection"));

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
  }, [t]);

  /*
   * =========================================================
   * MAP DATA
   * =========================================================
   */

  const mappedListings = useMemo(() => {
    return listingsList
      .map((item) => {
        try {
          return mapListingData(item);
        } catch (err) {
          console.error("Listing mapping error:", err, item);
          return null;
        }
      })
      .filter(Boolean);
  }, [listingsList]);

  /*
   * =========================================================
   * FAVORITES
   * =========================================================
   */

  const handleFavoriteClick = async (clickedItem) => {
    const token = localStorage.getItem("uytap_token");

    if (!token) {
      router.push("/login");
      return;
    }

    const id = String(clickedItem.id);
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
      console.error("Favorite toggle error:", err);
    }
  };

  /*
   * =========================================================
   * APPLY FILTERS
   * =========================================================
   */

  const handleSearch = () => {
    setAppliedFilters({
      search: search.trim(),
      activeCategory,
      dealType,
      city,
      rooms,
      priceFrom,
      priceTo,
      areaFrom,
      areaTo,
    });

    requestAnimationFrame(() => {
      document.getElementById("results")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  /*
   * =========================================================
   * ENTER = SEARCH
   * =========================================================
   */

  const handleSearchKeyDown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSearch();
    }
  };

  /*
   * =========================================================
   * FILTERING
   * =========================================================
   */

  const filteredListings = useMemo(() => {
    const query = normalize(appliedFilters.search);

    const selectedCategory = normalizeCategory(appliedFilters.activeCategory);

    const selectedDeal = normalizeDeal(appliedFilters.dealType);

    const selectedCity = normalize(appliedFilters.city);

    const minPrice = appliedFilters.priceFrom
      ? Number(appliedFilters.priceFrom)
      : null;

    const maxPrice = appliedFilters.priceTo
      ? Number(appliedFilters.priceTo)
      : null;

    const minArea = appliedFilters.areaFrom
      ? Number(appliedFilters.areaFrom)
      : null;

    const maxArea = appliedFilters.areaTo
      ? Number(appliedFilters.areaTo)
      : null;

    return mappedListings
      .filter((item) => {
        /*
         * =====================================================
         * ONLY ISSYK-KUL
         * =====================================================
         */

        const region = normalize(item.region);
        const location = normalize(item.location);
        const cityValue = normalize(item.city);
        const address = normalize(item.address);

        const isIssykKul =
          region === "issyk_kul" ||
          region === "issykkul" ||
          region === "issyk kul" ||
          region.includes("issyk") ||
          region.includes("иссык") ||
          location.includes("иссык") ||
          cityValue.includes("иссык") ||
          location.includes("каракол") ||
          location.includes("чолпон") ||
          cityValue.includes("каракол") ||
          cityValue.includes("чолпон") ||
          address.includes("каракол") ||
          address.includes("чолпон");

        if (!isIssykKul) {
          return false;
        }

        /*
         * =====================================================
         * SEARCH
         * =====================================================
         */

        const title = normalize(item.title);
        const description = normalize(item.description);

        const matchesSearch =
          !query ||
          title.includes(query) ||
          location.includes(query) ||
          cityValue.includes(query) ||
          address.includes(query) ||
          description.includes(query);

        if (!matchesSearch) {
          return false;
        }

        /*
         * =====================================================
         * CATEGORY
         * =====================================================
         */

        const itemType = normalizeCategory(item.type);

        const matchesCategory =
          appliedFilters.activeCategory === "Все" ||
          itemType === selectedCategory;

        if (!matchesCategory) {
          return false;
        }

        /*
         * =====================================================
         * DEAL TYPE
         * =====================================================
         */

        const itemDeal = normalizeDeal(item.dealType);

        const matchesDeal =
          appliedFilters.dealType === "Все" || itemDeal === selectedDeal;

        if (!matchesDeal) {
          return false;
        }

        /*
         * =====================================================
         * CITY
         * =====================================================
         */

        const matchesCity =
          appliedFilters.city === "Все" ||
          location.includes(selectedCity) ||
          cityValue.includes(selectedCity) ||
          address.includes(selectedCity);

        if (!matchesCity) {
          return false;
        }

        /*
         * =====================================================
         * ROOMS
         * =====================================================
         */

        let matchesRooms = true;

        if (appliedFilters.rooms !== "Все") {
          const itemRooms = Number(item.rooms);

          if (Number.isNaN(itemRooms)) {
            matchesRooms = false;
          } else if (appliedFilters.rooms === "4+") {
            matchesRooms = itemRooms >= 4;
          } else {
            matchesRooms = itemRooms === Number(appliedFilters.rooms);
          }
        }

        if (!matchesRooms) {
          return false;
        }

        /*
         * =====================================================
         * PRICE
         * =====================================================
         */

        const price = Number(item.rawPrice);

        if (
          minPrice !== null &&
          !Number.isNaN(minPrice) &&
          !Number.isNaN(price) &&
          price < minPrice
        ) {
          return false;
        }

        if (maxPrice !== null && !Number.isNaN(maxPrice) && price > maxPrice) {
          return false;
        }

        /*
         * =====================================================
         * AREA
         * =====================================================
         */

        const area = Number(item.rawArea);

        if (
          minArea !== null &&
          !Number.isNaN(minArea) &&
          !Number.isNaN(area) &&
          area < minArea
        ) {
          return false;
        }

        if (
          maxArea !== null &&
          !Number.isNaN(maxArea) &&
          !Number.isNaN(area) &&
          area > maxArea
        ) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        const priority = {
          vip: 0,
          urgent: 1,
          top: 2,
          regular: 3,
          null: 3,
        };

        const aStatus = a.status ?? "regular";
        const bStatus = b.status ?? "regular";

        return (priority[aStatus] ?? 3) - (priority[bStatus] ?? 3);
      });
  }, [mappedListings, appliedFilters]);

  /*
   * =========================================================
   * RESET
   * =========================================================
   */

  const resetFilters = () => {
    setSearch("");
    setActiveCategory("Все");
    setDealType("Все");
    setCity("Все");
    setRooms("Все");
    setPriceFrom("");
    setPriceTo("");
    setAreaFrom("");
    setAreaTo("");

    setAppliedFilters({
      search: "",
      activeCategory: "Все",
      dealType: "Все",
      city: "Все",
      rooms: "Все",
      priceFrom: "",
      priceTo: "",
      areaFrom: "",
      areaTo: "",
    });
  };

  /*
   * =========================================================
   * HAS FILTERS
   * =========================================================
   */

  const hasDraftFilters =
    search.trim() !== "" ||
    activeCategory !== "Все" ||
    dealType !== "Все" ||
    city !== "Все" ||
    rooms !== "Все" ||
    priceFrom !== "" ||
    priceTo !== "" ||
    areaFrom !== "" ||
    areaTo !== "";

  const hasAppliedFilters =
    appliedFilters.search !== "" ||
    appliedFilters.activeCategory !== "Все" ||
    appliedFilters.dealType !== "Все" ||
    appliedFilters.city !== "Все" ||
    appliedFilters.rooms !== "Все" ||
    appliedFilters.priceFrom !== "" ||
    appliedFilters.priceTo !== "" ||
    appliedFilters.areaFrom !== "" ||
    appliedFilters.areaTo !== "";

  /*
   * =========================================================
   * UI
   * =========================================================
   */

  return (
    <main className={styles.page}>
      <div className={styles.backgroundGlow} />

      {/* HEADER */}

      <header className={styles.header}>
        <div className={styles.headerText}>
          <div className={styles.topActions}>
            <button
              type="button"
              className={styles.homeButton}
              onClick={() => router.push("/")}
            >
              <Home size={17} />
              {t("issykKulProducts.home")}
            </button>

            <span className={styles.regionBadge}>
              <MapPin size={15} />
              {t("issykKulProducts.region")}
            </span>
          </div>

          <h1>
            {t("issykKulProducts.title")}
            <span> {t("issykKulProducts.titleAccent")}</span>
          </h1>

          <p>{t("issykKulProducts.description")}</p>
        </div>
      </header>

      {/* SEARCH */}

      <section className={styles.toolbar}>
        <div className={styles.search}>
          <Search size={21} />

          <input
            type="text"
            placeholder={t("issykKulProducts.searchPlaceholder")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            autoComplete="off"
            spellCheck={false}
          />

          {search && (
            <button
              type="button"
              className={styles.clearSearch}
              onClick={() => setSearch("")}
              aria-label={t("issykKulProducts.clearSearch")}
            >
              <X size={16} />
            </button>
          )}
        </div>

        <button
          type="button"
          className={styles.filterButton}
          onClick={handleSearch}
          disabled={loading}
        >
          <Search size={19} />
          <span>{t("common.search")}</span>
        </button>
      </section>

      {/* FILTERS */}

      <section id="filters" className={styles.filtersContainer}>
        <div className={styles.filterBlock}>
          <div className={styles.filterHeading}>
            <span>{t("issykKulProducts.filters.propertyType")}</span>
          </div>

          <div className={styles.categories}>
            {translatedCategories.map((category) => {
              const active = activeCategory === category.value;

              return (
                <button
                  key={category.value}
                  type="button"
                  className={active ? styles.categoryActive : ""}
                  onClick={() => setActiveCategory(category.value)}
                >
                  {category.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className={styles.filterBlock}>
          <div className={styles.filterHeading}>
            <span>{t("issykKulProducts.filters.dealType")}</span>
          </div>

          <div className={styles.dealTypes}>
            {translatedDealTypes.map((deal) => {
              const active = dealType === deal.value;

              return (
                <button
                  key={deal.value}
                  type="button"
                  className={active ? styles.dealActive : ""}
                  onClick={() => setDealType(deal.value)}
                >
                  {deal.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className={styles.advancedFilters}>
          <div className={styles.advancedGrid}>
            <CustomSelect
              icon={MapPin}
              title={t("issykKulProducts.filters.cityDistrict")}
              options={translatedCityOptions}
              value={city}
              setValue={setCity}
            />

            <CustomSelect
              icon={DoorOpen}
              title={t("issykKulProducts.filters.rooms")}
              options={translatedRoomOptions}
              value={rooms}
              setValue={setRooms}
            />

            <div className={styles.rangeField}>
              <label>{t("issykKulProducts.filters.price")}</label>

              <div className={styles.rangeInputs}>
                <input
                  type="number"
                  min="0"
                  placeholder={t("issykKulProducts.from")}
                  value={priceFrom}
                  onChange={(event) => setPriceFrom(event.target.value)}
                />

                <input
                  type="number"
                  min="0"
                  placeholder={t("issykKulProducts.to")}
                  value={priceTo}
                  onChange={(event) => setPriceTo(event.target.value)}
                />
              </div>
            </div>

            <div className={styles.rangeField}>
              <label>{t("issykKulProducts.filters.area")}</label>

              <div className={styles.rangeInputs}>
                <input
                  type="number"
                  min="0"
                  placeholder={t("issykKulProducts.from")}
                  value={areaFrom}
                  onChange={(event) => setAreaFrom(event.target.value)}
                />

                <input
                  type="number"
                  min="0"
                  placeholder={t("issykKulProducts.to")}
                  value={areaTo}
                  onChange={(event) => setAreaTo(event.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        <div className={styles.filtersActions}>
          <button
            type="button"
            className={styles.filterButton}
            onClick={handleSearch}
            disabled={loading}
          >
            <Search size={19} />
            {t("common.search")}
          </button>

          {hasDraftFilters && (
            <button
              type="button"
              className={styles.resetButton}
              onClick={resetFilters}
            >
              <X size={15} />
              {t("issykKulProducts.reset")}
            </button>
          )}
        </div>
      </section>

      {/* RESULTS */}

      <div id="results" className={styles.resultsHeader}>
        <div className={styles.result}>
          <span>{t("issykKulProducts.results.title")}</span>

          <strong>{loading ? "..." : filteredListings.length}</strong>

          <span>{t("issykKulProducts.results.count")}</span>
        </div>

        {hasAppliedFilters && !loading && (
          <button
            type="button"
            className={styles.resetButton}
            onClick={resetFilters}
          >
            <X size={15} />
            {t("issykKulProducts.reset")}
          </button>
        )}
      </div>

      {/* LOADING */}

      {loading && (
        <div className={styles.loading}>
          <div className={styles.spinner} />

          <span>{t("issykKulProducts.loading")}</span>
        </div>
      )}

      {/* ERROR */}

      {!loading && error && (
        <div className={styles.error}>
          <X size={20} />
          <span>{error}</span>
        </div>
      )}

      {/* RESULTS */}

      {!loading && !error && (
        <>
          {filteredListings.length > 0 ? (
            <section className={styles.grid}>
              {filteredListings.map((item) => (
                <ListingCard
                  key={item.id}
                  item={item}
                  isFavorite={favIds.has(String(item.id))}
                  onFavoriteClick={handleFavoriteClick}
                />
              ))}
            </section>
          ) : (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>
                <Search size={30} />
              </div>

              <h2>{t("issykKulProducts.empty.title")}</h2>

              <p>{t("issykKulProducts.empty.description")}</p>

              {hasAppliedFilters && (
                <button type="button" onClick={resetFilters}>
                  {t("issykKulProducts.resetFilters")}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </main>
  );
}
