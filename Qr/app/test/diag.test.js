// 진단 수치는 사장만 볼 수 있어야 한다. 여기 들어 있는 건 몽고 응답 시간,
// store 문서 크기, 주문·예약 건수 같은 가게 내부 사정이라 손님이나 직원이
// 볼 이유가 없다.
const crypto = require("crypto");

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
process.env.SESSION_SECRET = "diag-test";

const express = require("express");
const session = require("express-session");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const { store } = require("../src/db");

const app = express();
app.use(express.json());
app.use(session({ secret: "diag-test", resave: false, saveUninitialized: false }));
app.use("/api/auth", require("../src/routes/auth"));
app.use("/api/account", require("../src/routes/account"));
app.use("/api/_diag", require("../src/routes/diag"));

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

(async () => {
  store.settings = { admin_password_hash: bcrypt.hashSync("ownerpass123", 10), staff_permissions: {} };
  store.staff_password_hash = undefined;
  store.orders = [{ id: 1, items: [] }, { id: 2, items: [] }];
  store.menuItems = [{ id: 1, name_ko: "돌솥비빔밥" }];
  store.reservations = [];

  out.push("\n[권한]");
  let r = await request(app).get("/api/_diag");
  check("로그인 안 하면 거부", r.status === 401, `got ${r.status}`);

  const customer = request.agent(app);
  await customer.post("/api/account/register").send({ email: "c@example.com", password: "hunter2hunter", name: "손님" });
  r = await customer.get("/api/_diag");
  check("손님은 거부", r.status === 401 || r.status === 403, `got ${r.status}`);

  const boss = request.agent(app);
  await boss.post("/api/auth/login").send({ password: "ownerpass123" });
  r = await boss.get("/api/_diag");
  check("사장은 통과", r.status === 200, `got ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);

  out.push("\n[내용]");
  check("store 크기(KB)", typeof r.body.store_kb === "number", JSON.stringify(r.body).slice(0, 200));
  check("배열별 건수", r.body.rows && r.body.rows.orders === 2, JSON.stringify(r.body.rows));
  check("무엇이 무겁냐", !!r.body.kb_by_key, JSON.stringify(r.body.kb_by_key));
  check("node 버전", typeof r.body.node === "string");
  check("몽고 ping 이 실패해도 응답은 200", r.status === 200);

  // 2026-09-12 사장님: "지금 어드민 사이트 반응속도가 너어무 느려졌어."
  //
  // 그때 이 화면이 답해야 하는 질문은 하나다 — **어디서 시간을 쓰나.**
  // 매 요청이 치르는 비용은 세 갈래뿐이고(몽고까지의 거리, 실제로 읽는 양,
  // 쓰기마다 기다리는 알림 왕복), 셋 중 어느 것이냐에 따라 할 일이 완전히
  // 다르다. 한 줄이라도 빠지면 다시 추측으로 돌아가게 된다.
  out.push("\n[어디서 시간을 쓰나 — 느리다는 말을 받았을 때 볼 줄]");
  const timing = ["mongo_ping_ms", "store_read_ms", "orders_read_ms", "pusher_ms"];
  for (const k of timing) {
    check(
      `${k} — 값이든 실패 이유든 나온다`,
      k in r.body || `${k.replace(/_ms$/, "")}_error` in r.body || "read_error" in r.body || "mongo_ping_error" in r.body,
      JSON.stringify(r.body).slice(0, 300)
    );
  }
  check(
    "쓰기가 알림을 얼마나 기다리는지도 같이 적는다",
    typeof r.body.pusher_timeout_ms === "number",
    String(r.body.pusher_timeout_ms)
  );

  out.push("\n[따뜻한 인스턴스인가 — 2026-09-12 \"둘 다 서울인데?\"]");
  // 서울-서울이면 몽고 왕복은 3ms 다. 그런데도 느리면 남은 후보는 매번 새로
  // 뜨는 인스턴스다. 이 줄이 없으면 그걸 확인할 방법이 없다.
  check("이 인스턴스가 몇 번째 요청인지 적는다", typeof r.body.requests_served === "number", String(r.body.requests_served));
  check("인스턴스가 얼마나 살아 있었는지 적는다", typeof r.body.instance_age_s === "number", String(r.body.instance_age_s));
  check("몽고에 처음 붙는 데 걸린 시간도 적는다", "mongo_connect_ms" in r.body, JSON.stringify(r.body).slice(0, 200));

  out.push("\n[캐시 금지 — 순간 상태라 저장되면 안 된다]");
  check("no-store", (r.headers["cache-control"] || "").includes("no-store"), r.headers["cache-control"]);

  out.push("\n[비밀은 안 나간다]");
  const body = JSON.stringify(r.body);
  check("비밀번호 해시 없음", !body.includes("$2"), body.slice(0, 200));
  check("접속 문자열 없음", !/mongodb(\+srv)?:\/\//.test(body));
  check("환경변수 통째로 없음", !body.includes("MONGODB_URI") && !body.includes("SESSION_SECRET"));

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.log(out.join("\n"));
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
