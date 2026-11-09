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

import styles from "./HouseFilters.module.css";

/* =========================================================
   OPTIONS
========================================================= */

const houseTypes = [
  "Любой",
  "Частный дом",
  "Особняк",
  "Таунхаус",
  "Дача",
  "Времянка",
];

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
  "Гараж",
  "Парковка",
  "Баня",
  "Сауна",
  "Бассейн",
  "Терраса",
  "Балкон",
  "Подвал",
  "Погреб",
  "Мебель",
  "Бытовая техника",
  "Охрана",
  "Видеонаблюдение",
  "Закрытая территория",
  "Сад",
  "Огород",
  "Вид на горы",
];

/* =========================================================
   TRANSLATION KEYS
========================================================= */

const optionKeys = {
  houseTypes: {
    Любой: "any",
    "Частный дом": "privateHouse",
    Особняк: "mansion",
    Коттедж: "cottage",
    Таунхаус: "townhouse",
    Дача: "countryHouse",
    Времянка: "temporaryHouse",
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
    Гараж: "garage",
    Парковка: "parking",
    Баня: "bathhouse",
    Сауна: "sauna",
    Бассейн: "pool",
    Терраса: "terrace",
    Балкон: "balcony",
    Подвал: "basement",
    Погреб: "cellar",
    Мебель: "furniture",
    "Бытовая техника": "appliances",
    Охрана: "security",
    Видеонаблюдение: "videoSurveillance",
    "Закрытая территория": "gatedArea",
    Сад: "garden",
    Огород: "vegetableGarden",
    "Вид на горы": "mountainView",
  },
};

/* =========================================================
   HELPERS
========================================================= */

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
      label: t(`houseFilters.options.${group}.${key}`),
    };
  });
}

/* =========================================================
   COMPONENT
========================================================= */

export default function HouseFilters({ filters, updateFilter }) {
  const { t } = useLanguage();

  const isRent = filters.dealType === "rent";

  const translatedHouseTypes = translateOptions(houseTypes, "houseTypes", t);

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
        icon={Home}
        title={t("houseFilters.titles.houseType")}
        options={translatedHouseTypes}
        value={filters.houseType || []}
        setValue={(value) => updateFilter("houseType", value)}
      />

      <MultiSelect
        icon={Layers3}
        title={t("houseFilters.titles.floors")}
        options={translatedFloors}
        value={filters.floors || []}
        setValue={(value) => updateFilter("floors", value)}
      />

      <MultiSelect
        icon={Flame}
        title={t("houseFilters.titles.heating")}
        options={translatedHeating}
        value={filters.heating || []}
        setValue={(value) => updateFilter("heating", value)}
      />

      <MultiSelect
        icon={Droplets}
        title={t("houseFilters.titles.sewerage")}
        options={translatedSewerage}
        value={filters.sewerage || []}
        setValue={(value) => updateFilter("sewerage", value)}
      />

      <MultiSelect
        icon={Droplets}
        title={t("houseFilters.titles.water")}
        options={translatedWater}
        value={filters.water || []}
        setValue={(value) => updateFilter("water", value)}
      />

      <MultiSelect
        icon={Zap}
        title={t("houseFilters.titles.electricity")}
        options={translatedElectricity}
        value={filters.electricity || []}
        setValue={(value) => updateFilter("electricity", value)}
      />

      {!isRent && (
        <>
          <MultiSelect
            icon={FileText}
            title={t("houseFilters.titles.documents")}
            options={translatedDocuments}
            value={filters.documents || []}
            setValue={(value) => updateFilter("documents", value)}
          />

          <MultiSelect
            icon={CreditCard}
            title={t("houseFilters.titles.payment")}
            options={translatedOfferTypes}
            value={filters.offerType || []}
            setValue={(value) => updateFilter("offerType", value)}
          />
        </>
      )}

      {isRent && (
        <MultiSelect
          icon={Clock3}
          title={t("houseFilters.titles.rentalPeriod")}
          options={translatedRentalPeriods}
          value={filters.rentalPeriod || []}
          setValue={(value) => updateFilter("rentalPeriod", value)}
        />
      )}

      <div className={styles.full}>
        <MultiSelect
          icon={Home}
          title={t("houseFilters.titles.amenities")}
          options={translatedAmenities}
          value={filters.amenities || []}
          setValue={(value) => updateFilter("amenities", value)}
        />
      </div>
    </div>
  );
}
