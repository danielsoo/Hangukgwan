// 늘 거기 있는 시험용 자리.
//
// 2026-09-16 사장님: "지금 테이블이 실제 주문이 있어서 그러는데 차라리
// 테스트 테이블을 만들어줘. 테스터를 키든 안 켜든 볼 수 있게 해줘. 그리고
// 결제탭에서도 테스터 테이블을 한 곳 만들어줘서 사용할 수 있으면 좋겠어.
// 일반 테이블처럼 근데 그건 결산이나 실제 영수증은 발급 안되게해줘."
//
// 넷을 잰다. 하나라도 빠지면 이 자리를 만든 뜻이 없다.
//
//  1) 늘 있고 늘 보인다 — 테스터 모드를 안 켜도
//  2) 일반 테이블처럼 쓰인다 — 주문이 들어가고 결제가 된다
//  3) **결산에 한 푼도 안 들어간다** — 그리고 지난 기록에도
//  4) 종이가 자동으로 안 나간다
//
// 3번이 이 시험의 핵심이다. 여기가 새면 사장님 매출이 조용히 부풀어 오른다.
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
process.env.SESSION_SECRET = "test-table";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const fs = require("fs");
const path = require("path");
const request = require("supertest");
const app = require("../server");
const { store } = require("../src/db");
const testMode = require("../src/testMode");
const { hasUnpaidOrder, ordersOfSeating } = require("../src/partySize");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

(async () => {
  const staff = request.agent(app);
  let r = await staff.post("/api/auth/login").send({ password: "ownerpass123" });
  check("로그인된다", r.status === 200, `${r.status}`);

  out.push("[1. 늘 있고 늘 보인다]");
  const tt = store.tables.find((t) => t.is_test);
  check("★ 자리가 만들어져 있다", !!tt, "마이그레이션이 안 돌았다");
  // 2026-09-17 사장님: "지금 테스트 테이블이 이름이 길어 그냥 T 라고 해줘."
  // 배치도 타일이 한 변 70px 이라 긴 이름은 안 들어가고, 영수증에는
  // 「桌號 T」로 찍힌다.
  check("★ 번호는 한 글자 T", tt && tt.number === "T", `${tt && tt.number}`);
  check("★ 이름도 한 글자 T", tt && tt.label === "T", `${tt && tt.label}`);
  check("번호가 상수와 같다", tt && tt.number === testMode.TEST_TABLE_NUMBER, `${testMode.TEST_TABLE_NUMBER}`);
  check("줄이기 전 번호도 시험용으로 알아본다", testMode.isTestTable({ number: "TEST" }) === true, "옛 서버·옛 화면 대비");
  check("이름이 붙어 있다", !!(tt && tt.label), "");
  check("맨 뒤에 정렬된다 — 진짜 자리 사이에 끼면 헷갈린다", tt && tt.sort_order >= 9999, `${tt && tt.sort_order}`);
  check(
    "★ 배치도에 자리까지 잡혀 있다 — 결제탭에 안 보이면 못 쓴다",
    !!(tt && tt.zone_id != null),
    "포장 카운터가 zone_id null 이라 안 보였던 일을 반복하지 않는다"
  );
  r = await staff.get("/api/tables");
  const seen = (r.body.tables || r.body).find((t) => t.is_test);
  check("★ 자리 목록에 실려 온다", !!seen, JSON.stringify(Object.keys(r.body)).slice(0, 80));

  // 두 번 돌려도 하나뿐이어야 한다.
  const { applyTestTable20260916, MIGRATION_FLAG } = require("../src/migrations/2026-09-16-test-table");
  delete store.settings[MIGRATION_FLAG];
  await applyTestTable20260916(store, { save: async () => {}, nextId: () => 99999 });
  check("★ 두 번 돌려도 하나뿐이다", store.tables.filter((t) => t.is_test).length === 1, `${store.tables.filter((t) => t.is_test).length}`);

  out.push("\n[2. 일반 테이블처럼 쓰인다]");
  const item = store.menuItems.find((m) => m.available && m.price > 0);

  // 영업시간을 **완전히 닫아 놓고** 시작한다. 장사 끝난 뒤 조용할 때
  // 이것저것 해보려고 만든 자리인데 그때 잠기면 쓸 수가 없다.
  const { save } = require("../src/db");
  store.settings.order_hours = {
    enabled: 1,
    ranges: [{ start: "03:00", end: "03:01" }],
    closed_days: [],
  };
  await save();
  const guest = request.agent(app);
  // 인원을 안 물어도 들어가야 한다 — 그 자리에 몇 명인지는 아무 데도 안 쓰인다.
  r = await guest.post("/api/orders").send({
    tableNumber: testMode.TEST_TABLE_NUMBER,
    items: [{ itemId: item.id, qty: 2, orderType: "dine_in", addons: [] }],
  });
  check(
    "★ 영업시간 밖이어도, 인원을 안 찍어도 주문이 들어간다",
    r.status === 201,
    `${r.status} ${JSON.stringify(r.body)}`
  );
  // 같은 조건에서 진짜 자리는 막혀야 한다 — 위 통과가 「영업시간이 안 걸려
  // 있어서」가 아니라는 것을 여기서 증명한다.
  {
    const g2 = request.agent(app);
    await g2.put("/api/tables/12/party-size").send({ adults: 2, children: 0 });
    const blocked = await g2.post("/api/orders").send({
      tableNumber: "12",
      items: [{ itemId: item.id, qty: 1, orderType: "dine_in", addons: [] }],
    });
    check("★ 같은 시각에 진짜 자리는 막힌다", blocked.status === 403, `${blocked.status}`);
  }
  const order = store.orders.find((o) => o.id === r.body.id);
  check("★ 표가 붙는다", order.test_session === testMode.TEST_TABLE_SESSION, `${order.test_session}`);
  check("표 값이 진짜 세션 id 꼴이 아니다", !/^ts_[0-9a-f]{18,}$/.test(order.test_session), order.test_session);
  check("금액은 평소대로 계산된다", order.total === item.price * 2, `${order.total}`);

  // 자리 계산에 들어가야 한다 — 안 그러면 그 자리에서 아무것도 안 돈다.
  check("★ 그 자리의 미결제로 잡힌다", hasUnpaidOrder(store, testMode.TEST_TABLE_NUMBER) === true, "");
  check("★ 착석 주문 목록에도 들어온다", ordersOfSeating(store, tt).some((o) => o.id === order.id), "");

  // 테스터 모드를 **안 켠** 기기에서도 보여야 한다.
  r = await staff.get("/api/orders");
  const list = Array.isArray(r.body) ? r.body : r.body.orders || [];
  check(
    "★ 테스터 모드를 안 켜도 실시간 주문에 보인다",
    list.some((o) => o.id === order.id),
    "이게 안 보이면 이 자리를 만든 뜻이 없다"
  );
  r = await staff.get(`/api/orders/table/${testMode.TEST_TABLE_NUMBER}`);
  const tableList = Array.isArray(r.body) ? r.body : r.body.orders || [];
  check("★ 결제탭(자리별 목록)에도 보인다", tableList.some((o) => o.id === order.id), `${r.status}`);

  r = await staff.patch(`/api/orders/${order.id}`).send({ status: "paid", paymentMethod: "cash" });
  check("★ 결제가 된다", r.status === 200 && store.orders.find((o) => o.id === order.id).status === "paid", `${r.status}`);

  out.push("\n[3. 결산에 한 푼도 안 들어간다]");
  // 진짜 주문 하나를 나란히 넣어 비교 기준을 만든다.
  await require("./disable-order-hours")();
  const realGuest = request.agent(app);
  await realGuest.put("/api/tables/11/party-size").send({ adults: 2, children: 0 });
  r = await realGuest.post("/api/orders").send({
    tableNumber: "11",
    items: [{ itemId: item.id, qty: 1, orderType: "dine_in", addons: [] }],
  });
  const realOrder = store.orders.find((o) => o.id === r.body.id);
  await staff.patch(`/api/orders/${realOrder.id}`).send({ status: "paid", paymentMethod: "cash" });
  check("진짜 주문에는 표가 없다", realOrder.test_session === undefined, `${realOrder.test_session}`);

  const today = String(realOrder.created_at).slice(0, 10);
  r = await staff.get(`/api/settlements?start=${today}&end=${today}`);
  check("결산을 읽는다", r.status === 200, `${r.status}`);
  const revenue = r.body.total_revenue != null ? r.body.total_revenue : (r.body.summary || {}).total_revenue;
  check(
    "★ 매출에 테스트 자리 몫이 안 들어간다",
    revenue === realOrder.total,
    `${revenue} — 진짜만 세면 ${realOrder.total}, 테스트까지 세면 ${realOrder.total + order.total}`
  );

  r = await staff.get(`/api/orders/history?start=${today}&end=${today}`);
  const hist = Array.isArray(r.body) ? r.body : r.body.orders || [];
  check("★ 지난 기록에도 안 나온다", !hist.some((o) => o.id === order.id), "결산에 없는 것이 목록에만 있으면 두 화면 숫자가 달라 보인다");
  check("진짜 주문은 지난 기록에 있다", hist.some((o) => o.id === realOrder.id), "");

  out.push("\n[4. 종이가 자동으로 안 나간다]");
  const admin = fs.readFileSync(path.join(__dirname, "../public/js/admin.js"), "utf8");
  const escpos = fs.readFileSync(path.join(__dirname, "../public/js/escpos.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../public/css/admin.css"), "utf8");
  check(
    "★ 신규 주문 자동 인쇄에서 뺀다",
    /const toPrint = pending\.filter\(\(o\) => !isTestTableOrder\(o\)\);/.test(admin) &&
      /for \(const o of toPrint\) await printKitchenTicket\(o\);/.test(admin),
    "자동으로 나가면 주방이 없는 음식을 만든다"
  );
  check("★ 변경 알림 종이도 안 나간다", /if \(isTestTableOrder\(o\)\) continue;/.test(admin), "");
  check(
    "★ 손으로 찍으면 「테스트」가 박힌다",
    /function isTestOrder\(o\) \{\s*return !!\(o && o\.test_session\);/.test(escpos),
    "test_session 을 보므로 이 자리도 같이 잡힌다"
  );
  check("화면 쪽 판단이 서버와 같은 값을 본다", /o\.test_session === "test_table"/.test(admin), "");

  out.push("\n[화면에서 진짜 자리와 갈린다]");
  check("★ 배치도 타일에 표가 붙는다", /isTestTable\(t\) \? " test-table" : ""/.test(admin) && /\.table-block\.test-table/.test(css), "");
  check("★ 결제창 맨 위에 안내가 뜬다", /test-table-notice/.test(admin) && /\.test-table-notice/.test(css), "");
  check("번호를 이름 뒤에 안 붙인다", /t\.is_counter \|\| isTestTable\(t\)\) return t\.label;/.test(admin), "「테스트 테이블 TEST」는 지저분하다");
  for (const k of ["testTableTileTag", "testTableBadge", "testTableHint"]) {
    check(`${k} 가 한국어/중국어 둘 다 있다`, admin.split(`${k}:`).length - 1 >= 2, "");
  }

  out.push("\n[테스터 모드와 섞이지 않는다]");
  check("★ 「종료」가 지우는 것과 값이 다르다", testMode.TEST_TABLE_SESSION !== testMode.newId(), "");
  check("테스트 테이블 표를 알아본다", testMode.isTestTableRow({ test_session: "test_table" }) === true, "");
  check("다른 테스트 표는 아니다", testMode.isTestTableRow({ test_session: "ts_abc" }) === false, "");
  // 테스터 모드를 안 켠 기기의 눈
  const seeAll = testMode.visibleTo({ session: {} }, store);
  check("★ 평소 기기도 테스트 테이블 주문은 본다", seeAll({ test_session: "test_table" }) === true, "");
  check("평소 기기는 테스터 모드 주문은 못 본다", seeAll({ test_session: "ts_abc" }) === false, "");
  check("진짜 주문은 당연히 본다", seeAll({}) === true, "");
  check("자리 계산: 테스트 테이블은 센다", testMode.countsAtTable({ test_session: "test_table" }) === true, "");
  check("자리 계산: 테스터 모드는 안 센다", testMode.countsAtTable({ test_session: "ts_abc" }) === false, "");

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
