"use client";

import Image from "next/image";

import { Tag, MapPin, UserRound, Phone, ShieldCheck } from "lucide-react";

import { useLanguage } from "@/context/LanguageContext";
import styles from "./ProductInfo.module.css";

import {
  getRawValue,
  hasValue,
  formatValue,
  formatDistance,
  getLocationDetails,
} from "./productInfo.helpers";

export default function ProductSidebar({ product, router }) {
  const { t } = useLanguage();

  const category = getRawValue(product, "category");
  const type = getRawValue(product, "type", "propertyType", "property_type");
  const dealType = getRawValue(product, "dealType", "deal_type");

  const rentalPeriod = getRawValue(product, "rentalPeriod", "rental_period");

  const listingType = getRawValue(product, "listingType", "listing_type");

  const createdAt = getRawValue(product, "createdAt", "created_at");

  const beachDistance = getRawValue(product, "beachDistance", "beach_distance");

  const locationDetails = getLocationDetails(product, t);

  const owner = product?.owner;

  return (
    <aside className={styles.sidebar}>
      {/* INFORMATION */}

      <div className={styles.sideCard}>
        <div className={styles.sideTop}>
          <Tag />
          <span>{t("productInfo.sidebar.information")}</span>
        </div>

        {hasValue(category) && (
          <div className={styles.sideRow}>
            <span>{t("productInfo.fields.category")}</span>
            <strong>{formatValue(category, t)}</strong>
          </div>
        )}

        {hasValue(type) && (
          <div className={styles.sideRow}>
            <span>{t("productInfo.fields.type")}</span>
            <strong>{formatValue(type, t)}</strong>
          </div>
        )}

        {hasValue(dealType) && (
          <div className={styles.sideRow}>
            <span>{t("productInfo.fields.dealType")}</span>
            <strong>{formatValue(dealType, t)}</strong>
          </div>
        )}

        {hasValue(rentalPeriod) && (
          <div className={styles.sideRow}>
            <span>{t("productInfo.fields.rentalPeriod")}</span>
            <strong>{formatValue(rentalPeriod, t)}</strong>
          </div>
        )}

        {hasValue(listingType) && (
          <div className={styles.sideRow}>
            <span>{t("productInfo.fields.listingType")}</span>
            <strong>{formatValue(listingType, t)}</strong>
          </div>
        )}

        {hasValue(createdAt) && (
          <div className={styles.sideRow}>
            <span>{t("productInfo.fields.publicationDate")}</span>
            <strong>{formatValue(createdAt, t)}</strong>
          </div>
        )}

        {hasValue(beachDistance) && (
          <div className={styles.sideRow}>
            <span>{t("productInfo.fields.beachDistance")}</span>
            <strong>{formatDistance(beachDistance, t)}</strong>
          </div>
        )}
      </div>

      {/* LOCATION */}

      {locationDetails.length > 0 && (
        <div className={styles.sideCard}>
          <div className={styles.sideTop}>
            <MapPin />
            <span>{t("productInfo.sidebar.location")}</span>
          </div>

          {locationDetails.map((item, index) => (
            <div className={styles.sideRow} key={`${item.label}-${index}`}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      )}

      {/* OWNER */}

      {owner && (
        <div className={styles.ownerSideCard}>
          <div className={styles.ownerSideHeader}>
            <UserRound />
            {t("productInfo.owner.title")}
          </div>

          <div className={styles.ownerSideProfile}>
            <div className={styles.ownerSideAvatar}>
              <Image
                src={owner.avatar || "https://i.pravatar.cc/150?img=12"}
                alt={owner.name || t("productInfo.owner.title")}
                fill
                sizes="55px"
              />
            </div>

            <div>
              <strong>{owner.name}</strong>

              <span>{owner.role || t("productInfo.owner.defaultRole")}</span>
            </div>
          </div>

          {owner.phone && (
            <a
              href={`https://wa.me/${String(owner.phone).replace(
                /\D/g,
                "",
              )}?text=${encodeURIComponent(
                "Здравствуйте, пишу Вам по поводу объявления на сайте uytap.kg",
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.phoneButton}
            >
              <Phone size={16} />
              {owner.phone}
            </a>
          )}

          {owner.id && (
            <button
              type="button"
              onClick={() => router.push(`/public-profile/${owner.id}`)}
            >
              {t("productInfo.owner.contact")}
            </button>
          )}
        </div>
      )}

      {/* LAWYER */}

      <div className={styles.lawyerCard}>
        <div className={styles.lawyerIcon}>
          <ShieldCheck size={22} />
        </div>

        <div className={styles.lawyerContent}>
          <strong>{t("productInfo.lawyer.title")}</strong>

          <p>{t("productInfo.lawyer.description")}</p>
        </div>

        <button
          type="button"
          className={styles.lawyerButton}
          onClick={() => router.push("/lawyers")}
        >
          {t("productInfo.lawyer.button")}
        </button>
      </div>
    </aside>
  );
}
