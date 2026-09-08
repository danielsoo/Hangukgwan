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
