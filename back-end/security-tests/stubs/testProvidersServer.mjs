import http from "http";
import crypto from "crypto";

const ODENGI_PORT = 5055;
const NIKITA_PORT = 5056;
const ODENGI_PASSWORD = process.env.ODENGI_PASSWORD || "test_password";

// ==============================================================================
// 1. MOCK NIKITA OTP SERVER (Port 5056)
// ==============================================================================
const nikitaStore = new Map(); // token -> { token, phone, code, createdAt }
const nikitaPhoneToToken = new Map(); // phone -> token

export function getNikitaInterception(phone, token) {
  if (token && nikitaStore.has(token)) {
    return nikitaStore.get(token);
  }
  const clean = phone ? phone.replace(/\D/g, "") : "";
  for (const [p, tok] of nikitaPhoneToToken.entries()) {
    if (p.endsWith(clean) || clean.endsWith(p)) {
      return nikitaStore.get(tok);
    }
  }
  return null;
}

const nikitaServer = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    let json = {};
    try { json = JSON.parse(body || "{}"); } catch {}

    const url = new URL(req.url, `http://localhost:${NIKITA_PORT}`);

    // Helper для тестов: получить последний перехваченный SMS-код
    if (url.pathname === "/test/last-otp" && req.method === "GET") {
      const phone = url.searchParams.get("phone");
      const token = url.searchParams.get("token");
      const record = getNikitaInterception(phone, token);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ success: true, record }));
    }

    // POST /api/otp/send
    if (url.pathname === "/api/otp/send" && req.method === "POST") {
      const cleanPhone = String(json.phone || "").replace(/\D/g, "");
      const token = `nikita_tok_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
      // Генерируем 6-значный цифровой код
      const code = String(Math.floor(100000 + Math.random() * 900000));

      const record = { token, phone: cleanPhone, code, createdAt: Date.now() };
      nikitaStore.set(token, record);
      nikitaPhoneToToken.set(cleanPhone, token);

      console.log(`[MOCK NIKITA] Sent OTP to ${cleanPhone}: code=${code}, token=${token}`);

      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({
        status: 0,
        token,
        description: "Успешно",
      }));
    }

    // POST /api/otp/verify
    if (url.pathname === "/api/otp/verify" && req.method === "POST") {
      const token = String(json.token || "");
      const code = String(json.code || "").trim();
      const record = nikitaStore.get(token);

      console.log(`[MOCK NIKITA] Verify OTP attempt for token=${token}, code=${code}`);

      if (!record) {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: 12, description: "Неверный токен" }));
      }

      if (record.code !== code) {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: 14, description: "Неверный код" }));
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ status: "0", description: "Успешно" }));
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });
});

// ==============================================================================
// 2. MOCK O!DENGI QR PAY SERVER (Port 5055)
// ==============================================================================
const odengiInvoices = new Map(); // orderId -> { invoiceId, orderId, amount, status: 'pending'|'approved'|'canceled' }
let invoiceCounter = 770000;

function buildOdengiHash(obj, secret = ODENGI_PASSWORD) {
  const json = JSON.stringify(obj);
  return crypto.createHmac("md5", secret).update(json).digest("hex");
}

export function setMockPaymentStatus(orderId, status) {
  const inv = odengiInvoices.get(orderId);
  if (inv) {
    inv.status = status;
    return true;
  }
  return false;
}

const odengiServer = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    let json = {};
    try { json = JSON.parse(body || "{}"); } catch {}

    const url = new URL(req.url, `http://localhost:${ODENGI_PORT}`);

    // Helper для тестов: изменить статус счета
    if (url.pathname === "/test/set-status" && req.method === "POST") {
      const { orderId, status } = json;
      const success = setMockPaymentStatus(orderId, status);
      console.log(`[MOCK ODENGI] Status changed for orderId=${orderId} -> ${status} (success=${success})`);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ success, orderId, status }));
    }

    // POST /api/json/json.php
    if (url.pathname === "/api/json/json.php" && req.method === "POST") {
      const { cmd, version, sid, mktime, lang, data } = json;

      if (cmd === "createInvoice") {
        const orderId = data?.order_id || `ORD-${Date.now()}`;
        const invoiceId = ++invoiceCounter;
        const amount = data?.amount || 1000;

        odengiInvoices.set(orderId, {
          invoiceId,
          orderId,
          amount,
          status: "pending",
        });

        console.log(`[MOCK ODENGI] createInvoice: orderId=${orderId}, invoiceId=${invoiceId}, amount=${amount}`);

        const respData = {
          invoice_id: invoiceId,
          qr: `http://localhost:${ODENGI_PORT}/qr/${invoiceId}`,
          paylink_url: `http://localhost:${ODENGI_PORT}/pay/${invoiceId}`,
          link_app: `odengi://pay/${invoiceId}`,
        };

        const respObj = {
          version: version || 1005,
          mktime: String(Date.now()),
          sid: sid || "test_sid",
          cmd: "createInvoice",
          data: respData,
        };
        respObj.hash = buildOdengiHash(respObj);

        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(respObj));
      }

      if (cmd === "statusPayment") {
        const invoiceId = data?.invoice_id;
        const orderId = data?.order_id;
        let invoice = null;

        if (orderId && odengiInvoices.has(orderId)) {
          invoice = odengiInvoices.get(orderId);
        } else {
          for (const inv of odengiInvoices.values()) {
            if (inv.invoiceId === invoiceId) {
              invoice = inv;
              break;
            }
          }
        }

        const isApproved = invoice?.status === "approved";
        const isCanceled = invoice?.status === "canceled";
        const statusString = isApproved ? "approved" : (isCanceled ? "canceled" : "pending");

        console.log(`[MOCK ODENGI] statusPayment check for orderId=${orderId}, invoiceId=${invoiceId}: status=${statusString}`);

        const respData = {
          status: statusString,
          invoice_id: invoiceId,
          payments: [
            {
              trans_id: `TX_${invoiceId || "123"}`,
              status: statusString,
              date_pay: new Date().toISOString(),
              amount: invoice?.amount || 1000,
            },
          ],
        };

        const respObj = {
          version: version || 1005,
          mktime: String(Date.now()),
          sid: sid || "test_sid",
          cmd: "statusPayment",
          data: respData,
        };
        respObj.hash = buildOdengiHash(respObj);

        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(respObj));
      }

      if (cmd === "invoiceCancel") {
        const invoiceId = data?.invoice_id;
        for (const inv of odengiInvoices.values()) {
          if (inv.invoiceId === invoiceId) {
            inv.status = "canceled";
            break;
          }
        }

        const respObj = {
          version: version || 1005,
          mktime: String(Date.now()),
          sid: sid || "test_sid",
          cmd: "invoiceCancel",
          data: { status: "canceled" },
        };
        respObj.hash = buildOdengiHash(respObj);

        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(respObj));
      }
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found", path: url.pathname }));
  });
});

export function startMockServers() {
  return new Promise((resolve) => {
    let started = 0;
    const done = () => {
      started++;
      if (started === 2) {
        console.log(`[TEST STUBS] Nikita mock running on port ${NIKITA_PORT}`);
        console.log(`[TEST STUBS] O!Dengi mock running on port ${ODENGI_PORT}`);
        resolve();
      }
    };
    nikitaServer.listen(NIKITA_PORT, "127.0.0.1", done);
    odengiServer.listen(ODENGI_PORT, "127.0.0.1", done);
  });
}

export function stopMockServers() {
  return new Promise((resolve) => {
    let stopped = 0;
    const done = () => {
      stopped++;
      if (stopped === 2) resolve();
    };
    nikitaServer.close(done);
    odengiServer.close(done);
  });
}

// Запуск напрямую из CLI
if (process.argv[1]?.endsWith("testProvidersServer.mjs")) {
  startMockServers().then(() => {
    console.log("[TEST STUBS] Ready to handle test traffic.");
  });
}
