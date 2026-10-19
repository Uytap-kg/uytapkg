import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { success: false, message: "Не настроен API-ключ ElevenLabs" },
        { status: 500 },
      );
    }

    const incomingForm = await request.formData();
    const audio = incomingForm.get("audio");

    if (!audio || typeof audio === "string" || audio.size === 0) {
      return NextResponse.json(
        { success: false, message: "Аудиозапись не получена" },
        { status: 400 },
      );
    }

    // Ограничиваем размер файла для защиты сервера.
    if (audio.size > 20 * 1024 * 1024) {
      return NextResponse.json(
        { success: false, message: "Аудиозапись слишком большая" },
        { status: 413 },
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
      },
    );

    const data = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      console.error("ElevenLabs transcription error:", data);

      return NextResponse.json(
        {
          success: false,
          message: "Не удалось распознать речь. Попробуйте ещё раз.",
        },
        { status: 502 },
      );
    }

    const text = String(data?.text || "").trim();

    if (!text) {
      return NextResponse.json(
        {
          success: false,
          message: "Не удалось распознать слова. Попробуйте ещё раз.",
        },
        { status: 422 },
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
      { status: 500 },
    );
  }
}
