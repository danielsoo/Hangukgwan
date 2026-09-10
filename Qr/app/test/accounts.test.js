// Tests the new unified account system: real route code, real guards, real
// express-session — with the mongodb driver swapped for an in-memory fake
// (the sandbox can't download a real mongod binary).
const path = require("path");

// Inject the fake driver before anything requires "mongodb".
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"),
  filename: require.resolve("mongodb"),
  loaded: true,
  exports: fake,
  paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.STAFF_PASSWORD = "staffpass123";
process.env.NODE_ENV = "test";

const express = require("express");
const session = require("express-session");
const request = require("supertest");
const { store } = require("../src/db");
const { requireAdmin, requireOwner, requireUser } = require("../src/auth");

// Minimal store settings the routes read (normally set by seed()).
const bcrypt = require("bcryptjs");
store.settings = {
  admin_password_hash: bcrypt.hashSync("ownerpass123", 10),
  staff_password_hash: bcrypt.hashSync("staffpass123", 10),
  staff_permissions: { menuEdit: false, tableEdit: false, settingsEdit: false, orderCancel: false, orderEdit: false, reservationManage: false },
};

const app = express();
app.use(express.json());
app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
// Same order as server.js: session → syncSessionRole → routes.
app.use(require("../src/auth").syncSessionRole);
app.use("/api/account", require("../src/routes/account"));
app.use("/api/users", require("../src/routes/users"));
app.use("/api/auth", require("../src/routes/auth"));
// Stand-ins for the real admin-only endpoints (orders, menu, settlements…),
// which all sit behind exactly these guards.
app.get("/api/_admin", requireAdmin, (req, res) => res.json({ ok: true }));
app.get("/api/_owner", requireOwner, (req, res) => res.json({ ok: true }));
app.get("/api/_user", requireUser, (req, res) => res.json({ ok: true }));

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
  const customer = request.agent(app);
  const boss = request.agent(app);
  const legacy = request.agent(app);
  let r;

  out.push("\n[1] 회원가입 (손님)");
  r = await customer
    .post("/api/account/register")
    .send({ email: "  Guest@Example.COM ", password: "hunter2hunter", name: "왕손님", phone: "0912345678" });
  check("가입 성공", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
  check("역할 customer", r.body.user && r.body.user.role === "customer");
  check("이메일 소문자 정규화", r.body.user && r.body.user.email === "guest@example.com", JSON.stringify(r.body.user));
  check("응답에 password_hash 없음", r.body.user && !("password_hash" in r.body.user));
  check("isAdmin false", r.body.user && r.body.user.isAdmin === false);

  out.push("\n[2] 입력값 검증");
  r = await request(app).post("/api/account/register").send({ email: "bad", password: "hunter2hunter", name: "x" });
  check("잘못된 이메일 거부", r.status === 400 && r.body.error === "invalid_email", JSON.stringify(r.body));
  r = await request(app).post("/api/account/register").send({ email: "a@b.com", password: "short", name: "x" });
  check("짧은 비밀번호 거부", r.status === 400 && r.body.error === "weak_password");
  r = await request(app).post("/api/account/register").send({ email: "a2@b.com", password: "longenough1", name: "  " });
  check("이름 없으면 거부", r.status === 400 && r.body.error === "name_required");
  r = await request(app).post("/api/account/register").send({ email: "guest@example.com", password: "hunter2hunter", name: "중복" });
  check("이메일 중복 409", r.status === 409 && r.body.error === "email_taken", JSON.stringify(r.body));

  out.push("\n[3] 손님 세션은 관리자 API 접근 불가 (핵심)");
  r = await customer.get("/api/account/me");
  check("내 정보 조회", r.status === 200 && r.body.user && r.body.user.email === "guest@example.com");
  check("me.isAdmin false", r.body.isAdmin === false, JSON.stringify(r.body));
  r = await customer.get("/api/auth/me");
  check("레거시 auth/me 가 손님을 관리자로 안 봄", r.body.isAdmin === false, JSON.stringify(r.body));
  r = await customer.get("/api/_admin");
  check("requireAdmin 차단 (401)", r.status === 401, `got ${r.status}`);
  r = await customer.get("/api/_owner");
  check("requireOwner 차단 (401)", r.status === 401, `got ${r.status}`);
  r = await customer.get("/api/users");
  check("계정 목록 차단", r.status === 401, `got ${r.status}`);
  r = await customer.post("/api/auth/change-password").send({ currentPassword: "x", newPassword: "yyyyyyyy" });
  check("직원 비밀번호 변경 차단", r.status === 401, `got ${r.status}`);
  r = await customer.get("/api/_user");
  check("requireUser 는 통과 (손님도 로그인 상태)", r.status === 200, `got ${r.status}`);

  out.push("\n[4] 로그인 / 로그아웃");
  const c2 = request.agent(app);
  r = await c2.post("/api/account/login").send({ email: "guest@example.com", password: "wrongpass123" });
  check("틀린 비밀번호 401", r.status === 401 && r.body.error === "invalid_credentials");
  r = await c2.post("/api/account/login").send({ email: "nosuch@example.com", password: "hunter2hunter" });
  check("없는 계정도 동일 오류 (계정 존재 노출 안 함)", r.status === 401 && r.body.error === "invalid_credentials");
  r = await c2.post("/api/account/login").send({ email: "GUEST@EXAMPLE.com", password: "hunter2hunter" });
  check("대소문자 무관 로그인", r.status === 200 && r.body.user.email === "guest@example.com");
  await c2.post("/api/account/logout");
  r = await c2.get("/api/account/me");
  check("로그아웃 후 user null", r.body.user === null && r.body.isAdmin === false);
  r = await c2.get("/api/_user");
  check("로그아웃 후 requireUser 차단", r.status === 401);

  out.push("\n[5] OWNER_EMAIL 부트스트랩");
  r = await boss.post("/api/account/register").send({ email: "boss@hangukgwan.tw", password: "bosspass1234", name: "사장님" });
  check("사장 계정 가입", r.status === 200, JSON.stringify(r.body));
  check("자동 owner 역할", r.body.user.role === "owner", JSON.stringify(r.body.user));
  check("isAdmin true", r.body.user.isAdmin === true);
  r = await boss.get("/api/auth/me");
  check("레거시 auth/me 도 관리자 인식", r.body.isAdmin === true && r.body.role === "owner", JSON.stringify(r.body));
  r = await boss.get("/api/_admin");
  check("requireAdmin 통과", r.status === 200);
  r = await boss.get("/api/_owner");
  check("requireOwner 통과", r.status === 200);

  out.push("\n[6] 역할 변경 (승격/강등)");
  const users = (await boss.get("/api/users")).body.users;
  check("계정 목록 조회", Array.isArray(users) && users.length >= 2, JSON.stringify(users));
  const guestId = users.find((u) => u.email === "guest@example.com").id;
  const bossId = users.find((u) => u.email === "boss@hangukgwan.tw").id;

  r = await boss.patch(`/api/users/${guestId}/role`).send({ role: "staff" });
  check("손님 → 직원 승격", r.status === 200 && r.body.user.role === "staff", JSON.stringify(r.body));
  r = await customer.get("/api/account/me");
  check("승격이 기존 세션에 즉시 반영", r.body.isAdmin === true && r.body.user.role === "staff", JSON.stringify(r.body));
  r = await customer.get("/api/_admin");
  check("직원이 된 뒤 관리자 API 통과", r.status === 200, `got ${r.status}`);
  r = await customer.get("/api/_owner");
  check("직원은 owner 전용 차단", r.status === 401);
  r = await customer.patch(`/api/users/${guestId}/role`).send({ role: "owner" });
  check("직원 self-승격 차단", r.status === 401, `got ${r.status}`);

  r = await boss.patch(`/api/users/${bossId}/role`).send({ role: "customer" });
  check("자기 자신 강등 차단", r.status === 400 && r.body.error === "cannot_demote_self", JSON.stringify(r.body));
  r = await boss.patch(`/api/users/${guestId}/role`).send({ role: "banana" });
  check("이상한 역할 거부", r.status === 400 && r.body.error === "invalid_role");
  r = await boss.patch(`/api/users/${guestId}/role`).send({ role: "customer" });
  check("직원 → 손님 강등", r.status === 200 && r.body.user.role === "customer");
  r = await customer.get("/api/_admin");
  check("강등 즉시 접근 차단", r.status === 401, `got ${r.status}`);

  out.push("\n[7] 마지막 owner 보호");
  r = await boss.patch(`/api/users/${guestId}/role`).send({ role: "owner" });
  check("두 번째 owner 지정", r.status === 200 && r.body.user.role === "owner");
  r = await boss.patch(`/api/users/${guestId}/role`).send({ role: "customer" });
  check("owner 가 2명이면 한 명 강등 가능", r.status === 200, JSON.stringify(r.body));

  out.push("\n[8] 레거시 비밀번호 로그인 (잠금 방지)");
  r = await legacy.post("/api/auth/login").send({ password: "ownerpass123" });
  check("기존 비밀번호 로그인 동작", r.status === 200 && r.body.role === "owner", JSON.stringify(r.body));
  r = await legacy.get("/api/_admin");
  check("레거시 세션도 관리자 통과", r.status === 200);
  r = await legacy.get("/api/account/me");
  check("account/me 가 레거시 로그인 표시", r.body.isAdmin === true && r.body.legacyPasswordLogin === true, JSON.stringify(r.body));
  r = await legacy.post("/api/auth/login").send({ password: "staffpass123" });
  check("직원 비밀번호는 staff 역할", r.status === 200 && r.body.role === "staff");
  r = await legacy.get("/api/_owner");
  check("직원 비밀번호로 owner 전용 차단", r.status === 401);

  out.push("\n[9] 손님 세션 위에 관리자 비밀번호 로그인 (섞임 방지)");
  const mixed = request.agent(app);
  await mixed.post("/api/account/login").send({ email: "guest@example.com", password: "hunter2hunter" });
  r = await mixed.get("/api/_admin");
  check("먼저 손님이면 차단", r.status === 401);
  await mixed.post("/api/auth/login").send({ password: "ownerpass123" });
  r = await mixed.get("/api/account/me");
  check("관리자 로그인 후 관리자 유지 (역할이 되돌아가지 않음)", r.body.isAdmin === true, JSON.stringify(r.body));
  r = await mixed.get("/api/_admin");
  check("그 세션으로 관리자 API 통과", r.status === 200, `got ${r.status}`);

  out.push("\n[10] 프로필 / 비밀번호 변경");
  r = await boss.patch("/api/account/me").send({ name: "사장 김", phone: "0987654321" });
  check("프로필 수정", r.status === 200 && r.body.user.name === "사장 김" && r.body.user.phone === "0987654321");
  r = await boss.post("/api/account/change-password").send({ currentPassword: "wrong", newPassword: "newpass12345" });
  check("현재 비밀번호 틀리면 거부", r.status === 401 && r.body.error === "wrong_current_password");
  r = await boss.post("/api/account/change-password").send({ currentPassword: "bosspass1234", newPassword: "short" });
  check("새 비밀번호가 짧으면 거부", r.status === 400 && r.body.error === "weak_password");
  r = await boss.post("/api/account/change-password").send({ currentPassword: "bosspass1234", newPassword: "newpass12345" });
  check("비밀번호 변경 성공", r.status === 200);
  const boss2 = request.agent(app);
  r = await boss2.post("/api/account/login").send({ email: "boss@hangukgwan.tw", password: "newpass12345" });
  check("새 비밀번호로 로그인", r.status === 200);
  r = await boss2.post("/api/account/login").send({ email: "boss@hangukgwan.tw", password: "bosspass1234" });
  check("옛 비밀번호는 거부", r.status === 401);
  r = await request(app).post("/api/account/change-password").send({ newPassword: "whatever12345" });
  check("비로그인 비밀번호 변경 차단", r.status === 401);

  // 이 검사는 원래 "Firebase 미설정이면 503"만 봤는데, 개발자 로컬 .env에
  // Firebase 키가 들어 있으면(사장님 계정 구글 로그인을 실제로 붙여보려면
  // 넣어야 한다) 503 대신 invalid_token이 나와서 실패했다. 그런데 이 파일이
  // npm test 체인의 첫 번째라 && 로 이어진 나머지 21개 파일이 통째로 실행되지
  // 않았다 — 테스트가 있는데 아무도 돌리지 않는 상태. 설정 여부와 무관하게
  // 진짜 봐야 하는 것만 본다: 가짜 토큰으로는 절대 로그인되지 않는다.
  out.push("\n[11] 구글 로그인");
  const googleConfigured = require("../src/firebaseAdmin").isConfigured();
  r = await request(app).post("/api/account/google").send({ idToken: "fake" });
  check(
    googleConfigured ? "설정돼 있으면 가짜 토큰은 거부(401)" : "미설정이면 503",
    googleConfigured
      ? r.status === 401 && r.body.error === "invalid_token"
      : r.status === 503 && r.body.error === "google_login_not_configured",
    JSON.stringify(r.body)
  );
  r = await request(app).get("/api/account/methods");
  check("로그인 수단: 이메일 O / 구글 X", r.body.email === true && r.body.google === false, JSON.stringify(r.body));

  out.push("\n[12] 구글 계정 연결 (accounts 모듈 직접)");
  const accounts = require("../src/accounts");
  const linked = await accounts.findOrCreateGoogleUser({ uid: "g-uid-1", email: "guest@example.com", name: "Guest G" });
  check("같은 이메일이면 기존 계정에 연결", String(linked.email) === "guest@example.com" && linked.google_uid === "g-uid-1", JSON.stringify(linked));
  const all = await accounts.listUsers();
  check("계정이 새로 생기지 않음 (중복 계정 방지)", all.filter((u) => u.email === "guest@example.com").length === 1);
  const again = await accounts.findOrCreateGoogleUser({ uid: "g-uid-1", email: "guest@example.com", name: "Guest G" });
  check("두 번째 구글 로그인은 같은 계정", String(again._id) === String(linked._id));
  const fresh = await accounts.findOrCreateGoogleUser({ uid: "g-uid-2", email: "brandnew@example.com", name: "New" });
  check("모르는 구글 계정은 새로 생성", fresh.google_uid === "g-uid-2" && fresh.role === "customer");
  check("구글 전용 계정은 비밀번호 없음", fresh.password_hash === null);
  check("publicUser 가 로그인 수단 표시", accounts.publicUser(fresh).hasGoogle === true && accounts.publicUser(fresh).hasPassword === false);
  const bossGoogle = await accounts.findOrCreateGoogleUser({ uid: "g-uid-3", email: "boss@hangukgwan.tw", name: "B" });
  check("사장 이메일로 구글 로그인해도 owner 유지", bossGoogle.role === "owner", JSON.stringify(bossGoogle.role));

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
