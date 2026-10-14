import { NextResponse } from "next/server";

let rawBackendUrl = process.env.BACKEND_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";
rawBackendUrl = rawBackendUrl.replace(/\/$/, "");
if (!rawBackendUrl.endsWith("/api") && !rawBackendUrl.includes("localhost")) {
  rawBackendUrl = `${rawBackendUrl}/api`;
}
const BACKEND_API_URL = rawBackendUrl;

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

    const upstream = await fetch(`${BACKEND_API_URL}/ai/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
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
