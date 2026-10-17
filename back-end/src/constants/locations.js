export const REGIONS = {
  BISHKEK: "Бишкек",
  ISSYK_KUL: "Иссык-Кульская область",
  CHUY: "Чуйская область",
  OSH_CITY: "Ош (город)",
  OSH_REGION: "Ошская область",
  JALAL_ABAD: "Жалал-Абадская область",
  NARYN: "Нарынская область",
  TALAS: "Таласская область",
  BATKEN: "Баткенская область",
  TURKEY: "Турция",
};

export const BISHKEK_DISTRICTS = [
  "Центр",
  "Южные микрорайоны",
  "10-й микрорайон",
  "11-й микрорайон",
  "12-й микрорайон",
  "Асанбай",
  "Восток-5",
  "Джал",
  "Рабочий городок",
  "Кызыл-Аскер",
  "Аламедин-1",
];

export const ISSYK_KUL_LOCATIONS = [
  "Чолпон-Ата",
  "Бостери",
  "Каджи-Сай",
  "Тамчи",
  "Каракол",
  "Балыкчы",
  "Чок-Тал",
  "Сары-Ой",
];

export const CHUY_LOCATIONS = [
  "Токмок",
  "Кара-Балта",
  "Кант",
  "Сокулук",
  "Беловодское",
  "Кемин",
  "Шопоков",
  "Новопавловка",
];

export const OSH_CITY_DISTRICTS = [
  "Центр",
  "Юго-Восток",
  "Черёмушки",
  "ХБК",
  "Зайнабединова",
  "Анар",
  "Кулатов",
  "Манас-Ата",
  "Ак-Тилек",
];

export const OSH_REGION_LOCATIONS = [
  "Кара-Суу",
  "Узген",
  "Ноокат",
  "Араван",
  "Гульча",
  "Кара-Кулжа",
  "Чон-Алай",
];

export const JALAL_ABAD_LOCATIONS = [
  "Жалал-Абад",
  "Таш-Кумыр",
  "Майлуу-Суу",
  "Кара-Куль",
  "Сузак",
  "Базар-Коргон",
  "Ноокен",
  "Ала-Бука",
  "Токтогул",
  "Кербен",
];

export const NARYN_LOCATIONS = [
  "Нарын",
  "Кочкор",
  "Ат-Башы",
  "Джумгал",
  "Ак-Талаа",
];

export const TALAS_LOCATIONS = [
  "Талас",
  "Бакай-Ата",
  "Манас",
  "Кара-Буура",
  "Покровка",
];

export const BATKEN_LOCATIONS = [
  "Баткен",
  "Кызыл-Кыя",
  "Сулюкта",
  "Кадамжай",
  "Раззаков (Исфана)",
];

export const TURKEY_LOCATIONS = [
  "Анталья",
  "Аланья",
  "Стамбул",
  "Мерсин",
  "Бодрум",
  "Измир",
  "Анкара",
  "Бурса",
  "Мармарис",
];

// Единый справочник "регион -> населённые пункты/районы".
// Используется GET /api/constants и промптом/валидацией умного поиска.
export const LOCATIONS_BY_REGION = {
  BISHKEK: BISHKEK_DISTRICTS,
  ISSYK_KUL: ISSYK_KUL_LOCATIONS,
  CHUY: CHUY_LOCATIONS,
  OSH_CITY: OSH_CITY_DISTRICTS,
  OSH_REGION: OSH_REGION_LOCATIONS,
  JALAL_ABAD: JALAL_ABAD_LOCATIONS,
  NARYN: NARYN_LOCATIONS,
  TALAS: TALAS_LOCATIONS,
  BATKEN: BATKEN_LOCATIONS,
  TURKEY: TURKEY_LOCATIONS,
};

// Алиасы городов (ключ формы создания объявления StepLocation ↔ русское название в фильтрах/AI).
export const CITY_ALIASES = {
  istanbul: ["istanbul", "Стамбул"],
  стамбул: ["istanbul", "Стамбул"],
  ankara: ["ankara", "Анкара"],
  анкара: ["ankara", "Анкара"],
  antalya: ["antalya", "Анталья", "Анталия"],
  анталья: ["antalya", "Анталья", "Анталия"],
  анталия: ["antalya", "Анталья", "Анталия"],
  alanya: ["alanya", "mersin", "Аланья", "Алания"],
  аланья: ["alanya", "mersin", "Аланья", "Алания"],
  алания: ["alanya", "mersin", "Аланья", "Алания"],
  mersin: ["mersin", "Мерсин", "Аланья"],
  мерсин: ["mersin", "Мерсин"],
  izmir: ["izmir", "Измир"],
  измир: ["izmir", "Измир"],
  bursa: ["bursa", "Бурса"],
  бурса: ["bursa", "Бурса"],
  bodrum: ["bodrum", "mugla", "Бодрум", "Мугла"],
  бодрум: ["bodrum", "mugla", "Бодрум", "Мугла"],
  mugla: ["mugla", "bodrum", "Бодрум", "Мугла"],
  marmaris: ["marmaris", "adana", "Мармарис", "Адана"],
  мармарис: ["marmaris", "adana", "Мармарис", "Адана"],
  adana: ["adana", "marmaris", "Мармарис", "Адана"],
  тамчи: ["Тамчи", "Тамчы"],
  тамчы: ["Тамчи", "Тамчы"],
  "жалал-абад": ["Жалал-Абад", "Джалал-Абад"],
  "джалал-абад": ["Жалал-Абад", "Джалал-Абад"],
  "жалал абад": ["Жалал-Абад", "Джалал-Абад"],
  "джалал абад": ["Жалал-Абад", "Джалал-Абад"],
  раззаков: ["Раззаков (Исфана)", "Раззаков", "Исфана"],
  исфана: ["Раззаков (Исфана)", "Раззаков", "Исфана"],
  "раззаков (исфана)": ["Раззаков (Исфана)", "Раззаков", "Исфана"],
  "сары-ой": ["Сары-Ой", "Чон-Сары-Ой"],
  "чон-сары-ой": ["Сары-Ой", "Чон-Сары-Ой"],
};

// Паттерны поиска региона в БД (поддержка кодов BISHKEK/ISSYK_KUL и русских названий).
export const REGION_SEARCH_PATTERNS = {
  BISHKEK: ["BISHKEK", "Бишкек"],
  ISSYK_KUL: ["ISSYK_KUL", "Иссык-Кул"],
  CHUY: ["CHUY", "Чуй"],
  OSH: ["OSH", "OSH_CITY", "OSH_REGION", "Ош"],
  OSH_CITY: ["OSH_CITY", "OSH", "Ош"],
  OSH_REGION: ["OSH_REGION", "OSH", "Ош"],
  JALAL_ABAD: ["JALAL_ABAD", "Жалал-Абад", "Джалал-Абад"],
  NARYN: ["NARYN", "Нарын"],
  TALAS: ["TALAS", "Талас"],
  BATKEN: ["BATKEN", "Баткен"],
  TURKEY: ["TURKEY", "Турция", "Turkey"],
};

export function resolveRegionCode(rawRegion) {
  if (!rawRegion) return null;
  const trimmed = String(rawRegion).trim();
  const upper = trimmed.toUpperCase();
  if (REGION_SEARCH_PATTERNS[upper]) return upper;

  const lower = trimmed.toLowerCase().replace(/ё/g, "е").replace(/[-–—_]+/g, " ");
  if (lower.includes("иссык") || lower.includes("ысык") || lower.includes("issyk")) return "ISSYK_KUL";
  if (lower.includes("чуй") || lower.includes("чүй") || lower.includes("chuy")) return "CHUY";
  if (lower.includes("бишкек") || lower.includes("bishkek")) return "BISHKEK";
  if (lower.includes("жалал") || lower.includes("джалал") || lower.includes("jalal")) return "JALAL_ABAD";
  if (lower.includes("нарын") || lower.includes("naryn")) return "NARYN";
  if (lower.includes("талас") || lower.includes("talas")) return "TALAS";
  if (lower.includes("баткен") || lower.includes("batken")) return "BATKEN";
  if (lower.includes("турц") || lower.includes("түрк") || lower.includes("turk")) return "TURKEY";
  if (/(?:^|\s)ош/.test(lower) || lower === "osh") return "OSH";
  return null;
}

