// 결산이 무엇을 세는가 — 특히 결제수단 합계가 실제 받은 돈과 맞는가.
//
// 2026-09-10 사장님: "결산에서 현금, 카드, linepay 이런 걸로도 분류해서 볼
// 수 있게 해줘 합계 등등 다양하게 그냥 왠만한 모든 걸 기록해서 결산
// 페이지에서 볼 수 있었으면 좋겠어."
//
// 결제수단별 분류는 이미 있었는데, 화면에 "매출 NT$44,301" 과 "결제수단
// 총합 NT$44,990" 이 나란히 떠 있었다. 차이는 할인이다. 이 표를 보는 이유가
// 마감에 서랍의 현금을 맞춰보는 것이라면, 현금 칸이 실제로 받지 않은 돈까지
// 세고 있으면 매일 밤 안 맞는다. 그래서 그 일치가 이 파일의 첫 번째 검사다.
const { computeSettlement } = require("../src/settlement");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const D = "2026-09-09";
const it = (price, qty, method, category = null, type = "dine_in") => ({
  unit_price: price, qty, payment_method: method, category_key: category, order_type: type,
  name_ko: `메뉴${price}`, name_zh: `菜${price}`, item_id: price,
});
const order = (o) => Object.assign({
  status: "paid", created_at: `${D} 12:00:00`, paid_at: `${D} 13:00:00`,
  table_number: "5", order_type: "dine_in", party_size: 2, discount_amount: 0, discount_type: null,
}, o);

out.push("[결제수단 합계가 실제 받은 돈과 맞는가]");
{
  // 할인 없는 평범한 하루
  const plain = computeSettlement([
    order({ id: 1, total: 800, items: [it(500, 1, "cash"), it(300, 1, "card")] }),
    order({ id: 2, total: 450, items: [it(450, 1, "linepay")] }),
  ], D);
  check("할인이 없으면 당연히 맞는다", plain.total_revenue === plain.payment_method_total,
    `${plain.total_revenue} vs ${plain.payment_method_total}`);

  // 할인이 걸린 주문 — 예전에는 여기서 어긋났다
  const withDiscount = computeSettlement([
    order({ id: 1, total: 900, discount_amount: 100, discount_type: "vip10",
      items: [it(500, 1, "cash"), it(500, 1, "card")] }),
    order({ id: 2, total: 300, items: [it(300, 1, "cash")] }),
  ], D);
  check("할인이 있어도 총합이 매출과 정확히 같다",
    withDiscount.total_revenue === withDiscount.payment_method_total,
    `${withDiscount.total_revenue} vs ${withDiscount.payment_method_total}`);
  const cash = withDiscount.payment_method_breakdown.find((p) => p.method === "cash");
  const card = withDiscount.payment_method_breakdown.find((p) => p.method === "card");
  check("할인을 결제수단 비중대로 나눠 뺀다", cash.revenue === 750 && card.revenue === 450,
    `현금 ${cash.revenue}, 카드 ${card.revenue}`);
  check("할인 전 금액도 같이 알려준다", cash.gross === 800 && card.gross === 500,
    `현금 ${cash.gross}, 카드 ${card.gross}`);

  // 반올림이 생기는 경우 — 1원도 새거나 남으면 안 된다
  const rounding = computeSettlement([
    order({ id: 1, total: 333, discount_amount: 67,
      items: [it(200, 1, "cash"), it(200, 1, "card")] }),
  ], D);
  check("반올림이 생겨도 한 원도 안 어긋난다",
    rounding.total_revenue === rounding.payment_method_total,
    `${rounding.total_revenue} vs ${rounding.payment_method_total}`);

  // 여러 주문·여러 수단이 섞인 하루 전체
  const many = computeSettlement(
    Array.from({ length: 50 }, (_, i) => order({
      id: 100 + i,
      total: 1000 - (i % 7) * 37,
      discount_amount: (i % 3) * 37,
      items: [it(600, 1, ["cash", "card", "linepay", "other"][i % 4]), it(400, 1, ["cash", "online"][i % 2])],
    })), D);
  check("50건이 섞여도 총합이 매출과 같다", many.total_revenue === many.payment_method_total,
    `${many.total_revenue} vs ${many.payment_method_total}`);
}

out.push("\n[결제수단 라벨이 다 잡히는가]");
{
  const r = computeSettlement([
    order({ id: 1, total: 100, items: [it(100, 1, "cash")] }),
    order({ id: 2, total: 100, items: [it(100, 1, "linepay")] }),
    order({ id: 3, total: 100, items: [it(100, 1, "card")] }),
    order({ id: 4, total: 100, items: [it(100, 1, "other")] }),
    order({ id: 5, total: 100, items: [it(100, 1, "online")] }),
    // 이 기능이 생기기 전 데이터 — 품목에 결제수단이 없다
    order({ id: 6, total: 100, payment_method: "cash", items: [{ unit_price: 100, qty: 1 }] }),
    // 주문에도 없는 아주 옛 데이터
    order({ id: 7, total: 100, items: [{ unit_price: 100, qty: 1 }] }),
  ], D);
  const methods = r.payment_method_breakdown.map((p) => p.method).sort();
  check("다섯 가지 수단이 다 잡힌다",
    ["card", "cash", "linepay", "online", "other"].every((m) => methods.includes(m)), methods.join(","));
  check("품목에 없으면 주문의 결제수단으로 잡는다",
    r.payment_method_breakdown.find((p) => p.method === "cash").revenue === 200, JSON.stringify(r.payment_method_breakdown));
  check("둘 다 없으면 미지정으로 묶는다", methods.includes("unspecified"), methods.join(","));
}

out.push("\n[매장 / 포장]");
{
  const r = computeSettlement([
    order({ id: 1, total: 1000, order_type: "dine_in", items: [it(1000, 1, "cash")] }),
    order({ id: 2, total: 400, order_type: "takeout", items: [it(400, 1, "cash")] }),
    order({ id: 3, total: 600, order_type: "mixed", items: [it(600, 1, "cash")] }),
  ], D);
  const byType = Object.fromEntries(r.order_type_breakdown.map((e) => [e.order_type, e.revenue]));
  check("매장/포장/섞임을 따로 센다", byType.dine_in === 1000 && byType.takeout === 400 && byType.mixed === 600,
    JSON.stringify(byType));
  check("셋을 더하면 매출과 같다",
    r.order_type_breakdown.reduce((a, e) => a + e.revenue, 0) === r.total_revenue);
  check("건수도 결제 완료 건수와 맞는다",
    r.order_type_breakdown.reduce((a, e) => a + e.order_count, 0) === r.paid_order_count);
}

out.push("\n[분류별 매출]");
{
  const r = computeSettlement([
    order({ id: 1, total: 1000, items: [it(600, 1, "cash", "rice"), it(400, 1, "cash", "drink")] }),
    order({ id: 2, total: 600, items: [it(300, 2, "cash", "rice")] }),
    order({ id: 3, total: 200, items: [it(200, 1, "cash", null)] }),
  ], D);
  const byCat = Object.fromEntries(r.category_breakdown.map((e) => [e.category_key, e.subtotal]));
  check("분류별로 합친다", byCat.rice === 1200 && byCat.drink === 400, JSON.stringify(byCat));
  check("분류가 없는 품목은 따로 묶는다", byCat.uncategorized === 200, JSON.stringify(byCat));
  check("수량도 센다", r.category_breakdown.find((e) => e.category_key === "rice").qty === 3);
  check("매출 큰 분류가 먼저 온다", r.category_breakdown[0].category_key === "rice");
}

out.push("\n[할인]");
{
  const r = computeSettlement([
    order({ id: 1, total: 900, discount_amount: 100, discount_type: "vip10", items: [it(1000, 1, "cash")] }),
    order({ id: 2, total: 950, discount_amount: 50, discount_type: "vip95", items: [it(1000, 1, "cash")] }),
    order({ id: 3, total: 800, discount_amount: 200, discount_type: "manual", items: [it(1000, 1, "cash")] }),
    order({ id: 4, total: 500, items: [it(500, 1, "cash")] }),
  ], D);
  check("할인 총액을 센다", r.discount_total === 350, String(r.discount_total));
  check("종류별로 나눈다", r.discount_breakdown.length === 3, JSON.stringify(r.discount_breakdown));
  check("할인 전 매출 = 매출 + 할인", r.gross_revenue === r.total_revenue + r.discount_total,
    `${r.gross_revenue} vs ${r.total_revenue} + ${r.discount_total}`);
  check("할인 큰 것부터 온다", r.discount_breakdown[0].discount_type === "manual");
  const none = computeSettlement([order({ id: 1, total: 500, items: [it(500, 1, "cash")] })], D);
  check("할인이 없으면 목록도 비어 있다", none.discount_breakdown.length === 0 && none.discount_total === 0);
  check("할인이 없으면 할인 전 매출 = 매출", none.gross_revenue === none.total_revenue);
}

out.push("\n[손님 수와 객단가]");
{
  // 같은 테이블이 여러 번 시켜도 인원은 한 번만 세야 한다 — 안 그러면
  // 추가 주문을 많이 한 날일수록 손님이 많았던 것처럼 나온다.
  const r = computeSettlement([
    order({ id: 1, table_number: "5", party_size: 4, total: 1000, items: [it(1000, 1, "cash")] }),
    order({ id: 2, table_number: "5", party_size: 4, total: 600, items: [it(600, 1, "cash")] }),
    order({ id: 3, table_number: "7", party_size: 2, total: 400, items: [it(400, 1, "cash")] }),
  ], D);
  check("같은 테이블의 추가 주문은 인원을 다시 안 센다", r.guest_count === 6, String(r.guest_count));
  check("주문당 평균", r.avg_per_order === Math.round(2000 / 3), String(r.avg_per_order));
  check("1인당 평균", r.avg_per_guest === Math.round(2000 / 6), String(r.avg_per_guest));
  // 중간에 일행이 합류해 인원이 늘었으면 큰 쪽을 쓴다.
  const grew = computeSettlement([
    order({ id: 1, table_number: "5", party_size: 2, total: 500, items: [it(500, 1, "cash")] }),
    order({ id: 2, table_number: "5", party_size: 5, total: 500, items: [it(500, 1, "cash")] }),
  ], D);
  check("인원이 늘었으면 큰 쪽으로 센다", grew.guest_count === 5, String(grew.guest_count));
  // 같은 테이블이라도 날짜가 다르면 다른 손님이다.
  const twoDays = computeSettlement([
    order({ id: 1, table_number: "5", party_size: 3, total: 500, created_at: "2026-09-09 12:00:00", items: [it(500, 1, "cash")] }),
    order({ id: 2, table_number: "5", party_size: 3, total: 500, created_at: "2026-09-10 12:00:00", items: [it(500, 1, "cash")] }),
  ], "2026-09-09", "2026-09-10");
  check("날짜가 다르면 다른 손님으로 센다", twoDays.guest_count === 6, String(twoDays.guest_count));
  const noParty = computeSettlement([order({ id: 1, party_size: null, total: 500, items: [it(500, 1, "cash")] })], D);
  check("인원수가 없으면 0으로 두고 나눗셈을 안 한다",
    noParty.guest_count === 0 && noParty.avg_per_guest === 0);
}

out.push("\n[취소와 미결제는 금액도 알려준다]");
{
  const twoHoursAgo = "2026-09-09 01:00:00";
  const r = computeSettlement([
    order({ id: 1, total: 1000, items: [it(1000, 1, "cash")] }),
    order({ id: 2, status: "cancelled", total: 700, items: [it(700, 1, "cash")] }),
    order({ id: 3, status: "served", total: 900, created_at: twoHoursAgo, items: [it(900, 1, "cash")] }),
  ], D);
  check("취소 금액을 센다", r.cancelled_amount === 700, String(r.cancelled_amount));
  check("취소는 매출에 안 들어간다", r.total_revenue === 1000, String(r.total_revenue));
  check("미결제 금액을 센다", r.problem_amount === 900, String(r.problem_amount));
  check("미결제도 매출에 안 들어간다", r.total_revenue === 1000);
}

out.push("\n[테이블별 매출]");
{
  const r = computeSettlement([
    order({ id: 1, table_number: "5", total: 1000, items: [it(1000, 1, "cash")] }),
    order({ id: 2, table_number: "5", total: 500, items: [it(500, 1, "cash")] }),
    order({ id: 3, table_number: "COUNTER", total: 800, items: [it(800, 1, "cash")] }),
  ], D);
  check("테이블별로 합친다", r.table_breakdown[0].table_number === "5" && r.table_breakdown[0].revenue === 1500,
    JSON.stringify(r.table_breakdown));
  check("포장 카운터도 한 자리로 잡힌다", r.table_breakdown.some((e) => e.table_number === "COUNTER"));
  check("건수도 센다", r.table_breakdown[0].order_count === 2);
}

out.push("\n[빈 날에도 터지지 않는다]");
{
  const empty = computeSettlement([], D);
  for (const k of ["total_revenue", "gross_revenue", "discount_total", "guest_count",
    "avg_per_order", "avg_per_guest", "cancelled_amount", "problem_amount", "payment_method_total"]) {
    check(`${k} 가 0`, empty[k] === 0, `${k}=${empty[k]}`);
  }
  for (const k of ["order_type_breakdown", "category_breakdown", "discount_breakdown", "table_breakdown"]) {
    check(`${k} 가 빈 목록`, Array.isArray(empty[k]) && empty[k].length === 0);
  }
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
