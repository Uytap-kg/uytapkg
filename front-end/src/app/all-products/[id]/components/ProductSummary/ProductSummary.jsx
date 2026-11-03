"use client";

import {
  MapPin,
  CalendarDays,
  Ruler,
  LandPlot,
  Layers3,
  BedDouble,
  Building2,
  Waves,
  ExternalLink,
} from "lucide-react";

import { useLanguage } from "@/context/LanguageContext";
import styles from "./ProductSummary.module.css";

const ROOM_TYPES = ["квартира", "дом", "коттедж", "комната"];

function normalizeType(value) {
  if (!value) return "";

  return String(value).trim().toLowerCase().replace(/ё/g, "е");
}

function getRawValue(product, ...keys) {
  for (const key of keys) {
    const rawValue = product?.rawFeatures?.[key];

    if (rawValue !== undefined && rawValue !== null && rawValue !== "") {
      return rawValue;
    }

    const productValue = product?.[key];

    if (
      productValue !== undefined &&
      productValue !== null &&
      productValue !== ""
    ) {
      return productValue;
    }
  }

  return null;
}

function canShowRooms(product) {
  const type = normalizeType(
    getRawValue(product, "type", "category", "property_type", "propertyType"),
  );

  return ROOM_TYPES.some((allowedType) => type.includes(allowedType));
}

function isLand(product) {
  const type = normalizeType(
    getRawValue(product, "type", "category", "property_type", "propertyType"),
  );

  return type.includes("участ");
}

function formatArea(value, land = false) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const stringValue = String(value).trim();

  if (
    stringValue.includes("м²") ||
    stringValue.includes("м2") ||
    stringValue.includes("сот")
  ) {
    return stringValue;
  }

  return land ? `${stringValue} сот.` : `${stringValue} м²`;
}

function formatSeries(value, t) {
  if (!value) return null;

  const normalized = String(value).trim().toLowerCase().replace(/ё/g, "е");

  const labels = {
    "106_normal": t("productSummary.series.106Normal"),
    "106_improved": t("productSummary.series.106Improved"),
    "107_normal": t("productSummary.series.107Normal"),
    "107_improved": t("productSummary.series.107Improved"),
    new_building: t("productSummary.series.newBuilding"),
    newbuilding: t("productSummary.series.newBuilding"),
    elite: t("productSummary.series.elite"),
    eliteka: t("productSummary.series.elite"),
    individual: t("productSummary.series.individual"),
    individualka: t("productSummary.series.individual"),
  };

  return (
    labels[normalized] ||
    labels[normalized.replace(/\s+/g, "_")] ||
    String(value).trim()
  );
}

/*
|--------------------------------------------------------------------------
| 2GIS URL
|--------------------------------------------------------------------------
*/

function getTwoGisUrl(product, displayLocation) {
  const rawLatitude = getRawValue(product, "latitude", "lat");
  const rawLongitude = getRawValue(product, "longitude", "lng", "lon");

  const latitude =
    rawLatitude !== null && rawLatitude !== "" ? Number(rawLatitude) : NaN;

  const longitude =
    rawLongitude !== null && rawLongitude !== "" ? Number(rawLongitude) : NaN;

  const hasCoordinates =
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180;

  if (hasCoordinates) {
    return `https://2gis.kg/geo/${longitude},${latitude}`;
  }

  const address = [product?.address, displayLocation]
    .filter(Boolean)
    .map((item) => String(item).trim())
    .filter((item, index, array) => array.indexOf(item) === index)
    .join(", ");

  if (address) {
    return `https://2gis.kg/search/${encodeURIComponent(address)}`;
  }

  return null;
}

export default function ProductSummary({ product }) {
  const { t } = useLanguage();

  // Формируем город и область вместе
  const city = (product.city || "").trim();
  const region = (product.region || "").trim();
  const district = (product.district || "").trim();

  const parts = [];

  const isBishkek =
    city.toLowerCase() === "бишкек" || region.toLowerCase().includes("бишкек");

  const isOshCity =
    (city.toLowerCase() === "ош" &&
      !region.toLowerCase().includes("область")) ||
    region.toLowerCase() === "ош";

  if (isBishkek) {
    parts.push("Бишкек");

    if (district && district.toLowerCase() !== "бишкек") {
      parts.push(district);
    }
  } else if (isOshCity) {
    parts.push("Ош");

    if (district && district.toLowerCase() !== "ош") {
      parts.push(district);
    }
  } else {
    if (city) parts.push(city);

    if (district && district !== city) {
      parts.push(district);
    }

    if (
      region &&
      region !== "Кыргызстан" &&
      (!city || !region.toLowerCase().includes(city.toLowerCase()))
    ) {
      parts.push(region);
    }
  }

  const displayLocation =
    parts.length > 0
      ? parts.join(", ")
      : product.location && product.location !== "Кыргызстан"
        ? product.location
        : product.address || "";

  const twoGisUrl = getTwoGisUrl(product, displayLocation);

  const area = getRawValue(product, "area");

  const landArea = getRawValue(
    product,
    "landArea",
    "land_area",
    "areaSotka",
    "area_sotka",
    "plotArea",
    "plot_area",
  );

  const floor = getRawValue(product, "floor", "currentFloor", "current_floor");

  const floors = getRawValue(product, "floors", "totalFloors", "total_floors");

  const rooms = getRawValue(product, "rooms", "roomCount", "room_count");

  const series = getRawValue(
    product,
    "series",
    "apartmentSeries",
    "apartment_series",
  );

  const beachDistance = getRawValue(product, "beachDistance", "beach_distance");

  const quickInfo = [];

  if (
    canShowRooms(product) &&
    rooms !== null &&
    rooms !== undefined &&
    Number(rooms) > 0
  ) {
    quickInfo.push({
      icon: BedDouble,
      value: rooms,
      label: t("productSummary.rooms"),
    });
  }

  if (area) {
    quickInfo.push({
      icon: Ruler,
      value: formatArea(area, isLand(product)),
      label: "",
    });
  }

  if (landArea) {
    quickInfo.push({
      icon: LandPlot,
      value: formatArea(landArea, true),
      label: t("productSummary.plot"),
    });
  }

  if (floor) {
    quickInfo.push({
      icon: Layers3,
      value: floors ? `${floor} / ${floors}` : floor,
      label: floors ? t("productSummary.floor") : "",
    });
  }

  if (
    normalizeType(
      getRawValue(product, "type", "propertyType", "property_type"),
    ).includes("квартир")
  ) {
    const formattedSeries = formatSeries(series, t);

    if (formattedSeries) {
      quickInfo.push({
        icon: Building2,
        value: formattedSeries,
        label: "",
      });
    }
  }

  if (beachDistance) {
    quickInfo.push({
      icon: Waves,
      value: `${beachDistance} м`,
      label: t("productSummary.toBeach"),
    });
  }

  return (
    <div className={styles.summary}>
      <div className={styles.summaryTop}>
        <div className={styles.summaryLabels}>
          {product.dealType && (
            <span className={styles.deal}>{product.dealType}</span>
          )}

          {product.listingType && (
            <span className={styles.listingType}>{product.listingType}</span>
          )}
        </div>
      </div>

      <h1>{product.title || t("productSummary.property")}</h1>

      <div className={styles.location}>
        <MapPin size={20} />

        <div>
          {displayLocation ? (
            <strong>{displayLocation}</strong>
          ) : (
            <strong>{t("productSummary.locationNotSpecified")}</strong>
          )}

          {product.address && displayLocation !== product.address && (
            <span>{product.address}</span>
          )}

          {twoGisUrl && (
            <a
              href={twoGisUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.mapLink}
            >
              <MapPin size={16} />
              <span>Посмотреть на карте</span>
              <ExternalLink size={13} />
            </a>
          )}
        </div>
      </div>

      {product.price && <div className={styles.price}>{product.price}</div>}

      {product.rentalPeriod && (
        <div className={styles.rentalInfo}>
          <CalendarDays size={16} />

          <span>
            {t("productSummary.rentalPeriod")}:{" "}
            <strong>{product.rentalPeriod}</strong>
          </span>
        </div>
      )}

      {quickInfo.length > 0 && (
        <div
          className={`${styles.quickInfo} ${
            quickInfo.length === 1 ? styles.quickInfoOne : ""
          }`}
        >
          {quickInfo.slice(0, 5).map((item, index) => {
            const Icon = item.icon;

            return (
              <div key={`${item.value}-${index}`}>
                <Icon />

                <span>
                  <b>{item.value}</b>

                  {item.label && <small>{item.label}</small>}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
