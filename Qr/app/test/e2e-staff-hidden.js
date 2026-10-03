// 직원에게 안 보이는 것 — 급여, 설정의 마감 알림(LINE)·결제(ECPay)·진단·속도, 회원(VIP)의 구글 로그인.
//
// 2026-10-03 사장님: "직원들은 급여 페이지 보이면 절대 안되고 링크로 타도 안돼 설정에서 마감 알림
// 이거 전체 보이면 안되고 결제 페이지도 안되고 vip 카드 판매 가격, 할인 퍼센트 말고는 보이면 안되고
// 진단 속도도 안돼"
//
// 화면에서 숨기는 것만 보지 않는다 — 주소(#payroll)로 열어도, 로그인 기억이 있는 패드가 서버 답을
// 받기 전에도, 서버 길로 직접 불러도 막히는지 잰다.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};
process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-staff-hidden";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.STAFF_PASSWORD = "staffpass123";

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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  const login = (pw) => page.evaluate(async (p) => {
    const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: p }) });
    return (await r.json()).role;
  }, pw);
  // 사장님이 먼저 VIP 판매가·Firebase 설정을 적어 둔다.
  check("사장님 로그인", (await login("ownerpass123")) === "owner", "");
  await page.evaluate(async () => {
    await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ firebase_web_config: '{"apiKey":"OWNER","projectId":"p"}' }) });
    await fetch("/api/vip-cards/sale-settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ price: 300, discount_percent: 10 }) });
  });
  await page.evaluate(() => fetch("/api/auth/logout", { method: "POST" }));
  check("직원 로그인", (await login("staffpass123")) === "staff", "");

  out.push("[급여 — 주소로 열어도 안 된다]");
  await page.goto(`${base}/admin#payroll`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  check("★★ 「💰 급여」 탭 버튼이 안 보인다", !(await page.locator('.admin-tabs button[data-tab="payroll"]').isVisible()), "");
  check("★★ /admin#payroll 로 들어와도 급여 화면이 안 열린다", await page.locator("#tab-payroll").evaluate((el) => el.hidden || getComputedStyle(el).display === "none"), "");
  await page.evaluate(() => { location.hash = "payroll"; });
  await page.waitForTimeout(400);
  check("★ 주소를 #payroll 로 바꿔도 그대로", await page.locator("#tab-payroll").evaluate((el) => el.hidden || getComputedStyle(el).display === "none"), "");
  // 화면의 fetch 는 401 을 받으면 「로그인이 풀렸다」로 보고 내보내므로, 서버 길은 page.request 로 —
  // 같은 쿠키(직원 세션)를 쓴다.
  const st = async (u) => (await page.request.get(`${base}${u}`)).status();
  const api = {
    staff: await st("/api/payroll/staff"),
    card: await st("/api/payroll/card?staff=x&month=2026-10"),
    holidays: await st("/api/payroll/holidays"),
    line: await st("/api/settings/line"),
    lineReveal: await st("/api/settings/line/reveal"),
    payment: await st("/api/settings/payment"),
    diag: await st("/api/_diag"),
    diagLog: await st("/api/_diag/log"),
  };
  check("★★ 서버 길로 불러도 막힌다 — 급여·LINE·결제·진단 모두 401/403", Object.values(api).every((s) => s === 401 || s === 403), JSON.stringify(api));

  out.push("\n[로그인 기억이 있는 패드 — 서버 답을 받기 전에도]");
  {
    // /api/auth/me 를 2초 늦춘다. 예전엔 그 사이 「사장님」으로 그려 급여 탭이 보였다.
    await page.route("**/api/auth/me", async (route) => { await new Promise((r) => setTimeout(r, 2000)); route.continue(); });
    await page.goto(`${base}/admin#payroll`);
    await page.waitForTimeout(600);
    const early = await page.evaluate(() => ({
      staffClass: document.body.classList.contains("role-staff"),
      tabVisible: !!document.querySelector('.admin-tabs button[data-tab="payroll"]') && getComputedStyle(document.querySelector('.admin-tabs button[data-tab="payroll"]')).display !== "none",
      panelOpen: !document.querySelector("#tab-payroll").hidden,
    }));
    check("★★ 답을 받기 전에는 「직원」으로 그린다 — 급여 탭 안 보이고 안 열림", early.staffClass && !early.tabVisible && !early.panelOpen, JSON.stringify(early));
    await page.waitForTimeout(2500);
    await page.unroute("**/api/auth/me");
    await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
  }

  out.push("\n[설정 — 마감 알림·결제·진단은 안 보이고, VIP 는 판매가·할인율만]");
  await page.locator('.admin-tabs button[data-tab="settings"]').click();
  await page.waitForTimeout(500);
  for (const [cat, name] of [["notify", "마감 알림(LINE)"], ["payment", "결제(ECPay)"], ["diag", "진단·속도"]]) {
    check(`★★ 설정 왼쪽 목록에 「${name}」 없음`, !(await page.locator(`.settings-nav-btn[data-category="${cat}"]`).isVisible()), "");
    check(`★ 「${name}」 내용도 안 보인다`, !(await page.locator(`#settings-cat-${cat}`).isVisible()), "");
  }
  // 설정 찾기로 들어가도 안 나온다
  if (await page.locator("#settingsSearch, .settings-search input").first().isVisible().catch(() => false)) {
    await page.locator("#settingsSearch, .settings-search input").first().fill("LINE");
    await page.waitForTimeout(400);
    check("★ 설정 찾기로 「LINE」을 쳐도 마감 알림 칸이 안 보인다", !(await page.locator("#settings-cat-notify").isVisible()), "");
    await page.locator("#settingsSearch, .settings-search input").first().fill("");
  }
  const vipNav = page.locator('.settings-nav-btn[data-category="vip"]');
  check("★ 회원(VIP) 은 목록에 있다 — 카드 판매가 때문에", await vipNav.isVisible(), "");
  await vipNav.click();
  await page.waitForTimeout(600);
  check("★★ VIP 카드 판매가·할인율은 보인다", (await page.locator("#vipSalePriceInput").isVisible()) && (await page.locator("#vipSaleDiscountInput").isVisible()), "");
  check("★★ 구글 로그인(Firebase) 칸은 안 보인다", !(await page.locator("#vipFirebaseConfigInput").isVisible()) && !(await page.locator("text=Firebase").first().isVisible().catch(() => false)), "");
  check("★ 판매가 칸에 사장님이 적은 300", (await page.inputValue("#vipSalePriceInput")) === "300", await page.inputValue("#vipSalePriceInput"));
  check("★ 설정 수정 권한이 없으면 보기만 — 칸은 잠기고 저장 버튼 대신 「보기만」", (await page.locator("#vipSalePriceInput").evaluate((el) => el.readOnly)) && !(await page.locator("#saveVipSaleBtn").isVisible()) && (await page.locator(".vip-sale-readonly").isVisible()), "");
  // 사장님이 직원에게 「설정 수정」을 켜 준다(다른 창에서).
  const ownerCtx = await browser.newContext();
  await ownerCtx.request.post(`${base}/api/auth/login`, { data: { password: "ownerpass123" } });
  await ownerCtx.request.put(`${base}/api/settings/staff-permissions`, { data: { settingsEdit: true } });
  // 직원이 「설정 수정」 권한으로 Firebase 설정을 덮으려 해도 안 바뀐다.
  const put = await page.request.put(`${base}/api/settings`, { data: { firebase_web_config: '{"apiKey":"STAFF"}' } });
  const fb = (await (await page.request.get(`${base}/api/settings`)).json()).firebase_web_config;
  check("설정 수정 권한이 있는 직원 — 저장 요청 자체는 받는다", put.status() === 200, String(put.status()));
  check("★★ 직원이 서버 길로 Firebase 설정을 바꾸려 해도 그대로", /OWNER/.test(String(fb)) && !/STAFF/.test(String(fb)), String(fb));

  out.push("\n[사장님은 그대로 다 본다]");
  await page.evaluate(() => fetch("/api/auth/logout", { method: "POST" }));
  const back = await login("ownerpass123");
  check("다시 사장님으로 로그인", back === "owner", String(back));
  await page.goto(`${base}/admin?again=1#payroll`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  check("★ 사장님은 /admin#payroll 로 급여가 열린다", !(await page.locator("#tab-payroll").evaluate((el) => el.hidden)), "");
  await page.locator('.admin-tabs button[data-tab="settings"]').click();
  await page.waitForTimeout(400);
  check("★ 사장님 설정엔 마감 알림·결제·진단", (await page.locator('.settings-nav-btn[data-category="notify"]').isVisible()) && (await page.locator('.settings-nav-btn[data-category="payment"]').isVisible()) && (await page.locator('.settings-nav-btn[data-category="diag"]').isVisible()), "");
  await page.locator('.settings-nav-btn[data-category="vip"]').click();
  await page.waitForTimeout(400);
  check("★ 사장님은 VIP 에서 Firebase 칸도 본다", await page.locator("#vipFirebaseConfigInput").isVisible(), "");

  await ownerCtx.close();
  await browser.close();
  server.close();
  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
