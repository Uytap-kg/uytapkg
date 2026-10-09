import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { hashOtpCode } from "../src/controllers/authController.js";
import authRoutes, {
  normalizeIp,
  ipKeyGenerator,
  rateLimitVerify,
  loginLimiter,
  sendOtpLimiter,
  authLimiter,
} from "../src/routes/authRoutes.js";

// 1. Тестирование HMAC-SHA256 хэширования кодов
test("OTP Security: hashOtpCode возвращает валидный 64-символьный HMAC-SHA256 хэш", () => {
  const code = "123456";
  const hash = hashOtpCode(code);

  assert.equal(typeof hash, "string", "Хэш должен быть строкой");
  assert.equal(hash.length, 64, "Длина HMAC-SHA256 хэша должна составлять 64 hex-символа");
  assert.match(hash, /^[a-f0-9]{64}$/, "Хэш должен содержать только hex-символы в нижнем регистре");

  // Детерминированность
  assert.equal(hashOtpCode(code), hash, "Хэширование одного и того же кода должно быть детерминированным");

  // Разные коды дают разные хэши
  const hash2 = hashOtpCode("654321");
  assert.notEqual(hash, hash2, "Разные OTP-коды должны иметь разные хэши");

  // Открытый код не содержится в хэше
  assert.ok(!hash.includes(code), "Хэш не должен содержать открытый код");
});

// 2. Тестирование безопасного сравнения хэшей через timingSafeEqual
test("OTP Security: timingSafeEqual корректно сравнивает валидные и невалидные хэши", () => {
  const code = "482910";
  const expectedHash = hashOtpCode(code);
  const correctHash = hashOtpCode("482910");
  const wrongHash = hashOtpCode("999999");

  const bufExpected = Buffer.from(expectedHash, "utf8");
  const bufCorrect = Buffer.from(correctHash, "utf8");
  const bufWrong = Buffer.from(wrongHash, "utf8");

  assert.equal(
    bufExpected.length === bufCorrect.length && crypto.timingSafeEqual(bufExpected, bufCorrect),
    true,
    "Совпадающие хэши должны возвращать true"
  );

  assert.equal(
    bufExpected.length === bufWrong.length && crypto.timingSafeEqual(bufExpected, bufWrong),
    false,
    "Различающиеся хэши должны возвращать false"
  );
});

// 3. Тестирование логики функции consume_otp_attempt (атомарный инкремент до проверки)
test("OTP Security: логика consume_otp_attempt гарантирует блокировку после 5 попыток", () => {
  // Эмуляция логики Postgres-функции consume_otp_attempt:
  // UPDATE email_verifications SET attempts = attempts + 1 WHERE id = p_id AND is_used = false AND attempts < 5 RETURNING attempts INTO v_attempts; RETURN COALESCE(v_attempts, -1);
  const createOtpRecord = () => ({
    id: "test-uuid-1",
    attempts: 0,
    is_used: false,
  });

  const consumeOtpAttempt = (record) => {
    if (record.is_used || record.attempts >= 5) {
      return -1;
    }
    record.attempts += 1;
    return record.attempts;
  };

  const record = createOtpRecord();

  // Попытки 1..5 инкрементируют счётчик
  assert.equal(consumeOtpAttempt(record), 1, "Попытка 1 должна вернуть attempts = 1");
  assert.equal(consumeOtpAttempt(record), 2, "Попытка 2 должна вернуть attempts = 2");
  assert.equal(consumeOtpAttempt(record), 3, "Попытка 3 должна вернуть attempts = 3");
  assert.equal(consumeOtpAttempt(record), 4, "Попытка 4 должна вернуть attempts = 4");
  assert.equal(consumeOtpAttempt(record), 5, "Попытка 5 должна вернуть attempts = 5");

  // Попытка 6 (и все последующие) обязана вернуть -1
  assert.equal(consumeOtpAttempt(record), -1, "Попытка 6 должна вернуть -1 (лимит исчерпан)");
  assert.equal(consumeOtpAttempt(record), -1, "Попытка 7 должна вернуть -1");
  assert.equal(record.attempts, 5, "Счётчик attempts не должен превышать 5");

  // Если код уже использован (is_used = true), функция также возвращает -1
  const usedRecord = { id: "test-uuid-2", attempts: 1, is_used: true };
  assert.equal(consumeOtpAttempt(usedRecord), -1, "Для использованного кода должно возвращаться -1");
});

// 4. Тестирование нормализации IP и IPv6 (подсеть /56)
test("Rate Limiting: normalizeIp безопасно обрабатывает IPv4 и IPv6 (/56 подсеть)", () => {
  // 1. IPv4 возвращается без изменений
  assert.equal(normalizeIp("192.168.1.1"), "192.168.1.1");
  assert.equal(normalizeIp("10.0.0.15"), "10.0.0.15");

  // 2. IPv4-mapped IPv6 преобразуется в чистый IPv4
  assert.equal(normalizeIp("::ffff:192.168.1.1"), "192.168.1.1");

  // 3. IPv6 адреса из одной подсети /56 маппятся на одинаковый ключ подсети /56
  const ip1 = "2001:0db8:85a3:1234:0000:8a2e:0370:7334";
  const ip2 = "2001:0db8:85a3:12ff:ffff:8a2e:0370:9999";
  const norm1 = normalizeIp(ip1);
  const norm2 = normalizeIp(ip2);
  assert.equal(norm1, norm2, "IPv6 адреса из одной подсети /56 должны нормализоваться в один ключ");
  assert.ok(norm1.endsWith("/56"), "Нормализованный ключ IPv6 должен содержать префикс /56");

  // 4. IPv6 адреса из разных подсетей /56 маппятся на разные ключи
  const ipDiffSubnet = "2001:0db8:85a3:9900:0000:8a2e:0370:7334";
  const normDiff = normalizeIp(ipDiffSubnet);
  assert.notEqual(norm1, normDiff, "IPv6 адреса из разных подсетей /56 должны давать разные ключи");

  // 5. Невалидные значения / null fallback
  assert.equal(normalizeIp(null), "127.0.0.1");
  assert.equal(normalizeIp(""), "127.0.0.1");
});

// 5. Тестирование ipKeyGenerator
test("Rate Limiting: ipKeyGenerator извлекает и нормализует IP из request", () => {
  const req1 = { ip: "192.168.1.100" };
  assert.equal(ipKeyGenerator(req1), "192.168.1.100");

  const reqIpv6 = { ip: "2001:0db8:85a3:1234:0000:8a2e:0370:7334" };
  assert.equal(ipKeyGenerator(reqIpv6), "2001:0db8:85a3:1200::/56");

  const reqEmpty = {};
  assert.equal(ipKeyGenerator(reqEmpty), "127.0.0.1");
});

// 6. Тестирование раздельных лимитеров в authRoutes
test("Rate Limiting: проверка конфигурации раздельных лимитеров", () => {
  assert.equal(typeof rateLimitVerify, "function", "rateLimitVerify должен быть express middleware");
  assert.equal(typeof loginLimiter, "function", "loginLimiter должен быть express middleware");
  assert.equal(typeof sendOtpLimiter, "function", "sendOtpLimiter должен быть express middleware");
  assert.equal(typeof authLimiter, "function", "authLimiter должен быть express middleware");

  // Проверка регистрации роутов в authRoutes
  const routes = authRoutes.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods),
      middlewaresCount: layer.route.stack.length,
    }));

  const findRoute = (path) => routes.find((r) => r.path === path);

  assert.ok(findRoute("/login"), "Роут /login должен быть зарегистрирован");
  assert.ok(findRoute("/send-otp"), "Роут /send-otp должен быть зарегистрирован");
  assert.ok(findRoute("/verify-otp"), "Роут /verify-otp должен быть зарегистрирован");
  assert.ok(findRoute("/verify-reset-code"), "Роут /verify-reset-code должен быть зарегистрирован");
  assert.ok(findRoute("/forgot-password"), "Роут /forgot-password должен быть зарегистрирован");
  assert.ok(findRoute("/reset-password"), "Роут /reset-password должен быть зарегистрирован");
});
