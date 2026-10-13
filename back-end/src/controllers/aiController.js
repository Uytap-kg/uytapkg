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

const buildSearchPrompt = (prompt) => {
  return `Проанализируй текст запроса пользователя и верни только JSON, без пояснений и без markdown. Ответ должен иметь формат:\n{\n  "country": "Турция" или "Кыргызстан" или null,\n  "region": "Бишкек" или "Иссык-Кульская область" или "Турция" или null,\n  "city": "Аланья" или "Анталия" или "Стамбул" или "Ош" или "Бишкек" или null,\n  "district": "название района или улицы" или null,\n  "propertyType": "apartment" | "house" | "land" | "commercial" | "garage" | null,\n  "dealType": "sale" | "rent" | null,\n  "rooms": число или null,\n  "maxPrice": число или null,\n  "currency": "KGS" | "USD" | null\n}\nТекст запроса: "${prompt}"`;
};

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

const callGemini = async (prompt) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
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
      }),
    },
  );

  const data = await response.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || data?.output?.[0]?.content?.[0]?.text;
  return parseJsonFromText(rawText);
};

const fallbackParse = (prompt) => {
  const lower = prompt.toLowerCase();
  const isTurkey = lower.includes("турци") || lower.includes("turkey") || lower.includes("алань") || lower.includes("антал") || lower.includes("стамбул") || lower.includes("мерсин") || lower.includes("измир");
  const isIssykKul = lower.includes("иссык") || lower.includes("чолпон") || lower.includes("бостери") || lower.includes("каракол");
  const isOsh = lower.includes("ош");

  let region = "Бишкек";
  let country = "Кыргызстан";
  let city = null;

  if (isTurkey) {
    country = "Турция";
    region = "Турция";
    city = lower.includes("алань") ? "Аланья" : lower.includes("антал") ? "Анталия" : lower.includes("стамбул") ? "Стамбул" : lower.includes("мерсин") ? "Мерсин" : "Турция";
  } else if (isIssykKul) {
    region = "Иссык-Кульская область";
    city = "Иссык-Куль";
  } else if (isOsh) {
    region = "Ошская область";
    city = "Ош";
  }

  return {
    country,
    region,
    city,
    district: lower.includes("акунк") ? "Ахунбаева" : lower.includes("центр") ? "Центр" : null,
    propertyType: lower.includes("дом") ? "house" : lower.includes("участок") ? "land" : lower.includes("коммерц") ? "commercial" : lower.includes("гараж") ? "garage" : lower.includes("комната") ? "room" : "apartment",
    dealType: lower.includes("аренд") || lower.includes("снять") ? "rent" : lower.includes("куп") || lower.includes("прод") ? "sale" : null,
    rooms: lower.includes("двушк") || lower.includes("2") ? 2 : lower.includes("трешк") || lower.includes("3") ? 3 : null,
    maxPrice: lower.match(/(\d+[\s]?0000|\d+[\s]?000|\d+)/g)
      ? Number((lower.match(/(\d+[\s]?0000|\d+[\s]?000|\d+)/g) || [])[0].replace(/\s/g, ""))
      : null,
    currency: lower.includes("$") || lower.includes("доллар") || isTurkey ? "USD" : "KGS",
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
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
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
            }),
          }
        );

        const data = await response.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || data?.output?.[0]?.content?.[0]?.text;
        const parsed = parseJsonFromText(rawText);
        if (parsed) {
          return res.json({ success: true, generatedText: parsed });
        }
      } catch (err) {
        console.warn("Gemini description error:", err?.message || err);
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
