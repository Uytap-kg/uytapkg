"use client";

import { useEffect, useState } from "react";
import {
  X,
  Building2,
  MapPin,
  Layers3,
  Home,
  Car,
  CalendarDays,
  Check,
  Warehouse,
  Maximize,
  Blocks,
  Globe2,
  Ruler,
} from "lucide-react";

import styles from "./EditResidentialComplexModal.module.css";
import CustomSelect from "@/components/ui/customSelect/CustomSelect";
import { useLanguage } from "@/context/LanguageContext";
import { getConstants, uploadComplexPhoto } from "@/utils/api";

const statuses = ["Проект", "Строительство", "Сдан"];
const classes = ["Эконом", "Комфорт", "Бизнес", "Премиум"];

const constructions = [
  "Монолит",
  "Монолитно-кирпичный",
  "Кирпичный",
  "Панельный",
  "Каркасно-монолитный",
  "Газобетон",
];

const amenities = [
  "Детская площадка",
  "Парковка",
  "Подземный паркинг",
  "Закрытая территория",
  "Охрана",
  "Видеонаблюдение",
  "Лифт",
  "Детский сад",
  "Школа",
  "Фитнес-зал",
  "Зеленая зона",
  "Коммерческие помещения",
];

const MAX_IMAGES = 20;

const bishkekDistrictsFallback = [
  "Центр",
  "Верхняя часть города",
  "Нижняя часть города",
  "Верхний Джал",
  "Средний Джал",
  "Нижний Джал",
  "Арча-Бешик",
  "Орто-Сай",
  "Ак-Орго",
  "Кызыл-Аскер",
  "Ынтымак",
  "Тенир-Тоо",
  "Ак-Кеме",
  "Пишпек",
  "69-га",
  "3–12 мкр",
  "Асанбай",
  "Кара-Жыгач",
  "Кок-Жар",
  "Тунгуч",
  "Магистраль",
  "Улан",
  "Вефа",
  "ЦУМ",
  "Маевка",
  "Политех",
  "Юг-2",
  "Достук",
  "Золотой квадрат",
  "КНУ",
  "Тынчтык",
  "Мурас-Ордо",
  "Аламедин-1",
  "Восток-5",
  "Дордой",
  "Лебединовка",
  "Учкун",
  "Таатан",
  "Юбилейка",
];

const kyrgyzRegionsFallback = {
  BISHKEK: { name: "Бишкек", type: "bishkek" },
  CHUY: {
    name: "Чуйская область",
    type: "region",
    settlements: [
      "Токмок",
      "Кант",
      "Кара-Балта",
      "Шопоков",
      "Каинды",
      "Кемин",
      "Беловодское",
      "Сокулук",
      "Аламедин",
      "Лебединовка",
      "Военно-Антоновка",
      "Новопавловка",
      "Александровка",
      "Петровка",
      "Московское",
      "Бишкекское",
    ],
  },
  OSH_REGION: {
    name: "Ошская область",
    type: "region",
    settlements: [
      "Ош",
      "Ноокат",
      "Кара-Суу",
      "Араванский район",
      "Узгенский район",
      "Чон-Алайский район",
      "Кара-Сууйский район",
      "Кара-Кульджинский район",
      "Узген",
      "Гульча",
      "Жаны-Ноокат",
      "Эркеш-Там",
      "Гулбаар",
    ],
  },
  ISSYK_KUL: {
    name: "Иссык-Кульская область",
    type: "region",
    settlements: [
      "Каракол",
      "Чолпон-Ата",
      "Бостери",
      "Балыкчы",
      "Каджи-Сай",
      "Тамчы",
      "Боконбаево",
      "Тюп",
      "Тамга",
      "Григорьевка",
      "Ананьево",
      "Барскоон",
      "Жыргалан",
    ],
  },
  JALAL_ABAD: {
    name: "Джалал-Абадская область",
    type: "region",
    settlements: [
      "Джалал-Абад",
      "Таш-Кумыр",
      "Кара-Куль",
      "Майлуу-Суу",
      "Кочкор-Ата",
      "Базар-Коргон",
      "Кербен",
      "Токтогул",
      "Сузак",
      "Ала-Бука",
    ],
  },
  NARYN: {
    name: "Нарынская область",
    type: "region",
    settlements: [
      "Нарын",
      "Кочкор",
      "Ат-Башы",
      "Чаек",
      "Баетов",
      "Казарман",
      "Мин-Куш",
      "Достук",
    ],
  },
  TALAS: {
    name: "Таласская область",
    type: "region",
    settlements: [
      "Талас",
      "Бакай-Ата",
      "Покровка",
      "Кара-Буура",
      "Манас",
      "Кызыл-Адыр",
    ],
  },
  BATKEN: {
    name: "Баткенская область",
    type: "region",
    settlements: [
      "Баткен",
      "Кызыл-Кыя",
      "Сулюкта",
      "Раззаков",
      "Кадамжай",
      "Айдаркен",
      "Исфана",
      "Самаркандек",
    ],
  },
};

const turkeyCities = {
  istanbul: {
    name: "Стамбул",
    districts: [
      "Авджилар",
      "Адалар",
      "Арнавуткёй",
      "Аташехир",
      "Багджилар",
      "Байрампаша",
      "Бакыркёй",
      "Башакшехир",
      "Бейкоз",
      "Бейликдюзю",
      "Бейоглу",
      "Бешикташ",
      "Бююкчекмедже",
      "Газиосманпаша",
      "Гюнгёрен",
      "Зейтинбурну",
      "Кадыкёй",
      "Картал",
      "Кючюкчекмедже",
      "Кягытхане",
      "Малтепе",
      "Пендик",
      "Санджактепе",
      "Сарыер",
      "Силиври",
      "Султанбейли",
      "Султангази",
      "Тузла",
      "Умрание",
      "Ускюдар",
      "Фатих",
      "Чаталджа",
      "Чекмекёй",
      "Шиле",
      "Шишли",
      "Эсенлер",
      "Эсеньюрт",
      "Эюпсултан",
    ],
  },
  ankara: {
    name: "Анкара",
    districts: [
      "Акюрт",
      "Алтындаг",
      "Аяш",
      "Бала",
      "Бейпазары",
      "Гёльбаши",
      "Гюдюл",
      "Енимахалле",
      "Каледжик",
      "Кахраманказан",
      "Кечиорен",
      "Кызылджахамам",
      "Мамак",
      "Наллыхан",
      "Полатлы",
      "Пурсаклар",
      "Синджан",
      "Хаймана",
      "Чамлыдере",
      "Чанкая",
      "Чубук",
      "Шерефликочхисар",
      "Эврен",
      "Эльмадаг",
      "Эриаман",
    ],
  },
  antalya: {
    name: "Анталья",
    districts: [
      "Аксеки",
      "Аксу",
      "Аланья",
      "Демре",
      "Дёшемеалты",
      "Ибрады",
      "Каш",
      "Кемер",
      "Кепез",
      "Коньяалты",
      "Коркутели",
      "Кумлуджа",
      "Манавгат",
      "Муратпаша",
      "Серик",
      "Финике",
      "Газипаша",
      "Гюндогмуш",
      "Эльмалы",
    ],
  },
  izmir: {
    name: "Измир",
    districts: [
      "Алиага",
      "Балчова",
      "Байындыр",
      "Байраклы",
      "Бергама",
      "Бейдаг",
      "Борнова",
      "Буджа",
      "Чешме",
      "Чигли",
      "Дикили",
      "Фоча",
      "Газиэмир",
      "Гюзелбахче",
      "Карабаглар",
      "Карабурун",
      "Каршияка",
      "Кемальпаша",
      "Кынык",
      "Кираз",
      "Конак",
      "Мендерес",
      "Менемен",
      "Нарлыдере",
      "Одемиш",
      "Сеферихисар",
      "Селчук",
      "Тире",
      "Торбалы",
      "Урла",
    ],
  },
  bursa: {
    name: "Бурса",
    districts: [
      "Бююк Орхан",
      "Гемлик",
      "Гюрсу",
      "Изник",
      "Караджабей",
      "Келес",
      "Кестель",
      "Муданья",
      "Мустафакемальпаша",
      "Нилюфер",
      "Орхангази",
      "Орханели",
      "Османгази",
      "Енишехир",
      "Инегёль",
      "Харманджик",
      "Йылдырым",
    ],
  },
  mersin: {
    name: "Аланья",
    districts: [
      "Авсаллар",
      "Бекташ",
      "Гюллер Пынары",
      "Демирташ",
      "Джикджилли",
      "Инджекум",
      "Кадипаша",
      "Каргыджак",
      "Кестель",
      "Кизлар Пынары",
      "Конаклы",
      "Махмутлар",
      "Оба",
      "Окурджалар",
      "Паяллар",
      "Сарай",
      "Сугёзю",
      "Тосмур",
      "Тюрклер",
      "Хаджэт",
      "Хисаричи",
      "Чиплаклы",
      "Шекерхане",
    ],
  },
  mugla: {
    name: "Бодрум",
    districts: [
      "Акьярлар",
      "Битез",
      "Гёльтюркбюкю",
      "Гюмюшлюк",
      "Гюндоган",
      "Гюмбет",
      "Давутлар",
      "Ичмелер",
      "Кадикалеси",
      "Караова",
      "Конаджик",
      "Кумбахче",
      "Мумджулар",
      "Ортакент",
      "Торба",
      "Тургутреис",
      "Тюркбюкю",
      "Умюрча",
      "Чарши",
      "Чеч",
      "Ялыкавак",
    ],
  },
  adana: {
    name: "Мармарис",
    districts: [
      "Армуталан",
      "Бельдиби",
      "Бозбурун",
      "Ичмелер",
      "Кемерсереф",
      "Орхание",
      "Селимие",
      "Сителер",
      "Согут",
      "Тепе",
      "Тургют",
      "Турунч",
      "Хатирими",
      "Чамлы",
      "Чилдыр",
    ],
  },
};

const initialForm = {
  name: "",
  country: "kyrgyzstan",
  region: "",
  district: "",
  settlement: "",
  address: "",
  city: "Бишкек",
  description: "",
  status: "Строительство",
  class: "Комфорт",
  construction: "Монолит",
  completionDate: "",
  floors: "",
  blocks: "",
  apartments: "",
  parking: "",
  area: "",
  landArea: "",
  ceilingHeight: "",
};

export default function EditResidentialComplexModal({
  complex,
  onClose,
  onSave,
}) {
  const { t } = useLanguage();

  const [form, setForm] = useState(initialForm);
  const [selectedAmenities, setSelectedAmenities] = useState([]);
  const [images, setImages] = useState([]);
  const [uploading, setUploading] = useState(false);

  const [locationsData, setLocationsData] = useState({
    regions: kyrgyzRegionsFallback,
    bishkekDistricts: bishkekDistrictsFallback,
  });

  const translateStatus = (value) => {
    const map = {
      Проект: "project",
      Строительство: "construction",
      Сдан: "completed",
    };

    return t(
      `editResidentialComplexModal.statuses.${map[value] || "construction"}`,
    );
  };

  const translateClass = (value) => {
    const map = {
      Эконом: "economy",
      Комфорт: "comfort",
      Бизнес: "business",
      Премиум: "premium",
    };

    return t(`editResidentialComplexModal.classes.${map[value] || "comfort"}`);
  };

  const translateConstruction = (value) => {
    const map = {
      Монолит: "monolith",
      "Монолитно-кирпичный": "monolithBrick",
      Кирпичный: "brick",
      Панельный: "panel",
      "Каркасно-монолитный": "frameMonolith",
      Газобетон: "aeratedConcrete",
    };

    return t(
      `editResidentialComplexModal.constructions.${map[value] || "monolith"}`,
    );
  };

  const translateAmenity = (value) => {
    const map = {
      "Детская площадка": "playground",
      Парковка: "parking",
      "Подземный паркинг": "undergroundParking",
      "Закрытая территория": "gatedArea",
      Охрана: "security",
      Видеонаблюдение: "videoSurveillance",
      Лифт: "elevator",
      "Детский сад": "kindergarten",
      Школа: "school",
      "Фитнес-зал": "fitness",
      "Зеленая зона": "greenArea",
      "Коммерческие помещения": "commercial",
    };

    return t(
      `editResidentialComplexModal.amenities.${map[value] || "playground"}`,
    );
  };

  useEffect(() => {
    let active = true;

    getConstants()
      .then((res) => {
        if (!active) return;

        const locations =
          res?.data?.locationsByRegion || res?.locationsByRegion;

        if (!locations) return;

        setLocationsData({
          regions: {
            BISHKEK: {
              name: "Бишкек",
              type: "bishkek",
            },
            CHUY: {
              name: "Чуйская область",
              type: "region",
              settlements:
                locations.CHUY || kyrgyzRegionsFallback.CHUY.settlements,
            },
            OSH_REGION: {
              name: "Ошская область",
              type: "region",
              settlements: [
                ...(locations.OSH_CITY || []),
                ...(locations.OSH_REGION || []),
              ],
            },
            ISSYK_KUL: {
              name: "Иссык-Кульская область",
              type: "region",
              settlements:
                locations.ISSYK_KUL ||
                kyrgyzRegionsFallback.ISSYK_KUL.settlements,
            },
            JALAL_ABAD: {
              name: "Джалал-Абадская область",
              type: "region",
              settlements:
                locations.JALAL_ABAD ||
                kyrgyzRegionsFallback.JALAL_ABAD.settlements,
            },
            NARYN: {
              name: "Нарынская область",
              type: "region",
              settlements:
                locations.NARYN || kyrgyzRegionsFallback.NARYN.settlements,
            },
            TALAS: {
              name: "Таласская область",
              type: "region",
              settlements:
                locations.TALAS || kyrgyzRegionsFallback.TALAS.settlements,
            },
            BATKEN: {
              name: "Баткенская область",
              type: "region",
              settlements:
                locations.BATKEN || kyrgyzRegionsFallback.BATKEN.settlements,
            },
          },
          bishkekDistricts: locations.BISHKEK || bishkekDistrictsFallback,
        });
      })
      .catch((err) => {
        console.error("Не удалось загрузить список локаций:", err);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!complex) return;

    const f = complex.rawFeatures || complex.features || {};

    const extractVal = (rawVal, val) => {
      if (rawVal !== undefined && rawVal !== null && rawVal !== "") {
        return rawVal;
      }

      if (
        val === undefined ||
        val === null ||
        val === "" ||
        val === "Не указано"
      ) {
        return "";
      }

      const cleaned = String(val)
        .replace(/[^\d.,]/g, "")
        .replace(",", ".");

      return cleaned || "";
    };

    const savedCountry =
      complex.country === "turkey" || complex.country === "kyrgyzstan"
        ? complex.country
        : "kyrgyzstan";

    const savedRegion = complex.region || "";
    const savedDistrict = complex.district || "";
    const savedSettlement = complex.settlement || "";

    setForm({
      ...initialForm,
      name: complex.name || "",
      country: savedCountry,
      region: savedRegion,
      district: savedDistrict,
      settlement: savedSettlement,
      address: complex.address || "",
      city: complex.city || "Бишкек",
      description: complex.description || "",
      status: complex.status || "Строительство",
      class: complex.class || "Комфорт",
      construction:
        f.construction ||
        complex.constructionVal ||
        (complex.constructionType && complex.constructionType !== "Не указано"
          ? complex.constructionType
          : "Монолит"),
      completionDate: complex.completionDate || "",
      floors: extractVal(f.floors, complex.floors),
      blocks: extractVal(f.blocks, complex.blocks),
      apartments: extractVal(f.apartments, complex.apartments),
      parking: extractVal(f.parking, complex.parking),
      area: extractVal(f.area, complex.area),
      landArea: extractVal(f.areaSotka, complex.landArea),
      ceilingHeight: extractVal(f.ceilingHeight, complex.ceilingHeight),
    });

    setSelectedAmenities(complex.amenities || []);

    setImages(
      (complex.images || []).map((image) => ({
        file: null,
        url: image,
      })),
    );
  }, [complex]);

  useEffect(() => {
    if (!complex) return;

    const handleEscape = (event) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleEscape);

    return () => document.removeEventListener("keydown", handleEscape);
  }, [complex, onClose]);

  useEffect(() => {
    return () => {
      images.forEach((image) => {
        if (image?.file && image?.url?.startsWith("blob:")) {
          URL.revokeObjectURL(image.url);
        }
      });
    };
  }, []);

  if (!complex) return null;

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  }

  function setField(name, value) {
    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  }

  function selectCountry(country) {
    setForm((prev) => ({
      ...prev,
      country,
      region: "",
      district: "",
      settlement: "",
      city: "",
    }));
  }

  function selectRegion(region) {
    const selected = locationsData.regions[region];

    setForm((prev) => ({
      ...prev,
      region,
      district: "",
      settlement: "",
      city: selected?.type === "bishkek" ? "Бишкек" : "",
    }));
  }

  function selectSettlement(settlement) {
    setForm((prev) => ({
      ...prev,
      settlement,
      city: settlement,
      district: "",
    }));
  }

  function selectTurkeyCity(cityKey) {
    const selected = turkeyCities[cityKey];

    setForm((prev) => ({
      ...prev,
      cityKey,
      city: selected?.name || "",
      region: "",
      settlement: "",
      district: "",
    }));
  }

  function selectDistrict(district) {
    setForm((prev) => ({
      ...prev,
      district,
    }));
  }

  function toggleAmenity(item) {
    setSelectedAmenities((prev) =>
      prev.includes(item)
        ? prev.filter((value) => value !== item)
        : [...prev, item],
    );
  }

  function handleImages(event) {
    const files = Array.from(event.target.files || []);

    if (!files.length) return;

    const availableSlots = MAX_IMAGES - images.length;

    if (availableSlots <= 0) {
      event.target.value = "";
      return;
    }

    const selectedFiles = files.slice(0, availableSlots);

    const newImages = selectedFiles.map((file) => ({
      file,
      url: URL.createObjectURL(file),
    }));

    setImages((prev) => [...prev, ...newImages]);
    event.target.value = "";
  }

  function removeImage(index) {
    setImages((prev) => {
      const image = prev[index];

      if (image?.file && image?.url?.startsWith("blob:")) {
        URL.revokeObjectURL(image.url);
      }

      return prev.filter((_, imageIndex) => imageIndex !== index);
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (uploading) return;

    const parseNum = (val) => {
      if (val === undefined || val === null || val === "") return null;

      const num = parseFloat(String(val).replace(",", "."));

      return Number.isNaN(num) ? val : num;
    };

    const token = localStorage.getItem("uytap_token");
    const finalUrls = [];

    setUploading(true);

    try {
      for (const img of images) {
        if (img.file instanceof File) {
          try {
            const uploadedUrl = await uploadComplexPhoto(token, img.file);

            if (uploadedUrl) finalUrls.push(uploadedUrl);
          } catch (err) {
            console.error("Ошибка загрузки фото ЖК:", err);
          }
        } else if (img.url && !img.url.startsWith("blob:")) {
          finalUrls.push(img.url);
        }
      }

      const updatedComplex = {
        ...complex,
        ...form,

        // Структурированные данные локации для последующей фильтрации ЖК.
        country: form.country,
        region: form.region,
        district: form.district,
        settlement: form.settlement,
        city: form.city,

        floors: parseNum(form.floors),
        blocks: parseNum(form.blocks),
        apartments: parseNum(form.apartments),
        parking: parseNum(form.parking),
        area: parseNum(form.area),
        landArea: parseNum(form.landArea),
        ceilingHeight: parseNum(form.ceilingHeight),

        amenities: selectedAmenities,
        images: finalUrls,
      };

      await onSave(updatedComplex, token);
    } catch (err) {
      console.error("Ошибка сохранения ЖК:", err);
    } finally {
      setUploading(false);
    }
  }

  function handleOverlayMouseDown(event) {
    if (event.target === event.currentTarget) onClose();
  }

  const translateOptions = (values, translator) =>
    values.map((value) => ({
      value,
      label: translator ? translator(value) : value,
    }));

  const translatedStatuses = translateOptions(statuses, translateStatus);
  const translatedClasses = translateOptions(classes, translateClass);
  const translatedConstructions = translateOptions(
    constructions,
    translateConstruction,
  );

  const getOriginalValue = (translatedValue, values, translator) => {
    const found = values.find((value) => translator(value) === translatedValue);

    return found || values[0];
  };

  const selectedRegion = locationsData.regions[form.region];
  const isKyrgyzstan = form.country === "kyrgyzstan";
  const isTurkey = form.country === "turkey";
  const isBishkek = isKyrgyzstan && selectedRegion?.type === "bishkek";

  const turkeyCityKey =
    form.cityKey ||
    Object.keys(turkeyCities).find(
      (key) => turkeyCities[key].name === form.city,
    ) ||
    "";

  const selectedTurkeyCity = turkeyCities[turkeyCityKey];

  const regionOptions = Object.entries(locationsData.regions).map(
    ([value, item]) => ({
      value,
      label: item.name,
    }),
  );

  const settlementOptions = (selectedRegion?.settlements || []).map(
    (value) => ({ value, label: value }),
  );

  const districtOptions = (
    isBishkek
      ? locationsData.bishkekDistricts
      : selectedTurkeyCity?.districts || []
  ).map((value) => ({ value, label: value }));

  const turkeyCityOptions = Object.entries(turkeyCities).map(
    ([value, item]) => ({
      value,
      label: item.name,
    }),
  );

  const selectedStatusLabel = translateStatus(form.status);
  const selectedClassLabel = translateClass(form.class);
  const selectedConstructionLabel = translateConstruction(form.construction);

  return (
    <div
      className={styles.overlay}
      onMouseDown={handleOverlayMouseDown}
      role="presentation"
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-residential-complex-title"
      >
        <header className={styles.modalHeader}>
          <div className={styles.headerContent}>
            <span className={styles.eyebrow}>
              <Building2 />
              {t("editResidentialComplexModal.header.eyebrow")}
            </span>

            <h2 id="edit-residential-complex-title">
              {complex.name ||
                t("editResidentialComplexModal.fallback.complex")}
            </h2>

            <p>{t("editResidentialComplexModal.header.description")}</p>
          </div>

          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label={t("editResidentialComplexModal.actions.close")}
          >
            <X />
          </button>
        </header>

        <div className={styles.modalBody}>
          <form onSubmit={handleSubmit} className={styles.form}>
            {/* 01 — ОСНОВНАЯ ИНФОРМАЦИЯ */}

            <section className={styles.card}>
              <div className={styles.sectionHeader}>
                <div className={styles.sectionIcon}>
                  <Building2 />
                </div>

                <div>
                  <span>01</span>
                  <h3>{t("editResidentialComplexModal.sections.basic")}</h3>
                </div>
              </div>

              <div className={styles.grid}>
                <div className={`${styles.field} ${styles.full}`}>
                  <label htmlFor="complex-name">
                    {t("editResidentialComplexModal.fields.name")} <b>*</b>
                  </label>

                  <input
                    id="complex-name"
                    name="name"
                    type="text"
                    value={form.name}
                    onChange={handleChange}
                    placeholder={t(
                      "editResidentialComplexModal.placeholders.name",
                    )}
                    autoComplete="off"
                    required
                  />
                </div>
              </div>
            </section>

            {/* 02 — МЕСТОПОЛОЖЕНИЕ */}

            <section className={styles.card}>
              <div className={styles.sectionHeader}>
                <div className={styles.sectionIcon}>
                  <MapPin />
                </div>

                <div>
                  <span>02</span>
                  <h3>Местоположение ЖК</h3>
                </div>
              </div>

              <div className={styles.grid}>
                <div className={`${styles.field} ${styles.full}`}>
                  <label>Страна</label>

                  <CustomSelect
                    icon={Globe2}
                    title="Выберите страну"
                    value={form.country === "turkey" ? "Турция" : "Кыргызстан"}
                    options={[
                      { value: "kyrgyzstan", label: "Кыргызстан" },
                      { value: "turkey", label: "Турция" },
                    ]}
                    setValue={selectCountry}
                  />
                </div>

                {isKyrgyzstan && (
                  <>
                    <div className={`${styles.field} ${styles.full}`}>
                      <label>Область / город</label>

                      <CustomSelect
                        icon={MapPin}
                        title="Выберите область или город"
                        value={form.region}
                        options={regionOptions}
                        setValue={selectRegion}
                      />
                    </div>

                    {isBishkek && (
                      <div className={`${styles.field} ${styles.full}`}>
                        <label>Район Бишкека</label>

                        <CustomSelect
                          icon={MapPin}
                          title="Выберите район"
                          value={form.district}
                          options={districtOptions}
                          setValue={selectDistrict}
                        />
                      </div>
                    )}

                    {selectedRegion && !isBishkek && (
                      <div className={`${styles.field} ${styles.full}`}>
                        <label>Населённый пункт</label>

                        <CustomSelect
                          icon={MapPin}
                          title="Выберите населённый пункт"
                          value={form.settlement}
                          options={settlementOptions}
                          setValue={selectSettlement}
                        />
                      </div>
                    )}
                  </>
                )}

                {isTurkey && (
                  <>
                    <div className={`${styles.field} ${styles.full}`}>
                      <label>Город</label>

                      <CustomSelect
                        icon={MapPin}
                        title="Выберите город"
                        value={turkeyCityKey}
                        options={turkeyCityOptions}
                        setValue={selectTurkeyCity}
                      />
                    </div>

                    {selectedTurkeyCity && (
                      <div className={`${styles.field} ${styles.full}`}>
                        <label>Район</label>

                        <CustomSelect
                          icon={MapPin}
                          title="Выберите район"
                          value={form.district}
                          options={districtOptions}
                          setValue={selectDistrict}
                        />
                      </div>
                    )}
                  </>
                )}

                <div className={`${styles.field} ${styles.full}`}>
                  <label htmlFor="complex-address">
                    {t("editResidentialComplexModal.fields.address")} <b>*</b>
                  </label>

                  <div className={styles.inputWithIcon}>
                    <MapPin />

                    <input
                      id="complex-address"
                      name="address"
                      type="text"
                      value={form.address}
                      onChange={handleChange}
                      placeholder={t(
                        "editResidentialComplexModal.placeholders.address",
                      )}
                      autoComplete="street-address"
                      required
                    />
                  </div>
                </div>

                <div className={`${styles.field} ${styles.full}`}>
                  <label htmlFor="complex-description">
                    {t("editResidentialComplexModal.fields.description")}
                  </label>

                  <textarea
                    id="complex-description"
                    name="description"
                    value={form.description}
                    onChange={handleChange}
                    placeholder={t(
                      "editResidentialComplexModal.placeholders.description",
                    )}
                    rows={5}
                    maxLength={1000}
                  />

                  <span className={styles.counter}>
                    {form.description.length}/1000
                  </span>
                </div>
              </div>
            </section>

            {/* 03 — ХАРАКТЕРИСТИКИ */}

            <section className={styles.card}>
              <div className={styles.sectionHeader}>
                <div className={styles.sectionIcon}>
                  <Layers3 />
                </div>

                <div>
                  <span>03</span>
                  <h3>
                    {t("editResidentialComplexModal.sections.characteristics")}
                  </h3>
                </div>
              </div>

              <div className={styles.grid}>
                <div className={styles.field}>
                  <label>
                    {t("editResidentialComplexModal.fields.status")}
                  </label>

                  <CustomSelect
                    icon={Layers3}
                    title={t("editResidentialComplexModal.fields.status")}
                    options={translatedStatuses}
                    value={selectedStatusLabel}
                    setValue={(value) =>
                      setField(
                        "status",
                        getOriginalValue(value, statuses, translateStatus),
                      )
                    }
                  />
                </div>

                <div className={styles.field}>
                  <label>{t("editResidentialComplexModal.fields.class")}</label>

                  <CustomSelect
                    icon={Building2}
                    title={t("editResidentialComplexModal.fields.class")}
                    options={translatedClasses}
                    value={selectedClassLabel}
                    setValue={(value) =>
                      setField(
                        "class",
                        getOriginalValue(value, classes, translateClass),
                      )
                    }
                  />
                </div>

                <div className={styles.field}>
                  <label>
                    {t("editResidentialComplexModal.fields.construction")}
                  </label>

                  <CustomSelect
                    icon={Blocks}
                    title={t("editResidentialComplexModal.fields.construction")}
                    options={translatedConstructions}
                    value={selectedConstructionLabel}
                    setValue={(value) =>
                      setField(
                        "construction",
                        getOriginalValue(
                          value,
                          constructions,
                          translateConstruction,
                        ),
                      )
                    }
                  />
                </div>

                <div className={styles.field}>
                  <label htmlFor="completion-date">
                    {t("editResidentialComplexModal.fields.completionDate")}
                  </label>

                  <div className={styles.inputWithIcon}>
                    <CalendarDays />

                    <input
                      id="completion-date"
                      type="date"
                      name="completionDate"
                      value={form.completionDate}
                      onChange={handleChange}
                    />
                  </div>
                </div>

                <div className={styles.field}>
                  <label htmlFor="complex-floors">
                    {t("editResidentialComplexModal.fields.floors")}
                  </label>

                  <div className={styles.inputWithIcon}>
                    <Layers3 />

                    <input
                      id="complex-floors"
                      type="number"
                      name="floors"
                      value={form.floors}
                      onChange={handleChange}
                      min="1"
                      placeholder="0"
                    />
                  </div>
                </div>

                <div className={styles.field}>
                  <label htmlFor="complex-blocks">
                    {t("editResidentialComplexModal.fields.blocks")}
                  </label>

                  <div className={styles.inputWithIcon}>
                    <Blocks />

                    <input
                      id="complex-blocks"
                      type="number"
                      name="blocks"
                      value={form.blocks}
                      onChange={handleChange}
                      min="1"
                      placeholder="0"
                    />
                  </div>
                </div>

                <div className={styles.field}>
                  <label htmlFor="complex-apartments">
                    {t("editResidentialComplexModal.fields.apartments")}
                  </label>

                  <div className={styles.inputWithIcon}>
                    <Home />

                    <input
                      id="complex-apartments"
                      type="number"
                      name="apartments"
                      value={form.apartments}
                      onChange={handleChange}
                      min="0"
                      placeholder="0"
                    />
                  </div>
                </div>

                <div className={styles.field}>
                  <label htmlFor="complex-parking">
                    {t("editResidentialComplexModal.fields.parking")}
                  </label>

                  <div className={styles.inputWithIcon}>
                    <Car />

                    <input
                      id="complex-parking"
                      type="number"
                      name="parking"
                      value={form.parking}
                      onChange={handleChange}
                      min="0"
                      placeholder="0"
                    />
                  </div>
                </div>

                <div className={styles.field}>
                  <label htmlFor="complex-area">Площадь территории</label>

                  <div className={styles.inputWithIcon}>
                    <Ruler />

                    <input
                      id="complex-area"
                      type="number"
                      name="area"
                      value={form.area}
                      onChange={handleChange}
                      min="0"
                      step="0.01"
                      placeholder="0"
                    />
                  </div>
                </div>

                <div className={styles.field}>
                  <label htmlFor="complex-land-area">
                    {t("editResidentialComplexModal.fields.landArea")}
                  </label>

                  <div className={styles.inputWithIcon}>
                    <Maximize />

                    <input
                      id="complex-land-area"
                      type="number"
                      name="landArea"
                      value={form.landArea}
                      onChange={handleChange}
                      min="0"
                      step="0.01"
                      placeholder="0"
                    />
                  </div>
                </div>

                <div className={styles.field}>
                  <label htmlFor="complex-ceiling-height">
                    {t("editResidentialComplexModal.fields.ceilingHeight")}
                  </label>

                  <div className={styles.inputWithIcon}>
                    <Warehouse />

                    <input
                      id="complex-ceiling-height"
                      type="number"
                      name="ceilingHeight"
                      value={form.ceilingHeight}
                      onChange={handleChange}
                      min="0"
                      step="0.01"
                      placeholder="2.8"
                    />
                  </div>
                </div>
              </div>
            </section>

            {/* 04 — ИНФРАСТРУКТУРА */}

            <section className={styles.card}>
              <div className={styles.sectionHeader}>
                <div className={styles.sectionIcon}>
                  <Check />
                </div>

                <div>
                  <span>04</span>
                  <h3>
                    {t("editResidentialComplexModal.sections.infrastructure")}
                  </h3>
                </div>
              </div>

              <div className={styles.amenities}>
                {amenities.map((item) => {
                  const active = selectedAmenities.includes(item);

                  return (
                    <button
                      key={item}
                      type="button"
                      className={`${styles.amenity} ${
                        active ? styles.amenityActive : ""
                      }`}
                      onClick={() => toggleAmenity(item)}
                      aria-pressed={active}
                    >
                      <span className={styles.check}>
                        {active && <Check />}
                      </span>

                      <span>{translateAmenity(item)}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <div className={styles.formBottomSpace} />
          </form>
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.cancel}
            onClick={onClose}
            disabled={uploading}
          >
            {t("editResidentialComplexModal.actions.cancel")}
          </button>

          <button
            type="button"
            className={styles.save}
            disabled={uploading}
            onClick={(event) => {
              const formElement = event.currentTarget
                .closest(`.${styles.modal}`)
                ?.querySelector("form");

              formElement?.requestSubmit();
            }}
          >
            <Check />
            {uploading
              ? "Сохранение..."
              : t("editResidentialComplexModal.actions.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
