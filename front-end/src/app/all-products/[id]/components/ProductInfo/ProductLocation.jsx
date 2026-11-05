"use client";

import { MapPin, House } from "lucide-react";
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

  const latitude = Number(product?.latitude ?? product?.lat);

  const longitude = Number(product?.longitude ?? product?.lng ?? product?.lon);

  const hasCoordinates =
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180 &&
    (latitude !== 0 || longitude !== 0);

  const locationQuery = hasCoordinates
    ? `${latitude},${longitude}`
    : address || product?.address || "Bishkek, Kyrgyzstan";

  const query = encodeURIComponent(locationQuery);

  const mapUrl = hasCoordinates
    ? `https://maps.google.com/maps?q=${query}&z=16&output=embed`
    : `https://maps.google.com/maps?q=${query}&z=15&output=embed`;

  return (
    <section className={styles.locationSection}>
      <div className={styles.sectionHeader}>
        <div className={styles.locationIcon}>
          <MapPin size={19} />
        </div>

        <div>
          <h2>Расположение</h2>
          <p className={styles.locationSubtitle}>
            Местоположение объекта недвижимости
          </p>
        </div>
      </div>

      <div className={styles.mapContainer}>
        <div className={styles.mapBadge}>
          <div className={styles.mapBadgeIcon}>
            <House size={15} />
          </div>

          <span>Объект недвижимости</span>
        </div>

        <iframe
          title="Карта расположения недвижимости"
          src={mapUrl}
          className={styles.mapFrame}
          loading="lazy"
          allowFullScreen
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>

      {address && (
        <div className={styles.mapAddress}>
          <MapPin size={16} />
          <span>{address}</span>
        </div>
      )}
    </section>
  );
}
