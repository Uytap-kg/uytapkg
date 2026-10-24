"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Building2,
  MapPin,
  CalendarDays,
  ArrowUpRight,
  X,
  Layers3,
  BadgeCheck,
  Landmark,
} from "lucide-react";

import { useLanguage } from "@/context/LanguageContext";
import styles from "./MatchedComplexCard.module.css";

const FALLBACK_COMPLEX_IMAGE = "/assets/ComplexImage.png";
const FALLBACK_DEVELOPER_LOGO = "/assets/DeveloperImage.png";

function getImageSource(value, fallback) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

export default function MatchedComplexCard({
  complex,
  onDismiss,
  totalListings,
}) {
  const { t, language } = useLanguage();

  const [imageSrc, setImageSrc] = useState(
    getImageSource(complex?.coverPhoto, FALLBACK_COMPLEX_IMAGE),
  );

  const [logoSrc, setLogoSrc] = useState(
    getImageSource(complex?.developerLogo, FALLBACK_DEVELOPER_LOGO),
  );

  const [imageFailed, setImageFailed] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    setImageSrc(getImageSource(complex?.coverPhoto, FALLBACK_COMPLEX_IMAGE));
    setLogoSrc(getImageSource(complex?.developerLogo, FALLBACK_DEVELOPER_LOGO));
    setImageFailed(false);
    setLogoFailed(false);
  }, [complex?.id, complex?.coverPhoto, complex?.developerLogo]);

  if (!complex || !complex.id) return null;

  const formatCompletion = (value) => {
    if (!value) return null;

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return new Intl.DateTimeFormat(language === "ky" ? "ky-KG" : "ru-RU", {
      year: "numeric",
      month: "long",
    }).format(date);
  };

  const formattedDate = formatCompletion(complex.completionDate);

  const listingsText =
    totalListings !== undefined && totalListings !== null
      ? t("matchedComplex.listingsFound", "Квартир в продаже:").replace(
          /:$/,
          "",
        )
      : t("matchedComplex.showingListings", "Квартиры этого ЖК");

  const hasListingsCount =
    totalListings !== undefined && totalListings !== null;

  return (
    <article
      className={styles.card}
      aria-label={t("matchedComplex.cardLabel", "Карточка жилого комплекса")}
    >
      <div className={styles.imageWrapper}>
        <img
          src={imageSrc}
          alt={
            complex.name || t("matchedComplex.defaultName", "Жилой комплекс")
          }
          className={styles.image}
          loading="lazy"
          onError={() => {
            if (!imageFailed) {
              setImageFailed(true);
              setImageSrc(FALLBACK_COMPLEX_IMAGE);
            }
          }}
        />

        <div className={styles.imageShade} />

        <div className={styles.badges}>
          <span className={styles.complexBadge}>
            <Building2 size={14} />
            {t("matchedComplex.badge", "Жилой комплекс")}
          </span>

          {complex.housingClass && (
            <span className={styles.classBadge}>{complex.housingClass}</span>
          )}
        </div>

        <div className={styles.imageCaption}>
          <span className={styles.imageCaptionIcon}>
            <BadgeCheck size={16} />
          </span>
          <span>{t("matchedComplex.foundEyebrow", "Подходящий проект")}</span>
        </div>
      </div>

      <div className={styles.content}>
        <div className={styles.header}>
          <div className={styles.titleGroup}>
            <span className={styles.eyebrow}>
              {t("matchedComplex.projectLabel", "Ваш найденный ЖК")}
            </span>

            <h3 className={styles.title}>{complex.name}</h3>
          </div>

          {onDismiss && (
            <button
              type="button"
              className={styles.closeButton}
              onClick={onDismiss}
              title={t("matchedComplex.dismiss", "Скрыть карточку")}
              aria-label={t("matchedComplex.dismiss", "Скрыть карточку")}
            >
              <X size={18} />
            </button>
          )}
        </div>

        <div className={styles.detailsGrid}>
          {complex.developer && (
            <div className={styles.developerInfo}>
              <div className={styles.developerLogoWrapper}>
                <img
                  src={logoSrc}
                  alt=""
                  className={styles.developerLogo}
                  loading="lazy"
                  onError={() => {
                    if (!logoFailed) {
                      setLogoFailed(true);
                      setLogoSrc(FALLBACK_DEVELOPER_LOGO);
                    }
                  }}
                />
              </div>

              <div className={styles.developerText}>
                <span className={styles.detailLabel}>
                  {t("matchedComplex.developerLabel", "Застройщик")}
                </span>
                <span className={styles.developerName}>
                  {complex.developer}
                </span>
              </div>
            </div>
          )}

          {complex.address && (
            <div className={styles.detailItem}>
              <span className={styles.detailIcon}>
                <MapPin size={17} />
              </span>

              <div className={styles.detailText}>
                <span className={styles.detailLabel}>
                  {t("matchedComplex.addressLabel", "Адрес")}
                </span>
                <span className={styles.detailValue}>{complex.address}</span>
              </div>
            </div>
          )}

          {formattedDate && (
            <div className={styles.detailItem}>
              <span className={styles.detailIcon}>
                <CalendarDays size={17} />
              </span>

              <div className={styles.detailText}>
                <span className={styles.detailLabel}>
                  {t("matchedComplex.completionLabel", "Срок сдачи")}
                </span>
                <span className={styles.detailValue}>{formattedDate}</span>
              </div>
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <div className={styles.listingsInfo}>
            <span className={styles.listingsIcon}>
              <Layers3 size={18} />
            </span>

            <div className={styles.listingsText}>
              <span className={styles.listingsLabel}>{listingsText}</span>

              <strong>
                {hasListingsCount
                  ? totalListings
                  : t("matchedComplex.availableLabel", "Смотрите предложения")}
              </strong>
            </div>
          </div>

          <Link
            href={`/complexes/${complex.id}`}
            className={styles.viewProjectLink}
          >
            <span>{t("matchedComplex.viewProject", "Подробнее о ЖК")}</span>
            <ArrowUpRight size={17} />
          </Link>
        </div>
      </div>
    </article>
  );
}
