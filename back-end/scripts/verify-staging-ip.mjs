#!/usr/bin/env node
/**
 * Скрипт проверки изоляции IP-адресов и защиты от подмены заголовков на Staging.
 *
 * Проверяемые сценарии:
 * 1. Защита от подмены (Spoofing Immunity): прямой клиент шлёт заголовок X-Forwarded-For.
 *    Бэкенд игнорирует заголовок и ведёт учёт по реальному socket IP.
 * 2. Невалидный секрет прокси: запрос с некорректным X-Internal-Proxy-Secret игнорируется.
 * 3. Изоляция разных устройств через доверенный прокси (Device A vs Device B):
 *    запросы от разных клиентов получают изолированные квоты rate limit.
 *
 * Использование:
 *   node scripts/verify-staging-ip.mjs [STAGING_API_URL] [INTERNAL_PROXY_SECRET]
 *   Пример:
 *   node scripts/verify-staging-ip.mjs https://staging-api.uytap.kg my-super-secret-key-32chars
 */

import http from "node:http";
import https from "node:https";

const targetUrl = process.argv[2] || process.env.STAGING_URL || "http://127.0.0.1:5000";
const proxySecret = process.argv[3] || process.env.INTERNAL_PROXY_SECRET || "test-internal-proxy-secret-uytap-audit";

console.log("===============================================================");
console.log(" STAGING IP ISOLATION & ANTI-SPOOFING VERIFICATION SCRIPT");
console.log(" Target URL:   ", targetUrl);
console.log(" Proxy Secret: ", proxySecret ? "[CONFIGURED (length=" + proxySecret.length + ")]" : "[MISSING]");
console.log("===============================================================\n");

async function request(path, headers = {}) {
  const url = new URL(path, targetUrl);
  const isHttps = url.protocol === "https:";
  const client = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...headers,
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          let parsed;
          try {
            parsed = JSON.parse(body);
          } catch {
            parsed = body;
          }
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: parsed,
          });
        });
      }
    );

    req.on("error", reject);
    req.end();
  });
}

async function run() {
  let passed = 0;
  let failed = 0;

  // 1. Проверка доступности
  console.log("1. Проверка доступности API (health check)...");
  try {
    const health = await request("/api/health");
    if (health.statusCode === 200) {
      console.log("   [OK] API доступен, статус:", health.statusCode);
      passed++;
    } else {
      console.error("   [FAIL] Ошибка доступности API:", health.statusCode);
      failed++;
    }
  } catch (err) {
    console.error("   [FAIL] Не удалось подключиться к целевому серверу:", err.message);
    process.exit(1);
  }

  // 2. Проверка игнорирования поддельного X-Forwarded-For от прямого клиента
  console.log("\n2. Проверка защиты от IP Spoofing (прямой запрос с поддельным X-Forwarded-For)...");
  const spoofedIp1 = "198.51.100.101";
  const spoofedIp2 = "198.51.100.102";

  const resDirect1 = await request("/api/constants", {
    "X-Forwarded-For": spoofedIp1,
  });
  const rem1 = Number(resDirect1.headers["ratelimit-remaining"]);

  const resDirect2 = await request("/api/constants", {
    "X-Forwarded-For": spoofedIp2,
  });
  const rem2 = Number(resDirect2.headers["ratelimit-remaining"]);

  // Если X-Forwarded-For игнорируется, оба запроса с одного сокета попадают в одну корзину:
  // rem2 должен быть строго меньше rem1 (на 1), так как счетчик уменьшается по реальному сокет-IP.
  if (Number.isFinite(rem1) && Number.isFinite(rem2) && rem2 < rem1) {
    console.log(`   [OK] Заголовок клиента успешно проигнорирован. Счётчик сокета: ${rem1} -> ${rem2}`);
    passed++;
  } else {
    console.error(`   [FAIL] Поддельный IP не был проигнорирован! rem1=${rem1}, rem2=${rem2}`);
    failed++;
  }

  // 3. Проверка отклонения недоверенного секрета
  console.log("\n3. Проверка отклонения запроса с неверным секретом прокси...");
  const resBadSecret = await request("/api/constants", {
    "X-Forwarded-For": "203.0.113.55",
    "X-Internal-Proxy-Secret": "invalid-attacker-secret-xyz",
  });
  const remBad = Number(resBadSecret.headers["ratelimit-remaining"]);
  if (Number.isFinite(remBad) && remBad < rem2) {
    console.log(`   [OK] Неверный секрет отклонён, запрос привязан к сокету (остаток: ${remBad})`);
    passed++;
  } else {
    console.error(`   [FAIL] Неверный секрет не был корректно отклонён. remBad=${remBad}`);
    failed++;
  }

  // 4. Проверка изоляции двух разных устройств через доверенный прокси (Device A vs Device B)
  console.log("\n4. Проверка изоляции устройств через доверенный прокси (Device A vs Device B)...");
  const deviceAIp = `192.0.2.${Math.floor(Math.random() * 200) + 10}`;
  const deviceBIp = `198.51.100.${Math.floor(Math.random() * 200) + 10}`;

  // Device A делает 2 запроса через доверенный прокси
  const devA1 = await request("/api/constants", {
    "X-Forwarded-For": deviceAIp,
    "X-Internal-Proxy-Secret": proxySecret,
  });
  const devA2 = await request("/api/constants", {
    "X-Forwarded-For": deviceAIp,
    "X-Internal-Proxy-Secret": proxySecret,
  });
  const remA1 = Number(devA1.headers["ratelimit-remaining"]);
  const remA2 = Number(devA2.headers["ratelimit-remaining"]);

  // Device B делает 1-й запрос через доверенный прокси
  const devB1 = await request("/api/constants", {
    "X-Forwarded-For": deviceBIp,
    "X-Internal-Proxy-Secret": proxySecret,
  });
  const remB1 = Number(devB1.headers["ratelimit-remaining"]);

  // Device B должен иметь полную свежую квоту (remB1 > remA2), не зависящую от Device A
  if (remA2 === remA1 - 1 && remB1 > remA2) {
    console.log(`   [OK] Устройства изолированы! Device A: ${remA1}->${remA2}, Device B (свежий): ${remB1}`);
    passed++;
  } else {
    console.error(`   [FAIL] Ошибка изоляции устройств: remA1=${remA1}, remA2=${remA2}, remB1=${remB1}`);
    failed++;
  }

  console.log("\n===============================================================");
  console.log(` РЕЗУЛЬТАТ: Пройдено проверок: ${passed}/4, Ошибок: ${failed}`);
  if (failed === 0) {
    console.log(" СТАТУС: ЗАЩИТА IP И ИЗОЛЯЦИЯ УСТРОЙСТВ ПОЛНОСТЬЮ ПОДТВЕРЖДЕНЫ.");
  } else {
    console.log(" СТАТУС: ОБНАРУЖЕНЫ ПРОБЛЕМЫ БЕЗОПАСНОСТИ!");
    process.exit(1);
  }
  console.log("===============================================================");
}

run().catch((err) => {
  console.error("Непредвиденная ошибка запуска проверки:", err);
  process.exit(1);
});
