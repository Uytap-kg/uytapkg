import test from "node:test";
import assert from "node:assert/strict";
import { aiSearch } from "../src/controllers/aiController.js";

// Mock helper for Express req/res
function createMockReqRes(body = {}) {
  const req = { body };
  let statusCode = 200;
  let jsonResponse = null;

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      jsonResponse = data;
      return this;
    },
    getStatusCode() {
      return statusCode;
    },
    getResponse() {
      return jsonResponse;
    },
  };

  return { req, res };
}

test("AI Search: возвращает 400 при пустом запросе", async () => {
  const { req, res } = createMockReqRes({ prompt: "   " });
  await aiSearch(req, res);

  assert.equal(res.getStatusCode(), 400);
  assert.equal(res.getResponse()?.success, false);
});

test("AI Search: возвращает 400 при превышении максимальной длины запроса (>300)", async () => {
  const longPrompt = "а".repeat(301);
  const { req, res } = createMockReqRes({ prompt: longPrompt });
  await aiSearch(req, res);

  assert.equal(res.getStatusCode(), 400);
  assert.equal(res.getResponse()?.success, false);
});

test("AI Search: корректно определяет 2-комнатную квартиру и цену 50000 (без бага maxPrice = 2)", async () => {
  const { req, res } = createMockReqRes({
    prompt: "2 комнатная квартира за 50000",
  });
  await aiSearch(req, res);

  assert.equal(res.getStatusCode(), 200);
  const resp = res.getResponse();
  assert.equal(resp?.success, true);
  assert.equal(resp?.filters?.rooms, 2);
  assert.equal(resp?.filters?.maxPrice, 50000);
  assert.notEqual(resp?.filters?.maxPrice, 2, "maxPrice не должен быть равен номеру комнаты!");
});

test("AI Search: запрос на кыргызском языке (батир, ижара, сом)", async () => {
  const { req, res } = createMockReqRes({
    prompt: "Бишкекте 3 бөлмөлүү батир ижарага 40000 сом",
  });
  await aiSearch(req, res);

  assert.equal(res.getStatusCode(), 200);
  const resp = res.getResponse();
  assert.equal(resp?.success, true);
  assert.equal(resp?.filters?.propertyType, "apartment");
  assert.equal(resp?.filters?.dealType, "rent");
  assert.equal(resp?.filters?.rooms, 3);
  assert.equal(resp?.filters?.currency, "KGS");
  assert.equal(resp?.filters?.maxPrice, 40000);
});

test("AI Search: распознавание локации Турции и валюты USD", async () => {
  const { req, res } = createMockReqRes({
    prompt: "Купить квартиру в Аланье за 75000$",
  });
  await aiSearch(req, res);

  assert.equal(res.getStatusCode(), 200);
  const resp = res.getResponse();
  assert.equal(resp?.success, true);
  assert.equal(resp?.filters?.propertyType, "apartment");
  assert.equal(resp?.filters?.dealType, "sale");
  assert.equal(resp?.filters?.country?.toLowerCase(), "turkey");
  assert.equal(resp?.filters?.currency, "USD");
  assert.equal(resp?.filters?.maxPrice, 75000);
});
