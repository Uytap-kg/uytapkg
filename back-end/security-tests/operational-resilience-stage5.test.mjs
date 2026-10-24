import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  logger,
  sanitize,
  resetLoggerBurstState,
  LOG_BURST_MAX_PER_WINDOW,
} from "../src/utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(BACKEND_ROOT, "..");

test("P2-09: index.js настраивает HTTP-таймауты и в gracefulShutdown сбрасывает счётчики и закрывает dbPool.end()", () => {
  const indexSource = fs.readFileSync(path.join(BACKEND_ROOT, "src/index.js"), "utf8");

  assert.ok(
    indexSource.includes("server.requestTimeout = 30000"),
    "index.js должен задавать server.requestTimeout = 30000"
  );
  assert.ok(
    indexSource.includes("server.headersTimeout = 35000"),
    "index.js должен задавать server.headersTimeout = 35000"
  );
  assert.ok(
    indexSource.includes("server.keepAliveTimeout = 65000"),
    "index.js должен задавать server.keepAliveTimeout = 65000"
  );
  assert.ok(
    indexSource.includes("stopCronService()"),
    "gracefulShutdown должен останавливать cron-сервис"
  );
  assert.ok(
    indexSource.includes("stopCounterBatcher()") && indexSource.includes("await flushAllCounters()"),
    "gracefulShutdown должен останавливать батчер и сбрасывать накопленные счётчики в БД"
  );
  assert.ok(
    indexSource.includes("await dbPool.end()"),
    "gracefulShutdown должен закрывать пул соединений PostgreSQL (await dbPool.end())"
  );
});

test("P2-08: Ни один контроллер не возвращает сырой error.message в ответах 500", () => {
  const controllersDir = path.join(BACKEND_ROOT, "src/controllers");
  const files = fs.readdirSync(controllersDir).filter((f) => f.endsWith(".js"));

  for (const file of files) {
    const content = fs.readFileSync(path.join(controllersDir, file), "utf8");
    // Ищем блоки res.status(500).json({ ... }) и проверяем, что внутри нет error.message / err.message
    const status500Blocks = content.match(/res\.status\(\s*500\s*\)\.json\(\s*\{[\s\S]*?\}\s*\)/g) || [];
    for (const block of status500Blocks) {
      assert.ok(
        !/\b(error|err)\.message\b/.test(block),
        `В контроллере ${file} обнаружена утечка error.message в ответе 500:\n${block}`
      );
    }
  }
});

test("Stage 5 (Logger): защита от шторма одинаковых ошибок и обрезка длинных строк", () => {
  resetLoggerBurstState();

  const longString = "A".repeat(3000);
  const sanitized = sanitize(longString);
  assert.ok(sanitized.length < 2100 && sanitized.endsWith("...[truncated]"));

  let stderrLines = 0;
  const origWrite = process.stderr.write;
  process.stderr.write = () => {
    stderrLines += 1;
    return true;
  };

  try {
    for (let i = 0; i < LOG_BURST_MAX_PER_WINDOW + 15; i++) {
      logger.error("Repeated database connection timeout");
    }
    assert.equal(
      stderrLines,
      LOG_BURST_MAX_PER_WINDOW,
      `Логгер должен подавлять одинаковые ошибки сверх ${LOG_BURST_MAX_PER_WINDOW} за 10с окно`
    );
  } finally {
    process.stderr.write = origWrite;
    resetLoggerBurstState();
  }
});

test("Stage 5 (Deploy Configs): наличие и полнота deploy/nginx.conf.example, ecosystem.config.cjs и docker-compose.yml", () => {
  const nginxConf = fs.readFileSync(path.join(REPO_ROOT, "deploy/nginx.conf.example"), "utf8");
  assert.ok(nginxConf.includes("limit_req_zone"), "nginx.conf.example должен содержать limit_req_zone");
  assert.ok(nginxConf.includes("client_max_body_size"), "nginx.conf.example должен содержать client_max_body_size");
  assert.ok(nginxConf.includes("X-Internal-Proxy-Secret"), "nginx.conf.example должен передавать X-Internal-Proxy-Secret");
  assert.ok(nginxConf.includes("keepalive"), "nginx.conf.example должен настраивать keepalive для апстримов");

  const pm2Conf = fs.readFileSync(path.join(REPO_ROOT, "deploy/ecosystem.config.cjs"), "utf8");
  assert.ok(pm2Conf.includes("kill_timeout: 30000"), "ecosystem.config.cjs должен задавать kill_timeout: 30000");
  assert.ok(pm2Conf.includes("max_memory_restart"), "ecosystem.config.cjs должен задавать max_memory_restart");

  const dockerConf = fs.readFileSync(path.join(REPO_ROOT, "deploy/docker-compose.yml"), "utf8");
  assert.ok(dockerConf.includes("stop_grace_period: 30s"), "docker-compose.yml должен задавать stop_grace_period: 30s");
  assert.ok(dockerConf.includes("max-size"), "docker-compose.yml должен ограничивать размер логов контейнеров");

  const renderConf = fs.readFileSync(path.join(REPO_ROOT, "render.yaml"), "utf8");
  assert.ok(renderConf.includes("--max-old-space-size=384"), "render.yaml должен ограничивать V8 heap под 512 MB Starter");
  assert.ok(renderConf.includes("SHARP_CONCURRENCY"), "render.yaml должен задавать SHARP_CONCURRENCY для защиты от OOM");
  assert.ok(renderConf.includes("ENABLE_CLOUDFLARE"), "render.yaml должен включать ENABLE_CLOUDFLARE для периметра Render");
});

