"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { House } from "lucide-react";

import { useLanguage } from "@/context/LanguageContext";
import { createListing, getConstants, uploadListingPhoto } from "@/utils/api";

import StepProgress from "./components/StepProgress/StepProgress";
import StepImage from "./components/StepImage/StepImage";
import StepLocation from "./components/StepLocation/StepLocation";
import StepDeal from "./components/StepDeal/StepDeal";
import StepCategory from "./components/StepCategory/StepCategory";
import StepAddress from "./components/StepAddress/StepAddress";
import StepListingType from "./components/StepListingType/StepListingType";

import styles from "./AddProduct.module.css";

/* =========================================================
   BOOST
========================================================= */

const DEFAULT_BOOST_DAYS = 7;

/* =========================================================
   INITIAL FORM
========================================================= */

const initialForm = {
  title: "",

  // =========================
  // ФОТО
  // =========================

  images: [],

  // =========================
  // МЕСТОПОЛОЖЕНИЕ
  // =========================

  country: "Кыргызстан",
  region: "",
  city: "",
  settlement: "",
  location: "",
  district: "",

  // =========================
  // СДЕЛКА
  // =========================

  dealType: "",
  rentalPeriod: "",

  // =========================
  // КАТЕГОРИЯ
  // =========================

  category: "",

  // =========================
  // ЦЕНА
  // =========================

  priceFrom: "",
  priceTo: "",
  price: "",

  // =========================
  // ПЛОЩАДЬ
  // =========================

  areaFrom: "",
  areaTo: "",
  area: "",

  // =========================
  // ИССЫК-КУЛЬ
  // =========================

  beachDistance: "",

  // =========================
  // ЗАСТРОЙЩИК / ЖК
  // =========================

  developerOrComplex: "",

  // =========================
  // ХАРАКТЕРИСТИКИ
  // =========================

  series: "",
  residentialComplex: "",
  residentialComplexId: "",
  rooms: "",
  floor: "",
  condition: "",
  walls: "",
  heating: "",
  documents: "",
  furniture: "",

  houseType: "",
  floors: "",
  sewerage: "",
  water: "",
  electricity: "",

  purpose: "",
  fence: "",
  terrain: "",
  communications: "",

  roomsInApartment: "",
  privateBathroom: "",
  roomLocation: "",

  premisesType: "",
  technicalParameters: "",
  firstLine: "",
  separateEntrance: "",
  rentalBusiness: "",

  ceilingHeight: "",
  parkingType: "",
  material: "",
  security: "",
  gates: "",
  inspectionPit: "",
  basement: "",
  truckAccess: "",
  gateType: "",

  offerType: "",

  // =========================
  // УДОБСТВА
  // =========================

  amenities: [],

  // =========================
  // ДОПОЛНИТЕЛЬНЫЕ
  // =========================

  wifi: "",
  pool: "",
  bath: "",
  view: "",
  parking: "",
  beach: "",
  pets: "",
  children: "",
  buildingType: "",
  repair: "",

  // =========================
  // АДРЕС
  // =========================

  address: "",
  latitude: null,
  longitude: null,

  // =========================
  // ТИП РАЗМЕЩЕНИЯ
  // =========================

  listingType: "",

  // =========================
  // ОПИСАНИЕ
  // =========================

  description: "",
};

/* =========================================================
   CATEGORY TITLES
   Для generatedDescription.
========================================================= */

const russianCategoryTitles = {
  apartment: "квартира",
  house: "дом",
  cottage: "коттедж",
  land: "земельный участок",
  room: "комната",
  commercial: "коммерческое помещение",
  parking: "паркинг",
};

/* =========================================================
   COMPONENT
========================================================= */

export default function AddProductPage() {
  const router = useRouter();

  const { t, language } = useLanguage();

  const [step, setStep] = useState(1);

  const [form, setForm] = useState(initialForm);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const [submitMessage, setSubmitMessage] = useState("");

  const [submitSuccess, setSubmitSuccess] = useState(false);

  const totalSteps = 6;

  /* =========================================================
     FORM UPDATE
  ========================================================= */

  function updateForm(values) {
    setForm((prev) => ({
      ...prev,
      ...values,
    }));
  }

  /* =========================================================
     NAVIGATION
  ========================================================= */

  function nextStep() {
    setStep((prev) => Math.min(prev + 1, totalSteps));

    setSubmitMessage("");
    setSubmitSuccess(false);
  }

  function prevStep() {
    setStep((prev) => Math.max(prev - 1, 1));

    setSubmitMessage("");
    setSubmitSuccess(false);
  }

  /* =========================================================
     CATEGORY TITLE
  ========================================================= */

  function getCategoryTitle(category) {
    if (language === "ru") {
      return russianCategoryTitles[category] || "объект недвижимости";
    }

    const translated = t(`addProduct.categoryTitles.${category}`);

    if (translated && translated !== `addProduct.categoryTitles.${category}`) {
      return translated;
    }

    return (
      russianCategoryTitles[category] || t("addProduct.categoryTitles.default")
    );
  }

  /* =========================================================
     SUBMIT
  ========================================================= */

  async function submitProduct() {
    if (isSubmitting) {
      return null;
    }

    setIsSubmitting(true);
    setSubmitMessage("");
    setSubmitSuccess(false);

    try {
      const token = localStorage.getItem("uytap_token");

      if (!token) {
        router.push("/auth-required");

        return null;
      }

      /* =====================================================
         ВАЛИДАЦИЯ
      ===================================================== */

      if (!form.title?.trim()) {
        throw new Error(t("addProduct.errors.titleRequired"));
      }

      if (!form.images?.length) {
        throw new Error(t("addProduct.errors.imagesRequired"));
      }

      if (!form.category) {
        throw new Error(t("addProduct.errors.categoryRequired"));
      }

      if (!form.dealType) {
        throw new Error(t("addProduct.errors.dealRequired"));
      }

      /* =====================================================
         ЦЕНА
      ===================================================== */

      const price = Number(form.price);

      const derivedPrice = price > 0 ? price : 100000;

      /* =====================================================
         ПЛОЩАДЬ
      ===================================================== */

      const area = Number(form.area);

      const derivedArea = area > 0 ? area : null;

      /* =====================================================
         ИССЫК-КУЛЬ
      ===================================================== */

      const isIssykKul =
        form.region === "ISSYK_KUL" ||
        form.region === "issykKul" ||
        form.region === "ISSYK-KUL" ||
        form.region === "issyk-kul";

      const beachDistanceValue =
        isIssykKul && Number(form.beachDistance) > 0
          ? Number(form.beachDistance)
          : null;

      /* =====================================================
         КАТЕГОРИЯ
      ===================================================== */

      const categoryTitle = getCategoryTitle(form.category);

      /* =====================================================
         ОПИСАНИЕ
      ===================================================== */

      const locationText =
        form.location ||
        form.city ||
        form.settlement ||
        form.region ||
        t("addProduct.defaultCountry");

      const generatedDescription = [
        `${t("addProduct.generatedDescription.object")}: ${categoryTitle}.`,

        `${t("addProduct.generatedDescription.location")}: ${locationText}.`,

        form.district
          ? `${t(
              "addProduct.generatedDescription.district",
            )}: ${form.district}.`
          : "",

        form.address
          ? `${t("addProduct.generatedDescription.address")}: ${form.address}.`
          : "",

        form.developerOrComplex
          ? `${t(
              "addProduct.generatedDescription.developer",
            )}: ${form.developerOrComplex}.`
          : "",
      ]
        .filter(Boolean)
        .join(" ");

      const description = form.description?.trim() || generatedDescription;

      /* =====================================================
         ФОТО
      ===================================================== */

      const photos = [];

      for (const img of form.images || []) {
        if (img.file) {
          try {
            const uploadedUrl = await uploadListingPhoto(token, img.file);

            photos.push(uploadedUrl);
          } catch (e) {
            console.error("Failed to upload image:", img.file.name, e);

            throw new Error(
              `${t("addProduct.errors.photoUpload")} ${img.file.name}: ${
                e.message || t("addProduct.errors.unknown")
              }`,
            );
          }
        } else if (img.url && !img.url.startsWith("blob:")) {
          photos.push(img.url);
        }
      }

      /* =====================================================
         УДОБСТВА
      ===================================================== */

      const selectedAmenities = Array.isArray(form.amenities)
        ? form.amenities.filter((item) => item && item !== "Любые")
        : form.amenities && form.amenities !== "Любые"
          ? [form.amenities]
          : [];

      /* =====================================================
         CONSTANTS
      ===================================================== */

      let resortAmenities = [];

      try {
        const constants = await getConstants();

        const data = constants?.data || constants;

        resortAmenities = data?.amenities?.resort || [];
      } catch (e) {
        console.error("Failed to fetch constants for amenities split", e);
      }

      /* =====================================================
         РАЗДЕЛЕНИЕ УДОБСТВ
      ===================================================== */

      const resortSelectedAmenities = selectedAmenities.filter((amenity) =>
        resortAmenities.includes(amenity),
      );

      const generalSelectedAmenities = selectedAmenities.filter(
        (amenity) => !resortAmenities.includes(amenity),
      );

      /* =====================================================
         FEATURES
      ===================================================== */

      const features = {
        // Общие
        series: form.series || null,

        residentialComplexName: form.residentialComplex || null,

        rooms: form.rooms ? Number(form.rooms) : null,

        floor: form.floor || null,

        condition: form.condition || null,

        walls: form.walls || null,

        heating: form.heating || null,

        documents: form.documents || null,

        furniture: form.furniture || null,

        offerType: form.offerType || null,

        // Дом
        houseType: form.houseType || null,

        floors: form.floors || null,

        sewerage: form.sewerage || null,

        water: form.water || null,

        electricity: form.electricity || null,

        // Участок
        purpose: form.purpose || null,

        fence: form.fence || null,

        location: form.landLocation || null,

        terrain: form.terrain || null,

        communications: form.communications || null,

        // Комната
        roomsInApartment: form.roomsInApartment
          ? Number(form.roomsInApartment)
          : null,

        privateBathroom: form.privateBathroom || null,

        roomLocation: form.roomLocation || null,

        // Коммерция
        premisesType: form.premisesType || null,

        technicalParameters: form.technicalParameters || null,

        firstLine: form.firstLine || null,

        separateEntrance: form.separateEntrance || null,

        rentalBusiness: form.rentalBusiness || null,

        // Паркинг
        ceilingHeight: form.ceilingHeight || null,

        parkingType: form.parkingType || null,

        material: form.material || null,

        security: form.security || null,

        gates: form.gates || null,

        inspectionPit: form.inspectionPit || null,

        basement: form.basement || null,

        truckAccess: form.truckAccess || null,

        gateType: form.gateType || null,

        // Дополнительные
        wifi: form.wifi || null,

        pool: form.pool || null,

        bath: form.bath || null,

        view: form.view || null,

        parking: form.parking || null,

        beach: form.beach || null,

        pets: form.pets || null,

        children: form.children || null,

        buildingType: form.buildingType || null,

        repair: form.repair || null,

        // Общие удобства
        amenities: generalSelectedAmenities,
      };

      /* =====================================================
         PAYLOAD
      ===================================================== */

      const payload = {
        // Основное
        title: form.title.trim(),

        description,

        propertyType: form.category,

        // Сделка
        dealType: form.dealType,

        rentPeriod:
          form.dealType === "rent"
            ? form.rentalPeriod === "longTerm"
              ? "long_term"
              : form.rentalPeriod === "shortTerm"
                ? "weekly"
                : form.rentalPeriod || null
            : null,

        // Местоположение
        country: form.country || "Кыргызстан",

        region: form.country === "turkey" ? "TURKEY" : form.region || "BISHKEK",

        city:
          (form.country === "turkey"
            ? form.city
            : form.region === "BISHKEK" || form.region === "bishkek"
              ? "Бишкек"
              : form.settlement || form.city || form.location) || null,

        district: form.district || null,

        // Адрес
        address: form.address || null,

        latitude: form.latitude ?? null,

        longitude: form.longitude ?? null,

        // Цена
        price: derivedPrice,

        priceFrom: price > 0 ? price : null,

        priceTo: price > 0 ? price : null,

        currency: "USD",

        // Площадь
        area: derivedArea,

        areaFrom: derivedArea,

        areaTo: derivedArea,

        // Иссык-Куль
        beachDistanceFrom: beachDistanceValue,

        beachDistanceTo: beachDistanceValue,

        // Застройщик / ЖК
        developerOrComplex: form.developerOrComplex || null,

        residentialComplexId: form.residentialComplexId || null,

        // Тип размещения
        listingType: form.listingType || "standard",

        // Продвижение
        days: ["vip", "top", "urgent"].includes(form.listingType)
          ? DEFAULT_BOOST_DAYS
          : form.listingType === "instagram"
            ? 1
            : undefined,

        // Фото
        photos,

        // Основные параметры
        rooms: form.rooms ? Number(form.rooms) : null,

        floor: form.floor ? Number(form.floor) : null,

        totalFloors: form.floors ? Number(form.floors) : null,

        // Features
        features,

        // Resort
        isResort: isIssykKul,

        resortFilters: {
          beachDistanceFrom: beachDistanceValue,

          beachDistanceTo: beachDistanceValue,

          developerOrComplex: form.developerOrComplex || null,

          amenities: resortSelectedAmenities,
        },
      };

      console.log("📦 Данные объявления:", payload);

      /* =====================================================
         CREATE LISTING
      ===================================================== */

      const result = await createListing(token, payload);

      setSubmitSuccess(true);

      setSubmitMessage(result?.message || t("addProduct.success"));

      /* =====================================================
         CLEAN BLOB URLS
      ===================================================== */

      form.images?.forEach((image) => {
        if (image?.url?.startsWith("blob:")) {
          URL.revokeObjectURL(image.url);
        }
      });

      /* =====================================================
         RESET
      ===================================================== */

      setForm(initialForm);

      setStep(1);

      /* =====================================================
         PAYMENT
      ===================================================== */

      if (result?.needsPayment && result?.promotion && result?.data?.id) {
        const params = new URLSearchParams({
          type: "promotion",

          listingId: result.data.id,

          serviceType: result.promotion.serviceType,

          days: String(result.promotion.days),
        });

        router.push(`/payment?${params.toString()}`);

        return result;
      }

      /* =====================================================
         FREE / ALREADY PAID
      ===================================================== */

      setSubmitMessage(result?.message || t("addProduct.success"));

      router.push("/profile/ads");

      return result;
    } catch (error) {
      console.error("Ошибка публикации:", error);

      setSubmitSuccess(false);

      setSubmitMessage(error?.message || t("addProduct.errors.publish"));

      return null;
    } finally {
      setIsSubmitting(false);
    }
  }

  /* =========================================================
     RENDER
  ========================================================= */

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <Link href="/" className={styles.homeButton}>
          <House size={18} />

          {t("addProduct.home")}
        </Link>

        <StepProgress currentStep={step} totalSteps={totalSteps} />

        <div className={styles.card}>
          {/* =========================================
              STEP 1 — ФОТОГРАФИИ
          ========================================= */}

          {step === 1 && (
            <StepImage form={form} updateForm={updateForm} onNext={nextStep} />
          )}

          {/* =========================================
              STEP 2 — МЕСТОПОЛОЖЕНИЕ
          ========================================= */}

          {step === 2 && (
            <StepLocation
              form={form}
              updateForm={updateForm}
              onNext={nextStep}
            />
          )}

          {/* =========================================
              STEP 3 — СДЕЛКА
          ========================================= */}

          {step === 3 && (
            <StepDeal
              form={form}
              updateForm={updateForm}
              onNext={nextStep}
              onBack={prevStep}
            />
          )}

          {/* =========================================
              STEP 4 — КАТЕГОРИЯ
          ========================================= */}

          {step === 4 && (
            <StepCategory
              form={form}
              updateForm={updateForm}
              onNext={nextStep}
              onBack={prevStep}
            />
          )}

          {/* =========================================
              STEP 5 — АДРЕС
          ========================================= */}

          {step === 5 && (
            <StepAddress
              form={form}
              updateForm={updateForm}
              onNext={nextStep}
              onBack={prevStep}
            />
          )}

          {/* =========================================
              STEP 6 — ТИП ОБЪЯВЛЕНИЯ
          ========================================= */}

          {step === 6 && (
            <StepListingType
              form={form}
              updateForm={updateForm}
              onBack={prevStep}
              onSubmit={submitProduct}
              isSubmitting={isSubmitting}
            />
          )}

          {/* =========================================
              MESSAGE
          ========================================= */}

          {submitMessage && (
            <div
              className={
                submitSuccess ? styles.successMessage : styles.errorMessage
              }
            >
              {submitMessage}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
