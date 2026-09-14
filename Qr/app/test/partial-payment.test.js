// 부분결제한 돈이 어디로 가는가.
//
// 사장님(2026-09-14, 화면 세 장과 함께): "1. 결산에서는 이미 740元 결제완료
// 되었는데 / 2. 신규주문에는 아직도 조리중 상태 / 3. 결제탭에서는 일부
// 결제완료했다고 490元으로 결제된다는 내용이고"
//
// 실제 데이터(주문 659, 19번 테이블)는 이랬다.
//
//     상태     preparing        740 중 250 만 받음
//     품목     동판불고기(소)   250  미결제
//              동판불고기(돼지) 250  결제완료 @12:14:19
//              해물파전         240  미결제
//
// 두 가지가 틀려 있었다.
//
//   1. 250 만 냈는데 **주문 전체**에 payment_method="cash" 가 박혔다.
//      결산 목록이 그걸 보고 "결제: 현금"을 띄우고, 옆의 합계 740 과 붙어
//      740 을 다 받은 것처럼 읽혔다.
//   2. 매출은 「상태 = 결제완료」인 주문만 센다. 659 는 조리중이라 한 푼도
//      안 잡혔다. **서랍에 250 이 있고 장부에 0 이다.**
const path = require("path");
const { computeSettlement } = require("../src/settlement");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const D = "2026-09-14";
const item = (name, price, paid, method) => ({
  item_id: 1, name_ko: name, name_zh: name, qty: 1, unit_price: price,
  selected_addons: [], order_type: "dine_in",
  ...(paid ? { paid: true, paid_at: `${D} 12:14:19`, payment_method: method || "cash" } : {}),
});

// 그날의 659 번
const partialOrder = {
  id: 659, table_number: "19", status: "preparing", total: 740, subtotal: 740,
  created_at: `${D} 12:07:14`, updated_at: `${D} 12:14:19`,
  items: [item("동판불고기", 250, false), item("동판불고기", 250, true), item("해물파전", 240, false)],
};
const paidOrder = {
  id: 657, table_number: "19", status: "paid", total: 1310, subtotal: 1310,
  created_at: `${D} 12:05:07`, updated_at: `${D} 12:09:51`, payment_method: "cash",
  items: [item("떡볶이", 1310, true)],
};

(async () => {
  const s = computeSettlement([paidOrder, partialOrder], D, D, {});

  out.push("[매출 숫자는 건드리지 않는다]");
  // 그 주문이 다 결제되면 740 **전체**가 그때 매출로 잡힌다. 여기서 250 을
  // 미리 더해두면 같은 돈이 두 번 세어진다.
  check("★ 매출에는 결제완료 주문만 들어간다", s.total_revenue === 1310, String(s.total_revenue));
  check("★ 부분결제 250 을 매출에 더하지 않는다", s.total_revenue !== 1560);

  out.push("\n[대신 따로 한 줄로 보여준다]");
  const p = s.partial_paid;
  check("★ 부분결제 칸이 있다", !!p, JSON.stringify(Object.keys(s)).slice(0, 200));
  check("★ 미리 받은 돈 250", p && p.received === 250, p && String(p.received));
  check("★ 아직 못 받은 돈 490", p && p.outstanding === 490, p && String(p.outstanding));
  check("★ 어느 자리인지 적는다", p && p.orders.length === 1 && p.orders[0].table_number === "19",
    p && JSON.stringify(p.orders));
  check("주문번호도 적는다", p && p.orders[0].id === 659);
  check("마지막으로 받은 시각을 적는다", p && p.orders[0].last_paid_at === `${D} 12:14:19`);

  out.push("\n[현금을 세면 맞아떨어진다]");
  // 결산 매출 + 부분결제로 받은 돈 = 서랍에 있어야 할 돈
  check("★ 1,310 + 250 = 1,560", s.total_revenue + p.received === 1560);

  out.push("\n[다 결제된 주문은 여기 안 들어온다]");
  const s2 = computeSettlement([paidOrder], D, D, {});
  check("★ 부분결제 0", s2.partial_paid.received === 0 && s2.partial_paid.orders.length === 0);

  out.push("\n[취소된 주문도 안 들어온다]");
  const cancelled = { ...partialOrder, id: 700, status: "cancelled" };
  const s3 = computeSettlement([cancelled], D, D, {});
  check("★ 취소는 세지 않는다", s3.partial_paid.received === 0, JSON.stringify(s3.partial_paid));

  out.push("\n[주문 전체에 결제수단을 박지 않는다]");
  // 250 만 냈는데 주문 한 건이 통째로 「현금으로 결제된 주문」의 모양을
  // 가지면, 그걸 보여주는 모든 화면이 거짓말을 하게 된다.
  const fs = require("fs");
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "orders.js"), "utf8");
  const splitPay = src.slice(src.indexOf('router.patch("/:id/split-pay"'));
  const body = splitPay.slice(0, splitPay.indexOf("\n});"));
  check("★ 부분결제 직후에는 주문 전체에 안 박는다",
    !/^\s*if \(paymentMethod\) order\.payment_method = paymentMethod;/m.test(body),
    "여기서 박으면 결산 목록이 「결제: 현금」으로 보여준다");
  check("★ 전부 결제됐을 때만 정한다", /allPaid\)\s*\{[\s\S]{0,500}order\.payment_method =/.test(body));
  check("품목별 결제수단은 그대로 적는다", /order\.items\[i\]\.payment_method = paymentMethod/.test(body));

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
