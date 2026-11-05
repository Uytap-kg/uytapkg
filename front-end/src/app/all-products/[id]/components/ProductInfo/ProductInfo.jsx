"use client";

import { Home, Building2, ShieldCheck, CheckCircle2 } from "lucide-react";

import { useLanguage } from "@/context/LanguageContext";
import styles from "./ProductInfo.module.css";

import ProductLocation from "./ProductLocation";
import ProductSidebar from "./ProductSidebar";

import { buildCharacteristics, getAmenities } from "./productInfo.helpers";

export default function ProductInfo({ product, router }) {
  const { t } = useLanguage();

  const characteristics = buildCharacteristics(product, t);
  const amenities = getAmenities(product);

  return (
    <div className={styles.contentGrid}>
      <div className={styles.mainContent}>
        {/* DESCRIPTION */}

        {(product.description || product.title) && (
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div className={styles.sectionIcon}>
                <Home />
              </div>

              <div>
                <span>{t("productInfo.sections.about")}</span>
                <h2>{t("productInfo.sections.description")}</h2>
              </div>
            </div>

            <p className={styles.description}>
              {product.description || t("productInfo.descriptionNotSpecified")}
            </p>
          </section>
        )}

        {/* CHARACTERISTICS */}

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionIcon}>
              <Building2 />
            </div>

            <div>
              <span>{t("productInfo.sections.details")}</span>
              <h2>{t("productInfo.sections.characteristics")}</h2>
            </div>
          </div>

          {characteristics.length > 0 ? (
            <div className={styles.characteristics}>
              {characteristics.map((item) => {
                const Icon = item.icon;

                return (
                  <div className={styles.characteristic} key={item.key}>
                    <div className={styles.characteristicIcon}>
                      <Icon size={19} />
                    </div>

                    <div>
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={styles.emptyBlock}>
              <CheckCircle2 size={20} />

              <span>
                {t("productInfo.additionalCharacteristicsNotSpecified")}
              </span>
            </div>
          )}
        </section>

        {/* AMENITIES */}

        {amenities.length > 0 && (
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div className={styles.sectionIcon}>
                <ShieldCheck />
              </div>

              <div>
                <span>{t("productInfo.sections.additional")}</span>
                <h2>{t("productInfo.sections.amenities")}</h2>
              </div>
            </div>

            <div className={styles.amenities}>
              {amenities.map((item, index) => (
                <div className={styles.amenity} key={`${item}-${index}`}>
                  <CheckCircle2 size={17} />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* LOCATION */}

        <ProductLocation product={product} />
      </div>

      {/* SIDEBAR */}

      <ProductSidebar product={product} router={router} />
    </div>
  );
}
