import crypto from "crypto";
import { odengiConfig, assertOdengiConfigured } from "../config/odengi.js";

// =======================================================
// Клиент O!Dengi QR Pay API (https://sandbox.dengi.kg/).
//
// Все запросы: POST {cmd, version, sid, mktime, lang, data, hash}
// Все ответы:  {version, mktime, sid, cmd, data, hash}
// =======================================================

/**
 * Подпись запроса: HMAC-MD5 от компактного (без пробелов) JSON тела
 * запроса БЕЗ поля "hash", с паролем мерчанта в качестве ключа.
 */
function buildRequestHash({ cmd, version, sid, mktime, lang, data }) {
  const json = JSON.stringify({ cmd, version, sid, mktime, lang, data });
  return crypto.createHmac("md5", odengiConfig.password).update(json).digest("hex");
}

function nowMktime() {
  return String(Date.now());
}

async function callOdengi(cmd, data) {
  assertOdengiConfigured();

  const mktime = nowMktime();
  const payload = {
    cmd,
    version: odengiConfig.version,
    sid: odengiConfig.sid,
    mktime,
    lang: odengiConfig.lang,
    data,
  };

  payload.hash = buildRequestHash({
    cmd,
    version: odengiConfig.version,
    sid: odengiConfig.sid,
    mktime,
    lang: odengiConfig.lang,
    data,
  });

  const timeoutMs = Number(odengiConfig.timeoutMs) > 0 ? Number(odengiConfig.timeoutMs) : 15000;
  const response = await fetch(odengiConfig.apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`O!Dengi вернул невалидный ответ (${response.status}): ${text.slice(0, 300)}`);
  }

  if (!response.ok) {
    throw new Error(`O!Dengi API ошибка ${response.status}: ${text.slice(0, 300)}`);
  }

  if (json?.data?.error) {
    const err = new Error(json.data.desc || `O!Dengi error ${json.data.error}`);
    err.odengiErrorCode = json.data.error;
    throw err;
  }

  return json.data;
}

// Выставить счёт / получить QR
export async function createInvoice({
  orderId,
  description,
  amountKopecks,
  resultUrl,
  fieldsOther,
}) {
  return callOdengi("createInvoice", {
    order_id: orderId,
    desc: description,
    amount: amountKopecks,
    currency: "KGS",
    test: odengiConfig.test,
    long_term: 0,
    user_to: null,
    date_life: null,
    date_start_push: null,
    count_push: null,
    send_push: 1,
    send_sms: 1,
    success_url: null,
    fail_url: null,
    fields_other: fieldsOther ?? null,
    transtype: null,
    result_url: resultUrl || odengiConfig.resultUrl || null,
  });
}

// Проверить статус счёта
export async function statusPayment({ invoiceId, orderId, mark }) {
  return callOdengi("statusPayment", {
    invoice_id: invoiceId,
    order_id: orderId,
    mark: mark ?? null,
  });
}

// Отменить неоплаченный счёт
export async function invoiceCancel({ invoiceId }) {
  return callOdengi("invoiceCancel", {
    invoice_id: invoiceId,
  });
}

// Полная отмена (возврат) оплаченного платежа
export async function voidPayment({ transId }) {
  return callOdengi("voidPayment", {
    trans_id: transId,
  });
}

// Частичный возврат оплаченного платежа
export async function refundPaymentToEwallet({ transId, amountKopecks }) {
  return callOdengi("refundPaymentToEwallet", {
    trans_id: transId,
    amount: amountKopecks,
  });
}

export async function updateMark({ transId, mark }) {
  return callOdengi("updateMark", {
    trans_id: transId,
    mark,
  });
}
