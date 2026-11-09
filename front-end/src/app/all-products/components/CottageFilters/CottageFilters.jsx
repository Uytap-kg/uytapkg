"use client";

import {
  Home,
  Layers3,
  Flame,
  Droplets,
  Zap,
  FileText,
  CreditCard,
  Clock3,
} from "lucide-react";

import MultiSelect from "../MultiSelectFilters/MultiSelectFilter";

import { useLanguage } from "@/context/LanguageContext";

import styles from "./CottageFilters.module.css";

/* =========================================================
   OPTIONS
========================================================= */

const floors = ["Любой", "1", "2", "3", "4+"];

const heating = [
  "Любой",
  "Автономное",
  "Газовое",
  "Центральное",
  "Электрическое",
  "Комбинированное",
];

const sewerage = [
  "Любая",
  "Возможно подведение",
  "Центральная",
  "Септик",
  "Нет",
];

const water = [
  "Любая",
  "Центральная",
  "Скважина",
  "Возможно подведение",
  "Нет",
];

const electricity = ["Любая", "Есть", "Возможно подведение", "Нет"];

const documents = [
  "Любые",
  "Красная книга",
  "Техпаспорт",
  "Договор купли-продажи",
  "Договор долевого участия",
  "Акт приема-передачи",
];

const offerTypes = [
  "Любой",
  "Наличный расчет",
  "Ипотека",
  "Рассрочка",
  "Возможен обмен",
];

const rentalPeriods = ["По часам", "Посуточно", "Помесячно", "На долгий срок"];

const amenities = [
  "Бассейн",
  "Сауна",
  "Баня",
  "Терраса",
  "Балкон",
  "Гараж",
  "Парковка",
  "Сад",
  "Беседка",
  "Мангал",
  "Вид на горы",
  "Первая линия",
  "Закрытая территория",
  "Охрана",
  "Видеонаблюдение",
  "Мебель",
  "Бытовая техника",
];

/* =========================================================
   TRANSLATION HELPERS
========================================================= */

const optionKeys = {
  houseTypes: {
    Любой: "any",
    Коттедж: "cottage",
    Особняк: "mansion",
    Таунхаус: "townhouse",
    "Загородный дом": "countryHouse",
  },

  floors: {
    Любой: "any",
  },

  heating: {
    Любой: "any",
    Автономное: "autonomous",
    Газовое: "gas",
    Центральное: "central",
    Электрическое: "electric",
    Комбинированное: "combined",
  },

  sewerage: {
    Любая: "any",
    "Возможно подведение": "possibleConnection",
    Центральная: "central",
    Септик: "septic",
    Нет: "none",
  },

  water: {
    Любая: "any",
    Центральная: "central",
    Скважина: "well",
    "Возможно подведение": "possibleConnection",
    Нет: "none",
  },

  electricity: {
    Любая: "any",
    Есть: "available",
    "Возможно подведение": "possibleConnection",
    Нет: "none",
  },

  documents: {
    Любые: "any",
    "Красная книга": "redBook",
    Техпаспорт: "technicalPassport",
    "Договор купли-продажи": "saleContract",
    "Договор долевого участия": "equityParticipation",
    "Акт приема-передачи": "acceptanceAct",
  },

  offerTypes: {
    Любой: "any",
    "Наличный расчет": "cash",
    Ипотека: "mortgage",
    Рассрочка: "installment",
    "Возможен обмен": "exchange",
  },

  rentalPeriods: {
    "По часам": "hourly",
    Посуточно: "daily",
    Помесячно: "monthly",
    "На долгий срок": "longTerm",
  },

  amenities: {
    Бассейн: "pool",
    Сауна: "sauna",
    Баня: "bathhouse",
    Терраса: "terrace",
    Балкон: "balcony",
    Гараж: "garage",
    Парковка: "parking",
    Сад: "garden",
    Беседка: "gazebo",
    Мангал: "grill",
    "Вид на горы": "mountainView",
    "Первая линия": "firstLine",
    "Закрытая территория": "gatedArea",
    Охрана: "security",
    Видеонаблюдение: "videoSurveillance",
    Мебель: "furniture",
    "Бытовая техника": "appliances",
  },
};

function translateOptions(options, group, t) {
  return options.map((value) => {
    const key = optionKeys[group]?.[value];

    if (!key) {
      return {
        value,
        label: value,
      };
    }

    return {
      value,
      label: t(`cottageFilters.options.${group}.${key}`),
    };
  });
}

/* =========================================================
   COMPONENT
========================================================= */

export default function CottageFilters({ filters, updateFilter }) {
  const { t } = useLanguage();

  const isRent = filters.dealType === "rent";

  const translatedFloors = translateOptions(floors, "floors", t);

  const translatedHeating = translateOptions(heating, "heating", t);

  const translatedSewerage = translateOptions(sewerage, "sewerage", t);

  const translatedWater = translateOptions(water, "water", t);

  const translatedElectricity = translateOptions(electricity, "electricity", t);

  const translatedDocuments = translateOptions(documents, "documents", t);

  const translatedOfferTypes = translateOptions(offerTypes, "offerTypes", t);

  const translatedRentalPeriods = translateOptions(
    rentalPeriods,
    "rentalPeriods",
    t,
  );

  const translatedAmenities = translateOptions(amenities, "amenities", t);

  return (
    <div className={styles.grid}>
      <MultiSelect
        icon={Layers3}
        title={t("cottageFilters.titles.floors")}
        options={translatedFloors}
        value={filters.floors || []}
        setValue={(value) => updateFilter("floors", value)}
      />

      <MultiSelect
        icon={Flame}
        title={t("cottageFilters.titles.heating")}
        options={translatedHeating}
        value={filters.heating || []}
        setValue={(value) => updateFilter("heating", value)}
      />

      <MultiSelect
        icon={Droplets}
        title={t("cottageFilters.titles.sewerage")}
        options={translatedSewerage}
        value={filters.sewerage || []}
        setValue={(value) => updateFilter("sewerage", value)}
      />

      <MultiSelect
        icon={Droplets}
        title={t("cottageFilters.titles.water")}
        options={translatedWater}
        value={filters.water || []}
        setValue={(value) => updateFilter("water", value)}
      />

      <MultiSelect
        icon={Zap}
        title={t("cottageFilters.titles.electricity")}
        options={translatedElectricity}
        value={filters.electricity || []}
        setValue={(value) => updateFilter("electricity", value)}
      />

      {!isRent && (
        <>
          <MultiSelect
            icon={FileText}
            title={t("cottageFilters.titles.documents")}
            options={translatedDocuments}
            value={filters.documents || []}
            setValue={(value) => updateFilter("documents", value)}
          />

          <MultiSelect
            icon={CreditCard}
            title={t("cottageFilters.titles.payment")}
            options={translatedOfferTypes}
            value={filters.offerType || []}
            setValue={(value) => updateFilter("offerType", value)}
          />
        </>
      )}

      {isRent && (
        <MultiSelect
          icon={Clock3}
          title={t("cottageFilters.titles.rentalPeriod")}
          options={translatedRentalPeriods}
          value={filters.rentalPeriod || []}
          setValue={(value) => updateFilter("rentalPeriod", value)}
        />
      )}

      <div className={styles.full}>
        <MultiSelect
          icon={Home}
          title={t("cottageFilters.titles.amenities")}
          options={translatedAmenities}
          value={filters.amenities || []}
          setValue={(value) => updateFilter("amenities", value)}
        />
      </div>
    </div>
  );
}
