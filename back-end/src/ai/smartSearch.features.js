/**
 * Извлечение и нормализация категорийных характеристик (Category Features) и периода аренды
 * из текста поискового запроса на русском и кыргызском языках.
 *
 * Опирается на единый белый список FEATURE_KEYS и санитизатор sanitizeFeatureValue
 * из backend/src/constants/features.js.
 */
import { FEATURE_KEYS, sanitizeFeatureValue } from "../constants/features.js";

const RENT_PERIOD_VALUES = new Set(["hourly", "daily", "weekly", "monthly", "long_term"]);

function addUnique(target, key, value, sanitize = false) {
  const clean = sanitize ? sanitizeFeatureValue(value) : String(value || "").trim();
  if (!clean) return;
  if (!target[key]) target[key] = [];
  if (!target[key].includes(clean)) {
    target[key].push(clean);
  }
}

/**
 * Извлекает категорийные фильтры (features) и rentPeriod из текста запроса.
 * Возвращает объект только с непустыми найденными характеристиками.
 *
 * @param {string} query — исходный текст поискового запроса
 * @param {object} [baseFilters] — базовые фильтры (propertyType, dealType и др.)
 * @param {object} [rawFeatures] — явные характеристики от модели или клиента (если переданы)
 * @returns {object}
 */
export function extractCategoryFeatures(query = "", baseFilters = {}, rawFeatures = {}) {
  const out = {};

  // 1. Валидация явно переданных характеристик (из rawFeatures или baseFilters)
  const sources = [baseFilters, rawFeatures].filter((s) => s && typeof s === "object");
  for (const src of sources) {
    if (typeof src.rentPeriod === "string" && RENT_PERIOD_VALUES.has(src.rentPeriod.trim().toLowerCase())) {
      out.rentPeriod = src.rentPeriod.trim().toLowerCase();
    }
    for (const key of FEATURE_KEYS) {
      const val = src[key];
      if (val === undefined || val === null || val === "") continue;
      const arr = Array.isArray(val) ? val : [val];
      for (const item of arr) {
        addUnique(out, key, item, true);
      }
    }
  }

  if (!query || typeof query !== "string") return out;

  const lower = query.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
  if (!lower) return out;

  // Защита от нецелевых/инъекционных запросов
  if (/(?:игнорируй|системный\s+промпт|drop\s+table|<script)/i.test(lower)) {
    return out;
  }

  // 2. Период аренды (rentPeriod и rentalPeriod)
  if (/(?:посуточн|на\s+сутки|суточн|күнүмдүк|кунумдук)/iu.test(lower)) {
    out.rentPeriod = "daily";
    addUnique(out, "rentalPeriod", "Посуточно");
  } else if (/(?:почасов|по\s+часам|на\s+час(?![\p{L}])|саатына)/iu.test(lower)) {
    out.rentPeriod = "hourly";
    addUnique(out, "rentalPeriod", "Почасово");
  } else if (/(?:на\s+недел|понедельн)/iu.test(lower)) {
    out.rentPeriod = "weekly";
  } else if (/(?:на\s+долгий\s+срок|на\s+длительный\s+срок|долгосрочн|узак\s+мөөнөт|узак\s+моонот)/iu.test(lower)) {
    out.rentPeriod = "long_term";
    addUnique(out, "rentalPeriod", "На долгий срок");
  } else if (/(?:помесячн|от\s*1\s*месяц|на\s+месяц|айына)/iu.test(lower)) {
    out.rentPeriod = "monthly";
    addUnique(out, "rentalPeriod", "От 1 месяца");
  } else if (/от\s*3\s*месяц/iu.test(lower)) {
    addUnique(out, "rentalPeriod", "От 3 месяцев");
  } else if (/от\s*6\s*месяц/iu.test(lower)) {
    addUnique(out, "rentalPeriod", "От 6 месяцев");
  }

  // 3. Серия дома (series)
  if (/(?:новостройк|жаңы\s+үй|жаны\s+уй|новый\s+дом)/iu.test(lower)) {
    addUnique(out, "series", "Новостройка");
  }
  if (/(?:^|[^\d])102(?:\s*-?\s*сер|\s+серия)(?![\d])/iu.test(lower)) addUnique(out, "series", "102 серия");
  if (/(?:^|[^\d])104(?:\s*-?\s*сер|\s+серия)?(?![\d])/iu.test(lower) && /104\s*(?:-?\s*сер|серия)/iu.test(lower)) {
    addUnique(out, "series", "104 серия");
  }
  if (/105\s*(?:-?\s*сер|серия)/iu.test(lower)) addUnique(out, "series", "105 серия");
  if (/106\s*улучш/iu.test(lower)) {
    addUnique(out, "series", "106 улучшенная");
  } else if (/106\s*обычн/iu.test(lower)) {
    addUnique(out, "series", "106 обычная");
  } else if (/106\s*(?:-?\s*сер|серия)/iu.test(lower)) {
    addUnique(out, "series", "106 обычная");
    addUnique(out, "series", "106 улучшенная");
  }
  if (/107\s*улучш/iu.test(lower)) {
    addUnique(out, "series", "107 улучшенная");
  } else if (/107\s*обычн/iu.test(lower)) {
    addUnique(out, "series", "107 обычная");
  } else if (/107\s*(?:-?\s*сер|серия)/iu.test(lower)) {
    addUnique(out, "series", "107 обычная");
    addUnique(out, "series", "107 улучшенная");
  }
  if (/(?:индивидуалк|индивидуальн\p{L}*\s+проект)/iu.test(lower)) addUnique(out, "series", "Индивидуалка");
  if (/сталинк/iu.test(lower)) addUnique(out, "series", "Сталинка");
  if (/хрущевк/iu.test(lower)) addUnique(out, "series", "Хрущевка");
  if (/(?:элитк|элитн\p{L}*\s+(?:дом|жилье|квартир))/iu.test(lower)) addUnique(out, "series", "Элитка");
  if (/пентхаус/iu.test(lower)) addUnique(out, "series", "Пентхаус");

  // 4. Этаж (floor) vs этажность дома (floors)
  if (/цокол/iu.test(lower)) {
    addUnique(out, "floor", "Цоколь");
  }
  const houseFloorsMatch = lower.match(
    /(?:^|[^\p{L}\d])(?:([1-9])\s*(?:-?\s*этажн\p{L}*|этажа|этажей|кабаттуу)|(одно|двух|трех|четырех)этажн\p{L}*)/iu,
  );
  if (houseFloorsMatch) {
    const wordMap = { одно: 1, двух: 2, трех: 3, четырех: 4 };
    const n = houseFloorsMatch[1] ? Number(houseFloorsMatch[1]) : wordMap[houseFloorsMatch[2]];
    if (n) addUnique(out, "floors", n >= 4 ? "4+" : String(n));
  } else {
    const aptFloorMatch = lower.match(/(?:на\s+)?(\d{1,2})\s*(?:-?[йм]?\s*)?(?:этаж(?![н\p{L}])|этаже|кабат(?![т\p{L}]))/iu);
    if (aptFloorMatch) {
      const fNum = Number(aptFloorMatch[1]);
      if (fNum >= 1 && fNum <= 100) {
        addUnique(out, "floor", fNum >= 10 ? "10+" : String(fNum));
      }
    }
  }

  // 5. Состояние ремонта (condition)
  if (/дизайнерск\p{L}*\s*ремонт/iu.test(lower)) {
    addUnique(out, "condition", "Дизайнерский ремонт");
  } else if (/(?:евроремонт|евро\s+ремонт)/iu.test(lower)) {
    addUnique(out, "condition", "Евроремонт");
  } else if (/косметическ\p{L}*\s*(?:ремонт)?/iu.test(lower)) {
    addUnique(out, "condition", "Косметический");
  } else if (/(?:под\s+самоотделк|(?:^|[^\p{L}])псо(?![\p{L}])|чернов\p{L}*\s+отделк|предчистов)/iu.test(lower)) {
    addUnique(out, "condition", "Под самоотделку");
  } else if (/старый\s+ремонт/iu.test(lower)) {
    addUnique(out, "condition", "Старый ремонт");
  } else if (/без\s+ремонта/iu.test(lower)) {
    addUnique(out, "condition", "Без ремонта");
  }

  // 6. Стены (walls) и материал гаража (material)
  if (/кирпич/iu.test(lower)) {
    if (baseFilters.propertyType === "parking") addUnique(out, "material", "Кирпич");
    else addUnique(out, "walls", "Кирпич");
  }
  if (/монолит/iu.test(lower)) {
    if (baseFilters.propertyType === "parking") addUnique(out, "material", "Железобетон / монолит");
    else addUnique(out, "walls", "Монолит");
  }
  if (/панел/iu.test(lower)) addUnique(out, "walls", "Панель");
  if (/(?:газобетон|пеноблок|блочн)/iu.test(lower)) {
    if (baseFilters.propertyType === "parking") addUnique(out, "material", "Пеноблок");
    else addUnique(out, "walls", "Блок");
  }
  if (/деревянн/iu.test(lower)) addUnique(out, "walls", "Дерево");

  // 7. Отопление (heating)
  if (/центральн\p{L}*\s+отоплен/iu.test(lower)) addUnique(out, "heating", "Центральное");
  if (/автономн\p{L}*\s+отоплен/iu.test(lower)) addUnique(out, "heating", "Автономное");
  if (/(?:газов\p{L}*\s+отоплен|отоплен\p{L}*\s+газ|на\s+газу)/iu.test(lower)) addUnique(out, "heating", "Газовое");
  if (/(?:электрическ\p{L}*\s+отоплен|электроотоплен)/iu.test(lower)) addUnique(out, "heating", "Электрическое");
  if (/(?:тверд\p{L}*\s+топлив|угольн\p{L}*\s+отоплен|на\s+угле)/iu.test(lower)) addUnique(out, "heating", "Твердое топливо");
  if (/без\s+отоплен/iu.test(lower)) addUnique(out, "heating", "Без отопления");

  // 8. Документы (documents)
  if (/(?:красн\p{L}*\s+книг|кызыл\s+китеп)/iu.test(lower)) addUnique(out, "documents", "Красная книга");
  if (/(?:техпаспорт|тех\s*паспорт|техническ\p{L}*\s+паспорт)/iu.test(lower)) addUnique(out, "documents", "Техпаспорт");
  if (/(?:(?:^|[^\p{L}])дду(?![\p{L}])|долев\p{L}*\s+участи)/iu.test(lower)) addUnique(out, "documents", "ДДУ");
  if (/(?:договор\s+купли|купля\s+продажа)/iu.test(lower)) addUnique(out, "documents", "Договор купли-продажи");
  if (/(?:зелен\p{L}*\s+книг|жашыл\s+китеп)/iu.test(lower)) addUnique(out, "documents", "Зеленая книга");

  // 9. Условия сделки (offerType)
  if (/(?:от\s+собственник|от\s+хозяин|без\s+посредник|өз\s+ээсинен)/iu.test(lower)) {
    addUnique(out, "offerType", "От собственника");
  }
  if (/от\s+застройщик/iu.test(lower)) addUnique(out, "offerType", "От застройщика");
  if (/ипотек/iu.test(lower)) addUnique(out, "offerType", "Возможна ипотека");
  if (/(?:рассрочк|бөлүп\s+төлөө|болуп\s+толоо)/iu.test(lower)) addUnique(out, "offerType", "Возможна рассрочка");
  if (/(?:обмен|бартер|алмашуу)/iu.test(lower)) addUnique(out, "offerType", "Возможен обмен");

  // 10. Мебель (furniture) и животные (pets)
  if (/без\s+мебел|эмерексиз/iu.test(lower)) {
    addUnique(out, "furniture", "Без мебели");
  } else if (/частичн\p{L}*\s+мебл/iu.test(lower)) {
    addUnique(out, "furniture", "Частично меблирована");
  } else if (/(?:кухонн\p{L}*\s+гарнитур|только\s+кухн)/iu.test(lower)) {
    addUnique(out, "furniture", "Только кухонный гарнитур");
  } else if (/(?:с\s+мебел|меблирован|мебель\s+бар|эмереги\s+менен)/iu.test(lower)) {
    addUnique(out, "furniture", "Полностью меблирована");
  }

  if (/без\s+животн/iu.test(lower)) {
    addUnique(out, "pets", "Без животных");
  } else if (/только\s+кошк/iu.test(lower)) {
    addUnique(out, "pets", "Только кошки");
  } else if (/(?:можно\s+с\s+животн|с\s+животн|с\s+питомц)/iu.test(lower)) {
    addUnique(out, "pets", "Можно с животными");
  }

  // 11. Тип дома / коттеджа (houseType)
  if (/таунхаус/iu.test(lower)) addUnique(out, "houseType", "Таунхаус");
  if (/дуплекс/iu.test(lower)) addUnique(out, "houseType", "Дуплекс");
  if (/полдома|пол\s+дома/iu.test(lower)) addUnique(out, "houseType", "Полдома");
  if (/(?:^|[^\p{L}])дач(?:а|у|е|ный)(?![\p{L}])/iu.test(lower)) addUnique(out, "houseType", "Дача");
  if (/особняк/iu.test(lower)) addUnique(out, "houseType", "Особняк");
  if (/вилл(?:а|у|е)/iu.test(lower)) addUnique(out, "houseType", "Вилла");
  if (/бунгало/iu.test(lower)) addUnique(out, "houseType", "Бунгало");
  if (/шале/iu.test(lower)) addUnique(out, "houseType", "Шале");
  if (/а-фрейм|a-frame/iu.test(lower)) addUnique(out, "houseType", "А-фрейм");

  // 12. Коммуникации и параметры дома/участка
  if (/септик/iu.test(lower)) addUnique(out, "sewerage", "Септик");
  if (/центральн\p{L}*\s+канализац/iu.test(lower)) addUnique(out, "sewerage", "Центральная");
  if (/центральн\p{L}*\s+(?:вода|водоснабжен|водопровод)/iu.test(lower)) addUnique(out, "water", "Центральное");
  if (/скважин/iu.test(lower)) addUnique(out, "water", "Скважина");
  if (/колодец/iu.test(lower)) addUnique(out, "water", "Колодец");
  if (/(?:3\s*фаз|трехфаз|380\s*в)/iu.test(lower)) {
    if (baseFilters.propertyType === "commercial") {
      addUnique(out, "technicalParameters", "Высокая мощность (380В)");
    } else {
      addUnique(out, "electricity", "3 фазы (380В)");
    }
  }

  if (/(?:(?:^|[^\p{L}])ижс(?![\p{L}])|под\s+строительств)/iu.test(lower)) {
    addUnique(out, "purpose", "ИЖС (под строительство)");
  } else if (/сельхоз/iu.test(lower)) {
    addUnique(out, "purpose", "Сельхозназначение");
  } else if (/промназначен|под\s+промбаз/iu.test(lower)) {
    addUnique(out, "purpose", "Промназначение");
  }

  if (/ровн\p{L}*\s+участ/iu.test(lower)) addUnique(out, "terrain", "Ровный");
  if (/углов\p{L}*\s+участ/iu.test(lower)) addUnique(out, "terrain", "Угловой");

  if (/(?:с\s+газом|газ\s+бар|газифицирован)/iu.test(lower)) addUnique(out, "communications", "Газ");
  if (/(?:с\s+водой|суусу\s+бар|водопровод)/iu.test(lower)) addUnique(out, "communications", "Вода");
  if (/(?:с\s+отоплен|жылытуусу\s+бар)/iu.test(lower)) addUnique(out, "communications", "Отопление");
  if (/асфальтирован\p{L}*\s+подъезд/iu.test(lower)) addUnique(out, "communications", "Асфальтированный подъезд");

  // 13. Комнаты (privateBathroom)
  if (/(?:свой\s+санузел|отдельный\s+санузел|личн\p{L}*\s+санузел)/iu.test(lower)) {
    addUnique(out, "privateBathroom", "Да (свой санузел)");
  }

  // 14. Коммерческая недвижимость (premisesType, firstLine, separateEntrance, rentalBusiness, technicalParameters)
  if (baseFilters.propertyType === "commercial") {
    if (/офис/iu.test(lower)) addUnique(out, "premisesType", "Офис");
    if (/(?:торгов\p{L}*\s+помещен|магазин|дүкөн|дукон)/iu.test(lower)) addUnique(out, "premisesType", "Торговое помещение");
    if (/свободн\p{L}*\s+назначен/iu.test(lower)) addUnique(out, "premisesType", "Свободного назначения");
    if (/(?:склад|производств|цех)/iu.test(lower)) addUnique(out, "premisesType", "Склад / производство");
    if (/(?:общепит|кафе|ресторан|кофейн)/iu.test(lower)) addUnique(out, "premisesType", "Общепит (кафе/ресторан)");
    if (/(?:гостиниц|хостел|отел)/iu.test(lower)) addUnique(out, "premisesType", "Гостиница / хостел");
    if (/(?:салон|автосервис|барбершоп)/iu.test(lower)) addUnique(out, "premisesType", "Салон / сервис");
    if (/готов\p{L}*\s+бизнес/iu.test(lower)) addUnique(out, "premisesType", "Готовый бизнес");
    if (/(?:здание\s+целиком|отдельно\s+стоящ\p{L}*\s+здан|(?:^|[^\p{L}])осз(?![\p{L}]))/iu.test(lower)) {
      addUnique(out, "premisesType", "Здание целиком");
    }
    if (/(?:перв\p{L}*\s+лини|1\s*-?\s*я?\s+лини)/iu.test(lower)) {
      addUnique(out, "firstLine", "Да (первая линия)");
    }
    if (/отдельн\p{L}*\s+вход/iu.test(lower)) addUnique(out, "separateEntrance", "Да");
    if (/(?:с\s+арендатор|арендн\p{L}*\s+бизнес|действующ\p{L}*\s+бизнес)/iu.test(lower)) {
      addUnique(out, "rentalBusiness", "Да (с арендаторами)");
    }
    if (/витринн\p{L}*\s+окн/iu.test(lower)) addUnique(out, "technicalParameters", "Витринные окна");
    if (/(?:круглосуточн|24\/7)/iu.test(lower)) addUnique(out, "technicalParameters", "Круглосуточный доступ 24/7");
    if (/мокр\p{L}*\s+точк/iu.test(lower)) addUnique(out, "technicalParameters", "Мокрая точка (вода/канализация)");
    if (/(?:приточн\p{L}*\s+вентиляц|вытяжк)/iu.test(lower)) addUnique(out, "technicalParameters", "Приточная вентиляция");
    if (/(?:зон\p{L}*\s+разгрузк|рампа|пандус)/iu.test(lower)) addUnique(out, "technicalParameters", "Зона разгрузки");
  }

  // 15. Паркинг / гараж
  if (baseFilters.propertyType === "parking") {
    if (/капитальн\p{L}*\s+гараж/iu.test(lower)) addUnique(out, "parkingType", "Капитальный гараж");
    if (/металлическ\p{L}*\s+гараж/iu.test(lower)) addUnique(out, "parkingType", "Металлический гараж");
    if (/подземн\p{L}*\s+паркинг/iu.test(lower)) addUnique(out, "parkingType", "Подземный паркинг");
    if (/крыт\p{L}*\s+(?:стоянк|паркинг)/iu.test(lower)) addUnique(out, "parkingType", "Крытая стоянка");
    if (/бокс\s+в\s+гск|(?:^|[^\p{L}])гск(?![\p{L}])/iu.test(lower)) addUnique(out, "parkingType", "Бокс в ГСК");
    if (/автоматическ\p{L}*\s+ворот|роллет|секционн\p{L}*\s+ворот/iu.test(lower)) {
      addUnique(out, "gateType", "Автоматические (роллеты/секционные)");
    }
    if (/распашн\p{L}*\s+ворот/iu.test(lower)) addUnique(out, "gateType", "Распашные");
    if (/откатн\p{L}*\s+ворот/iu.test(lower)) addUnique(out, "gateType", "Откатные");
    if (/смотров\p{L}*\s+ям|с\s+ямой/iu.test(lower)) addUnique(out, "inspectionPit", "Есть");
    if (/с\s+погреб|погреб|с\s+подвал/iu.test(lower)) addUnique(out, "basement", "Есть");
    if (/заезд\s+для\s+фур|грузов\p{L}*\s+заезд/iu.test(lower)) addUnique(out, "truckAccess", "Да");
  }

  // 16. Удобства (amenities)
  if (/(?:wi-?fi|вайфай|вай-фай)/iu.test(lower)) addUnique(out, "amenities", "Wi-Fi");
  if (/кондиционер/iu.test(lower)) addUnique(out, "amenities", "Кондиционер");
  if (/стиральн\p{L}*\s+машин|стиралк/iu.test(lower)) addUnique(out, "amenities", "Стиральная машина");
  if (/холодильник/iu.test(lower)) addUnique(out, "amenities", "Холодильник");
  if (/телевизор/iu.test(lower)) addUnique(out, "amenities", "Телевизор");
  if (/балкон|лоджи/iu.test(lower)) addUnique(out, "amenities", "Балкон / лоджия");
  if (/гардеробн/iu.test(lower)) addUnique(out, "amenities", "Гардеробная");
  if (/грузов\p{L}*\s+лифт/iu.test(lower)) addUnique(out, "amenities", "Грузовой лифт");
  else if (/с\s+лифт|лифт\s+бар/iu.test(lower)) addUnique(out, "amenities", "Лифт");
  if (/закрыт\p{L}*\s+(?:двор|территор)/iu.test(lower)) addUnique(out, "amenities", "Закрытый двор");
  if (/детск\p{L}*\s+площадк/iu.test(lower)) addUnique(out, "amenities", "Детская площадка");
  if (/охран|консьерж/iu.test(lower)) addUnique(out, "amenities", "Охрана / консьерж");
  if (/видеонаблюден/iu.test(lower)) addUnique(out, "amenities", "Видеонаблюдение");
  if (/подземн\p{L}*\s+паркинг/iu.test(lower) && baseFilters.propertyType !== "parking") {
    addUnique(out, "amenities", "Подземный паркинг");
  } else if (/(?:с\s+парковк|парковк\p{L}*\s+бар|унаа\s+токтотмо)/iu.test(lower) && baseFilters.propertyType !== "parking") {
    addUnique(out, "amenities", "Парковка");
  }
  if (/бассейн/iu.test(lower)) addUnique(out, "amenities", "Бассейн");
  if (/спортзал|тренажерн/iu.test(lower)) addUnique(out, "amenities", "Спортзал");
  if (/саун|бан(?:я|ей|ю|и)/iu.test(lower)) addUnique(out, "amenities", "Сауна / баня");
  if (/террас/iu.test(lower)) addUnique(out, "amenities", "Терраса");
  if (/мангал|барбекю/iu.test(lower)) addUnique(out, "amenities", "Мангал / барбекю");
  if (/с\s+садом|плодов\p{L}*\s+дерев/iu.test(lower)) addUnique(out, "amenities", "Сад / огород");
  if (/с\s+гараж/iu.test(lower) && baseFilters.propertyType !== "parking") addUnique(out, "amenities", "Гараж");
  if (/вид\p{L}*\s+на\s+озер/iu.test(lower)) addUnique(out, "amenities", "Вид на озеро");
  if (/вид\p{L}*\s+на\s+гор/iu.test(lower)) addUnique(out, "amenities", "Вид на горы");

  return out;
}
