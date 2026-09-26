// 결산의 테이블 수 — 그리고 위 숫자와 아래 지난 주문 목록 숫자가 같은 말을 하는가.
//
// 2026-09-26 사장님: "지금 결산탭에 오전 오후 그리고 하루 전체, 기간 전체
// 테이블 수는 안나와있어. 시킨 모든 메뉴가 결제 되어야 한 테이블이 끝난거고
// 테이블 회전시간도 그걸 바탕으로 계산하고 있었을 거야. 그리고 보면 밑에
// 오늘 나온 영수증들 다시 보는 거의 숫자와 맨 위에 주문 건수랑 숫자가 달라"
//
// ── 원인
//
//   · 위는 「결제 완료 주문 N건」 — 라운드 수. 한 테이블이 세 번 시키면 3.
//   · 아래는 결제 번호로 묶은 줄 수 — 취소·미결제 줄까지 섞여 있었다.
//   · 회전 시간은 안 낸 라운드가 남은 팀도 쟀고, 포장 카운터는 하루 포장
//     손님 전체를 한 팀으로 묶어 몇 시간짜리 숫자를 만들었다.
//
// ── 이 시험이 지키는 선
//
//   · 한 테이블 = 한 번 앉은 손님, 시킨 것이 **전부** 결제돼야 끝난 것
//   · 오전 + 오후 = 하루 전체
//   · 포장은 테이블이 아니다 — 따로 센다
//   · 같은 주문 묶음으로 위(서버)와 아래(목록)가 같은 숫자를 낸다  ← 증상
const fs = require("fs");
const path = require("path");
const { computeSettlement, visitKeyOf, halfOf } = require("../src/settlement");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const D = "2026-09-25";
let seq = 0;
function order(table, created, over = {}) {
  seq += 1;
  const paid = (over.status || "paid") === "paid";
  const paidAt = over.paid_at || null;
  return Object.assign(
    {
      id: seq,
      table_number: String(table),
      status: "paid",
      created_at: `${D} ${created}:00`,
      updated_at: `${D} ${paidAt || created}:00`,
      total: 300,
      party_size: 2,
      items: [{ name_ko: "밥", qty: 1, unit_price: 300, paid, ...(paid && paidAt ? { paid_at: `${D} ${paidAt}:00` } : {}) }],
    },
    over,
    { paid_at: undefined }
  );
}

const orders = [
  // 5번 점심 손님 — 세 번 나눠 시키고 한 번에 냈다. 한 테이블.
  order(5, "11:10", { seating: `${D} 11:05:00`, service_period: "am", paid_at: "12:10", payment_ids: [1] }),
  order(5, "11:30", { seating: `${D} 11:05:00`, service_period: "am", paid_at: "12:10", payment_ids: [1] }),
  order(5, "11:50", { seating: `${D} 11:05:00`, service_period: "am", paid_at: "12:10", payment_ids: [1] }),
  // 7번 — 친구끼리 따로 냈다(결제 번호 둘). 그래도 한 번 앉은 한 테이블.
  order(7, "11:20", { seating: `${D} 11:15:00`, service_period: "am", paid_at: "12:20", payment_ids: [2] }),
  order(7, "11:25", { seating: `${D} 11:15:00`, service_period: "am", paid_at: "12:21", payment_ids: [3] }),
  // 5번 저녁 — 같은 자리 다음 손님. 한 라운드는 취소됐다(테이블을 안 붙잡는다).
  order(5, "17:10", { seating: `${D} 17:05:00`, service_period: "pm", paid_at: "18:00", payment_ids: [4] }),
  order(5, "17:20", { seating: `${D} 17:05:00`, service_period: "pm", status: "cancelled" }),
  // 9번 저녁 — 한 라운드는 냈고 한 라운드는 아직. 끝나지 않은 테이블.
  order(9, "17:30", { seating: `${D} 17:25:00`, service_period: "pm", paid_at: "17:50", payment_ids: [5] }),
  order(9, "18:10", { seating: `${D} 17:25:00`, service_period: "pm", status: "served" }),
  // 포장 카운터 — 서로 무관한 손님 셋. 한 명은 점심, 둘은 저녁.
  order("COUNTER", "11:40", { service_period: "am", pickup_number: 1, customer_name: "A", paid_at: "11:45", party_size: null }),
  order("COUNTER", "17:00", { service_period: "pm", pickup_number: 2, customer_name: "B", paid_at: "17:05", party_size: null }),
  order("COUNTER", "19:30", { service_period: "pm", pickup_number: 3, customer_name: "C", paid_at: "19:35", party_size: null }),
  // pickup_number 가 생기기 전의 옛 카운터 주문 — 카운터 자리 번호로 가린다.
  order("COUNTER", "18:30", { service_period: "pm", paid_at: "18:35", party_size: null }),
  // VIP 카드 판매는 테이블이 아니다.
  order("COUNTER", "12:00", { service_period: "am", paid_at: "12:00", kind: "vip_card_sale", party_size: null }),
];
const opts = { counterTables: ["COUNTER"], eveningStartsAt: "16:30" };

out.push("[한 테이블 = 시킨 것이 전부 결제된 한 번 앉은 손님]");
const s = computeSettlement(orders, D, D, opts);
check("★ 하루 전체 테이블 3 (5번 점심·7번·5번 저녁 — 9번은 아직)", s.table_count === 3, `${s.table_count}`);
check("★ 포장은 테이블이 아니다 — 따로 4", s.takeout_count === 4, `${s.takeout_count}`);
check("★ 아직 앉아 계신 9번을 뺐다고 말한다", s.open_table_count === 1, `${s.open_table_count}`);
// 사장님(2026-09-26): "애초에 우리 테이블 세는 걸 그 고객 하나로 세는 그
// 로직이랑 같잖아 ... 주문 건수 말하고 있잖아" — 주문 1건 = 손님 한 팀.
check("★★ 주문 건수 = 테이블 3 + 포장 4 = 7 (라운드 12 가 아니다)", s.paid_order_count === 7, `${s.paid_order_count}`);
check("라운드 수는 따로 남는다", s.paid_round_count === 12, `${s.paid_round_count}`);
check("★ 주문당 평균도 팀으로 나눈다", s.avg_per_order === Math.round(s.total_revenue / 7), `${s.avg_per_order}`);
{
  const cash = orders.map((o) => Object.assign({}, o, { payment_method: "cash" }));
  const c = computeSettlement(cash, D, D, opts);
  const m = c.payment_method_breakdown.find((x) => x.method === "cash");
  check("★ 결제수단별 건수도 팀으로 센다(7)", m && m.order_count === 7, JSON.stringify(m));
  const t5 = c.table_breakdown.find((x) => x.table_number === "5");
  check("★ 테이블별 건수 — 5번은 점심·저녁 두 팀(라운드 4 가 아니다)", t5 && t5.order_count === 2, JSON.stringify(t5));
  const types = c.order_type_breakdown.reduce((a, e) => a + e.order_count, 0);
  check("★ 매장/포장 건수를 더하면 주문 건수", types === 7, `${types}`);
}

out.push("\n[오전 + 오후 = 하루 전체]");
const am = s.half_split.am;
const pm = s.half_split.pm;
check("★ 오전 테이블 2 (5번·7번)", am.table_count === 2, `${am.table_count}`);
check("★ 오전 주문 건수 = 테이블 2 + 포장 1", am.paid_order_count === 3, `${am.paid_order_count}`);
check("★★ 오전 + 오후 주문 건수 = 하루", am.paid_order_count + pm.paid_order_count === s.paid_order_count, `${am.paid_order_count}+${pm.paid_order_count}`);
check("★ 오후 테이블 1 (5번 저녁)", pm.table_count === 1, `${pm.table_count}`);
check("★★ 오전 + 오후 테이블 = 하루", am.table_count + pm.table_count === s.table_count, `${am.table_count}+${pm.table_count} vs ${s.table_count}`);
check("★★ 오전 + 오후 포장 = 하루", am.takeout_count + pm.takeout_count === s.takeout_count, `${am.takeout_count}+${pm.takeout_count}`);
const amOnly = computeSettlement(orders, D, D, { ...opts, shift: "am" });
check("★ 「오전만 보기」의 테이블 수가 오전 칸과 같다", amOnly.table_count === am.table_count, `${amOnly.table_count}`);

out.push("\n[기간 전체]");
const D2 = "2026-09-26";
const nextDay = [
  Object.assign(order(3, "11:00", { seating: `${D2} 10:55:00`, service_period: "am", paid_at: "11:40" }), {
    created_at: `${D2} 11:00:00`,
    updated_at: `${D2} 11:40:00`,
    items: [{ name_ko: "밥", qty: 1, unit_price: 300, paid: true, paid_at: `${D2} 11:40:00` }],
  }),
];
const range = computeSettlement(orders.concat(nextDay), D, D2, opts);
check("★ 이틀을 보면 테이블이 더해진다(3 + 1)", range.table_count === 4, `${range.table_count}`);

out.push("\n[회전 시간 — 끝난 테이블만, 포장은 빼고]");
// 5번 점심 11:10→12:10 = 60, 7번 11:20→12:21 = 61, 5번 저녁 17:10→18:00 = 50.
// 평균 (60+61+50)/3 = 57. 9번(안 끝남)과 포장이 섞이면 이 값이 아니다.
check("★ 평균 57분", s.avg_turnover_minutes === 57, `${s.avg_turnover_minutes}`);
{
  // 결제 뒤에 updated_at 이 움직여도(메모 수정 등) 회전 시간은 그대로다.
  const moved = orders.map((o) => (o.id === 1 ? Object.assign({}, o, { updated_at: `${D} 23:00:00` }) : o));
  check("결제 뒤 수정이 회전 시간을 늘리지 않는다", computeSettlement(moved, D, D, opts).avg_turnover_minutes === 57, "");
}

out.push("\n[★★ 위 숫자와 아래 지난 주문 목록이 같은 말을 한다 — 사장님이 본 증상]");
const admin = fs.readFileSync(path.join(__dirname, "../public/js/admin.js"), "utf8");
function fnSource(src, name) {
  const head = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(src);
  if (!head) return null;
  let i = src.indexOf("{", head.index);
  let depth = 0;
  for (let end = i; end < src.length; end++) {
    if (src[end] === "{") depth++;
    else if (src[end] === "}") {
      depth--;
      if (depth === 0) return src.slice(head.index, end + 1);
    }
  }
  return null;
}
const I18N = {
  settlementTables: "테이블",
  settlementTakeouts: "포장",
  settlementCountSuffix: "건",
  settlementOrdersN: "주문 {n}건",
  settlementOrdersOpenGroups: " · 아직 결제 안 끝남 {n}",
  settlementOrdersCancelledGroups: " · 취소 {n}",
  settlementPaidCount: "결제 완료 주문",
};
let fns = null;
try {
  fns = new Function(
    "isCounterOrder",
    "T",
    [
      fnSource(admin, "groupSettlementOrders"),
      fnSource(admin, "fmtVisitCounts"),
      fnSource(admin, "fmtSettlementOrdersCount"),
      fnSource(admin, "fmtSettlementHeroSub"),
      "return { groupSettlementOrders, fmtSettlementOrdersCount, fmtSettlementHeroSub };",
    ].join("\n")
  )((o) => o.table_number === "COUNTER", (k) => I18N[k]);
} catch (e) {
  check("화면 함수를 떼어낼 수 있다", false, String(e && e.message));
}
if (fns) {
  // 서버의 /history 가 붙여주는 열쇠 그대로(src/routes/orders.js).
  const history = orders.map((o) => Object.assign({}, o, { visit_key: visitKeyOf(o, halfOf(o, opts), opts) }));
  const groups = fns.groupSettlementOrders(history);
  const listLine = fns.fmtSettlementOrdersCount(groups, history);
  const heroLine = fns.fmtSettlementHeroSub(s);
  check("★ 7번(따로 낸 친구들)은 목록에서도 한 줄", groups.filter((g) => g[0].table_number === "7").length === 1, "");
  check("★ 포장은 목록에서 각자 한 줄", groups.filter((g) => g[0].table_number === "COUNTER").length === 5, "");
  const core = (line) => line.replace(/^[^·]*· /, "").replace(/ · 아직.*$| · 취소.*$/, "");
  check(
    "★★ 위 「주문 N건 (테이블 · 포장)」과 목록 머리줄이 글자 그대로 같다",
    core(heroLine) === fns.fmtSettlementOrdersCount(groups, history).split(" · 아직")[0].split(" · 취소")[0],
    `위: ${heroLine}\n        목록: ${listLine}`
  );
  check("★ 목록은 끝나지 않은 줄을 따로 말한다", /아직 결제 안 끝남 1/.test(listLine), listLine);
  out.push(`        위:   ${heroLine}`);
  out.push(`        목록: ${listLine}`);
}

out.push("\n[화면에 자리가 있다]");
const html = fs.readFileSync(path.join(__dirname, "../public/admin.html"), "utf8");
for (const id of ["settlementTableCount", "settlementAmTables", "settlementPmTables"]) {
  check(`#${id} 칸이 있다`, html.includes(`id="${id}"`), "");
}
for (const k of Object.keys(I18N).concat(["settlementTableCount", "settlementTableCountSub", "settlementTableCountOpen"])) {
  const hits = admin.split(`${k}:`).length - 1;
  check(`${k} 가 두 언어에 다 있다`, hits >= 2, `${hits}`);
}
const ordersRoute = fs.readFileSync(path.join(__dirname, "../src/routes/orders.js"), "utf8");
check("★ /history 가 결산과 같은 함수로 열쇠를 붙인다", /visit_key: visitKeyOf\(/.test(ordersRoute), "");

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
