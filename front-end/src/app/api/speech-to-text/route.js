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
const MAX_STT_MAP_SIZE = 5000;
export const sttRateLimitMap = new Map();

function checkSttRateLimit(ip) {
  const key = ip || "unknown";
  const now = Date.now();

  if (sttRateLimitMap.size > MAX_STT_MAP_SIZE) {
    for (const [k, timestamps] of sttRateLimitMap.entries()) {
      const valid = timestamps.filter((t) => now - t < STT_RATE_LIMIT_WINDOW_MS);
      if (valid.length === 0) sttRateLimitMap.delete(k);
      else sttRateLimitMap.set(k, valid);
    }
  }

  const history = (sttRateLimitMap.get(key) || []).filter(
    (t) => now - t < STT_RATE_LIMIT_WINDOW_MS
  );

  if (history.length >= STT_RATE_LIMIT_MAX) {
    const retryAfter = Math.max(
      1,
      Math.ceil((STT_RATE_LIMIT_WINDOW_MS - (now - history[0])) / 1000)
    );
    return { allowed: false, retryAfter };
  }

  history.push(now);
  sttRateLimitMap.set(key, history);
  return { allowed: true, retryAfter: 0 };
}

export async function POST(request) {
  try {
    // 1. Rate limit по доверенному IP клиента до чтения тела запроса
    const clientIp = getTrustedClientIp(request) || "unknown";
    const rateCheck = checkSttRateLimit(clientIp);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          success: false,
          message: "Слишком много запросов голосового поиска. Попробуйте через минуту.",
          retryAfter: rateCheck.retryAfter,
        },
        {
          status: 429,
          headers: { "Retry-After": String(rateCheck.retryAfter) },
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

    const upstream = await fetch(
      "https://api.elevenlabs.io/v1/speech-to-text",
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
        },
        body: form,
        signal: AbortSignal.timeout(60000),
      }
    );

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
          error?.name === "TimeoutError"
            ? "Распознавание заняло слишком много времени."
            : "Ошибка обработки аудиозаписи.",
      },
      { status: 500 }
    );
  }
}
