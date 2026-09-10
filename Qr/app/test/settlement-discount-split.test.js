// 할인을 종류별로 갈라 세는가, 그리고 VIP 카드가 적자인지 흑자인지.
//
// 사장님(2026-09-10): "결산에 할인한 양이랑 그 중에 vip 카드 중 어떤 거에서
// 할인, 그냥 직접 할인 등 그것도 결산 페이지랑 보고에 들어갔으면 좋겠어.
// 그래서 vip 카드가 적자인지 흑자인지도 쉽게 볼 수 있을 것 같아."
//
// 어려운 자리는 두 할인을 같이 건 주문이다. discount_type 은 "te95+manual"
// 하나뿐이라 그것만 봐서는 어느 쪽이 얼마인지 모른다 — 주문에 따로 적어둔
// 두 금액을 봐야 한다. 그리고 그 필드가 생기기 전에 저장된 주문도 이미 DB에
// 있으므로, 그런 주문에서 숫자를 지어내지 않는지도 같이 잰다.
const { computeSettlement } = require("../src/settlement");
const { formatShiftSummary } = require("../src/line");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const DATE = "2026-09-10";
let seq = 0;
const order = (over = {}) => ({
  id: ++seq,
  table_number: "5",
  status: "paid",
  order_type: "dine_in",
  created_at: `${DATE} 12:00:00`,
  updated_at: `${DATE} 12:30:00`,
  party_size: 2,
  total: 1000,
  discount_amount: 0,
  discount_type: null,
  payment_method: "cash",
  items: [{ item_id: 1, name_ko: "밥", unit_price: 1000, qty: 1, payment_method: "cash" }],
  ...over,
});
const rowFor = (r, type) => (r.discount_breakdown || []).find((e) => e.discount_type === type);

out.push("[한 가지만 걸린 주문]");
{
  const r = computeSettlement(
    [
      order({ total: 950, discount_amount: 50, discount_type: "te95", discount_vip_amount: 50, discount_manual_amount: 0 }),
      order({ total: 900, discount_amount: 100, discount_type: "vip9", discount_vip_amount: 100, discount_manual_amount: 0 }),
      order({ total: 980, discount_amount: 20, discount_type: "manual", discount_vip_amount: 0, discount_manual_amount: 20 }),
    ],
    DATE
  );
  check("할인 총액", r.discount_total === 170, `${r.discount_total}`);
  check("特約95折 따로", rowFor(r, "te95").amount === 50);
  check("VIP9折 따로", rowFor(r, "vip9").amount === 100);
  check("직접 입력 따로", rowFor(r, "manual").amount === 20);
  check("종류가 셋", r.discount_breakdown.length === 3, JSON.stringify(r.discount_breakdown));
}

out.push("");
out.push("[두 할인을 같이 건 주문 — 여기가 핵심]");
{
  // 特約95折 50 + 재량 2 = 52 를 깎은 한 건.
  const r = computeSettlement(
    [order({ total: 948, discount_amount: 52, discount_type: "te95+manual", discount_vip_amount: 50, discount_manual_amount: 2 })],
    DATE
  );
  check("한 건인데 두 종류로 갈린다", r.discount_breakdown.length === 2, JSON.stringify(r.discount_breakdown));
  check("VIP 몫 50", rowFor(r, "te95").amount === 50);
  check("재량 몫 2", rowFor(r, "manual").amount === 2);
  check("갈라도 총액은 그대로", r.discount_total === 52);
  check("갈라진 합 = 총액", r.discount_breakdown.reduce((s, e) => s + e.amount, 0) === r.discount_total);
  check("VIP 카드가 깎아준 돈은 50", r.vip_card_program.card_discount_given === 50);
}

out.push("");
out.push("[옛 주문 — 나눌 근거가 없으면 지어내지 않는다]");
{
  // discount_vip_amount / discount_manual_amount 가 아예 없던 시절의 주문.
  const r = computeSettlement([order({ total: 900, discount_amount: 100, discount_type: "vip9" })], DATE);
  check("종류 그대로 하나로 센다", rowFor(r, "vip9").amount === 100);
  check("VIP 전용 할인이면 카드 몫으로 잡힌다", r.vip_card_program.card_discount_given === 100);
}
{
  // 섞인 옛 주문은 가를 수 없다 — 통째로 한 종류로 두고, 카드 몫으로는
  // 세지 않는다. 카드가 실제로 깎은 것보다 많이 잡으면 카드가 억울하게
  // 적자로 보인다.
  const r = computeSettlement([order({ total: 948, discount_amount: 52, discount_type: "te95+manual" })], DATE);
  check("섞인 옛 주문은 통째로", rowFor(r, "te95+manual").amount === 52);
  check("가를 수 없으면 카드 몫으로 세지 않는다", r.vip_card_program.card_discount_given === 0);
}

out.push("");
out.push("[VIP 카드 손익]");
{
  const r = computeSettlement(
    [
      // 카드 두 장 판매 (src/routes/vipCards.js 의 POST /sell 이 남기는 모양)
      order({ total: 500, kind: "vip_card_sale", items: [{ item_id: null, name_ko: "VIP 카드 판매", unit_price: 500, qty: 1, payment_method: "cash" }] }),
      order({ total: 500, kind: "vip_card_sale", items: [{ item_id: null, name_ko: "VIP 카드 판매", unit_price: 500, qty: 1, payment_method: "cash" }] }),
      // 카드 할인 300
      order({ total: 700, discount_amount: 300, discount_type: "vip9", discount_vip_amount: 300, discount_manual_amount: 0 }),
    ],
    DATE
  );
  check("판 장수", r.vip_card_program.cards_sold === 2);
  check("카드 판매 수입", r.vip_card_program.card_sales_revenue === 1000);
  check("카드가 깎아준 돈", r.vip_card_program.card_discount_given === 300);
  check("차액 +700 (흑자)", r.vip_card_program.net === 700);
}
{
  // 카드를 한 장도 안 팔았는데 할인만 나간 날 — 적자로 보여야 한다.
  const r = computeSettlement(
    [order({ total: 700, discount_amount: 300, discount_type: "vip9", discount_vip_amount: 300, discount_manual_amount: 0 })],
    DATE
  );
  check("판 것 없이 할인만 나가면 적자", r.vip_card_program.net === -300, `${r.vip_card_program.net}`);
}
{
  const r = computeSettlement([order()], DATE);
  check("할인도 카드도 없으면 전부 0", r.vip_card_program.cards_sold === 0 && r.vip_card_program.net === 0);
  check("재량 할인만 있는 날은 카드 몫 0", computeSettlement(
    [order({ total: 980, discount_amount: 20, discount_type: "manual", discount_vip_amount: 0, discount_manual_amount: 20 })], DATE
  ).vip_card_program.card_discount_given === 0);
}

out.push("");
out.push("[LINE 마감 문자에도 같이 들어간다]");
{
  const snap = computeSettlement(
    [
      order({ total: 948, discount_amount: 52, discount_type: "te95+manual", discount_vip_amount: 50, discount_manual_amount: 2 }),
      order({ total: 500, kind: "vip_card_sale", items: [{ item_id: null, name_ko: "VIP 카드 판매", unit_price: 500, qty: 1, payment_method: "cash" }] }),
    ],
    DATE
  );
  const am = formatShiftSummary(snap, { shift: "am", closedAt: `${DATE} 14:12:00` });
  check("오전 머리말", am.startsWith("🌅 9/10 오전 정산 (14:12 마감)"), am.split("\n")[0]);
  check("특약95절이 이름으로 나온다", am.includes("特約95折 -NT$50"), am);
  check("직접 입력이 따로 나온다", am.includes("직접 입력 -NT$2"), am);
  check("결제수단이 한글로", am.includes("현금"), am);
  check("VIP 카드 줄", am.includes("─ VIP 카드") && am.includes("차액 +NT$450"), am);

  const day = formatShiftSummary(snap, {
    shift: "day",
    closedAt: `${DATE} 21:07:00`,
    amPart: { revenue: 948, count: 1 },
    pmPart: { revenue: 500, count: 1 },
  });
  check("하루 머리말", day.startsWith("🌙 9/10 하루 정산 (21:07 마감)"), day.split("\n")[0]);
  check("오전/오후를 갈라 보여준다", day.includes("오전 NT$948") && day.includes("오후 NT$500"), day);
  check("오전 정산 안 누른 날엔 가르지 않는다",
    !formatShiftSummary(snap, { shift: "day", closedAt: `${DATE} 21:07:00` }).includes("  오전 "));
  check("미결제 없으면 그렇게 적는다", day.includes("✅ 미결제 주문 없음"), day);
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
