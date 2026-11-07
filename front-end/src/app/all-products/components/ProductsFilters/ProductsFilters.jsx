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
  RotateCcw,
} from "lucide-react";

import CommonFilters from "../CommonFilters/CommonFilters";
import SearchModeSlider from "../SearchModeSlider/SearchModeSlider";
import SmartSearch from "../SmartSearch/SmartSearch";

import styles from "./ProductFilters.module.css";

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
  showBeachDistance,
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [cityValue, setCityValue] = useState(
    filters.city === "Все" ? "" : filters.city,
  );

  const [priceFrom, setPriceFrom] = useState(filters.priceFrom || "");
  const [priceTo, setPriceTo] = useState(filters.priceTo || "");

  useEffect(() => {
    setCityValue(filters.city === "Все" ? "" : filters.city);
    setPriceFrom(filters.priceFrom || "");
    setPriceTo(filters.priceTo || "");
  }, [filters.city, filters.priceFrom, filters.priceTo]);

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

  const isOptionActive = (option) => {
    if (
      filters.propertyType !== option.propertyType ||
      filters.dealType !== option.dealType
    ) {
      return false;
    }

    if (option.id === "long") return filters.rentPeriod === "long";
    if (option.id === "daily") return filters.rentPeriod === "daily";

    return !filters.rentPeriod;
  };

  const handleSearch = () => {
    const next = {
      ...filters,
      city: cityValue.trim() || "Все",
      priceFrom,
      priceTo,
    };

    updateFilter("city", next.city);
    updateFilter("priceFrom", priceFrom);
    updateFilter("priceTo", priceTo);

    updateUrl(next);
  };

  return (
    <section className={styles.compactSearch}>
      {/* Стеклянный фон находится в CSS ::before.
          Все элементы интерфейса находятся над ним. */}

      <div className={styles.searchContent}>
        <div className={styles.modeSwitch}>
          <SearchModeSlider value={searchMode} onChange={setSearchMode} />
        </div>

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

            <div className={styles.searchFields}>
              <label className={styles.searchField}>
                <MapPin size={18} />

                <span>
                  <small>Местоположение</small>

                  <input
                    type="text"
                    placeholder="Город или район"
                    value={cityValue}
                    onChange={(e) => setCityValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSearch();
                    }}
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
                      placeholder="От"
                      value={priceFrom}
                      onChange={(e) => setPriceFrom(e.target.value)}
                    />

                    <span>—</span>

                    <input
                      type="number"
                      placeholder="До"
                      value={priceTo}
                      onChange={(e) => setPriceTo(e.target.value)}
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

            <div className={styles.quickActions}>
              <button type="button" className={styles.secondaryAction}>
                <Map size={15} />
                Искать на карте
                <ChevronRight size={14} />
              </button>

              <button type="button" className={styles.secondaryAction}>
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
        <div
          className={styles.sidebarOverlay}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setSidebarOpen(false);
            }
          }}
        >
          <aside
            className={styles.filterSidebar}
            role="dialog"
            aria-modal="true"
            aria-labelledby="filters-title"
          >
            <div className={styles.sidebarHeader}>
              <div>
                <span>UYTAP • SEARCH</span>
                <h2 id="filters-title">Все фильтры</h2>
                <p>Настройте параметры недвижимости</p>
              </div>

              <button
                type="button"
                className={styles.sidebarClose}
                onClick={() => setSidebarOpen(false)}
                aria-label="Закрыть"
              >
                <X size={21} />
              </button>
            </div>

            <div className={styles.sidebarContent}>
              <div className={styles.sidebarSection}>
                <label>Тип недвижимости</label>

                <div className={styles.sidebarCategories}>
                  {categories.map((category) => (
                    <button
                      type="button"
                      key={category.value}
                      className={
                        filters.propertyType === category.value
                          ? styles.sidebarCategoryActive
                          : ""
                      }
                      onClick={() => {
                        updateFilter("propertyType", category.value);
                      }}
                    >
                      {category.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.sidebarSection}>
                <label>Тип сделки</label>

                <div className={styles.sidebarDeal}>
                  <button
                    type="button"
                    className={
                      filters.dealType === "sale"
                        ? styles.sidebarCategoryActive
                        : ""
                    }
                    onClick={() => updateFilter("dealType", "sale")}
                  >
                    Покупка
                  </button>

                  <button
                    type="button"
                    className={
                      filters.dealType === "rent"
                        ? styles.sidebarCategoryActive
                        : ""
                    }
                    onClick={() => updateFilter("dealType", "rent")}
                  >
                    Аренда
                  </button>
                </div>
              </div>

              <div className={styles.sidebarSection}>
                <label>Основные параметры</label>

                <CommonFilters
                  filters={filters}
                  updateFilter={updateFilter}
                  showBeachDistance={showBeachDistance}
                />
              </div>

              <div className={styles.sidebarSection}>
                <div className={styles.sidebarCategoryHeading}>
                  <span>Характеристики</span>
                  <h3>{categoryLabels[filters.propertyType]}</h3>
                </div>

                <CategoryFilters
                  filters={filters}
                  updateFilter={updateFilter}
                />
              </div>
            </div>

            <div className={styles.sidebarFooter}>
              <button
                type="button"
                className={styles.sidebarReset}
                onClick={() => {
                  resetFilters();
                  setSidebarOpen(false);
                }}
              >
                <RotateCcw size={16} />
                Сбросить
              </button>

              <button
                type="button"
                className={styles.sidebarApply}
                onClick={() => {
                  updateUrl(filters);
                  setSidebarOpen(false);
                }}
              >
                <Search size={17} />
                Показать объявления
              </button>
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}
