// 결제된 것의 반품·취소 — 음식은 취소, 음료·라면 봉지 등은 반품.
//
// 2026-10-03 사장님: "결제된 거 반품, 취소 같은 기능을 넣어줘. 음식이나 조리 같은
// 건 취소고 음료수 라면 봉지 등 반품할 수 있는 건 반품할 수 있게 해줘."
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};
process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "paid-refund";
process.env.ADMIN_PASSWORD = "ownerpass123";

const fs = require("fs");
const path = require("path");
const request = require("supertest");
const app = require("../server");
const { store, findOrders } = require("../src/db");
const { computeSettlement } = require("../src/settlement");
const { taipeiDateString } = require("../src/time");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

(async () => {
  await request(app).get("/api/menu");
  const boss = request.agent(app);
  await boss.post("/api/auth/login").send({ password: "ownerpass123" });
  await require("./disable-order-hours")();
  const byName = (n) => store.menuItems.find((m) => m.name_ko === n && !m.deleted_at);
  const bibim = byName("돌솥비빔밥");   // 230, 밥류 — 조리 음식
  const drink = byName("대만 음료수");  // 30, 음료 — 반품 가능
  const ramen = byName("사리면");       // 50, 음료 분류의 라면 봉지

  let r = await boss.post("/api/orders").send({
    tableNumber: "7",
    items: [{ itemId: bibim.id, qty: 2 }, { itemId: drink.id, qty: 2 }, { itemId: ramen.id, qty: 1 }],
    party: { adults: 2, children: 0 },
  });
  const id = r.body.id;
  check("주문", r.status === 200 || r.status === 201, JSON.stringify(r.body).slice(0, 200));

  out.push("[결제 전에는 반품·취소가 아니라 수정이다]");
  r = await boss.post(`/api/orders/${id}/refund`).send({ lines: [{ index: 0, qty: 1 }] });
  check("결제 안 된 주문은 거절", r.status === 400 && r.body.error === "order_not_paid", JSON.stringify(r.body));

  // VIP 9折 — 음료는 할인에서 빠진다. 비빔밥 460 의 10% = 46 할인.
  r = await boss.patch(`/api/orders/${id}`).send({ status: "paid", paymentMethod: "cash", vipDiscountType: "vip9" });
  const paid = r.body;
  check("결제(현금 · VIP 9折)", paid.status === "paid" && paid.discount_amount === 46, JSON.stringify({ s: paid.status, d: paid.discount_amount }));
  const gross = 230 * 2 + 30 * 2 + 50;

  out.push("\n[음식은 취소, 음료·라면 봉지는 반품]");
  r = await boss.post(`/api/orders/${id}/refund`).send({ lines: [{ index: 0, qty: 1 }, { index: 1, qty: 1 }, { index: 2, qty: 1 }], reason: "손님 요청" });
  check("처리된다", r.status === 200, JSON.stringify(r.body).slice(0, 300));
  const rec = r.body.refund || {};
  const L = (i) => (rec.lines || []).find((l) => l.index === i) || {};
  check("★★ 비빔밥(조리 음식) → 「취소」", L(0).kind === "cancel", JSON.stringify(L(0)));
  check("★★ 음료 → 「반품」", L(1).kind === "return", JSON.stringify(L(1)));
  check("★ 사리면(라면 봉지) → 「반품」", L(2).kind === "return", JSON.stringify(L(2)));
  check("★★ 할인 받은 음식은 받은 만큼만 돌려준다(230 의 90% = 207)", L(0).amount === 207, `${L(0).amount}`);
  check("★ 할인 안 되는 음료는 정가(30)", L(1).amount === 30 && L(2).amount === 50, `${L(1).amount} ${L(2).amount}`);
  check("돌려준 합계", rec.amount === 287 && r.body.order.refund_total === 287, `${rec.amount} ${r.body.order.refund_total}`);
  check("결제 방식은 결제한 그대로(현금)", rec.method === "cash", rec.method);
  check("사유가 남는다", rec.reason === "손님 요청", rec.reason);
  check("품목마다 돌려준 수가 남는다", r.body.order.items[0].refunded_qty === 1 && r.body.order.items[1].refunded_qty === 1, JSON.stringify(r.body.order.items.map((x) => x.refunded_qty)));
  check("주문은 지우지 않는다 — 결제 완료 그대로", r.body.order.status === "paid", r.body.order.status);

  r = await boss.post(`/api/orders/${id}/refund`).send({ lines: [{ index: 2, qty: 1 }] });
  check("★ 이미 돌려준 것은 또 못 돌려준다", r.status === 400 && r.body.error === "too_many", JSON.stringify(r.body));
  r = await boss.post(`/api/orders/${id}/refund`).send({ lines: [{ index: 0, qty: 0 }] });
  check("0개는 거절", r.status === 400, `${r.status}`);
  r = await request(app).post(`/api/orders/${id}/refund`).send({ lines: [{ index: 0, qty: 1 }] });
  check("로그인 안 하면 못 한다", r.status === 401 || r.status === 403, `${r.status}`);

  out.push("\n[결산 — 돌려준 만큼 빠진다]");
  const today = taipeiDateString();
  const orders = await findOrders({});
  let s = computeSettlement(orders, today, today);
  check("★★ 매출 = 받은 524 − 돌려준 287 = 237", s.total_revenue === 237 && gross - 46 - 287 === 237, `${s.total_revenue}`);
  const cash = (s.payment_method_breakdown || []).find((m) => m.method === "cash") || {};
  check("★ 현금 칸도 그만큼 준다(서랍과 맞는다)", cash.revenue === 237 && s.payment_method_total === 237, JSON.stringify(s.payment_method_breakdown));
  const ib = (n) => (s.item_breakdown || []).find((x) => x.name_ko === n) || {};
  check("★ 품목 판매 수에서 뺀다(비빔밥 2 → 1, 음료 2 → 1)", ib("돌솥비빔밥").qty === 1 && ib("대만 음료수").qty === 1, JSON.stringify([ib("돌솥비빔밥").qty, ib("대만 음료수").qty]));
  check("다 돌려준 사리면은 판매 목록에서 빠진다", !ib("사리면").qty, JSON.stringify(ib("사리면")));
  check("★ 취소·반품을 따로 센다", s.refund_cancel_amount === 207 && s.refund_return_amount === 80 && s.refund_total === 287 && s.refund_count === 1, JSON.stringify({ c: s.refund_cancel_amount, r: s.refund_return_amount, t: s.refund_total }));

  out.push("\n[카드로 돌려주면 카드 칸에서 빠진다]");
  r = await boss.post(`/api/orders/${id}/refund`).send({ lines: [{ index: 1, qty: 1 }], method: "card" });
  s = computeSettlement(await findOrders({}), today, today);
  const card = (s.payment_method_breakdown || []).find((m) => m.method === "card") || {};
  check("카드 −30", card.revenue === -30, JSON.stringify(s.payment_method_breakdown));
  check("결제수단 합계 = 매출", s.payment_method_total === s.total_revenue && s.total_revenue === 207, `${s.payment_method_total} ${s.total_revenue}`);

  out.push("\n[받은 것보다 더 돌려줄 수 없다]");
  // 할인이 큰 주문 — 재량 할인이 한 라운드에 몰려 있으면 줄마다 계산한 금액이
  // 받은 돈보다 클 수 있다. 서버가 받은 만큼에서 자른다.
  r = await boss.post(`/api/orders/${id}/refund`).send({ lines: [{ index: 0, qty: 1 }] });
  const o = r.body.order;
  check("남은 비빔밥까지 — 받은 524 를 넘지 않는다", o.refund_total <= gross - 46 && o.refund_total === 287 + 30 + 207, `${o.refund_total}`);

  const src = fs.readFileSync(path.join(__dirname, "../src/routes/orders.js"), "utf8");
  const adminJs = fs.readFileSync(path.join(__dirname, "../public/js/admin.js"), "utf8");
  const rcpt = adminJs.slice(adminJs.indexOf("async function printPaidOrderReceipt("), adminJs.indexOf("async function printNoticeTicket("));
  check("★ 영수증에서 돌려준 품목은 빠진다", /refunded_qty/.test(rcpt) && /orderPaidAmount\(o0\)/.test(rcpt), "");
  check("카드의 받은 돈도 돌려준 것을 뺀다", /Number\(\(o && o\.refund_total\) \|\| 0\)/.test(adminJs), "");
  check("★ 권한은 「주문 취소」와 같다", /router\.post\("\/:id\/refund"[\s\S]{0,300}staff_permissions\.orderCancel/.test(src), "");

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
