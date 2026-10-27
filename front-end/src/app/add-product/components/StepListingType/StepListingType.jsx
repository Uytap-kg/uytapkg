"use client";

import {
  Check,
  Crown,
  Sparkles,
  Zap,
  ArrowLeft,
  ArrowRight,
  TrendingUp,
  Camera,
  CreditCard,
} from "lucide-react";

import { useLanguage } from "@/context/LanguageContext";

import styles from "./StepListingType.module.css";

const types = [
  {
    id: "standard",
    icon: Sparkles,
    paid: false,
  },
  {
    id: "vip",
    icon: Crown,
    paid: true,
  },
  {
    id: "urgent",
    icon: Zap,
    paid: true,
  },
  {
    id: "top",
    icon: TrendingUp,
    paid: true,
  },
  {
    id: "instagram",
    icon: Camera,
    paid: true,
  },
];

const paidListingTypes = ["vip", "urgent", "top", "instagram"];

const regionNames = {
  BISHKEK: "Бишкек",
  CHUY: "Чуйская область",
  OSH_REGION: "Ошская область",
  JALAL_ABAD: "Джалал-Абадская область",
  ISSYK_KUL: "Иссык-Кульская область",
  NARYN: "Нарынская область",
  TALAS: "Таласская область",
  BATKEN: "Баткенская область",
  OSH_CITY: "Ош",

  bishkek: "Бишкек",
  chui: "Чуйская область",
  osh: "Ошская область",
  jalalAbad: "Джалал-Абадская область",
  issykKul: "Иссык-Кульская область",
  naryn: "Нарынская область",
  talas: "Таласская область",
  batken: "Баткенская область",
  oshCity: "Ош",

  istanbul: "Стамбул",
  ankara: "Анкара",
  izmir: "Измир",
  antalya: "Анталья",
  bursa: "Бурса",
  adana: "Адана",
  gaziantep: "Газиантеп",
  konya: "Конья",
};

const categoryLabels = {
  apartment: "Квартира",
  house: "Дом",
  land: "Участок",
  room: "Комната",
  commercial: "Коммерция",
  parking: "Паркинг / гараж",
};

export default function StepListingType({
  form,
  updateForm,
  onBack,
  onSubmit,
  isSubmitting,
}) {
  const { t } = useLanguage();

  const title = form.title || "";
  const description = form.description || "";

  const isTitleValid = title.trim().length > 0;
  const isDescriptionValid = description.trim().length > 0;
  const isListingTypeValid = Boolean(form.listingType);

  const isReady = isTitleValid && isDescriptionValid && isListingTypeValid;

  const isInstagramSelected = form.listingType === "instagram";

  const isPaidSelected = paidListingTypes.includes(form.listingType);

  const selectedType = types.find((item) => item.id === form.listingType);

  const handleTitleChange = (event) => {
    updateForm({
      title: event.target.value,
    });
  };

  const handleDescriptionChange = (event) => {
    updateForm({
      description: event.target.value,
    });
  };

  const handleSelectType = (typeId) => {
    if (isSubmitting) return;

    updateForm({
      listingType: typeId,
    });
  };

  // Публикация (в т.ч. для платных типов) полностью решается на бэкенде
  // (см. add-product/page.jsx submitProduct и
  // back-end/src/controllers/listingsController.js createListing):
  // - бесплатные типы (обычное/Instagram) публикуются сразу;
  // - VIP/ТОП сначала пробуют списаться с лимита тарифа — если получилось,
  //   тоже публикуются сразу, уже продвинутыми;
  // - иначе (в т.ч. всегда для "Срочно") объявление создаётся, но не
  //   публикуется, пока не пройдёт оплата — родитель сам уводит на
  //   /payment.
  const handlePublish = () => {
    if (!isReady || isSubmitting) return;
    onSubmit();
  };

  const countryName =
    form.country === "turkey"
      ? t("stepListingType.countries.turkey")
      : t("stepListingType.countries.kyrgyzstan");

  const regionName = form.region
    ? t(`stepListingType.regions.${form.region}`) !==
      `stepListingType.regions.${form.region}`
      ? t(`stepListingType.regions.${form.region}`)
      : regionNames[form.region] || form.region
    : t("stepListingType.notSpecified");

  const dealName =
    form.dealType === "sale"
      ? t("stepListingType.deal.sale")
      : form.dealType === "rent"
        ? t("stepListingType.deal.rent")
        : t("stepListingType.notSpecified");

  const categoryName = form.category
    ? t(`stepListingType.categories.${form.category}`) !==
      `stepListingType.categories.${form.category}`
      ? t(`stepListingType.categories.${form.category}`)
      : categoryLabels[form.category] || t("stepListingType.notSpecified")
    : t("stepListingType.notSpecified");

  const getPrimaryButton = () => {
    if (isSubmitting) {
      return {
        text: t("stepListingType.actions.publishing"),
        icon: ArrowRight,
      };
    }

    if (isPaidSelected) {
      return {
        text: t("stepListingType.actions.payment"),
        icon: CreditCard,
      };
    }

    return {
      text: t("stepListingType.actions.publish"),
      icon: ArrowRight,
    };
  };

  const primaryButton = getPrimaryButton();
  const PrimaryIcon = primaryButton.icon;

  return (
    <div className={styles.step}>
      {/* HEADER */}

      <div className={styles.header}>
        <span className={styles.stepBadge}>
          <span className={styles.stepDot} />

          {t("stepListingType.step")}
        </span>

        <h1>{t("stepListingType.title")}</h1>

        <p>{t("stepListingType.description")}</p>
      </div>

      {/* 01 — TITLE */}

      <section className={styles.section}>
        <div className={styles.sectionLabel}>
          <span>01</span>

          <div>
            <strong>{t("stepListingType.titleField.title")}</strong>

            <small>{t("stepListingType.titleField.description")}</small>
          </div>
        </div>

        <div className={styles.titleField}>
          <div
            className={`${styles.inputWrapper} ${
              !isTitleValid && title.length > 0 ? styles.inputWrapperError : ""
            }`}
          >
            <input
              type="text"
              value={title}
              onChange={handleTitleChange}
              placeholder={t("stepListingType.titleField.placeholder")}
              maxLength={100}
              autoComplete="off"
              autoFocus
            />

            <span className={styles.titleCounter}>{title.length}/100</span>
          </div>

          <div className={styles.titleFooter}>
            <span>{t("stepListingType.titleField.hint")}</span>

            {!isTitleValid && (
              <strong className={styles.required}>
                {t("stepListingType.required")}
              </strong>
            )}
          </div>
        </div>
      </section>

      {/* 02 — DESCRIPTION */}

      <section className={styles.section}>
        <div className={styles.sectionLabel}>
          <span>02</span>

          <div>
            <strong>{t("stepListingType.descriptionField.title")}</strong>

            <small>{t("stepListingType.descriptionField.description")}</small>
          </div>
        </div>

        <div className={styles.descriptionField}>
          <div
            className={`${styles.textareaWrapper} ${
              !isDescriptionValid && description.length > 0
                ? styles.inputWrapperError
                : ""
            }`}
          >
            <textarea
              value={description}
              onChange={handleDescriptionChange}
              placeholder={t("stepListingType.descriptionField.placeholder")}
              maxLength={2000}
              rows={7}
            />

            <span className={styles.descriptionCounter}>
              {description.length}/2000
            </span>
          </div>

          <div className={styles.titleFooter}>
            <span>{t("stepListingType.descriptionField.hint")}</span>

            {!isDescriptionValid && (
              <strong className={styles.required}>
                {t("stepListingType.required")}
              </strong>
            )}
          </div>
        </div>
      </section>

      {/* 03 — LISTING TYPE */}

      <section className={styles.section}>
        <div className={styles.sectionLabel}>
          <span>03</span>

          <div>
            <strong>{t("stepListingType.listingType.title")}</strong>

            <small>{t("stepListingType.listingType.description")}</small>
          </div>
        </div>

        <div className={styles.typeGrid}>
          {types.map((item) => {
            const isSelected = form.listingType === item.id;

            const Icon = item.icon;

            return (
              <button
                key={item.id}
                type="button"
                className={`${styles.typeCard} ${
                  styles[`type-${item.id}`] || ""
                } ${isSelected ? styles.selected : ""}`}
                onClick={() => handleSelectType(item.id)}
                disabled={isSubmitting}
              >
                <div className={styles.cardGlow} />

                <div className={styles.cardTop}>
                  <div className={styles.typeIcon}>
                    <Icon size={21} strokeWidth={2.2} />
                  </div>
                </div>

                <div className={styles.cardContent}>
                  <strong>{t(`stepListingType.types.${item.id}.title`)}</strong>

                  <span>
                    {t(`stepListingType.types.${item.id}.description`)}
                  </span>
                </div>

                {!isSelected && (
                  <div className={styles.cardArrow}>
                    <ArrowRight size={17} />
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* INSTAGRAM INFO */}

        {isInstagramSelected && (
          <div className={styles.instagramInfo}>
            <div className={styles.instagramInfoIcon}>
              <Camera size={20} strokeWidth={2.2} />
            </div>

            <div className={styles.instagramInfoContent}>
              <div className={styles.instagramTitleRow}>
                <strong>{t("stepListingType.instagram.title")}</strong>
              </div>

              <p>{t("stepListingType.instagram.description")}</p>
            </div>

            <Check
              size={20}
              strokeWidth={2.5}
              className={styles.instagramInfoCheck}
            />
          </div>
        )}
      </section>

      {/* 04 — SUMMARY */}

      <section className={styles.summary}>
        <div className={styles.summaryHeader}>
          <div className={styles.summaryTitle}>
            <span className={styles.summaryEyebrow}>04</span>

            <div>
              <h3>{t("stepListingType.summary.title")}</h3>

              <p>{t("stepListingType.summary.description")}</p>
            </div>
          </div>

          <div
            className={`${styles.readyBadge} ${
              !isReady ? styles.notReady : ""
            }`}
          >
            <span />

            {isReady
              ? t("stepListingType.summary.ready")
              : t("stepListingType.summary.notReady")}
          </div>
        </div>

        <div className={styles.summaryGrid}>
          <div className={styles.summaryItemWide}>
            <span>{t("stepListingType.summary.fields.title")}</span>

            <strong>{title.trim() || t("stepListingType.notSpecified")}</strong>
          </div>

          <div className={styles.summaryItemWide}>
            <span>{t("stepListingType.summary.fields.description")}</span>

            <strong className={styles.summaryDescription}>
              {description.trim() || t("stepListingType.notSpecified")}
            </strong>
          </div>

          <div className={styles.summaryItem}>
            <span>{t("stepListingType.summary.fields.country")}</span>

            <strong>{countryName}</strong>
          </div>

          <div className={styles.summaryItem}>
            <span>{t("stepListingType.summary.fields.region")}</span>

            <strong>{regionName}</strong>
          </div>

          <div className={styles.summaryItem}>
            <span>{t("stepListingType.summary.fields.deal")}</span>

            <strong>{dealName}</strong>
          </div>

          <div className={styles.summaryItem}>
            <span>{t("stepListingType.summary.fields.category")}</span>

            <strong>{categoryName}</strong>
          </div>

          <div className={styles.summaryItemWide}>
            <span>{t("stepListingType.summary.fields.address")}</span>

            <strong>{form.address || t("stepListingType.notSpecified")}</strong>
          </div>

          <div
            className={`${styles.summaryItemWide} ${
              isInstagramSelected ? styles.instagramSummary : ""
            }`}
          >
            {isInstagramSelected && (
              <div className={styles.instagramSummaryIcon}>
                <Camera size={18} strokeWidth={2.2} />
              </div>
            )}

            <div>
              <span>{t("stepListingType.summary.fields.listing")}</span>

              <strong>
                {selectedType
                  ? t(`stepListingType.types.${selectedType.id}.title`)
                  : t("stepListingType.summary.notSelected")}
              </strong>
            </div>

            {isInstagramSelected && (
              <Check
                size={19}
                strokeWidth={2.5}
                className={styles.instagramSummaryCheck}
              />
            )}
          </div>
        </div>
      </section>

      {/* ACTIONS */}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.secondary}
          onClick={onBack}
          disabled={isSubmitting}
        >
          <ArrowLeft size={17} />

          {t("common.back")}
        </button>

        <button
          type="button"
          className={`${styles.primary} ${
            isPaidSelected ? styles.primaryPayment : ""
          }`}
          disabled={!isReady || isSubmitting}
          onClick={handlePublish}
        >
          {primaryButton.text}

          <PrimaryIcon size={17} />
        </button>
      </div>
    </div>
  );
}
