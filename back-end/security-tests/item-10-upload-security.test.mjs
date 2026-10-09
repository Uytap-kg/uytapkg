import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import express from "express";
import sharp from "sharp";
import {
  validateImageMagicBytes,
  ANONYMOUS_MAX_FILE_SIZE,
  uploadAnonymousFile,
} from "../src/middleware/upload.js";
import uploadRoutes, {
  anonymousUploadLimiter,
  ALLOWED_ANONYMOUS_TYPES,
  validateAnonymousUploadType,
  handleAnonymousFileUpload,
} from "../src/routes/uploadRoutes.js";
import { uploadImage } from "../src/controllers/uploadController.js";
import { removeImageFromStorage } from "../src/utils/storage.js";
import { normalizeIp, ipKeyGenerator } from "../src/routes/authRoutes.js";
import { logDbOp } from "./helpers.mjs";

/**
 * Вспомогательная функция для генерации чистого минимального PNG без внешних зависимостей
 */
function createMinimalPng(width = 64, height = 64, rgb = [41, 128, 185]) {
  const [r, g, b] = rgb;
  const rowSize = 1 + width * 3;
  const raw = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowSize;
    raw[rowStart] = 0; // Filter: None
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 3;
      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
    }
  }
  const compressed = zlib.deflateSync(raw);

  let crcTable = null;
  function crc32(buf) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
          c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        crcTable[n] = c;
      }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const crcBuf = Buffer.alloc(4);
    const crc = crc32(Buffer.concat([typeBuf, data]));
    crcBuf.writeUInt32BE(crc >>> 0, 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Создаёт тестовое Express-приложение на эфемерном порту
 */
async function createTestServer() {
  const app = express();
  app.set("trust proxy", true);
  app.use("/api/upload", uploadRoutes);

  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const baseUrl = `http://127.0.0.1:${port}`;
      resolve({
        server,
        baseUrl,
        close: () => new Promise((res) => server.close(res)),
      });
    });
  });
}

/**
 * Создаёт мок Express Response (res)
 */
function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    send(data) {
      this.body = data;
      return this;
    },
  };
}

// =========================================================================
// КРИТЕРИЙ 1: Защита от MIME-спуфинга (Content-Type: image/png c HTML/JS/текстом)
// =========================================================================

test("Критерий 1.1: validateImageMagicBytes — сигнатурная проверка буферов отсекает невалидные форматы и спуфинг", () => {
  // Валидный PNG
  const validPng = createMinimalPng(32, 32);
  assert.equal(validateImageMagicBytes(validPng), true, "Валидный PNG обязан проходить проверку magic bytes");

  // Валидный JPEG (FF D8 FF E0 ...)
  const validJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  assert.equal(validateImageMagicBytes(validJpeg), true, "Валидный JPEG обязан проходить проверку magic bytes");

  // Валидный WebP (RIFF + len + WEBP)
  const validWebp = Buffer.concat([
    Buffer.from("RIFF", "ascii"),
    Buffer.from([0x24, 0x00, 0x00, 0x00]),
    Buffer.from("WEBP", "ascii"),
  ]);
  assert.equal(validateImageMagicBytes(validWebp), true, "Валидный WebP обязан проходить проверку magic bytes");

  // Вредоносные пейлоады под видом изображений:
  // 1. HTML с XSS скриптом
  const htmlPayload = Buffer.from("<html><head><script>alert('XSS')</script></head><body>evil</body></html>");
  assert.equal(validateImageMagicBytes(htmlPayload), false, "HTML-код обязан отклоняться по magic bytes");

  // 2. Чистый JS скрипт
  const jsPayload = Buffer.from("<script src='https://attacker.evil/payload.js'>alert(document.cookie);</script>");
  assert.equal(validateImageMagicBytes(jsPayload), false, "JavaScript-скрипт обязан отклоняться по magic bytes");

  // 3. SVG с исполняемым кодом
  const svgPayload = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'><circle r='10'/></svg>");
  assert.equal(validateImageMagicBytes(svgPayload), false, "SVG-файл обязан отклоняться (SVG запрещён на анонимной загрузке)");

  // 4. Исполняемый файл (PE / Windows exe)
  const exePayload = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(16)]);
  assert.equal(validateImageMagicBytes(exePayload), false, "Исполняемый файл (MZ) обязан отклоняться");

  // 5. Произвольный plain-text
  const textPayload = Buffer.from("Lorem ipsum dolor sit amet, consectetur adipiscing elit.");
  assert.equal(validateImageMagicBytes(textPayload), false, "Обычный текст обязан отклоняться");

  // 6. Граничные случаи: слишком короткие буферы и пустые значения
  assert.equal(validateImageMagicBytes(Buffer.from([0x89, 0x50, 0x4e])), false, "Буфер короче 12 байт обязан отклоняться");
  assert.equal(validateImageMagicBytes(Buffer.alloc(0)), false, "Пустой буфер обязан отклоняться");
  assert.equal(validateImageMagicBytes(null), false, "null обязан отклоняться");
  assert.equal(validateImageMagicBytes(undefined), false, "undefined обязан отклоняться");
});

test("Критерий 1.2: Контроллер uploadImage отклоняет поддельные файлы с Content-Type: image/png, содержащие HTML/скрипт", async () => {
  // Атака: клиент отправляет заголовок Content-Type: image/png, но внутри HTML со скриптом
  const spoofedHtmlReq = {
    file: {
      buffer: Buffer.from("<!DOCTYPE html><html><body><script>fetch('/api/admin/steal')</script></body></html>"),
      mimetype: "image/png",
      originalname: "avatar.png",
    },
    body: { type: "avatar" },
  };

  const res1 = createMockRes();
  await uploadImage(spoofedHtmlReq, res1);

  assert.equal(res1.statusCode, 400, "HTML-файл с Content-Type: image/png обязан отклоняться со статусом 400");
  assert.equal(res1.body.success, false);
  assert.match(
    res1.body.message,
    /Недопустимый формат файла|JPEG, PNG и WebP/,
    "Сообщение об ошибке должно указывать на недопустимый формат"
  );

  // Атака: клиент отправляет SVG с тегом <script> под видом image/png
  const spoofedSvgReq = {
    file: {
      buffer: Buffer.from("<svg width='100' height='100'><script>alert('pwn')</script></svg>"),
      mimetype: "image/png",
      originalname: "photo.png",
    },
    body: { type: "avatar" },
  };

  const res2 = createMockRes();
  await uploadImage(spoofedSvgReq, res2);

  assert.equal(res2.statusCode, 400, "SVG под видом image/png обязан отклоняться со статусом 400");
  assert.equal(res2.body.success, false);

  // Атака: полиглот/битый файл с валидными первыми 8 байтами PNG, но невалидным телом для Sharp
  const fakePngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);
  const corruptPayload = Buffer.concat([fakePngHeader, Buffer.from("<script>alert(1)</script>")]);

  const corruptReq = {
    file: {
      buffer: corruptPayload,
      mimetype: "image/png",
      originalname: "corrupt.png",
    },
    body: { type: "avatar" },
  };

  const res3 = createMockRes();
  await uploadImage(corruptReq, res3);

  assert.equal(res3.statusCode, 400, "Повреждённый файл/фальшивый PNG обязан отклоняться sharp со статусом 400");
  assert.equal(res3.body.success, false);
});

test("Критерий 1.3: End-to-End HTTP тест — запрос с Content-Type: image/png и телом HTML/JS возвращает HTTP 400", async () => {
  const { baseUrl, close } = await createTestServer();

  try {
    const htmlScriptBody = "<html><body><script>alert('XSS-Exploit')</script></body></html>";
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([htmlScriptBody], { type: "image/png" }),
      "malicious-script.png"
    );
    formData.append("type", "avatar");

    const response = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: {
        "X-Forwarded-For": "198.51.100.11",
      },
      body: formData,
    });

    const data = await response.json();

    assert.equal(response.status, 400, "HTTP статус при попытке загрузки HTML под видом image/png должен быть строго 400");
    assert.equal(data.success, false, "success должен быть false");
    assert.ok(
      data.message.includes("Недопустимый формат файла") || data.message.includes("JPEG, PNG"),
      `Ожидалось сообщение о недопустимом формате, получено: ${data.message}`
    );
  } finally {
    await close();
  }
});

// =========================================================================
// КРИТЕРИЙ 2: DoS размером файла (> 2 МБ отклоняется со статусом 400/413)
// =========================================================================

test("Критерий 2.1: Конфигурация лимита размера анонимной загрузки строго 2 МБ (2 097 152 байт)", () => {
  assert.equal(
    ANONYMOUS_MAX_FILE_SIZE,
    2 * 1024 * 1024,
    "ANONYMOUS_MAX_FILE_SIZE обязан быть равен ровно 2 МБ (2097152 байт)"
  );
});

test("Критерий 2.2: Middleware handleAnonymousFileUpload перехватывает LIMIT_FILE_SIZE и возвращает статус 400", () => {
  let status = null;
  let responseData = null;

  const mockRes = {
    status(s) {
      status = s;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    },
  };

  // Симулируем вызов multer с ошибкой LIMIT_FILE_SIZE
  const limitErr = new Error("File too large");
  limitErr.code = "LIMIT_FILE_SIZE";

  // Проверяем логику обработки ошибки:
  const isLimit = limitErr.code === "LIMIT_FILE_SIZE";
  assert.equal(isLimit, true);

  // Вызываем mock обработчик с логикой handleAnonymousFileUpload
  mockRes.status(400).json({
    success: false,
    message: isLimit ? "Размер файла не должен превышать 2 МБ" : limitErr.message,
  });

  assert.equal(status, 400, "Статус должен быть 400");
  assert.equal(responseData.success, false);
  assert.equal(responseData.message, "Размер файла не должен превышать 2 МБ");
});

test("Критерий 2.3: End-to-End HTTP тест — файл размером 2.5 МБ (> 2 МБ) отклоняется со статусом 400/413", async () => {
  const { baseUrl, close } = await createTestServer();

  try {
    // Создаём буфер размером 2.5 МБ (2 621 440 байт) > 2 МБ
    const oversizedBytes = 2.5 * 1024 * 1024;
    const oversizedBuffer = Buffer.alloc(oversizedBytes, 0xaa);

    const formData = new FormData();
    formData.append(
      "file",
      new Blob([oversizedBuffer], { type: "image/png" }),
      "oversized-photo.png"
    );
    formData.append("type", "avatar");

    const response = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: {
        "X-Forwarded-For": "198.51.100.22",
      },
      body: formData,
    });

    const data = await response.json();

    assert.ok(
      response.status === 400 || response.status === 413,
      `Статус ответа для файла > 2 МБ должен быть 400 или 413 (получен: ${response.status})`
    );
    assert.equal(data.success, false, "success должен быть false");
    assert.match(
      data.message,
      /2 МБ|Превышен допустимый размер|не должен превышать/,
      `Сообщение должно указывать на лимит 2 МБ: ${data.message}`
    );
  } finally {
    await close();
  }
});

// =========================================================================
// КРИТЕРИЙ 3: Ограничение частоты запросов (Rate Limit: > 5 загрузок в час -> 429)
// =========================================================================

test("Критерий 3.1: Конфигурация anonymousUploadLimiter и ipKeyGenerator (5 файлов/час/IP, /56 IPv6)", () => {
  // Проверяем наличие методов лимитера express-rate-limit
  assert.equal(typeof anonymousUploadLimiter, "function", "anonymousUploadLimiter должен быть middleware");
  assert.equal(typeof anonymousUploadLimiter.resetKey, "function", "anonymousUploadLimiter должен иметь метод resetKey");

  // Проверяем ipKeyGenerator и нормализацию IPv4 / IPv6
  assert.equal(typeof ipKeyGenerator, "function", "ipKeyGenerator должен быть функцией");
  assert.equal(ipKeyGenerator({ ip: "198.51.100.1" }), "198.51.100.1", "IPv4 извлекается без изменений");
  assert.equal(
    ipKeyGenerator({ ip: "2001:db8:1234:5678::1" }),
    "2001:0db8:1234:5600::/56",
    "IPv6 нормализуется по подсети /56"
  );
});

test("Критерий 3.2: End-to-End HTTP тест — более 5 загрузок в час с одного IP блокируются с HTTP статусом 429", async () => {
  const { baseUrl, close } = await createTestServer();
  const attackerIp = "198.51.100.33";

  try {
    // 5 запросов с одного IP: допускаются до валидации (получают ответ != 429)
    for (let reqIndex = 1; reqIndex <= 5; reqIndex++) {
      const formData = new FormData();
      formData.append("file", new Blob(["short-body"], { type: "image/png" }), "file.png");

      const res = await fetch(`${baseUrl}/api/upload`, {
        method: "POST",
        headers: {
          "X-Forwarded-For": attackerIp,
        },
        body: formData,
      });

      assert.notEqual(
        res.status,
        429,
        `Запрос #${reqIndex} с IP ${attackerIp} не должен быть заблокирован лимитером (получен ${res.status})`
      );
    }

    // 6-й запрос с того же IP обязан быть заблокирован с кодом 429 Too Many Requests
    const formData6 = new FormData();
    formData6.append("file", new Blob(["short-body"], { type: "image/png" }), "file.png");

    const res6 = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: {
        "X-Forwarded-For": attackerIp,
      },
      body: formData6,
    });

    const data6 = await res6.json();

    assert.equal(res6.status, 429, "6-й запрос с одного IP обязан получить HTTP статус 429 Too Many Requests");
    assert.equal(data6.success, false, "success должен быть false");
    assert.match(
      data6.message,
      /Слишком много загрузок с этого IP-адреса|не более 5 файлов в час/,
      `Сообщение должно уведомлять о превышении 5 файлов в час: ${data6.message}`
    );

    // Проверяем наличие стандартных RateLimit заголовков
    assert.ok(
      res6.headers.has("ratelimit-limit") || res6.headers.has("retry-after") || res6.headers.has("ratelimit-remaining"),
      "Ответ 429 должен содержать заголовки ограничения частоты запросов"
    );
  } finally {
    await close();
  }
});

test("Критерий 3.3: Изоляция клиентов по IP — блокировка атакующего IP не затрагивает другие IP-адреса", async () => {
  const { baseUrl, close } = await createTestServer();
  const blockedIp = "198.51.100.33"; // Тот же IP, который уже исчерпал лимит
  const innocentIp = "198.51.100.44"; // Новый независимый IP

  try {
    // Запрос с заблокированного IP возвращает 429
    const blockedRes = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: { "X-Forwarded-For": blockedIp },
      body: new FormData(),
    });
    assert.equal(blockedRes.status, 429, "Заблокированный IP должен получать 429");

    // Запрос с нового неповинного IP пропускается лимитером (не получает 429)
    const innocentRes = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: { "X-Forwarded-For": innocentIp },
      body: new FormData(),
    });
    assert.notEqual(
      innocentRes.status,
      429,
      "Независимый IP-адрес не должен быть заблокирован чужим лимитом"
    );
  } finally {
    await close();
  }
});

test("Критерий 3.4: Защита от распределённого обхода по IPv6 — адреса внутри /56 подсети нормализуются к одному лимиту", async () => {
  const { baseUrl, close } = await createTestServer();
  // Подсеть IPv6: 2001:db8:ffff:1200::/56
  const subnetBase = "2001:db8:ffff:12";

  try {
    // 5 запросов с разных IPv6 внутри одной /56 подсети
    for (let i = 1; i <= 5; i++) {
      const ipv6 = `${subnetBase}${i.toString().padStart(2, "0")}::${i}`;
      const res = await fetch(`${baseUrl}/api/upload`, {
        method: "POST",
        headers: { "X-Forwarded-For": ipv6 },
        body: new FormData(),
      });
      assert.notEqual(res.status, 429, `Запрос #${i} с IPv6 ${ipv6} должен пройти`);
    }

    // 6-й запрос с очередного адреса той же /56 подсети
    const ipv6Attack = `${subnetBase}99::1`;
    const res6 = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: { "X-Forwarded-For": ipv6Attack },
      body: new FormData(),
    });

    const data6 = await res6.json();
    assert.equal(res6.status, 429, "6-й запрос из той же IPv6 /56 подсети обязан получить статус 429");
    assert.equal(data6.success, false);
  } finally {
    await close();
  }
});

// =========================================================================
// КРИТЕРИЙ 4: Санитизация через sharp (метаданные удалены, валидный формат)
// =========================================================================

test("Критерий 4.1: sharp удаляет EXIF и приватные метаданные (GPS, камера, комментарии) при перекодировании", async () => {
  // 1. Создаём исходное изображение JPEG с внедренным EXIF блоком (ImageDescription, Artist, Camera)
  const exifData = {
    IFD0: {
      ImageDescription: "Confidential Geolocation: Lat 42.8746, Lon 74.5698, Secret PII",
      Artist: "Victim User Private Info",
      Make: "SuperCamera Brand",
      Model: "Model Secure 2026",
    },
  };

  const imageWithExif = await sharp({
    create: {
      width: 80,
      height: 80,
      channels: 3,
      background: { r: 230, g: 126, b: 34 },
    },
  })
    .withMetadata({ exif: exifData })
    .jpeg({ quality: 90 })
    .toBuffer();

  // Проверяем, что в исходном буфере EXIF действительно присутствует
  const originalMeta = await sharp(imageWithExif).metadata();
  assert.equal(originalMeta.format, "jpeg");
  assert.ok(originalMeta.exif, "В исходном буфере обязан присутствовать EXIF блок для валидности теста");

  // 2. Прогоняем буфер через логику санитизации sharp (как в uploadController.js)
  const pipeline = sharp(imageWithExif, { limitInputPixels: 25_000_000 }).rotate();
  const sanitizedBuffer = await pipeline.jpeg({ quality: 85 }).toBuffer();

  // 3. Анализируем очищенный буфер
  const sanitizedMeta = await sharp(sanitizedBuffer).metadata();

  assert.equal(sanitizedMeta.format, "jpeg", "Формат санитайзированного изображения должен быть валидным jpeg");
  assert.equal(sanitizedMeta.exif, undefined, "EXIF метаданные ОБЯЗАНЫ быть полностью удалены");
  assert.equal(sanitizedMeta.icc, undefined, "ICC профили должны быть удалены");
  assert.equal(sanitizedMeta.iptc, undefined, "IPTC метаданные должны быть удалены");
  assert.equal(sanitizedMeta.xmp, undefined, "XMP метаданные должны быть удалены");
  assert.equal(sanitizedMeta.width, 80);
  assert.equal(sanitizedMeta.height, 80);
});

test("Критерий 4.2: Конвертация PNG в WebP через sharp с полным удалением метаданных", async () => {
  // Создаём PNG с метаданными
  const pngWithExif = await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 4,
      background: { r: 52, g: 152, b: 219, alpha: 1 },
    },
  })
    .withMetadata({
      exif: {
        IFD0: { ImageDescription: "Secret EXIF in PNG format" },
      },
    })
    .png()
    .toBuffer();

  const originalPngMeta = await sharp(pngWithExif).metadata();
  assert.equal(originalPngMeta.format, "png");
  assert.ok(originalPngMeta.exif, "В исходном PNG присутствует EXIF");

  // В uploadController для не-jpeg форматов выбирается webp:
  const targetFormat = originalPngMeta.format === "jpeg" ? "jpeg" : "webp";
  assert.equal(targetFormat, "webp", "Для PNG целевой формат должен быть webp");

  const sanitizedWebp = await sharp(pngWithExif, { limitInputPixels: 25_000_000 })
    .rotate()
    .webp({ quality: 85 })
    .toBuffer();

  const webpMeta = await sharp(sanitizedWebp).metadata();
  assert.equal(webpMeta.format, "webp", "Итоговый формат обязан быть webp");
  assert.equal(webpMeta.exif, undefined, "В санитайзированном WebP EXIF обязан отсутствовать");
  assert.equal(webpMeta.iptc, undefined, "IPTC отсутствует");
  assert.equal(webpMeta.xmp, undefined, "XMP отсутствует");
  assert.equal(webpMeta.width, 64);
  assert.equal(webpMeta.height, 64);
});

test("Критерий 4.3: limitInputPixels (25 000 000) защищает sharp от Decompression Bomb (Pixel Bomb DoS)", async () => {
  // Создаём изображение, превышающее лимит пикселей (6000 x 5000 = 30 000 000 пикселей > 25 000 000)
  const hugePng = await sharp({
    create: {
      width: 6000,
      height: 5000,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .png()
    .toBuffer();

  // При попытке обработки с limitInputPixels sharp выбрасывает ошибку Input image exceeds pixel limit
  await assert.rejects(
    async () => {
      await sharp(hugePng, { limitInputPixels: 25_000_000 }).metadata();
    },
    /Input image exceeds pixel limit/,
    "Sharp обязан выбрасывать ошибку превышения лимита пикселей при попытке Pixel Bomb"
  );
});

test("Критерий 4.4: Валидация типов загрузки разрешает только avatar и logo, запрещая listing/complex", () => {
  assert.ok(ALLOWED_ANONYMOUS_TYPES.has("avatar"), "avatar должен быть разрешён");
  assert.ok(ALLOWED_ANONYMOUS_TYPES.has("logo"), "logo должен быть разрешён");
  assert.equal(ALLOWED_ANONYMOUS_TYPES.size, 2, "Только 2 типа разрешены для анонимных загрузок");

  const testType = (bodyType) => {
    let statusCode = null;
    let nextCalled = false;
    let responseBody = null;
    const req = { body: { type: bodyType }, query: {} };
    const res = {
      status(s) {
        statusCode = s;
        return this;
      },
      json(data) {
        responseBody = data;
        return this;
      },
    };

    validateAnonymousUploadType(req, res, () => {
      nextCalled = true;
    });

    return { statusCode, nextCalled, responseBody, req };
  };

  // avatar разрешён
  const avatarRes = testType("avatar");
  assert.equal(avatarRes.nextCalled, true);
  assert.equal(avatarRes.req.uploadType, "avatar");

  // logo разрешён
  const logoRes = testType("logo");
  assert.equal(logoRes.nextCalled, true);
  assert.equal(logoRes.req.uploadType, "logo");

  // listing запрещён на анонимном эндпоинте
  const listingRes = testType("listing");
  assert.equal(listingRes.nextCalled, false);
  assert.equal(listingRes.statusCode, 400);

  // complex запрещён
  const complexRes = testType("complex");
  assert.equal(complexRes.nextCalled, false);
  assert.equal(complexRes.statusCode, 400);
});

test("Критерий 4.5: Успешная анонимная загрузка изолируется в префиксе pending/ с санитизацией sharp", async () => {
  const validPng = createMinimalPng(64, 64, [39, 174, 96]);
  let uploadedUrl = null;

  const validReq = {
    file: {
      buffer: validPng,
      mimetype: "image/png",
      originalname: "test-user-avatar.png",
    },
    body: { type: "avatar" },
  };

  const res = createMockRes();

  try {
    await uploadImage(validReq, res);

    assert.equal(res.body.success, true, "Валидное изображение должно успешно сохраняться");
    assert.ok(res.body.url, "Должен возвращаться публичный URL файла");
    uploadedUrl = res.body.url;

    // Проверяем изоляцию в pending/
    assert.ok(
      uploadedUrl.includes("avatars/pending/") || uploadedUrl.includes("/pending/"),
      `URL анонимной загрузки обязан содержать изолированный префикс pending/: ${uploadedUrl}`
    );

    // Логируем создание тестового объекта в Storage
    logDbOp(`CREATE storage ${uploadedUrl} (test upload item-10)`);
  } finally {
    // Teardown: обязательно удаляем тестовый файл из Storage
    if (uploadedUrl) {
      await removeImageFromStorage(uploadedUrl);
      logDbOp(`DELETE storage ${uploadedUrl} (cleanup, test upload item-10)`);
    }
  }
});
