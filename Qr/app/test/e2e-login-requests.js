// 로그인 한 번에 요청이 몇 개 나가나.
//
// 2026-09-12 사장님: "로그인도 그렇고 버튼 누르는 것도 그렇고 다" 느리다.
//
// 관리자 화면이 뜰 때 admin.js 는 /api 주소 열세 곳을 부르고 있었다. 그
// 열세 개는 서버에서 각자 store 문서를 다시 읽고 세션을 다시 조회한다.
// 하는 일은 거의 없는데(전부 동기 함수, 자기 질의 없음) 값은 열세 번 낸다.
//
// 여기서 재는 것은 딱 하나 — **실제로 나간 /api 요청의 개수**다. 코드가
// 어떻게 생겼는지가 아니라 네트워크에 뭐가 나갔는지를 본다. 나중에 누가
// load 함수를 하나 더 붙이면 이 숫자가 바로 올라간다.
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
process.env.SESSION_SECRET = "e2e-login-requests";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const { launchBrowser } = require("./browser");
const app = require("../server");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

(async () => {
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.dismiss());

  const api = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/")) api.push(`${r.method()} ${u.pathname}`);
  });

  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });

  // auth/me 는 일부러 따로 나간다(admin.js checkAuth). 「누구인가」만 먼저 받아
  // 화면을 대시보드로 바꾸고, 주문·메뉴까지 든 큰 bootstrap 은 뒤에서 나란히
  // 받는다 — 큰 것을 다 기다리는 동안 로그인 화면이 떠 있던 것을 고친 것이다.
  // 그래서 여기서 허락하는 것은 그 둘(과 아래 로고 그림)뿐이다.
  const BOOT_PAIR = ["GET /api/bootstrap", "GET /api/auth/me"];
  out.push("[로그인 화면을 띄우는 데 몇 번 묻나]");
  const beforeLogin = api.slice();
  check(
    "★ 로그인 화면은 bootstrap + auth/me 두 번으로 뜬다",
    beforeLogin.length <= 2 && beforeLogin.every((x) => BOOT_PAIR.includes(x)),
    beforeLogin.join(", ")
  );
  check("/api/bootstrap 을 부른다", beforeLogin.includes("GET /api/bootstrap"), beforeLogin.join(", "));

  api.length = 0;
  await page.locator("#loginPassword").pressSequentially("ownerpass123", { delay: 5 });
  await page.locator("#loginBtn").click();
  await page.waitForSelector("#dashboard", { state: "visible", timeout: 15000 });
  // 로그인은 화면을 새로 띄운다(2026-09-11 — 앞사람 화면이 남지 않게).
  // 그래서 여기서 세는 것은 새로 뜬 화면이 보내는 것들이다.
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);

  const gets = api.filter((x) => x.startsWith("GET "));
  out.push("\n[관리자 화면을 띄우는 데 몇 번 묻나]");
  out.push("  나간 것: " + gets.join(", "));
  // 로고 미리보기는 JSON 이 아니라 그림(img.src)이라 bootstrap 에 담을 수 없다.
  const ALLOWED = BOOT_PAIR.concat(["GET /api/settings/logo-preview"]);
  check(
    `★ GET 요청이 세 번을 넘지 않는다 (예전 열세 번)`,
    gets.length <= 3,
    `${gets.length}번 — ${gets.join(", ")}`
  );
  // 새 기능이 showDashboard() 에 load 를 하나 더 붙이면 여기서 그 이름이 나온다.
  // 고칠 곳은 이 시험이 아니라 src/routes/bootstrap.js 의 목록이다.
  const extra = gets.filter((g) => !ALLOWED.includes(g));
  check("★ bootstrap 에 안 실린 요청이 없다", extra.length === 0, extra.join(", "));
  check("★ /api/bootstrap 을 부른다", gets.some((g) => g === "GET /api/bootstrap"), gets.join(", "));
  for (const gone of [
    "GET /api/orders", "GET /api/menu/admin", "GET /api/tables", "GET /api/settings",
    "GET /api/menu/admin/trash", "GET /api/settings/printers", "GET /api/settings/pad-profiles",
  ]) {
    check(`${gone} 이 따로 안 나간다`, !gets.includes(gone), gets.join(", "));
  }

  out.push("\n[줄인 게 값을 지운 게 아니다 — 한 번에 받은 안에 진짜가 들었나]");
  check("관리자 화면이 떴다", await page.locator("#dashboard").isVisible());
  const boot = await page.evaluate(() => fetch("/api/bootstrap").then((r) => r.json()));
  const keys = Object.keys(boot || {});
  for (const k of [
    "/api/auth/me", "/api/orders", "/api/menu/admin", "/api/tables", "/api/settings",
    "/api/settings/ticket-print", "/api/settings/move-slip", "/api/settings/escpos",
    "/api/settings/order-hours", "/api/settings/print-device", "/api/test-mode",
    "/api/vip-cards/sale-settings",
    "/api/menu/admin/trash", "/api/settings/printers", "/api/settings/pad-profiles",
  ]) {
    check(`${k} 의 답이 들어 있다`, k in (boot || {}), keys.join(", "));
  }
  check("사장 전용 칸도 들어 있다", "/api/settings/staff-permissions" in (boot || {}), keys.join(", "));
  check("메뉴가 목록 모양이다", Array.isArray(boot["/api/menu/admin"]), typeof boot["/api/menu/admin"]);
  check("테이블이 목록 모양이다", Array.isArray(boot["/api/tables"]), typeof boot["/api/tables"]);
  check("로그인 상태가 사장이다", boot["/api/auth/me"] && boot["/api/auth/me"].role === "owner", JSON.stringify(boot["/api/auth/me"]));

  out.push("\n[두 번째부터는 진짜로 다시 묻는다 — 옛 값에 갇히면 안 된다]");
  api.length = 0;
  await page.evaluate(() => fetch("/api/tables").then((r) => r.json()));
  await page.waitForTimeout(300);
  check(
    "★ 같은 주소를 다시 부르면 네트워크로 나간다",
    api.includes("GET /api/tables"),
    api.join(", ")
  );

  await browser.close();
  server.close();
  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => {
  console.log(out.join("\n"));
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
