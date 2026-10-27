import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nikitaService } from "../src/services/nikitaService.js";
import { phoneOtpStore } from "../src/utils/phoneOtpStore.js";
import {
  checkAndIncrementRateLimit,
  releaseRateLimit,
  resetAllRateLimitCounters,
} from "../src/utils/sharedState.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PHONE = "+996 770 55 44 33";
const IP = "10.1.2.3";

function nikitaResponse(body) {
  return { ok: true, status: 200, text: async () => JSON.stringify(body) };
}

async function withNikita(fetchImpl, fn) {
  const origFetch = globalThis.fetch;
  const origKey = process.env.NIKITA_API_KEY;
  process.env.NIKITA_API_KEY = "dummy-test-key";
  phoneOtpStore.reset();
  resetAllRateLimitCounters();
  globalThis.fetch = fetchImpl;
  try {
    await fn();
  } finally {
    globalThis.fetch = origFetch;
    if (origKey === undefined) delete process.env.NIKITA_API_KEY;
    else process.env.NIKITA_API_KEY = origKey;
    phoneOtpStore.reset();
    resetAllRateLimitCounters();
  }
}

test("Nikita rollback: ошибка шлюза (status != 0) не вызывает фантомный кулдаун", async () => {
  let calls = 0;
  await withNikita(
    async () => {
      calls += 1;
      if (calls === 1) return nikitaResponse({ status: 4, description: "Not enough money" });
      return nikitaResponse({ status: 0, token: "tok_after_fail" });
    },
    async () => {
      const first = await nikitaService.sendOtp({ phone: PHONE, ip: IP });
      assert.equal(first.success, false);
      assert.equal(first.rateLimited, undefined);

      const second = await nikitaService.sendOtp({ phone: PHONE, ip: IP });
      assert.equal(second.success, true, "повторная отправка не должна блокироваться кулдауном");
      assert.equal(second.token, "tok_after_fail");
    }
  );
});

test("Nikita rollback: status 0 без токена откатывает резервирование", async () => {
  let calls = 0;
  await withNikita(
    async () => {
      calls += 1;
      if (calls === 1) return nikitaResponse({ status: 0 });
      return nikitaResponse({ status: 0, token: "tok_ok" });
    },
    async () => {
      const first = await nikitaService.sendOtp({ phone: PHONE, ip: IP });
      assert.equal(first.success, false);
      const second = await nikitaService.sendOtp({ phone: PHONE, ip: IP });
      assert.equal(second.success, true);
    }
  );
});

test("Nikita rollback: сетевая ошибка откатывает резервирование", async () => {
  let calls = 0;
  await withNikita(
    async () => {
      calls += 1;
      // Первая отправка: обе попытки (с повтором) падают
      if (calls <= 2) throw new Error("ECONNRESET");
      return nikitaResponse({ status: 0, token: "tok_recovered" });
    },
    async () => {
      const first = await nikitaService.sendOtp({ phone: PHONE, ip: IP });
      assert.equal(first.success, false);
      const second = await nikitaService.sendOtp({ phone: PHONE, ip: IP });
      assert.equal(second.success, true);
      assert.equal(second.token, "tok_recovered");
    }
  );
});

test("Nikita rollback: после УСПЕШНОЙ отправки кулдаун сохраняется", async () => {
  await withNikita(
    async () => nikitaResponse({ status: 0, token: "tok_1" }),
    async () => {
      const first = await nikitaService.sendOtp({ phone: PHONE, ip: IP });
      assert.equal(first.success, true);
      const second = await nikitaService.sendOtp({ phone: PHONE, ip: IP });
      assert.equal(second.success, false);
      assert.equal(second.rateLimited, true);
      assert.ok(second.retryAfter > 0);
    }
  );
});

test("Nikita rollback: неудачные отправки не расходуют часовую квоту номера", async () => {
  await withNikita(
    async () => nikitaResponse({ status: 4 }),
    async () => {
      // Больше, чем часовой лимит на номер: каждая неудача должна освобождать слот
      for (let i = 0; i < 12; i++) {
        const res = await nikitaService.sendOtp({ phone: PHONE, ip: IP });
        assert.equal(res.success, false);
        assert.notEqual(res.rateLimited, true, `попытка ${i + 1} не должна упираться в лимит`);
      }
    }
  );
});

test("releaseRateLimit: уменьшает счётчик, не уходит ниже 0", async () => {
  resetAllRateLimitCounters();
  const key = "test:release:key";
  await checkAndIncrementRateLimit(key, 60000, 5, 1);
  await checkAndIncrementRateLimit(key, 60000, 5, 1);
  await releaseRateLimit(key, 1);
  let state = await checkAndIncrementRateLimit(key, 60000, 5, 0);
  assert.equal(state.count, 1);
  await releaseRateLimit(key, 10);
  state = await checkAndIncrementRateLimit(key, 60000, 5, 0);
  assert.equal(state.count, 0);
  // Несуществующий ключ не падает
  await releaseRateLimit("test:release:missing", 1);
  resetAllRateLimitCounters();
});

test("Конкурентные неудачные отправки не оставляют зависших in-flight слотов", async () => {
  await withNikita(
    async () => nikitaResponse({ status: 4 }),
    async () => {
      const phones = Array.from({ length: 50 }, (_, i) => `+99677${String(100000 + i)}`);
      const results = await Promise.all(
        phones.map((phone, i) => nikitaService.sendOtp({ phone, ip: `10.9.0.${i}` }))
      );
      assert.ok(results.every((r) => r.success === false));
      assert.equal(phoneOtpStore.inFlightSends.size, 0);
    }
  );
});

// --- Контракты фронтенда (исходники) ---
const read = (rel) => fs.readFileSync(path.resolve(__dirname, rel), "utf8");

test("Frontend: verifyPhoneOtp передаёт token, resendPhoneOtp сохраняет его", () => {
  const api = read("../../front-end/src/utils/api.js");
  assert.match(api, /verifyPhoneOtp\(phone, code, token\)/);
  assert.match(api, /\.\.\.\(token \? \{ token \} : \{\}\)/);
  assert.match(api, /register_otp_token/);
  assert.match(api, /err\.retryAfter = data\.retryAfter/);
});

test("Frontend: формы регистрации сохраняют токен и переходят к вводу кода при кулдауне", () => {
  for (const name of [
    "personalForm/PersonalForm.jsx",
    "realtorForm/RealtorForm.jsx",
    "developerForm/DeveloperForm.jsx",
    "agency/Agency.jsx",
  ]) {
    const dir = path.resolve(__dirname, "../../front-end/src/app/register");
    const sub = fs.readdirSync(dir).find((d) => d.endsWith("omponents"));
    const src = fs.readFileSync(path.join(dir, sub, name), "utf8");
    assert.match(src, /register_otp_token/, `${name}: токен должен сохраняться`);
    assert.match(src, /err\?\.status === 429/, `${name}: 429 с retryAfter ведёт на ввод кода`);
  }
});

test("Frontend: forgot-страница не оставляет пользователя на шаге 1 при кулдауне", () => {
  const src = read("../../front-end/src/app/forgot/page.jsx");
  assert.match(src, /error\?\.status === 429/);
});

test("CI: новый тестовый файл подключён в npm test и test:coverage", () => {
  const pkg = JSON.parse(read("../package.json"));
  assert.ok(pkg.scripts.test.includes("security-tests/nikita-rollback.test.mjs"));
  assert.ok(pkg.scripts["test:coverage"].includes("security-tests/nikita-rollback.test.mjs"));
});
