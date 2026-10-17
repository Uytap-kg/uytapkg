import "dotenv/config";
import fs from "node:fs";
import { FILTER_KEYS } from "../src/ai/smartSearch.schema.js";
import { emptySmartSearchFilters } from "../src/ai/smartSearch.normalize.js";
import { executeAiSearch, clearSearchCache } from "../src/controllers/aiController.js";

const EXAMPLES_URL = new URL("../src/ai/smartSearch.examples.json", import.meta.url);
const HOLDOUT_URL = new URL("../src/ai/smartSearch.holdout.json", import.meta.url);

function loadJson(url) {
  return JSON.parse(fs.readFileSync(url, "utf8"));
}

function compareField(field, actual, expected) {
  const a = actual ?? null;
  const e = expected ?? null;
  if (a === null && e === null) return true;
  if (a === null || e === null) return false;

  if (field === "city" || field === "district" || field === "searchQuery") {
    return String(a).trim().toLowerCase() === String(e).trim().toLowerCase();
  }
  // Для чисел допуск = 0, для остальных полей строгое равенство
  return a === e;
}

function evaluateRecord(item, actualFilters, source, degraded, latencyMs) {
  const fullExpected = { ...emptySmartSearchFilters(), ...(item.expected || {}) };
  const diffs = [];

  for (const key of FILTER_KEYS) {
    if (!compareField(key, actualFilters[key], fullExpected[key])) {
      diffs.push({
        field: key,
        expected: fullExpected[key],
        actual: actualFilters[key] ?? null,
      });
    }
  }

  // Проверка симптомного бага: число площади утекло в цену при отсутствии цены в expected
  const areaLeakedToPrice =
    fullExpected.minPrice === null &&
    fullExpected.maxPrice === null &&
    (fullExpected.minArea !== null || fullExpected.maxArea !== null) &&
    (actualFilters.minPrice !== null || actualFilters.maxPrice !== null);

  return {
    query: item.query,
    scenario: item.scenario || null,
    exactMatch: diffs.length === 0,
    diffs,
    areaLeakedToPrice,
    source,
    degraded,
    latencyMs,
  };
}

async function runDataset(name, items, concurrency = 2) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      const item = items[idx];
      clearSearchCache();
      const t0 = Date.now();
      const { filters, source, degraded } = await executeAiSearch(item.query);
      const latencyMs = Date.now() - t0;
      results[idx] = evaluateRecord(item, filters, source, degraded, latencyMs);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));

  const total = results.length;
  const exactMatches = results.filter((r) => r.exactMatch).length;
  const areaLeakCount = results.filter((r) => r.areaLeakedToPrice).length;
  const fieldCorrect = Object.fromEntries(FILTER_KEYS.map((k) => [k, 0]));

  for (const r of results) {
    const failedFields = new Set(r.diffs.map((d) => d.field));
    for (const k of FILTER_KEYS) {
      if (!failedFields.has(k)) fieldCorrect[k] += 1;
    }
  }

  const sources = {};
  for (const r of results) {
    sources[r.source] = (sources[r.source] || 0) + 1;
  }

  return {
    name,
    total,
    exactMatches,
    exactMatchPct: total ? ((exactMatches / total) * 100).toFixed(2) : "0.00",
    areaLeakCount,
    fieldCorrect,
    sources,
    results,
  };
}

function printReport(summary) {
  console.log(`\n=============================================================`);
  console.log(`НАБОР: ${summary.name} (всего запросов: ${summary.total})`);
  console.log(`Источники ответов: ${JSON.stringify(summary.sources)}`);
  console.log(
    `Полное совпадение (exact match по всем 16 полям): ${summary.exactMatches}/${summary.total} (${summary.exactMatchPct}%)`,
  );
  console.log(
    `Утечка площади в цену (minPrice/maxPrice != null при чистой площади): ${summary.areaLeakCount}/${summary.total}`,
  );
  console.log(`-------------------------------------------------------------`);
  console.log(`Точность по полям:`);
  for (const key of FILTER_KEYS) {
    const ok = summary.fieldCorrect[key];
    const pct = ((ok / summary.total) * 100).toFixed(2);
    console.log(`  ${key.padEnd(20)} ${String(ok).padStart(3)}/${summary.total} (${pct}%)`);
  }

  const failed = summary.results.filter((r) => !r.exactMatch);
  if (failed.length > 0) {
    console.log(`-------------------------------------------------------------`);
    console.log(`Расхождения (${failed.length}):`);
    for (const f of failed.slice(0, 25)) {
      const diffStr = f.diffs
        .map((d) => `${d.field}: ожидалось=${JSON.stringify(d.expected)}, получено=${JSON.stringify(d.actual)}`)
        .join("; ");
      console.log(`  - "${f.query}" -> ${diffStr}`);
    }
    if (failed.length > 25) {
      console.log(`  ... и ещё ${failed.length - 25} расхождений`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const datasetArg = args.find((a) => a.startsWith("--dataset="))?.split("=")[1] || "all";
  const modeArg = args.find((a) => a.startsWith("--mode="))?.split("=")[1] || "auto";
  const concurrency = Number(args.find((a) => a.startsWith("--concurrency="))?.split("=")[1] || 2);

  if (modeArg === "local") {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_API_KEY;
    delete process.env.GEMINI_API_KEY;
  }

  const hasAnthropicKey = Boolean(
    (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim().length >= 4) ||
      (process.env.CLAUDE_API_KEY && process.env.CLAUDE_API_KEY.trim().length >= 4),
  );
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length >= 4);

  console.log(
    `[eval:smart-search] mode=${modeArg} AI_PROVIDER=${process.env.AI_PROVIDER || "auto"} ` +
      `ANTHROPIC_MODEL=${process.env.ANTHROPIC_MODEL || "claude-haiku-5-5"} ` +
      `hasAnthropicKey=${hasAnthropicKey} hasGeminiKey=${hasGeminiKey}`,
  );

  const examples = loadJson(EXAMPLES_URL);
  const holdout = loadJson(HOLDOUT_URL);

  if (datasetArg === "examples" || datasetArg === "all") {
    const exSummary = await runDataset("Few-shot (smartSearch.examples.json)", examples, concurrency);
    printReport(exSummary);
  }

  if (datasetArg === "holdout" || datasetArg === "all") {
    const hoSummary = await runDataset("Hold-out (smartSearch.holdout.json)", holdout, concurrency);
    printReport(hoSummary);
  }
}

main().catch((err) => {
  console.error("[eval:smart-search] fatal:", err?.message || err);
  process.exit(1);
});
