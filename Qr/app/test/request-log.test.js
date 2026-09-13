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

  out.push("\n[전부 남긴다 — 표본은 아침과 저녁의 차이를 지운다]");
  // 2026-09-12 사장님: "모든 이벤트에 속도를 측정할 수 있게 해줘. 분명 아침
  // 영업때는 빨랐는데 저녁 영업때는 갑자기 느려졌어." 표본만 남기면 저녁의
  // 느린 순간이 통째로 빠질 수 있고, 빠져도 빠졌다는 것을 알 수가 없다.
  const before = requestLog.pending();
  for (let i = 0; i < 10; i++) requestLog.record({ ms: 5, status: 200, cold: false });
  check("★ 빠른 요청 열 번이 열 줄로 남는다", requestLog.pending() - before === 10, `${requestLog.pending() - before}줄`);
  check("★ 기록이 있어도 요청마다 바로 쓰지는 않는다", !requestLog.shouldFlush(), `${requestLog.pending()}줄`);
  check("★ 30초가 지나면 묶어서 쓴다", requestLog.shouldFlush(Date.now() + requestLog.FLUSH_INTERVAL_MS + 1));

  const afterFast = requestLog.pending();
  requestLog.record({ ms: requestLog.SLOW_MS + 1, status: 200, cold: false });
  requestLog.record({ ms: 5, status: 200, cold: true });
  requestLog.record({ ms: 5, status: 500, cold: false });
  check("느린 것·콜드·실패도 당연히 남는다", requestLog.pending() === afterFast + 3, `${requestLog.pending()}줄`);

  out.push("\n[메모리가 불어나지 않는다 — 못 내보내는 동안에도]");
  for (let i = 0; i < 2000; i++) requestLog.record({ ms: 9999, status: 200, cold: false });
  check("★ 담아두는 줄 수에 상한이 있다", requestLog.pending() <= requestLog.MAX_QUEUE, `${requestLog.pending()}줄`);
  check("★ 버린 줄이 있으면 몇 줄인지 안다 (조용히 비면 「한산했다」로 읽힌다)", requestLog.droppedCount() > 0, String(requestLog.droppedCount()));
  check("★ 메모리가 가득 차면 30초 전에도 내보낸다", requestLog.shouldFlush());

  out.push("\n[내보내면 비워진다 — 같은 줄을 두 번 쓰지 않는다]");
  await requestLog.flush(handle);
  check("★ 내보낸 뒤에는 비어 있다", requestLog.pending() === 0, `${requestLog.pending()}줄`);
  const stored = await handle.collection(requestLog.COLLECTION).find({}).toArray();
  check("몽고에 들어갔다", stored.length > 0, `${stored.length}줄`);

  out.push("\n[요청이 실제로 기록을 남긴다]");
  const boss = request.agent(app);
  await boss.post("/api/auth/login").send({ password: "ownerpass123" });
  await boss.get("/api/orders");
  await boss.get("/api/orders");
  // 운영에서는 30초마다 자동으로 나가지만, 테스트가 30초를 실제로 기다릴
  // 이유는 없다. 같은 flush를 직접 불러 저장된 내용만 확인한다.
  await requestLog.flush(handle);
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

  out.push("\n[몽고를 기다린 시간을 따로 센다 — 몽고냐 아니냐를 가르는 줄]");
  // 2026-09-12 "아침엔 빨랐는데 저녁엔 느려졌어." 코드는 그대로였으니 바뀐
  // 것은 부하다. ms 만 있으면 몽고인지 콜드 스타트인지 우리 코드인지 알 수
  // 없다.
  const timed = await handle.collection(requestLog.COLLECTION).find({ route: "/api/orders" }).toArray();
  check("★ mongo_ms 가 기록된다", timed.some((r) => typeof r.mongo_ms === "number"), JSON.stringify(timed[0] || {}).slice(0, 200));
  check("몽고 호출 수도 기록된다", timed.some((r) => typeof r.mongo_ops === "number"));
  check(
    "★ 몽고 시간이 전체 시간을 넘지 않는다 (동시 요청끼리 시간을 더하면 넘는다)",
    timed.every((r) => typeof r.mongo_ms !== "number" || r.mongo_ms <= r.ms + 5),
    JSON.stringify(timed.map((r) => `${r.mongo_ms}/${r.ms}`).slice(0, 5))
  );

  out.push("\n[화면이 잰 값도 받는다 — 서버는 신주~서울 구간을 못 본다]");
  await boss.get("/api/orders").set("X-Client-Timing", "/api/orders|1234|200;/api/tables/7|99|200");
  await boss.get("/api/orders");
  await requestLog.flush(handle);
  const clientRows = await handle.collection(requestLog.COLLECTION).find({ src: "client" }).toArray();
  check("★ 화면이 보낸 값이 기록된다", clientRows.length >= 2, `${clientRows.length}줄`);
  check("서버가 잰 줄과 구별된다", clientRows.every((r) => r.src === "client"));
  check(
    "주소의 숫자는 서버와 같은 규칙으로 모인다",
    clientRows.some((r) => r.route === "/api/tables/:id"),
    JSON.stringify(clientRows.map((r) => r.route))
  );
  // 망가진 헤더가 요청을 죽이면 안 된다. (헤더는 ASCII 만 담을 수 있어서
  // 화면 쪽에서도 ASCII 아닌 글자는 털어낸다.)
  const junk = await boss.get("/api/orders").set("X-Client-Timing", "garbage;;;|||;/api/x|abc|200");
  check("★ 망가진 헤더가 와도 요청은 그대로 된다", junk.status === 200, String(junk.status));
  await boss.get("/api/orders");

  out.push("\n[요약이 아침과 저녁을 갈라 준다]");
  const r3 = await boss.get("/api/_diag/log?hours=24");
  check("★ 시간대별 줄이 있다", Array.isArray(r3.body.by_hour) && r3.body.by_hour.length > 0, JSON.stringify(r3.body.by_hour || []).slice(0, 200));
  check("몽고 시간과 그 바깥을 갈라 준다", !!r3.body.mongo && !!r3.body.outside_mongo, JSON.stringify(r3.body.mongo));
  check("화면이 잰 값과 서버가 잰 값을 갈라 준다", !!r3.body.client && !!r3.body.server, JSON.stringify(r3.body.client));

  out.push("\n[파일로 받을 수 있다 — 남에게 넘기라고 만든 것]");
  const r4 = await boss.get("/api/_diag/log/export?hours=48");
  check("사장은 받을 수 있다", r4.status === 200, String(r4.status));
  check(
    "★ 파일로 저장되게 나온다",
    /attachment; filename="hangukgwan-speed-\d{4}-\d{2}-\d{2}\.json"/.test(r4.headers["content-disposition"] || ""),
    r4.headers["content-disposition"]
  );
  {
    const body = typeof r4.body === "object" && r4.body.rows ? r4.body : JSON.parse(r4.text);
    check("줄이 그대로 들어 있다 (요약만 주면 그 한 번을 못 본다)", Array.isArray(body.rows) && body.rows.length > 0, String(body.count));
    check("이게 무슨 파일인지 파일 안에 적혀 있다", typeof body.what === "string" && body.what.length > 10, body.what);
    check("어떻게 기록한 것인지도 적혀 있다", !!body.how && typeof body.how.rule === "string", JSON.stringify(body.how || {}));
  }

  out.push("\n[★ 첫 요청이 죽지 않는다 — 연결되기 전에 내보내려 하면 500 이 난다]");
  // 2026-09-12: 재는 자리를 맨 앞으로 옮기자 화면 파일 요청들이 먼저 담겼고,
  // 그래서 **첫 /api 요청에 이미 담아둔 기록이 있는** 상태가 됐다. 그걸
  // connectDB() 전에 내보내려다 getDb() 가 터져서 첫 요청이 통째로 500 이
  // 됐다. 브라우저로 열어보고서야 알았다.
  {
    const fresh = request.agent(app);
    requestLog.record({ created_at: new Date(), at: "x", route: "/js/admin.js", method: "GET", status: 200, ms: 1 });
    const r5 = await fresh.get("/api/settings");
    check("★ 담아둔 기록이 있어도 요청이 200 이다", r5.status === 200, `${r5.status} ${JSON.stringify(r5.body).slice(0, 120)}`);
  }

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
