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
