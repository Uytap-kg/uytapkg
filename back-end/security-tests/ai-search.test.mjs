import test from "node:test";
import assert from "node:assert/strict";
import { aiSearch } from "../src/controllers/aiController.js";

// Для юнит-тестов отключаем внешние сетевые запросы к Gemini API
process.env.GEMINI_API_KEY = "";

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

test("AI Search: стулия в бишкеке от 20 000 долларов до 80000 2 комнатный (опечатка, диапазон цен, валюта, комнаты, searchQuery)", async () => {
  const { req, res } = createMockReqRes({
    prompt: "стулия в бишкеке от 20 000 долларов до 80000 2 комнатный",
  });
  await aiSearch(req, res);

  assert.equal(res.getStatusCode(), 200);
  const resp = res.getResponse();
  assert.equal(resp?.success, true);
  assert.equal(resp?.filters?.propertyType, "apartment");
  assert.equal(resp?.filters?.city, "Бишкек");
  assert.equal(resp?.filters?.rooms, 2);
  assert.equal(resp?.filters?.minPrice, 20000);
  assert.equal(resp?.filters?.maxPrice, 80000);
  assert.equal(resp?.filters?.currency, "USD");
  assert.equal(resp?.filters?.searchQuery, "студия");
});

test("AI Search: жер уй 110 квадрат южный миркорайон (кыргызча дом, площадь, канонический район с опечаткой)", async () => {
  const { req, res } = createMockReqRes({
    prompt: "жер уй 110 квадрат южный миркорайон",
  });
  await aiSearch(req, res);

  assert.equal(res.getStatusCode(), 200);
  const resp = res.getResponse();
  assert.equal(resp?.success, true);
  assert.equal(resp?.filters?.propertyType, "house");
  assert.equal(resp?.filters?.city, "Бишкек");
  assert.equal(resp?.filters?.district, "Южные микрорайоны");
  assert.ok(resp?.filters?.minArea > 0, "minArea должен быть вычислен");
  assert.ok(resp?.filters?.maxArea > 0, "maxArea должен быть вычислен");
});

test("AI Search: студия в бишкеке (извлечение searchQuery и города)", async () => {
  const { req, res } = createMockReqRes({
    prompt: "студия в бишкеке",
  });
  await aiSearch(req, res);

  assert.equal(res.getStatusCode(), 200);
  const resp = res.getResponse();
  assert.equal(resp?.success, true);
  assert.equal(resp?.filters?.propertyType, "apartment");
  assert.equal(resp?.filters?.city, "Бишкек");
  assert.equal(resp?.filters?.searchQuery, "студия");
});

test("AI Search: объявление в бишкеке в центральном районе (канонизация района)", async () => {
  const { req, res } = createMockReqRes({
    prompt: "объявление в бишкеке в центральном районе",
  });
  await aiSearch(req, res);

  assert.equal(res.getStatusCode(), 200);
  const resp = res.getResponse();
  assert.equal(resp?.success, true);
  assert.equal(resp?.filters?.city, "Бишкек");
  assert.equal(resp?.filters?.district, "Центр");
});
