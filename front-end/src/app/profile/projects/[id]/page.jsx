"use client";

import Image from "next/image";
import { useState, useEffect, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";

import {
  getComplexById,
  getListings,
  getAllListings,
  updateComplex as updateComplexApi,
  deleteComplex as deleteComplexApi,
} from "@/utils/api";

import { mapComplexData } from "@/utils/mapComplexData";
import { mapListingData } from "@/utils/mapListingData";

import { useLanguage } from "@/context/LanguageContext";

import {
  ArrowLeft,
  MapPin,
  Building2,
  Ruler,
  Layers3,
  Pencil,
  Trash2,
  FileCheck,
  ExternalLink,
  Home,
  ArrowRight,
  Trees,
} from "lucide-react";

import styles from "./MycomplexDetails.module.css";

import DeleteModal from "@/components/ui/deleteModal/DeleteMidal";
import EditResidentialComplexModal from "../EditResidentialComplexModal/EditResidentialComplexModal";
import ListingCard from "@/components/ui/ListingCard/ListingCard";

const FALLBACK_IMAGE =
  "https://storage.googleapis.com/bd-kg-02/buildings-v2/800x630/2336.jpg";

const isEmptyValue = (value) =>
  value === undefined ||
  value === null ||
  value === "" ||
  value === 0 ||
  value === "0";

const formatValue = (value, suffix = "", emptyLabel = "Не указано") => {
  if (isEmptyValue(value)) {
    return emptyLabel;
  }

  return `${value}${suffix}`;
};

const formatBlocks = (value, emptyLabel, blocksLabel) => {
  if (isEmptyValue(value)) {
    return emptyLabel;
  }

  const stringValue = String(value);

  if (
    stringValue.toLowerCase().includes("блок") ||
    stringValue.toLowerCase().includes("block")
  ) {
    return stringValue;
  }

  return `${stringValue} ${blocksLabel}`;
};

const formatHeight = (value, emptyLabel, meterLabel) => {
  if (isEmptyValue(value)) {
    return emptyLabel;
  }

  const stringValue = String(value);

  if (stringValue.includes("м")) {
    return stringValue;
  }

  return `${stringValue} ${meterLabel}`;
};

const getDateLabel = (date, language, fallback) => {
  if (!date) return fallback;

  const parsedDate = new Date(date);

  if (Number.isNaN(parsedDate.getTime())) {
    return date;
  }

  return parsedDate.toLocaleDateString(language === "ky" ? "ky-KG" : "ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

/* =========================================================
   GET COMPLEX REFERENCE FROM LISTING
========================================================= */

function getComplexReference(listing) {
  if (!listing) return null;

  const directIds = [
    listing.complexId,
    listing.complex_id,
    listing.residentialComplexId,
    listing.residential_complex_id,
    listing.projectId,
    listing.project_id,
    listing.complexID,
    listing.projectID,
  ];

  for (const value of directIds) {
    if (value !== undefined && value !== null && value !== "") {
      return String(value);
    }
  }

  const nestedIds = [
    listing.complex?.id,
    listing.complex?.complexId,
    listing.residentialComplex?.id,
    listing.residential_complex?.id,
    listing.project?.id,
    listing.project?.projectId,
  ];

  for (const value of nestedIds) {
    if (value !== undefined && value !== null && value !== "") {
      return String(value);
    }
  }

  return null;
}

/* =========================================================
   CHECK LISTING AVAILABILITY
========================================================= */

function isListingAvailable(item) {
  if (!item) return false;

  const booleanValues = [
    item.available,
    item.isAvailable,
    item.is_available,
    item.active,
    item.isActive,
    item.is_active,
    item.published,
    item.isPublished,
    item.is_published,
  ];

  const explicitBoolean = booleanValues.find(
    (value) => typeof value === "boolean",
  );

  if (explicitBoolean === false) {
    return false;
  }

  const status = String(
    item.availabilityStatus ??
      item.availability_status ??
      item.listingStatus ??
      item.listing_status ??
      item.saleStatus ??
      item.sale_status ??
      item.statusName ??
      item.status ??
      "",
  )
    .trim()
    .toLowerCase();

  if (
    status.includes("продан") ||
    status.includes("sold") ||
    status.includes("архив") ||
    status.includes("archive") ||
    status.includes("закрыт") ||
    status.includes("closed") ||
    status.includes("недоступ")
  ) {
    return false;
  }

  return true;
}

/* =========================================================
   NORMALIZE APARTMENT
========================================================= */

function normalizeApartmentListing(item, t) {
  if (!item) return null;

  try {
    const mapped = mapListingData(item);

    const merged = {
      ...item,
      ...mapped,
    };

    return {
      ...mapped,

      id: item.id ?? mapped.id,

      title:
        mapped.title ||
        item.title ||
        item.name ||
        t("myComplexDetail.fallback.apartment"),

      image:
        mapped.image ||
        mapped.images?.[0] ||
        item.cover_photo ||
        item.coverPhoto ||
        item.images?.[0] ||
        item.image ||
        null,

      location:
        mapped.location ||
        mapped.address ||
        item.address ||
        item.city ||
        t("myComplexDetail.fallback.address"),

      type:
        mapped.type ||
        item.type ||
        item.category ||
        item.propertyType ||
        t("myComplexDetail.fallback.apartmentType"),

      description: mapped.description || item.description || "",

      rawComplexId: getComplexReference(merged),

      isAvailable: isListingAvailable(merged),
    };
  } catch (error) {
    console.error("Ошибка mapListingData для квартиры:", item, error);

    return null;
  }
}

export default function MyComplexDetail() {
  const router = useRouter();
  const params = useParams();

  const { t, language } = useLanguage();

  const complexId = params?.id;

  const [residentialComplex, setResidentialComplex] = useState(null);

  const [apartments, setApartments] = useState([]);
  const [apartmentsLoading, setApartmentsLoading] = useState(true);
  const [apartmentsError, setApartmentsError] = useState("");

  const [currentImage, setCurrentImage] = useState(0);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /* =========================================================
     LOAD COMPLEX + APARTMENTS
  ========================================================= */

  useEffect(() => {
    if (!complexId) return;

    let cancelled = false;

    const loadData = async () => {
      try {
        setLoading(true);
        setApartmentsLoading(true);

        setError("");
        setApartmentsError("");

        const [complexResponse, listingsResponse] = await Promise.all([
          getComplexById(complexId),

          getAllListings(),
        ]);

        if (cancelled) return;

        /* =====================================================
           COMPLEX
        ===================================================== */

        if (!complexResponse?.success || !complexResponse?.data) {
          throw new Error(t("myComplexDetail.errors.notFound"));
        }

        const raw = complexResponse.data;
        const mapped = mapComplexData(raw);

        if (!mapped) {
          throw new Error(t("myComplexDetail.errors.processing"));
        }

        const features = raw.features || {};

        const images =
          Array.isArray(mapped.images) && mapped.images.length > 0
            ? mapped.images.filter(Boolean)
            : raw.cover_photo
              ? [raw.cover_photo]
              : [FALLBACK_IMAGE];

        setResidentialComplex({
          id: raw.id,

          name: mapped.name,

          subtitle:
            mapped.housingClass && mapped.address
              ? `${mapped.housingClass} · ${mapped.address}`
              : t("myComplexDetail.fallback.complex"),

          class: mapped.housingClass,

          status: mapped.completionStatus,

          location:
            raw.city || raw.region || t("myComplexDetail.fallback.country"),

          city: raw.city || raw.region || t("myComplexDetail.fallback.country"),

          address: mapped.address,

          developer:
            mapped.developer || t("myComplexDetail.fallback.developer"),

          developerId: mapped.developerId,

          completionDate: raw.completion_date || "",

          floors: features.floors,

          blocks: features.blocks,

          apartments: features.apartments,

          parking: features.parking,

          ceilingHeight: features.ceilingHeight,

          constructionType: features.construction || "",

          landArea:
            features.areaSotka || features.area
              ? {
                  areaSotka: features.areaSotka || null,
                  area: features.area || null,
                }
              : null,

          area: features.area || null,

          areaSotka: features.areaSotka || null,

          description: mapped.description || "",

          concept: raw.description || "",

          images,

          amenities: Array.isArray(mapped.amenities) ? mapped.amenities : [],

          documentsUrl: mapped.documentsUrl || null,

          rawFeatures: features,

          raw,
        });

        setCurrentImage(0);

        /* =====================================================
           APARTMENTS
        ===================================================== */

        if (listingsResponse?.success && Array.isArray(listingsResponse.data)) {
          const currentComplexId = String(complexId);

          const complexApartments = listingsResponse.data
            .map((item) => normalizeApartmentListing(item, t))
            .filter(Boolean)
            .filter((item) => {
              const propertyType = String(
                item.type || item.category || item.propertyType || "",
              )
                .trim()
                .toLowerCase();

              const isApartment =
                propertyType.includes("apartment") ||
                propertyType.includes("квартир") ||
                propertyType === "flat";

              if (!isApartment) {
                return false;
              }

              if (!item.isAvailable) {
                return false;
              }

              return item.rawComplexId === currentComplexId;
            });

          setApartments(complexApartments);
        } else {
          setApartments([]);
        }
      } catch (err) {
        console.error("Failed to load complex detail:", err);

        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : t("myComplexDetail.errors.load"),
          );

          setApartments([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setApartmentsLoading(false);
        }
      }
    };

    loadData();

    return () => {
      cancelled = true;
    };
  }, [complexId, t]);

  /* =========================================================
     IMAGES
  ========================================================= */

  const images = useMemo(() => {
    if (!residentialComplex) {
      return [];
    }

    if (
      Array.isArray(residentialComplex.images) &&
      residentialComplex.images.length > 0
    ) {
      return residentialComplex.images.filter(Boolean);
    }

    return [FALLBACK_IMAGE];
  }, [residentialComplex]);

  const currentImageSrc = images[currentImage] || images[0] || FALLBACK_IMAGE;

  const nextImage = () => {
    if (images.length <= 1) return;

    setCurrentImage((prev) => (prev >= images.length - 1 ? 0 : prev + 1));
  };

  const previousImage = () => {
    if (images.length <= 1) return;

    setCurrentImage((prev) => (prev <= 0 ? images.length - 1 : prev - 1));
  };

  /* =========================================================
     EDIT
  ========================================================= */

  const handleEdit = () => {
    if (!residentialComplex) return;

    setShowEditModal(true);
  };

  /* =========================================================
     SAVE
  ========================================================= */

  const handleSave = async (updatedComplex) => {
    if (!residentialComplex) return;

    try {
      const token = localStorage.getItem("uytap_token");

      if (!token) {
        throw new Error(t("myComplexDetail.errors.unauthorized"));
      }

      const parseNum = (value) => {
        if (value === undefined || value === null || value === "") {
          return null;
        }

        const number = parseFloat(
          String(value)
            .replace(",", ".")
            .replace(/[^\d.-]/g, ""),
        );

        return Number.isNaN(number) ? null : number;
      };

      const payload = {
        name: updatedComplex.name,

        address: updatedComplex.address,

        status: updatedComplex.status,

        class: updatedComplex.class,

        construction:
          updatedComplex.construction || updatedComplex.constructionType,

        completionDate: updatedComplex.completionDate,

        floors: parseNum(updatedComplex.floors),

        blocks: parseNum(updatedComplex.blocks),

        apartments: parseNum(updatedComplex.apartments),

        parking: parseNum(updatedComplex.parking),

        ceilingHeight: parseNum(updatedComplex.ceilingHeight),

        area: parseNum(updatedComplex.area),

        areaSotka: parseNum(
          updatedComplex.landArea || updatedComplex.areaSotka,
        ),

        amenities: Array.isArray(updatedComplex.amenities)
          ? updatedComplex.amenities
          : [],

        images: Array.isArray(updatedComplex.images)
          ? updatedComplex.images.filter(
              (url) => typeof url === "string" && !url.startsWith("blob:"),
            )
          : undefined,
      };

      const response = await updateComplexApi(
        token,
        residentialComplex.id,
        payload,
      );

      if (!response?.success) {
        throw new Error(response?.message || t("myComplexDetail.errors.save"));
      }

      const refreshed = await getComplexById(residentialComplex.id);

      if (!refreshed?.success || !refreshed?.data) {
        throw new Error(t("myComplexDetail.errors.refresh"));
      }

      const raw = refreshed.data;

      const mapped = mapComplexData(raw);

      const features = raw.features || {};

      const refreshedImages =
        Array.isArray(mapped?.images) && mapped.images.length > 0
          ? mapped.images.filter(Boolean)
          : raw.cover_photo
            ? [raw.cover_photo]
            : [FALLBACK_IMAGE];

      setResidentialComplex((prev) => ({
        ...prev,

        id: raw.id,

        name: mapped?.name || raw?.name || prev.name,

        subtitle:
          mapped?.housingClass && mapped?.address
            ? `${mapped.housingClass} · ${mapped.address}`
            : prev.subtitle,

        class: mapped?.housingClass || prev.class,

        status: mapped?.completionStatus || prev.status,

        location: raw.city || raw.region || prev.location,

        city: raw.city || raw.region || prev.city,

        address: mapped?.address || raw.address || prev.address,

        developer: mapped?.developer || prev.developer,

        developerId: mapped?.developerId || prev.developerId,

        completionDate: raw.completion_date || prev.completionDate,

        floors: features.floors,

        blocks: features.blocks,

        apartments: features.apartments,

        parking: features.parking,

        ceilingHeight: features.ceilingHeight,

        constructionType: features.construction || prev.constructionType,

        landArea:
          features.areaSotka || features.area
            ? {
                areaSotka: features.areaSotka || null,
                area: features.area || null,
              }
            : prev.landArea,

        area: features.area || prev.area,

        areaSotka: features.areaSotka || prev.areaSotka,

        description: mapped?.description || prev.description,

        concept: raw.description || prev.concept,

        images: refreshedImages,

        amenities: Array.isArray(mapped?.amenities)
          ? mapped.amenities
          : prev.amenities,

        documentsUrl: mapped?.documentsUrl || prev.documentsUrl,

        rawFeatures: features,

        raw,
      }));

      setCurrentImage(0);
      setShowEditModal(false);
    } catch (err) {
      console.error("Ошибка при сохранении ЖК:", err);

      alert(
        err instanceof Error ? err.message : t("myComplexDetail.errors.save"),
      );
    }
  };

  /* =========================================================
     DELETE
  ========================================================= */

  const handleDelete = async () => {
    if (!residentialComplex) return;

    try {
      const token = localStorage.getItem("uytap_token");

      if (!token) {
        throw new Error(t("myComplexDetail.errors.unauthorized"));
      }

      const response = await deleteComplexApi(token, residentialComplex.id);

      if (!response?.success) {
        throw new Error(
          response?.message || t("myComplexDetail.errors.delete"),
        );
      }

      setShowDeleteModal(false);

      router.push("/profile/projects");
    } catch (err) {
      console.error("Ошибка при удалении ЖК:", err);

      alert(
        err instanceof Error ? err.message : t("myComplexDetail.errors.delete"),
      );
    }
  };

  /* =========================================================
     MINSTROY
  ========================================================= */

  const openMinstroy = () => {
    const url = residentialComplex?.documentsUrl || "https://minstroy.gov.kg/";

    window.open(url, "_blank", "noopener,noreferrer");
  };

  /* =========================================================
   LOADING
========================================================= */

  if (loading) {
    return (
      <main className={styles.page}>
        <div className={styles.container}>
          <div className={styles.loadingState}>
            <span className={styles.loader} />

            <span>{t("myComplexDetail.loading")}</span>
          </div>
        </div>
      </main>
    );
  }

  /* =========================================================
   ERROR
========================================================= */

  if (error || !residentialComplex) {
    return (
      <main className={styles.page}>
        <div className={styles.container}>
          <div className={styles.topBar}>
            <button
              type="button"
              className={styles.back}
              onClick={() => router.push("/profile/projects")}
            >
              <ArrowLeft size={18} />

              {t("myComplexDetail.back.myProjects")}
            </button>
          </div>

          <div className={styles.errorState}>
            <strong>{t("myComplexDetail.errorState.title")}</strong>

            <span>{error || t("myComplexDetail.errorState.notFound")}</span>

            <button
              type="button"
              className={styles.errorButton}
              onClick={() => router.push("/profile/projects")}
            >
              {t("myComplexDetail.errorState.back")}
            </button>
          </div>
        </div>
      </main>
    );
  }

  /* =========================================================
   FORMATTED VALUES
========================================================= */

  const emptyLabel = t("myComplexDetail.fallback.notSpecified");

  const formattedFloors = formatValue(
    residentialComplex.floors,
    ` ${t("myComplexDetail.units.floors")}`,
    emptyLabel,
  );

  const formattedBlocks = formatBlocks(
    residentialComplex.blocks,
    emptyLabel,
    t("myComplexDetail.units.blocks"),
  );

  const formattedApartments = formatValue(
    residentialComplex.apartments,
    ` ${t("myComplexDetail.units.apartments")}`,
    emptyLabel,
  );

  const formattedParking = formatValue(
    residentialComplex.parking,
    ` ${t("myComplexDetail.units.parking")}`,
    emptyLabel,
  );

  const formattedCeilingHeight = formatHeight(
    residentialComplex.ceilingHeight,
    emptyLabel,
    t("myComplexDetail.units.meters"),
  );

  const formattedLandArea = residentialComplex.landArea
    ? residentialComplex.landArea.areaSotka
      ? `${residentialComplex.landArea.areaSotka} ${t(
          "myComplexDetail.units.sotkas",
        )}`
      : residentialComplex.landArea.area
        ? `${residentialComplex.landArea.area} ${t(
            "myComplexDetail.units.squareMeters",
          )}`
        : emptyLabel
    : emptyLabel;

  const completionLabel = getDateLabel(
    residentialComplex.completionDate,
    language,
    t("myComplexDetail.fallback.askDeveloper"),
  );

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        {/* =====================================================
            TOP BAR
        ===================================================== */}

        <div className={styles.topBar}>
          <button
            type="button"
            className={styles.back}
            onClick={() => router.push("/profile/projects")}
          >
            <ArrowLeft size={18} />

            {t("myComplexDetail.back.myProjects")}
          </button>

          <div className={styles.ownerLabel}>
            <Building2 size={16} />

            <span>{t("myComplexDetail.ownerLabel")}</span>
          </div>
        </div>

        {/* =====================================================
            HERO
        ===================================================== */}

        <section className={styles.hero}>
          {/* GALLERY */}

          <div className={styles.heroGallery}>
            <div className={styles.mainImage}>
              <Image
                src={currentImageSrc}
                alt={residentialComplex.name}
                fill
                priority
                sizes="(max-width: 900px) 100vw, 68vw"
              />

              <div className={styles.imageGradient} />

              <div className={styles.heroBadges}>
                <span className={styles.premiumBadge}>
                  {residentialComplex.class}
                </span>

                <span className={styles.statusBadge}>
                  {residentialComplex.status}
                </span>
              </div>

              <button
                type="button"
                className={styles.editImageButton}
                onClick={handleEdit}
                aria-label={t("myComplexDetail.actions.editImageAria")}
              >
                <Pencil size={17} />

                {t("myComplexDetail.actions.edit")}
              </button>

              {images.length > 1 && (
                <>
                  <button
                    type="button"
                    className={`${styles.galleryArrow} ${styles.galleryLeft}`}
                    onClick={previousImage}
                    aria-label={t("myComplexDetail.gallery.previous")}
                  >
                    <ArrowLeft />
                  </button>

                  <button
                    type="button"
                    className={`${styles.galleryArrow} ${styles.galleryRight}`}
                    onClick={nextImage}
                    aria-label={t("myComplexDetail.gallery.next")}
                  >
                    <ArrowRight />
                  </button>
                </>
              )}

              <div className={styles.imageCounter}>
                {currentImage + 1} / {images.length}
              </div>

              <div className={styles.heroImageText}>
                <span>{t("myComplexDetail.labels.myComplex")}</span>

                <strong>{residentialComplex.name}</strong>
              </div>
            </div>

            {images.length > 1 && (
              <div className={styles.thumbnails}>
                {images.map((image, index) => (
                  <button
                    key={`${image}-${index}`}
                    type="button"
                    className={
                      index === currentImage
                        ? `${styles.thumbnail} ${styles.thumbnailActive}`
                        : styles.thumbnail
                    }
                    onClick={() => setCurrentImage(index)}
                  >
                    <Image
                      src={image}
                      alt={`${residentialComplex.name} ${index + 1}`}
                      fill
                      sizes="110px"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* HERO INFO */}

          <div className={styles.heroInfo}>
            <div className={styles.eyebrow}>
              <Building2 size={15} />

              {t("myComplexDetail.labels.myComplex")}
            </div>

            <h1>{residentialComplex.name}</h1>

            <div className={styles.heroLocation}>
              <MapPin size={19} />

              <div>
                <strong>{residentialComplex.location}</strong>

                <span>{residentialComplex.address}</span>
              </div>
            </div>

            <div className={styles.heroDivider} />

            {/* DEVELOPER */}

            <div className={styles.developer}>
              <div className={styles.developerIcon}>
                <Building2 size={18} />
              </div>

              <div>
                <span>{t("myComplexDetail.labels.developer")}</span>

                <strong>{residentialComplex.developer}</strong>
              </div>
            </div>

            {/* STATS */}

            <div className={styles.heroStats}>
              <div>
                <Layers3 />

                <span>
                  <strong>{formattedFloors}</strong>

                  {t("myComplexDetail.labels.floors")}
                </span>
              </div>

              <div>
                <Building2 />

                <span>
                  <strong>{formattedBlocks}</strong>

                  {t("myComplexDetail.labels.blocks")}
                </span>
              </div>

              <div>
                <Ruler />

                <span>
                  <strong>{formattedLandArea}</strong>

                  {t("myComplexDetail.labels.territory")}
                </span>
              </div>
            </div>

            {/* MANAGEMENT */}

            <div className={styles.managementButtons}>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={handleEdit}
              >
                <Pencil size={18} />

                {t("myComplexDetail.actions.editComplex")}
              </button>

              <button
                type="button"
                className={`${styles.actionButton} ${styles.deleteButton}`}
                onClick={() => setShowDeleteModal(true)}
                aria-label={t("myComplexDetail.actions.deleteAria")}
              >
                <Trash2 size={17} />
              </button>
            </div>
          </div>
        </section>

        {/* =====================================================
            AVAILABLE APARTMENTS
        ===================================================== */}

        <section
          className={`${styles.section} ${styles.apartmentsSection}`}
          id="apartments"
        >
          <div className={styles.sectionHeader}>
            <div className={styles.sectionIcon}>
              <Home />
            </div>

            <div>
              <span>
                {t("myComplexDetail.sections.availableApartments.label")}
              </span>

              <h2>
                {t("myComplexDetail.sections.availableApartments.title")}{" "}
                {residentialComplex.name}
              </h2>
            </div>
          </div>

          {apartmentsLoading ? (
            <div className={styles.apartmentsLoading}>
              <span className={styles.loader} />

              <span>{t("myComplexDetail.apartments.loading")}</span>
            </div>
          ) : apartments.length > 0 ? (
            <>
              <div className={styles.apartmentsHeader}>
                <div>
                  <strong>{apartments.length}</strong>

                  <span>
                    {apartments.length === 1
                      ? t("myComplexDetail.apartments.count.one")
                      : apartments.length < 5
                        ? t("myComplexDetail.apartments.count.few")
                        : t("myComplexDetail.apartments.count.many")}
                  </span>
                </div>
              </div>

              <div className={styles.apartmentsGrid}>
                {apartments.map((apartment) => (
                  <ListingCard
                    key={apartment.id}
                    item={apartment}
                    isFavorite={false}
                    onFavoriteClick={() => {}}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className={styles.noApartments}>
              <div className={styles.noApartmentsIcon}>
                <Home />
              </div>

              <h3>{t("myComplexDetail.apartments.empty.title")}</h3>

              <p>{t("myComplexDetail.apartments.empty.description")}</p>
            </div>
          )}

          {apartmentsError && (
            <div className={styles.apartmentsError}>{apartmentsError}</div>
          )}
        </section>

        {/* =====================================================
            ABOUT
        ===================================================== */}

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionIcon}>
              <Building2 />
            </div>

            <div>
              <span>{t("myComplexDetail.sections.about.label")}</span>

              <h2>{t("myComplexDetail.sections.about.title")}</h2>
            </div>
          </div>

          <div className={styles.aboutContent}>
            {residentialComplex.concept ? (
              <p className={styles.description}>{residentialComplex.concept}</p>
            ) : (
              <p className={styles.description}>
                {t("myComplexDetail.fallback.description")}
              </p>
            )}
          </div>
        </section>

        {/* =====================================================
            DETAILS
        ===================================================== */}

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionIcon}>
              <Layers3 />
            </div>

            <div>
              <span>{t("myComplexDetail.sections.details.label")}</span>

              <h2>{t("myComplexDetail.sections.details.title")}</h2>
            </div>
          </div>

          <div className={styles.projectDetails}>
            <div>
              <span>{t("myComplexDetail.details.class")}</span>

              <strong>{residentialComplex.class || emptyLabel}</strong>
            </div>

            <div>
              <span>{t("myComplexDetail.details.apartments")}</span>

              <strong>{formattedApartments}</strong>
            </div>

            <div>
              <span>{t("myComplexDetail.details.floors")}</span>

              <strong>{formattedFloors}</strong>
            </div>

            <div>
              <span>{t("myComplexDetail.details.blocks")}</span>

              <strong>{formattedBlocks}</strong>
            </div>

            <div>
              <span>{t("myComplexDetail.details.landArea")}</span>

              <strong>{formattedLandArea}</strong>
            </div>

            <div>
              <span>{t("myComplexDetail.details.ceilingHeight")}</span>

              <strong>{formattedCeilingHeight}</strong>
            </div>

            <div>
              <span>{t("myComplexDetail.details.construction")}</span>

              <strong>
                {residentialComplex.constructionType || emptyLabel}
              </strong>
            </div>

            <div>
              <span>{t("myComplexDetail.details.parking")}</span>

              <strong>{formattedParking}</strong>
            </div>

            <div>
              <span>{t("myComplexDetail.details.completion")}</span>

              <strong>{completionLabel}</strong>
            </div>
          </div>
        </section>

        {/* =====================================================
            INFRASTRUCTURE
        ===================================================== */}

        {residentialComplex.amenities?.length > 0 && (
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div className={styles.sectionIcon}>
                <Trees />
              </div>

              <div>
                <span>
                  {t("myComplexDetail.sections.infrastructure.label")}
                </span>

                <h2>{t("myComplexDetail.sections.infrastructure.title")}</h2>
              </div>
            </div>

            <div className={styles.infrastructure}>
              {residentialComplex.amenities.map((item, index) => (
                <div
                  className={styles.infrastructureItem}
                  key={`${item}-${index}`}
                >
                  {item}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* =====================================================
            LOCATION
        ===================================================== */}

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionIcon}>
              <MapPin />
            </div>

            <div>
              <span>{t("myComplexDetail.sections.location.label")}</span>

              <h2>{t("myComplexDetail.sections.location.title")}</h2>
            </div>
          </div>

          <div className={styles.addressBlock}>
            <MapPin size={20} />

            <strong>{residentialComplex.address || emptyLabel}</strong>
          </div>
        </section>

        {/* =====================================================
            DOCUMENTS
        ===================================================== */}

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionIcon}>
              <FileCheck />
            </div>

            <div>
              <span>{t("myComplexDetail.sections.documents.label")}</span>

              <h2>{t("myComplexDetail.sections.documents.title")}</h2>
            </div>
          </div>

          <div className={styles.ministryCard}>
            <div className={styles.ministryInfo}>
              <div className={styles.ministryIcon}>
                <FileCheck size={22} />
              </div>

              <div className={styles.ministryText}>
                <strong>{t("myComplexDetail.documents.infoTitle")}</strong>

                <p>{t("myComplexDetail.documents.infoDescription")}</p>
              </div>
            </div>

            <button
              type="button"
              className={styles.ministryButton}
              onClick={openMinstroy}
            >
              <FileCheck size={18} />

              {t("myComplexDetail.documents.button")}

              <ExternalLink size={16} />
            </button>
          </div>
        </section>
      </div>

      {/* =====================================================
          DELETE MODAL
      ===================================================== */}

      <DeleteModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
        title={t("myComplexDetail.deleteModal.title")}
        description={`${t(
          "myComplexDetail.deleteModal.descriptionStart",
        )}${residentialComplex.name}${t(
          "myComplexDetail.deleteModal.descriptionEnd",
        )}`}
      />

      {/* =====================================================
          EDIT MODAL
      ===================================================== */}

      <EditResidentialComplexModal
        complex={showEditModal ? residentialComplex : null}
        onClose={() => setShowEditModal(false)}
        onSave={handleSave}
      />
    </main>
  );
}
