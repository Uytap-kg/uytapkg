"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createComplex, uploadComplexPhoto, getConstants } from "@/utils/api";

import {
  ArrowLeft,
  Building2,
  MapPin,
  ImagePlus,
  X,
  Check,
  Layers3,
  Home,
  Car,
  CalendarDays,
  Ruler,
  Upload,
  Maximize,
  Blocks,
  FileCheck,
  AlignLeft,
  Loader2,
  Globe2,
} from "lucide-react";

import styles from "./AddResidentialComplex.module.css";
import CustomSelect from "@/components/ui/customSelect/CustomSelect";
import { useLanguage } from "@/context/LanguageContext";

const statuses = ["Проект", "Строительство", "Сдан"];
const classes = ["Эконом", "Комфорт", "Бизнес", "Премиум"];

const constructions = [
  "Монолит",
  "Монолитно-каркасный",
  "Кирпичный",
  "Панельный",
  "Газобетон",
  "Комбинированный",
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

const fallbackLocations = {
  kyrgyzstan: {
    name: "Кыргызстан",
    regions: {
      BISHKEK: {
        name: "Бишкек",
        type: "bishkek",
        districts: [
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
        ],
      },
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
    },
  },

  turkey: {
    name: "Турция",
    cities: {
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
    },
  },
};

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("ru")
    .replaceAll("ё", "е");
}

function toOptions(items) {
  return items.map((item) => {
    if (typeof item === "string") {
      return { value: item, label: item };
    }

    if (item && typeof item === "object") {
      const value = item.value ?? item.name ?? item.label ?? "";
      return {
        value,
        label: item.label ?? item.name ?? item.value ?? "",
      };
    }

    return { value: String(item), label: String(item) };
  });
}

export default function AddResidentialComplex() {
  const router = useRouter();
  const { t } = useLanguage();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [locationsData, setLocationsData] = useState(fallbackLocations);

  const [form, setForm] = useState({
    name: "",
    country: "kyrgyzstan",
    region: "BISHKEK",
    city: "Бишкек",
    district: "",
    address: "",
    description: "",

    status: "Строительство",
    class: "Комфорт",
    construction: "Монолитно-каркасный",
    completionDate: "",

    floors: "",
    blocks: "",
    apartments: "",
    parking: "",
    ceilingHeight: "",

    area: "",
    areaSotka: "",

    documentsUrl: "",
  });

  const [selectedAmenities, setSelectedAmenities] = useState([]);
  const [images, setImages] = useState([]);

  useEffect(() => {
    let cancelled = false;

    getConstants()
      .then((res) => {
        if (cancelled) return;

        const locations =
          res?.data?.locationsByRegion || res?.locationsByRegion;

        if (!locations) return;

        setLocationsData((previous) => ({
          ...previous,
          kyrgyzstan: {
            ...previous.kyrgyzstan,
            regions: {
              ...previous.kyrgyzstan.regions,
              BISHKEK: {
                ...previous.kyrgyzstan.regions.BISHKEK,
                districts: toOptions(locations.BISHKEK || []).map(
                  (item) => item.value,
                ),
              },
              CHUY: {
                ...previous.kyrgyzstan.regions.CHUY,
                settlements: toOptions(locations.CHUY || []).map(
                  (item) => item.value,
                ),
              },
              OSH_REGION: {
                ...previous.kyrgyzstan.regions.OSH_REGION,
                settlements: [
                  ...(locations.OSH_CITY || []),
                  ...(locations.OSH_REGION || []),
                ].map((item) => toOptions([item])[0].value),
              },
              ISSYK_KUL: {
                ...previous.kyrgyzstan.regions.ISSYK_KUL,
                settlements: toOptions(locations.ISSYK_KUL || []).map(
                  (item) => item.value,
                ),
              },
              JALAL_ABAD: {
                ...previous.kyrgyzstan.regions.JALAL_ABAD,
                settlements: toOptions(locations.JALAL_ABAD || []).map(
                  (item) => item.value,
                ),
              },
              NARYN: {
                ...previous.kyrgyzstan.regions.NARYN,
                settlements: toOptions(locations.NARYN || []).map(
                  (item) => item.value,
                ),
              },
              TALAS: {
                ...previous.kyrgyzstan.regions.TALAS,
                settlements: toOptions(locations.TALAS || []).map(
                  (item) => item.value,
                ),
              },
              BATKEN: {
                ...previous.kyrgyzstan.regions.BATKEN,
                settlements: toOptions(locations.BATKEN || []).map(
                  (item) => item.value,
                ),
              },
            },
          },
        }));
      })
      .catch((err) => {
        console.error("Не удалось загрузить локации:", err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      images.forEach((image) => {
        if (image?.url) URL.revokeObjectURL(image.url);
      });
    };
  }, [images]);

  const isKyrgyzstan = form.country === "kyrgyzstan";
  const isTurkey = form.country === "turkey";

  const selectedRegion = isKyrgyzstan
    ? locationsData?.kyrgyzstan?.regions?.[form.region]
    : null;

  const isBishkek = isKyrgyzstan && form.region === "BISHKEK";

  const selectedTurkeyCity = isTurkey
    ? locationsData?.turkey?.cities?.[form.city]
    : null;

  const regionOptions = useMemo(
    () =>
      Object.entries(locationsData?.kyrgyzstan?.regions || {}).map(
        ([value, item]) => ({
          value,
          label: item.name,
        }),
      ),
    [locationsData],
  );

  const turkeyCityOptions = useMemo(
    () =>
      Object.entries(locationsData?.turkey?.cities || {}).map(
        ([value, item]) => ({
          value,
          label: item.name,
        }),
      ),
    [locationsData],
  );

  const districtOptions = useMemo(() => {
    if (isBishkek) {
      return toOptions(selectedRegion?.districts || []);
    }

    if (isTurkey) {
      return toOptions(selectedTurkeyCity?.districts || []);
    }

    return [];
  }, [isBishkek, isTurkey, selectedRegion, selectedTurkeyCity]);

  const settlementOptions = useMemo(
    () => toOptions(selectedRegion?.settlements || []),
    [selectedRegion],
  );

  const getTranslation = (key, fallback) => {
    const translated = t(key);
    return translated === key ? fallback : translated;
  };

  const getStatusLabel = (value) =>
    getTranslation(`addResidentialComplex.options.status.${value}`, value);

  const getClassLabel = (value) =>
    getTranslation(`addResidentialComplex.options.class.${value}`, value);

  const getConstructionLabel = (value) =>
    getTranslation(
      `addResidentialComplex.options.construction.${value}`,
      value,
    );

  const getAmenityLabel = (value) =>
    getTranslation(`addResidentialComplex.amenities.items.${value}`, value);

  const translatedStatuses = statuses.map((value) => ({
    value,
    label: getStatusLabel(value),
  }));

  const translatedClasses = classes.map((value) => ({
    value,
    label: getClassLabel(value),
  }));

  const translatedConstructions = constructions.map((value) => ({
    value,
    label: getConstructionLabel(value),
  }));

  const submitLabel = getTranslation(
    "addResidentialComplex.actions.submit",
    "Добавить ЖК",
  );

  const loadingLabel = getTranslation(
    "addResidentialComplex.actions.loading",
    "Сохранение...",
  );

  const handleChange = (e) => {
    const { name, value } = e.target;

    setForm((prev) => ({ ...prev, [name]: value }));
    setError("");
  };

  const setField = (name, value) => {
    setForm((prev) => ({ ...prev, [name]: value }));
    setError("");
  };

  const selectCountry = (country) => {
    setForm((prev) => ({
      ...prev,
      country,
      region: country === "kyrgyzstan" ? "BISHKEK" : "",
      city: country === "kyrgyzstan" ? "Бишкек" : "",
      district: "",
    }));
    setError("");
  };

  const selectRegion = (region) => {
    const regionData = locationsData?.kyrgyzstan?.regions?.[region];

    setForm((prev) => ({
      ...prev,
      region,
      city: region === "BISHKEK" ? "Бишкек" : "",
      district: "",
      address: "",
    }));

    if (!regionData) return;
    setError("");
  };

  const selectTurkeyCity = (cityKey) => {
    const cityData = locationsData?.turkey?.cities?.[cityKey];

    setForm((prev) => ({
      ...prev,
      city: cityKey,
      district: "",
      address: "",
    }));

    if (!cityData) return;
    setError("");
  };

  const toggleAmenity = (item) => {
    setSelectedAmenities((prev) =>
      prev.includes(item)
        ? prev.filter((value) => value !== item)
        : [...prev, item],
    );
  };

  const handleImages = (e) => {
    const files = Array.from(e.target.files || []);

    if (!files.length) return;

    const availableSlots = MAX_IMAGES - images.length;

    if (availableSlots <= 0) {
      e.target.value = "";
      return;
    }

    const selectedFiles = files.slice(0, availableSlots);

    const newImages = selectedFiles
      .filter((file) => file.type.startsWith("image/"))
      .map((file) => ({
        file,
        url: URL.createObjectURL(file),
      }));

    setImages((prev) => [...prev, ...newImages]);
    e.target.value = "";
  };

  const removeImage = (index) => {
    setImages((prev) => {
      const image = prev[index];

      if (image?.url) URL.revokeObjectURL(image.url);

      return prev.filter((_, i) => i !== index);
    });
  };

  const getCityName = () => {
    if (isTurkey) {
      return selectedTurkeyCity?.name || "";
    }

    if (isBishkek) {
      return "Бишкек";
    }

    return selectedRegion?.name || "";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (loading) return;

    setLoading(true);
    setError("");

    try {
      const token = localStorage.getItem("uytap_token");

      if (!token) {
        throw new Error(
          getTranslation(
            "addResidentialComplex.errors.unauthorized",
            "Необходимо авторизоваться.",
          ),
        );
      }

      if (!form.name.trim()) {
        throw new Error(
          getTranslation(
            "addResidentialComplex.errors.nameRequired",
            "Укажите название ЖК.",
          ),
        );
      }

      if (!form.country) {
        throw new Error("Выберите страну.");
      }

      if (!getCityName()) {
        throw new Error("Выберите город или область.");
      }

      if (!form.district.trim()) {
        throw new Error("Выберите район ЖК.");
      }

      if (!form.address.trim()) {
        throw new Error(
          getTranslation(
            "addResidentialComplex.errors.addressRequired",
            "Укажите адрес ЖК.",
          ),
        );
      }

      if (form.documentsUrl.trim()) {
        try {
          new URL(form.documentsUrl.trim());
        } catch {
          throw new Error(
            getTranslation(
              "addResidentialComplex.errors.invalidDocumentsUrl",
              "Укажите корректную ссылку на документы.",
            ),
          );
        }
      }

      const uploadedUrls = [];

      for (const image of images) {
        try {
          const url = await uploadComplexPhoto(token, image.file);
          if (url) uploadedUrls.push(url);
        } catch (uploadError) {
          console.error(
            `Ошибка загрузки изображения ${image.file.name}:`,
            uploadError,
          );
        }
      }

      const payload = {
        name: form.name.trim(),
        country: form.country,
        region: isKyrgyzstan ? form.region || null : null,
        city: getCityName(),
        cityKey: isTurkey ? form.city : null,
        district: form.district.trim(),
        address: form.address.trim(),
        description: form.description.trim(),

        status: form.status,
        class: form.class,
        construction: form.construction,

        completionDate: form.completionDate || null,

        floors: form.floors ? Number(form.floors) : 0,
        blocks: form.blocks ? Number(form.blocks) : 0,
        apartments: form.apartments ? Number(form.apartments) : 0,
        parking: form.parking ? Number(form.parking) : 0,
        ceilingHeight: form.ceilingHeight ? Number(form.ceilingHeight) : 0,

        area: form.area ? Number(form.area) : 0,
        areaSotka: form.areaSotka ? Number(form.areaSotka) : 0,

        amenities: selectedAmenities,
        images: uploadedUrls,
        documentsUrl: form.documentsUrl.trim() || null,
      };

      console.log("CREATE COMPLEX PAYLOAD:", payload);

      const res = await createComplex(token, payload);

      if (!res?.success) {
        throw new Error(
          res?.message ||
            getTranslation(
              "addResidentialComplex.errors.createFailed",
              "Не удалось создать ЖК.",
            ),
        );
      }

      router.push("/profile/projects");
    } catch (err) {
      console.error("Ошибка добавления ЖК:", err);

      setError(
        err?.message ||
          getTranslation(
            "addResidentialComplex.errors.saveFailed",
            "Не удалось сохранить ЖК.",
          ),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className={styles.page}>
      <div className={styles.backgroundGlow} />
      <div className={styles.backgroundGlowTwo} />

      <div className={styles.container}>
        <header className={styles.header}>
          <button
            type="button"
            className={styles.back}
            onClick={() => router.push("/profile")}
            disabled={loading}
          >
            <ArrowLeft size={18} />
            <span>{t("addResidentialComplex.backToProfile")}</span>
          </button>

          <div className={styles.headerContent}>
            <div className={styles.eyebrow}>
              <Building2 size={16} />
              {t("addResidentialComplex.developerPanel")}
            </div>

            <h1>{t("addResidentialComplex.title")}</h1>
            <p>{t("addResidentialComplex.description")}</p>
          </div>
        </header>

        {error && (
          <div className={styles.error} role="alert">
            <span>!</span>
            <p>{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className={styles.form}>
          {/* 01 — ОСНОВНАЯ ИНФОРМАЦИЯ */}

          <section className={styles.card}>
            <div className={styles.sectionHeader}>
              <div className={styles.sectionIcon}>
                <Building2 />
              </div>
              <div className={styles.sectionHeading}>
                <span className={styles.sectionNumber}>01</span>
                <h2>{t("addResidentialComplex.sections.basic.title")}</h2>
                <p>{t("addResidentialComplex.sections.basic.description")}</p>
              </div>
            </div>

            <div className={styles.grid}>
              <div className={`${styles.field} ${styles.full}`}>
                <label htmlFor="complex-name">
                  {t("addResidentialComplex.fields.name")} <span>*</span>
                </label>
                <div className={styles.inputWithIcon}>
                  <Building2 />
                  <input
                    id="complex-name"
                    name="name"
                    type="text"
                    value={form.name}
                    onChange={handleChange}
                    placeholder={t("addResidentialComplex.placeholders.name")}
                    autoComplete="organization"
                    required
                  />
                </div>
              </div>

              <div className={`${styles.field} ${styles.full}`}>
                <label>
                  Страна<span>*</span>
                </label>
                <div className={styles.grid}>
                  <CustomSelect
                    title="Выберите страну"
                    value={form.country}
                    setValue={selectCountry}
                    options={[
                      { value: "kyrgyzstan", label: "Кыргызстан" },
                      { value: "turkey", label: "Турция" },
                    ]}
                  />
                </div>
              </div>

              {isKyrgyzstan && (
                <div className={styles.field}>
                  <label>
                    Область / регион <span>*</span>
                  </label>
                  <CustomSelect
                    icon={MapPin}
                    title="Выберите регион"
                    value={form.region}
                    setValue={selectRegion}
                    options={regionOptions}
                  />
                </div>
              )}

              {isTurkey && (
                <div className={styles.field}>
                  <label>
                    Город <span>*</span>
                  </label>
                  <CustomSelect
                    icon={MapPin}
                    title="Выберите город"
                    value={form.city}
                    setValue={selectTurkeyCity}
                    options={turkeyCityOptions}
                  />
                </div>
              )}

              {isKyrgyzstan && !isBishkek && (
                <div className={styles.field}>
                  <label>
                    Населённый пункт <span>*</span>
                  </label>
                  <CustomSelect
                    icon={MapPin}
                    title="Выберите населённый пункт"
                    value={form.city}
                    setValue={(value) => setField("city", value)}
                    options={settlementOptions}
                  />
                </div>
              )}

              <div className={styles.field}>
                <label>
                  {isBishkek ? "Район / часть Бишкека" : "Район"} <span>*</span>
                </label>
                <CustomSelect
                  icon={MapPin}
                  title="Выберите район"
                  value={form.district}
                  setValue={(value) => setField("district", value)}
                  options={districtOptions}
                />
              </div>

              <div className={styles.field}>
                <label htmlFor="complex-address">
                  {t("addResidentialComplex.fields.address")} <span>*</span>
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
                      "addResidentialComplex.placeholders.address",
                    )}
                    autoComplete="street-address"
                    required
                  />
                </div>
              </div>

              <div className={`${styles.field} ${styles.full}`}>
                <label htmlFor="complex-description">
                  {t("addResidentialComplex.fields.description")}
                </label>
                <div className={styles.textareaWrapper}>
                  <AlignLeft className={styles.textareaIcon} />
                  <textarea
                    id="complex-description"
                    name="description"
                    value={form.description}
                    onChange={handleChange}
                    placeholder={t(
                      "addResidentialComplex.placeholders.description",
                    )}
                    rows={7}
                    maxLength={1000}
                  />
                  <span className={styles.counter}>
                    {form.description.length}/1000
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* 02 — ХАРАКТЕРИСТИКИ */}

          <section className={styles.card}>
            <div className={styles.sectionHeader}>
              <div className={styles.sectionIcon}>
                <Layers3 />
              </div>
              <div className={styles.sectionHeading}>
                <span className={styles.sectionNumber}>02</span>
                <h2>
                  {t("addResidentialComplex.sections.characteristics.title")}
                </h2>
                <p>
                  {t(
                    "addResidentialComplex.sections.characteristics.description",
                  )}
                </p>
              </div>
            </div>

            <div className={styles.grid}>
              <div className={styles.field}>
                <label>{t("addResidentialComplex.fields.status")}</label>
                <CustomSelect
                  icon={Layers3}
                  title={t("addResidentialComplex.selectTitles.status")}
                  options={translatedStatuses}
                  value={form.status}
                  setValue={(value) => setField("status", value)}
                />
              </div>

              <div className={styles.field}>
                <label>{t("addResidentialComplex.fields.class")}</label>
                <CustomSelect
                  icon={Building2}
                  title={t("addResidentialComplex.selectTitles.class")}
                  options={translatedClasses}
                  value={form.class}
                  setValue={(value) => setField("class", value)}
                />
              </div>

              <div className={styles.field}>
                <label>{t("addResidentialComplex.fields.construction")}</label>
                <CustomSelect
                  icon={Building2}
                  title={t("addResidentialComplex.selectTitles.construction")}
                  options={translatedConstructions}
                  value={form.construction}
                  setValue={(value) => setField("construction", value)}
                />
              </div>

              <div className={styles.field}>
                <label htmlFor="completion-date">
                  {t("addResidentialComplex.fields.completionDate")}
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

              {[
                {
                  id: "floors",
                  label: "floors",
                  icon: Layers3,
                  placeholder: "12",
                  min: "1",
                  step: "1",
                },
                {
                  id: "blocks",
                  label: "blocks",
                  icon: Blocks,
                  placeholder: "4",
                  min: "1",
                  step: "1",
                },
                {
                  id: "apartments",
                  label: "apartments",
                  icon: Home,
                  placeholder: "240",
                  min: "0",
                  step: "1",
                },
                {
                  id: "parking",
                  label: "parking",
                  icon: Car,
                  placeholder: "120",
                  min: "0",
                  step: "1",
                },
                {
                  id: "ceilingHeight",
                  label: "ceilingHeight",
                  icon: Maximize,
                  placeholder: "2.8",
                  min: "1",
                  step: "0.1",
                },
                {
                  id: "area",
                  label: "area",
                  icon: Ruler,
                  placeholder: "25000",
                  min: "0",
                  step: "0.01",
                },
                {
                  id: "areaSotka",
                  label: "areaSotka",
                  icon: Ruler,
                  placeholder: "250",
                  min: "0",
                  step: "0.01",
                },
              ].map(({ id, label, icon: Icon, placeholder, min, step }) => (
                <div className={styles.field} key={id}>
                  <label htmlFor={id}>
                    {t(`addResidentialComplex.fields.${label}`)}
                  </label>
                  <div className={styles.inputWithIcon}>
                    <Icon />
                    <input
                      id={id}
                      type="number"
                      name={id}
                      value={form[id]}
                      onChange={handleChange}
                      placeholder={placeholder}
                      min={min}
                      step={step}
                      inputMode={step === "1" ? "numeric" : "decimal"}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 03 — ИНФРАСТРУКТУРА */}

          <section className={styles.card}>
            <div className={styles.sectionHeader}>
              <div className={styles.sectionIcon}>
                <Check />
              </div>
              <div className={styles.sectionHeading}>
                <span className={styles.sectionNumber}>03</span>
                <h2>
                  {t("addResidentialComplex.sections.infrastructure.title")}
                </h2>
                <p>
                  {t(
                    "addResidentialComplex.sections.infrastructure.description",
                  )}
                </p>
              </div>
            </div>

            <div className={styles.amenities}>
              {amenities.map((item) => {
                const active = selectedAmenities.includes(item);

                return (
                  <button
                    type="button"
                    key={item}
                    className={`${styles.amenity} ${
                      active ? styles.amenityActive : ""
                    }`}
                    onClick={() => toggleAmenity(item)}
                    aria-pressed={active}
                  >
                    <span className={styles.amenityCheck}>
                      {active && <Check size={14} />}
                    </span>
                    <span>{getAmenityLabel(item)}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 04 — ФОТОГРАФИИ */}

          <section className={styles.card}>
            <div className={styles.sectionHeader}>
              <div className={styles.sectionIcon}>
                <ImagePlus />
              </div>
              <div className={styles.sectionHeading}>
                <span className={styles.sectionNumber}>04</span>
                <h2>{t("addResidentialComplex.sections.photos.title")}</h2>
                <p>{t("addResidentialComplex.sections.photos.description")}</p>
              </div>
            </div>

            <div className={styles.uploadTop}>
              <div className={styles.uploadInfo}>
                <strong>{t("addResidentialComplex.photos.title")}</strong>
                <span>{t("addResidentialComplex.photos.description")}</span>
              </div>
              <div className={styles.imageCount}>
                {images.length} / {MAX_IMAGES}
              </div>
            </div>

            {images.length < MAX_IMAGES && (
              <label className={styles.upload}>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  onChange={handleImages}
                />
                <div className={styles.uploadIcon}>
                  <Upload />
                </div>
                <strong>{t("addResidentialComplex.photos.add")}</strong>
                <span>
                  {t("addResidentialComplex.photos.formats")} ·{" "}
                  {t("addResidentialComplex.photos.upTo")} {MAX_IMAGES}{" "}
                  {t("addResidentialComplex.photos.images")}
                </span>
              </label>
            )}

            {images.length === MAX_IMAGES && (
              <div className={styles.limitReached}>
                <Check />
                {t("addResidentialComplex.photos.limitReached")}
              </div>
            )}

            {images.length > 0 && (
              <div className={styles.images}>
                {images.map((image, index) => (
                  <div className={styles.image} key={image.url}>
                    <img
                      src={image.url}
                      alt={`${t("addResidentialComplex.photos.photoAlt")} ${
                        index + 1
                      }`}
                    />
                    {index === 0 && (
                      <span className={styles.cover}>
                        {t("addResidentialComplex.photos.cover")}
                      </span>
                    )}
                    <span className={styles.imageNumber}>{index + 1}</span>
                    <button
                      type="button"
                      onClick={() => removeImage(index)}
                      className={styles.removeImage}
                      aria-label={`${t(
                        "addResidentialComplex.photos.remove",
                      )} ${index + 1}`}
                    >
                      <X />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 05 — ДОКУМЕНТЫ */}

          <section className={styles.card}>
            <div className={styles.sectionHeader}>
              <div className={styles.sectionIcon}>
                <FileCheck />
              </div>
              <div className={styles.sectionHeading}>
                <span className={styles.sectionNumber}>05</span>
                <h2>{t("addResidentialComplex.sections.official.title")}</h2>
                <p>
                  {t("addResidentialComplex.sections.official.description")}
                </p>
              </div>
            </div>

            <div className={styles.documentForm}>
              <div className={styles.field}>
                <label htmlFor="complex-documents">
                  {t("addResidentialComplex.fields.documentsUrl")}
                </label>
                <div className={styles.inputWithIcon}>
                  <FileCheck />
                  <input
                    id="complex-documents"
                    name="documentsUrl"
                    type="url"
                    value={form.documentsUrl}
                    onChange={handleChange}
                    placeholder="https://..."
                    autoComplete="url"
                  />
                </div>
                <small className={styles.fieldHint}>
                  {t("addResidentialComplex.fields.documentsHint")}
                </small>
              </div>
            </div>
          </section>

          {/* ACTIONS */}

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.cancel}
              onClick={() => router.push("/profile")}
              disabled={loading}
            >
              <ArrowLeft size={17} />
              <span>{t("common.cancel")}</span>
            </button>

            <button type="submit" className={styles.submit} disabled={loading}>
              {loading ? (
                <>
                  <Loader2 size={18} className={styles.spinner} />
                  <span>{loadingLabel}</span>
                </>
              ) : (
                <>
                  <Building2 size={18} />
                  <span>{submitLabel}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
