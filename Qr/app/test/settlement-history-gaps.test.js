// 정산 기록 목록에서 날짜가 사라지지 않는다 — 그리고 사라진 날은 주문으로 다시 채운다.
//
// 2026-09-30 사장님(결산 탭 사진 두 장): "보면 22일 25일 사이에 아무것도
// 없는데 여기서는 데이터가 보여 왜 그래?"
//
// 위 합계는 주문을 그 자리에서 세고, 왼쪽 목록은 저장된 기록(daily_settlements)
// 이다. 23·24·29일 기록이 없었다. 원인은 기록 번호 — store 의 카운터(nextId)로
// 번호를 받았는데, 아침 자동 오전 정산과 밤 마감 미룸은 새 기록을 만들면서
// 그 카운터를 저장하지 않았다. 다음 날 다른 인스턴스가 **같은 번호**를 받아
// replaceOne 으로 **전날 기록을 덮어썼다**.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};
process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "settlement-history-gaps";
process.env.ADMIN_PASSWORD = "ownerpass123";

const fs = require("fs");
const path = require("path");
const request = require("supertest");
const app = require("../server");
const { store, insertOrder, findDocs } = require("../src/db");
const { taipeiDateString } = require("../src/time");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}
const day = (n) => new Date(Date.parse(`${taipeiDateString()}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);

(async () => {
  await request(app).get("/api/menu");
  const boss = request.agent(app);
  await boss.post("/api/auth/login").send({ password: "ownerpass123" });
  const d1 = day(8), d2 = day(7), d3 = day(6), before = day(9);

  out.push("[같은 번호로 전날 기록을 덮어쓰지 않는다]");
  const counter = store.nextId.daily_settlements;
  let r = await boss.post("/api/settlements/close").send({ date: d1 });
  check("첫날 기록", r.status === 200, `${r.status}`);
  // 다른 인스턴스 — 카운터를 저장하지 않은 채 옛 값을 들고 있다.
  store.nextId.daily_settlements = counter;
  r = await boss.post("/api/settlements/close").send({ date: d2 });
  check("둘째 날 기록", r.status === 200, `${r.status}`);
  let rows = await findDocs("daily_settlements", {});
  check("★★ 두 날 모두 남아 있다(예전: 둘째 날이 첫날을 덮었다)", rows.some((x) => x.date === d1) && rows.some((x) => x.date === d2), JSON.stringify(rows.map((x) => [x.id, x.date])));
  check("★ 번호가 날짜다 — 겹칠 수 없다", rows.every((x) => x.id === `ds-${x.date}`), JSON.stringify(rows.map((x) => x.id)));
  const src = fs.readFileSync(path.join(__dirname, "../src/routes/settlements.js"), "utf8");
  check("★ 기록 번호에 store 카운터를 안 쓴다", !/nextId\("daily_settlements"\)/.test(src), "");

  out.push("\n[기록이 빠진 날은 주문으로 다시 채운다]");
  await insertOrder({
    id: 900001, table_number: "5", status: "paid", created_at: `${d3} 12:00:00`, updated_at: `${d3} 12:40:00`,
    total: 500, party_size: 2, payment_method: "cash",
    items: [{ name_ko: "밥", qty: 1, unit_price: 500, paid: true, paid_at: `${d3} 12:40:00`, payment_method: "cash" }],
  });
  r = await boss.get("/api/settlements/history");
  const byDate = Object.fromEntries((r.body || []).map((x) => [x.date, x]));
  check("★★ 빠졌던 날이 목록에 나온다", !!byDate[d3], JSON.stringify(Object.keys(byDate)));
  check("★ 그날 매출이 주문과 같다", byDate[d3] && byDate[d3].total_revenue === 500, JSON.stringify(byDate[d3] && byDate[d3].total_revenue));
  check("다시 채운 것이라고 적힌다", byDate[d3] && !!byDate[d3].backfilled_at, "");
  check("주문 없는 날도 NT$0 으로 채운다(휴무일)", Object.keys(byDate).filter((d) => d > d3 && d < taipeiDateString()).length === 5, JSON.stringify(Object.keys(byDate)));
  check("★ 가장 오래된 기록보다 앞의 날은 지어내지 않는다", !byDate[before], "");
  check("오늘은 채우지 않는다(아직 장사 중)", !byDate[taipeiDateString()], "");
  const again = await boss.get("/api/settlements/history");
  const count = again.body.filter((x) => x.date === d3).length;
  check("★ 다시 열어도 두 줄이 되지 않는다", count === 1, `${count}`);
  r = await request(app).get("/api/settlements/history");
  check("로그인 안 하면 못 본다", r.status === 401 || r.status === 403, `${r.status}`);

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
