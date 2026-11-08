"use client";

import { useEffect, useState } from "react";
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
const MAX_BOOST_DAYS = 30;
const DRAFT_STORAGE_KEY = "uytap_add_product_draft";

/* =========================================================
   INITIAL FORM
========================================================= */

const initialForm = {
  title: "",
  images: [],

  country: "Кыргызстан",
  region: "",
  city: "",
  settlement: "",
  location: "",
  district: "",

  dealType: "",
  rentalPeriod: "",

  category: "",

  priceFrom: "",
  priceTo: "",
  price: "",

  areaFrom: "",
  areaTo: "",
  area: "",

  beachDistance: "",

  developerOrComplex: "",

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

  amenities: [],

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

  address: "",
  latitude: null,
  longitude: null,

  listingType: "",

  description: "",
};

/* =========================================================
   CATEGORY TITLES
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

  // ID объявления, которое уже создано
  const [existingListingId, setExistingListingId] = useState(null);

  // Сервис продвижения, полученный от сервера
  const [existingServiceType, setExistingServiceType] = useState(null);

  // Продолжительность продвижения
  const [boostDays, setBoostDays] = useState(DEFAULT_BOOST_DAYS);

  const totalSteps = 6;

  /* =========================================================
     RESTORE DRAFT AFTER RETURN FROM PAYMENT
  ========================================================= */

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    if (params.get("resume") !== "1") return;

    const savedDraft = sessionStorage.getItem(DRAFT_STORAGE_KEY);

    if (!savedDraft) {
      console.error("Черновик объявления не найден.");
      return;
    }

    try {
      const draft = JSON.parse(savedDraft);

      // Восстанавливаем форму
      if (draft.form) {
        setForm({
          ...initialForm,
          ...draft.form,

          // Фотографии уже загружены на сервер.
          // Используем их URL вместо старых blob URL.
          images: Array.isArray(draft.form.images) ? draft.form.images : [],
        });
      }

      // Восстанавливаем ID уже созданного объявления
      const listingId = params.get("listingId") || draft.listingId;

      if (listingId) {
        setExistingListingId(listingId);
      }

      // Восстанавливаем тип продвижения
      const serviceType =
        params.get("serviceType") || draft.serviceType || null;

      if (serviceType) {
        setExistingServiceType(serviceType);
      }

      // Восстанавливаем выбранное количество дней
      const requestedDays = Number(
        params.get("days") || draft.boostDays || DEFAULT_BOOST_DAYS,
      );

      const restoredDays = Number.isFinite(requestedDays)
        ? Math.min(MAX_BOOST_DAYS, Math.max(1, Math.floor(requestedDays)))
        : DEFAULT_BOOST_DAYS;

      setBoostDays(restoredDays);

      // Возвращаем пользователя на последний шаг
      setStep(6);

      setSubmitMessage("");
      setSubmitSuccess(false);

      // Убираем параметры восстановления из адресной строки
      window.history.replaceState({}, "", window.location.pathname);
    } catch (error) {
      console.error("Ошибка восстановления объявления:", error);
    }
  }, []);

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
     OPEN PAYMENT FOR EXISTING LISTING
  ========================================================= */

  function goToExistingPayment() {
    if (!existingListingId) return;

    const serviceType = existingServiceType || form.listingType;

    if (!serviceType) {
      setSubmitMessage("Не удалось определить услугу продвижения.");
      return;
    }

    const days = serviceType === "instagram" ? 1 : boostDays;

    const params = new URLSearchParams({
      type: "promotion",
      listingId: String(existingListingId),
      serviceType,
      days: String(days),
    });

    // Обновляем черновик перед повторным переходом
    const draft = {
      form,
      listingId: existingListingId,
      serviceType,
      boostDays: days,
    };

    sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));

    router.push(`/payment?${params.toString()}`);
  }

  /* =========================================================
     SUBMIT
  ========================================================= */

  async function submitProduct() {
    if (isSubmitting) return null;

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
         ALREADY CREATED LISTING
         Повторно объявление не создаём
      ===================================================== */

      if (existingListingId) {
        goToExistingPayment();
        return existingListingId;
      }

      /* =====================================================
         VALIDATION
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
         PRICE
      ===================================================== */

      const price = Number(form.price);
      const derivedPrice = price > 0 ? price : 100000;

      /* =====================================================
         AREA
      ===================================================== */

      const area = Number(form.area);
      const derivedArea = area > 0 ? area : null;

      /* =====================================================
         ISSYK-KUL
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
         CATEGORY
      ===================================================== */

      const categoryTitle = getCategoryTitle(form.category);

      /* =====================================================
         DESCRIPTION
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
          ? `${t("addProduct.generatedDescription.district")}: ${form.district}.`
          : "",

        form.address
          ? `${t("addProduct.generatedDescription.address")}: ${form.address}.`
          : "",

        form.developerOrComplex
          ? `${t("addProduct.generatedDescription.developer")}: ${form.developerOrComplex}.`
          : "",
      ]
        .filter(Boolean)
        .join(" ");

      const description = form.description?.trim() || generatedDescription;

      /* =====================================================
         UPLOAD PHOTOS
      ===================================================== */

      // Загружаем по PHOTO_UPLOAD_CONCURRENCY фото одновременно (а не строго
      // по одному) — порядок в итоговом массиве сохраняется по индексу.
      const PHOTO_UPLOAD_CONCURRENCY = 3;
      const sourceImages = form.images || [];
      const photoSlots = new Array(sourceImages.length).fill(null);
      let nextImageIndex = 0;

      const uploadWorker = async () => {
        while (nextImageIndex < sourceImages.length) {
          const index = nextImageIndex++;
          const img = sourceImages[index];

          if (img.file) {
            try {
              photoSlots[index] = await uploadListingPhoto(token, img.file);
            } catch (error) {
              console.error("Failed to upload image:", img.file.name, error);

              throw new Error(
                `${t("addProduct.errors.photoUpload")} ${img.file.name}: ${
                  error.message || t("addProduct.errors.unknown")
                }`,
              );
            }
          } else if (img.url && !img.url.startsWith("blob:")) {
            photoSlots[index] = img.url;
          }
        }
      };

      await Promise.all(
        Array.from(
          { length: Math.min(PHOTO_UPLOAD_CONCURRENCY, sourceImages.length) },
          uploadWorker,
        ),
      );

      const photos = photoSlots.filter(Boolean);

      /* =====================================================
         AMENITIES
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
      } catch (error) {
        console.error("Failed to fetch constants for amenities split", error);
      }

      /* =====================================================
         SPLIT AMENITIES
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
        houseType:
          form.category === "cottage"
            ? (form.houseType || "Коттедж")
            : form.houseType || null,

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
        isResort: isIssykKul || form.category === "cottage",

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

      /* =====================================================
         PAYMENT REQUIRED
      ===================================================== */

      if (result?.needsPayment && result?.promotion && result?.data?.id) {
        const listingId = result.data.id;

        const serviceType = result.promotion.serviceType;

        const days = Number(result.promotion.days || DEFAULT_BOOST_DAYS);

        /*
         * Сохраняем форму для возврата.
         *
         * Важно: сохраняем загруженные URL фотографий,
         * а не временные blob URL и не File-объекты.
         */

        const draft = {
          form: {
            ...form,

            images: photos.map((url) => ({
              url,
            })),
          },

          listingId,

          serviceType,

          boostDays: days,
        };

        sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));

        // Сохраняем состояние и в текущем компоненте
        setExistingListingId(listingId);
        setExistingServiceType(serviceType);
        setBoostDays(days);

        // Освобождаем временные blob URL
        form.images?.forEach((image) => {
          if (image?.url?.startsWith("blob:")) {
            URL.revokeObjectURL(image.url);
          }
        });

        const params = new URLSearchParams({
          type: "promotion",
          listingId: String(listingId),
          serviceType,
          days: String(days),
        });

        router.push(`/payment?${params.toString()}`);

        return result;
      }

      /* =====================================================
         FREE / ALREADY PAID
      ===================================================== */

      setSubmitSuccess(true);

      setSubmitMessage(result?.message || t("addProduct.success"));

      // Освобождаем временные blob URL
      form.images?.forEach((image) => {
        if (image?.url?.startsWith("blob:")) {
          URL.revokeObjectURL(image.url);
        }
      });

      // Очищаем черновик
      sessionStorage.removeItem(DRAFT_STORAGE_KEY);

      setForm(initialForm);
      setStep(1);

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
