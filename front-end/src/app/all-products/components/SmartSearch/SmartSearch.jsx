"use client";

import {
  Mic,
  MicOff,
  Sparkles,
  RotateCcw,
  Search,
  Loader2,
  X,
} from "lucide-react";

import { useEffect, useRef, useState } from "react";

import { useLanguage } from "@/context/LanguageContext";

import styles from "./SmartSearch.module.css";

const SAFE_MAX_TEXT_LENGTH = 2000;

/* =========================================================
   NORMALIZATION HELPERS
========================================================= */

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ");
}

function cleanValue(value) {
  if (value === undefined || value === null) return "";

  return String(value).trim().replace(/\s+/g, " ");
}

/* =========================================================
   PROPERTY TYPES
========================================================= */

const PROPERTY_TYPES = {
  apartment: "apartment",
  apartments: "apartment",
  flat: "apartment",

  квартира: "apartment",
  квартиры: "apartment",
  квартир: "apartment",

  // Кыргызча
  батир: "apartment",
  батирлер: "apartment",

  house: "house",
  дома: "house",
  дом: "house",

  // Кыргызча
  үй: "house",
  уй: "house",
  үйлөр: "house",
  уйлор: "house",

  cottage: "cottage",
  коттедж: "cottage",
  коттеджи: "cottage",

  // Кыргызча
  коттедждер: "cottage",

  land: "land",
  участок: "land",
  участки: "land",
  земля: "land",

  // Кыргызча
  жер: "land",
  участоктор: "land",

  room: "room",
  комната: "room",
  комнаты: "room",

  // Кыргызча
  бөлмө: "room",
  болмө: "room",
  бөлмөлөр: "room",

  commercial: "commercial",
  коммерция: "commercial",
  коммерческая: "commercial",

  // Кыргызча
  коммерциялык: "commercial",

  parking: "parking",
  паркинг: "parking",
  гараж: "parking",
  гаражи: "parking",

  // Кыргызча
  унааТоктотмоЖай: "parking",
};

/* =========================================================
   DEAL TYPES
========================================================= */

const DEAL_TYPES = {
  sale: "sale",
  sell: "sale",
  продажа: "sale",
  продам: "sale",
  купить: "sale",
  покупка: "sale",

  // Кыргызча
  сатуу: "sale",
  сатам: "sale",
  сатыпАлуу: "sale",
  сатып: "sale",

  rent: "rent",
  аренда: "rent",
  арендовать: "rent",
  снять: "rent",
  сниму: "rent",
  "сниму в аренду": "rent",

  // Кыргызча
  ижара: "rent",
  ижарага: "rent",
  "ижарага алуу": "rent",
  алам: "rent",
};

/* =========================================================
   REGIONS
========================================================= */

const REGION_TYPES = {
  bishkek: "BISHKEK",
  бишкек: "BISHKEK",

  ош: "OSH",
  osh: "OSH",
  "ошская область": "OSH",
  "ош облусу": "OSH",

  "issyk-kul": "ISSYK_KUL",
  "issyk kul": "ISSYK_KUL",
  "issyk-kul region": "ISSYK_KUL",
  "issyk kul region": "ISSYK_KUL",

  "иссык-куль": "ISSYK_KUL",
  "иссык куль": "ISSYK_KUL",
  "иссык-кульская область": "ISSYK_KUL",
  "иссык кульская область": "ISSYK_KUL",

  // Кыргызча
  "ысык-көл": "ISSYK_KUL",
  "ысык көл": "ISSYK_KUL",
  ысыккөл: "ISSYK_KUL",
  "ысык-көл облусу": "ISSYK_KUL",

  chu: "CHUY",
  "чуйская область": "CHUY",
  чуй: "CHUY",
  чүй: "CHUY",
  "чүй облусу": "CHUY",

  "jalal-abad": "JALAL_ABAD",
  "жалал-абад": "JALAL_ABAD",
  "джалал-абад": "JALAL_ABAD",
  "джалал-абадская область": "JALAL_ABAD",
  "джалал абадская область": "JALAL_ABAD",

  // Кыргызча
  "жалал-абад облусу": "JALAL_ABAD",
  "жалал абад облусу": "JALAL_ABAD",

  batken: "BATKEN",
  баткен: "BATKEN",
  "баткенская область": "BATKEN",
  "баткен облусу": "BATKEN",

  naryn: "NARYN",
  нарын: "NARYN",
  "нарынская область": "NARYN",
  "нарын облусу": "NARYN",

  talas: "TALAS",
  талас: "TALAS",
  "таласская область": "TALAS",
  "талас облусу": "TALAS",

  turkey: "TURKEY",
  турция: "TURKEY",
  турцию: "TURKEY",
  турции: "TURKEY",

  // Кыргызча
  түркия: "TURKEY",
  түркияны: "TURKEY",
};

/* =========================================================
   ISSYK-KUL CITIES
========================================================= */

const ISSYK_KUL_CITIES = [
  "каракол",
  "чолпон-ата",
  "чолпоната",
  "бостери",
  "тамчы",
  "тамчи",
  "чон-сары-ой",
  "чон сары ой",
  "сары-ой",
  "сары ой",
  "боконбаево",
  "барскоон",
  "тамга",
  "каджи-сай",
  "каджисай",
  "тосор",
  "ананьево",
  "пристань-пржевальск",
  "рыбачье",
  "балыкчы",
  "иссык-куль",

  // Кыргызские варианты
  "ысык-көл",
  "ысык көл",
  "каракол",
  "чолпон-ата",
  "чолпон ата",
  "бостери",
  "тамчы",
  "чоң-сары-ой",
  "чоң сары ой",
  "сары-ой",
  "сары ой",
  "боконбаево",
  "барскоон",
  "тамга",
  "кажы-сай",
  "тосор",
  "ананьево",
  "балыкчы",
];

/* =========================================================
   REGION DETECTION FROM RAW TEXT
========================================================= */

function detectRegionFromText(value) {
  const text = normalizeText(value);

  if (!text) return "";

  if (
    text.includes("иссык-куль") ||
    text.includes("иссык куль") ||
    text.includes("иссыккуль") ||
    text.includes("ысык-көл") ||
    text.includes("ысык көл") ||
    text.includes("ысыккөл")
  ) {
    return "ISSYK_KUL";
  }

  for (const city of ISSYK_KUL_CITIES) {
    if (text.includes(city)) {
      return "ISSYK_KUL";
    }
  }

  if (text.includes("бишкек")) {
    return "BISHKEK";
  }

  if (text.includes("ош") || text.includes("ош облусу")) {
    return "OSH";
  }

  if (
    text.includes("турци") ||
    text.includes("турция") ||
    text.includes("түркия") ||
    text.includes("анталья") ||
    text.includes("стамбул")
  ) {
    return "TURKEY";
  }

  if (text.includes("чуй") || text.includes("чүй")) {
    return "CHUY";
  }

  if (
    text.includes("жалал-абад") ||
    text.includes("джалал-абад") ||
    text.includes("жалал абад") ||
    text.includes("джалал абад")
  ) {
    return "JALAL_ABAD";
  }

  if (text.includes("баткен")) {
    return "BATKEN";
  }

  if (text.includes("нарын")) {
    return "NARYN";
  }

  if (text.includes("талас")) {
    return "TALAS";
  }

  return "";
}

/* =========================================================
   REGION NORMALIZATION
========================================================= */

function normalizeRegion(value) {
  const normalized = normalizeText(value);

  if (!normalized) return "";

  if (REGION_TYPES[normalized]) {
    return REGION_TYPES[normalized];
  }

  if (normalized.includes("иссык") && normalized.includes("куль")) {
    return "ISSYK_KUL";
  }

  if (normalized.includes("ысык") && normalized.includes("көл")) {
    return "ISSYK_KUL";
  }

  if (normalized.includes("бишкек")) {
    return "BISHKEK";
  }

  if (
    normalized === "ош" ||
    normalized.includes("ошская") ||
    normalized.includes("ош облусу")
  ) {
    return "OSH";
  }

  if (normalized.includes("тур") || normalized.includes("түрк")) {
    return "TURKEY";
  }

  if (normalized.includes("чуй") || normalized.includes("чүй")) {
    return "CHUY";
  }

  if (normalized.includes("жалал") || normalized.includes("джалал")) {
    return "JALAL_ABAD";
  }

  if (normalized.includes("баткен")) {
    return "BATKEN";
  }

  if (normalized.includes("нарын")) {
    return "NARYN";
  }

  if (normalized.includes("талас")) {
    return "TALAS";
  }

  return cleanValue(value);
}

/* =========================================================
   PRICE / AREA HELPERS
========================================================= */

function normalizeNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const normalized = String(value).replace(/\s/g, "").replace(",", ".");

  const number = Number(normalized);

  return Number.isFinite(number) ? number : null;
}

function normalizeRangeValue(value) {
  const number = normalizeNumber(value);

  if (number === null) return "";

  return String(number);
}

/* =========================================================
   ROOMS
========================================================= */

function normalizeRooms(value) {
  if (value === undefined || value === null || value === "") {
    return "";
  }

  const raw = normalizeText(value);

  if (
    raw.includes("4+") ||
    raw.includes("четыре") ||
    raw.includes("пять") ||
    raw.includes("шесть") ||
    raw.includes("7") ||
    // Кыргызча
    raw.includes("төрт") ||
    raw.includes("беш") ||
    raw.includes("алты")
  ) {
    return "4+";
  }

  const number = Number(raw.replace(/[^\d.]/g, ""));

  if (!Number.isFinite(number)) {
    return "";
  }

  return number >= 4 ? "4+" : String(number);
}

/* =========================================================
   CATEGORY NORMALIZATION
========================================================= */

function normalizePropertyType(value) {
  const normalized = normalizeText(value);

  if (!normalized) return "";

  return PROPERTY_TYPES[normalized] || normalized;
}

function normalizeDealType(value) {
  const normalized = normalizeText(value);

  if (!normalized) return "";

  return DEAL_TYPES[normalized] || normalized;
}

/* =========================================================
   FEATURES
========================================================= */

const FEATURE_KEYS = [
  "series",
  "floor",
  "condition",
  "walls",
  "heating",
  "documents",
  "furniture",
  "offerType",

  "houseType",
  "floors",
  "sewerage",
  "water",
  "electricity",

  "purpose",
  "fence",
  "location",
  "terrain",

  "roomsInApartment",
  "privateBathroom",

  "premisesType",
  "firstLine",
  "separateEntrance",
  "rentalBusiness",

  "ceilingHeight",
  "parkingType",
  "material",
  "security",
  "gates",
  "inspectionPit",
  "basement",
  "truckAccess",
  "gateType",
];

const ARRAY_KEYS = ["amenities", "communications", "technicalParameters"];

/* =========================================================
   NORMALIZE AI RESPONSE
========================================================= */

function normalizeFilters(aiFilters, originalQuery = "") {
  const f = aiFilters && typeof aiFilters === "object" ? aiFilters : {};

  const normalized = {};

  /* -------------------------------------------------------
     PROPERTY TYPE
  ------------------------------------------------------- */

  const propertyType = normalizePropertyType(f.propertyType);

  if (propertyType) {
    normalized.propertyType = propertyType;
  }

  /* -------------------------------------------------------
     DEAL TYPE
  ------------------------------------------------------- */

  const dealType = normalizeDealType(f.dealType);

  if (dealType) {
    normalized.dealType = dealType;
  }

  /* -------------------------------------------------------
     LOCATION
  ------------------------------------------------------- */

  let region = normalizeRegion(f.region);

  if (!region) {
    region = detectRegionFromText(originalQuery);
  }

  const rawCity = cleanValue(f.city);
  const normalizedCity = normalizeText(rawCity);

  const cityIsIssykKul =
    (normalizedCity.includes("иссык") && normalizedCity.includes("куль")) ||
    (normalizedCity.includes("ысык") && normalizedCity.includes("көл"));

  const cityIsIssykKulLocation = ISSYK_KUL_CITIES.some((city) =>
    normalizedCity.includes(city),
  );

  if (region === "ISSYK_KUL" || cityIsIssykKul || cityIsIssykKulLocation) {
    normalized.region = "ISSYK_KUL";
    normalized.city = "Иссык-Куль";
  } else if (region === "TURKEY") {
    normalized.country = "turkey";
    normalized.region = "TURKEY";

    normalized.city = rawCity || "Турция";
  } else if (region) {
    normalized.region = region;

    if (region === "BISHKEK") {
      normalized.city = "Бишкек";
    } else if (region === "OSH") {
      normalized.city = "Ош";
    }
  }

  if (
    rawCity &&
    region !== "ISSYK_KUL" &&
    !cityIsIssykKul &&
    !cityIsIssykKulLocation
  ) {
    normalized.city = rawCity;
  }

  /* -------------------------------------------------------
     COUNTRY
  ------------------------------------------------------- */

  if (f.country) {
    const country = normalizeText(f.country);

    if (
      country.includes("турц") ||
      country === "turkey" ||
      country.includes("түрк")
    ) {
      normalized.country = "turkey";
    } else {
      normalized.country = cleanValue(f.country);
    }
  }

  /* -------------------------------------------------------
     DISTRICT
  ------------------------------------------------------- */

  if (f.district) {
    normalized.district = cleanValue(f.district);
  }

  /* -------------------------------------------------------
     SEARCH QUERY (keywords like "студия", "евродвушка")
  ------------------------------------------------------- */

  if (f.searchQuery) {
    normalized.searchQuery = cleanValue(f.searchQuery);
  }

  if (!normalized.searchQuery && originalQuery) {
    const qLower = originalQuery.toLowerCase();
    if (qLower.includes("студи") || qLower.includes("стули")) {
      normalized.searchQuery = "студия";
    } else if (qLower.includes("евродвушк")) {
      normalized.searchQuery = "евродвушка";
    } else if (qLower.includes("пентхаус")) {
      normalized.searchQuery = "пентхаус";
    }
  }

  /* -------------------------------------------------------
     PRICE
  ------------------------------------------------------- */

  const minPrice = normalizeNumber(f.minPrice);
  const maxPrice = normalizeNumber(f.maxPrice);

  if (minPrice !== null) {
    normalized.priceFrom = String(minPrice);
  }

  if (maxPrice !== null) {
    normalized.priceTo = String(maxPrice);
  }

  if (normalized.priceTo === undefined && f.maxPrice !== undefined) {
    normalized.priceTo = normalizeRangeValue(f.maxPrice);
  }

  /* -------------------------------------------------------
     CURRENCY
  ------------------------------------------------------- */

  if (f.currency) {
    const rawCurrency = String(f.currency).trim().toUpperCase();
    if (["USD", "KGS", "EUR"].includes(rawCurrency)) {
      normalized.currency = rawCurrency;
    }
  }

  /* -------------------------------------------------------
     AREA
  ------------------------------------------------------- */

  const minArea = normalizeNumber(f.minArea);
  const maxArea = normalizeNumber(f.maxArea);

  if (minArea !== null) {
    normalized.areaFrom = String(minArea);
  }

  if (maxArea !== null) {
    normalized.areaTo = String(maxArea);
  }

  /* -------------------------------------------------------
     ROOMS
  ------------------------------------------------------- */

  const rooms = normalizeRooms(f.rooms);

  if (rooms) {
    normalized.rooms = rooms;
  }

  /* -------------------------------------------------------
     BEACH DISTANCE
  ------------------------------------------------------- */

  const beachFrom = normalizeNumber(f.beachDistanceFrom);

  const beachTo = normalizeNumber(f.beachDistanceTo);

  if (beachFrom !== null) {
    normalized.beachDistanceFrom = String(beachFrom);
  }

  if (beachTo !== null) {
    normalized.beachDistanceTo = String(beachTo);
  }

  /* -------------------------------------------------------
     FEATURES
  ------------------------------------------------------- */

  for (const key of FEATURE_KEYS) {
    const value = f[key];

    if (value !== undefined && value !== null && value !== "") {
      normalized[key] = value;
    }
  }

  /* -------------------------------------------------------
     ARRAYS
  ------------------------------------------------------- */

  for (const key of ARRAY_KEYS) {
    const value = f[key];

    if (value !== undefined && value !== null && value !== "") {
      normalized[key] = Array.isArray(value) ? value : [value];
    }
  }

  return normalized;
}

/* =========================================================
   COMPONENT
========================================================= */

export default function SmartSearch({
  onFiltersDetected,
  activeFilters,
  onRemoveFilter,
  onResetAll,
  categoryLabels,
}) {
  const { language, t } = useLanguage();

  const recognitionRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioChunksRef = useRef([]);
  const mountedRef = useRef(true);

  const [supported, setSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const [searching, setSearching] = useState(false);

  const [text, setText] = useState("");
  const [error, setError] = useState("");

  const isKyrgyz = language === "ky";

  const activeChips = [];
  if (activeFilters) {
    if (activeFilters.propertyType && activeFilters.propertyType !== "all") {
      activeChips.push({
        id: "propertyType",
        label:
          categoryLabels?.[activeFilters.propertyType] ||
          activeFilters.propertyType,
      });
    }

    if (activeFilters.dealType) {
      activeChips.push({
        id: "dealType",
        label:
          activeFilters.dealType === "rent"
            ? language === "ky"
              ? "Ижара"
              : "Аренда"
            : language === "ky"
              ? "Сатуу"
              : "Продажа",
      });
    }

    if (activeFilters.city && activeFilters.city !== "Все") {
      activeChips.push({
        id: "location",
        label: activeFilters.district
          ? `${activeFilters.city}, ${activeFilters.district}`
          : activeFilters.city,
      });
    } else if (activeFilters.district) {
      activeChips.push({
        id: "district",
        label: activeFilters.district,
      });
    }

    if (activeFilters.rooms && activeFilters.rooms !== "Все") {
      activeChips.push({
        id: "rooms",
        label: `${activeFilters.rooms} ${t("smartSearch.roomsCount")}`,
      });
    }

    if (activeFilters.priceFrom || activeFilters.priceTo) {
      const cur = activeFilters.currency === "KGS" ? "сом" : "$";
      let priceLabel = "";
      if (activeFilters.priceFrom && activeFilters.priceTo) {
        priceLabel = `${Number(activeFilters.priceFrom).toLocaleString()} – ${Number(activeFilters.priceTo).toLocaleString()} ${cur}`;
      } else if (activeFilters.priceTo) {
        priceLabel = `до ${Number(activeFilters.priceTo).toLocaleString()} ${cur}`;
      } else {
        priceLabel = `от ${Number(activeFilters.priceFrom).toLocaleString()} ${cur}`;
      }
      activeChips.push({
        id: "price",
        label: priceLabel,
      });
    }

    if (activeFilters.areaFrom || activeFilters.areaTo) {
      const unit = activeFilters.propertyType === "land" ? "сот." : "м²";
      let areaLabel = "";
      if (activeFilters.areaFrom && activeFilters.areaTo) {
        areaLabel = `${activeFilters.areaFrom} – ${activeFilters.areaTo} ${unit}`;
      } else if (activeFilters.areaTo) {
        areaLabel = `до ${activeFilters.areaTo} ${unit}`;
      } else {
        areaLabel = `от ${activeFilters.areaFrom} ${unit}`;
      }
      activeChips.push({
        id: "area",
        label: areaLabel,
      });
    }

    if (activeFilters.searchQuery) {
      activeChips.push({
        id: "searchQuery",
        label: `«${activeFilters.searchQuery}»`,
      });
    }
  }

  /* =========================================================
     SPEECH RECOGNITION
     KY -> ElevenLabs Scribe endpoint
     RU -> browser SpeechRecognition
  ========================================================= */

  useEffect(() => {
    mountedRef.current = true;

    if (typeof window === "undefined") return;

    const canRecord =
      typeof window.MediaRecorder !== "undefined" &&
      typeof navigator !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(canRecord);

    // Браузерный SpeechRecognition больше не используется.
    recognitionRef.current = null;
  }, []);

  /* =========================================================
     KYRGYZ VOICE -> /api/speech-to-text -> TEXT FIELD
  ========================================================= */

  async function toggleKyrgyzVoice() {
    if (listening) {
      const recorder = mediaRecorderRef.current;

      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      } else {
        setListening(false);
      }

      return;
    }

    let stream;

    try {
      setError("");

      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      ) {
        setSupported(false);
        setError(t("smartSearch.errors.browserNotSupported"));
        return;
      }

      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // If the component unmounted or the language changed during permission
      // request, release the microphone immediately.
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      mediaStreamRef.current = stream;
      audioChunksRef.current = [];

      const preferredMimeTypes = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
      ];

      const supportedMimeType = preferredMimeTypes.find((mimeType) =>
        MediaRecorder.isTypeSupported?.(mimeType),
      );

      const recorder = supportedMimeType
        ? new MediaRecorder(stream, { mimeType: supportedMimeType })
        : new MediaRecorder(stream);

      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = (event) => {
        console.error("MediaRecorder error:", event);

        if (mountedRef.current) {
          setError(t("smartSearch.errors.voiceRecognition"));
          setListening(false);
        }

        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
      };

      recorder.onstop = async () => {
        const chunks = [...audioChunksRef.current];
        audioChunksRef.current = [];

        const mimeType = recorder.mimeType || chunks[0]?.type || "audio/webm";
        const extension = mimeType.includes("mp4")
          ? "m4a"
          : mimeType.includes("ogg")
            ? "ogg"
            : "webm";

        const audioBlob = new Blob(chunks, { type: mimeType });

        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;

        if (mountedRef.current) setListening(false);

        if (!audioBlob.size) {
          if (mountedRef.current) {
            setError(t("smartSearch.errors.noSpeech"));
          }
          return;
        }

        if (!mountedRef.current) return;

        try {
          setSearching(true);
          setError("");

          const formData = new FormData();
          formData.append("audio", audioBlob, `speech.${extension}`);

          const response = await fetch("/api/speech-to-text", {
            method: "POST",
            body: formData,
          });

          const data = await response.json().catch(() => ({}));

          if (
            !response.ok ||
            !data?.success ||
            !String(data?.text || "").trim()
          ) {
            throw new Error(
              data?.message || t("smartSearch.errors.voiceRecognition"),
            );
          }

          const transcript = String(data.text).trim();

          if (transcript.length > SAFE_MAX_TEXT_LENGTH) {
            throw new Error(t("smartSearch.errors.queryTooLong"));
          }

          if (mountedRef.current) {
            setText(transcript);
            setError("");
          }
        } catch (transcriptionError) {
          console.error("Kyrgyz transcription error:", transcriptionError);

          if (mountedRef.current) {
            setError(
              transcriptionError instanceof Error
                ? transcriptionError.message
                : t("smartSearch.errors.voiceRecognition"),
            );
          }
        } finally {
          if (mountedRef.current) setSearching(false);
        }
      };

      recorder.start();
      setListening(true);
    } catch (voiceError) {
      console.error("Microphone access error:", voiceError);

      stream?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      mediaRecorderRef.current = null;

      if (mountedRef.current) {
        setListening(false);

        if (
          voiceError?.name === "NotAllowedError" ||
          voiceError?.name === "PermissionDeniedError"
        ) {
          setError(t("smartSearch.errors.microphonePermission"));
        } else if (voiceError?.name === "NotFoundError") {
          setError(t("smartSearch.errors.microphoneNotFound"));
        } else {
          setError(t("smartSearch.errors.voiceRecognition"));
        }
      }
    }
  }

  /* =========================================================
     VOICE BUTTON
  ========================================================= */

  function toggleVoice() {
    if (!supported) {
      setError(t("smartSearch.errors.browserNotSupported"));
      return;
    }

    if (isKyrgyz) {
      void toggleKyrgyzVoice();
      return;
    }

    const recognition = recognitionRef.current;

    if (!recognition) {
      setError(t("smartSearch.errors.voiceUnavailable"));
      return;
    }

    if (listening) {
      try {
        recognition.stop();
      } catch {
        // Recognition may already be stopped.
      }

      setListening(false);
      return;
    }

    try {
      setError("");
      recognition.start();
    } catch (voiceError) {
      console.error("Speech recognition start error:", voiceError);
      setError(t("smartSearch.errors.voiceRecognition"));
    }
  }

  /* =========================================================
     SEARCH
  ========================================================= */

  async function handleSearch(searchText = text) {
    const trimmedText = String(searchText || "").trim();

    if (!trimmedText) {
      setError(t("smartSearch.errors.emptyQuery"));
      return;
    }

    if (trimmedText.length > SAFE_MAX_TEXT_LENGTH) {
      setError(t("smartSearch.errors.queryTooLong"));
      return;
    }

    try {
      setSearching(true);
      setError("");

      const response = await fetch("/api/smart-search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: trimmedText,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data?.success) {
        throw new Error(data?.message || t("smartSearch.errors.searchFailed"));
      }

      if (!data.filters || typeof data.filters !== "object") {
        throw new Error(t("smartSearch.errors.aiNoFilters"));
      }

      const normalized = normalizeFilters(data.filters, trimmedText);

      console.group("SMART SEARCH");
      console.log("Language:", language);
      console.log("Query:", trimmedText);
      console.log("AI response:", data.filters);
      console.log("Normalized:", normalized);
      console.groupEnd();

      setText(trimmedText);

      onFiltersDetected?.({
        query: trimmedText,
        filters: normalized,
      });
    } catch (searchError) {
      console.error("Smart search error:", searchError);

      setError(
        searchError instanceof Error
          ? searchError.message
          : t("smartSearch.errors.searchFailed"),
      );
    } finally {
      setSearching(false);
    }
  }

  /* =========================================================
     EXAMPLES
  ========================================================= */

  const examples =
    language === "ky"
      ? [
          {
            label: "Бишкектеги батир",
            text: "Бишкектен 80000 долларга чейинки эки бөлмөлүү батир издеп жатам, аянты 50дөн 80 чарчы метрге чейин, жакшы ремонту жана унаа токтотмо жайы болсун",
          },
          {
            label: "Жеке үй",
            text: "Бишкекте же ага жакын жерде 150000 долларга чейинки, кеминде 4 бөлмөлүү, жылытуусу жана суусу бар жеке үй керек",
          },
          {
            label: "Ысык-Көлдөгү коттедж",
            text: "Ысык-Көлдөн 200 миң долларга чейинки, бассейни, саунасы, биринчи жээкте жайгашкан жана пляжга жакын коттедж издеп жатам",
          },
        ]
      : [
          {
            label: "Квартира в Бишкеке",
            text: "Ищу двухкомнатную квартиру в Бишкеке до 80000 долларов, площадью от 50 до 80 квадратных метров, с хорошим ремонтом и парковкой",
          },
          {
            label: "Частный дом",
            text: "Нужен частный дом в Бишкеке или рядом, до 150000 долларов, минимум 4 комнаты, с отоплением и водой",
          },
          {
            label: "Коттедж на Иссык-Куле",
            text: "Ищу коттедж на Иссык-Куле до 200 тысяч долларов, с бассейном, сауной, первой линией и недалеко от пляжа",
          },
        ];

  function handleSelectExample(exampleText) {
    setText(exampleText);
    setError("");
  }

  /* =========================================================
     CLEAR
  ========================================================= */

  function clearSearch() {
    if (listening && isKyrgyz) {
      const recorder = mediaRecorderRef.current;

      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
    }

    setText("");
    setError("");
  }

  /* =========================================================
     RELEASE MICROPHONE ON UNMOUNT
  ========================================================= */

  useEffect(() => {
    return () => {
      mountedRef.current = false;

      try {
        const recorder = mediaRecorderRef.current;

        if (recorder && recorder.state !== "inactive") {
          recorder.onstop = null;
          recorder.stop();
        }
      } catch {
        // Recorder may already be stopped.
      }

      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      mediaRecorderRef.current = null;
      audioChunksRef.current = [];
    };
  }, []);

  /* =========================================================
     RENDER
  ========================================================= */

  return (
    <section className={styles.wrapper}>
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <div className={styles.badge}>
            <Sparkles size={13} />
            AI SEARCH
          </div>

          <h2>{t("smartSearch.title")}</h2>

          <p>{t("smartSearch.description")}</p>
        </div>
      </div>

      <div className={styles.searchBox}>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t("smartSearch.placeholder")}
          rows={5}
          maxLength={SAFE_MAX_TEXT_LENGTH}
          disabled={searching}
        />

        <div className={styles.searchActions}>
          <button
            type="button"
            className={`${styles.voiceButton} ${
              listening ? styles.listening : ""
            }`}
            onClick={toggleVoice}
            disabled={searching}
            aria-label={
              listening
                ? t("smartSearch.voice.stop")
                : t("smartSearch.voice.start")
            }
            aria-pressed={listening}
          >
            {listening ? <MicOff size={21} /> : <Mic size={21} />}
          </button>

          {text && (
            <button
              type="button"
              className={styles.clearButton}
              onClick={clearSearch}
              disabled={searching}
              aria-label={t("smartSearch.clear")}
            >
              <RotateCcw size={15} />
            </button>
          )}
        </div>
      </div>

      {listening && (
        <div
          className={styles.listeningStatus}
          role="status"
          aria-live="polite"
        >
          <span className={styles.pulse} />
          <span>{t("smartSearch.listening")}</span>
        </div>
      )}

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      {!supported && (
        <div className={styles.browserNotice}>
          {t("smartSearch.browserNotice")}
        </div>
      )}

      <button
        type="button"
        className={styles.searchButton}
        disabled={searching || !text.trim() || listening}
        onClick={() => handleSearch()}
      >
        {searching ? (
          <>
            <Loader2 size={19} className={styles.spinner} />
            {t("smartSearch.analyzing")}
          </>
        ) : (
          <>
            <Search size={19} />
            {t("smartSearch.searchButton")}
          </>
        )}
      </button>

      {activeChips.length > 0 && (
        <div className={styles.activeChipsBlock}>
          <div className={styles.activeChipsHeader}>
            <span>{t("smartSearch.activeFilters")}</span>
            <button
              type="button"
              className={styles.resetAllChips}
              onClick={onResetAll}
            >
              {t("smartSearch.resetAll")}
            </button>
          </div>
          <div className={styles.chipsList}>
            {activeChips.map((chip) => (
              <span key={chip.id} className={styles.chip}>
                {chip.label}
                <button
                  type="button"
                  onClick={() => onRemoveFilter?.(chip.id)}
                  aria-label={`Удалить ${chip.label}`}
                >
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className={styles.examples}>
        <span>{t("smartSearch.examples.title")}</span>

        <div className={styles.exampleList}>
          {examples.map((example) => (
            <button
              key={example.label}
              type="button"
              onClick={() => handleSelectExample(example.text)}
              disabled={searching || listening}
            >
              {example.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
