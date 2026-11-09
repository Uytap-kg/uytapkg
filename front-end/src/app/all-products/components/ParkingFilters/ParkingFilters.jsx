"use client";

import {
  Ruler,
  Car,
  BrickWall,
  DoorOpen,
  Truck,
  FileText,
  CreditCard,
  Clock3,
} from "lucide-react";

import MultiSelect from "../MultiSelectFilters/MultiSelectFilter";

import { useLanguage } from "@/context/LanguageContext";

import styles from "./ParkingFilters.module.css";

/* =========================================================
   OPTIONS
========================================================= */

const ceilingHeight = ["Любая", "До 2.5 м", "2.5–3 м", "3–4 м", "4+ м"];

const parkingTypes = [
  "Любой",
  "Подземный",
  "Наземный",
  "Многоуровневый",
  "Гараж",
  "Паркинг",
];

const materials = ["Любой", "Кирпич", "Бетон", "Металл", "Панель", "Другое"];

const yesNo = ["Любое", "Есть", "Нет"];

const truckAccess = ["Любой", "Да", "Нет"];

const gateTypes = [
  "Любой",
  "Распашные",
  "Секционные",
  "Откатные",
  "Роллетные",
  "Автоматические",
];

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
  "Освещение",
  "Электричество",
  "Отопление",
  "Видеонаблюдение",
  "Охрана",
  "Автоматические ворота",
  "Смотровая яма",
  "Погреб",
  "Вода",
  "Удобный заезд",
];

/* =========================================================
   TRANSLATION KEYS
========================================================= */

const optionKeys = {
  ceilingHeight: {
    Любая: "any",
    "До 2.5 м": "upTo25",
    "2.5–3 м": "from25To3",
    "3–4 м": "from3To4",
    "4+ м": "over4",
  },

  parkingTypes: {
    Любой: "any",
    Подземный: "underground",
    Наземный: "surface",
    Многоуровневый: "multiLevel",
    Гараж: "garage",
    Паркинг: "parking",
  },

  materials: {
    Любой: "any",
    Кирпич: "brick",
    Бетон: "concrete",
    Металл: "metal",
    Панель: "panel",
    Другое: "other",
  },

  yesNo: {
    Любое: "any",
    Есть: "yes",
    Нет: "no",
  },

  truckAccess: {
    Любой: "any",
    Да: "yes",
    Нет: "no",
  },

  gateTypes: {
    Любой: "any",
    Распашные: "swing",
    Секционные: "sectional",
    Откатные: "sliding",
    Роллетные: "roller",
    Автоматические: "automatic",
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
    Освещение: "lighting",
    Электричество: "electricity",
    Отопление: "heating",
    Видеонаблюдение: "videoSurveillance",
    Охрана: "security",
    "Автоматические ворота": "automaticGates",
    "Смотровая яма": "inspectionPit",
    Погреб: "cellar",
    Вода: "water",
    "Удобный заезд": "easyAccess",
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
      label: t(`parkingFilters.options.${group}.${key}`),
    };
  });
}

/* =========================================================
   COMPONENT
========================================================= */

export default function ParkingFilters({ filters, updateFilter }) {
  const { t } = useLanguage();

  const isRent = filters.dealType === "rent";

  const translatedCeilingHeight = translateOptions(
    ceilingHeight,
    "ceilingHeight",
    t,
  );

  const translatedParkingTypes = translateOptions(
    parkingTypes,
    "parkingTypes",
    t,
  );

  const translatedMaterials = translateOptions(materials, "materials", t);

  const translatedYesNo = translateOptions(yesNo, "yesNo", t);

  const translatedTruckAccess = translateOptions(truckAccess, "truckAccess", t);

  const translatedGateTypes = translateOptions(gateTypes, "gateTypes", t);

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
        icon={Ruler}
        title={t("parkingFilters.titles.ceilingHeight")}
        options={translatedCeilingHeight}
        value={filters.ceilingHeight || []}
        setValue={(value) => updateFilter("ceilingHeight", value)}
      />

      <MultiSelect
        icon={Car}
        title={t("parkingFilters.titles.type")}
        options={translatedParkingTypes}
        value={filters.parkingType || []}
        setValue={(value) => updateFilter("parkingType", value)}
      />

      <MultiSelect
        icon={BrickWall}
        title={t("parkingFilters.titles.material")}
        options={translatedMaterials}
        value={filters.material || []}
        setValue={(value) => updateFilter("material", value)}
      />

      <MultiSelect
        icon={DoorOpen}
        title={t("parkingFilters.titles.gates")}
        options={translatedYesNo}
        value={filters.gates || []}
        setValue={(value) => updateFilter("gates", value)}
      />

      <MultiSelect
        icon={Truck}
        title={t("parkingFilters.titles.truckAccess")}
        options={translatedTruckAccess}
        value={filters.truckAccess || []}
        setValue={(value) => updateFilter("truckAccess", value)}
      />

      <MultiSelect
        icon={DoorOpen}
        title={t("parkingFilters.titles.gateType")}
        options={translatedGateTypes}
        value={filters.gateType || []}
        setValue={(value) => updateFilter("gateType", value)}
      />

      {!isRent && (
        <>
          <MultiSelect
            icon={FileText}
            title={t("parkingFilters.titles.documents")}
            options={translatedDocuments}
            value={filters.documents || []}
            setValue={(value) => updateFilter("documents", value)}
          />

          <MultiSelect
            icon={CreditCard}
            title={t("parkingFilters.titles.payment")}
            options={translatedOfferTypes}
            value={filters.offerType || []}
            setValue={(value) => updateFilter("offerType", value)}
          />
        </>
      )}

      {isRent && (
        <MultiSelect
          icon={Clock3}
          title={t("parkingFilters.titles.rentalPeriod")}
          options={translatedRentalPeriods}
          value={filters.rentalPeriod || []}
          setValue={(value) => updateFilter("rentalPeriod", value)}
        />
      )}

      <div className={styles.full}>
        <MultiSelect
          icon={Car}
          title={t("parkingFilters.titles.amenities")}
          options={translatedAmenities}
          value={filters.amenities || []}
          setValue={(value) => updateFilter("amenities", value)}
        />
      </div>
    </div>
  );
}
