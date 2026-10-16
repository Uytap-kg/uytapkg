import { NextResponse } from "next/server";
import { applyTrustedForwardedFor } from "../_lib/forwardedFor";

let rawBackendUrl = process.env.BACKEND_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";
rawBackendUrl = rawBackendUrl.replace(/\/$/, "");
if (!rawBackendUrl.endsWith("/api") && !rawBackendUrl.includes("localhost")) {
  rawBackendUrl = `${rawBackendUrl}/api`;
}
const BACKEND_API_URL = rawBackendUrl;

async function proxyRequest(request, context) {
  try {
    const { params } = context;
    const resolvedParams = await params;
    const segments = Array.isArray(resolvedParams?.path) ? resolvedParams.path : [];
    const path = segments.join("/");
    
    // Build query string
    const url = new URL(request.url);
    const searchParams = url.search;
    
    const targetUrl = `${BACKEND_API_URL}/${path}${searchParams}`;

    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("content-length");

    // Защита от подмены X-Forwarded-For (бэкенд работает с `trust proxy: 1`
    // и считает rate-limit по этому IP) — см. _lib/forwardedFor.js.
    applyTrustedForwardedFor(headers, request);

    const init = {
      method: request.method,
      headers,
    };

    if (!["GET", "HEAD"].includes(request.method)) {
      init.body = request.body;
      init.duplex = "half";
    }

    const upstream = await fetch(targetUrl, init);
    const text = await upstream.text();

    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }

    return NextResponse.json(data, {
      status: upstream.status,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    console.error("Catch-all proxy error:", error);
    return NextResponse.json(
      { success: false, message: "Ошибка проксирования API" },
      { status: 502 },
    );
  }
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const DELETE = proxyRequest;
export const PATCH = proxyRequest;
export const OPTIONS = proxyRequest;
