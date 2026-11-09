"use client";

import { useEffect, useState } from "react";
import {
  X,
  Search,
  SlidersHorizontal,
  Map,
  ShieldCheck,
  Home,
  Building2,
  KeyRound,
  CalendarDays,
  ChevronRight,
  MapPin,
  ArrowRight,
} from "lucide-react";

import { useRouter } from "next/navigation";

import { useLanguage } from "@/context/LanguageContext";

import SearchModeSlider from "../SearchModeSlider/SearchModeSlider";
import SmartSearch from "../SmartSearch/SmartSearch";

import styles from "./ProductFilters.module.css";
import ProductFilterSidebar from "./ProductFiltersSidebar/ProductFilterSidebar";
import {
  DAILY_RENTAL_PERIODS,
  LONG_RENTAL_PERIODS,
  applyFilterChanges,
} from "../../utils/filterChanges";

const quickOptions = [
  {
    id: "apartment",
    titleKey: "productsFilters.quick.apartment",
    propertyType: "apartment",
    dealType: "sale",
    rentalPeriod: [],
    icon: Building2,
  },
  {
    id: "house",
    titleKey: "productsFilters.quick.house",
    propertyType: "house",
    dealType: "sale",
    rentalPeriod: [],
    icon: Home,
  },
  {
    id: "long",
    titleKey: "productsFilters.quick.long",
    propertyType: "apartment",
    dealType: "rent",
    rentalPeriod: LONG_RENTAL_PERIODS,
    icon: KeyRound,
  },
  {
    id: "daily",
    titleKey: "productsFilters.quick.daily",
    propertyType: "apartment",
    dealType: "rent",
    rentalPeriod: DAILY_RENTAL_PERIODS,
    icon: CalendarDays,
  },
];

// Нормализация названий городов, районов и адресов
export const normalizeCity = (value = "") => {
  return String(value)
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]/gi, "");
};

// Универсальный поиск по местоположению объявления
export const matchesLocation = (property, searchValue) => {
  if (!searchValue || searchValue.trim() === "" || searchValue === "Все") {
    return true;
  }

  const query = normalizeCity(searchValue);

  if (!query) return true;

  const locationFields = [
    property?.city,
    property?.region,
    property?.district,
    property?.address,
    property?.location,
    property?.neighborhood,
    property?.microdistrict,
    property?.area,
    property?.settlement,
  ];

  return locationFields.some((value) => {
    if (!value) return false;

    // Поддержка строк и массивов значений
    if (Array.isArray(value)) {
      return value.some((item) => normalizeCity(item).includes(query));
    }

    return normalizeCity(value).includes(query);
  });
};

export default function ProductsFilters({
  searchMode,
  setSearchMode,
  filters,
  commitFilters,
  handleSmartSearch,
  handleRemoveSmartFilter,
  resetFilters,
  hasFilters,
  categories,
  categoryLabels,
  categoryComponents,
}) {
  const { t } = useLanguage();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const router = useRouter();

  const [cityValue, setCityValue] = useState(filters.locationQuery || "");

  const [priceFrom, setPriceFrom] = useState(filters.priceFrom || "");
  const [priceTo, setPriceTo] = useState(filters.priceTo || "");

  // Синхронизация полей с применёнными фильтрами
  useEffect(() => {
    setCityValue(filters.locationQuery || "");
    setPriceFrom(filters.priceFrom || "");
    setPriceTo(filters.priceTo || "");
  }, [filters]);

  // Закрытие боковой панели по Escape
  useEffect(() => {
    if (!sidebarOpen) return;

    const previousOverflow = document.body.style.overflow;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setSidebarOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [sidebarOpen]);

  // Быстрые варианты поиска
  const handleQuickOption = (option) => {
    commitFilters(
      applyFilterChanges(filters, {
        propertyType: option.propertyType,
        dealType: option.dealType,
        rentPeriod: "",
        rentalPeriod: [...option.rentalPeriod],
      }),
    );
  };

  // Проверка активного быстрого фильтра
  const isOptionActive = (option) => {
    if (
      filters.propertyType !== option.propertyType ||
      filters.dealType !== option.dealType
    ) {
      return false;
    }

    const selectedPeriods = filters.rentalPeriod || [];

    return (
      !filters.rentPeriod &&
      selectedPeriods.length === option.rentalPeriod.length &&
      option.rentalPeriod.every((period) => selectedPeriods.includes(period))
    );
  };

  // Основной поиск
  const handleSearch = () => {
    const locationQuery = cityValue.trim();

    const changes = { locationQuery, priceFrom, priceTo };

    // Введённое местоположение заменяет выбранное в панели, иначе условия конфликтуют
    if (locationQuery) {
      Object.assign(changes, {
        country: "",
        region: "",
        city: "Все",
        settlement: "",
        district: "",
      });
    }

    commitFilters(applyFilterChanges(filters, changes));
  };

  // Поиск при нажатии Enter
  const handleCityKeyDown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSearch();
    }
  };

  return (
    <section className={styles.compactSearch}>
      <div className={styles.searchContent}>
        <div className={styles.modeSwitch}>
          <SearchModeSlider value={searchMode} onChange={setSearchMode} />
        </div>

        {/* SMART SEARCH */}
        {searchMode === "smart" && (
          <div className={styles.modeContent}>
            <SmartSearch
              onFiltersDetected={handleSmartSearch}
              activeFilters={filters}
              onRemoveFilter={handleRemoveSmartFilter}
              onResetAll={resetFilters}
              categoryLabels={categoryLabels}
            />
          </div>
        )}

        {/* REGULAR FILTER SEARCH */}
        {searchMode === "filters" && (
          <div className={styles.modeContent}>
            <div className={styles.compactTop}>
              <button
                type="button"
                className={styles.allFiltersButton}
                onClick={() => setSidebarOpen(true)}
              >
                <SlidersHorizontal size={16} />
                {t("productsFilters.allFilters")}
                {hasFilters && <span className={styles.filterDot} />}
              </button>
            </div>

            {/* QUICK OPTIONS */}
            <div className={styles.quickOptions}>
              {quickOptions.map((option) => {
                const Icon = option.icon;
                const active = isOptionActive(option);

                return (
                  <button
                    type="button"
                    key={option.id}
                    onClick={() => handleQuickOption(option)}
                    className={`${styles.quickOption} ${
                      active ? styles.quickOptionActive : ""
                    }`}
                  >
                    <Icon size={16} />
                    <span>{t(option.titleKey)}</span>
                  </button>
                );
              })}
            </div>

            {/* SEARCH FIELDS */}
            <div className={styles.searchFields}>
              <label className={styles.searchField}>
                <MapPin size={18} />

                <span>
                  <small>{t("productsFilters.location")}</small>

                  <input
                    type="text"
                    placeholder={t("productsFilters.locationPlaceholder")}
                    value={cityValue}
                    onChange={(event) => setCityValue(event.target.value)}
                    onKeyDown={handleCityKeyDown}
                    autoComplete="off"
                  />
                </span>
              </label>

              <div className={styles.fieldDivider} />

              <div className={styles.priceField}>
                <span>
                  <small>
                    {t("commonFilters.price")}, {filters.currency || "USD"}
                  </small>

                  <div className={styles.priceInputs}>
                    <input
                      type="number"
                      min="0"
                      placeholder={t("commonFilters.from")}
                      value={priceFrom}
                      onChange={(event) => setPriceFrom(event.target.value)}
                    />

                    <span>—</span>

                    <input
                      type="number"
                      min="0"
                      placeholder={t("commonFilters.to")}
                      value={priceTo}
                      onChange={(event) => setPriceTo(event.target.value)}
                    />
                  </div>
                </span>
              </div>

              <button
                type="button"
                className={styles.mainSearchButton}
                onClick={handleSearch}
              >
                <Search size={17} />
                {t("productsFilters.searchButton")}
                <ArrowRight size={15} />
              </button>
            </div>

            {/* QUICK ACTIONS */}
            <div className={styles.quickActions}>
              <button
                type="button"
                className={styles.secondaryAction}
                onClick={() => router.push("/search-map")}
              >
                <Map size={15} />
                {t("productsFilters.searchOnMap")}
                <ChevronRight size={14} />
              </button>

              <button
                type="button"
                className={styles.secondaryAction}
                onClick={() => router.push("/safety")}
              >
                <ShieldCheck size={15} />
                {t("productsFilters.safety")}
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* FILTER SIDEBAR */}
      {sidebarOpen && (
        <ProductFilterSidebar
          filters={filters}
          commitFilters={commitFilters}
          categories={categories}
          categoryLabels={categoryLabels}
          categoryComponents={categoryComponents}
          resetFilters={resetFilters}
          onClose={() => setSidebarOpen(false)}
        />
      )}
    </section>
  );
}
