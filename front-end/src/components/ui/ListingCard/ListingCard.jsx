"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  MapPin,
  Heart,
  Crown,
  Zap,
  TrendingUp,
  Check,
  Share2,
} from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";

import styles from "./ListingCard.module.css";

const EXCHANGE_RATE = 87.8;
const SITE_URL = "https://uytap.kg";

function formatPrice(value, locale = "ru-RU") {
  return Number(value || 0).toLocaleString(locale, {
    maximumFractionDigits: 0,
  });
}

function toBoolean(value) {
  if (value === true || value === 1) return true;

  if (typeof value === "string") {
    return ["true", "1", "yes", "on"].includes(value.trim().toLowerCase());
  }

  return false;
}

function normalizeStatus(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ");
}

function getPromotion(item = {}) {
  const raw = item.raw || {};

  const status = normalizeStatus(item.status);
  const promotionStatus = normalizeStatus(
    item.promotion_status ??
      item.promotionStatus ??
      raw.promotion_status ??
      raw.promotionStatus,
  );

  const isVip =
    ["vip", "premium"].includes(status) ||
    ["vip", "premium"].includes(promotionStatus) ||
    toBoolean(item.isVip) ||
    toBoolean(item.is_vip) ||
    toBoolean(raw.isVip) ||
    toBoolean(raw.is_vip);

  const isUrgent =
    ["urgent", "срочно"].includes(status) ||
    ["urgent", "срочно"].includes(promotionStatus) ||
    toBoolean(item.isUrgent) ||
    toBoolean(item.is_urgent) ||
    toBoolean(raw.isUrgent) ||
    toBoolean(raw.is_urgent);

  const isTop =
    ["top", "топ", "featured"].includes(status) ||
    ["top", "топ", "featured"].includes(promotionStatus) ||
    toBoolean(item.isTop) ||
    toBoolean(item.is_top) ||
    toBoolean(raw.isTop) ||
    toBoolean(raw.is_top);

  // Приоритет: VIP > СРОЧНО > TOP
  if (isVip) {
    return { isVip: true, isUrgent: false, isTop: false };
  }

  if (isUrgent) {
    return { isVip: false, isUrgent: true, isTop: false };
  }

  if (isTop) {
    return { isVip: false, isUrgent: false, isTop: true };
  }

  return { isVip: false, isUrgent: false, isTop: false };
}

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

  // PRICE CONVERSION
  const currency = String(
    item?.currency || item?.raw?.currency || "USD",
  ).toUpperCase();

  const rawPrice = Number(item?.rawPrice ?? item?.raw?.price ?? 0);
  const isUSD = currency === "USD";

  const mainPrice = isUSD
    ? `$${formatPrice(rawPrice, "en-US")}`
    : `${formatPrice(rawPrice)} сом`;

  const secondaryPrice = isUSD
    ? `≈ ${formatPrice(rawPrice * EXCHANGE_RATE)} сом`
    : `≈ $${formatPrice(rawPrice / EXCHANGE_RATE, "en-US")}`;

  // PROMOTION
  const { isVip, isUrgent, isTop } = getPromotion(item);

  // SHARE LISTING
  async function handleShare(event) {
    event.stopPropagation();

    if (!item?.id) return;

    const listingUrl = `${SITE_URL}/all-products/${encodeURIComponent(
      item.id,
    )}`;

    const shareText = item.title
      ? `Смотри, какое объявление я нашёл на UyTap.kg: ${item.title}`
      : "Смотри, какое объявление я нашёл на UyTap.kg!";

    // Native sharing: mobile devices and supported browsers
    if (navigator.share) {
      try {
        await navigator.share({
          title: item.title || "Объявление на UyTap.kg",
          text: shareText,
          url: listingUrl,
        });
      } catch (error) {
        // Пользователь просто закрыл меню «Поделиться»
        if (error.name !== "AbortError") {
          console.error("Share error:", error);
        }
      }

      return;
    }

    // Fallback: copy link and message
    try {
      await navigator.clipboard.writeText(`${shareText}\n${listingUrl}`);

      alert("Ссылка на объявление скопирована!");
    } catch (error) {
      // Последний fallback для браузеров без Clipboard API
      window.prompt("Скопируйте ссылку на объявление:", listingUrl);
    }
  }

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

          {!isVip && isUrgent && (
            <span className={`${styles.status} ${styles.urgent}`}>
              <Zap />
              СРОЧНО
            </span>
          )}

          {!isVip && !isUrgent && isTop && (
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

        {/* SHARE */}
        <button
          type="button"
          className={styles.share}
          aria-label="Поделиться объявлением"
          title="Поделиться"
          onClick={handleShare}
        >
          <Share2 />
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
          <div className={styles.priceBlock}>
            <strong>{mainPrice}</strong>
            <span className={styles.secondaryPrice}>{secondaryPrice}</span>
          </div>

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
