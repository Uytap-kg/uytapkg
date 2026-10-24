const backendUrl =
  process.env.BACKEND_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:5000/api";

const normalizedBackendUrl = backendUrl.replace(/\/$/, "");
const targetApiUrl = normalizedBackendUrl.endsWith("/api")
  ? normalizedBackendUrl
  : `${normalizedBackendUrl}/api`;

/**
 * Динамическое извлечение remotePattern для Supabase Storage:
 * Поддерживает кастомный hostname (NEXT_PUBLIC_SUPABASE_HOSTNAME)
 * либо парсинг URL (NEXT_PUBLIC_SUPABASE_URL).
 * Безопасно игнорирует отсутствие переменных, чтобы сборка не падала.
 */
function getSupabaseRemotePattern() {
  const customHostname = process.env.SUPABASE_HOSTNAME || process.env.NEXT_PUBLIC_SUPABASE_HOSTNAME;
  if (customHostname) {
    const pattern = {
      protocol: (process.env.SUPABASE_PROTOCOL || process.env.NEXT_PUBLIC_SUPABASE_PROTOCOL || "https").replace(":", ""),
      hostname: customHostname,
    };
    if (process.env.SUPABASE_PORT || process.env.NEXT_PUBLIC_SUPABASE_PORT) {
      pattern.port = process.env.SUPABASE_PORT || process.env.NEXT_PUBLIC_SUPABASE_PORT;
    }
    return pattern;
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (supabaseUrl) {
    try {
      const parsed = new URL(supabaseUrl);
      const pattern = {
        protocol: parsed.protocol.replace(":", "") || "https",
        hostname: parsed.hostname,
      };
      if (parsed.port) {
        pattern.port = parsed.port;
      }
      return pattern;
    } catch {
      // Игнорируем невалидный URL при сборке без env
    }
  }

  return null;
}

const supabasePattern = getSupabaseRemotePattern();

/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${targetApiUrl}/:path*`,
      },
    ];
  },
  images: {
    // Список конкретных хостов вместо "**" — next/image проксирует
    // и скачивает изображения на сервере, поэтому разрешение любого
    // хоста ("**") открывает SSRF через оптимизатор изображений, если
    // где-то в данных окажется ссылка на внутренний адрес. Хосты ниже —
    // наше собственное Storage и жёстко закодированные заглушки-плейсхолдеры,
    // используемые в коде (см. mapListingData.js, mapComplexData.js и т.д.).
    remotePatterns: [
      ...(supabasePattern ? [supabasePattern] : []),
      {
        protocol: "https",
        hostname: "kakiuqgjhcunyaxydopx.supabase.co",
      },
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "i.pravatar.cc",
      },
      {
        protocol: "https",
        hostname: "storage.googleapis.com",
      },
    ],
  },
};

export default nextConfig;
