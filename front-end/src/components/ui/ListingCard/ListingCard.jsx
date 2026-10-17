"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { MapPin, Heart, Crown, Zap, TrendingUp, Check } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";

import styles from "./ListingCard.module.css";

export default function ListingCard({
  item,
  isFavorite,
  onFavoriteClick,

  // COMPARE
  compareMode = false,
  isSelected = false,
  compareDisabled = false,
  onCompareToggle,
}) {
  const router = useRouter();
  const { t, language } = useLanguage();

  // Normalize status values received from the API or mapped listing.
  const status = String(item?.status ?? "")
    .trim()
    .toLowerCase();

  const promoStatus = String(
    item?.promotion_status ??
      item?.promotionStatus ??
      item?.raw?.promotion_status ??
      "",
  )
    .trim()
    .toLowerCase();

  const isVip =
    ["vip", "premium"].includes(status) ||
    ["vip", "premium"].includes(promoStatus) ||
    item?.isVip === true ||
    item?.is_vip === true ||
    item?.raw?.is_vip === true;

  const isUrgent =
    ["urgent", "срочно"].includes(status) ||
    ["urgent", "срочно"].includes(promoStatus) ||
    item?.isUrgent === true ||
    item?.is_urgent === true ||
    item?.raw?.is_urgent === true;

  const isTop =
    !isVip &&
    (["top", "топ"].includes(status) ||
      ["top", "топ"].includes(promoStatus) ||
      item?.isTop === true ||
      item?.is_top === true ||
      item?.raw?.is_top === true);

  function openListing() {
    if (!item?.id) return;

    router.push(`/all-products/${item.id}`);
  }

  function handleCompareClick(event) {
    event.stopPropagation();

    if (compareDisabled) return;

    onCompareToggle?.(item);
  }

  function getRoomsLabel(rooms) {
    if (language === "ky") {
      return t("listingCard.rooms.one", "бөлмө");
    }

    const n = Math.abs(Number(rooms));
    if (Number.isNaN(n)) {
      return "";
    }

    const count = n % 100;
    const lastDigit = count % 10;

    if (count > 10 && count < 20) {
      return t("listingCard.rooms.many", "комнат");
    }
    if (lastDigit > 1 && lastDigit < 5) {
      return t("listingCard.rooms.few", "комнаты");
    }
    if (lastDigit === 1) {
      return t("listingCard.rooms.one", "комната");
    }
    return t("listingCard.rooms.many", "комнат");
  }

  return (
    <article
      className={`${styles.card} ${
        compareMode && isSelected ? styles.cardSelected : ""
      }`}
      onClick={openListing}
    >
      {/* IMAGE */}

      <div className={styles.image}>
        <Image
          src={item.image}
          fill
          alt={item.title || "Объявление"}
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 400px"
        />

        {/* COMPARE SELECT */}

        {compareMode && (
          <button
            type="button"
            className={`${styles.compareSelect} ${
              isSelected ? styles.compareSelectActive : ""
            } ${compareDisabled ? styles.compareSelectDisabled : ""}`}
            onClick={handleCompareClick}
            disabled={compareDisabled}
            aria-label={
              isSelected
                ? t("listingCard.compare.remove")
                : t("listingCard.compare.add")
            }
            aria-pressed={isSelected}
          >
            <span
              className={`${styles.compareCheckbox} ${
                isSelected ? styles.compareCheckboxActive : ""
              }`}
            >
              {isSelected && <Check />}
            </span>

            <span className={styles.compareSelectText}>
              {isSelected
                ? t("listingCard.compare.selected")
                : compareDisabled
                  ? t("listingCard.compare.otherType")
                  : t("listingCard.compare.button")}
            </span>
          </button>
        )}

        {/* STATUS BADGES */}

        <div
          className={`${styles.badges} ${
            compareMode ? styles.badgesCompare : ""
          }`}
        >
          {isVip && (
            <span className={`${styles.status} ${styles.vip}`}>
              <Crown />
              VIP
            </span>
          )}

          {isUrgent && (
            <span className={`${styles.status} ${styles.urgent}`}>
              <Zap />
              СРОЧНО
            </span>
          )}

          {isTop && (
            <span className={`${styles.status} ${styles.top}`}>
              <TrendingUp />
              TOP
            </span>
          )}

          {item.type && <span className={styles.type}>{item.type}</span>}
        </div>

        {/* FAVORITE */}

        <button
          type="button"
          className={styles.favorite}
          aria-label={
            isFavorite
              ? t("listingCard.favorite.remove")
              : t("listingCard.favorite.add")
          }
          aria-pressed={isFavorite}
          onClick={(event) => {
            event.stopPropagation();
            onFavoriteClick?.(item);
          }}
        >
          <Heart fill={isFavorite ? "currentColor" : "none"} />
        </button>
      </div>

      {/* CONTENT */}

      <div className={styles.content}>
        <h2>{item.title}</h2>

        <div className={styles.location}>
          <MapPin />
          <span>{item.location}</span>
        </div>

        <div className={styles.details}>
          {item.rooms != null && item.rooms !== "" && (
            <span>
              {typeof item.rooms === "number" ||
              !Number.isNaN(Number(item.rooms))
                ? `${item.rooms} ${getRoomsLabel(item.rooms)}`.trim()
                : String(item.rooms)}
            </span>
          )}

          {item.area && <span>{item.area}</span>}
        </div>

        {/* BOTTOM */}

        <div className={styles.bottom}>
          <strong>{item.price}</strong>

          <button
            type="button"
            className={styles.more}
            onClick={(event) => {
              event.stopPropagation();
              openListing();
            }}
          >
            {t("listingCard.details")}
          </button>
        </div>
      </div>
    </article>
  );
}
