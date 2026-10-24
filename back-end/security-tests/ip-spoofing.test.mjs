import test from "node:test";
import assert from "node:assert/strict";
import { BASE_URL, isTestDbConfigured, SKIP_NO_TEST_DB_REASON } from "./helpers.mjs";
import { getTrustedClientIp, applyTrustedForwardedFor } from "../../front-end/src/app/api/_lib/forwardedFor.js";

const TEST_PROXY_SECRET = "test-internal-proxy-secret-uytap-audit";

test("IP Spoofing Protection: Next.js proxy ignores cf-connecting-ip unless Cloudflare is explicitly enabled", () => {
  const fakeAttackerIp = "198.51.100.77";
  const realVercelIp = "203.0.113.50";

  // Убеждаемся, что переменная Cloudflare выключена
  delete process.env.ENABLE_CLOUDFLARE;
  delete process.env.BEHIND_CLOUDFLARE;

  const headers = new Map();
  headers.set("cf-connecting-ip", fakeAttackerIp);
  headers.set("x-vercel-forwarded-for", `${realVercelIp}, 10.0.0.1`);

  const mockRequest = {
    headers: {
      get: (name) => headers.get(name.toLowerCase()),
    },
  };

  const trustedIp = getTrustedClientIp(mockRequest);

  // Должен быть взят реальный IP от Vercel, а поддельный cf-connecting-ip должен быть проигнорирован
  assert.equal(
    trustedIp,
    realVercelIp,
    "Next.js proxy must ignore cf-connecting-ip and use x-vercel-forwarded-for when Cloudflare is disabled"
  );
});

test("IP Spoofing Protection: applyTrustedForwardedFor injects proxy secret header", () => {
  process.env.INTERNAL_PROXY_SECRET = TEST_PROXY_SECRET;

  const headers = new Headers();
  headers.set("x-forwarded-for", "1.2.3.4");

  const mockRequest = {
    headers: {
      get: (name) => (name.toLowerCase() === "x-vercel-forwarded-for" ? "203.0.113.88" : null),
    },
  };

  applyTrustedForwardedFor(headers, mockRequest);

  assert.equal(headers.get("x-forwarded-for"), "203.0.113.88");
  assert.equal(headers.get("x-internal-proxy-secret"), TEST_PROXY_SECRET);
});

test("IP Spoofing Protection: Express rejects direct X-Forwarded-For without valid proxy secret", { skip: !isTestDbConfigured ? SKIP_NO_TEST_DB_REASON : false }, async () => {
  // Злоумышленник шлёт прямой запрос к Express с поддельным X-Forwarded-For без секретного заголовка
  const spoofedIp = "198.51.100.99";

  const res = await fetch(`${BASE_URL}/api/health`, {
    headers: {
      "X-Forwarded-For": spoofedIp,
    },
  });

  assert.equal(res.status, 200);

  // Делаем несколько запросов с одного прямого сокета, меняя X-Forwarded-For.
  // Так как секрет не передан, Express должен считать запросы как поступающие с 127.0.0.1,
  // а не сменяющихся поддельных IP.
  // Соответственно, rate limiter на логине должен заблокировать атакующего по его реальному IP (127.0.0.1).
  let got429 = false;
  for (let i = 1; i <= 7; i++) {
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": `203.0.113.${i}`,
      },
      body: JSON.stringify({
        identifier: "test-spoof-target@uytap.local",
        password: "WrongPassword123!",
      }),
    });

    if (loginRes.status === 429) {
      got429 = true;
      break;
    }
  }

  assert.equal(
    got429,
    true,
    "Express must enforce rate limit on real socket IP when X-Forwarded-For is sent without proxy secret"
  );
});

test("IP Spoofing Protection: Express accepts forwarded IP when valid proxy secret is present", { skip: !isTestDbConfigured ? SKIP_NO_TEST_DB_REASON : false }, async () => {
  const forwardedClientIp = "203.0.113.77";

  const res = await fetch(`${BASE_URL}/api/health`, {
    headers: {
      "X-Forwarded-For": forwardedClientIp,
      "X-Internal-Proxy-Secret": TEST_PROXY_SECRET,
    },
  });

  assert.equal(res.status, 200);
});
