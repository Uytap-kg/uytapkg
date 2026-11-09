"use client";

import {
  MapPin,
  Layers3,
  Paintbrush,
  BrickWall,
  Flame,
  DoorOpen,
  FileText,
  CreditCard,
  Clock3,
} from "lucide-react";

import { useLanguage } from "@/context/LanguageContext";

import MultiSelect from "../MultiSelectFilters/MultiSelectFilter";

import styles from "./RoomFilters.module.css";

/* =========================================================
   OPTIONS
========================================================= */

const locations = [
  "В квартире",
  "В доме",
  "В хостеле",
  "В гостинице",
  "В общежитии",
];

const rooms = ["Любое", "1", "2", "3", "4", "5+"];

const floors = [
  "Любой",
  "Цоколь",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10+",
];

const conditions = [
  "Любое",
  "Дизайнерский ремонт",
  "Евроремонт",
  "Косметический",
  "Под самоотделку",
  "Старый ремонт",
  "Без ремонта",
];

const walls = [
  "Любые",
  "Кирпич",
  "Бетон",
  "Газобетон",
  "Панельные",
  "Монолитные",
  "Монолитно-кирпичные",
  "Монолитно-каркасные",
];

const heating = [
  "Любое",
  "Автономное",
  "Газовое",
  "Центральное",
  "Электрическое",
  "Комбинированное",
];

const bathroom = ["Любой", "Есть", "Нет"];

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
  "Мебель",
  "Бытовая техника",
  "Балкон / лоджия",
  "Лифт",
  "Интернет",
  "Видеонаблюдение",
  "Охрана",
  "Парковка",
  "Закрытая территория",
  "Вид на горы",
];

/* =========================================================
   TRANSLATION KEYS
========================================================= */

const optionKeys = {
  locations: {
    "В квартире": "apartment",
    "В доме": "house",
    "В хостеле": "hostel",
    "В гостинице": "hotel",
    "В общежитии": "dormitory",
  },

  rooms: {
    Любое: "any",
  },

  floors: {
    Любой: "any",
    Цоколь: "basement",
  },

  conditions: {
    Любое: "any",
    "Дизайнерский ремонт": "designer",
    Евроремонт: "euro",
    Косметический: "cosmetic",
    "Под самоотделку": "unfinished",
    "Старый ремонт": "old",
    "Без ремонта": "noRenovation",
  },

  walls: {
    Любые: "any",
    Кирпич: "brick",
    Бетон: "concrete",
    Газобетон: "aeratedConcrete",
    Панельные: "panel",
    Монолитные: "monolithic",
    "Монолитно-кирпичные": "brickMonolithic",
    "Монолитно-каркасные": "frameMonolithic",
  },

  heating: {
    Любое: "any",
    Автономное: "autonomous",
    Газовое: "gas",
    Центральное: "central",
    Электрическое: "electric",
    Комбинированное: "combined",
  },

  bathroom: {
    Любой: "any",
    Есть: "yes",
    Нет: "no",
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
    Мебель: "furniture",
    "Бытовая техника": "appliances",
    "Балкон / лоджия": "balcony",
    Лифт: "elevator",
    Интернет: "internet",
    Видеонаблюдение: "videoSurveillance",
    Охрана: "security",
    Парковка: "parking",
    "Закрытая территория": "gatedArea",
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
      label: t(`roomFilters.options.${group}.${key}`),
    };
  });
}

/* =========================================================
   COMPONENT
========================================================= */

export default function RoomFilters({ filters, updateFilter }) {
  const { t } = useLanguage();

  const isRent = filters.dealType === "rent";

  const translatedLocations = translateOptions(locations, "locations", t);

  const translatedRooms = translateOptions(rooms, "rooms", t);

  const translatedFloors = translateOptions(floors, "floors", t);

  const translatedConditions = translateOptions(conditions, "conditions", t);

  const translatedWalls = translateOptions(walls, "walls", t);

  const translatedHeating = translateOptions(heating, "heating", t);

  const translatedBathroom = translateOptions(bathroom, "bathroom", t);

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
        icon={MapPin}
        title={t("roomFilters.titles.location")}
        options={translatedLocations}
        value={filters.roomLocation || []}
        setValue={(value) => updateFilter("roomLocation", value)}
      />

      <MultiSelect
        icon={DoorOpen}
        title={t("roomFilters.titles.rooms")}
        options={translatedRooms}
        value={filters.roomsInApartment || []}
        setValue={(value) => updateFilter("roomsInApartment", value)}
      />

      <MultiSelect
        icon={Layers3}
        title={t("roomFilters.titles.floor")}
        options={translatedFloors}
        value={filters.floor || []}
        setValue={(value) => updateFilter("floor", value)}
      />

      <MultiSelect
        icon={Paintbrush}
        title={t("roomFilters.titles.condition")}
        options={translatedConditions}
        value={filters.condition || []}
        setValue={(value) => updateFilter("condition", value)}
      />

      <MultiSelect
        icon={BrickWall}
        title={t("roomFilters.titles.walls")}
        options={translatedWalls}
        value={filters.walls || []}
        setValue={(value) => updateFilter("walls", value)}
      />

      <MultiSelect
        icon={Flame}
        title={t("roomFilters.titles.heating")}
        options={translatedHeating}
        value={filters.heating || []}
        setValue={(value) => updateFilter("heating", value)}
      />

      <MultiSelect
        icon={DoorOpen}
        title={t("roomFilters.titles.privateBathroom")}
        options={translatedBathroom}
        value={filters.privateBathroom || []}
        setValue={(value) => updateFilter("privateBathroom", value)}
      />

      {!isRent && (
        <>
          <MultiSelect
            icon={FileText}
            title={t("roomFilters.titles.documents")}
            options={translatedDocuments}
            value={filters.documents || []}
            setValue={(value) => updateFilter("documents", value)}
          />

          <MultiSelect
            icon={CreditCard}
            title={t("roomFilters.titles.payment")}
            options={translatedOfferTypes}
            value={filters.offerType || []}
            setValue={(value) => updateFilter("offerType", value)}
          />
        </>
      )}

      {isRent && (
        <MultiSelect
          icon={Clock3}
          title={t("roomFilters.titles.rentalPeriod")}
          options={translatedRentalPeriods}
          value={filters.rentalPeriod || []}
          setValue={(value) => updateFilter("rentalPeriod", value)}
        />
      )}

      <div className={styles.full}>
        <MultiSelect
          icon={DoorOpen}
          title={t("roomFilters.titles.amenities")}
          options={translatedAmenities}
          value={filters.amenities || []}
          setValue={(value) => updateFilter("amenities", value)}
        />
      </div>
    </div>
  );
}
