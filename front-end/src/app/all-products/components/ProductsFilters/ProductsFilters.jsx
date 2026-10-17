"use client";

import { Search, X } from "lucide-react";

import { useLanguage } from "@/context/LanguageContext";

import CommonFilters from "../CommonFilters/CommonFilters";
import SearchModeSlider from "../SearchModeSlider/SearchModeSlider";
import SmartSearch from "../SmartSearch/SmartSearch";

import styles from "../../AllProducts.module.css";

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
  const { t } = useLanguage();

  return (
    <>
      <SearchModeSlider value={searchMode} onChange={setSearchMode} />

      {searchMode === "smart" && (
        <SmartSearch
          onFiltersDetected={handleSmartSearch}
          activeFilters={filters}
          onRemoveFilter={handleRemoveSmartFilter}
          onResetAll={resetFilters}
          categoryLabels={categoryLabels}
        />
      )}

      {searchMode === "filters" && (
        <section id="filters" className={styles.filters}>
          {/* =================================================
              HEADER
          ================================================= */}

          <div className={styles.filterHeader}>
            <div>
              <span>{t("productsFilters.header.eyebrow")}</span>

              <h2>{t("productsFilters.header.title")}</h2>
            </div>

            {hasFilters && (
              <button
                type="button"
                className={styles.reset}
                onClick={resetFilters}
              >
                <X size={14} />
                {t("productsFilters.reset")}
              </button>
            )}
          </div>

          {/* =================================================
              PROPERTY TYPE
          ================================================= */}

          <div className={styles.section}>
            <label>{t("productsFilters.propertyType")}</label>

            <div className={styles.categoryList}>
              {categories.map((category) => {
                const active = filters.propertyType === category.value;

                return (
                  <button
                    key={category.value}
                    type="button"
                    className={active ? styles.categoryActive : ""}
                    onClick={() => {
                      updateFilter("propertyType", category.value);
                      updateUrl({ ...filters, propertyType: category.value });
                    }}
                  >
                    {category.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* =================================================
              DEAL
          ================================================= */}

          <div className={styles.section}>
            <label>{t("productsFilters.dealType")}</label>

            <div className={styles.dealList}>
              <button
                type="button"
                className={filters.dealType === "sale" ? styles.dealActive : ""}
                onClick={() => {
                  updateFilter("dealType", "sale");
                  updateUrl({ ...filters, dealType: "sale" });
                }}
              >
                {t("productsFilters.deal.sale")}
              </button>

              <button
                type="button"
                className={filters.dealType === "rent" ? styles.dealActive : ""}
                onClick={() => {
                  updateFilter("dealType", "rent");
                  updateUrl({ ...filters, dealType: "rent" });
                }}
              >
                {t("productsFilters.deal.rent")}
              </button>
            </div>
          </div>

          {/* =================================================
              COMMON FILTERS
          ================================================= */}

          <div className={styles.section}>
            <label>{t("productsFilters.commonParameters")}</label>

            <CommonFilters
              filters={filters}
              updateFilter={updateFilter}
              showBeachDistance={showBeachDistance}
            />
          </div>

          {/* =================================================
              CATEGORY FILTERS
          ================================================= */}

          <div className={styles.categoryFilters}>
            <div className={styles.categoryTitle}>
              <div>
                <span>{t("productsFilters.characteristics")}</span>

                <h3>{categoryLabels[filters.propertyType]}</h3>
              </div>
            </div>

            <CategoryFilters filters={filters} updateFilter={updateFilter} />
          </div>

          {/* =================================================
              APPLY
          ================================================= */}

          <button
            type="button"
            className={styles.apply}
            onClick={() => updateUrl(filters)}
          >
            <Search size={17} />
            {t("productsFilters.showListings")}
          </button>
        </section>
      )}
    </>
  );
}
