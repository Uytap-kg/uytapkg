import dotenv from "dotenv";
dotenv.config();

const parseJsonFromText = (rawText) => {
  if (!rawText || typeof rawText !== "string") return null;

  const cleaned = rawText.replace(/```json|```/g, "").trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  const jsonString = jsonMatch ? jsonMatch[0] : cleaned;

  try {
    return JSON.parse(jsonString);
  } catch (error) {
    const relaxed = jsonString
      .replace(/([\n\r])+/, " ")
      .replace(/([\s])+/, " ")
      .trim();
    try {
      return JSON.parse(relaxed);
    } catch (innerError) {
      return null;
    }
  }
};

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const getCandidateModels = () => {
  return Array.from(
    new Set([process.env.GEMINI_MODEL, "gemini-2.5-flash", "gemini-flash-latest"].filter(Boolean))
  );
};

const buildSearchPrompt = (prompt) => {
  return `Ты — AI-ассистент платформы недвижимости UyTap (Кыргызстан и Турция).
Проанализируй поисковый запрос пользователя на русском или кыргызском языке и извлеки структурированные фильтры.
Если параметр не указан в запросе, верни null.

Схема ответа (строгий JSON без markdown):
{
  "country": "kyrgyzstan" | "turkey" | null,
  "region": "BISHKEK" | "CHUY" | "OSH" | "ISSYK_KUL" | "JALAL_ABAD" | "NARYN" | "TALAS" | "BATKEN" | "TURKEY" | null,
  "city": string | null,
  "district": string | null,
  "propertyType": "apartment" | "house" | "cottage" | "land" | "commercial" | "room" | "parking" | null,
  "dealType": "sale" | "rent" | null,
  "rooms": 1 | 2 | 3 | "4+" | null,
  "minPrice": number | null,
  "maxPrice": number | null,
  "currency": "USD" | "KGS" | null,
  "minArea": number | null,
  "maxArea": number | null
}

Правила:
1. Регионы Кыргызстана:
   - Бишкек -> region: "BISHKEK", city: "Бишкек"
   - Иссык-Куль, Каракол, Чолпон-Ата, Бостери, Балыкчы -> region: "ISSYK_KUL"
   - Ош, Ошская область -> region: "OSH"
   - Чуй, Чуйская область, Токмок, Кант, Кара-Балта, Сокулук -> region: "CHUY"
   - Джалал-Абад -> region: "JALAL_ABAD"
   - Нарын -> region: "NARYN"
   - Талас -> region: "TALAS"
   - Баткен -> region: "BATKEN"
2. Турция:
   - Аланья, Анталия, Стамбул, Мерсин, Измир, Турция -> country: "turkey", region: "TURKEY"
3. Типы недвижимости (включая кыргызские термины):
   - "квартира", "батир" -> "apartment"
   - "дом", "үй" -> "house"
   - "коттедж" -> "cottage"
   - "участок", "жер", "жер тилкеси" -> "land"
   - "коммерция", "офис", "склад", "магазин" -> "commercial"
   - "комната", "бөлмө" -> "room"
   - "гараж", "паркинг" -> "parking"
4. Тип сделки:
   - "аренда", "снять", "ижара", "ижарага", "алам" -> "rent"
   - "купить", "покупка", "продажа", "сатуу", "сатам", "сатып алам" -> "sale"
5. Цена и валюта:
   - "сом", "сомго", "сомдон" -> currency: "KGS"
   - "$", "доллар", "usd", "бакс" или Турция -> currency: "USD"
   - Если валюта не указана: для аренды > 5000 -> "KGS", для покупки или сумм < 5000 -> "USD"
   - Числа "от X" -> minPrice: X, "до Y" -> maxPrice: Y
6. Площадь:
   - В сотках ("6 соток") -> 1 сотка = 100 м² (6 соток = 600 м²) или указать площадь

Текст запроса: "${prompt}"`;
};

const callGemini = async (prompt) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const candidateModels = getCandidateModels();

  for (const model of candidateModels) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: buildSearchPrompt(prompt),
                  },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: "application/json",
            },
          }),
        },
      );

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        console.warn(
          `Gemini API warning for model ${model} (${response.status}):`,
          errBody?.error?.message || response.statusText,
        );
        continue;
      }

      const data = await response.json();
      const rawText =
        data?.candidates?.[0]?.content?.parts?.[0]?.text ||
        data?.output?.[0]?.content?.[0]?.text;
      const parsed = parseJsonFromText(rawText);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch (err) {
      console.warn(`Gemini API call failed for model ${model}:`, err?.message || err);
    }
  }

  return null;
};

const fallbackParse = (prompt) => {
  const lower = prompt.toLowerCase().replace(/ё/g, "е");

  // Country & Region detection
  const isTurkey =
    lower.includes("турци") ||
    lower.includes("turkey") ||
    lower.includes("түркия") ||
    lower.includes("алань") ||
    lower.includes("антал") ||
    lower.includes("стамбул") ||
    lower.includes("мерсин") ||
    lower.includes("измир");

  const isIssykKul =
    lower.includes("иссык") ||
    lower.includes("ысык") ||
    lower.includes("чолпон") ||
    lower.includes("бостери") ||
    lower.includes("каракол") ||
    lower.includes("балыкчы");

  const isOsh = lower.includes("ош");
  const isBishkek = lower.includes("бишкек");
  const isChuy =
    lower.includes("чуй") ||
    lower.includes("чүй") ||
    lower.includes("токмок") ||
    lower.includes("кант") ||
    lower.includes("кара-балта") ||
    lower.includes("сокулук");
  const isJalalAbad =
    lower.includes("жалал-абад") || lower.includes("джалал-абад");
  const isNaryn = lower.includes("нарын");
  const isTalas = lower.includes("талас");
  const isBatken = lower.includes("баткен");

  let country = null;
  let region = null;
  let city = null;

  if (isTurkey) {
    country = "turkey";
    region = "TURKEY";
    city = lower.includes("алань")
      ? "Аланья"
      : lower.includes("антал")
        ? "Анталия"
        : lower.includes("стамбул")
          ? "Стамбул"
          : lower.includes("мерсин")
            ? "Мерсин"
            : "Турция";
  } else if (isIssykKul) {
    country = "kyrgyzstan";
    region = "ISSYK_KUL";
    city = lower.includes("каракол")
      ? "Каракол"
      : lower.includes("чолпон")
        ? "Чолпон-Ата"
        : lower.includes("бостери")
          ? "Бостери"
          : lower.includes("балыкчы")
            ? "Балыкчы"
            : "Иссык-Куль";
  } else if (isOsh) {
    country = "kyrgyzstan";
    region = "OSH";
    city = "Ош";
  } else if (isBishkek) {
    country = "kyrgyzstan";
    region = "BISHKEK";
    city = "Бишкек";
  } else if (isChuy) {
    country = "kyrgyzstan";
    region = "CHUY";
    city = lower.includes("токмок")
      ? "Токмок"
      : lower.includes("кант")
        ? "Кант"
        : lower.includes("кара-балта")
          ? "Кара-Балта"
          : null;
  } else if (isJalalAbad) {
    country = "kyrgyzstan";
    region = "JALAL_ABAD";
    city = "Джалал-Абад";
  } else if (isNaryn) {
    country = "kyrgyzstan";
    region = "NARYN";
    city = "Нарын";
  } else if (isTalas) {
    country = "kyrgyzstan";
    region = "TALAS";
    city = "Талас";
  } else if (isBatken) {
    country = "kyrgyzstan";
    region = "BATKEN";
    city = "Баткен";
  }

  // District
  let district = null;
  const districtMatches = [
    { key: "джал", val: "Джал" },
    { key: "асанбай", val: "Асанбай" },
    { key: "центр", val: "Центр" },
    { key: "тунгуч", val: "Тунгуч" },
    { key: "кок-жар", val: "Кок-Жар" },
    { key: "ахунбаев", val: "Ахунбаева" },
    { key: "магистрал", val: "Магистраль" },
    { key: "улан", val: "Улан" },
    { key: "восток-5", val: "Восток-5" },
    { key: "аламедин", val: "Аламедин" },
  ];
  for (const dm of districtMatches) {
    if (lower.includes(dm.key)) {
      district = dm.val;
      break;
    }
  }

  // Property Type
  let propertyType = null;
  if (lower.includes("дом") || lower.includes("үй") || lower.includes("уй")) {
    propertyType = "house";
  } else if (lower.includes("коттедж")) {
    propertyType = "cottage";
  } else if (lower.includes("участок") || lower.includes("жер")) {
    propertyType = "land";
  } else if (
    lower.includes("коммерц") ||
    lower.includes("офис") ||
    lower.includes("склад") ||
    lower.includes("магазин")
  ) {
    propertyType = "commercial";
  } else if (lower.includes("гараж") || lower.includes("паркинг")) {
    propertyType = "parking";
  } else if (lower.includes("комнат") || lower.includes("бөлмө")) {
    if (lower.includes("квартир") || lower.includes("батир")) {
      propertyType = "apartment";
    } else if (lower.includes("комната") || lower.includes("комнату")) {
      propertyType = "room";
    } else {
      propertyType = "apartment";
    }
  } else if (
    lower.includes("квартир") ||
    lower.includes("батир") ||
    lower.includes("однушк") ||
    lower.includes("двушк") ||
    lower.includes("трешк")
  ) {
    propertyType = "apartment";
  }

  // Deal Type
  let dealType = null;
  if (
    lower.includes("аренд") ||
    lower.includes("снять") ||
    lower.includes("сниму") ||
    lower.includes("ижара") ||
    lower.includes("алам")
  ) {
    dealType = "rent";
  } else if (
    lower.includes("куп") ||
    lower.includes("прод") ||
    lower.includes("сатам") ||
    lower.includes("сатуу") ||
    lower.includes("сатып")
  ) {
    dealType = "sale";
  }

  // Rooms (careful not to confuse with price)
  let rooms = null;
  if (
    lower.includes("1 комн") ||
    lower.includes("1-комн") ||
    lower.includes("1 бөлмө") ||
    lower.includes("однушк") ||
    /\b1\s*(к|комн|комнат)/.test(lower)
  ) {
    rooms = 1;
  } else if (
    lower.includes("2 комн") ||
    lower.includes("2-комн") ||
    lower.includes("2 бөлмө") ||
    lower.includes("двушк") ||
    /\b2\s*(к|комн|комнат)/.test(lower)
  ) {
    rooms = 2;
  } else if (
    lower.includes("3 комн") ||
    lower.includes("3-комн") ||
    lower.includes("3 бөлмө") ||
    lower.includes("трешк") ||
    /\b3\s*(к|комн|комнат)/.test(lower)
  ) {
    rooms = 3;
  } else if (
    lower.includes("4 комн") ||
    lower.includes("4-комн") ||
    lower.includes("4 бөлмө") ||
    lower.includes("4+") ||
    /\b4\s*(к|комн|комнат)/.test(lower)
  ) {
    rooms = "4+";
  }

  // Currency
  let currency = null;
  if (lower.includes("сом") || lower.includes("kgs")) {
    currency = "KGS";
  } else if (
    lower.includes("$") ||
    lower.includes("доллар") ||
    lower.includes("usd") ||
    isTurkey
  ) {
    currency = "USD";
  }

  // Price - exclude room counts to prevent room number being matched as price
  const cleanedForPrice = lower
    .replace(/[1-4]\s*(-комнатн\w*|комнатн\w*|комн\w*|к\b|бөлмө\w*)/g, " ")
    .replace(/однушк\w*|двушк\w*|трешк\w*/g, " ");

  let minPrice = null;
  let maxPrice = null;

  const rangePriceMatch = cleanedForPrice.match(
    /от\s*(\d+[\s\d]*)\s*до\s*(\d+[\s\d]*)/,
  );
  if (rangePriceMatch) {
    minPrice = Number(rangePriceMatch[1].replace(/\s/g, ""));
    maxPrice = Number(rangePriceMatch[2].replace(/\s/g, ""));
  } else {
    const minMatch = cleanedForPrice.match(
      /(?:от|выше|начиная с)\s*(\d+[\s\d]*)/,
    );
    if (minMatch) {
      minPrice = Number(minMatch[1].replace(/\s/g, ""));
    }
    const numbers = cleanedForPrice.match(/\b\d{2,10}\b/g);
    if (numbers && numbers.length > 0) {
      const candidates = numbers
        .map((n) => Number(n.replace(/\s/g, "")))
        .filter((n) => n >= 50);
      if (candidates.length > 0) {
        maxPrice = candidates[candidates.length - 1];
      }
    }
  }

  return {
    country,
    region,
    city,
    district,
    propertyType: propertyType || "apartment",
    dealType,
    rooms,
    minPrice,
    maxPrice,
    currency:
      currency ||
      (isTurkey
        ? "USD"
        : dealType === "rent" && maxPrice && maxPrice > 5000
          ? "KGS"
          : "USD"),
  };
};

// =======================================================
// Умный Поиск и Генерация Описания с Gemini AI
// =======================================================

const MAX_PROMPT_LENGTH = 300;

export const aiSearch = async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return res.status(400).json({ success: false, message: "Введите текстовый или голосовой запрос" });
    }

    if (prompt.length > MAX_PROMPT_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Запрос слишком длинный (максимум ${MAX_PROMPT_LENGTH} символов)`,
      });
    }

    let filters = null;
    let source = "local-parser";

    try {
      filters = await callGemini(prompt);
      if (filters && typeof filters === "object") {
        source = "gemini-api";
      } else {
        filters = null;
      }
    } catch (geminiError) {
      console.warn("Gemini API call warning, fallback to rule parser:", geminiError?.message || geminiError);
      filters = null;
    }

    if (!filters) {
      filters = fallbackParse(prompt);
    }

    return res.json({
      success: true,
      filters,
      source,
    });
  } catch (error) {
    console.error("AI Search Controller Error:", error);
    return res.status(500).json({ success: false, message: "Ошибка обработки AI запроса" });
  }
};

const MAX_DETAILS_LENGTH = 1000;

export const aiGenerateDescription = async (req, res) => {
  try {
    const { details } = req.body;

    if (!details || typeof details !== "string" || !details.trim()) {
      return res.status(400).json({ success: false, message: "Укажите характеристики объекта" });
    }

    if (details.length > MAX_DETAILS_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Слишком длинный текст (максимум ${MAX_DETAILS_LENGTH} символов)`,
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    const prompt = `На основе кратких характеристик создай продающее описание недвижимости на русском и кыргызском языках. Верни в формате JSON {"ru": "...", "kg": "..."}. Характеристики: ${details}`;

    if (apiKey) {
      const candidateModels = getCandidateModels();
      for (const model of candidateModels) {
        try {
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [
                  {
                    parts: [
                      {
                        text: prompt,
                      },
                    ],
                  },
                ],
                generationConfig: {
                  responseMimeType: "application/json",
                },
              }),
            },
          );

          if (!response.ok) continue;

          const data = await response.json();
          const rawText =
            data?.candidates?.[0]?.content?.parts?.[0]?.text ||
            data?.output?.[0]?.content?.[0]?.text;
          const parsed = parseJsonFromText(rawText);
          if (parsed) {
            return res.json({ success: true, generatedText: parsed });
          }
        } catch (err) {
          console.warn(`Gemini description error with ${model}:`, err?.message || err);
        }
      }
    }

    return res.json({
      success: true,
      generatedText: {
        ru: `Отличный объект недвижимости. ${details || ""}`,
        kg: `Кыймылсыз мүлк объектиси. ${details || ""}`,
      },
    });
  } catch (error) {
    console.error("AI Generate Error:", error);
    return res.status(500).json({ success: false, message: "Ошибка генерации описания" });
  }
};
