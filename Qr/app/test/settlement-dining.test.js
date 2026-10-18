// 2시간 넘게 안 낸 주문 — 손님이 아직 앉아 계시면 「⚠ 미결제」가 아니라 「🍽 식사 중」.
//
// 2026-10-18 사장님: 10-17 A3 손님이 17:34 부터 일곱 번 나눠 시키며 드시는 중이었는데, 21:19 결산 화면에
// 「⚠️ 미결제/문제 주문 2건 · NT$5,170」이 떴다. 다 드시고 내자 사라져서 「뭐야?」가 됐다. 「아직 드시는
// 중」과 「진짜 안 받은 돈」을 가른다 — 기준은 그 자리에 지금 인원이 적혀 있고(손님이 앉아 계심) 주문이
// 그 손님이 앉은 뒤에 들어왔느냐다(src/settlement.js isDining, src/routes/settlements.js seatings).
const { computeSettlement } = require("../src/settlement");
const { nowLocal } = require("../src/time");

let pass = 0;
let fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}  ${extra}`); }
}

// 지금으로부터 h 시간 전 — nowLocal() 과 같은 「타이베이 벽시계」 문자열로.
const ago = (h) => {
  const t = new Date(new Date(nowLocal().replace(" ", "T") + "Z").getTime() - h * 3600 * 1000);
  return t.toISOString().slice(0, 19).replace("T", " ");
};
const day = nowLocal().slice(0, 10);
const order = (id, table, h, total, status = "served") => ({
  id, table_number: table, status, created_at: ago(h), updated_at: ago(h), total,
  items: [{ item_id: 1, name_ko: "삼겹살", qty: 1, unit_price: total }],
});

const orders = [
  order(1, "A3", 2.8, 2800),         // A3 손님 첫 라운드 — 아직 드시는 중
  order(2, "A3", 2.1, 2370),         // A3 두 번째 — 아직 드시는 중
  order(3, "A3", 0.5, 400),          // A3 방금 — 2시간 안 됨, 어디에도 안 잡힌다
  order(4, "7", 3, 710),             // 7번 — 자리가 비었는데 안 낸 것: 진짜 미결제
  order(5, "9", 4, 500),             // 9번 앞 손님이 안 내고 간 것 — 지금 손님은 그 뒤에 앉았다
  order(6, "9", 2.2, 300),           // 9번 지금 손님
];
// 같은 날 범위 안에 있어야 센다. 자정 직후에 돌면 몇 시간 전이 어제라 빠진다 — 그때는 건너뛴다.
if (orders.some((o) => o.created_at.slice(0, 10) !== day)) {
  console.log("  (자정 직후라 몇 시간 전이 어제 — 건너뜀)\n\n0 passed, 0 failed");
  process.exit(0);
}
const seatings = { A3: ago(2.9), 9: ago(2.4) };

const before = computeSettlement(orders, day, day, {});
check(`예전처럼 앉은 자리를 모르면 2시간 넘은 것은 다 미결제 (${before.problem_order_count}건)`, before.problem_order_count === 5, "");

const r = computeSettlement(orders, day, day, { seatings });
check(`★★ A3 처럼 아직 앉아 계신 손님 것은 「식사 중」 (${r.dining_order_count}건 · NT$${r.dining_amount})`, r.dining_order_count === 3 && r.dining_amount === 2800 + 2370 + 300, JSON.stringify({ c: r.dining_order_count, a: r.dining_amount }));
check(`★★ 「⚠ 미결제」에는 진짜 안 받은 것만 — 빈 자리 7번, 9번 앞 손님 (${r.problem_orders.map((o) => o.id).join(",")})`, r.problem_order_count === 2 && r.problem_orders.map((o) => o.id).sort().join() === "4,5" && r.problem_amount === 710 + 500, JSON.stringify(r.problem_orders.map((o) => o.id)));
check("어느 자리인지 적는다", r.dining_tables.sort().join() === "9,A3", JSON.stringify(r.dining_tables));
check("2시간 안 된 것은 어디에도 안 잡힌다", ![...r.problem_orders.map((o) => o.id)].includes(3), "");
check("매출은 그대로(낸 것이 없다)", r.total_revenue === 0 && before.total_revenue === 0, "");

// 2026-10-18 사장님: "3시간으로 해줘 직원이 누르는 건 불가능 할 것 같아" — 안 내고 나가도(먹튀·누르기 잊음)
// 자리에 인원이 남는다. 앉은 지 3시간이 넘으면 앉아 계셔도 다시 미결제다.
const long = computeSettlement(orders, day, day, { seatings: { A3: ago(3.1), 9: ago(2.4) } });
check(`★★ 앉은 지 3시간 넘은 A3 는 다시 「⚠ 미결제」 (미결제 ${long.problem_order_count} · 식사 중 ${long.dining_order_count})`,
  long.problem_orders.map((o) => o.id).sort().join() === "1,2,4,5" && long.dining_order_count === 1 && long.dining_tables.join() === "9",
  JSON.stringify({ p: long.problem_orders.map((o) => o.id), d: long.dining_tables }));
const edge = computeSettlement(orders, day, day, { seatings: { A3: ago(2.99) } });
check("3시간 바로 전까지는 식사 중", edge.dining_tables.includes("A3"), JSON.stringify(edge.dining_tables));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
