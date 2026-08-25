// ECPay (綠界科技) "All-In-One" checkout integration — the payment gateway
// that bundles credit card, LINE Pay, JKOPay, and convenience-store payment
// into a single API, which is the most common way Taiwan restaurants/shops
// accept online payment. Docs: https://developers.ecpay.com.tw/?p=16427
//
// Real merchant credentials only come after the owner signs an ECPay
// merchant contract (needs a Taiwan business registration + bank account).
// Until then — and to let this feature be tried end-to-end right away —
// this module falls back to ECPay's own publicly-documented sandbox test
// credentials, which hit ECPay's *stage* environment with fake test cards
// (no real money moves). Once real credentials are added to the server's
// environment variables, it automatically switches to the real production
// endpoint.
const crypto = require("crypto");

const STAGE_CHECKOUT_URL = "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5";
const PROD_CHECKOUT_URL = "https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5";

// ECPay's publicly published sandbox test credentials (same values quoted
// throughout ECPay's own developer docs and every third-party ECPay
// integration guide) — safe to ship in source, they only work against the
// stage environment.
const TEST_CREDENTIALS = {
  merchantId: "2000132",
  hashKey: "5294y06JbISpM5x9",
  hashIv: "v77hoKGq4kWxNNIS",
};

function credentials() {
  const hasRealCreds = !!(
    process.env.ECPAY_MERCHANT_ID &&
    process.env.ECPAY_HASH_KEY &&
    process.env.ECPAY_HASH_IV
  );
  if (hasRealCreds) {
    return {
      merchantId: process.env.ECPAY_MERCHANT_ID,
      hashKey: process.env.ECPAY_HASH_KEY,
      hashIv: process.env.ECPAY_HASH_IV,
      isTest: false,
    };
  }
  return { ...TEST_CREDENTIALS, isTest: true };
}

function checkoutUrl() {
  const { isTest } = credentials();
  return isTest ? STAGE_CHECKOUT_URL : PROD_CHECKOUT_URL;
}

// ECPay expects params encoded the way .NET's classic UrlEncode does, which
// (for the character set our params ever contain) only differs from
// JS's encodeURIComponent in how it encodes spaces (+  instead of %20).
// The whole string is then lower-cased per ECPay's documented checksum
// steps. See "Checksum Mechanism" appendix in the ECPay docs.
function ecpayUrlEncode(str) {
  return encodeURIComponent(str).replace(/%20/g, "+").toLowerCase();
}

// Computes ECPay's CheckMacValue for a params object (sign an outgoing
// AioCheckOut request, or verify an incoming payment-result callback).
function computeCheckMacValue(params, hashKey, hashIv) {
  const keys = Object.keys(params)
    .filter((k) => k !== "CheckMacValue" && params[k] !== undefined && params[k] !== null && params[k] !== "")
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const joined = keys.map((k) => `${k}=${params[k]}`).join("&");
  const wrapped = `HashKey=${hashKey}&${joined}&HashIV=${hashIv}`;
  const encoded = ecpayUrlEncode(wrapped);
  return crypto.createHash("sha256").update(encoded).digest("hex").toUpperCase();
}

// Generates a fresh, ECPay-legal MerchantTradeNo: letters+digits only, max
// 20 chars, must never repeat. Doesn't encode the table number (the
// checkout route stores that mapping itself), just needs to be unique.
function generateMerchantTradeNo() {
  const ts = Date.now().toString(36).toUpperCase(); // ~8 chars
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase(); // 6 chars
  return `HGK${ts}${rand}`.slice(0, 20);
}

// "yyyy/MM/dd HH:mm:ss" in Taipei time, as ECPay's MerchantTradeDate
// requires — built from the app's existing nowLocal() ("YYYY-MM-DD
// HH:MM:SS") by swapping the date separators.
function merchantTradeDate() {
  const { nowLocal } = require("./time");
  return nowLocal().replace(/-/g, "/");
}

// Builds the full signed AioCheckOut param set for a given order amount.
// itemNames: array of display strings (e.g. "김치찌개 x2"); joined with #
// per ECPay's ItemName format, and cut to 400 chars (ECPay does this too,
// but we truncate first to keep the checksum consistent).
function buildAioCheckoutParams({ merchantTradeNo, amount, itemNames, tradeDesc, returnUrl, clientBackUrl }) {
  const { merchantId, hashKey, hashIv } = credentials();
  const itemName = itemNames.join("#").slice(0, 400);
  const params = {
    MerchantID: merchantId,
    MerchantTradeNo: merchantTradeNo,
    MerchantTradeDate: merchantTradeDate(),
    PaymentType: "aio",
    TotalAmount: Math.round(amount),
    TradeDesc: tradeDesc,
    ItemName: itemName,
    ReturnURL: returnUrl,
    ChoosePayment: "ALL",
    ClientBackURL: clientBackUrl,
    EncryptType: 1,
  };
  params.CheckMacValue = computeCheckMacValue(params, hashKey, hashIv);
  return params;
}

// Verifies an incoming ReturnURL (server-to-server) payment-result POST body.
function verifyCallback(body) {
  const { hashKey, hashIv } = credentials();
  const expected = computeCheckMacValue(body, hashKey, hashIv);
  const received = String(body.CheckMacValue || "").toUpperCase();
  return expected === received;
}

// Full HTML-entity escaping for attribute values — item names come from the
// menu (owner-editable text), so a stray & < > " in a dish name must not be
// able to break out of the value="..." attribute and corrupt the rest of
// the form (which would silently drop required fields like MerchantID
// before it ever reaches ECPay).
function escapeHtmlAttr(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Renders a minimal HTML page that auto-submits a POST form to ECPay's
// checkout page — ECPay requires the browser itself to POST there (it's not
// a plain redirect), so we hand the customer's browser a self-submitting
// form instead of building this client-side.
function renderAutoSubmitForm(params, options = {}) {
  const inputs = Object.entries(params)
    .map(([k, v]) => `<input type="hidden" name="${escapeHtmlAttr(k)}" value="${escapeHtmlAttr(v)}" />`)
    .join("\n");

  // Debug view: shows exactly what would be sent and requires a manual tap
  // to submit, instead of auto-submitting — lets you inspect the real
  // params (and the exact checkout URL/mode) when something goes wrong on
  // ECPay's side, without guessing what was actually transmitted.
  const debugTable = options.debug
    ? `<table border="1" cellpadding="6" style="border-collapse:collapse;margin:20px auto;font-family:monospace;font-size:13px;">
        <tr><th colspan="2">${escapeHtmlAttr(checkoutUrl())}</th></tr>
        ${Object.entries(params)
          .map(([k, v]) => `<tr><td>${escapeHtmlAttr(k)}</td><td>${escapeHtmlAttr(v)}</td></tr>`)
          .join("\n")}
      </table>`
    : "";

  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head><meta charset="UTF-8" /><title>결제로 이동 중...</title></head>
<body>
  <p style="font-family:sans-serif;text-align:center;margin-top:40px;">결제 페이지로 이동 중입니다...</p>
  ${debugTable}
  <form id="ecpayForm" method="POST" action="${checkoutUrl()}">
    ${inputs}
    ${options.debug ? `<div style="text-align:center;"><button type="submit">수동으로 ECPay에 제출</button></div>` : ""}
  </form>
  ${options.debug ? "" : `<script>document.getElementById('ecpayForm').submit();</script>`}
</body>
</html>`;
}

module.exports = {
  credentials,
  checkoutUrl,
  computeCheckMacValue,
  verifyCallback,
  generateMerchantTradeNo,
  buildAioCheckoutParams,
  renderAutoSubmitForm,
};
