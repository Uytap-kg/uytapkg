"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Search, RotateCcw } from "lucide-react";

import CommonFilters from "../../CommonFilters/CommonFilters";
import styles from "./ProductFilterSidebar.module.css";

export default function ProductFilterSidebar({
  filters,
  updateFilter,
  categories = [],
  categoryLabels = {},
  CategoryFilters,
  resetFilters,
  updateUrl,
  onClose,
}) {
  const [mounted, setMounted] = useState(false);

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
    updateUrl(filters);
    onClose();
  };

  const handleReset = () => {
    resetFilters();
    onClose();
  };

  const handlePropertyType = (value) => {
    updateFilter("propertyType", value);
  };

  const handleDealType = (value) => {
    if (filters.dealType === value) return;
    updateFilter("dealType", value);
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
            <h2 id="filters-title">Все фильтры</h2>
            <p>Настройте параметры недвижимости</p>
          </div>

          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Закрыть"
          >
            <X size={21} />
          </button>
        </div>

        <div className={styles.content}>
          <section className={styles.section}>
            <label className={styles.sectionLabel}>Тип недвижимости</label>

            <div className={styles.categories}>
              {categories.map((category) => {
                const isActive = filters.propertyType === category.value;

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
            <label className={styles.sectionLabel}>Тип сделки</label>

            <div className={styles.dealButtons}>
              <button
                type="button"
                className={`${styles.dealButton} ${
                  filters.dealType === "sale" ? styles.categoryActive : ""
                }`}
                onClick={() => handleDealType("sale")}
              >
                Покупка
              </button>

              <button
                type="button"
                className={`${styles.dealButton} ${
                  filters.dealType === "rent" ? styles.categoryActive : ""
                }`}
                onClick={() => handleDealType("rent")}
              >
                Аренда
              </button>
            </div>
          </section>

          <section className={styles.section}>
            <label className={styles.sectionLabel}>
              Местоположение и параметры
            </label>

            <CommonFilters filters={filters} updateFilter={updateFilter} />
          </section>

          <section className={styles.section}>
            <div className={styles.categoryHeading}>
              <span>Характеристики недвижимости</span>
              <h3>
                {categoryLabels[filters.propertyType] ||
                  "Дополнительные параметры"}
              </h3>
            </div>

            {CategoryFilters && (
              <CategoryFilters
                key={filters.propertyType}
                filters={filters}
                updateFilter={updateFilter}
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
            Сбросить
          </button>

          <button
            type="button"
            className={styles.applyButton}
            onClick={handleApply}
          >
            <Search size={17} />
            Показать объявления
          </button>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
