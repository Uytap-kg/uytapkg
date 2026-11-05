import {
  Home,
  Building2,
  Ruler,
  BedDouble,
  Tag,
  Layers3,
  Flame,
  CarFront,
  Zap,
  Droplets,
  FileCheck,
  MapPin,
  Bath,
  Sofa,
  DoorOpen,
  Compass,
  LandPlot,
  Store,
  Map,
  PawPrint,
  CircleDollarSign,
  Waves,
} from "lucide-react";

export function getFieldLabels(t) {
  return {
    type: t("productInfo.fields.type"),
    category: t("productInfo.fields.category"),
    property_type: t("productInfo.fields.propertyType"),
    propertyType: t("productInfo.fields.propertyType"),

    residentialComplex: t("productInfo.fields.residentialComplex"),
    residential_complex: t("productInfo.fields.residentialComplex"),
    residentialComplexName: t("productInfo.fields.residentialComplex"),
    residential_complex_name: t("productInfo.fields.residentialComplex"),
    complex: t("productInfo.fields.residentialComplex"),
    complexName: t("productInfo.fields.residentialComplex"),
    complex_name: t("productInfo.fields.residentialComplex"),
    zhk: t("productInfo.fields.residentialComplex"),
    zhkName: t("productInfo.fields.residentialComplex"),

    developer: t("productInfo.fields.developer"),
    developerName: t("productInfo.fields.developer"),
    developer_name: t("productInfo.fields.developer"),
    developerOrComplex: t("productInfo.fields.developerOrComplex"),
    developer_or_complex: t("productInfo.fields.developerOrComplex"),

    series: t("productInfo.fields.series"),
    apartmentSeries: t("productInfo.fields.series"),
    apartment_series: t("productInfo.fields.series"),

    rooms: t("productInfo.fields.rooms"),
    roomCount: t("productInfo.fields.rooms"),
    room_count: t("productInfo.fields.rooms"),

    area: t("productInfo.fields.area"),
    totalArea: t("productInfo.fields.totalArea"),
    total_area: t("productInfo.fields.totalArea"),

    landArea: t("productInfo.fields.landArea"),
    land_area: t("productInfo.fields.landArea"),
    areaSotka: t("productInfo.fields.landArea"),
    area_sotka: t("productInfo.fields.landArea"),
    plotArea: t("productInfo.fields.landArea"),
    plot_area: t("productInfo.fields.landArea"),

    floor: t("productInfo.fields.floor"),
    currentFloor: t("productInfo.fields.floor"),
    current_floor: t("productInfo.fields.floor"),

    floors: t("productInfo.fields.floors"),
    totalFloors: t("productInfo.fields.floors"),
    total_floors: t("productInfo.fields.floors"),

    condition: t("productInfo.fields.condition"),
    repair: t("productInfo.fields.repair"),

    walls: t("productInfo.fields.walls"),
    wallMaterial: t("productInfo.fields.walls"),
    wall_material: t("productInfo.fields.walls"),

    heating: t("productInfo.fields.heating"),
    sewerage: t("productInfo.fields.sewerage"),
    water: t("productInfo.fields.water"),
    electricity: t("productInfo.fields.electricity"),
    gas: t("productInfo.fields.gas"),

    documents: t("productInfo.fields.documents"),
    furniture: t("productInfo.fields.furniture"),

    bathroom: t("productInfo.fields.bathroom"),
    bathrooms: t("productInfo.fields.bathrooms"),
    bathroomCount: t("productInfo.fields.bathrooms"),
    bathroom_count: t("productInfo.fields.bathrooms"),
    privateBathroom: t("productInfo.fields.privateBathroom"),
    private_bathroom: t("productInfo.fields.privateBathroom"),

    ceilingHeight: t("productInfo.fields.ceilingHeight"),
    ceiling_height: t("productInfo.fields.ceilingHeight"),

    parking: t("productInfo.fields.parking"),
    parkingType: t("productInfo.fields.parkingType"),
    parking_type: t("productInfo.fields.parkingType"),

    view: t("productInfo.fields.view"),
    orientation: t("productInfo.fields.orientation"),

    purpose: t("productInfo.fields.purpose"),
    fence: t("productInfo.fields.fence"),
    terrain: t("productInfo.fields.terrain"),
    communications: t("productInfo.fields.communications"),
    landLocation: t("productInfo.fields.landLocation"),
    land_location: t("productInfo.fields.landLocation"),

    houseType: t("productInfo.fields.houseType"),
    house_type: t("productInfo.fields.houseType"),

    roomsInApartment: t("productInfo.fields.roomsInApartment"),
    rooms_in_apartment: t("productInfo.fields.roomsInApartment"),

    roomLocation: t("productInfo.fields.roomLocation"),
    room_location: t("productInfo.fields.roomLocation"),

    premisesType: t("productInfo.fields.premisesType"),
    premises_type: t("productInfo.fields.premisesType"),

    technicalParameters: t("productInfo.fields.technicalParameters"),
    technical_parameters: t("productInfo.fields.technicalParameters"),

    firstLine: t("productInfo.fields.firstLine"),
    first_line: t("productInfo.fields.firstLine"),

    separateEntrance: t("productInfo.fields.separateEntrance"),
    separate_entrance: t("productInfo.fields.separateEntrance"),

    rentalBusiness: t("productInfo.fields.rentalBusiness"),
    rental_business: t("productInfo.fields.rentalBusiness"),

    material: t("productInfo.fields.material"),

    gates: t("productInfo.fields.gates"),
    gateType: t("productInfo.fields.gateType"),
    gate_type: t("productInfo.fields.gateType"),

    truckAccess: t("productInfo.fields.truckAccess"),
    truck_access: t("productInfo.fields.truckAccess"),

    offerType: t("productInfo.fields.offerType"),
    offer_type: t("productInfo.fields.offerType"),

    pets: t("productInfo.fields.pets"),

    construction: t("productInfo.fields.construction"),
    constructionType: t("productInfo.fields.construction"),
    construction_type: t("productInfo.fields.construction"),

    beachDistance: t("productInfo.fields.beachDistance"),
    beach_distance: t("productInfo.fields.beachDistance"),

    entrances: t("productInfo.fields.entrances"),
    entranceCount: t("productInfo.fields.entrances"),
    entrance_count: t("productInfo.fields.entrances"),

    yardArea: t("productInfo.fields.yardArea"),
    yard_area: t("productInfo.fields.yardArea"),

    landWidth: t("productInfo.fields.landWidth"),
    land_width: t("productInfo.fields.landWidth"),

    landLength: t("productInfo.fields.landLength"),
    land_length: t("productInfo.fields.landLength"),

    dealType: t("productInfo.fields.dealType"),
    deal_type: t("productInfo.fields.dealType"),

    rentalPeriod: t("productInfo.fields.rentalPeriod"),
    rental_period: t("productInfo.fields.rentalPeriod"),

    amenities: t("productInfo.fields.amenities"),

    country: t("productInfo.fields.country"),
    region: t("productInfo.fields.region"),
    city: t("productInfo.fields.city"),
    settlement: t("productInfo.fields.settlement"),
    district: t("productInfo.fields.district"),
    address: t("productInfo.fields.address"),
  };
}

export function getFieldLabel(key, t) {
  if (!key) return "";

  const labels = getFieldLabels(t);

  if (labels[key]) return labels[key];

  return String(key)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

export function getFieldIcon(key) {
  const normalized = String(key || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е");

  if (
    normalized.includes("complex") ||
    normalized.includes("zhk") ||
    normalized.includes("developer")
  )
    return Building2;

  if (normalized.includes("room")) return BedDouble;

  if (
    normalized.includes("area") ||
    normalized.includes("square") ||
    normalized.includes("площад")
  )
    return Ruler;

  if (normalized.includes("floor")) return Layers3;

  if (normalized.includes("heating") || normalized.includes("отоп")) {
    return Flame;
  }

  if (
    normalized.includes("water") ||
    normalized.includes("вода") ||
    normalized.includes("sewer")
  )
    return Droplets;

  if (normalized.includes("electric") || normalized.includes("электр")) {
    return Zap;
  }

  if (normalized.includes("document")) return FileCheck;

  if (normalized.includes("parking") || normalized.includes("garage")) {
    return CarFront;
  }

  if (normalized.includes("bath") || normalized.includes("сануз")) {
    return Bath;
  }

  if (normalized.includes("furniture") || normalized.includes("мебел")) {
    return Sofa;
  }

  if (normalized.includes("wall") || normalized.includes("material")) {
    return Building2;
  }

  if (normalized.includes("house") || normalized.includes("дом")) return Home;

  if (normalized.includes("land") || normalized.includes("участ")) {
    return LandPlot;
  }

  if (normalized.includes("entrance") || normalized.includes("вход")) {
    return DoorOpen;
  }

  if (normalized.includes("view") || normalized.includes("orientation")) {
    return Compass;
  }

  if (normalized.includes("beach") || normalized.includes("пляж")) {
    return Waves;
  }

  if (normalized.includes("pet") || normalized.includes("живот")) {
    return PawPrint;
  }

  if (normalized.includes("offer") || normalized.includes("deal")) {
    return CircleDollarSign;
  }

  return Tag;
}

export function getCategoryConfig(t) {
  return {
    apartment: [
      ["series", t("productInfo.fields.series"), Tag],
      ["rooms", t("productInfo.fields.rooms"), BedDouble],
      ["area", t("productInfo.fields.area"), Ruler],
      ["floor", t("productInfo.fields.floor"), Layers3],
      ["floors", t("productInfo.fields.floors"), Layers3],
      ["condition", t("productInfo.fields.condition"), Home],
      ["walls", t("productInfo.fields.walls"), Building2],
      ["heating", t("productInfo.fields.heating"), Flame],
      ["furniture", t("productInfo.fields.furniture"), Sofa],
      ["bathroom", t("productInfo.fields.bathroom"), Bath],
      ["bathrooms", t("productInfo.fields.bathrooms"), Bath],
      ["ceilingHeight", t("productInfo.fields.ceilingHeight"), Ruler],
      ["view", t("productInfo.fields.view"), Compass],
      ["orientation", t("productInfo.fields.orientation"), Compass],
      ["parking", t("productInfo.fields.parking"), CarFront],
      ["documents", t("productInfo.fields.documents"), FileCheck],
      ["offerType", t("productInfo.fields.offerType"), CircleDollarSign],
    ],

    house: [
      ["houseType", t("productInfo.fields.houseType"), Home],
      ["area", t("productInfo.fields.area"), Ruler],
      ["landArea", t("productInfo.fields.landArea"), LandPlot],
      ["floors", t("productInfo.fields.floors"), Layers3],
      ["rooms", t("productInfo.fields.rooms"), BedDouble],
      ["heating", t("productInfo.fields.heating"), Flame],
      ["sewerage", t("productInfo.fields.sewerage"), Droplets],
      ["water", t("productInfo.fields.water"), Droplets],
      ["electricity", t("productInfo.fields.electricity"), Zap],
      ["gas", t("productInfo.fields.gas"), Flame],
      ["bathrooms", t("productInfo.fields.bathrooms"), Bath],
      ["parking", t("productInfo.fields.parking"), CarFront],
      ["documents", t("productInfo.fields.documents"), FileCheck],
      ["offerType", t("productInfo.fields.offerType"), CircleDollarSign],
    ],

    cottage: [
      ["houseType", t("productInfo.fields.type"), Home],
      ["area", t("productInfo.fields.area"), Ruler],
      ["landArea", t("productInfo.fields.landArea"), LandPlot],
      ["floors", t("productInfo.fields.floors"), Layers3],
      ["rooms", t("productInfo.fields.rooms"), BedDouble],
      ["heating", t("productInfo.fields.heating"), Flame],
      ["sewerage", t("productInfo.fields.sewerage"), Droplets],
      ["water", t("productInfo.fields.water"), Droplets],
      ["electricity", t("productInfo.fields.electricity"), Zap],
      ["gas", t("productInfo.fields.gas"), Flame],
      ["bathrooms", t("productInfo.fields.bathrooms"), Bath],
      ["parking", t("productInfo.fields.parking"), CarFront],
      ["documents", t("productInfo.fields.documents"), FileCheck],
      ["offerType", t("productInfo.fields.offerType"), CircleDollarSign],
    ],

    land: [
      ["purpose", t("productInfo.fields.purpose"), Map],
      ["landArea", t("productInfo.fields.landArea"), LandPlot],
      ["fence", t("productInfo.fields.fence"), LandPlot],
      ["landLocation", t("productInfo.fields.landLocation"), MapPin],
      ["terrain", t("productInfo.fields.terrain"), Compass],
      ["communications", t("productInfo.fields.communications"), Zap],
      ["water", t("productInfo.fields.water"), Droplets],
      ["electricity", t("productInfo.fields.electricity"), Zap],
      ["gas", t("productInfo.fields.gas"), Flame],
      ["documents", t("productInfo.fields.documents"), FileCheck],
      ["offerType", t("productInfo.fields.offerType"), CircleDollarSign],
    ],

    room: [
      ["roomLocation", t("productInfo.fields.roomLocation"), MapPin],
      ["area", t("productInfo.fields.area"), Ruler],
      ["roomsInApartment", t("productInfo.fields.roomsInApartment"), BedDouble],
      ["floor", t("productInfo.fields.floor"), Layers3],
      ["floors", t("productInfo.fields.floors"), Layers3],
      ["condition", t("productInfo.fields.condition"), Home],
      ["walls", t("productInfo.fields.walls"), Building2],
      ["heating", t("productInfo.fields.heating"), Flame],
      ["privateBathroom", t("productInfo.fields.privateBathroom"), Bath],
      ["furniture", t("productInfo.fields.furniture"), Sofa],
      ["documents", t("productInfo.fields.documents"), FileCheck],
      ["offerType", t("productInfo.fields.offerType"), CircleDollarSign],
    ],

    commercial: [
      ["area", t("productInfo.fields.area"), Ruler],
      ["floor", t("productInfo.fields.floor"), Layers3],
      ["condition", t("productInfo.fields.condition"), Home],
      ["walls", t("productInfo.fields.walls"), Building2],
      ["heating", t("productInfo.fields.heating"), Flame],
      ["premisesType", t("productInfo.fields.premisesType"), Store],
      ["technicalParameters", t("productInfo.fields.technicalParameters"), Tag],
      ["firstLine", t("productInfo.fields.firstLine"), Store],
      ["separateEntrance", t("productInfo.fields.separateEntrance"), DoorOpen],
      ["rentalBusiness", t("productInfo.fields.rentalBusiness"), Store],
      ["parking", t("productInfo.fields.parking"), CarFront],
      ["documents", t("productInfo.fields.documents"), FileCheck],
      ["offerType", t("productInfo.fields.offerType"), CircleDollarSign],
    ],

    parking: [
      ["area", t("productInfo.fields.area"), Ruler],
      ["ceilingHeight", t("productInfo.fields.ceilingHeight"), Ruler],
      ["parkingType", t("productInfo.fields.parkingType"), CarFront],
      ["material", t("productInfo.fields.material"), Building2],
      ["gates", t("productInfo.fields.gates"), DoorOpen],
      ["truckAccess", t("productInfo.fields.truckAccess"), CarFront],
      ["gateType", t("productInfo.fields.gateType"), DoorOpen],
      ["documents", t("productInfo.fields.documents"), FileCheck],
      ["offerType", t("productInfo.fields.offerType"), CircleDollarSign],
    ],
  };
}
