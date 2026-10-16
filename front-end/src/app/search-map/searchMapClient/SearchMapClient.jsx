"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import L from "leaflet";

import { getListings, getMapListings, getComplexes, getListingById } from "@/utils/api";
import { mapListingData } from "@/utils/mapListingData";
import { mapComplexData } from "@/utils/mapComplexData";

import { useLanguage } from "@/context/LanguageContext";

import SearchMap from "./SearchMap";
import SearchMapUI from "./SearchMapUI";

function getObjectTypeLabel(object, t) {
  if (object?.objectType === "complex") {
    return t("searchMap.propertyTypes.complex");
  }

  switch (object?.propertyType) {
    case "house":
      return t("searchMap.propertyTypes.house");

    case "cottage":
      return t("searchMap.propertyTypes.cottage");

    case "land":
      return t("searchMap.propertyTypes.land");

    case "commercial":
      return t("searchMap.propertyTypes.commercial");

    case "parking":
      return t("searchMap.propertyTypes.parking");

    case "room":
      return t("searchMap.propertyTypes.room");

    default:
      return t("searchMap.propertyTypes.apartment");
  }
}

function normalizeDealType(object) {
  if (!object) return "";

  const raw = String(
    object.dealType ??
      object.deal_type ??
      object.transactionType ??
      object.transaction_type ??
      object.operationType ??
      object.operation_type ??
      object.deal ??
      object.operation ??
      object.typeDeal ??
      "",
  )
    .trim()
    .toLowerCase();

  if (
    raw.includes("rent") ||
    raw.includes("аренд") ||
    raw.includes("сним") ||
    raw.includes("найм") ||
    raw.includes("ижара") ||
    raw.includes("lease")
  ) {
    return "rent";
  }

  if (
    raw.includes("buy") ||
    raw.includes("продаж") ||
    raw.includes("куп") ||
    raw.includes("сатуу") ||
    raw.includes("сатып") ||
    raw.includes("sale")
  ) {
    return "buy";
  }

  return "";
}

function normalizePropertyType(object) {
  if (!object) return "";

  if (object.objectType === "complex") {
    return "complex";
  }

  const raw = String(
    object.type ??
      object.category ??
      object.categoryType ??
      object.propertyType ??
      "",
  )
    .trim()
    .toLowerCase();

  if (
    raw.includes("apartment") ||
    raw.includes("квартир") ||
    raw.includes("батир") ||
    raw.includes("flat")
  ) {
    return "apartment";
  }

  if (raw.includes("cottage") || raw.includes("коттедж")) {
    return "cottage";
  }

  if (raw.includes("house") || raw.includes("дом") || raw.includes("үй")) {
    return "house";
  }

  if (
    raw.includes("land") ||
    raw.includes("зем") ||
    raw.includes("участ") ||
    raw.includes("жер") ||
    raw.includes("plot")
  ) {
    return "land";
  }

  if (
    raw.includes("commercial") ||
    raw.includes("коммер") ||
    raw.includes("офис") ||
    raw.includes("магазин")
  ) {
    return "commercial";
  }

  if (
    raw.includes("parking") ||
    raw.includes("паркинг") ||
    raw.includes("гараж")
  ) {
    return "parking";
  }

  if (raw.includes("room") || raw.includes("комнат") || raw.includes("бөлм")) {
    return "room";
  }

  return raw;
}

function getLocationText(object) {
  if (!object) return "";

  return [
    object.country,
    object.city,
    object.region,
    object.district,
    object.address,
    object.fullAddress,
    object.location,
    object.street,
  ]
    .filter(Boolean)
    .map((value) => String(value).trim())
    .join(" ")
    .toLowerCase();
}

function normalizeLocation(object) {
  if (!object) return "";

  const text = getLocationText(object);

  if (
    text.includes("турци") ||
    text.includes("түрки") ||
    text.includes("turkey") ||
    text.includes("istanbul") ||
    text.includes("стамбул") ||
    text.includes("ankara") ||
    text.includes("анкара") ||
    text.includes("antalya") ||
    text.includes("анталь")
  ) {
    return "turkey";
  }

  if (text.includes("бишкек") || text.includes("bishkek")) {
    return "bishkek";
  }

  if (text.includes("чуйск") || text.includes("чүй") || text.includes("chuy")) {
    return "chuy";
  }

  if (
    text.includes("ошск") ||
    text.includes("ошская") ||
    text.includes("ош ") ||
    text.includes("osh")
  ) {
    return "osh";
  }

  if (
    text.includes("джалал") ||
    text.includes("жалал") ||
    text.includes("jalal")
  ) {
    return "jalal_abad";
  }

  if (
    text.includes("иссык") ||
    text.includes("иссык-куль") ||
    text.includes("иссык куль") ||
    text.includes("каракол") ||
    text.includes("чолпон") ||
    text.includes("бостери") ||
    text.includes("тамчы") ||
    text.includes("балыкчы") ||
    text.includes("боконбаево") ||
    text.includes("ысык")
  ) {
    return "issyk_kul";
  }

  if (text.includes("нарын") || text.includes("naryn")) {
    return "naryn";
  }

  if (text.includes("талас") || text.includes("talas")) {
    return "talas";
  }

  if (text.includes("баткен") || text.includes("batken")) {
    return "batken";
  }

  return "";
}

function normalizeListing(item) {
  if (!item) return null;

  let mapped;

  try {
    mapped = mapListingData(item);
  } catch (error) {
    console.error("Ошибка mapListingData:", item, error);
    return null;
  }

  const latitude = Number(
    mapped.latitude ??
      mapped.lat ??
      item.latitude ??
      item.lat ??
      item.location?.latitude ??
      item.location?.lat,
  );

  const longitude = Number(
    mapped.longitude ??
      mapped.lng ??
      mapped.lon ??
      item.longitude ??
      item.lng ??
      item.lon ??
      item.location?.longitude ??
      item.location?.lng,
  );

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    console.warn("Объявление пропущено: нет координат", item);

    return null;
  }

  const object = {
    ...mapped,

    id: item.id ?? mapped.id,

    objectType: "listing",

    type: mapped.type || item.category || item.propertyType || "apartment",

    name: mapped.title || mapped.name || item.title || item.name || "",

    address:
      mapped.address ||
      mapped.location ||
      item.address ||
      item.fullAddress ||
      "",

    price: mapped.priceFormatted || mapped.price || item.price || "",

    image:
      mapped.image ||
      mapped.images?.[0] ||
      item.cover_photo ||
      item.coverPhoto ||
      item.images?.[0] ||
      null,

    latitude,
    longitude,

    position: [latitude, longitude],
  };

  const combined = {
    ...item,
    ...mapped,
    address: object.address,
  };

  return {
    ...object,

    dealType: normalizeDealType(combined),

    propertyType: normalizePropertyType(combined),

    locationType: normalizeLocation(combined),

    locationText: getLocationText(combined),
  };
}

function normalizeComplex(item) {
  if (!item) return null;

  let mapped;

  try {
    mapped = mapComplexData(item);
  } catch (error) {
    console.error("Ошибка mapComplexData:", item, error);
    return null;
  }

  const latitude = Number(
    mapped.latitude ??
      mapped.lat ??
      item.latitude ??
      item.lat ??
      item.location?.latitude ??
      item.location?.lat,
  );

  const longitude = Number(
    mapped.longitude ??
      mapped.lng ??
      mapped.lon ??
      item.longitude ??
      item.lng ??
      item.location?.longitude ??
      item.location?.lng,
  );

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    console.warn("ЖК пропущен: нет координат", item);
    return null;
  }

  let price = "";

  if (mapped.priceFrom !== null && mapped.priceFrom !== undefined) {
    if (
      mapped.priceTo !== null &&
      mapped.priceTo !== undefined &&
      mapped.priceFrom !== mapped.priceTo
    ) {
      price = {
        type: "range",
        from: mapped.priceFrom,
        to: mapped.priceTo,
      };
    } else {
      price = {
        type: "from",
        value: mapped.priceFrom,
      };
    }
  }

  const object = {
    ...mapped,

    id: item.id ?? mapped.id,

    objectType: "complex",

    type: "complex",

    name: mapped.name || item.name || "",

    address: mapped.address || item.address || item.fullAddress || "",

    price,

    image:
      mapped.image ||
      mapped.images?.[0] ||
      item.cover_photo ||
      item.coverPhoto ||
      null,

    latitude,
    longitude,

    position: [latitude, longitude],
  };

  const combined = {
    ...item,
    ...mapped,
    address: object.address,
  };

  return {
    ...object,

    dealType: normalizeDealType(combined),

    propertyType: "complex",

    locationType: normalizeLocation(combined),

    locationText: getLocationText(combined),
  };
}

export default function SearchMapClient() {
  const router = useRouter();
  const { t } = useLanguage();

  const [listings, setListings] = useState([]);
  const [complexes, setComplexes] = useState([]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [search, setSearch] = useState("");

  const [showFilters, setShowFilters] = useState(false);

  // Канонические значения. Не переводим.
  const [dealFilter, setDealFilter] = useState("Все");
  const [propertyFilter, setPropertyFilter] = useState("Все");
  const [locationFilter, setLocationFilter] = useState("Все");

  const [isAreaMode, setIsAreaMode] = useState(false);
  const [selectedBounds, setSelectedBounds] = useState(null);
  const [tempBounds, setTempBounds] = useState(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);

  const [selectedObject, setSelectedObject] = useState(null);
  const [selectedObjectDetails, setSelectedObjectDetails] = useState(null);

  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState("");

  const dealOptions = useMemo(
    () => [
      {
        value: "Все",
        label: t("searchMap.filters.all"),
      },
      {
        value: "Купить",
        label: t("searchMap.deals.buy"),
      },
      {
        value: "Снять",
        label: t("searchMap.deals.rent"),
      },
    ],
    [t],
  );

  const propertyOptions = useMemo(
    () => [
      {
        value: "Все",
        label: t("searchMap.filters.all"),
      },
      {
        value: "Квартира",
        label: t("searchMap.propertyTypes.apartment"),
      },
      {
        value: "Дом",
        label: t("searchMap.propertyTypes.house"),
      },
      {
        value: "Коттедж",
        label: t("searchMap.propertyTypes.cottage"),
      },
      {
        value: "Участок",
        label: t("searchMap.propertyTypes.land"),
      },
      {
        value: "Коммерция",
        label: t("searchMap.propertyTypes.commercial"),
      },
      {
        value: "Паркинг",
        label: t("searchMap.propertyTypes.parking"),
      },
      {
        value: "Комната",
        label: t("searchMap.propertyTypes.room"),
      },
      {
        value: "ЖК",
        label: t("searchMap.propertyTypes.complex"),
      },
    ],
    [t],
  );

  const locationOptions = useMemo(
    () => [
      {
        value: "Все",
        label: t("searchMap.filters.all"),
      },
      {
        value: "Бишкек",
        label: t("searchMap.locations.bishkek"),
      },
      {
        value: "Чуйская область",
        label: t("searchMap.locations.chuy"),
      },
      {
        value: "Ошская область",
        label: t("searchMap.locations.osh"),
      },
      {
        value: "Джалал-Абадская область",
        label: t("searchMap.locations.jalalAbad"),
      },
      {
        value: "Иссык-Кульская область",
        label: t("searchMap.locations.issykKul"),
      },
      {
        value: "Нарынская область",
        label: t("searchMap.locations.naryn"),
      },
      {
        value: "Таласская область",
        label: t("searchMap.locations.talas"),
      },
      {
        value: "Баткенская область",
        label: t("searchMap.locations.batken"),
      },
      {
        value: "Турция",
        label: t("searchMap.locations.turkey"),
      },
    ],
    [t],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        setLoading(true);
        setLoadError("");

        const [listingsResponse, complexesResponse] = await Promise.all([
          getMapListings({
            page: 1,
            limit: 1000,
          }),
          getComplexes(),
        ]);

        if (cancelled) return;

        if (listingsResponse?.success && Array.isArray(listingsResponse.data)) {
          const mappedListings = listingsResponse.data
            .map(normalizeListing)
            .filter(Boolean);

          setListings(mappedListings);
        } else {
          setListings([]);
        }

        if (
          complexesResponse?.success &&
          Array.isArray(complexesResponse.data)
        ) {
          const mappedComplexes = complexesResponse.data
            .map(normalizeComplex)
            .filter(Boolean);

          setComplexes(mappedComplexes);
        } else {
          setComplexes([]);
        }
      } catch (error) {
        console.error("Ошибка загрузки объектов карты:", error);

        if (!cancelled) {
          setLoadError("searchMap.errors.loadObjects");

          setListings([]);
          setComplexes([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      cancelled = true;
    };
  }, []);

  const objects = useMemo(
    () => [...listings, ...complexes],
    [listings, complexes],
  );

  const activeFilterCount = useMemo(() => {
    let count = 0;

    if (dealFilter !== "Все") count += 1;
    if (propertyFilter !== "Все") count += 1;
    if (locationFilter !== "Все") count += 1;
    if (hasSelection) count += 1;

    return count;
  }, [dealFilter, propertyFilter, locationFilter, hasSelection]);

  function getDealValue(object) {
    if (object?.dealType === "buy") {
      return "Купить";
    }

    if (object?.dealType === "rent") {
      return "Снять";
    }

    return "";
  }

  function getPropertyLabel(value) {
    const labels = {
      apartment: "Квартира",
      house: "Дом",
      cottage: "Коттедж",
      land: "Участок",
      commercial: "Коммерция",
      parking: "Паркинг",
      room: "Комната",
      complex: "ЖК",
    };

    return labels[value] || "";
  }

  function getLocationFilterValue(object) {
    const values = {
      bishkek: "Бишкек",
      chuy: "Чуйская область",
      osh: "Ошская область",
      jalal_abad: "Джалал-Абадская область",
      issyk_kul: "Иссык-Кульская область",
      naryn: "Нарынская область",
      talas: "Таласская область",
      batken: "Баткенская область",
      turkey: "Турция",
    };

    return values[object.locationType] || "";
  }

  const filteredObjects = useMemo(() => {
    let result = objects;

    if (selectedBounds) {
      result = result.filter((object) =>
        selectedBounds.contains(L.latLng(object.position)),
      );
    }

    const query = search.trim().toLowerCase();

    if (query) {
      result = result.filter((object) => {
        const name = String(object.name || "").toLowerCase();

        const address = String(object.address || "").toLowerCase();

        const description = String(object.description || "").toLowerCase();

        const developer = String(object.developer || "").toLowerCase();

        const locationText = String(object.locationText || "").toLowerCase();

        return (
          name.includes(query) ||
          address.includes(query) ||
          description.includes(query) ||
          developer.includes(query) ||
          locationText.includes(query)
        );
      });
    }

    if (dealFilter !== "Все") {
      result = result.filter((object) => getDealValue(object) === dealFilter);
    }

    if (propertyFilter !== "Все") {
      result = result.filter(
        (object) => getPropertyLabel(object.propertyType) === propertyFilter,
      );
    }

    if (locationFilter !== "Все") {
      result = result.filter(
        (object) => getLocationFilterValue(object) === locationFilter,
      );
    }

    return result;
  }, [
    objects,
    selectedBounds,
    search,
    dealFilter,
    propertyFilter,
    locationFilter,
  ]);

  function handleBounds(bounds, finished) {
    setTempBounds(bounds);

    if (!finished) return;

    const north = bounds.getNorth();
    const south = bounds.getSouth();

    const east = bounds.getEast();
    const west = bounds.getWest();

    const isTiny =
      Math.abs(north - south) < 0.0005 || Math.abs(east - west) < 0.0005;

    if (isTiny) {
      setTempBounds(null);
      setIsAreaMode(false);
      return;
    }

    setSelectedBounds(bounds);
    setTempBounds(null);
    setHasSelection(true);
    setIsAreaMode(false);

    setSelectedObject((current) => {
      if (!current) return null;

      return bounds.contains(L.latLng(current.position)) ? current : null;
    });

    setSelectedObjectDetails((current) => {
      if (!current) return null;

      return bounds.contains(L.latLng(current.position)) ? current : null;
    });
  }

  function startAreaSelection() {
    closeObjectPreview();

    setTempBounds(null);
    setIsAreaMode(true);
  }

  function cancelAreaSelection() {
    setIsAreaMode(false);
    setTempBounds(null);
    setIsDrawing(false);
  }

  function clearSelection() {
    setSelectedBounds(null);
    setTempBounds(null);
    setHasSelection(false);
    setIsAreaMode(false);
    setIsDrawing(false);

    closeObjectPreview();
  }

  function clearFilters() {
    setDealFilter("Все");
    setPropertyFilter("Все");
    setLocationFilter("Все");
  }

  async function handleObjectClick(object) {
    if (!object?.id) return;

    setSelectedObject(object);
    setSelectedObjectDetails(object);
    setDetailsError("");

    if (object.objectType !== "listing") {
      return;
    }

    try {
      setDetailsLoading(true);

      const response = await getListingById(object.id);

      const rawData = response?.data ?? response?.listing ?? response;

      if (!rawData) {
        setDetailsError("searchMap.errors.objectInfo");
        return;
      }

      let mappedDetails = rawData;

      try {
        mappedDetails = mapListingData(rawData);
      } catch (error) {
        console.warn("Не удалось дополнительно замапить объявление:", error);

        mappedDetails = rawData;
      }

      const mergedObject = {
        ...object,
        ...rawData,
        ...mappedDetails,

        id: rawData.id ?? mappedDetails.id ?? object.id,

        objectType: "listing",

        name:
          mappedDetails.title ||
          mappedDetails.name ||
          rawData.title ||
          rawData.name ||
          object.name,

        address:
          mappedDetails.address ||
          rawData.address ||
          rawData.fullAddress ||
          object.address,

        image:
          mappedDetails.image ||
          mappedDetails.images?.[0] ||
          rawData.cover_photo ||
          rawData.coverPhoto ||
          rawData.images?.[0] ||
          object.image,

        price:
          mappedDetails.priceFormatted ||
          mappedDetails.price ||
          rawData.price ||
          object.price,
      };

      setSelectedObjectDetails(mergedObject);
    } catch (error) {
      console.error("Ошибка получения объявления:", error);

      setDetailsError("searchMap.errors.additionalInfo");

      setSelectedObjectDetails(object);
    } finally {
      setDetailsLoading(false);
    }
  }

  function handleDetails(object) {
    if (!object?.id) return;

    if (object.objectType === "complex") {
      router.push(`/complexes/${object.id}`);
      return;
    }

    router.push(`/all-products/${object.id}`);
  }

  function closeObjectPreview() {
    setSelectedObject(null);
    setSelectedObjectDetails(null);
    setDetailsLoading(false);
    setDetailsError("");
  }

  const previewObject = selectedObjectDetails || selectedObject;

  function getDisplayPrice(object) {
    if (!object?.price) {
      return t("searchMap.fallback.price");
    }

    if (typeof object.price === "object" && object.price.type === "range") {
      return `${t("searchMap.price.from")} ${
        object.price.from
      } ${t("searchMap.price.to")} ${
        object.price.to
      } ${t("searchMap.price.som")}`;
    }

    if (typeof object.price === "object" && object.price.type === "from") {
      return `${t("searchMap.price.from")} ${
        object.price.value
      } ${t("searchMap.price.som")}`;
    }

    return object.price;
  }

  return (
    <main className="search-map-page">
      <section>
        <SearchMapUI
          router={router}
          t={t}
          showFilters={showFilters}
          setShowFilters={setShowFilters}
          activeFilterCount={activeFilterCount}
          clearFilters={clearFilters}
          hasSelection={hasSelection}
          clearSelection={clearSelection}
          dealOptions={dealOptions}
          propertyOptions={propertyOptions}
          locationOptions={locationOptions}
          dealFilter={dealFilter}
          setDealFilter={setDealFilter}
          propertyFilter={propertyFilter}
          setPropertyFilter={setPropertyFilter}
          locationFilter={locationFilter}
          loading={loading}
          loadError={loadError}
          isAreaMode={isAreaMode}
          startAreaSelection={startAreaSelection}
          cancelAreaSelection={cancelAreaSelection}
          isDrawing={isDrawing}
          filteredObjects={filteredObjects}
          previewObject={previewObject}
          closeObjectPreview={closeObjectPreview}
          detailsLoading={detailsLoading}
          detailsError={detailsError}
          getDisplayPrice={getDisplayPrice}
          getObjectTypeLabel={getObjectTypeLabel}
          handleDetails={handleDetails}
        />

        <SearchMap
          filteredObjects={filteredObjects}
          selectedBounds={selectedBounds}
          tempBounds={tempBounds}
          isAreaMode={isAreaMode}
          setIsDrawing={setIsDrawing}
          closeObjectPreview={closeObjectPreview}
          handleBounds={handleBounds}
          handleObjectClick={handleObjectClick}
        />
      </section>
    </main>
  );
}
