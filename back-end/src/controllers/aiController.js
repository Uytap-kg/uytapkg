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
  "maxArea": number | null,
  "searchQuery": string | null
}

Правила анализа:
1. Исправление опечаток:
   - Пользователь может писать с опечатками (например, "стулия" -> "студия", "миркорайон" -> "микрорайон", "уентральном" -> "Центр"). Исправляй их автоматически.
2. Многоязычность (кыргызский и русский языки):
   - "жер уй", "жер үй", "үй" -> propertyType: "house"
   - "батир" -> propertyType: "apartment"
   - "жер", "жер тилкеси" -> propertyType: "land"
   - "комната", "бөлмө" -> propertyType: "room"
   - "ижара", "ижарага", "алам" -> dealType: "rent"
   - "сатуу", "сатам", "сатып алам" -> dealType: "sale"
   - "сом", "сомго", "сомдон" -> currency: "KGS"
3. Специфические ключевые слова (searchQuery):
   - Если запрос содержит ключевые слова или концепции, которые авторы пишут в заголовках или описаниях (например: "студия", "евродвушка", "пентхаус", "с ремонтом", "евроремонт", "панорамные окна", "с бассейном", "в рассрочку"), помести их очищенную нормализованную форму в "searchQuery" (например, "студия").
   - Для "студия": propertyType: "apartment", searchQuery: "студия".
4. Районы (канонизация):
   - Районы приводи к их каноническим названиям в именительном падеже:
     - "в центре", "в центральном районе", "центр" -> district: "Центр"
     - "южный микрорайон", "южные микрорайоны", "в южной части" -> district: "Южные микрорайоны"
     - "джал", "в джале" -> district: "Джал"
     - "асанбай" -> district: "Асанбай"
     - "тунгуч" -> district: "Тунгуч"
     - "кок-жар" -> district: "Кок-Жар"
     - "ахунбаева" -> district: "Ахунбаева"
5. Площадь ("квадрат", "соток"):
   - "110 квадрат", "110 кв", "110 м2" -> площадь в м²: minArea: 100, maxArea: 120 (диапазон вокруг указанной площади).
   - "от 50 до 80 кв" -> minArea: 50, maxArea: 80.
   - "6 соток" -> minArea: 600, maxArea: 600.
6. Регионы и города:
   - Если указан микрорайон Бишкека (Южные микрорайоны, Джал, Центр, Асанбай и т.д.), автоматически: region: "BISHKEK", city: "Бишкек".
   - Иссык-Куль, Каракол, Чолпон-Ата, Бостери, Балыкчы -> region: "ISSYK_KUL".
   - Ош -> region: "OSH", city: "Ош".
   - Чуй, Токмок, Кант, Кара-Балта, Сокулук -> region: "CHUY".
   - Аланья, Анталия, Стамбул, Мерсин -> country: "turkey", region: "TURKEY".
7. Цены и валюта:
   - "от 20 000 долларов до 80000" -> minPrice: 20000, maxPrice: 80000, currency: "USD".
   - "$" или "доллар" или "usd" -> currency: "USD".
   - "сом" -> currency: "KGS".

Текст запроса: "${prompt}"`;
};

const callClaude = async (prompt) => {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) return null;

  const model = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";
  const baseUrl = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1").replace(/\/+$/, "");

  try {
    const isChatCompletions =
      baseUrl.endsWith("/chat/completions") || baseUrl.includes("openrouter.ai/api/v1");
    const endpoint = isChatCompletions
      ? baseUrl.endsWith("/chat/completions")
        ? baseUrl
        : `${baseUrl}/chat/completions`
      : `${baseUrl}/messages`;

    let response;
    if (isChatCompletions) {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: buildSearchPrompt(prompt) },
            { role: "user", content: `Пользовательский запрос: "${prompt}"` },
          ],
          response_format: { type: "json_object" },
        }),
      });
    } else {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 800,
          system: buildSearchPrompt(prompt),
          messages: [
            { role: "user", content: `Пользовательский запрос: "${prompt}"` },
          ],
        }),
      });
    }

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      console.warn(
        `Claude API warning (${response.status}):`,
        errBody?.error?.message || errBody?.message || response.statusText,
      );
      return null;
    }

    const data = await response.json();
    const rawText = isChatCompletions
      ? data?.choices?.[0]?.message?.content
      : data?.content?.[0]?.text;

    const parsed = parseJsonFromText(rawText);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch (err) {
    console.warn("Claude API call failed:", err?.message || err);
  }

  return null;
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
  let lower = prompt.toLowerCase().replace(/ё/g, "е");

  // Fix common typos in Russian/Kyrgyz
  lower = lower
    .replace(/стули\w*/g, "студия")
    .replace(/миркорайон\w*/g, "микрорайон")
    .replace(/уентральн\w*/g, "центральн");

  // Specific search keywords (features that live in descriptions/titles)
  let searchQuery = null;
  if (lower.includes("студи")) {
    searchQuery = "студия";
  } else if (lower.includes("евродвушк")) {
    searchQuery = "евродвушка";
  } else if (lower.includes("пентхаус")) {
    searchQuery = "пентхаус";
  }

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

  const isOsh = lower.includes("ош") && !lower.includes("хорош");
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

  // District (Canonical naming for Bishkek)
  let district = null;
  if (
    lower.includes("южн") &&
    (lower.includes("микрорайон") ||
      lower.includes("мкр") ||
      lower.includes("част"))
  ) {
    district = "Южные микрорайоны";
    if (!region) {
      region = "BISHKEK";
      city = "Бишкек";
      country = "kyrgyzstan";
    }
  } else if (lower.includes("центр") || lower.includes("центральн")) {
    district = "Центр";
    if (!region && !isTurkey) {
      region = "BISHKEK";
      city = "Бишкек";
      country = "kyrgyzstan";
    }
  } else if (lower.includes("джал")) {
    district = "Джал";
    if (!region) {
      region = "BISHKEK";
      city = "Бишкек";
      country = "kyrgyzstan";
    }
  } else if (lower.includes("асанбай")) {
    district = "Асанбай";
    if (!region) {
      region = "BISHKEK";
      city = "Бишкек";
      country = "kyrgyzstan";
    }
  } else if (lower.includes("тунгуч")) {
    district = "Тунгуч";
    if (!region) {
      region = "BISHKEK";
      city = "Бишкек";
      country = "kyrgyzstan";
    }
  } else if (lower.includes("кок-жар") || lower.includes("кок жар")) {
    district = "Кок-Жар";
    if (!region) {
      region = "BISHKEK";
      city = "Бишкек";
      country = "kyrgyzstan";
    }
  } else if (lower.includes("ахунбаев")) {
    district = "Ахунбаева";
    if (!region) {
      region = "BISHKEK";
      city = "Бишкек";
      country = "kyrgyzstan";
    }
  }

  // Property Type (including Kyrgyz: жер уй / жер үй = house, батир = apartment, жер = land)
  let propertyType = null;
  if (
    lower.includes("жер уй") ||
    lower.includes("жер үй") ||
    /(?:^|[^\wа-яёөүң])(жер\s*[үу]й|үй|уй|дом\w*)(?=[^\wа-яёөүң]|$)/i.test(
      lower,
    )
  ) {
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
  } else if (
    lower.includes("комната") ||
    lower.includes("комнату") ||
    lower.includes("бөлмө")
  ) {
    propertyType =
      lower.includes("квартир") || lower.includes("батир")
        ? "apartment"
        : "room";
  } else if (
    lower.includes("квартир") ||
    lower.includes("батир") ||
    lower.includes("однушк") ||
    lower.includes("двушк") ||
    lower.includes("трешк") ||
    lower.includes("студи")
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

  // Rooms
  let rooms = null;
  if (
    lower.includes("1 комн") ||
    lower.includes("1-комн") ||
    lower.includes("1 бөлмө") ||
    lower.includes("однушк") ||
    /\b1\s*(?:-?комнат\w*|комн\w*|к\b|бөлмө\w*)/.test(lower)
  ) {
    rooms = 1;
  } else if (
    lower.includes("2 комн") ||
    lower.includes("2-комн") ||
    lower.includes("2 бөлмө") ||
    lower.includes("двушк") ||
    /\b2\s*(?:-?комнат\w*|комн\w*|к\b|бөлмө\w*)/.test(lower)
  ) {
    rooms = 2;
  } else if (
    lower.includes("3 комн") ||
    lower.includes("3-комн") ||
    lower.includes("3 бөлмө") ||
    lower.includes("трешк") ||
    /\b3\s*(?:-?комнат\w*|комн\w*|к\b|бөлмө\w*)/.test(lower)
  ) {
    rooms = 3;
  } else if (
    lower.includes("4 комн") ||
    lower.includes("4-комн") ||
    lower.includes("4 бөлмө") ||
    lower.includes("4+") ||
    /\b4\s*(?:-?комнат\w*|комн\w*|к\b|бөлмө\w*)/.test(lower)
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

  // Area (квадрат, соток, м2)
  let minArea = null;
  let maxArea = null;
  const areaRangeMatch = lower.match(
    /(?:от\s*)?(\d+)\s*(?:до|-)\s*(\d+)\s*(?:квадрат|кв|м2|м²)/,
  );
  if (areaRangeMatch) {
    minArea = Number(areaRangeMatch[1]);
    maxArea = Number(areaRangeMatch[2]);
  } else {
    const singleAreaMatch = lower.match(/(\d+)\s*(?:квадрат|кв\s*м|м2|м²)/);
    if (singleAreaMatch) {
      const val = Number(singleAreaMatch[1]);
      minArea = Math.round(val * 0.9);
      maxArea = Math.round(val * 1.1);
    }
  }

  // Price
  const cleanedForPrice = lower
    .replace(/[1-4]\s*(-комнатн\w*|комнатн\w*|комн\w*|к\b|бөлмө\w*)/g, " ")
    .replace(/однушк\w*|двушк\w*|трешк\w*/g, " ")
    .replace(/(\d+)\s*(?:квадрат|кв|м2|м²|соток)/g, " ");

  let minPrice = null;
  let maxPrice = null;

  const rangePriceMatch = cleanedForPrice.match(
    /от\s*(\d+[\s\d]*)\s*(?:доллар\w*|\$|usd|сом\w*|kgs|евро|eur)?\s*(?:до|-)\s*(\d+[\s\d]*)/i,
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
    const maxMatch = cleanedForPrice.match(/(?:до|дегенде|чейин)\s*(\d+[\s\d]*)/);
    if (maxMatch) {
      maxPrice = Number(maxMatch[1].replace(/\s/g, ""));
    } else {
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
    minArea,
    maxArea,
    searchQuery,
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

    const preferredProvider = (
      process.env.AI_PROVIDER ||
      (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY ? "claude" : "gemini")
    ).toLowerCase();

    const claudeModelName = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";

    if (preferredProvider === "claude" || preferredProvider === "anthropic") {
      try {
        filters = await callClaude(prompt);
        if (filters && typeof filters === "object") {
          source = claudeModelName;
        }
      } catch (claudeError) {
        console.warn("Claude API call warning:", claudeError?.message || claudeError);
      }

      if (!filters && process.env.GEMINI_API_KEY) {
        try {
          filters = await callGemini(prompt);
          if (filters && typeof filters === "object") {
            source = "gemini-api";
          }
        } catch (geminiError) {
          console.warn("Gemini API fallback warning:", geminiError?.message || geminiError);
        }
      }
    } else {
      try {
        filters = await callGemini(prompt);
        if (filters && typeof filters === "object") {
          source = "gemini-api";
        }
      } catch (geminiError) {
        console.warn("Gemini API call warning:", geminiError?.message || geminiError);
      }

      if (!filters && (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY)) {
        try {
          filters = await callClaude(prompt);
          if (filters && typeof filters === "object") {
            source = claudeModelName;
          }
        } catch (claudeError) {
          console.warn("Claude API fallback warning:", claudeError?.message || claudeError);
        }
      }
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

    const claudeKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;
    const prompt = `На основе кратких характеристик создай продающее описание недвижимости на русском и кыргызском языках. Верни в формате JSON {"ru": "...", "kg": "..."}. Характеристики: ${details}`;

    const preferredProvider = (
      process.env.AI_PROVIDER ||
      (claudeKey ? "claude" : "gemini")
    ).toLowerCase();

    const tryClaudeDescription = async () => {
      if (!claudeKey) return null;
      const model = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";
      const baseUrl = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1").replace(/\/+$/, "");
      const isChatCompletions =
        baseUrl.endsWith("/chat/completions") || baseUrl.includes("openrouter.ai/api/v1");
      const endpoint = isChatCompletions
        ? baseUrl.endsWith("/chat/completions")
          ? baseUrl
          : `${baseUrl}/chat/completions`
        : `${baseUrl}/messages`;

      const response = await fetch(endpoint, {
        method: "POST",
        headers: isChatCompletions
          ? { "Content-Type": "application/json", Authorization: `Bearer ${claudeKey}` }
          : { "Content-Type": "application/json", "x-api-key": claudeKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(
          isChatCompletions
            ? {
                model,
                messages: [
                  { role: "system", content: "Верни результат строго в формате JSON без markdown: {\"ru\": \"...\", \"kg\": \"...\"}" },
                  { role: "user", content: prompt },
                ],
                response_format: { type: "json_object" },
              }
            : {
                model,
                max_tokens: 1000,
                system: "Верни результат строго в формате JSON без markdown: {\"ru\": \"...\", \"kg\": \"...\"}",
                messages: [{ role: "user", content: prompt }],
              },
        ),
      });

      if (!response.ok) return null;
      const data = await response.json();
      const rawText = isChatCompletions
        ? data?.choices?.[0]?.message?.content
        : data?.content?.[0]?.text;
      return parseJsonFromText(rawText);
    };

    const tryGeminiDescription = async () => {
      if (!geminiKey) return null;
      const candidateModels = getCandidateModels();
      for (const model of candidateModels) {
        try {
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
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
          if (parsed && (parsed.ru || parsed.kg)) {
            return parsed;
          }
        } catch (err) {
          console.warn(`Gemini description error with ${model}:`, err?.message || err);
        }
      }
      return null;
    };

    let generated = null;
    if (preferredProvider === "claude" || preferredProvider === "anthropic") {
      generated = await tryClaudeDescription();
      if (!generated) generated = await tryGeminiDescription();
    } else {
      generated = await tryGeminiDescription();
      if (!generated) generated = await tryClaudeDescription();
    }

    if (generated && (generated.ru || generated.kg)) {
      return res.json({ success: true, generatedText: generated });
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
