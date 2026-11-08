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

import SearchModeSlider from "../SearchModeSlider/SearchModeSlider";
import SmartSearch from "../SmartSearch/SmartSearch";

import styles from "./ProductFilters.module.css";
import ProductFilterSidebar from "./ProductFiltersSidebar/ProductFilterSidebar";

const quickOptions = [
  {
    id: "apartment",
    title: "Купить квартиру",
    propertyType: "apartment",
    dealType: "sale",
    icon: Building2,
  },
  {
    id: "house",
    title: "Купить дом",
    propertyType: "house",
    dealType: "sale",
    icon: Home,
  },
  {
    id: "long",
    title: "Снять надолго",
    propertyType: "apartment",
    dealType: "rent",
    icon: KeyRound,
  },
  {
    id: "daily",
    title: "Посуточно",
    propertyType: "apartment",
    dealType: "rent",
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
  updateFilter,
  updateUrl,
  handleSmartSearch,
  handleRemoveSmartFilter,
  resetFilters,
  hasFilters,
  categories,
  categoryLabels,
  CategoryFilters,
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const router = useRouter();

  const [cityValue, setCityValue] = useState(
    filters.city === "Все" ? "" : filters.city || "",
  );

  const [priceFrom, setPriceFrom] = useState(filters.priceFrom || "");
  const [priceTo, setPriceTo] = useState(filters.priceTo || "");

  // Синхронизация полей с внешними фильтрами
  useEffect(() => {
    setCityValue(filters.city === "Все" ? "" : filters.city || "");
    setPriceFrom(filters.priceFrom || "");
    setPriceTo(filters.priceTo || "");
  }, [filters.city, filters.priceFrom, filters.priceTo]);

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
    const rentPeriod =
      option.id === "long" ? "long" : option.id === "daily" ? "daily" : "";

    const next = {
      ...filters,
      propertyType: option.propertyType,
      dealType: option.dealType,
      rentPeriod,
    };

    updateFilter("propertyType", option.propertyType);
    updateFilter("dealType", option.dealType);
    updateFilter("rentPeriod", rentPeriod);

    updateUrl(next);
  };

  // Проверка активного быстрого фильтра
  const isOptionActive = (option) => {
    if (
      filters.propertyType !== option.propertyType ||
      filters.dealType !== option.dealType
    ) {
      return false;
    }

    if (option.id === "long") {
      return filters.rentPeriod === "long";
    }

    if (option.id === "daily") {
      return filters.rentPeriod === "daily";
    }

    return !filters.rentPeriod;
  };

  // Основной поиск
  const handleSearch = () => {
    const originalCity = cityValue.trim();

    const next = {
      ...filters,
      city: originalCity || "Все",
      priceFrom,
      priceTo,
    };

    updateFilter("city", next.city);
    updateFilter("priceFrom", priceFrom);
    updateFilter("priceTo", priceTo);

    updateUrl(next);
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
                Все фильтры
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
                    <span>{option.title}</span>
                  </button>
                );
              })}
            </div>

            {/* SEARCH FIELDS */}
            <div className={styles.searchFields}>
              <label className={styles.searchField}>
                <MapPin size={18} />

                <span>
                  <small>Местоположение</small>

                  <input
                    type="text"
                    placeholder="Город, Село или Область"
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
                  <small>Цена, USD</small>

                  <div className={styles.priceInputs}>
                    <input
                      type="number"
                      min="0"
                      placeholder="От"
                      value={priceFrom}
                      onChange={(event) => setPriceFrom(event.target.value)}
                    />

                    <span>—</span>

                    <input
                      type="number"
                      min="0"
                      placeholder="До"
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
                Искать
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
                Искать на карте
                <ChevronRight size={14} />
              </button>

              <button
                type="button"
                className={styles.secondaryAction}
                onClick={() => router.push("/safety")}
              >
                <ShieldCheck size={15} />
                Безопасность
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
          updateFilter={updateFilter}
          categories={categories}
          categoryLabels={categoryLabels}
          CategoryFilters={CategoryFilters}
          resetFilters={resetFilters}
          updateUrl={updateUrl}
          onClose={() => setSidebarOpen(false)}
        />
      )}
    </section>
  );
}
