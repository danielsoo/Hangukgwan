// Online payment via ECPay — lets a customer settle their table's whole
// outstanding bill themselves from their phone (credit card / LINE Pay /
// JKOPay / convenience-store code, whatever ECPay's hosted checkout page
// offers), instead of only the staff-side "전체 결제 완료" button in Admin.
//
// This is entirely additive: when the owner has this feature switched off
// (Admin > 설정 > 온라인 결제), none of this is reachable from the customer
// page and nothing here changes existing behavior.
const express = require("express");
const { store, save, nextId } = require("../db");
const { nowLocal } = require("../time");
const ecpay = require("../ecpay");

const router = express.Router();

// ECPay's ReturnURL callback arrives as a standard HTML form POST
// (application/x-www-form-urlencoded), not JSON — the app-wide body parser
// in server.js only handles JSON, so this router needs its own.
router.use(express.urlencoded({ extended: false }));

function unpaidOrdersForTable(tableNumber) {
  return store.orders.filter(
    (o) => String(o.table_number) === String(tableNumber) && o.status !== "paid" && o.status !== "cancelled"
  );
}

// Customer taps "온라인 결제" on their table's receipt/history sheet — this
// builds a signed ECPay order for their table's current unpaid total and
// hands their browser a self-submitting form to ECPay's checkout page.
router.get("/checkout", async (req, res) => {
  if (!store.settings.online_payment_enabled) {
    return res.status(403).send("온라인 결제 기능이 현재 비활성화되어 있습니다.");
  }
  const tableNumber = String(req.query.table || "").trim();
  if (!tableNumber) return res.status(400).send("잘못된 요청입니다 (테이블 번호 없음).");

  const orders = unpaidOrdersForTable(tableNumber);
  if (orders.length === 0) return res.status(400).send("결제할 미결제 주문이 없습니다.");

  const amount = orders.reduce((sum, o) => sum + o.total, 0);
  if (amount <= 0) return res.status(400).send("결제할 금액이 없습니다.");

  const itemNames = [];
  orders.forEach((o) => o.items.forEach((it) => itemNames.push(`${it.name_zh || it.name_en || it.name_ko}x${it.qty}`)));

  const merchantTradeNo = ecpay.generateMerchantTradeNo();
  const baseUrl = `${req.protocol}://${req.get("host")}`;

  store.payments = store.payments || [];
  store.payments.push({
    id: nextId("payments"),
    merchant_trade_no: merchantTradeNo,
    table_number: tableNumber,
    order_ids: orders.map((o) => o.id),
    amount,
    status: "pending",
    created_at: nowLocal(),
    paid_at: null,
    ecpay_trade_no: null,
  });
  await save();

  const params = ecpay.buildAioCheckoutParams({
    merchantTradeNo,
    amount,
    itemNames,
    tradeDesc: "韓國館餐點結帳",
    returnUrl: `${baseUrl}/api/payment/callback`,
    clientBackUrl: `${baseUrl}/t/${encodeURIComponent(tableNumber)}`,
  });

  res.set("Content-Type", "text/html; charset=UTF-8");
  // ?debug=1 skips the auto-submit and shows the exact params being sent —
  // useful for troubleshooting an ECPay-side error without guessing what
  // was actually submitted.
  res.send(ecpay.renderAutoSubmitForm(params, { debug: req.query.debug === "1" }));
});

// ECPay's server-to-server payment result notification (ReturnURL). Must
// respond the exact string "1|OK" once the callback is received and
// verified — that response only acknowledges receipt, it does not itself
// change anything; recording the order(s) as paid is what actually applies
// the result on our side.
router.post("/callback", async (req, res) => {
  const body = req.body || {};

  if (!ecpay.verifyCallback(body)) {
    console.error("ECPay callback: CheckMacValue mismatch", body);
    return res.send("0|CheckMacValueError");
  }

  store.payments = store.payments || [];
  const payment = store.payments.find((p) => p.merchant_trade_no === body.MerchantTradeNo);
  if (!payment) {
    console.error("ECPay callback: unknown MerchantTradeNo", body.MerchantTradeNo);
    return res.send("1|OK"); // acknowledge anyway so ECPay stops retrying
  }

  const success = String(body.RtnCode) === "1";
  if (success && payment.status !== "paid") {
    payment.status = "paid";
    payment.paid_at = nowLocal();
    payment.ecpay_trade_no = body.TradeNo || null;
    payment.simulate_paid = String(body.SimulatePaid) === "1";
    for (const orderId of payment.order_ids) {
      const order = store.orders.find((o) => o.id === orderId);
      if (order && order.status !== "paid") {
        order.status = "paid";
        order.updated_at = nowLocal();
      }
    }
    await save();
  } else if (!success && payment.status === "pending") {
    payment.status = "failed";
    payment.failure_msg = body.RtnMsg || null;
    await save();
  }

  res.send("1|OK");
});

module.exports = router;
