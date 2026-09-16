// 결산의 매출이 **실제로 받은 돈**인가.
//
// 2026-09-16 사장님: "1. 할인 후(실제 받은 돈) — 매출 410, 할인은 참고로
// 따로 표시. 이렇게 표시해야 될 것 같아."
//
// ── 왜 틀려 있었나 ─────────────────────────────────────────────────────
//
// order.total 은 할인 **전** 금액이다. 깎아준 돈은 discount_amount 에 따로
// 적힌다(src/routes/orders.js recordDiscount) — 결제할 때 total 을 줄이지
// 않는다. 그런데 결산은 오랫동안 total 을 「받은 돈」으로 알고 써왔다.
// 결제수단별 집계에 `const net = o.total`(= 실제 받은 금액) 이라고 적혀
// 있었던 것이 그 증거다. 그래서 매출이 할인만큼 부풀어 있었다.
//
// 제일 아픈 곳은 결제수단별이다. 마감 때 서랍의 현금을 그 숫자와 맞추는데,
// 깎아준 만큼 서랍이 비어 보인다.
//
// ── 여기서 재는 것 ─────────────────────────────────────────────────────
//
// 숫자를 직접 적어놓고 맞춰보지 않는다. 주문을 넣고 실제로 할인해서 결제한
// 뒤, **서로 맞아야 하는 것들이 맞는지**를 본다. 메뉴 값이 바뀌어도 안 썩는다.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"),
  filename: require.resolve("mongodb"),
  loaded: true,
  exports: fake,
  paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "settlement-net-revenue";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const request = require("supertest");
const app = require("../server");
const { store } = require("../src/db");
const { taipeiDateString } = require("../src/settlement");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}
const sum = (a) => a.reduce((x, y) => x + y, 0);

(async () => {
  const staff = request.agent(app);
  let r = await staff.post("/api/auth/login").send({ password: "ownerpass123" });
  check("로그인된다", r.status === 200, `${r.status}`);
  await require("./disable-order-hours")();

  // 할인이 붙는 품목(음료·기타는 VIP 할인에서 빠진다 — src/discounts.js)
  const dish = store.menuItems.find((m) => m.available && m.price >= 100 && m.category_key !== "drink" && m.category_key !== "other")
    || store.menuItems.find((m) => m.available && m.price > 0);

  async function placeAndPay(table, qty, payBody) {
    const guest = request.agent(app);
    const psr = await guest.put(`/api/tables/${table}/party-size`).send({ adults: 2, children: 0 });
    if (psr.status !== 200) throw new Error(`인원수 실패 ${table}: ${psr.status} ${JSON.stringify(psr.body)}`);
    const res = await guest.post("/api/orders").send({
      tableNumber: String(table),
      items: [{ itemId: dish.id, qty, orderType: "dine_in", addons: [] }],
    });
    if (res.status !== 201) throw new Error(`주문 실패 ${res.status} ${JSON.stringify(res.body)}`);
    const id = res.body.id;
    if (payBody) {
      const pr = await staff.patch(`/api/orders/${id}`).send({ status: "paid", ...payBody });
      if (pr.status !== 200) throw new Error(`결제 실패 ${pr.status} ${JSON.stringify(pr.body)}`);
    }
    return store.orders.find((o) => o.id === id);
  }

  // 1) 정액 재량 할인 (현금)
  const a = await placeAndPay(11, 2, { paymentMethod: "cash", manualDiscountMode: "amount", manualDiscountValue: 50 });
  // 2) 特約95折 (현금만 된다 — 카드 프로그램 규칙)
  const b = await placeAndPay(12, 1, { paymentMethod: "cash", vipDiscountType: "te95" });
  // 3) 할인 없이 LinePay
  const c = await placeAndPay(13, 1, { paymentMethod: "linepay" });
  // 4) 취소된 주문 — 할인을 뺄 근거가 없다
  const d = await placeAndPay(15, 1, null);
  await staff.patch(`/api/orders/${d.id}`).send({ status: "cancelled" });

  const paid = [a, b, c];
  const grossSum = sum(paid.map((o) => o.total || 0));
  const offSum = sum(paid.map((o) => o.discount_amount || 0));
  const netSum = grossSum - offSum;
  check("할인이 실제로 걸렸다", offSum > 0, `${offSum}`);
  check("두 종류가 다 걸렸다", (a.discount_amount || 0) > 0 && (b.discount_amount || 0) > 0, `${a.discount_amount} / ${b.discount_amount}`);

  const today = taipeiDateString();
  r = await staff.get(`/api/settlements?date=${today}`);
  check("결산을 읽는다", r.status === 200, `${r.status}`);
  const s = r.body;

  out.push("\n[매출 — 실제로 받은 돈]");
  check("★ 매출이 할인 후 금액이다", s.total_revenue === netSum, `${s.total_revenue} vs ${netSum}`);
  check("★ 할인 전 금액도 따로 있다", s.gross_revenue === grossSum, `${s.gross_revenue} vs ${grossSum}`);
  check("★ 할인 합계가 둘의 차와 같다", s.gross_revenue - s.total_revenue === s.discount_total, `${s.gross_revenue} - ${s.total_revenue} vs ${s.discount_total}`);
  check("깎인 만큼 줄었다 — 예전 값과 다르다", s.total_revenue < grossSum, `${s.total_revenue} vs ${grossSum}`);

  out.push("\n[결제수단별 — 서랍과 맞아야 한다]");
  const byMethod = new Map((s.payment_method_breakdown || []).map((e) => [e.method, e]));
  const cashPaidForReal = sum(paid.filter((o) => o.payment_method === "cash").map((o) => (o.total || 0) - (o.discount_amount || 0)));
  check("★ 현금이 실제로 서랍에 들어간 돈이다", (byMethod.get("cash") || {}).revenue === cashPaidForReal, `${(byMethod.get("cash") || {}).revenue} vs ${cashPaidForReal}`);
  check("할인 전 금액은 gross 에 따로 남는다", (byMethod.get("cash") || {}).gross === sum(paid.filter((o) => o.payment_method === "cash").map((o) => o.total || 0)), JSON.stringify(byMethod.get("cash")));
  check("★ 결제수단 총합이 매출과 같다", s.payment_method_total === s.total_revenue, `${s.payment_method_total} vs ${s.total_revenue}`);
  check("★ 각 수단의 합도 매출과 같다", sum((s.payment_method_breakdown || []).map((e) => e.revenue)) === s.total_revenue, "");
  check("할인 없는 수단은 그대로다", (byMethod.get("linepay") || {}).revenue === (c.total || 0), `${(byMethod.get("linepay") || {}).revenue} vs ${c.total}`);

  out.push("\n[나머지 집계도 같은 숫자를 쓴다]");
  check("★ 일별 매출", sum((s.daily_breakdown || []).map((e) => e.revenue)) === s.total_revenue, JSON.stringify(s.daily_breakdown));
  check("★ 테이블별 매출", sum((s.table_breakdown || []).map((e) => e.revenue)) === s.total_revenue, "");
  check("★ 매장/포장별 매출", sum((s.order_type_breakdown || []).map((e) => e.revenue)) === s.total_revenue, "");
  check("★ 시간대별 매출", sum((s.hourly_breakdown || []).map((e) => e.revenue)) === s.total_revenue, "");
  check("★ 주문당 평균도 할인 후 기준", s.avg_per_order === Math.round(s.total_revenue / paid.length), `${s.avg_per_order}`);

  out.push("\n[취소·미결제는 할인을 빼지 않는다]");
  // 아직 아무도 할인을 걸지 않았다. 「얼마짜리가 취소됐나」가 맞는 질문이다.
  check("★ 취소 금액은 원래 값 그대로", s.cancelled_amount === (d.total || 0), `${s.cancelled_amount} vs ${d.total}`);
  check("취소 건수도 맞다", s.cancelled_order_count === 1, `${s.cancelled_order_count}`);

  out.push("\n[LINE 문자도 같은 숫자를 쓴다]");
  const { formatShiftSummary } = require("../src/line");
  const text = formatShiftSummary(s, { shift: "day", closedAt: `${today} 21:00:00`, amPart: null, pmPart: null });
  check("★ 문자의 매출이 할인 후 금액이다", text.includes(String(netSum.toLocaleString())), text.split("\n").slice(0, 4).join(" | "));
  check("문자에 할인도 같이 보인다", /할인/.test(text), "");

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
