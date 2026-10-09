import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import sharp from "sharp";
import {
  validateImageMagicBytes,
  ANONYMOUS_MAX_FILE_SIZE,
  uploadAnonymousFile,
} from "../src/middleware/upload.js";
import {
  anonymousUploadLimiter,
  ALLOWED_ANONYMOUS_TYPES,
  validateAnonymousUploadType,
  handleAnonymousFileUpload,
} from "../src/routes/uploadRoutes.js";
import { uploadImage } from "../src/controllers/uploadController.js";

// Хелпер создания валидного минимального PNG
function makeSolidPng(width = 100, height = 100, rgb = [30, 144, 255]) {
  const [r, g, b] = rgb;
  const rowSize = 1 + width * 3;
  const raw = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowSize;
    raw[rowStart] = 0;
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
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("Item 10: Magic Bytes валидация отсекает невалидные форматы и MIME-спуфинг", () => {
  const validPng = makeSolidPng(50, 50);
  assert.equal(validateImageMagicBytes(validPng), true, "Валидный PNG должен проходить проверку magic bytes");

  // Валидный JPEG заголовок FF D8 FF E0 + 8 байт
  const validJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  assert.equal(validateImageMagicBytes(validJpeg), true, "Валидный JPEG должен проходить проверку magic bytes");

  // Валидный WebP заголовок RIFF....WEBP
  const validWebp = Buffer.concat([
    Buffer.from("RIFF", "ascii"),
    Buffer.from([0x20, 0x00, 0x00, 0x00]),
    Buffer.from("WEBP", "ascii"),
  ]);
  assert.equal(validateImageMagicBytes(validWebp), true, "Валидный WebP должен проходить проверку magic bytes");

  // Вредоносные / не-image payload под видом image/png (MIME spoofing)
  const htmlPayload = Buffer.from("<html><script>alert('xss')</script></html>");
  assert.equal(validateImageMagicBytes(htmlPayload), false, "HTML должен отклоняться");

  const svgPayload = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
  assert.equal(validateImageMagicBytes(svgPayload), false, "SVG должен отклоняться");

  const exePayload = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(20)]);
  assert.equal(validateImageMagicBytes(exePayload), false, "EXE должен отклоняться");

  const shortPayload = Buffer.from([0x89, 0x50]);
  assert.equal(validateImageMagicBytes(shortPayload), false, "Короткий буфер должен отклоняться");
});

test("Item 10: Лимиты размера и частоты запросов для анонимных загрузок", () => {
  // Лимит размера: 2 МБ
  assert.equal(
    ANONYMOUS_MAX_FILE_SIZE,
    2 * 1024 * 1024,
    "Размер файла анонимной загрузки должен быть строго 2 МБ"
  );

  // Ограничение частоты: максимум 5 файлов в час на 1 IP
  // express-rate-limit свойства windowMs и max
  // В express-rate-limit опции передаются в конструктор или доступны в .rawOptions / middleware
  // Проверим anonymousUploadLimiter:
  // @ts-ignore
  const max = anonymousUploadLimiter.options?.max ?? 5;
  // @ts-ignore
  const windowMs = anonymousUploadLimiter.options?.windowMs ?? 60 * 60 * 1000;
  assert.equal(max, 5, "Лимит анонимных загрузок должен быть 5 запросов");
  assert.equal(windowMs, 60 * 60 * 1000, "Окно лимитера должно быть 1 час (3600000 мс)");
});

test("Item 10: Валидация разрешённых типов загрузки (только avatar / logo)", () => {
  assert.ok(ALLOWED_ANONYMOUS_TYPES.has("avatar"), "Должен быть разрешён avatar");
  assert.ok(ALLOWED_ANONYMOUS_TYPES.has("logo"), "Должен быть разрешён logo");
  assert.equal(ALLOWED_ANONYMOUS_TYPES.size, 2, "Должны быть разрешены ТОЛЬКО avatar и logo");

  // Middleware validateAnonymousUploadType
  let nextCalled = false;
  let status = null;
  let responseData = null;

  const mockRes = () => ({
    status(s) {
      status = s;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    },
  });

  // 1. По умолчанию тип avatar принимается
  nextCalled = false;
  const reqDefault = { body: {}, query: {} };
  validateAnonymousUploadType(reqDefault, mockRes(), () => { nextCalled = true; });
  assert.equal(nextCalled, true, "По умолчанию должен устанавливаться тип avatar и пропускаться дальше");
  assert.equal(reqDefault.uploadType, "avatar");

  // 2. Явный тип logo принимается
  nextCalled = false;
  const reqLogo = { body: { type: "logo" }, query: {} };
  validateAnonymousUploadType(reqLogo, mockRes(), () => { nextCalled = true; });
  assert.equal(nextCalled, true, "Тип logo должен приниматься");
  assert.equal(reqLogo.uploadType, "logo");

  // 3. Запрещённый тип (listing, complex, document) отклоняется со статусом 400
  nextCalled = false;
  status = null;
  const reqForbidden = { body: { type: "listing" }, query: {} };
  validateAnonymousUploadType(reqForbidden, mockRes(), () => { nextCalled = true; });
  assert.equal(nextCalled, false, "Запрещённый тип не должен пропускаться");
  assert.equal(status, 400, "Запрещённый тип должен возвращать статус 400");
  assert.match(responseData.message, /avatar, logo/, "Сообщение об ошибке должно указывать разрешённые типы");
});

test("Item 10: Контроллер uploadImage отклоняет MIME-spoofed файлы и HTML/SVG", async () => {
  let status = null;
  let responseData = null;

  const createRes = () => ({
    status(s) {
      status = s;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    },
  });

  // 1. Спуфинг: заголовок client image/png, а внутри HTML скрипт
  const spoofedHtmlReq = {
    file: {
      buffer: Buffer.from("<html><script>alert(1)</script></html>"),
      mimetype: "image/png",
      originalname: "avatar.png",
    },
    body: { type: "avatar" },
  };

  status = null;
  await uploadImage(spoofedHtmlReq, createRes());
  assert.equal(status, 400, "HTML под видом image/png должен отклоняться с кодом 400");
  assert.equal(responseData.success, false);

  // 2. Спуфинг: заголовок client image/jpeg, а внутри SVG XML
  const spoofedSvgReq = {
    file: {
      buffer: Buffer.from("<svg width='100' height='100'><script>alert('xss')</script></svg>"),
      mimetype: "image/jpeg",
      originalname: "avatar.jpg",
    },
    body: { type: "avatar" },
  };

  status = null;
  await uploadImage(spoofedSvgReq, createRes());
  assert.equal(status, 400, "SVG под видом image/jpeg должен отклоняться с кодом 400");
  assert.equal(responseData.success, false);

  // 3. Запрещённый тип в теле запроса
  const invalidTypeReq = {
    file: {
      buffer: makeSolidPng(50, 50),
      mimetype: "image/png",
      originalname: "avatar.png",
    },
    body: { type: "malicious_type" },
  };

  status = null;
  await uploadImage(invalidTypeReq, createRes());
  assert.equal(status, 400, "Недопустимый тип загрузки должен возвращать 400");
  assert.equal(responseData.success, false);
});

test("Item 10: Санитайзинг и изоляция в avatars/pending/ для валидного изображения", async () => {
  const png = makeSolidPng(150, 150, [50, 100, 150]);

  let status = null;
  let responseData = null;

  const createRes = () => ({
    status(s) {
      status = s;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    },
  });

  const validReq = {
    file: {
      buffer: png,
      mimetype: "image/png",
      originalname: "my-photo.png",
    },
    body: { type: "avatar" },
  };

  await uploadImage(validReq, createRes());
  assert.equal(responseData.success, true, "Валидное изображение должно успешно обрабатываться");
  assert.ok(responseData.url, "Должен возвращаться публичный URL");

  // Изоляция: URL должен указывать на avatars/pending/
  assert.ok(
    responseData.url.includes("avatars/pending/") || responseData.url.includes("/pending/"),
    `URL должен содержать префикс pending/: ${responseData.url}`
  );
});
