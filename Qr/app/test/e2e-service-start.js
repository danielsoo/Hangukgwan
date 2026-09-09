// 영업 시작 시각 — 그 전 주문을 화면과 매출에서 빼되, 지우지는 않는다.
//
// 2026-09-10 사장님: "대만 시간 기준 9월 8일 저녁부터 실제로 시행을 해서
// 그때부터는 실제 손님들이 먹고 주문한거야. 그 전까지는 전부 테스트였고."
//
// 테스트 주문도 진짜 주문과 똑같은 모양이라, 그냥 두면 결산 매출에 그대로
// 더해지고 결제 안 한 테스트 주문은 실시간 주문 목록에 영원히 남는다
// (안 끝난 주문은 아무리 오래돼도 화면에 들고 있으므로).
//
// 지우는 대신 빼는 방식이라, 이 테스트에서 제일 중요한 건 "빠졌다"와
// "그래도 데이터베이스에는 남아 있다"를 둘 다 확인하는 것이다.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "service-start";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const http = require("http");
const app = require("../server");
const { store, getDb, connectDB, save, findOrders } = require("../src/db");
const { serviceStartedAt, SETTING_KEY } = require("../src/serviceStart");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

let PORT;
function req(method, path, body, cookie) {
  return new Promise((resolve) => {
    const d = body ? JSON.stringify(body) : null;
    const r = http.request({ host: "127.0.0.1", port: PORT, path, method,
      headers: Object.assign({ "Content-Type": "application/json" },
        d ? { "Content-Length": Buffer.byteLength(d) } : {}, cookie ? { Cookie: cookie } : {}) },
      (x) => { let b = ""; x.on("data", (c) => (b += c)); x.on("end", () => resolve({
        status: x.statusCode,
        cookie: (x.headers["set-cookie"] || []).map((c) => c.split(";")[0]).join("; "),
        body: b ? JSON.parse(b) : null })); });
    if (d) r.write(d);
    r.end();
  });
}

const START = "2026-09-08 17:00:00";
const mk = (id, created_at, status, total) => ({
  _id: id, id, table_number: "5", status, order_type: "dine_in", created_at,
  updated_at: created_at, total, items: [{ item_id: 1, name_ko: "김치찌개", name_zh: "泡菜鍋",
    qty: 1, unit_price: total, payment_method: "cash" }], account_id: null, payment_method: "cash",
});

(async () => {
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  PORT = server.address().port;
  await req("GET", "/api/menu"); // 시드 + 마이그레이션
  const ck = (await req("POST", "/api/auth/login", { password: "ownerpass123" })).cookie;

  out.push("[기본값이 잡혀 있다]");
  check("영업 시작이 9/8 저녁으로 잡힌다", serviceStartedAt(store) === START, String(serviceStartedAt(store)));

  await connectDB();
  const col = getDb().collection("orders");
  // 테스트 주문 셋: 결제된 것, 결제 안 한 것(=목록에 영원히 남던 것), 취소된 것
  await col.insertOne(mk(900001, "2026-09-08 12:30:00", "paid", 1000));
  await col.insertOne(mk(900002, "2026-09-07 19:00:00", "served", 2000));
  await col.insertOne(mk(900003, "2026-09-08 16:59:59", "paid", 3000));
  // 진짜 주문 둘 — 시작 시각 바로 그 순간과, 그 뒤
  await col.insertOne(mk(900004, "2026-09-08 17:00:00", "paid", 400));
  await col.insertOne(mk(900005, "2026-09-09 19:30:00", "paid", 600)); // 다음 날 — 하루치와 기간치를 갈라 보려고

  out.push("\n[실시간 주문 목록에서 빠진다]");
  await req("GET", "/api/menu"); // refreshStore
  const ids = store.orders.map((o) => o.id);
  check("결제 안 한 테스트 주문이 목록에 안 남는다", !ids.includes(900002), ids.join(","));
  check("결제된 테스트 주문도 안 보인다", !ids.includes(900001) && !ids.includes(900003), ids.join(","));
  const board = await req("GET", "/api/orders", null, ck);
  const boardIds = board.body.map((o) => o.id);
  check("주문 목록 화면에도 안 나온다", !boardIds.some((id) => String(id).startsWith("9000") && id < 900004),
    boardIds.filter((i) => String(i).startsWith("9000")).join(","));

  out.push("\n[매출에 안 더해진다]");
  const day = await req("GET", "/api/settlements/?date=2026-09-08", null, ck);
  check("9/8 결산이 열린다", day.status === 200, `${day.status}`);
  // 9/8 매출은 저녁 첫 손님 400원뿐이어야 한다 — 그날 낮의 테스트 1000+3000 은 빠진다.
  check("그날 낮의 테스트 매출이 빠진다", day.body.total_revenue === 400,
    `total_revenue=${day.body.total_revenue}`);
  const range = await req("GET", "/api/settlements/?start=2026-09-01&end=2026-09-30", null, ck);
  check("기간 결산에서도 진짜 주문만 센다", range.body.total_revenue === 1000,
    `total_revenue=${range.body.total_revenue} (400+600 이어야 함)`);

  out.push("\n[시작 시각 바로 그 순간은 진짜 장사다]");
  check("17:00:00 주문은 포함된다", range.body.paid_order_count === 2, `${range.body.paid_order_count}건`);
  const before = await req("GET", "/api/settlements/?date=2026-09-07", null, ck);
  check("그 전날은 매출 0", before.body.total_revenue === 0, `${before.body.total_revenue}`);

  out.push("\n[지워지지는 않았다]");
  // 이게 이 방식을 고른 이유다 — 빼는 것과 지우는 것은 다르다.
  const still = await findOrders({ id: { $in: [900001, 900002, 900003] } });
  check("테스트 주문 3건이 데이터베이스에 그대로 있다", still.length === 3, `${still.length}건`);

  out.push("\n[되돌릴 수 있다]");
  const cleared = await req("PUT", "/api/settings/service-start", { service_started_at: "" }, ck);
  check("비우면 설정이 사라진다", cleared.body.service_started_at === null, JSON.stringify(cleared.body));
  await req("GET", "/api/menu");
  check("비운 뒤에는 테스트 주문이 다시 보인다", store.orders.some((o) => o.id === 900002),
    store.orders.map((o) => o.id).join(","));
  const all = await req("GET", "/api/settlements/?start=2026-09-01&end=2026-09-30", null, ck);
  check("매출도 예전처럼 전부 합쳐진다", all.body.total_revenue === 5000, `${all.body.total_revenue}`);

  out.push("\n[시각을 고칠 수 있다]");
  const moved = await req("PUT", "/api/settings/service-start", { service_started_at: "2026-09-08T17:00" }, ck);
  check("화면이 주는 형식(분까지)을 받아준다", moved.body.service_started_at === START,
    JSON.stringify(moved.body));
  const bad = await req("PUT", "/api/settings/service-start", { service_started_at: "저녁쯤" }, ck);
  check("알아볼 수 없는 값은 거절한다", bad.status === 400, `${bad.status}`);
  check("거절해도 원래 값이 그대로다", serviceStartedAt(store) === START, String(serviceStartedAt(store)));

  out.push("\n[아무나 바꿀 수 없다]");
  // 매출 숫자가 달라지는 설정이다.
  const noAuth = await req("PUT", "/api/settings/service-start", { service_started_at: "2020-01-01" });
  check("로그인 안 하면 못 바꾼다", noAuth.status === 401 || noAuth.status === 403, `${noAuth.status}`);
  check("그래도 값은 그대로", serviceStartedAt(store) === START);

  server.close();
  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.log(out.join("\n"));
  console.error("HARNESS ERROR:", e.message, e.stack);
  process.exit(1);
});
