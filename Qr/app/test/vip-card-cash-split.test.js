// VIP 카드는 현금, 밥값은 고른 결제수단 — 그리고 결산이 그 둘을 가리는가.
//
// 사장님(2026-09-10): "현재 vip 카드 구매 버튼이 있는데 그게 총 결제 금액이랑
// 더해지게 해줘. 그리고 vip 카드는 무조건 현금으로 결제할 거라서 나머지
// 금액은 line, 카드, 현금 으로 선택할 수 있게 해줘. 그리고 그걸 결산에서
// 잘 구분해야 하고."
//
// 한 번의 결제가 두 결제수단으로 갈린다. 손님은 한 번 내지만 서랍에는
// 카드값 300 이 현금으로 들어오고 밥값은 LINE 으로 들어온다. 마감에 서랍을
// 맞출 때 이 둘이 섞이면 매일 밤 안 맞는다.
const fs = require("fs");
const path = require("path");
const { computeSettlement } = require("../src/settlement");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}
const D = "2026-09-10";
const at = (t) => `${D} ${t}`;

// 밥값 1340 을 LINE 으로 낸 주문
const foodOrder = {
  id: 1, table_number: "7", status: "paid", created_at: at("12:00:00"), updated_at: at("13:00:00"),
  total: 1340, subtotal: 1340, payment_method: "line", party_size: 2,
  items: [
    { item_id: 11, name_ko: "돌솥비빔밥", unit_price: 670, qty: 2, category_key: "rice", payment_method: "line", paid: true, paid_at: at("13:00:00") },
  ],
};
// 같은 손님이 같은 순간에 산 VIP 카드 — 값은 현금으로만 받는다
const cardOrder = {
  id: 2, table_number: "7", status: "paid", created_at: at("13:00:00"), updated_at: at("13:00:00"),
  total: 300, subtotal: 300, payment_method: "cash", kind: "vip_card_sale", vip_card_sold: "A001",
  items: [
    { item_id: null, name_ko: "VIP 카드 판매", unit_price: 300, qty: 1, category_key: "vip_card", payment_method: "cash", paid: true, paid_at: at("13:00:00") },
  ],
};

const s = computeSettlement([foodOrder, cardOrder], D);
const byMethod = Object.fromEntries((s.payment_method_breakdown || []).map((e) => [e.method, e.revenue]));

out.push("[1] 결제수단이 갈린다");
{
  check("★ 현금은 카드값만 (밥값이 안 섞인다)", byMethod.cash === 300, JSON.stringify(byMethod));
  check("★ LINE 은 밥값만 (카드값이 안 섞인다)", byMethod.line === 1340, JSON.stringify(byMethod));
  check("결제수단 총합이 실제 받은 돈과 같다", (s.payment_method_total || 0) === 1640, String(s.payment_method_total));
  check("총 매출도 둘을 합한 값이다", s.total_revenue === 1640, String(s.total_revenue));
}

out.push("\n[2] 카드 판매가 밥값과 갈려 보인다");
{
  const p = s.vip_card_program || {};
  check("판 카드 수를 센다", p.cards_sold === 1, JSON.stringify(p));
  check("★ 카드값 매출을 따로 센다", p.card_sales_revenue === 300, JSON.stringify(p));
  const cats = Object.fromEntries((s.category_breakdown || []).map((c) => [c.category_key, c.subtotal]));
  check("★ 분류에서도 vip_card 가 따로 선다", (cats.vip_card || 0) === 300, JSON.stringify(cats));
  check("밥값은 밥 분류에 남는다", (cats.rice || 0) === 1340, JSON.stringify(cats));
}

out.push("\n[3] 카드값이 할인에 휩쓸리지 않는다");
{
  // VIP 할인이 걸린 결제에 카드를 같이 사면, 카드값 300 까지 깎이면 안 된다.
  const discounted = {
    ...foodOrder, id: 3, total: 1206, vip_discount_percent: 10,
    items: [{ ...foodOrder.items[0], payment_method: "cash" }],
  };
  const s2 = computeSettlement([discounted, { ...cardOrder, id: 4 }], D);
  const m2 = Object.fromEntries((s2.payment_method_breakdown || []).map((e) => [e.method, e.revenue]));
  check("★ 현금 = 할인된 밥값 + 카드값 그대로", m2.cash === 1206 + 300, JSON.stringify(m2));
  check("카드값은 깎이지 않는다", (s2.vip_card_program || {}).card_sales_revenue === 300, JSON.stringify(s2.vip_card_program));
}

out.push("\n[4] 화면이 한 번에 부르고 현금만 따로 뗀다 (public/js/admin.js)");
{
  const admin = fs.readFileSync(path.join(__dirname, "..", "public", "js", "admin.js"), "utf8");
  check("결제 버튼 금액에 카드값이 더해진다", /const footerPayTotal = footerSelectedTotal \+ pendingCardAmount;/.test(admin), "");
  check("★ 고르는 결제수단은 밥값 것이라고 적는다", /아래에서 고르는 결제수단은 밥값/.test(admin), "");
  check("★ 카드값은 무조건 현금이라고 적는다", /VIP 카드 NT\$\$\{cardAmount\} \(무조건 현금\)/.test(admin), "");
  check("★ 밥값이 결제된 뒤에 카드를 판다", /if \(cardAmount && !results\.some\(\(r\) => !r\.ok\)\)/.test(admin), "");
  check("★ 카드만 안 팔린 경우를 조용히 넘기지 않는다", /vipSellFailedAfterPay/.test(admin), "");
  check("다른 자리로 넘어가면 얹어 둔 것이 따라가지 않는다", /pendingVipCardSale\.tableNumber\) !== String\(tableNumber\)/.test(admin), "");
  check("한 번 더 누르면 뺀다", /pendingVipCardAmountFor\(tableNumber\) > 0[\s\S]{0,80}clearPendingVipCardSale\(\)/.test(admin), "");
}

out.push("\n[5] 카드 판매가 store 문서를 통째로 쓰지 않는다");
{
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "vipCards.js"), "utf8");
  check("★ saveOrder 만 쓴다 (save() 동반 X)", !/Promise\.all\(\[saveOrder\(order\), save\(\)\]\)/.test(src), "");
  check("주문 줄 하나만 쓴다", /await saveOrder\(order\);/.test(src), "");
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
