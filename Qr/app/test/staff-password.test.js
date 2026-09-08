// 직원 로그인 비밀번호는 사장이 Admin > 설정 > 직원 권한 관리 에서 정한다.
//
// 왜 이 파일이 있나: 예전에는 seed 가 값이 없으면 "staff1234" 로 채웠다.
// 저장소를 본 사람 누구나 직원으로 로그인해서 주문·테이블·예약을 만질 수
// 있다는 뜻이었고, 사장님이 그걸 바꿔야 한다는 사실조차 화면에 안 보였다.
// 이제는 비워두고, 사장이 정하기 전까지 직원 로그인만 막힌다.
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
delete process.env.STAFF_PASSWORD;

const express = require("express");
const session = require("express-session");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const { store } = require("../src/db");

const app = express();
app.use(express.json());
app.use(session({ secret: "staff-pw-test", resave: false, saveUninitialized: false }));
app.use(require("../src/auth").syncSessionRole);
app.use("/api/auth", require("../src/routes/auth"));

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) {
    pass++;
    out.push(`  ok   ${name}`);
  } else {
    fail++;
    out.push(`  FAIL ${name}  ${extra}`);
  }
}

(async () => {
  store.settings = {
    admin_password_hash: bcrypt.hashSync("ownerpass123", 10),
    staff_permissions: {},
  };
  delete store.settings.staff_password_hash;

  out.push("\n[아직 정하지 않은 상태]");
  let r = await request(app).post("/api/auth/login").send({ password: "staff1234" });
  check("옛 기본 비밀번호로 들어올 수 없다", r.status === 401, `got ${r.status}`);
  r = await request(app).post("/api/auth/login").send({ password: "" });
  check("빈 비밀번호 거부", r.status === 400, `got ${r.status}`);

  const boss = request.agent(app);
  r = await boss.post("/api/auth/login").send({ password: "ownerpass123" });
  check("사장 로그인은 평소대로", r.status === 200 && r.body.role === "owner", JSON.stringify(r.body));
  r = await boss.get("/api/auth/me");
  check("설정 화면이 '아직 안 정함' 을 알 수 있다", r.body.staffPasswordSet === false, JSON.stringify(r.body));

  out.push("\n[사장이 설정 화면에서 정한다]");
  r = await boss.post("/api/auth/set-staff-password").send({ newPassword: "abc12" });
  check("6자 미만 거부", r.status === 400, `got ${r.status}`);
  r = await boss.post("/api/auth/set-staff-password").send({ newPassword: "gagechojeom99" });
  check("설정 성공", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
  r = await boss.get("/api/auth/me");
  check("이제 '설정됨' 으로 보인다", r.body.staffPasswordSet === true, JSON.stringify(r.body));
  check("해시 자체는 응답에 없다", !JSON.stringify(r.body).includes("$2"), JSON.stringify(r.body));

  const staff = request.agent(app);
  r = await staff.post("/api/auth/login").send({ password: "gagechojeom99" });
  check("직원이 새 비밀번호로 로그인된다", r.status === 200 && r.body.role === "staff", JSON.stringify(r.body));
  r = await staff.get("/api/auth/me");
  check("직원 세션은 staff 역할", r.body.role === "staff" && r.body.isAdmin === true, JSON.stringify(r.body));

  out.push("\n[직원은 자기 비밀번호를 남에게 넘길 수 없다]");
  r = await staff.post("/api/auth/set-staff-password").send({ newPassword: "sinipbimil123" });
  check("직원은 재설정 불가 (사장 전용)", r.status === 401 || r.status === 403, `got ${r.status}`);

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.log(out.join("\n"));
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
