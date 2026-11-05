"use client";

import { MapPin } from "lucide-react";
import styles from "./ProductInfo.module.css";
import { getLocationParts } from "./productInfo.helpers";

export default function ProductLocation({ product }) {
  const location = getLocationParts(product);

  const address = [
    location?.city,
    location?.district,
    location?.street,
    location?.address,
  ]
    .filter(Boolean)
    .join(", ");

  const query = encodeURIComponent(
    address || product?.address || "Bishkek, Kyrgyzstan",
  );

  return (
    <section className={styles.locationSection}>
      <div className={styles.sectionHeader}>
        <MapPin size={20} />
        <h2>Расположение</h2>
      </div>

      <div
        style={{
          width: "100%",
          height: "320px",
          borderRadius: "14px",
          overflow: "hidden",
          marginTop: "16px",
        }}
      >
        <iframe
          title="Расположение объекта"
          src={`https://maps.google.com/maps?q=${query}&output=embed`}
          width="100%"
          height="100%"
          style={{ border: 0 }}
          loading="lazy"
          allowFullScreen
        />
      </div>
    </section>
  );
}
