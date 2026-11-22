"use client";

import Image from "next/image";
import {
  ChevronLeft,
  ChevronRight,
  Heart,
  Sparkles,
  Flame,
  Share2,
} from "lucide-react";

import { useLanguage } from "@/context/LanguageContext";
import styles from "./ProductGallery.module.css";

const SITE_URL = "https://uytap.kg";

export default function ProductGallery({
  product,
  images,
  currentImage,
  setCurrentImage,
  isFavorite,
  isFavoriteLoading,
  onFavoriteToggle,
}) {
  const { t } = useLanguage();

  const nextImage = () => {
    if (!images.length) return;

    setCurrentImage((prev) => (prev === images.length - 1 ? 0 : prev + 1));
  };

  const previousImage = () => {
    if (!images.length) return;

    setCurrentImage((prev) => (prev === 0 ? images.length - 1 : prev - 1));
  };

  // SHARE PRODUCT
  const handleShare = async () => {
    if (!product?.id) return;

    const listingUrl = `${SITE_URL}/all-products/${encodeURIComponent(
      product.id,
    )}`;

    const shareText = product.title
      ? `Смотри, какое объявление я нашёл на UyTap.kg: ${product.title}`
      : "Смотри, какое объявление я нашёл на UyTap.kg!";

    if (navigator.share) {
      try {
        await navigator.share({
          title: product.title || "Объявление на UyTap.kg",
          text: shareText,
          url: listingUrl,
        });
      } catch (error) {
        if (error.name !== "AbortError") {
          console.error("Share error:", error);
        }
      }

      return;
    }

    try {
      await navigator.clipboard.writeText(`${shareText}\n${listingUrl}`);

      alert("Ссылка на объявление скопирована!");
    } catch (error) {
      window.prompt("Скопируйте ссылку на объявление:", listingUrl);
    }
  };

  const currentImageSrc = images[currentImage] || images[0];

  return (
    <div className={styles.gallery}>
      <div className={styles.mainImage}>
        <Image
          src={currentImageSrc}
          alt={product.title || t("productGallery.property")}
          fill
          priority
          sizes="(max-width: 900px) 100vw, 65vw"
        />

        <div className={styles.imageOverlay} />

        {/* BADGES */}
        <div className={styles.badges}>
          {product.status === "vip" && (
            <span className={`${styles.badge} ${styles.vip}`}>
              <Sparkles size={14} />
              VIP
            </span>
          )}

          {product.status === "urgent" && (
            <span className={`${styles.badge} ${styles.urgent}`}>
              <Flame size={14} />
              {t("productGallery.urgent")}
            </span>
          )}

          {product.type && (
            <span className={styles.categoryBadge}>{product.type}</span>
          )}
        </div>

        {/* FAVORITE */}
        <button
          type="button"
          className={`${styles.favorite} ${
            isFavorite ? styles.favoriteActive : ""
          }`}
          onClick={onFavoriteToggle}
          disabled={isFavoriteLoading}
          aria-label={
            isFavorite
              ? t("productGallery.removeFavorite")
              : t("productGallery.addFavorite")
          }
        >
          <Heart size={23} fill={isFavorite ? "currentColor" : "none"} />
        </button>

        {/* SHARE */}
        <button
          type="button"
          className={styles.share}
          onClick={handleShare}
          aria-label="Поделиться объявлением"
          title="Поделиться"
        >
          <Share2 size={21} />
        </button>

        {/* ARROWS */}
        {images.length > 1 && (
          <>
            <button
              type="button"
              className={`${styles.galleryArrow} ${styles.left}`}
              onClick={previousImage}
              aria-label={t("productGallery.previousPhoto")}
            >
              <ChevronLeft />
            </button>

            <button
              type="button"
              className={`${styles.galleryArrow} ${styles.right}`}
              onClick={nextImage}
              aria-label={t("productGallery.nextPhoto")}
            >
              <ChevronRight />
            </button>
          </>
        )}

        {/* COUNTER */}
        <div className={styles.imageCounter}>
          {currentImage + 1} / {images.length}
        </div>
      </div>

      {/* THUMBNAILS */}
      {images.length > 1 && (
        <>
          <div className={styles.thumbnails}>
            {images.map((image, index) => (
              <button
                key={`${image}-${index}`}
                type="button"
                className={`${styles.thumbnail} ${
                  index === currentImage ? styles.thumbnailActive : ""
                }`}
                onClick={() => setCurrentImage(index)}
              >
                <Image
                  src={image}
                  alt={`${t("productGallery.photo")} ${index + 1}`}
                  fill
                  sizes="100px"
                />
              </button>
            ))}
          </div>

          <div className={styles.dots}>
            {images.map((_, index) => (
              <button
                key={index}
                type="button"
                className={`${styles.dot} ${
                  index === currentImage ? styles.dotActive : ""
                }`}
                onClick={() => setCurrentImage(index)}
                aria-label={`${t("productGallery.photo")} ${index + 1}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
