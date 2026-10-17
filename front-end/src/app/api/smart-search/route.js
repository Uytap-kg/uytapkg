import { NextResponse } from "next/server";
import { applyTrustedForwardedFor, getBackendApiUrl } from "../_lib/forwardedFor";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const prompt = typeof body?.query === "string" ? body.query : typeof body?.prompt === "string" ? body.prompt : "";

    if (!prompt.trim()) {
      return NextResponse.json(
        { success: false, message: "Введите текстовый запрос" },
        { status: 400 },
      );
    }

    const headers = new Headers({ "Content-Type": "application/json" });
    applyTrustedForwardedFor(headers, request);

    const upstream = await fetch(`${getBackendApiUrl()}/ai/search`, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt }),
      signal: AbortSignal.timeout(15000),
    });

    const data = await upstream.json().catch(() => ({}));

    return NextResponse.json(data, { status: upstream.status });
  } catch (error) {
    console.error("Smart search proxy error:", error);
    return NextResponse.json(
      { success: false, message: "Не удалось обработать AI-запрос" },
      { status: 502 },
    );
  }
}
