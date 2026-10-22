"use client";

import { useState, useEffect } from "react";
import {
  Building2,
  House,
  Map,
  MapPin,
  DoorOpen,
  Store,
  CarFront,
  Tag,
  Ruler,
  ArrowLeft,
  ArrowRight,
  Pencil,
  DollarSign,
  Maximize,
  ChevronRight,
  Check,
  PawPrint,
} from "lucide-react";

import { useLanguage } from "@/context/LanguageContext";
import { getConstants } from "@/utils/api";

import CustomSelect from "@/components/ui/customSelect/CustomSelect";
import styles from "./StepCategory.module.css";
import ResidentialComplexSelect from "../ResidentialComplexSelect/ResidentialComplexSelect";

/* =========================================================
   ICONS
========================================================= */

const fieldIcons = {
  series: Tag,
  rooms: Building2,
  floor: Building2,
  condition: Pencil,
  walls: Building2,
  heating: Tag,
  documents: Tag,
  furniture: House,
  offerType: Tag,
  pets: PawPrint,

  houseType: House,
  floors: Building2,
  sewerage: Tag,
  water: Tag,
  electricity: Tag,

  purpose: Map,
  fence: Tag,
  location: Map,
  landLocation: Map,
  terrain: Map,
  communications: Map,

  roomsInApartment: Building2,
  privateBathroom: DoorOpen,
  roomLocation: Map,

  premisesType: Store,
  technicalParameters: Tag,
  firstLine: Store,
  separateEntrance: DoorOpen,
  rentalBusiness: Store,

  ceilingHeight: Ruler,
  parkingType: CarFront,
  material: Building2,
  security: Tag,
  gates: DoorOpen,
  inspectionPit: Tag,
  basement: Building2,
  truckAccess: CarFront,
  gateType: DoorOpen,

  residentialComplex: Building2,
};

/* =========================================================
   CATEGORY ICONS
========================================================= */

const categoryIcons = {
  apartment: Building2,
  house: House,
  cottage: House,
  land: Map,
  room: DoorOpen,
  commercial: Store,
  parking: CarFront,
};

/* =========================================================
   RUSSIAN CATEGORY TITLES
   Используются напрямую для RU,
   чтобы категории больше не зависели
   от неправильного fallback в переводах.
========================================================= */

const russianCategoryTitles = {
  apartment: "Квартиры",
  house: "Дома",
  cottage: "Коттеджи",
  land: "Земельные участки",
  room: "Комнаты",
  commercial: "Коммерческая недвижимость",
  parking: "Паркинг",
};

/* =========================================================
   RUSSIAN CATEGORY DESCRIPTIONS
========================================================= */

const russianCategoryDescriptions = {
  apartment: "Квартиры в новостройках и на вторичном рынке",
  house: "Частные дома, особняки и таунхаусы",
  cottage: "Коттеджи и загородные объекты у озера",
  land: "Земельные участки различного назначения",
  room: "Отдельные комнаты в квартире, доме или общежитии",
  commercial: "Офисы, магазины, склады и другие помещения",
  parking: "Паркинги, гаражи и места для автомобилей",
};

/* =========================================================
   CATEGORIES
========================================================= */

const categories = {
  apartment: {
    fields: [
      ["series", "Серия / тип"],
      ["rooms", "Количество комнат"],
      ["floor", "Этаж"],
      ["condition", "Состояние"],
      ["walls", "Материал стен"],
      ["heating", "Отопление"],
      ["documents", "Документы"],
      ["furniture", "Мебель"],
      ["offerType", "Тип предложения"],
    ],
    amenities: [
      "Балкон / лоджия",
      "Лифт",
      "Раздельный санузел",
      "Совмещенный санузел",
      "Встроенная кухня",
      "Бытовая техника",
      "Видеонаблюдение",
      "Охрана",
      "Парковка",
      "Закрытая территория",
      "Вид на горы",
      "Не угловая",
      "Не затапливалась",
      "Не сдавалась квартирантам",
      "Бронированные двери",
    ],
  },

  house: {
    fields: [
      ["houseType", "Тип дома"],
      ["floors", "Этажность"],
      ["rooms", "Количество комнат"],
      ["heating", "Отопление"],
      ["sewerage", "Канализация"],
      ["water", "Питьевая вода"],
      ["electricity", "Электричество"],
      ["documents", "Документы"],
      ["offerType", "Тип предложения"],
    ],
    amenities: [
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
    ],
  },

  cottage: {
    fields: [
      ["houseType", "Тип объекта"],
      ["floors", "Этажность"],
      ["rooms", "Количество комнат"],
      ["heating", "Отопление"],
      ["sewerage", "Канализация"],
      ["water", "Питьевая вода"],
      ["electricity", "Электричество"],
      ["documents", "Документы"],
      ["offerType", "Тип предложения"],
    ],
    amenities: [
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
    ],
  },

  land: {
    fields: [
      ["purpose", "Назначение"],
      ["fence", "Забор"],
      ["documents", "Документы"],
      ["offerType", "Тип предложения"],
      ["landLocation", "Расположение"],
      ["terrain", "Рельеф"],
      ["communications", "Коммуникации"],
    ],
    amenities: [
      "Электричество",
      "Газ",
      "Вода",
      "Канализация",
      "Интернет",
      "Отопление",
      "Подъездная дорога",
      "Огороженная территория",
      "Сад",
      "Плодовые деревья",
      "Вид на горы",
    ],
  },

  room: {
    fields: [
      ["roomLocation", "Расположение"],
      ["roomsInApartment", "Комнат в квартире"],
      ["floor", "Этаж"],
      ["condition", "Состояние"],
      ["walls", "Материал стен"],
      ["heating", "Отопление"],
      ["privateBathroom", "Свой санузел"],
      ["documents", "Документы"],
      ["offerType", "Тип предложения"],
    ],
    amenities: [
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
    ],
  },

  commercial: {
    fields: [
      ["floor", "Этаж"],
      ["condition", "Состояние"],
      ["walls", "Материал стен"],
      ["heating", "Отопление"],
      ["premisesType", "Тип помещения"],
      ["technicalParameters", "Технические параметры"],
      ["firstLine", "Первая линия"],
      ["separateEntrance", "Отдельный вход"],
      ["rentalBusiness", "Готовый арендный бизнес"],
      ["offerType", "Тип предложения"],
    ],
    amenities: [
      "Парковка",
      "Отдельный вход",
      "Первая линия",
      "Витринные окна",
      "Охрана",
      "Видеонаблюдение",
      "Пожарная сигнализация",
      "Кондиционер",
      "Вентиляция",
      "Интернет",
      "Мебель",
      "Готовый ремонт",
      "Грузовой вход",
      "Санузел",
    ],
  },

  parking: {
    fields: [
      ["ceilingHeight", "Высота потолков"],
      ["parkingType", "Тип парковки"],
      ["material", "Материал"],
      ["gates", "Ворота"],
      ["truckAccess", "Для грузового авто"],
      ["gateType", "Тип ворот"],
      ["documents", "Документы"],
      ["offerType", "Тип предложения"],
    ],
    amenities: [
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
    ],
  },
};

/* =========================================================
   OPTIONS
========================================================= */

const options = {
  series: [
    "Любой",
    "Новостройка",
    "102 серия",
    "104 серия",
    "105 серия",
    "106 обычная",
    "106 улучшенная",
    "107 обычная",
    "107 улучшенная",
    "Сталинка",
    "Хрущевка",
    "Элитка",
    "Индивидуалка",
    "Пентхаус",
  ],

  rooms: ["1", "2", "3", "4+"],

  floor: ["Цоколь", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10+"],

  condition: [
    "Любое",
    "Дизайнерский ремонт",
    "Евроремонт",
    "Косметический",
    "Под самоотделку",
    "Старый ремонт",
    "Без ремонта",
  ],

  walls: [
    "Любые",
    "Кирпич",
    "Бетон",
    "Газобетон",
    "Панельные",
    "Монолитные",
    "Монолитно-кирпичные",
    "Монолитно-каркасные",
  ],

  heating: [
    "Любое",
    "Автономное",
    "Газовое",
    "Центральное",
    "Электрическое",
    "Комбинированное",
  ],

  documents: [
    "Любые",
    "Красная книга",
    "Техпаспорт",
    "Договор купли-продажи",
    "Договор долевого участия",
    "Акт приема-передачи",
  ],

  furniture: ["Полностью меблирована", "Частично меблирована", "Без мебели"],

  offerType: [
    "Любой",
    "Наличный расчет",
    "Ипотека",
    "Рассрочка",
    "Возможен обмен",
  ],

  pets: ["Да", "Нет"],

  houseType: [
    "Любой",
    "Частный дом",
    "Особняк",
    "Коттедж",
    "Таунхаус",
    "Дача",
    "Времянка",
  ],

  floors: ["1", "2", "3", "4+"],

  sewerage: ["Любая", "Возможно подведение", "Центральная", "Септик", "Нет"],

  water: ["Любая", "Центральная", "Скважина", "Возможно подведение", "Нет"],

  electricity: ["Любое", "Есть", "Возможно подведение", "Нет"],

  purpose: [
    "ИЖС",
    "ЛПХ",
    "Коммерческое",
    "Сельхозназначение",
    "Многоэтажное строительство",
    "Другое",
  ],

  fence: ["Есть", "Нет", "Частично"],

  landLocation: [
    "В городе",
    "В пригороде",
    "За городом",
    "У трассы",
    "В центре",
  ],

  terrain: ["Ровный", "С уклоном", "Горный", "Холмистый"],

  communications: [
    "Все коммуникации",
    "Электричество",
    "Газ",
    "Вода",
    "Канализация",
    "Интернет",
    "Отопление",
    "Нет коммуникаций",
  ],

  roomsInApartment: ["1", "2", "3", "4", "5+"],

  privateBathroom: ["Есть", "Нет"],

  roomLocation: [
    "В квартире",
    "В доме",
    "В хостеле",
    "В гостинице",
    "В общежитии",
  ],

  premisesType: [
    "Любой",
    "Офис",
    "Магазин",
    "Склад",
    "Производство",
    "Общепит",
    "Гостиница",
    "Промбаза",
  ],

  technicalParameters: [
    "Центральная канализация",
    "Трехфазное питание",
    "Приточно-вытяжная вентиляция",
    "Кондиционирование",
    "Охранная / пожарная сигнализация",
  ],

  firstLine: ["Да", "Нет", "Не важно"],

  separateEntrance: ["Да", "Нет", "Любой"],

  rentalBusiness: ["Да", "Нет", "Любой"],

  ceilingHeight: ["До 2.5 м", "2.5–3 м", "3–4 м", "4+ м"],

  parkingType: ["Подземный", "Наземный", "Многоуровневый", "Гараж", "Паркинг"],

  material: ["Кирпич", "Бетон", "Металл", "Панель", "Другое"],

  security: ["Есть", "Нет"],

  gates: ["Есть", "Нет"],

  inspectionPit: ["Есть", "Нет"],

  basement: ["Есть", "Нет"],

  truckAccess: ["Да", "Нет"],

  gateType: [
    "Распашные",
    "Секционные",
    "Откатные",
    "Роллетные",
    "Автоматические",
  ],
};

/* =========================================================
   ЖК
========================================================= */

const residentialComplexSeries = [
  "Новостройка",
  "106 обычная",
  "106 улучшенная",
  "107 обычная",
  "107 улучшенная",
  "Элитка",
  "Индивидуалка",
  "Пентхаус",
];

/* =========================================================
   HELPERS
========================================================= */

function getFieldOptions(field, dynamicOptions) {
  return dynamicOptions[field] || options[field] || [];
}

function getTranslation(t, key, fallback) {
  const translated = t(key);

  return translated === key ? fallback : translated;
}

function getFieldLabel(name, fallback, t) {
  return getTranslation(t, `stepCategory.fields.${name}`, fallback);
}

function getOptionLabel(name, option, t) {
  return getTranslation(t, `stepCategory.options.${name}.${option}`, option);
}

function getAmenityLabel(amenity, t) {
  return getTranslation(t, `stepCategory.amenities.items.${amenity}`, amenity);
}

/* =========================================================
   CATEGORY TRANSLATION
========================================================= */

function getCategoryTitle(category, t, language) {
  if (language === "ru") {
    return russianCategoryTitles[category] || "Объект недвижимости";
  }

  return getTranslation(
    t,
    `stepCategory.categories.${category}.title`,
    category,
  );
}

function getCategoryDescription(category, t, language) {
  if (language === "ru") {
    return russianCategoryDescriptions[category] || "";
  }

  return getTranslation(
    t,
    `stepCategory.categories.${category}.description`,
    "",
  );
}

/* =========================================================
   COMPONENT
========================================================= */

export default function StepCategory({ form, updateForm, onNext, onBack }) {
  const { t, language } = useLanguage();

  const [dynamicOptions, setDynamicOptions] = useState({});
  const [apiError, setApiError] = useState(false);

  /* =========================================================
     DEAL TYPE
  ========================================================= */

  const isRent = form.dealType === "rent";
  const isApartment = form.category === "apartment";

  /* =========================================================
     LOAD CONSTANTS
  ========================================================= */

  useEffect(() => {
    getConstants()
      .then((res) => {
        const data = res?.data || res;

        if (!data?.amenities) {
          throw new Error("No data returned");
        }

        setDynamicOptions((prev) => ({
          ...prev,

          apiAmenities: [
            ...(data.amenities.general || []),
            ...(data.amenities.resort || []),
          ],
        }));
      })
      .catch((err) => {
        console.error("Failed to fetch constants", err);

        setApiError(true);
      });
  }, []);

  /* =========================================================
     RESET RENT-SPECIFIC FIELDS
  ========================================================= */

  useEffect(() => {
    if (!isRent) {
      if (form.pets) {
        updateForm({
          pets: "",
        });
      }

      return;
    }

    const resetFields = {};

    if (form.documents) {
      resetFields.documents = "";
    }

    if (form.offerType) {
      resetFields.offerType = "";
    }

    if (!isApartment && form.pets) {
      resetFields.pets = "";
    }

    if (Object.keys(resetFields).length > 0) {
      updateForm(resetFields);
    }
  }, [isRent, isApartment]);

  /* =========================================================
     REGION
  ========================================================= */

  const isIssykKul =
    form.region === "ISSYK_KUL" ||
    form.region === "issykKul" ||
    form.region === "ISSYK-KUL" ||
    form.region === "issyk-kul";

  /* =========================================================
     CATEGORY
  ========================================================= */

  const visibleCategories = Object.entries(categories).filter(
    ([key]) => key !== "cottage" || isIssykKul,
  );

  const category = categories[form.category];

  const CategoryIcon = categoryIcons[form.category];

  const isLand = form.category === "land";

  /* =========================================================
     ЖК VISIBILITY
  ========================================================= */

  const showResidentialComplex =
    form.category === "apartment" &&
    (!form.series ||
      form.series === "Любая" ||
      residentialComplexSeries.includes(form.series));

  /* =========================================================
     RESET COTTAGE
  ========================================================= */

  useEffect(() => {
    if (!isIssykKul && form.category === "cottage") {
      updateForm({
        category: "",
        beachDistance: "",
        amenities: [],
      });
    }
  }, [isIssykKul, form.category]);

  /* =========================================================
     RESET ЖК
  ========================================================= */

  useEffect(() => {
    if (
      !showResidentialComplex &&
      (form.residentialComplex || form.residentialComplexId)
    ) {
      updateForm({
        residentialComplex: "",
        residentialComplexId: "",
      });
    }
  }, [
    showResidentialComplex,
    form.residentialComplex,
    form.residentialComplexId,
  ]);

  /* =========================================================
     UPDATE FIELD
  ========================================================= */

  function updateField(name, value) {
    updateForm({
      [name]: value,
    });
  }

  /* =========================================================
     CATEGORY SELECT
  ========================================================= */

  function selectCategory(key) {
    updateForm({
      category: key,
      amenities: [],
      residentialComplex: "",
      residentialComplexId: "",
      pets: "",
    });
  }

  /* =========================================================
     AMENITIES
  ========================================================= */

  const selectedAmenities = Array.isArray(form.amenities) ? form.amenities : [];

  const categoryAmenities = category?.amenities || [];

  function toggleAmenity(amenity) {
    const exists = selectedAmenities.includes(amenity);

    const nextAmenities = exists
      ? selectedAmenities.filter((item) => item !== amenity)
      : [...selectedAmenities, amenity];

    updateForm({
      amenities: nextAmenities,
    });
  }

  /* =========================================================
     CATEGORY FIELDS
  ========================================================= */

  const visibleFields =
    category?.fields.filter(([name]) => {
      if (isRent && (name === "documents" || name === "offerType")) {
        return false;
      }

      return true;
    }) || [];

  if (isRent && isApartment) {
    visibleFields.push(["pets", "Можно с животными"]);
  }

  /* =========================================================
     RENDER
  ========================================================= */

  return (
    <div className={styles.step}>
      {/* HEADER */}

      <div className={styles.header}>
        <div className={styles.stepBadge}>
          <span className={styles.stepDot} />

          {t("stepCategory.step")}
        </div>

        <h1>{t("stepCategory.title")}</h1>

        <p>{t("stepCategory.description")}</p>
      </div>

      {/* API ERROR */}

      {apiError && (
        <div className={styles.apiError}>{t("stepCategory.apiError")}</div>
      )}

      {/* CATEGORY */}

      {!category && (
        <div className={styles.categorySection}>
          <div className={styles.sectionTitle}>
            <div>
              <span>01</span>

              <h2>{t("stepCategory.category.title")}</h2>
            </div>

            <p>
              {isIssykKul
                ? t("stepCategory.category.issykKulDescription")
                : t("stepCategory.category.description")}
            </p>
          </div>

          <div className={styles.categoryGrid}>
            {visibleCategories.map(([key]) => {
              const Icon = categoryIcons[key];

              return (
                <button
                  type="button"
                  key={key}
                  className={`${styles.categoryCard} ${
                    key === "cottage" ? styles.cottageCard : ""
                  }`}
                  onClick={() => selectCategory(key)}
                >
                  <div className={styles.categoryIcon}>
                    <Icon size={25} strokeWidth={2.1} />
                  </div>

                  <div className={styles.categoryContent}>
                    <strong>{getCategoryTitle(key, t, language)}</strong>

                    <span>{getCategoryDescription(key, t, language)}</span>
                  </div>

                  <ArrowRight className={styles.categoryArrow} size={19} />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* SELECTED CATEGORY */}

      {category && (
        <>
          <div className={styles.selectedCategory}>
            <div className={styles.selectedCategoryMain}>
              <div className={styles.selectedCategoryIcon}>
                {CategoryIcon && <CategoryIcon size={23} strokeWidth={2.1} />}
              </div>

              <div className={styles.selectedCategoryInfo}>
                <span>{t("stepCategory.selectedCategory")}</span>

                <strong>{getCategoryTitle(form.category, t, language)}</strong>
              </div>
            </div>

            <button
              type="button"
              onClick={() =>
                updateForm({
                  category: "",
                  amenities: [],
                  residentialComplex: "",
                  residentialComplexId: "",
                  pets: "",
                })
              }
            >
              <Pencil size={14} />

              {t("stepCategory.change")}
            </button>
          </div>

          {/* PRICE / AREA */}

          <div className={styles.sectionBlock}>
            <div className={styles.sectionTitle}>
              <div>
                <span>02</span>

                <h2>{t("stepCategory.priceArea.title")}</h2>
              </div>

              <p>{t("stepCategory.priceArea.description")}</p>
            </div>

            <div className={styles.priceGrid}>
              <div className={styles.inputCard}>
                <div className={styles.inputIcon}>
                  <DollarSign size={19} />
                </div>

                <div className={styles.field}>
                  <label>{t("stepCategory.priceArea.priceLabel")}</label>

                  <input
                    type="number"
                    min="0"
                    placeholder={t("stepCategory.priceArea.pricePlaceholder")}
                    value={form.price || ""}
                    onChange={(e) =>
                      updateForm({
                        price: e.target.value,
                      })
                    }
                  />
                </div>
              </div>

              <div className={styles.inputCard}>
                <div className={styles.inputIcon}>
                  <Maximize size={18} />
                </div>

                <div className={styles.field}>
                  <label>
                    {isLand
                      ? t("stepCategory.priceArea.landAreaLabel")
                      : t("stepCategory.priceArea.areaLabel")}
                  </label>

                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder={
                      isLand
                        ? t("stepCategory.priceArea.landAreaPlaceholder")
                        : t("stepCategory.priceArea.areaPlaceholder")
                    }
                    value={form.area || ""}
                    onChange={(e) =>
                      updateForm({
                        area: e.target.value,
                      })
                    }
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ISSYK KUL */}

          {isIssykKul && (
            <div className={styles.sectionBlock}>
              <div className={styles.sectionTitle}>
                <div>
                  <span>03</span>

                  <h2>{t("stepCategory.beachDistance.title")}</h2>
                </div>

                <p>{t("stepCategory.beachDistance.description")}</p>
              </div>

              <div className={styles.beachDistanceGrid}>
                <div className={styles.inputCard}>
                  <div className={styles.inputIcon}>
                    <MapPin size={19} />
                  </div>

                  <div className={styles.field}>
                    <label>{t("stepCategory.beachDistance.label")}</label>

                    <input
                      type="number"
                      min="0"
                      step="1"
                      placeholder={t("stepCategory.beachDistance.placeholder")}
                      value={form.beachDistance || ""}
                      onChange={(e) =>
                        updateForm({
                          beachDistance: e.target.value,
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* CHARACTERISTICS */}

          <div className={styles.sectionBlock}>
            <div className={styles.sectionTitle}>
              <div>
                <span>{isIssykKul ? "04" : "03"}</span>

                <h2>{t("stepCategory.characteristics.title")}</h2>
              </div>

              <p>{t("stepCategory.characteristics.description")}</p>
            </div>

            <div className={styles.fieldsGrid}>
              {visibleFields.map(([name, label]) => {
                const fieldOptions = getFieldOptions(name, dynamicOptions);

                const Icon = fieldIcons[name] || Tag;

                if (fieldOptions.length > 0) {
                  return (
                    <div className={styles.selectWrapper} key={name}>
                      <CustomSelect
                        icon={Icon}
                        title={getFieldLabel(name, label, t)}
                        value={form[name] || ""}
                        setValue={(value) => updateField(name, value)}
                        options={fieldOptions.map((option) => ({
                          value: option,
                          label: getOptionLabel(name, option, t),
                        }))}
                      />
                    </div>
                  );
                }

                return (
                  <div className={styles.inputCard} key={name}>
                    <div className={styles.inputIcon}>
                      <Icon size={18} />
                    </div>

                    <div className={styles.field}>
                      <label>{getFieldLabel(name, label, t)}</label>

                      <input
                        value={form[name] || ""}
                        onChange={(e) =>
                          updateForm({
                            [name]: e.target.value,
                          })
                        }
                        placeholder={t("stepCategory.valuePlaceholder")}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* RESIDENTIAL COMPLEX */}

            {showResidentialComplex && (
              <div className={styles.residentialComplexWrapper}>
                <ResidentialComplexSelect
                  value={form.residentialComplex || ""}
                  country={form.country || "kyrgyzstan"}
                  city={
                    form.country === "turkey"
                      ? form.city
                      : form.region === "BISHKEK" || form.region === "bishkek"
                        ? "Бишкек"
                        : form.settlement || form.city || ""
                  }
                  district={form.district || form.settlement || ""}
                  region={form.region || ""}
                  onSelect={(complex) =>
                    updateForm({
                      residentialComplex: complex.name,
                      residentialComplexId: complex.id || "",
                    })
                  }
                />

                <span className={styles.fieldHint}>
                  {t("stepCategory.residentialComplexHint")}
                </span>
              </div>
            )}
          </div>

          {/* AMENITIES */}

          {categoryAmenities.length > 0 && (
            <div className={styles.sectionBlock}>
              <div className={styles.sectionTitle}>
                <div>
                  <span>{isIssykKul ? "05" : "04"}</span>

                  <h2>{t("stepCategory.amenities.title")}</h2>
                </div>

                <p>{t("stepCategory.amenities.description")}</p>
              </div>

              <div className={styles.amenitiesGrid}>
                {categoryAmenities.map((amenity) => {
                  const isSelected = selectedAmenities.includes(amenity);

                  return (
                    <button
                      key={amenity}
                      type="button"
                      className={`${styles.amenityCard} ${
                        isSelected ? styles.amenitySelected : ""
                      }`}
                      onClick={() => toggleAmenity(amenity)}
                    >
                      <span className={styles.amenityCheckbox}>
                        {isSelected && <Check size={14} strokeWidth={3} />}
                      </span>

                      <span>{getAmenityLabel(amenity, t)}</span>
                    </button>
                  );
                })}
              </div>

              {selectedAmenities.length > 0 && (
                <div className={styles.amenitiesSelectedCount}>
                  {t("stepCategory.amenities.selected")}{" "}
                  <strong>{selectedAmenities.length}</strong>
                </div>
              )}
            </div>
          )}

          {/* ACTIONS */}

          <div className={styles.actions}>
            <button type="button" className={styles.secondary} onClick={onBack}>
              <ArrowLeft size={17} />

              {t("common.back")}
            </button>

            <button type="button" className={styles.primary} onClick={onNext}>
              {t("stepCategory.continue")}

              <ChevronRight size={18} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
