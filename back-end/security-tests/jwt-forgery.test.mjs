// ПРОВЕРКА подделки JWT токенов как ВНЕШНИЙ атакующий (без знания
// JWT_SECRET из .env — секрет нигде не читается и не печатается).
//
// Атакуемый код: back-end/src/middleware/auth.js (authenticateToken)
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  api,
  registerTestUser,
  deleteTestUser,
  isTestDbConfigured,
  SKIP_NO_TEST_DB_REASON,
} from "./helpers.mjs";

function base64url(input) {
  return Buffer.from(JSON.stringify(input))
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

test(
  "JWT alg=none forgery is rejected",
  { skip: !isTestDbConfigured ? SKIP_NO_TEST_DB_REASON : false },
  async () => {
    const { user } = await registerTestUser();
    try {
      const header = { alg: "none", typ: "JWT" };
      const payload = { id: user.id, accountType: user.accountType, email: user.email };
      // Токен "alg none" по спецификации не имеет подписи (третий сегмент пуст)
      const forged = `${base64url(header)}.${base64url(payload)}.`;

      const { status } = await api("/api/auth/me", { token: forged });
      assert.equal(status, 403, `expected alg=none token to be REJECTED (403), got ${status}`);
    } finally {
      await deleteTestUser(user.id);
    }
  }
);

test(
  "JWT with random/incorrect signature is rejected",
  { skip: !isTestDbConfigured ? SKIP_NO_TEST_DB_REASON : false },
  async () => {
    const { user } = await registerTestUser();
    try {
      const header = { alg: "HS256", typ: "JWT" };
      const payload = {
        id: user.id,
        accountType: user.accountType,
        email: user.email,
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const unsigned = `${base64url(header)}.${base64url(payload)}`;
      // Подпись случайным (заведомо неверным) ключом — как внешний атакующий,
      // не знающий JWT_SECRET сервера.
      const fakeSig = crypto
        .createHmac("sha256", "attacker-guessed-wrong-secret")
        .update(unsigned)
        .digest("base64")
        .replace(/=+$/, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
      const forged = `${unsigned}.${fakeSig}`;

      const { status } = await api("/api/auth/me", { token: forged });
      assert.equal(status, 403, `expected forged-signature token to be REJECTED (403), got ${status}`);
    } finally {
      await deleteTestUser(user.id);
    }
  }
);

test(
  "JWT payload tampering (role/id swap) with unchanged signature is rejected",
  { skip: !isTestDbConfigured ? SKIP_NO_TEST_DB_REASON : false },
  async () => {
    // Берём РЕАЛЬНЫЙ валидный токен обычного пользователя и пытаемся
    // подменить payload (например id на произвольный чужой UUID), оставив
    // оригинальную подпись как есть — это должно провалить проверку подписи.
    const { token, user } = await registerTestUser();
    try {
      const [headerB64, , sigB64] = token.split(".");
      const tamperedPayload = base64url({
        id: "00000000-0000-0000-0000-000000000000",
        accountType: "developer",
        email: "admin@fake.local",
      });
      const tampered = `${headerB64}.${tamperedPayload}.${sigB64}`;

      const { status } = await api("/api/auth/me", { token: tampered });
      assert.equal(status, 403, `expected tampered-payload token to be REJECTED (403), got ${status}`);
    } finally {
      await deleteTestUser(user.id);
    }
  }
);

test(
  "Missing Authorization header is rejected on protected routes",
  { skip: !isTestDbConfigured ? SKIP_NO_TEST_DB_REASON : false },
  async () => {
    const { status, body } = await api("/api/auth/me");
    assert.equal(status, 401);
    assert.equal(body.success, false);
  }
);

test(
  "Sanity: a genuinely valid token IS accepted (control case)",
  { skip: !isTestDbConfigured ? SKIP_NO_TEST_DB_REASON : false },
  async () => {
    const { token, user } = await registerTestUser();
    try {
      const { status, body } = await api("/api/auth/me", { token });
      assert.equal(status, 200);
      assert.equal(body.user.id, user.id);
    } finally {
      await deleteTestUser(user.id);
    }
  }
);
