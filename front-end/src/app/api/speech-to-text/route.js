import { NextResponse } from "next/server";
import { getTrustedClientIp } from "../_lib/forwardedFor.js";

export const runtime = "nodejs";

// Лимит размера голосовой записи: 2.5 МБ (достаточно для 1-2 минут голосового поиска в webm/opus)
export const MAX_AUDIO_SIZE_BYTES = Math.floor(2.5 * 1024 * 1024);
// Допуск на заголовки multipart/form-data при предварительной проверке Content-Length
const MAX_CONTENT_LENGTH_BYTES = MAX_AUDIO_SIZE_BYTES + 64 * 1024;

// Rate limit: не более 5 запросов в минуту с одного IP для защиты баланса ElevenLabs
export const STT_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const STT_RATE_LIMIT_MAX = 5;
export const STT_DAILY_IP_LIMIT = Number(process.env.STT_DAILY_IP_LIMIT) || 50;
export const STT_DAILY_GLOBAL_LIMIT = Number(process.env.STT_DAILY_GLOBAL_LIMIT) || 500;
export const STT_TIMEOUT_MS = 20000;
export const MAX_CONCURRENT_STT = 5;
export const MAX_STT_MAP_SIZE = 5000;
export const sttRateLimitMap = new Map();

const DAY_MS = 24 * 60 * 60 * 1000;
let activeSttRequests = 0;
let globalDailyWindowStart = Date.now();
let globalDailyCount = 0;

function checkSttRateLimit(ip) {
  const key = ip || "unknown";
  const now = Date.now();

  if (now - globalDailyWindowStart >= DAY_MS) {
    globalDailyWindowStart = now;
    globalDailyCount = 0;
  }

  if (globalDailyCount >= STT_DAILY_GLOBAL_LIMIT) {
    return {
      allowed: false,
      retryAfter: 60,
      message: "Голосовой поиск временно недоступен (исчерпан суточный лимит). Используйте текстовый поиск.",
    };
  }

  if (sttRateLimitMap.size >= MAX_STT_MAP_SIZE && !sttRateLimitMap.has(key)) {
    for (const [k, timestamps] of sttRateLimitMap.entries()) {
      const valid = Array.isArray(timestamps)
        ? timestamps.filter((t) => now - t < DAY_MS)
        : [];
      if (valid.length === 0) sttRateLimitMap.delete(k);
      else sttRateLimitMap.set(k, valid);
    }
    while (sttRateLimitMap.size >= MAX_STT_MAP_SIZE) {
      const oldestKey = sttRateLimitMap.keys().next().value;
      if (oldestKey === undefined) break;
      sttRateLimitMap.delete(oldestKey);
    }
  }

  const dailyHistory = (sttRateLimitMap.get(key) || []).filter(
    (t) => now - t < DAY_MS
  );
  if (dailyHistory.length >= STT_DAILY_IP_LIMIT) {
    return {
      allowed: false,
      retryAfter: 3600,
      message: "Превышен суточный лимит голосового поиска. Попробуйте завтра.",
    };
  }

  const minuteHistory = dailyHistory.filter(
    (t) => now - t < STT_RATE_LIMIT_WINDOW_MS
  );

  if (minuteHistory.length >= STT_RATE_LIMIT_MAX) {
    const retryAfter = Math.max(
      1,
      Math.ceil((STT_RATE_LIMIT_WINDOW_MS - (now - minuteHistory[0])) / 1000)
    );
    return {
      allowed: false,
      retryAfter,
      message: "Слишком много запросов голосового поиска. Попробуйте через минуту.",
    };
  }

  dailyHistory.push(now);
  globalDailyCount += 1;
  if (sttRateLimitMap.has(key)) {
    sttRateLimitMap.delete(key);
  }
  sttRateLimitMap.set(key, dailyHistory);
  return { allowed: true, retryAfter: 0 };
}

export async function POST(request) {
  try {
    // 1. Rate limit по доверенному IP клиента + суточный потолок до чтения тела запроса
    const clientIp = getTrustedClientIp(request) || "unknown";
    const rateCheck = checkSttRateLimit(clientIp);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          success: false,
          message: rateCheck.message || "Слишком много запросов голосового поиска. Попробуйте через минуту.",
          retryAfter: rateCheck.retryAfter,
        },
        {
          status: 429,
          headers: { "Retry-After": String(rateCheck.retryAfter) },
        }
      );
    }

    // 1b. Ограничение параллельных обращений к ElevenLabs
    if (activeSttRequests >= MAX_CONCURRENT_STT) {
      return NextResponse.json(
        {
          success: false,
          message: "Сервис распознавания речи сейчас занят. Попробуйте через несколько секунд.",
          retryAfter: 5,
        },
        {
          status: 429,
          headers: { "Retry-After": "5" },
        }
      );
    }

    // 2. Проверка Content-Length ДО чтения тела в память (защита от OOM / больших файлов)
    const contentLengthHeader = request.headers?.get?.("content-length");
    if (contentLengthHeader) {
      const contentLength = Number(contentLengthHeader);
      if (Number.isFinite(contentLength) && contentLength > MAX_CONTENT_LENGTH_BYTES) {
        return NextResponse.json(
          { success: false, message: "Аудиозапись слишком большая (максимум 2.5 МБ)" },
          { status: 413 }
        );
      }
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { success: false, message: "Не настроен API-ключ ElevenLabs" },
        { status: 500 }
      );
    }

    const incomingForm = await request.formData();
    const audio = incomingForm.get("audio");

    if (!audio || typeof audio === "string" || audio.size === 0) {
      return NextResponse.json(
        { success: false, message: "Аудиозапись не получена" },
        { status: 400 }
      );
    }

    // 3. Проверка фактического размера аудиофайла (не более 2.5 МБ)
    if (audio.size > MAX_AUDIO_SIZE_BYTES) {
      return NextResponse.json(
        { success: false, message: "Аудиозапись слишком большая (максимум 2.5 МБ)" },
        { status: 413 }
      );
    }

    const incomingLanguage = incomingForm.get("language");
    const languageCode = incomingLanguage === "rus" ? "rus" : "kir";

    const form = new FormData();

    form.append("file", audio, audio.name || "speech.webm");
    form.append("model_id", "scribe_v2");
    form.append("language_code", languageCode);

    activeSttRequests += 1;
    let upstream;
    try {
      upstream = await fetch(
        "https://api.elevenlabs.io/v1/speech-to-text",
        {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
          },
          body: form,
          signal: AbortSignal.timeout(STT_TIMEOUT_MS),
        }
      );
    } finally {
      activeSttRequests = Math.max(0, activeSttRequests - 1);
    }

    const data = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      console.error("ElevenLabs transcription error:", data);

      return NextResponse.json(
        {
          success: false,
          message: "Не удалось распознать речь. Попробуйте ещё раз.",
        },
        { status: 502 }
      );
    }

    const text = String(data?.text || "").trim();

    if (!text) {
      return NextResponse.json(
        {
          success: false,
          message: "Не удалось распознать слова. Попробуйте ещё раз.",
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      success: true,
      text,
      languageCode: data.language_code || "kir",
    });
  } catch (error) {
    console.error("Speech-to-text error:", error);

    return NextResponse.json(
      {
        success: false,
        message:
          error?.name === "TimeoutError" || error?.name === "AbortError"
            ? "Распознавание заняло слишком много времени."
            : "Ошибка обработки аудиозаписи.",
      },
      { status: 500 }
    );
  }
}
