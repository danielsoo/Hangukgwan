// 잰 것을 쌓아 두는 것이 느려지는 이유가 되면 안 된다.
//
// 2026-09-12 사장님: "이 내용들을 로그로 기록할 수 없나? 몽고디비에 같이?
// ... 어차피 재는 거 기록하는 거는 문제없잖아"
//
// 문제없게 만드는 조건이 있다. 요청마다 몽고에 한 줄씩 쓰면, 줄이려던
// 왕복을 도로 늘리는 셈이 된다. 그래서 이 테스트가 지키는 것은 "기록이
// 남는가"보다 **"기록 때문에 느려지지 않는가"** 쪽이다.
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
process.env.SESSION_SECRET = "request-log";
process.env.ADMIN_PASSWORD = "ownerpass123";

const request = require("supertest");
const app = require("../server");
const db = require("../src/db");
const requestLog = require("../src/requestLog");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

(async () => {
  await db.connectDB();
  const handle = db.getDb();

  out.push("\n[주소를 한 줄로 모은다 — 주문마다 따로 쌓이면 요약이 안 된다]");
  check("숫자는 :id 가 된다", requestLog.routeOf("/api/orders/123") === "/api/orders/:id", requestLog.routeOf("/api/orders/123"));
  check("숫자가 여럿이어도", requestLog.routeOf("/api/menu/admin/items/7/photo") === "/api/menu/admin/items/:id/photo", requestLog.routeOf("/api/menu/admin/items/7/photo"));
  check("글자는 그대로", requestLog.routeOf("/api/settings/print-device") === "/api/settings/print-device");

  out.push("\n[전부 쓰지 않는다 — 빠른 요청까지 다 쓰면 그게 느려지는 이유가 된다]");
  const before = requestLog.pending();
  for (let i = 0; i < 10; i++) requestLog.record({ ms: 5, status: 200, cold: false });
  const fastKept = requestLog.pending() - before;
  check("★ 빠른 요청 열 번이 열 줄이 되지 않는다", fastKept <= 1, `${fastKept}줄`);

  requestLog.record({ ms: requestLog.SLOW_MS + 1, status: 200, cold: false });
  check("★ 느린 요청은 반드시 남는다", requestLog.pending() > before + fastKept);
  const afterSlow = requestLog.pending();
  requestLog.record({ ms: 5, status: 200, cold: true });
  check("★ 콜드 스타트는 빨라도 남는다", requestLog.pending() > afterSlow);
  const afterCold = requestLog.pending();
  requestLog.record({ ms: 5, status: 500, cold: false });
  check("실패한 요청도 남는다", requestLog.pending() > afterCold);

  out.push("\n[메모리가 불어나지 않는다 — 못 내보내는 동안에도]");
  for (let i = 0; i < 500; i++) requestLog.record({ ms: 9999, status: 200, cold: false });
  check("★ 담아두는 줄 수에 상한이 있다", requestLog.pending() <= 50, `${requestLog.pending()}줄`);

  out.push("\n[내보내면 비워진다 — 같은 줄을 두 번 쓰지 않는다]");
  await requestLog.flush(handle);
  check("★ 내보낸 뒤에는 비어 있다", requestLog.pending() === 0, `${requestLog.pending()}줄`);
  const stored = await handle.collection(requestLog.COLLECTION).find({}).toArray();
  check("몽고에 들어갔다", stored.length > 0, `${stored.length}줄`);

  out.push("\n[요청이 실제로 기록을 남긴다]");
  const boss = request.agent(app);
  await boss.post("/api/auth/login").send({ password: "ownerpass123" });
  // 빠른 요청은 표본으로만 남으므로(SAMPLE_EVERY), 표본이 한 번은 걸리도록
  // 그 주기보다 넉넉히 부른다. 여기서 "세 번 부르고 한 줄을 기대"하면
  // 테스트가 운에 달리게 된다.
  for (let i = 0; i < requestLog.SAMPLE_EVERY + 5; i++) await boss.get("/api/orders");
  await boss.get("/api/orders"); // 마지막 기록은 이 요청에 얹혀 나간다
  const rows = await handle.collection(requestLog.COLLECTION).find({ route: "/api/orders" }).toArray();
  check("★ /api/orders 가 기록에 남는다", rows.length > 0, `${rows.length}줄`);
  if (rows.length) {
    const r = rows[0];
    check("걸린 시간이 들어 있다", typeof r.ms === "number", JSON.stringify(r).slice(0, 160));
    check("몇 번째 요청이었는지 들어 있다", typeof r.nth === "number", String(r.nth));
    check("TTL 이 볼 수 있는 날짜다 (Date)", r.created_at instanceof Date, typeof r.created_at);
  }

  out.push("\n[요약이 세 가지 질문에 답한다]");
  const r = await boss.get("/api/_diag/log?hours=24");
  check("사장은 볼 수 있다", r.status === 200, String(r.status));
  check("어느 동작이 느린가 — 동작별 줄", Array.isArray(r.body.by_route), JSON.stringify(r.body).slice(0, 200));
  check("느린 것이 얼마나 잦은가", typeof r.body.slow_share_pct === "number", String(r.body.slow_share_pct));
  check("★ 콜드일 때와 아닐 때를 갈라서 준다", !!r.body.cold && !!r.body.warm, JSON.stringify(r.body.cold));
  check("가장 느렸던 것들도 준다", Array.isArray(r.body.slowest));

  out.push("\n[직원은 못 본다 — 가게 내부 사정이다]");
  const anon = request.agent(app);
  const r2 = await anon.get("/api/_diag/log");
  check("로그인 안 하면 거부", r2.status === 401 || r2.status === 403, String(r2.status));

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.log(out.join("\n"));
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
