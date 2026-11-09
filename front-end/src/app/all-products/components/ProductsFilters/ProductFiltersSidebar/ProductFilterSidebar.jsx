"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Search, RotateCcw } from "lucide-react";

import { useLanguage } from "@/context/LanguageContext";

import CommonFilters from "../../CommonFilters/CommonFilters";
import { applyFilterChange } from "../../../utils/filterChanges";
import styles from "./ProductFilterSidebar.module.css";

export default function ProductFilterSidebar({
  filters,
  commitFilters,
  categories = [],
  categoryLabels = {},
  categoryComponents = {},
  resetFilters,
  onClose,
}) {
  const { t } = useLanguage();
  const [mounted, setMounted] = useState(false);

  // Закрытие панели без применения отбрасывает черновик
  const [draft, setDraft] = useState(filters);

  const updateDraft = (key, value) => {
    setDraft((prev) => applyFilterChange(prev, key, value));
  };

  const CategoryFilters =
    categoryComponents[draft.propertyType] || categoryComponents.apartment;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mounted]);

  const handleApply = () => {
    commitFilters(draft);
    onClose();
  };

  const handleReset = () => {
    resetFilters();
    onClose();
  };

  const handlePropertyType = (value) => {
    updateDraft("propertyType", value);
  };

  const handleDealType = (value) => {
    if (draft.dealType === value) return;
    updateDraft("dealType", value);
  };

  if (!mounted) return null;

  return createPortal(
    <div
      className={styles.overlay}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <aside
        className={styles.sidebar}
        role="dialog"
        aria-modal="true"
        aria-labelledby="filters-title"
      >
        <div className={styles.header}>
          <div>
            <span className={styles.eyebrow}>UYTAP • SEARCH</span>
            <h2 id="filters-title">{t("productsFilters.allFilters")}</h2>
            <p>{t("productsFilters.sidebarDescription")}</p>
          </div>

          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label={t("productsFilters.close")}
          >
            <X size={21} />
          </button>
        </div>

        <div className={styles.content}>
          <section className={styles.section}>
            <label className={styles.sectionLabel}>
              {t("productsFilters.propertyType")}
            </label>

            <div className={styles.categories}>
              {categories.map((category) => {
                const isActive = draft.propertyType === category.value;

                return (
                  <button
                    key={category.value}
                    type="button"
                    className={`${styles.categoryButton} ${
                      isActive ? styles.categoryActive : ""
                    }`}
                    aria-pressed={isActive}
                    onClick={() => handlePropertyType(category.value)}
                  >
                    {category.label}
                  </button>
                );
              })}
            </div>
          </section>

          <section className={styles.section}>
            <label className={styles.sectionLabel}>{t("productsFilters.dealType")}</label>

            <div className={styles.dealButtons}>
              <button
                type="button"
                className={`${styles.dealButton} ${
                  draft.dealType === "sale" ? styles.categoryActive : ""
                }`}
                onClick={() => handleDealType("sale")}
              >
                {t("productsFilters.buy")}
              </button>

              <button
                type="button"
                className={`${styles.dealButton} ${
                  draft.dealType === "rent" ? styles.categoryActive : ""
                }`}
                onClick={() => handleDealType("rent")}
              >
                {t("productsFilters.deal.rent")}
              </button>
            </div>
          </section>

          <section className={styles.section}>
            <label className={styles.sectionLabel}>
              {t("productsFilters.locationAndParameters")}
            </label>

            <CommonFilters filters={draft} updateFilter={updateDraft} />
          </section>

          <section className={styles.section}>
            <div className={styles.categoryHeading}>
              <span>{t("productsFilters.characteristics")}</span>
              <h3>
                {categoryLabels[draft.propertyType] ||
                  t("productsFilters.additionalParameters")}
              </h3>
            </div>

            {CategoryFilters && (
              <CategoryFilters
                key={draft.propertyType}
                filters={draft}
                updateFilter={updateDraft}
              />
            )}
          </section>
        </div>

        <div className={styles.footer}>
          <button
            type="button"
            className={styles.resetButton}
            onClick={handleReset}
          >
            <RotateCcw size={16} />
            {t("productsFilters.reset")}
          </button>

          <button
            type="button"
            className={styles.applyButton}
            onClick={handleApply}
          >
            <Search size={17} />
            {t("productsFilters.showListings")}
          </button>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
