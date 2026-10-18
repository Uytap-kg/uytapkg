"use client";

import { Heart, Search, House, GitCompare, Check } from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getFavorites, removeFavorite as removeFavoriteApi } from "@/utils/api";
import { mapListingData } from "@/utils/mapListingData";

import { useLanguage } from "@/context/LanguageContext";

import styles from "./Favorites.module.css";
import ListingCard from "@/components/ui/ListingCard/ListingCard";
import CompareListingsModal from "./CompareListingsModal/CompareListingsModal";
import Header from "@/components/pageComponents/header/Header";

const categories = [
  "Все",
  "Дом",
  "Квартира",
  "Коттедж",
  "Участок",
  "Коммерция",
  "Паркинг/гараж",
  "Комнаты",
];

export default function Favorites() {
  const router = useRouter();
  const { t } = useLanguage();

  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("Все");

  // COMPARE
  const [compareMode, setCompareMode] = useState(false);
  const [selectedForCompare, setSelectedForCompare] = useState([]);
  const [compareOpen, setCompareOpen] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("uytap_token");

    if (!token) {
      router.push("/login");
      return;
    }

    setLoading(true);
    setError("");

    getFavorites(token)
      .then((res) => {
        if (res.success && res.data) {
          const mapped = res.data.map((item) => mapListingData(item));
          setFavorites(mapped);
        } else {
          setError(res.message || null);
        }
      })
      .catch((err) => {
        console.error("Load favorites error:", err);
        setError(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [router]);

  async function removeFavorite(id) {
    const token = localStorage.getItem("uytap_token");

    if (!token) return;

    try {
      const res = await removeFavoriteApi(token, id);

      if (res.success) {
        setFavorites((prev) => prev.filter((item) => item.id !== id));

        setSelectedForCompare((prev) => prev.filter((item) => item.id !== id));
      } else {
        alert(res.message || t("favorites.removeError"));
      }
    } catch (err) {
      console.error(err);
      alert(t("favorites.removeFailed"));
    }
  }

  const filteredFavorites = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    const filtered = favorites.filter((item) => {
      const matchesSearch =
        item.title.toLowerCase().includes(normalizedSearch) ||
        item.location.toLowerCase().includes(normalizedSearch);

      const matchesCategory =
        activeCategory === "Все" || item.type === activeCategory;

      return matchesSearch && matchesCategory;
    });

    const priority = {
      vip: 0,
      urgent: 1,
      top: 2,
      null: 3,
    };

    return [...filtered].sort(
      (a, b) =>
        (priority[a.promotion_type ?? a.status] ?? 3) -
        (priority[b.promotion_type ?? b.status] ?? 3),
    );
  }, [favorites, search, activeCategory]);

  /*
   * =========================================================
   * CATEGORY LABELS
   * =========================================================
   */

  const categoryLabels = {
    Все: t("favorites.categories.all"),
    Дом: t("favorites.categories.house"),
    Квартира: t("favorites.categories.apartment"),
    Коттедж: t("favorites.categories.cottage"),
    Участок: t("favorites.categories.land"),
    Коммерция: t("favorites.categories.commercial"),
    "Паркинг/гараж": t("favorites.categories.parking"),
    Комнаты: t("favorites.categories.rooms"),
  };

  /*
   * =========================================================
   * COMPARE
   * =========================================================
   */

  const selectedType = selectedForCompare[0]?.type || null;

  function toggleCompareMode() {
    setCompareMode((prev) => !prev);
    setSelectedForCompare([]);
  }

  function toggleCompareItem(item) {
    if (!compareMode) return;

    const alreadySelected = selectedForCompare.some(
      (selected) => selected.id === item.id,
    );

    if (alreadySelected) {
      setSelectedForCompare((prev) =>
        prev.filter((selected) => selected.id !== item.id),
      );

      return;
    }

    // Только одинаковый тип
    if (selectedType && item.type !== selectedType) {
      return;
    }

    setSelectedForCompare((prev) => [...prev, item]);
  }

  function isCompareDisabled(item) {
    if (!compareMode) return false;

    if (!selectedType) return false;

    return item.type !== selectedType;
  }

  function openCompare() {
    if (selectedForCompare.length < 2) return;

    setCompareOpen(true);
  }

  function closeCompare() {
    setCompareOpen(false);
  }

  function clearCompare() {
    setSelectedForCompare([]);
  }

  return (
    <main className={styles.page}>
      <Header />

      <header className={styles.header}>
        <div className={styles.headerMain}>
          <div className={styles.titleRow}>
            <div className={styles.titleIcon}>
              <Heart fill="currentColor" />
            </div>

            <div>
              <h1>{t("favorites.title")}</h1>

              <p>{t("favorites.description")}</p>
            </div>
          </div>
        </div>

        <div className={styles.counter}>
          <Heart fill="currentColor" />

          <strong>{favorites.length}</strong>

          <span>
            {favorites.length === 1
              ? t("favorites.listing.one")
              : favorites.length < 5
                ? t("favorites.listing.few")
                : t("favorites.listing.many")}
          </span>
        </div>
      </header>

      {/* SEARCH */}

      {favorites.length > 0 && (
        <>
          <div className={styles.toolbar}>
            <div className={styles.search}>
              <Search />

              <input
                type="text"
                placeholder={t("favorites.searchPlaceholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {/* COMPARE BUTTON */}

            <button
              type="button"
              className={`${styles.compareButton} ${
                compareMode ? styles.compareButtonActive : ""
              }`}
              onClick={toggleCompareMode}
            >
              {compareMode ? <Check size={17} /> : <GitCompare size={17} />}

              <span>
                {compareMode
                  ? t("favorites.cancelCompare")
                  : t("favorites.compareObjects")}
              </span>
            </button>
          </div>

          {/* CATEGORIES */}

          <div className={styles.categories}>
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                className={
                  activeCategory === category ? styles.categoryActive : ""
                }
                onClick={() => setActiveCategory(category)}
              >
                {categoryLabels[category]}
              </button>
            ))}
          </div>

          {/* COMPARE INFO */}

          {compareMode && (
            <div className={styles.compareHint}>
              <GitCompare size={16} />

              <div>
                <strong>
                  {selectedForCompare.length > 0
                    ? `${t("favorites.selected")}: ${selectedForCompare.length}`
                    : t("favorites.selectForCompare")}
                </strong>

                <span>
                  {selectedType
                    ? `${t("favorites.onlyType")}: ${selectedType}`
                    : t("favorites.sameTypeOnly")}
                </span>
              </div>
            </div>
          )}

          {/* RESULT */}

          <div className={styles.result}>
            <span>{t("favorites.foundInFavorites")}</span>

            <strong>{filteredFavorites.length}</strong>
          </div>
        </>
      )}

      {/* PRODUCTS */}

      {loading ? (
        <div className={styles.loading}>
          <span className={styles.loadingSpinner} />

          <div>{t("favorites.loading")}</div>
        </div>
      ) : error ? (
        <div className={styles.error}>{error || t("favorites.loadError")}</div>
      ) : filteredFavorites.length > 0 ? (
        <section
          className={`${styles.grid} ${
            compareMode ? styles.gridCompareMode : ""
          }`}
        >
          {filteredFavorites.map((item) => {
            const selected = selectedForCompare.some(
              (selectedItem) => selectedItem.id === item.id,
            );

            const disabled = isCompareDisabled(item);

            return (
              <div
                key={item.id}
                className={`${styles.compareWrapper} ${
                  compareMode && selected ? styles.compareWrapperSelected : ""
                } ${
                  compareMode && disabled ? styles.compareWrapperDisabled : ""
                }`}
              >
                {compareMode && (
                  <button
                    type="button"
                    className={`${styles.compareCheck} ${
                      selected ? styles.compareCheckSelected : ""
                    }`}
                    disabled={disabled}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleCompareItem(item);
                    }}
                    aria-label={
                      selected
                        ? t("favorites.removeFromCompare")
                        : t("favorites.addToCompare")
                    }
                  >
                    {selected && <Check size={15} />}
                  </button>
                )}

                <ListingCard
                  item={item}
                  isFavorite={true}
                  onFavoriteClick={(clickedItem) =>
                    removeFavorite(clickedItem.id)
                  }
                />

                {compareMode && disabled && (
                  <div className={styles.compareDisabledOverlay} />
                )}
              </div>
            );
          })}
        </section>
      ) : favorites.length > 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>
            <Search />
          </div>

          <h2>{t("favorites.nothingFound")}</h2>

          <p>{t("favorites.noMatchingListings")}</p>

          <button
            type="button"
            onClick={() => {
              setSearch("");
              setActiveCategory("Все");
            }}
          >
            {t("favorites.resetFilters")}
          </button>
        </div>
      ) : (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>
            <Heart />
          </div>

          <h2>{t("favorites.emptyTitle")}</h2>

          <p>{t("favorites.emptyDescription")}</p>

          <button type="button" onClick={() => router.push("/all-products")}>
            {t("favorites.viewListings")}
          </button>
        </div>
      )}

      {/* FLOATING COMPARE BAR */}

      {compareMode && selectedForCompare.length > 0 && (
        <div className={styles.compareBar}>
          <div className={styles.compareBarInfo}>
            <GitCompare size={19} />

            <div>
              <strong>
                {selectedForCompare.length}{" "}
                {selectedForCompare.length === 1
                  ? t("favorites.objectSelected.one")
                  : t("favorites.objectSelected.many")}
              </strong>

              <span>{selectedType}</span>
            </div>
          </div>

          <div className={styles.compareBarActions}>
            <button
              type="button"
              className={styles.clearCompare}
              onClick={clearCompare}
            >
              {t("favorites.clear")}
            </button>

            <button
              type="button"
              className={styles.startCompare}
              disabled={selectedForCompare.length < 2}
              onClick={openCompare}
            >
              <GitCompare size={16} />

              {t("favorites.compare")}

              {selectedForCompare.length >= 2 &&
                ` (${selectedForCompare.length})`}
            </button>
          </div>
        </div>
      )}

      {/* COMPARE MODAL */}

      <CompareListingsModal
        isOpen={compareOpen}
        items={selectedForCompare}
        onClose={closeCompare}
      />
    </main>
  );
}
