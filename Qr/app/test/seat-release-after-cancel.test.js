// 다 내고 나간 자리가 비워지는가 — 마지막 주문이 「취소」로 끝났을 때.
//
// 사장님(2026-09-14, 손님 폰 사진과 함께): "이미 먹고 나간 손님것까지
// 주문내용에 떠."
//
// 6번 테이블 기록이 이랬다.
//
//     12:05:47  4명 착석
//     12:06:20  주문 658 (1,640)
//     12:09:07  주문 660 (650)
//     12:09:23  658 결제완료   ← 660 이 남아 있어 자리를 안 비운다 (맞다)
//     12:13:21  660 취소       ← 여기서 멈췄다
//
// 받을 돈이 하나도 없는데 자리만 잡힌 채로 남았다. 그러면 다음 손님 폰은
// 인원수를 묻지 않고 앞 손님 착석 시각을 물려받아, 앞 손님의 「已結帳 1,640」
// 을 그대로 보여준다. 남의 계산서를 보게 되는 것이다.
//
// 취소가 자리를 안 비우는 규칙 자체는 옳다 — 재료가 떨어져 한 접시를
// 취소했다고 앉아 계신 손님을 내보내면 안 된다. 그래서 **결제한 적이 있는
// 자리**만 예외로 둔다. 이 시험이 그 두 경우를 모두 지킨다.
const path = require("path");
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};
process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";

const db = require("../src/db");
const { store, connectDB, getDb, ORDERS_COLLECTION } = db;
const { paidInSeating, openOrdersForTable } = require("../src/orderQueries");
const { clearPartySizeIfSettled } = require("../src/partySize");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

// 착석 시각은 UTC 로 저장되고 주문 시각은 대만 문자열이다(src/partySize.js
// seatingStartOf 가 +8 을 해서 맞춘다). 그 변환을 그대로 태운다.
const SEAT_UTC = "2026-09-14T04:05:47.908Z";       // 대만 12:05:47
const AFTER = "2026-09-14 12:06:20";
const BEFORE = "2026-09-14 11:40:00";              // 앞 착석의 주문

async function reset(orders) {
  const col = getDb().collection(ORDERS_COLLECTION);
  await col.deleteMany({});
  for (const o of orders) await col.insertOne({ ...o, _id: o.id });
  store.settings = { service_started_at: "2026-09-14 00:00:00" };
  store.tables = [
    { number: "6", party_size: 4, party_adults: 4, party_children: 0, party_size_updated_at: SEAT_UTC },
    { number: "9", is_counter: true, party_size: null },
  ];
  store.orders = [];
}

// 라우트가 하는 판단을 그대로 재현한다(src/routes/orders.js 의 cancelled 갈래).
async function cancelDecision(tableNumber) {
  const remaining = await openOrdersForTable(store, tableNumber);
  if (remaining.length) return false;
  const table = store.tables.find((t) => String(t.number) === String(tableNumber));
  const paid = await paidInSeating(store, table);
  if (!paid.length) return false;
  return clearPartySizeIfSettled({ ...store, orders: remaining }, tableNumber);
}

(async () => {
  await connectDB();

  out.push("[그날의 6번 테이블 — 결제 뒤 남은 주문이 취소됐다]");
  await reset([
    { id: 658, table_number: "6", status: "paid", total: 1640, created_at: AFTER, items: [] },
    { id: 660, table_number: "6", status: "cancelled", total: 650, created_at: "2026-09-14 12:09:07", items: [] },
  ]);
  const cleared = await cancelDecision("6");
  check("★ 자리가 비워진다", cleared === true);
  check("★ 인원수가 지워졌다", store.tables[0].party_size === null, JSON.stringify(store.tables[0]));
  check("★ 착석 시각도 지워졌다 — 다음 손님이 물려받지 않는다", store.tables[0].party_size_updated_at === null);

  out.push("\n[앉아 계신 손님이 한 접시 취소한 경우 — 건드리면 안 된다]");
  // 결제가 한 번도 없었다. 손님은 그대로 앉아 계신다.
  await reset([
    { id: 700, table_number: "6", status: "cancelled", total: 300, created_at: AFTER, items: [] },
  ]);
  check("★ 자리를 안 비운다", (await cancelDecision("6")) === false);
  check("★ 인원수가 그대로다", store.tables[0].party_size === 4);

  out.push("\n[아직 안 낸 주문이 남아 있으면 — 건드리면 안 된다]");
  await reset([
    { id: 710, table_number: "6", status: "paid", total: 1000, created_at: AFTER, items: [] },
    { id: 711, table_number: "6", status: "served", total: 500, created_at: AFTER, items: [] },
    { id: 712, table_number: "6", status: "cancelled", total: 200, created_at: AFTER, items: [] },
  ]);
  check("★ 자리를 안 비운다 (받을 돈이 남았다)", (await cancelDecision("6")) === false);
  check("인원수가 그대로다", store.tables[0].party_size === 4);

  out.push("\n[앞 착석의 결제는 세지 않는다]");
  // 착석 시각보다 앞선 결제는 지난 손님 것이다. 그것을 근거로 지금 앉아
  // 계신 손님의 자리를 비우면 안 된다.
  await reset([
    { id: 720, table_number: "6", status: "paid", total: 900, created_at: BEFORE, items: [] },
    { id: 721, table_number: "6", status: "cancelled", total: 300, created_at: AFTER, items: [] },
  ]);
  const paidOld = await paidInSeating(store, store.tables[0]);
  check("★ 착석 전 결제는 안 잡힌다", paidOld.length === 0, JSON.stringify(paidOld.map((o) => o.id)));
  check("★ 그래서 자리를 안 비운다", (await cancelDecision("6")) === false);

  out.push("\n[포장 카운터는 해당 없다]");
  // 「이 자리에 몇 명」이 성립하지 않는 자리다.
  await reset([{ id: 730, table_number: "9", status: "paid", total: 500, created_at: AFTER, items: [] }]);
  const counter = store.tables.find((t) => t.is_counter);
  check("★ 카운터는 결제를 세지 않는다", (await paidInSeating(store, counter)).length === 0);

  out.push("\n[착석 시각이 없으면 세지 않는다]");
  await reset([{ id: 740, table_number: "6", status: "paid", total: 500, created_at: AFTER, items: [] }]);
  store.tables[0].party_size = null;
  store.tables[0].party_size_updated_at = null;
  check("★ 앉은 기록이 없으면 빈 결과", (await paidInSeating(store, store.tables[0])).length === 0);

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log(out.join("\n"));
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
