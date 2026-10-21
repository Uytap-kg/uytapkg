"use client";

import { useState } from "react";
import Link from "next/link";
import { Building2, MapPin, Calendar, ArrowUpRight, X, Layers } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import styles from "./MatchedComplexCard.module.css";

const FALLBACK_COMPLEX_IMAGE = "/assets/ComplexImage.png";
const FALLBACK_DEVELOPER_LOGO = "/assets/DeveloperImage.png";

export default function MatchedComplexCard({ complex, onDismiss, totalListings }) {
  const { t, language } = useLanguage();
  const [imageSrc, setImageSrc] = useState(complex?.coverPhoto || FALLBACK_COMPLEX_IMAGE);
  const [logoSrc, setLogoSrc] = useState(complex?.developerLogo || FALLBACK_DEVELOPER_LOGO);

  if (!complex || !complex.id) return null;

  // Форматирование даты сдачи (например: 2027-05-01 -> "май 2027" или "2027 г.")
  const formatCompletion = (dateStr) => {
    if (!dateStr) return null;
    try {
      const date = new Date(dateStr);
      if (Number.isNaN(date.getTime())) return String(dateStr);
      return date.toLocaleDateString(language === "ky" ? "ky-KG" : "ru-RU", {
        year: "numeric",
        month: "long",
      });
    } catch {
      return String(dateStr);
    }
  };

  const formattedDate = formatCompletion(complex.completionDate);

  return (
    <div className={styles.card} role="region" aria-label="Найденный жилой комплекс">
      {/* ================= ОБЛОЖКА И БЕЙДЖИ ================= */}
      <div className={styles.imageWrapper}>
        <img
          src={imageSrc}
          alt={complex.name}
          className={styles.image}
          onError={() => setImageSrc(FALLBACK_COMPLEX_IMAGE)}
          loading="lazy"
        />
        <div className={styles.badgeOverlay}>
          <span className={styles.complexBadge}>
            <Building2 size={12} />
            {t("matchedComplex.badge", "Жилой комплекс")}
          </span>
          {complex.housingClass && (
            <span className={styles.classBadge}>
              {complex.housingClass}
            </span>
          )}
        </div>
      </div>

      {/* ================= СОДЕРЖАНИЕ ================= */}
      <div className={styles.content}>
        <div className={styles.header}>
          <div className={styles.titleGroup}>
            <span className={styles.eyebrow}>
              {t("matchedComplex.foundEyebrow", "Найден проект ЖК")}
            </span>
            <h3 className={styles.title}>{complex.name}</h3>
          </div>

          {onDismiss && (
            <button
              type="button"
              className={styles.closeButton}
              onClick={onDismiss}
              title={t("matchedComplex.dismiss", "Скрыть карточку комплекса")}
              aria-label={t("matchedComplex.dismiss", "Скрыть карточку комплекса")}
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* ================= ПАРАМЕТРЫ ЖК ================= */}
        <div className={styles.detailsGrid}>
          {complex.developer && (
            <div className={styles.developerInfo}>
              <img
                src={logoSrc}
                alt={complex.developer}
                className={styles.developerLogo}
                onError={() => setLogoSrc(FALLBACK_DEVELOPER_LOGO)}
              />
              <span className={styles.developerName}>{complex.developer}</span>
            </div>
          )}

          {complex.address && (
            <div className={styles.detailItem}>
              <MapPin size={14} color="#64748b" />
              <span>{complex.address}</span>
            </div>
          )}

          {formattedDate && (
            <div className={styles.detailItem}>
              <Calendar size={14} color="#64748b" />
              <span>{t("matchedComplex.completionPrefix", "Сдача:")} {formattedDate}</span>
            </div>
          )}
        </div>

        {/* ================= ДЕЙСТВИЯ ================= */}
        <div className={styles.actions}>
          <span className={styles.apartmentsHint}>
            <Layers size={15} color="#483df6" />
            {totalListings !== undefined && totalListings !== null
              ? `${t("matchedComplex.listingsFound", "Квартир в этом ЖК в продаже:")} ${totalListings}`
              : t("matchedComplex.showingListings", "Показаны квартиры в этом ЖК")}
          </span>

          <Link
            href={`/complexes/${complex.id}`}
            className={styles.viewProjectLink}
          >
            {t("matchedComplex.viewProject", "О проекте ЖК")}
            <ArrowUpRight size={15} />
          </Link>
        </div>
      </div>
    </div>
  );
}
