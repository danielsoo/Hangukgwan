// 주문에 「점심 장사」인지 「저녁 장사」인지를 박아 둔다.
//
// 사장님(2026-09-10): "오전 오후를 정산으로 가르는 거 같은데 그거 말고도
// 시간으로도 가를 수 있잖아. 주문이 들어온 시간을 몽고디비에 오전인지
// 오후인지 같이 저장하면 되는 거 아니야?"
//
// 정산 버튼을 눌렀는지에 기대면, 안 누른 날은 그날 매출을 영영 못 가른다.
// 들어오는 순간에 표를 달아 두면 그런 날이 없다.
//
// ── 이 파일이 지키는 단 하나 ──────────────────────────────────────────
//
//   **기준은 한 곳에만 있다.**
//
// 이 시각이 세 곳에서 같이 쓰인다 — 주문에 다는 표, 자동 오전 정산이 걸리는
// 시각, 결산이 옛 주문을 가르는 경계. 따로 정하면 16:24:59 에 들어온 주문이
// 「오전」 표를 달고 오후 서랍에 들어가는 일이 생긴다.
const fs = require("fs");
const path = require("path");
const { serviceOf, serviceCutAt, serviceCutHm } = require("../src/servicePeriod");
const { computeSettlement } = require("../src/settlement");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}
const D = "2026-09-10";
const TWO = { order_hours: { ranges: [{ start: "11:00", end: "13:35" }, { start: "16:30", end: "20:35" }] } };
const ONE = { order_hours: { ranges: [{ start: "11:00", end: "21:00" }] } };

out.push("[1] 어느 장사 것인가");
{
  check("점심 시간은 오전", serviceOf(TWO, `${D} 11:30:00`) === "am", "");
  check("점심이 끝나고 저녁 전도 오전", serviceOf(TWO, `${D} 14:40:00`) === "am", "");
  check("★ 경계 1초 전은 오전", serviceOf(TWO, `${D} 16:24:59`) === "am", "");
  check("★ 경계 그 순간부터 오후", serviceOf(TWO, `${D} 16:25:00`) === "pm", "");
  check("저녁은 오후", serviceOf(TWO, `${D} 20:00:00`) === "pm", "");
}

out.push("\n[2] 가를 수 없으면 표를 안 단다");
{
  check("★ 한 타임만 하는 날은 null", serviceOf(ONE, `${D} 12:00:00`) === null, String(serviceOf(ONE, `${D} 12:00:00`)));
  check("영업시간이 없어도 터지지 않는다", serviceOf({}, `${D} 12:00:00`) === null, "");
  check("시각이 이상해도 터지지 않는다", serviceOf(TWO, "") === null && serviceOf(TWO, null) === null, "");
  // 없는 것은 「모른다」이지 「오전」이 아니다. 기본값을 오전으로 두면 하루를
  // 통으로 여는 날의 매출이 전부 오전으로 쏠린다.
  check("★ 못 가를 때 오전으로 떨어지지 않는다", serviceOf(ONE, `${D} 20:00:00`) !== "am", "");
}

out.push("\n[3] 기준은 한 곳에만");
{
  check("경계 시각", serviceCutAt(TWO, D) === `${D} 16:25:00`, String(serviceCutAt(TWO, D)));
  check("HH:MM 형태도 같은 값", serviceCutHm(TWO, D) === "16:25", String(serviceCutHm(TWO, D)));

  const settlements = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "settlements.js"), "utf8");
  check("★ 자동 정산이 같은 함수를 쓴다", /function autoAmCutFor\(dateStr\) \{\s*return serviceCutAt\(store\.settings, dateStr\);/.test(settlements), "");
  check("★ 결산 경계도 같은 함수를 쓴다", /function eveningStartHm\(\) \{\s*return serviceCutHm\(store\.settings, taipeiDateString\(\)\);/.test(settlements), "");
  check("시각을 따로 계산하던 코드가 남아 있지 않다", !/AUTO_AM_LEAD_MIN/.test(settlements), "");
}

out.push("\n[4] 주문에 박는다");
{
  const orders = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "orders.js"), "utf8");
  check("주문에 service_period 를 넣는다", /service_period: serviceOf\(store\.settings, createdAt\)/.test(orders), "");
  check("★ 못 가를 때는 칸을 아예 안 만든다", /\.\.\.\(serviceOf\(store\.settings, createdAt\) \? \{ service_period/.test(orders), "");
  // created_at 과 표가 서로 다른 순간을 가리키면 16:24:59 주문이 「오후」로
  // 찍힌다. 시각을 한 번만 읽어서 그럴 수 없게 한다.
  check("★ 시각을 한 번만 읽는다", /const createdAt = nowLocal\(\);/.test(orders) && /created_at: createdAt,/.test(orders), "");
}

out.push("\n[5] 결산이 그 표를 먼저 믿는다");
{
  const o = (id, at, total, sp) => ({
    id, table_number: String(id), status: "paid",
    created_at: `${D} ${at}`, updated_at: `${D} ${at}`,
    total, party_size: 2, party_adults: 2, party_children: 0, items: [],
    ...(sp ? { service_period: sp } : {}),
  });

  // 경계 정보를 아무것도 안 줘도 표가 있으면 갈린다 — 이게 이 기능의 요점이다.
  const s = computeSettlement([o(1, "12:00:00", 1000, "am"), o(2, "18:00:00", 2000, "pm")], D, D, {});
  check("★ 정산을 안 눌러도 갈린다", s.half_split.am.revenue === 1000 && s.half_split.pm.revenue === 2000, JSON.stringify(s.half_split.am.revenue + "/" + s.half_split.pm.revenue));
  check("★ 못 가른 날이 없다", s.half_split.unsplit_dates.length === 0, JSON.stringify(s.half_split.unsplit_dates));

  // 표가 없는 옛 주문은 예전처럼 경계로 가른다.
  const mixed = computeSettlement([o(1, "12:00:00", 1000, "am"), o(2, "12:30:00", 500)], D, D, { eveningStartsAt: "16:25" });
  check("옛 주문은 경계로 가른다", mixed.half_split.am.revenue === 1500, String(mixed.half_split.am.revenue));

  // 경계도 표도 없으면 못 가른 것으로 남기고, 그 금액을 알려준다.
  const none = computeSettlement([o(1, "12:00:00", 1000, "am"), o(2, "12:30:00", 500)], D, D, {});
  check("★ 표 있는 것만 갈리고 나머지는 못 가른 몫", none.half_split.am.revenue === 1000 && none.half_split.unsplit_revenue === 500, JSON.stringify(none.half_split));
  check("합산에는 둘 다 들어 있다", none.total_revenue === 1500, String(none.total_revenue));
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
