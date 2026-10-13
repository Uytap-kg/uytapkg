import test from "node:test";
import assert from "node:assert/strict";

import { dbPool, queryPool, setDbPool } from "../src/config/db.js";

test("Дефект 2.2: Экспорт dbPool и queryPool из config/db.js", () => {
  assert.equal(typeof queryPool, "function", "queryPool должен быть экспортирован как функция");
  assert.ok(
    dbPool === null || typeof dbPool === "object",
    "dbPool должен быть null при отсутствии DATABASE_URL или объектом Pool"
  );
});

test("Дефект 2.2: Graceful degradation — при dbPool === null queryPool выбрасывает информативную ошибку", async () => {
  const origPool = dbPool;
  setDbPool(null);

  try {
    await assert.rejects(
      async () => {
        await queryPool("SELECT 1");
      },
      /DATABASE_URL is not configured; dbPool is unavailable/,
      "queryPool должен выбрасывать понятную ошибку при отсутствии dbPool"
    );
  } finally {
    setDbPool(origPool);
  }
});

test("Дефект 2.2: queryPool делегирует выполнение запросов в dbPool.query(text, params)", async () => {
  const origPool = dbPool;
  let executedQuery = null;
  let executedParams = null;

  const mockPool = {
    query: async (text, params) => {
      executedQuery = text;
      executedParams = params;
      return { rows: [{ id: "test-row-1" }], rowCount: 1 };
    },
  };

  setDbPool(mockPool);

  try {
    const result = await queryPool("SELECT * FROM listings WHERE id = $1", ["test-id-123"]);
    assert.equal(executedQuery, "SELECT * FROM listings WHERE id = $1");
    assert.deepEqual(executedParams, ["test-id-123"]);
    assert.equal(result.rowCount, 1);
    assert.equal(result.rows[0].id, "test-row-1");
  } finally {
    setDbPool(origPool);
  }
});
