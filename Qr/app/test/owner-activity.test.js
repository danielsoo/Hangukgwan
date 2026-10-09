// 사장 로그인 감사 기록: 언제/어디서/어떤 기기로 로그인했는지와 관리자
// 화면이 지금 살아 있는지를 사장만 볼 수 있어야 한다.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"),
  filename: require.resolve("mongodb"),
  loaded: true,
  exports: fake,
  paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.OWNER_EMAIL = "boss-activity@hangukgwan.tw";
process.env.SESSION_SECRET = "owner-activity-test-secret";
process.env.NODE_ENV = "test";

const express = require("express");
const session = require("express-session");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const { store } = require("../src/db");
const activity = require("../src/ownerActivity");
const accounts = require("../src/accounts");

store.settings = {
  admin_password_hash: bcrypt.hashSync("ownerpass123", 10),
  staff_password_hash: bcrypt.hashSync("staffpass123", 10),
  staff_permissions: {},
};

const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 12 * 60 * 60 * 1000 },
  })
);
app.use(require("../src/auth").syncSessionRole);
app.use("/api/account", require("../src/routes/account"));
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
  const owner = request.agent(app);
  const staff = request.agent(app);
  let r;

  out.push("\n[공용 사장 비밀번호 로그인]");
  r = await owner
    .post("/api/auth/login")
    .set("x-forwarded-for", "203.0.113.41")
    .set("x-vercel-ip-city", "Zhubei%20City")
    .set("x-vercel-ip-country-region", "HSQ")
    .set("x-vercel-ip-country", "TW")
    .set("user-agent", "Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/140.0 Safari/537.36")
    .send({ password: "ownerpass123" });
  check("사장 로그인 성공", r.status === 200 && r.body.role === "owner", JSON.stringify(r.body));

  r = await owner.get("/api/auth/owner-activity");
  const first = r.body.activity && r.body.activity[0];
  check("사장만 기록 조회", r.status === 200 && first, `${r.status} ${JSON.stringify(r.body)}`);
  check("접속 직후 현재 접속 중", first && first.isOnline === true, JSON.stringify(first));
  check("IP와 대략적 위치 저장", first && first.ip === "203.0.113.41" && first.city === "Zhubei City" && first.country === "TW", JSON.stringify(first));
  check("기기·브라우저 요약", first && /Windows PC/.test(first.device) && /Chrome/.test(first.device), first && first.device);
  check("공용 비밀번호 방식 표시", first && first.loginMethod === "shared_password", first && first.loginMethod);
  check("사장 역할 표시", first && first.role === "owner", first && first.role);
  check("세션 ID·원문 UA는 응답하지 않음", first && !("session_key" in first) && !("user_agent" in first));

  const stored = fake.__db.collection(activity.COLLECTION).docs[0];
  check("DB에도 세션 ID 대신 HMAC만 저장", stored && /^[a-f0-9]{64}$/.test(stored.session_key || ""), stored && stored.session_key);

  out.push("\n[권한과 현재 접속 판정]");
  await staff.post("/api/auth/login").send({ password: "staffpass123" });
  r = await staff.get("/api/auth/owner-activity");
  check("직원은 기록 조회 불가", r.status === 401, `got ${r.status}`);
  r = await staff.post("/api/auth/owner-activity/heartbeat");
  check("직원도 자기 접속 신호 저장", r.status === 200 && r.body.ok === true, `got ${r.status}`);
  r = await owner.get("/api/auth/owner-activity");
  const sharedStaff = (r.body.activity || []).find((row) => row.role === "staff" && row.loginMethod === "shared_password");
  check("사장은 직원 공용 로그인을 확인", !!sharedStaff && sharedStaff.isOnline === true, JSON.stringify(r.body.activity));

  const future = await activity.listRecent(50, new Date(Date.now() + activity.ONLINE_WINDOW_MS + 1000));
  check("최근 신호가 끊기면 비활성", future[0] && future[0].isOnline === false, JSON.stringify(future[0]));

  r = await owner
    .post("/api/auth/owner-activity/heartbeat")
    .set("x-forwarded-for", "203.0.113.41")
    .set("x-vercel-ip-city", "Zhubei%20City")
    .set("x-vercel-ip-country", "TW");
  check("heartbeat 저장", r.status === 200 && r.body.ok === true, JSON.stringify(r.body));

  out.push("\n[계정 로그인과 로그아웃]");
  const accountOwner = request.agent(app);
  r = await accountOwner
    .post("/api/account/register")
    .set("x-forwarded-for", "198.51.100.8")
    .set("user-agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X) Version/19.0 Safari/605.1.15")
    .send({ email: "boss-activity@hangukgwan.tw", password: "accountpass123", name: "사장님" });
  check("사장 계정 가입·로그인", r.status === 200 && r.body.user.role === "owner", JSON.stringify(r.body));
  r = await accountOwner.get("/api/auth/owner-activity");
  const accountRow = (r.body.activity || []).find((row) => row.accountEmail === "boss-activity@hangukgwan.tw");
  check("계정 이메일·로그인 방식 기록", accountRow && accountRow.loginMethod === "password", JSON.stringify(r.body.activity));

  r = await accountOwner.post("/api/account/logout");
  check("계정 로그아웃 성공", r.status === 200 && r.body.ok === true, JSON.stringify(r.body));
  r = await owner.get("/api/auth/owner-activity");
  const loggedOut = (r.body.activity || []).find((row) => row.accountEmail === "boss-activity@hangukgwan.tw");
  check("명시적 로그아웃 시각과 오프라인 표시", loggedOut && loggedOut.loggedOutAt && loggedOut.isOnline === false, JSON.stringify(loggedOut));

  const staffUser = await accounts.createEmailUser({
    email: "staff-activity@hangukgwan.tw",
    password: "staffaccount123",
    name: "직원",
  });
  await accounts.setRole(staffUser._id, "staff");
  const accountStaff = request.agent(app);
  r = await accountStaff
    .post("/api/account/login")
    .set("x-forwarded-for", "198.51.100.9")
    .send({ email: "staff-activity@hangukgwan.tw", password: "staffaccount123" });
  check("직원 계정 로그인", r.status === 200 && r.body.user.role === "staff", JSON.stringify(r.body));
  r = await owner.get("/api/auth/owner-activity");
  const accountStaffRow = (r.body.activity || []).find((row) => row.accountEmail === "staff-activity@hangukgwan.tw");
  check("사장은 직원 계정 로그인도 확인", accountStaffRow && accountStaffRow.role === "staff" && accountStaffRow.isOnline === true, JSON.stringify(accountStaffRow));

  out.push("\n[실시간 주문 연결과 접속 신호는 서로 독립]");
  const adminJs = fs.readFileSync(path.join(__dirname, "../public/js/admin.js"), "utf8");
  const stopPollingStart = adminJs.indexOf("function stopPolling()");
  const stopPollingEnd = adminJs.indexOf("// ---------- 주문 알림음", stopPollingStart);
  const stopPollingCode = adminJs.slice(stopPollingStart, stopPollingEnd);
  check("주문 폴링을 바꿔도 접속 신호를 끄지 않음", stopPollingStart >= 0 && !stopPollingCode.includes("stopOwnerPresence()"));
  check("로그아웃할 때만 접속 신호를 명시적으로 끔", /logoutBtn[\s\S]+?stopOwnerPresence\(\);[\s\S]+?stopPolling\(\);/.test(adminJs));
  check("접속 상태 새로고침은 이 기기의 신호부터 갱신", /ownerActivityRefreshBtn[^\n]+onclick = sendOwnerPresence/.test(adminJs));

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.log(out.join("\n"));
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
