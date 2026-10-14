"use client";

import { Search, X } from "lucide-react";

import { useLanguage } from "@/context/LanguageContext";

import ListingCard from "@/components/ui/ListingCard/ListingCard";

import styles from "../../AllProducts.module.css";

export default function ProductsResults({
  loading,
  error,

  listings,
  favIds,

  onFavoriteClick,

  hasFilters,
  onReset,

  searchQuery,
  onClearSearchQuery,
}) {
  const { t } = useLanguage();

  const safeListings = Array.isArray(listings) ? listings : [];

  return (
    <>
      {/* =================================================
          RESULTS HEADER
      ================================================= */}

      <div className={styles.resultsHeader}>
        <div>
          <span>{t("productsResults.header.eyebrow")}</span>

          <strong>{loading ? "..." : safeListings.length}</strong>

          <small>{t("productsResults.header.count")}</small>
        </div>

        {searchQuery && (
          <div className={styles.activeSearchBadge}>
            <span>
              {t("productsResults.activeSearch", "Поиск")}: &laquo;{searchQuery}&raquo;
            </span>
            <button
              type="button"
              onClick={onClearSearchQuery}
              title={t("productsResults.clearSearch", "Сбросить поиск")}
              aria-label={t("productsResults.clearSearch", "Сбросить поиск")}
            >
              <X size={13} />
            </button>
          </div>
        )}
      </div>

      {/* =================================================
          LOADING
      ================================================= */}

      {loading && (
        <div className={styles.loading}>
          <div />
          {t("productsResults.loading")}
        </div>
      )}

      {/* =================================================
          ERROR
      ================================================= */}

      {!loading && error && <div className={styles.error}>{error}</div>}

      {/* =================================================
          RESULTS
      ================================================= */}

      {!loading && !error && safeListings.length > 0 && (
        <section className={styles.grid}>
          {safeListings.map((item) => (
            <ListingCard
              key={item.id}
              item={item}
              isFavorite={favIds.has(String(item.id))}
              onFavoriteClick={onFavoriteClick}
            />
          ))}
        </section>
      )}

      {/* =================================================
          EMPTY
      ================================================= */}

      {!loading && !error && safeListings.length === 0 && (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>
            <Search size={27} />
          </div>

          <h2>{t("productsResults.empty.title")}</h2>

          <p>{t("productsResults.empty.description")}</p>

          {hasFilters && (
            <button type="button" onClick={onReset}>
              {t("productsResults.empty.reset")}
            </button>
          )}
        </div>
      )}
    </>
  );
}
