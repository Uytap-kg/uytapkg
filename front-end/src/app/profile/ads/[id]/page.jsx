// MyProductDetails.jsx
"use client";

import Image from "next/image";
import { useState, useEffect, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";

import { getListingById, updateListing, deleteListing } from "@/utils/api";
import { mapListingDetail } from "@/utils/mapListingData";
import { useLanguage } from "@/context/LanguageContext";

import {
  ArrowLeft,
  Heart,
  MapPin,
  Home,
  Ruler,
  BedDouble,
  Building2,
  Layers3,
  Flame,
  Sparkles,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  Tag,
  Droplets,
  Zap,
  FileCheck,
  CarFront,
  Waves,
  Pencil,
  Trash2,
  CalendarDays,
  LandPlot,
  Bath,
  Sofa,
  Trees,
  Compass,
  Maximize,
  DoorOpen,
  Building,
  CircleDollarSign,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
} from "lucide-react";

// Те же подписи, что и в списке "Мои объявления" (see profile/ads/page.jsx
// statusMapping) — держим их согласованными между списком и деталями.
const PUBLICATION_STATUS_LABELS = {
  active: "Опубликовано",
  moderation: "На модерации",
  draft: "Черновик — ждёт оплаты",
  hidden: "Скрыто",
  expired: "Срок истёк / В архиве",
};

import styles from "./MyAdsDetails.module.css";

import DeleteModal from "@/components/ui/deleteModal/DeleteMidal";
import AdsEditModal from "../AdsEditModal/AdsEditModal";

export default function MyProductDetails() {
  const router = useRouter();
  const { id } = useParams();

  const { t } = useLanguage();

  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [currentImage, setCurrentImage] = useState(0);
  const [isFavorite, setIsFavorite] = useState(false);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  useEffect(() => {
    if (!id) return;

    let mounted = true;

    setLoading(true);
    setError(null);

    getListingById(id)
      .then((res) => {
        if (!mounted) return;

        if (res.success && res.data) {
          const mapped = mapListingDetail(res.data);

          setProduct(mapped);
        } else {
          setError(res.message || "myAdsDetails.error.notFound");
        }
      })
      .catch((err) => {
        console.error("Fetch my listing details error:", err);

        if (mounted) {
          setError("myAdsDetails.error.load");
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [id]);

  const raw = product?.rawFeatures || {};

  const hasValue = (value) => {
    if (value === undefined || value === null) return false;
    if (value === "") return false;
    if (value === false) return false;
    if (Array.isArray(value) && value.length === 0) return false;

    return true;
  };

  const normalizeKey = (key) => {
    return String(key)
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .trim()
      .toLowerCase();
  };

  const formatKey = (key) => {
    const normalized = normalizeKey(key);

    const translationKeys = {
      residentialcomplex: "residentialComplex",
      residentialcomplexname: "residentialComplex",
      residential_complex: "residentialComplex",
      residential_complex_name: "residentialComplex",

      developerorcomplex: "developer",
      developer_or_complex: "developer",

      developer: "developer",
      developername: "developer",
      developer_name: "developer",

      buildingtype: "buildingType",
      building_type: "buildingType",

      housetype: "buildingType",
      house_type: "buildingType",

      floor: "floor",
      floors: "floors",

      rooms: "rooms",
      area: "area",

      year: "yearBuilt",
      yearbuilt: "yearBuilt",
      year_built: "yearBuilt",

      constructionyear: "yearBuilt",
      construction_year: "yearBuilt",

      repair: "repair",
      condition: "condition",
      state: "condition",

      furniture: "furniture",
      furnished: "furniture",

      ceilingheight: "ceilingHeight",
      ceiling_height: "ceilingHeight",

      bathroom: "bathroom",
      bathroomtype: "bathroom",
      bathroom_type: "bathroom",

      bathrooms: "bathrooms",
      bathroomcount: "bathrooms",
      bathroom_count: "bathrooms",

      heating: "heating",
      heatingtype: "heating",
      heating_type: "heating",

      sewerage: "sewerage",
      sewer: "sewerage",
      seweragetype: "sewerage",
      sewerage_type: "sewerage",

      water: "water",
      watersupply: "water",
      water_supply: "water",

      electricity: "electricity",
      electricitytype: "electricity",
      electricity_type: "electricity",

      gas: "gas",

      documents: "documents",
      document: "documents",
      documentstatus: "documents",
      document_status: "documents",

      parking: "parking",
      parkingtype: "parking",
      parking_type: "parking",

      view: "view",
      viewtype: "view",
      view_type: "view",

      orientation: "orientation",
      direction: "orientation",

      landarea: "landArea",
      land_area: "landArea",

      areasotka: "areaSotka",
      area_sotka: "areaSotka",
      sotka: "areaSotka",
      sotok: "areaSotka",

      blocks: "blocks",
      blockcount: "blocks",
      block_count: "blocks",

      construction: "construction",
      constructiontype: "constructionType",
      construction_type: "constructionType",

      entrances: "entrances",
      entrancecount: "entrances",
      entrance_count: "entrances",

      yardarea: "yardArea",
      yard_area: "yardArea",

      landwidth: "landWidth",
      land_width: "landWidth",

      landlength: "landLength",
      land_length: "landLength",

      offertype: "offerType",
      offer_type: "offerType",

      purpose: "purpose",
      fence: "fence",
      terrain: "terrain",

      landlocation: "landLocation",
      land_location: "landLocation",

      roomlocation: "roomLocation",
      room_location: "roomLocation",

      roomsinapartment: "roomsInApartment",
      rooms_in_apartment: "roomsInApartment",

      privatebathroom: "privateBathroom",
      private_bathroom: "privateBathroom",

      premisestype: "premisesType",
      premises_type: "premisesType",

      technicalparameters: "technicalParameters",
      technical_parameters: "technicalParameters",

      firstline: "firstLine",
      first_line: "firstLine",

      separateentrance: "separateEntrance",
      separate_entrance: "separateEntrance",

      rentalbusiness: "rentalBusiness",
      rental_business: "rentalBusiness",

      material: "material",
      gates: "gates",

      truckaccess: "truckAccess",
      truck_access: "truckAccess",

      gatetype: "gateType",
      gate_type: "gateType",

      pets: "pets",
      internet: "internet",
      balcony: "balcony",
      elevator: "elevator",
      security: "security",

      parkingplace: "parkingPlace",
      parking_place: "parkingPlace",
    };

    const compact = normalized.replace(/\s/g, "");

    const translationKey =
      translationKeys[normalized] || translationKeys[compact];

    if (translationKey) {
      return t(`myAdsDetails.characteristics.${translationKey}`);
    }

    return String(key)
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  };

  const getRaw = (...keys) => {
    for (const key of keys) {
      if (hasValue(raw[key])) {
        return raw[key];
      }
    }

    return null;
  };

  const formatDisplayValue = (value) => {
    if (!hasValue(value)) return null;

    if (typeof value === "boolean") {
      return value ? t("myAdsDetails.values.yes") : t("myAdsDetails.values.no");
    }

    if (Array.isArray(value)) {
      return value
        .filter(Boolean)
        .map((item) => {
          if (typeof item === "object") {
            return (
              item.name ||
              item.title ||
              item.label ||
              item.value ||
              JSON.stringify(item)
            );
          }

          return String(item);
        })
        .join(", ");
    }

    if (typeof value === "object") {
      return (
        value.name ||
        value.title ||
        value.label ||
        value.value ||
        JSON.stringify(value)
      );
    }

    return String(value);
  };

  const translatePropertyType = (value) => {
    if (!hasValue(value)) return value;

    const normalized = String(value).trim().toLowerCase();

    const map = {
      apartment: "apartment",
      apartments: "apartment",
      квартира: "apartment",
      квартиры: "apartment",

      house: "house",
      дом: "house",
      дома: "house",

      cottage: "cottage",
      коттедж: "cottage",
      коттеджи: "cottage",

      room: "room",
      комната: "room",
      комнаты: "room",

      land: "land",
      участок: "land",
      земля: "land",

      commercial: "commercial",
      коммерция: "commercial",
      коммерческая: "commercial",

      parking: "parking",
      паркинг: "parking",
      парковка: "parking",

      garage: "garage",
      гараж: "garage",

      office: "office",
      офис: "office",
    };

    const key = map[normalized];

    if (key) {
      return t(`myAdsDetails.propertyTypes.${key}`);
    }

    return value;
  };

  const translateDealType = (value) => {
    if (!hasValue(value)) return value;

    const normalized = String(value).trim().toLowerCase();

    const map = {
      buy: "buy",
      купить: "buy",
      продажа: "buy",
      продаю: "buy",
      продам: "buy",

      rent: "rent",
      аренда: "rent",
      снять: "rent",
      сдача: "rent",
      сдам: "rent",
    };

    const key = map[normalized];

    if (key) {
      return t(`myAdsDetails.deals.${key}`);
    }

    return value;
  };

  const characteristics = useMemo(() => {
    if (!product) return [];

    const items = [];
    const usedKeys = new Set();

    const markUsed = (...keys) => {
      keys.forEach((key) => usedKeys.add(key));
    };

    const add = (icon, label, value, ...keys) => {
      if (!hasValue(value)) return;

      items.push({
        icon,
        label,
        value: formatDisplayValue(value),
      });

      if (keys.length > 0) {
        markUsed(...keys);
      }
    };

    add(
      BedDouble,
      t("myAdsDetails.characteristics.rooms"),
      product.rooms,
      "rooms",
    );

    add(Ruler, t("myAdsDetails.characteristics.area"), product.area, "area");

    add(
      Layers3,
      t("myAdsDetails.characteristics.floor"),
      getRaw("floor") ?? product.floor,
      "floor",
    );

    add(
      Building2,
      t("myAdsDetails.characteristics.floors"),
      getRaw("floors") ?? product.floors,
      "floors",
    );

    add(
      Home,
      t("myAdsDetails.characteristics.propertyType"),
      translatePropertyType(product.type),
      "type",
    );

    const residentialComplex = getRaw(
      "residentialComplex",
      "residential_complex",
      "residentialComplexName",
      "residential_complex_name",
      "developerOrComplex",
      "developer_or_complex",
      "complex",
      "complexName",
      "complex_name",
      "zhk",
    );

    if (hasValue(residentialComplex)) {
      add(
        Building2,
        t("myAdsDetails.characteristics.residentialComplex"),
        residentialComplex,
        "residentialComplex",
        "residential_complex",
        "residentialComplexName",
        "residential_complex_name",
        "developerOrComplex",
        "developer_or_complex",
        "complex",
        "complexName",
        "complex_name",
        "zhk",
      );
    }

    const developer = getRaw("developer", "developerName", "developer_name");

    if (
      hasValue(developer) &&
      formatDisplayValue(developer) !== formatDisplayValue(residentialComplex)
    ) {
      add(
        Building2,
        t("myAdsDetails.characteristics.developer"),
        developer,
        "developer",
        "developerName",
        "developer_name",
      );
    }

    add(
      Building,
      t("myAdsDetails.characteristics.buildingType"),
      getRaw("buildingType", "building_type", "houseType", "house_type"),
      "buildingType",
      "building_type",
      "houseType",
      "house_type",
    );

    add(
      CalendarDays,
      t("myAdsDetails.characteristics.yearBuilt"),
      getRaw(
        "yearBuilt",
        "year_built",
        "year",
        "constructionYear",
        "construction_year",
      ),
      "year",
      "yearBuilt",
      "year_built",
      "constructionYear",
      "construction_year",
    );

    add(
      Sparkles,
      t("myAdsDetails.characteristics.repair"),
      getRaw("repair", "condition", "state"),
      "repair",
      "condition",
      "state",
    );

    add(
      Sofa,
      t("myAdsDetails.characteristics.furniture"),
      getRaw("furniture", "furnished"),
      "furniture",
      "furnished",
    );

    const ceilingHeight = getRaw("ceilingHeight", "ceiling_height");

    if (hasValue(ceilingHeight)) {
      add(
        Maximize,
        t("myAdsDetails.characteristics.ceilingHeight"),
        String(ceilingHeight).includes("м")
          ? ceilingHeight
          : `${ceilingHeight} м`,
        "ceilingHeight",
        "ceiling_height",
      );
    }

    add(
      Bath,
      t("myAdsDetails.characteristics.bathroom"),
      getRaw("bathroom", "bathroomType", "bathroom_type"),
      "bathroom",
      "bathroomType",
      "bathroom_type",
    );

    add(
      Bath,
      t("myAdsDetails.characteristics.bathrooms"),
      getRaw("bathrooms", "bathroomCount", "bathroom_count"),
      "bathrooms",
      "bathroomCount",
      "bathroom_count",
    );

    add(
      Flame,
      t("myAdsDetails.characteristics.heating"),
      getRaw("heating", "heatingType", "heating_type"),
      "heating",
      "heatingType",
      "heating_type",
    );

    add(
      Droplets,
      t("myAdsDetails.characteristics.sewerage"),
      getRaw("sewerage", "sewer", "sewerageType", "sewerage_type"),
      "sewerage",
      "sewer",
      "sewerageType",
      "sewerage_type",
    );

    add(
      Droplets,
      t("myAdsDetails.characteristics.water"),
      getRaw("water", "waterSupply", "water_supply"),
      "water",
      "waterSupply",
      "water_supply",
    );

    const electricity = getRaw(
      "electricity",
      "electricityType",
      "electricity_type",
    );

    if (hasValue(electricity)) {
      add(
        Zap,
        t("myAdsDetails.characteristics.electricity"),
        electricity === true ? t("myAdsDetails.values.yes") : electricity,
        "electricity",
        "electricityType",
        "electricity_type",
      );
    }

    const gas = getRaw("gas", "gasSupply", "gas_supply");

    if (hasValue(gas)) {
      add(
        Flame,
        t("myAdsDetails.characteristics.gas"),
        gas === true ? t("myAdsDetails.values.yes") : gas,
        "gas",
        "gasSupply",
        "gas_supply",
      );
    }

    add(
      FileCheck,
      t("myAdsDetails.characteristics.documents"),
      getRaw("documents", "document", "documentStatus", "document_status"),
      "documents",
      "document",
      "documentStatus",
      "document_status",
    );

    add(
      CarFront,
      t("myAdsDetails.characteristics.parking"),
      getRaw("parking", "parkingType", "parking_type"),
      "parking",
      "parkingType",
      "parking_type",
    );

    add(
      Waves,
      t("myAdsDetails.characteristics.view"),
      getRaw("view", "viewType", "view_type"),
      "view",
      "viewType",
      "view_type",
    );

    add(
      Compass,
      t("myAdsDetails.characteristics.orientation"),
      getRaw("orientation", "direction"),
      "orientation",
      "direction",
    );

    const landArea = getRaw("landArea", "land_area");

    if (hasValue(landArea)) {
      add(
        LandPlot,
        t("myAdsDetails.characteristics.landArea"),
        landArea,
        "landArea",
        "land_area",
      );
    }

    const areaSotka = getRaw("areaSotka", "area_sotka", "sotka", "sotok");

    if (hasValue(areaSotka)) {
      add(
        LandPlot,
        t("myAdsDetails.characteristics.areaSotka"),
        String(areaSotka).includes("сот")
          ? areaSotka
          : `${areaSotka} ${t("myAdsDetails.units.sotkas")}`,
        "areaSotka",
        "area_sotka",
        "sotka",
        "sotok",
      );
    }

    const blocks = getRaw("blocks", "blockCount", "block_count");

    if (hasValue(blocks)) {
      add(
        Layers3,
        t("myAdsDetails.characteristics.blocks"),
        String(blocks).includes("блок")
          ? blocks
          : `${blocks} ${t("myAdsDetails.units.blocks")}`,
        "blocks",
        "blockCount",
        "block_count",
      );
    }

    add(
      Building2,
      t("myAdsDetails.characteristics.construction"),
      getRaw("construction", "constructionType", "construction_type"),
      "construction",
      "constructionType",
      "construction_type",
    );

    add(
      DoorOpen,
      t("myAdsDetails.characteristics.entrances"),
      getRaw("entrances", "entranceCount", "entrance_count"),
      "entrances",
      "entranceCount",
      "entrance_count",
    );

    add(
      Trees,
      t("myAdsDetails.characteristics.yardArea"),
      getRaw("yardArea", "yard_area"),
      "yardArea",
      "yard_area",
    );

    add(
      Ruler,
      t("myAdsDetails.characteristics.landWidth"),
      getRaw("landWidth", "land_width"),
      "landWidth",
      "land_width",
    );

    add(
      Ruler,
      t("myAdsDetails.characteristics.landLength"),
      getRaw("landLength", "land_length"),
      "landLength",
      "land_length",
    );

    const specificFields = [
      {
        keys: ["purpose"],
        icon: Tag,
        translation: "purpose",
      },
      {
        keys: ["fence"],
        icon: Home,
        translation: "fence",
      },
      {
        keys: ["terrain"],
        icon: LandPlot,
        translation: "terrain",
      },
      {
        keys: ["landLocation", "land_location"],
        icon: MapPin,
        translation: "landLocation",
      },
      {
        keys: ["roomLocation", "room_location"],
        icon: Home,
        translation: "roomLocation",
      },
      {
        keys: ["roomsInApartment", "rooms_in_apartment"],
        icon: BedDouble,
        translation: "roomsInApartment",
      },
      {
        keys: ["privateBathroom", "private_bathroom"],
        icon: Bath,
        translation: "privateBathroom",
      },
      {
        keys: ["premisesType", "premises_type"],
        icon: Building,
        translation: "premisesType",
      },
      {
        keys: ["technicalParameters", "technical_parameters"],
        icon: Ruler,
        translation: "technicalParameters",
      },
      {
        keys: ["firstLine", "first_line"],
        icon: DoorOpen,
        translation: "firstLine",
      },
      {
        keys: ["separateEntrance", "separate_entrance"],
        icon: DoorOpen,
        translation: "separateEntrance",
      },
      {
        keys: ["rentalBusiness", "rental_business"],
        icon: CircleDollarSign,
        translation: "rentalBusiness",
      },
      {
        keys: ["material"],
        icon: Building2,
        translation: "material",
      },
      {
        keys: ["gates"],
        icon: DoorOpen,
        translation: "gates",
      },
      {
        keys: ["truckAccess", "truck_access"],
        icon: CarFront,
        translation: "truckAccess",
      },
      {
        keys: ["gateType", "gate_type"],
        icon: DoorOpen,
        translation: "gateType",
      },
      {
        keys: ["offerType", "offer_type"],
        icon: Tag,
        translation: "offerType",
      },
    ];

    specificFields.forEach(({ keys, icon, translation }) => {
      const value = getRaw(...keys);

      if (!hasValue(value)) return;

      const existingKey = keys.find((key) => usedKeys.has(key));

      if (existingKey) return;

      add(
        icon,
        t(`myAdsDetails.characteristics.${translation}`),
        value,
        ...keys,
      );
    });

    Object.entries(raw).forEach(([key, value]) => {
      if (!hasValue(value)) return;
      if (usedKeys.has(key)) return;

      const normalized = normalizeKey(key);

      /*
       * Не показываем технические поля. Точное совпадение — для
       * коротких/общих слов типа "id"/"images", которые не должны резать
       * реальные характеристики, где такое слово — часть названия.
       * Паттерн — для составных служебных полей вида
       * "promotionExpiresAt"/"residentialComplexId", которые пишутся в
       * features сервером (см. back-end/src/services/promotionsService.js
       * и listingsController.js), а не являются характеристиками объекта.
       */

      const technicalKeys = [
        "id",
        "listing id",
        "listingid",
        "created at",
        "createdat",
        "updated at",
        "updatedat",
        "image",
        "images",
        "photo",
        "photos",
      ];

      const technicalKeyPattern =
        /\bid$|expires at|verification status|verification docs|rejection reason/;

      if (
        technicalKeys.includes(normalized) ||
        technicalKeyPattern.test(normalized)
      ) {
        return;
      }

      if (
        key === "amenities" ||
        normalized === "amenities" ||
        normalized === "удобства"
      ) {
        return;
      }

      const lowerKey = key.toLowerCase();

      const Icon = lowerKey.includes("floor")
        ? Layers3
        : lowerKey.includes("area")
          ? Ruler
          : lowerKey.includes("water")
            ? Droplets
            : lowerKey.includes("heating")
              ? Flame
              : lowerKey.includes("parking")
                ? CarFront
                : lowerKey.includes("document")
                  ? FileCheck
                  : lowerKey.includes("year")
                    ? CalendarDays
                    : lowerKey.includes("bath")
                      ? Bath
                      : lowerKey.includes("view")
                        ? Waves
                        : lowerKey.includes("electric")
                          ? Zap
                          : lowerKey.includes("entrance")
                            ? DoorOpen
                            : Tag;

      const formattedValue = formatDisplayValue(value);

      if (!hasValue(formattedValue)) return;

      items.push({
        icon: Icon,
        label: formatKey(key),
        value: formattedValue,
      });

      usedKeys.add(key);
    });

    if (
      hasValue(product.beachDistance) &&
      !items.some(
        (item) =>
          item.label === t("myAdsDetails.characteristics.beachDistance"),
      )
    ) {
      items.push({
        icon: Waves,
        label: t("myAdsDetails.characteristics.beachDistance"),
        value: `${product.beachDistance} ${t("myAdsDetails.units.meters")}`,
      });
    }

    return items;
  }, [product, t]);

  const amenities = useMemo(() => {
    if (!product) return [];

    const source = raw.amenities;

    if (Array.isArray(source)) {
      return source
        .filter(Boolean)
        .map((item) => {
          if (typeof item === "object") {
            return item.name || item.title || item.label || item.value;
          }

          return String(item);
        })
        .filter(Boolean);
    }

    if (source) {
      return [String(source)];
    }

    return [];
  }, [product]);

  const images = Array.isArray(product?.images) ? product.images : [];

  const nextImage = () => {
    if (!images.length) return;

    setCurrentImage((prev) => (prev === images.length - 1 ? 0 : prev + 1));
  };

  const previousImage = () => {
    if (!images.length) return;

    setCurrentImage((prev) => (prev === 0 ? images.length - 1 : prev - 1));
  };

  const handleEdit = () => {
    setShowEditModal(true);
  };

  const handleCloseEdit = () => {
    setShowEditModal(false);
  };

  const handleSave = async (updatedProduct) => {
    try {
      const token = localStorage.getItem("uytap_token");
      if (!token) {
        router.push("/login");
        return;
      }

      const priceVal =
        typeof updatedProduct.price === "string"
          ? Number(updatedProduct.price.replace(/[^0-9]/g, ""))
          : Number(updatedProduct.price);

      const areaVal =
        typeof updatedProduct.area === "string"
          ? Number(updatedProduct.area.replace(/[^0-9.]/g, ""))
          : Number(updatedProduct.area);

      const propertyTypeMapping = {
        apartment: "apartment",
        house: "house",
        land: "land",
        commercial: "commercial",
        room: "room",
        garage: "garage",

        Квартира: "apartment",
        Дом: "house",
        Коттедж: "house",
        Дача: "house",
        Участок: "land",
        Коммерция: "commercial",
        Комнаты: "room",
        "Паркинг/гараж": "garage",
      };

      const dealTypeMapping = {
        sale: "sale",
        rent: "rent",

        Продажа: "sale",
        Сдаю: "rent",
      };

      const payload = {
        title: updatedProduct.title,
        description: updatedProduct.description,
        propertyType: propertyTypeMapping[updatedProduct.type] || "apartment",
        dealType: dealTypeMapping[updatedProduct.dealType] || "sale",
        price: Number.isFinite(priceVal) && priceVal > 0 ? priceVal : 1000,
        area: Number.isFinite(areaVal) && areaVal > 0 ? areaVal : undefined,
        rooms: updatedProduct.rooms ? Number(updatedProduct.rooms) : undefined,
        floor: updatedProduct.floors ? Number(updatedProduct.floors) : undefined,
        address: updatedProduct.address || undefined,
      };

      const res = await updateListing(token, id, payload);
      if (res.success && res.data) {
        const mapped = mapListingDetail(res.data);
        setProduct(mapped);
      } else {
        alert(res?.message || "Ошибка обновления объявления");
      }

      setShowEditModal(false);
    } catch (err) {
      console.error("Ошибка сохранения объявления:", err);
      alert(err?.message || "Ошибка сохранения объявления");
    }
  };

  const handleDelete = async () => {
    try {
      const token = localStorage.getItem("uytap_token");
      if (!token) {
        router.push("/login");
        return;
      }

      const res = await deleteListing(token, id);
      if (res.success) {
        setShowDeleteModal(false);
        router.push("/profile/ads");
      } else {
        alert(res?.message || "Ошибка удаления объявления");
      }
    } catch (err) {
      console.error("Ошибка удаления объявления:", err);
      alert(err?.message || "Ошибка удаления объявления");
    }
  };

  if (loading) {
    return (
      <main className={styles.page}>
        <div className={styles.state}>
          <div className={styles.stateLoader} />

          <h2>{t("myAdsDetails.loading.title")}</h2>

          <p>{t("myAdsDetails.loading.description")}</p>
        </div>
      </main>
    );
  }

  if (error || !product) {
    const translatedError = error?.startsWith?.("myAdsDetails.")
      ? t(error)
      : error || t("myAdsDetails.error.description");

    return (
      <main className={styles.page}>
        <div className={styles.state}>
          <div className={styles.stateIcon}>
            <Home size={28} />
          </div>

          <h2>{t("myAdsDetails.error.title")}</h2>

          <p>{translatedError}</p>

          <button
            type="button"
            className={styles.stateButton}
            onClick={() => router.push("/profile/ads")}
          >
            <ArrowLeft size={18} />

            {t("myAdsDetails.backToAds")}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <div className={styles.topBar}>
          <button
            type="button"
            className={styles.back}
            onClick={() => router.push("/profile/ads")}
          >
            <ArrowLeft size={18} />

            {t("myAdsDetails.myAds")}
          </button>

          <span className={styles.ownerBadge}>
            <Home size={15} />

            {t("myAdsDetails.myListing")}
          </span>
        </div>

        <section className={styles.top}>
          <div className={styles.gallery}>
            <div className={styles.mainImage}>
              {images.length > 0 ? (
                <Image
                  src={images[currentImage]}
                  alt={product.title || t("myAdsDetails.fallback.property")}
                  fill
                  priority
                  sizes="(max-width: 900px) 100vw, 65vw"
                />
              ) : (
                <div className={styles.noImage}>
                  <Home size={48} />

                  <span>{t("myAdsDetails.gallery.noPhotos")}</span>
                </div>
              )}

              <div className={styles.imageOverlay} />

              <div className={styles.badges}>
                {(product.isVip || product.status === "vip") && (
                  <span className={`${styles.badge} ${styles.vip}`}>
                    <Sparkles size={14} />
                    VIP
                  </span>
                )}

                {(product.isUrgent || product.status === "urgent") && (
                  <span className={`${styles.badge} ${styles.urgent}`}>
                    <Flame size={14} />
                    {t("myAdsDetails.badges.urgent", "Срочно")}
                  </span>
                )}

                {product.isTop && (
                  <span className={`${styles.badge} ${styles.top}`}>
                    <TrendingUp size={14} />
                    TOP
                  </span>
                )}

                {product.type && (
                  <span className={styles.categoryBadge}>
                    {translatePropertyType(product.type)}
                  </span>
                )}
              </div>

              <div className={styles.imageActions}>
                <button
                  type="button"
                  className={styles.imageEdit}
                  onClick={handleEdit}
                >
                  <Pencil size={16} />

                  {t("myAdsDetails.actions.edit")}
                </button>

                <button
                  type="button"
                  className={styles.imageDelete}
                  onClick={() => setShowDeleteModal(true)}
                  aria-label={t("myAdsDetails.actions.deleteListing")}
                >
                  <Trash2 size={16} />
                </button>
              </div>

              <button
                type="button"
                className={`${styles.favorite} ${
                  isFavorite ? styles.favoriteActive : ""
                }`}
                onClick={() => setIsFavorite((prev) => !prev)}
                aria-label={t("myAdsDetails.actions.favorite")}
              >
                <Heart size={23} fill={isFavorite ? "currentColor" : "none"} />
              </button>

              {images.length > 1 && (
                <>
                  <button
                    type="button"
                    className={`${styles.galleryArrow} ${styles.left}`}
                    onClick={previousImage}
                    aria-label={t("myAdsDetails.gallery.previous")}
                  >
                    <ChevronLeft />
                  </button>

                  <button
                    type="button"
                    className={`${styles.galleryArrow} ${styles.right}`}
                    onClick={nextImage}
                    aria-label={t("myAdsDetails.gallery.next")}
                  >
                    <ChevronRight />
                  </button>
                </>
              )}

              {images.length > 0 && (
                <div className={styles.imageCounter}>
                  {currentImage + 1} / {images.length}
                </div>
              )}

              <div className={styles.imageTitle}>
                <span>{t("myAdsDetails.myProperty")}</span>

                <strong>{product.title}</strong>
              </div>
            </div>

            {images.length > 1 && (
              <>
                <div className={styles.thumbnails}>
                  {images.map((image, index) => (
                    <button
                      key={`${image}-${index}`}
                      type="button"
                      className={
                        index === currentImage
                          ? `${styles.thumbnail} ${styles.thumbnailActive}`
                          : styles.thumbnail
                      }
                      onClick={() => setCurrentImage(index)}
                    >
                      <Image
                        src={image}
                        alt={`${t("myAdsDetails.gallery.photo")} ${index + 1}`}
                        fill
                        sizes="100px"
                      />
                    </button>
                  ))}
                </div>

                <div className={styles.dots}>
                  {images.map((_, index) => (
                    <button
                      key={index}
                      type="button"
                      className={
                        index === currentImage
                          ? `${styles.dot} ${styles.dotActive}`
                          : styles.dot
                      }
                      onClick={() => setCurrentImage(index)}
                      aria-label={`${t(
                        "myAdsDetails.gallery.photo",
                      )} ${index + 1}`}
                    />
                  ))}
                </div>
              </>
            )}
          </div>

          <div className={styles.summary}>
            <div className={styles.summaryTop}>
              {product.dealType && (
                <span className={styles.deal}>
                  {translateDealType(product.dealType)}
                </span>
              )}

              <span className={styles.published}>
                <CheckCircle2 size={13} />

                {t("myAdsDetails.published")}
              </span>
              <span
                className={`${styles.published} ${
                  product.publicationStatus === "active" ? "" : styles.pending
                }`}
              >
                {product.publicationStatus === "active" ? (
                  <CheckCircle2 size={13} />
                ) : (
                  <AlertCircle size={13} />
                )}
                {PUBLICATION_STATUS_LABELS[product.publicationStatus] ||
                  "Опубликовано"}
              </span>
            </div>

            <h1>{product.title}</h1>

            {(product.location || product.address) && (
              <div className={styles.location}>
                <MapPin size={20} />

                <div>
                  {product.location && <strong>{product.location}</strong>}

                  {product.address && <span>{product.address}</span>}
                </div>
              </div>
            )}

            <div className={styles.price}>{product.price}</div>

            <div className={styles.quickInfo}>
              {hasValue(product.rooms) && (
                <div>
                  <BedDouble />

                  <span>
                    <b>{product.rooms}</b> {t("myAdsDetails.quickInfo.rooms")}
                  </span>
                </div>
              )}

              {hasValue(product.area) && (
                <div>
                  <Ruler />

                  <span>
                    <b>{product.area}</b> {t("myAdsDetails.quickInfo.area")}
                  </span>
                </div>
              )}

              {hasValue(raw.floor ?? product.floor) && (
                <div>
                  <Layers3 />

                  <span>
                    <b>{raw.floor ?? product.floor}</b>{" "}
                    {t("myAdsDetails.quickInfo.floor")}
                  </span>
                </div>
              )}

              {hasValue(product.beachDistance) && (
                <div>
                  <Waves />

                  <span>
                    <b>
                      {product.beachDistance} {t("myAdsDetails.units.meters")}
                    </b>{" "}
                    {t("myAdsDetails.quickInfo.toBeach")}
                  </span>
                </div>
              )}
            </div>

            <div className={styles.management}>
              <button
                type="button"
                className={styles.editButton}
                onClick={handleEdit}
              >
                <Pencil size={17} />

                {t("myAdsDetails.actions.editFull")}
              </button>

              <button
                type="button"
                className={styles.deleteButton}
                onClick={() => setShowDeleteModal(true)}
              >
                <Trash2 size={17} />

                {t("myAdsDetails.actions.delete")}
              </button>
            </div>
          </div>
        </section>

        <div className={styles.contentGrid}>
          <div className={styles.mainContent}>
            {product.description && (
              <section className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div className={styles.sectionIcon}>
                    <Home />
                  </div>

                  <div>
                    <span>{t("myAdsDetails.sections.about.label")}</span>

                    <h2>{t("myAdsDetails.sections.about.title")}</h2>
                  </div>
                </div>

                <p className={styles.description}>{product.description}</p>
              </section>
            )}

            {characteristics.length > 0 && (
              <section className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div className={styles.sectionIcon}>
                    <Building2 />
                  </div>

                  <div>
                    <span>{t("myAdsDetails.sections.details.label")}</span>

                    <h2>{t("myAdsDetails.sections.details.title")}</h2>
                  </div>
                </div>

                <div className={styles.characteristics}>
                  {characteristics.map((item, index) => {
                    const Icon = item.icon;

                    return (
                      <div
                        className={styles.characteristic}
                        key={`${item.label}-${index}`}
                      >
                        <div className={styles.characteristicIcon}>
                          <Icon size={19} />
                        </div>

                        <div>
                          <span>{item.label}</span>

                          <strong>{item.value}</strong>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {amenities.length > 0 && (
              <section className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div className={styles.sectionIcon}>
                    <Sparkles />
                  </div>

                  <div>
                    <span>{t("myAdsDetails.sections.additional.label")}</span>

                    <h2>{t("myAdsDetails.sections.additional.title")}</h2>
                  </div>
                </div>

                <div className={styles.amenities}>
                  {amenities.map((item, index) => (
                    <div className={styles.amenity} key={`${item}-${index}`}>
                      <ShieldCheck size={17} />

                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {(product.location || product.address) && (
              <section className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div className={styles.sectionIcon}>
                    <MapPin />
                  </div>

                  <div>
                    <span>{t("myAdsDetails.sections.location.label")}</span>

                    <h2>{t("myAdsDetails.sections.location.title")}</h2>
                  </div>
                </div>

                <div className={styles.addressCard}>
                  <div className={styles.addressIcon}>
                    <MapPin />
                  </div>

                  <div className={styles.addressContent}>
                    {product.location && <strong>{product.location}</strong>}

                    {product.address && <p>{product.address}</p>}
                  </div>
                </div>
              </section>
            )}
          </div>

          <aside className={styles.sidebar}>
            <div className={styles.sideCard}>
              <div className={styles.sideTop}>
                <Tag />

                <span>{t("myAdsDetails.sidebar.information")}</span>
              </div>

              {product.type && (
                <div className={styles.sideRow}>
                  <span>{t("myAdsDetails.sidebar.category")}</span>

                  <strong>{translatePropertyType(product.type)}</strong>
                </div>
              )}

              {product.dealType && (
                <div className={styles.sideRow}>
                  <span>{t("myAdsDetails.sidebar.offerType")}</span>

                  <strong>{translateDealType(product.dealType)}</strong>
                </div>
              )}

              {product.createdAt && (
                <div className={styles.sideRow}>
                  <span>{t("myAdsDetails.sidebar.publishedAt")}</span>

                  <strong>{product.createdAt}</strong>
                </div>
              )}

              {product.price && (
                <div className={styles.sideRow}>
                  <span>{t("myAdsDetails.sidebar.price")}</span>

                  <strong>{product.price}</strong>
                </div>
              )}

              {product.beachDistance && (
                <div className={styles.sideRow}>
                  <span>{t("myAdsDetails.sidebar.toBeach")}</span>

                  <strong>
                    {product.beachDistance} {t("myAdsDetails.units.meters")}
                  </strong>
                </div>
              )}
            </div>

            <div className={styles.ownerCard}>
              <div className={styles.ownerHeader}>
                <Building2 />

                {t("myAdsDetails.sidebar.management")}
              </div>

              <button
                type="button"
                onClick={handleEdit}
                className={styles.sideEdit}
              >
                <Pencil size={16} />

                {t("myAdsDetails.actions.editFull")}
              </button>

              <button
                type="button"
                onClick={() => setShowDeleteModal(true)}
                className={styles.sideDelete}
              >
                <Trash2 size={16} />

                {t("myAdsDetails.actions.deleteListing")}
              </button>
            </div>
          </aside>
        </div>
      </div>

      <DeleteModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
        title={t("myAdsDetails.deleteModal.title")}
        description={`${t(
          "myAdsDetails.deleteModal.descriptionStart",
        )} «${product.title}»? ${t("myAdsDetails.deleteModal.descriptionEnd")}`}
      />

      <AdsEditModal
        isOpen={showEditModal}
        listing={product}
        onClose={handleCloseEdit}
        onSave={handleSave}
      />
    </main>
  );
}
