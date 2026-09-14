// 새로고침할 때마다 로그인 화면이 뜨지 않는가.
//
// 2026-09-14 사장님: "로딩할 때마다 로그인 화면이 떠. 그거 없애줄 수 있어?"
//
// 로그아웃된 게 아니었다 — 세션은 12시간짜리다. admin.html 에서 로그인 화면은
// 처음부터 보이게 적혀 있고 대시보드만 hidden 이라, 화면은 **로그인 화면인
// 채로** 뜬다. 그 뒤 checkAuth() 가
//
//     await primeBoot();              ← /api/bootstrap. 열세 개의 답이 한꺼번에
//     await fetch("/api/auth/me")     ← 실제로 화면을 바꾸는 데 필요한 한 조각
//
// 순서로 기다렸다. 화면을 바꾸는 데 필요한 것은 두 번째 한 조각뿐인데,
// 제일 큰 것(주문 목록·메뉴가 들어 있다)을 먼저 다 기다린 것이다.
//
// 두 갈래로 고쳤다.
//   1) 작은 것 하나만 기다려 화면을 바꾸고, 큰 것은 뒤에서 계속 받는다.
//   2) 지난번 답을 기기에 기억해 두고, 그 세션이 아직 안 끝났으면 로그인
//      화면을 **아예 그리지 않는다**. 끝나는 시각은 서버가 알려주므로
//      (auth/me 의 expiresAt) 짐작이 세션보다 오래 살지 않는다.
//
// 2번이 제일 위험한 부분이다. 짐작이 세션보다 오래 살면 반대로 「대시보드가
// 떴다가 로그인으로 튕기는」 화면이 된다. 그래서 끝나는 시각과, 로그아웃할 때
// 짐작을 지우는지를 같이 잰다.
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
process.env.SESSION_SECRET = "login-screen-flash";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const fs = require("fs");
const path = require("path");
const request = require("supertest");
const app = require("../server");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}
const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

(async () => {
  out.push("[서버가 세션 끝나는 시각을 알려준다]");
  const staff = request.agent(app);
  let r = await staff.post("/api/auth/login").send({ password: "ownerpass123" });
  check("로그인된다", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);

  r = await staff.get("/api/auth/me");
  check("로그인 상태다", r.body.isAdmin === true, JSON.stringify(r.body));
  const until = Date.parse(r.body.expiresAt || "");
  check("★ 끝나는 시각을 같이 준다", Number.isFinite(until), JSON.stringify(r.body.expiresAt));
  check("★ 아직 안 끝났다", until > Date.now(), `${r.body.expiresAt}`);
  // 세션 쿠키는 12시간짜리다. 짐작이 그보다 오래 살면 안 된다.
  check(
    "★ 세션보다 길지 않다 (12시간 이내)",
    until - Date.now() <= 12 * 60 * 60 * 1000 + 60000,
    `${Math.round((until - Date.now()) / 60000)}분`
  );

  r = await request(app).get("/api/auth/me");
  check("로그인 안 했으면 시각도 없다", r.body.isAdmin === false && r.body.expiresAt === undefined, JSON.stringify(r.body));

  out.push("\n[첫 화면을 그리기 전에 정한다]");
  const html = read("public", "admin.html");
  const css = read("public", "css", "admin.css");
  const loginAt = html.indexOf('<div id="loginScreen"');
  const scriptAt = html.indexOf("hg_admin_until");
  check("★ 짐작하는 코드가 로그인 화면보다 먼저 온다", scriptAt > 0 && scriptAt < loginAt, `${scriptAt}, ${loginAt}`);
  check("★ 끝나는 시각을 보고 정한다", /until > Date\.now\(\)/.test(html), "시각을 안 보고 짐작한다");
  check("표를 단다", /setAttribute\("data-admin-seen", "1"\)/.test(html), "");
  check("★ 표가 있으면 로그인 화면을 안 그린다", /html\[data-admin-seen="1"\] #loginScreen \{ display: none; \}/.test(css), "");
  check(
    "저장이 막힌 기기에서도 화면은 뜬다",
    /try \{[\s\S]{0,400}hg_admin_until[\s\S]{0,400}catch/.test(html),
    "localStorage 가 막히면 스크립트가 죽는다"
  );

  out.push("\n[큰 것을 기다리지 않는다]");
  const js = read("public", "js", "admin.js");
  const checkAuthAt = js.indexOf("  async function checkAuth() {");
  const checkAuthEnd = js.indexOf("\n  // 「지난번에 로그인돼 있었다」는 짐작을", checkAuthAt);
  const body = js.slice(checkAuthAt, checkAuthEnd);
  check("checkAuth 를 찾는다", checkAuthAt > 0 && checkAuthEnd > checkAuthAt, `${checkAuthAt}, ${checkAuthEnd}`);
  check("★ bootstrap 을 먼저 다 기다리지 않는다", !/await primeBoot\(\);/.test(body), "await primeBoot() 가 남아 있다");
  check("★ bootstrap 은 나란히 시작한다", /const booting = primeBoot\(\);/.test(body), "");
  const startAt = body.indexOf("const booting = primeBoot();");
  const authAt = body.indexOf('nativeFetch("/api/auth/me")');
  const showAt = body.indexOf('$("#loginScreen").hidden = true;');
  // 못 물어본 경우(catch)에도 await booting 이 있다. 화면을 바꾼 **뒤의** 것을 본다.
  const waitAt = body.indexOf("await booting", showAt);
  check("★ 화면을 바꾼 뒤에 큰 것을 기다린다", showAt > authAt && waitAt > showAt, `auth ${authAt}, show ${showAt}, wait ${waitAt}`);
  check("bootstrap 이 먼저 시작한다", startAt > 0 && startAt < authAt, `${startAt}, ${authAt}`);
  check(
    "★ 화면을 채우기 전에는 큰 것을 기다린다",
    /await booting[\s\S]{0,80}showDashboard\(\);/.test(body),
    "안 기다리면 열세 개를 하나씩 따로 부른다"
  );

  out.push("\n[짐작이 세션보다 오래 살지 않는다]");
  check("서버가 준 시각으로만 기억한다", /rememberSignedIn\(data\.expiresAt\)/.test(js), "");
  check(
    "★ 시각을 안 주는 옛 배포에는 짐작하지 않는다",
    /const until = expiresAt \? Date\.parse\(expiresAt\) : 0;/.test(js) && /else localStorage\.removeItem\(ADMIN_SEEN_KEY\)/.test(js),
    "모르는 채로 믿는다"
  );
  {
    const logoutAt = js.indexOf('$("#logoutBtn").onclick');
    const logoutBody = js.slice(logoutAt, js.indexOf("\n  };", logoutAt));
    const forgetAt = logoutBody.indexOf("forgetSignedIn();");
    const reloadAt = logoutBody.indexOf("location.reload();");
    check(
      "★ 로그아웃하면 지운다",
      logoutAt > 0 && forgetAt > 0 && reloadAt > forgetAt,
      "지우지 않으면 다음에 대시보드가 떴다가 로그인으로 튕긴다"
    );
  }
  check("★ 짐작이 틀렸으면 showLogin 이 표를 뗀다", /function showLogin\(\) \{[\s\S]{0,400}forgetSignedIn\(\);/.test(js), "표를 안 떼면 hidden 을 풀어도 계속 숨는다");

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
