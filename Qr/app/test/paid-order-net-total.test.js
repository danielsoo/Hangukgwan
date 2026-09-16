// 결제가 끝난 주문에 「받은 돈」이 적히는가 — 화면과 종이 둘 다.
//
// 2026-09-16 사장님(스크린샷과 함께):
//   "각 자리별 결제완료금액이 할인전 금액으로 그대로 표기됨."
//   "직원이 할인여부 등 당일 정산에 대한 오류검증, 또는 손님이 할인여부에
//    대한 재확인 요구시 할인여부를 현재로서는 확인하기 힘든 상황."
//   "결제완료 된 부분에 대하여 재인쇄를 할 때는 최종결제금액이 프린트되도록
//    수정요망."
//
// ── 왜 이렇게 됐나 ─────────────────────────────────────────────────────
//
// 주문의 total 은 **할인 전** 금액이다. 깎아준 돈은 discount_amount 에 따로
// 적힌다(src/routes/orders.js recordDiscount). 받은 돈은 그 둘의 차다.
//
// 화면의 결제완료 카드는 o.total 을 그대로 찍고 있었다.
//
// 종이는 더 나빴다. computeTicketDiscountInfo 는 **결제 화면에서 지금 고른**
// 할인을 본다 — 아직 안 낸 주문의 미리보기용이다. 결제가 끝나면 그 값이
// 비어서 active:false 가 되고, 재인쇄한 종이에 할인 전 금액이 찍혔다.
// 손님에게 건네는 종이가 실제로 받은 돈과 달랐다.
const fs = require("fs");
const path = require("path");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const admin = fs.readFileSync(path.join(__dirname, "../public/js/admin.js"), "utf8");
const escposSrc = fs.readFileSync(path.join(__dirname, "../public/js/escpos.js"), "utf8");

// admin.js 에서 함수 하나를 떼어내 진짜로 돌린다. 글자를 맞춰보는 것보다
// 값을 재는 편이 안전하다 — 이 파일 안에서 이름만 바뀌어도 안 깨진다.
function lift(name, header) {
  const start = admin.indexOf(header);
  if (start < 0) return null;
  const end = admin.indexOf("\n  }\n", start);
  if (end < 0) return null;
  // eslint-disable-next-line no-new-func
  return new Function(`${admin.slice(start, end + 4)}; return ${name};`)();
}

out.push("[받은 돈을 세는 규칙]");
const orderPaidAmount = lift("orderPaidAmount", "function orderPaidAmount(o) {");
const paidOrderDiscount = lift("paidOrderDiscount", "function paidOrderDiscount(o) {");
check("규칙이 있다", typeof orderPaidAmount === "function" && typeof paidOrderDiscount === "function");

if (typeof orderPaidAmount === "function") {
  check("★ 할인이 있으면 빼고 센다", orderPaidAmount({ total: 470, discount_amount: 23 }) === 447, `${orderPaidAmount({ total: 470, discount_amount: 23 })}`);
  check("할인이 없으면 그대로다", orderPaidAmount({ total: 470 }) === 470, "");
  check("할인이 0이어도 그대로다", orderPaidAmount({ total: 470, discount_amount: 0 }) === 470, "");
  check("★ 음수로 내려가지 않는다", orderPaidAmount({ total: 100, discount_amount: 500 }) === 0, "");
  check("값이 없어도 안 터진다", orderPaidAmount(null) === 0 && orderPaidAmount({}) === 0, "");
}
if (typeof paidOrderDiscount === "function") {
  check("★ 아직 안 낸 주문은 0 — 그때 할인은 결제 화면이 미리보기로 정한다", paidOrderDiscount({ status: "served", total: 470, discount_amount: 23 }) === 0, "");
  check("결제된 주문은 적힌 값", paidOrderDiscount({ status: "paid", discount_amount: 23 }) === 23, "");
  check("취소된 주문은 0", paidOrderDiscount({ status: "cancelled", discount_amount: 23 }) === 0, "");
}

out.push("\n[종이 — 재인쇄하면 최종 결제금액이 찍힌다]");
// computeTicketDiscountInfo 는 화면 상태를 여럿 참조한다. 결제가 끝난
// 주문에서는 그것들을 **보지 않아야** 하므로, 일부러 「할인 안 고름」으로
// 채워놓고 그래도 종이에 할인이 찍히는지 본다.
const ticketInfoOf = (() => {
  const header = "function computeTicketDiscountInfo(o) {";
  const start = admin.indexOf(header);
  if (start < 0) return null;
  const end = admin.indexOf("\n  }\n", start);
  const body = admin.slice(start, end + 4);
  const helpers = `
    const isCounterOrder = () => false;
    const counterVipDiscountTypeByOrderId = new Map();
    const counterManualDiscountValueByOrderId = new Map();
    const tableVipDiscountType = null;      // 결제가 끝나면 비어 있다
    const tableManualDiscountValue = null;  // 〃
    const VIP_DISCOUNT_RATES_CLIENT = { te95: 0.95, vip9: 0.9 };
    const computeCombinedDiscountClient = () => ({ total: 0 });
    const fullEligibleClientTotal = (o) => o.total;
    const discountEligibleClientTotal = (o) => o.total;
    function orderPaidAmount(o) {
      return Math.max(0, Number((o && o.total) || 0) - Number((o && o.discount_amount) || 0));
    }
    function paidOrderDiscount(o) {
      if (!o || o.status !== "paid") return 0;
      const off = Number(o.discount_amount || 0);
      return off > 0 ? off : 0;
    }
  `;
  // eslint-disable-next-line no-new-func
  return new Function(`${helpers}\n${body}\n return computeTicketDiscountInfo;`)();
})();
check("규칙을 떼어낼 수 있다", typeof ticketInfoOf === "function");

if (typeof ticketInfoOf === "function") {
  const paid = { id: 1, status: "paid", total: 470, discount_amount: 23, items: [] };
  const info = ticketInfoOf(paid);
  check("★ 결제된 주문에 할인이 살아 있다", info.active === true, JSON.stringify(info));
  check("★ 최종 결제금액이 들어 있다", info.discountedTotal === 447, JSON.stringify(info));
  check(
    "★ 품목별로 나눠 찍지 않는다 — 나중에는 얼마씩 깎였는지 알 수 없다",
    info.isPercent === false,
    JSON.stringify(info)
  );
  const plain = ticketInfoOf({ id: 2, status: "paid", total: 470, items: [] });
  check("할인 없이 결제된 주문은 그대로", plain.active === false, JSON.stringify(plain));
}

// 종이까지 실제로 이어지는지 본다. buildEscPosTicket 은 순수 문자열이라
// 여기서 그대로 돌릴 수 있다.
const sandbox = { window: {} };
// eslint-disable-next-line no-new-func
new Function("window", escposSrc)(sandbox.window);
const buildEscPosTicket = sandbox.window.buildEscPosTicket;
check("종이 만드는 함수를 부를 수 있다", typeof buildEscPosTicket === "function");

if (typeof buildEscPosTicket === "function" && typeof ticketInfoOf === "function") {
  const o = {
    id: 77,
    status: "paid",
    total: 470,
    discount_amount: 23,
    table_number: "10",
    created_at: "2026-09-16 11:57:00",
    order_type: "dine_in",
    items: [{ name_zh: "石鍋拌飯", name_ko: "돌솥비빔밥", qty: 1, price: 470 }],
  };
  const text = buildEscPosTicket(o, "한국관", { priceCopy: true, discount: ticketInfoOf(o) });
  check("★ 종이에 최종 결제금액이 찍힌다", text.includes("NT$447"), text.slice(-200));
  check("★ 할인 전 금액도 같이 보인다 — 손님이 물으면 그 자리에서 답한다", text.includes("NT$470"), "");
  check("★ 깎였다는 것이 보인다", /NT\$470\s*→\s*NT\$447/.test(text), text.slice(-200));

  const noDiscount = { ...o, discount_amount: 0 };
  const plainText = buildEscPosTicket(noDiscount, "한국관", { priceCopy: true, discount: ticketInfoOf(noDiscount) });
  check("할인이 없으면 화살표가 없다", !/→/.test(plainText.split("合計")[1] || ""), "");
}

out.push("\n[화면 — 결제완료 카드]");
check(
  "★ 카드가 받은 돈을 쓴다",
  /cardTotalHtml[\s\S]{0,400}?orderPaidAmount\(o\)/.test(admin),
  "o.total 을 그대로 쓰면 서랍과 안 맞는다"
);
check(
  "★ 할인 전 금액과 깎아준 돈을 같이 보여준다",
  /fmtCardDiscountNote\(o\.total, cardOff\)/.test(admin),
  "받은 돈만 있으면 「왜 470이 아니라 447이지」 가 된다"
);
check(
  "할인이 없는 주문은 예전 그대로다",
  /cardOff > 0[\s\S]{0,400}?`<div class="order-card-total">NT\$\$\{o\.total\}<\/div>`/.test(admin),
  ""
);
check("두 번째 줄에 자리(css)가 있다", /\.order-card-total-was/.test(fs.readFileSync(path.join(__dirname, "../public/css/admin.css"), "utf8")), "");
for (const k of ["原價", "할인 전"]) {
  check(`카드 문구가 있다 (${k})`, admin.includes(k), "");
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
