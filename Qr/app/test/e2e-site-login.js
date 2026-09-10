// 실제 홈페이지(Web/, 5페이지 디자인) + 주문 시스템 API 를 한 서버에 붙여
// 통합 로그인 흐름을 브라우저로 확인한다.
//
// 배포에서는 두 개의 Vercel 프로젝트이고 vercel.json 의 rewrite 가 /api/* 를
// 주문 시스템으로 넘긴다. 여기서는 그 최종 형태(한 도메인)를 흉내내서
// Web/out 을 정적으로 서빙하고 /api/* 는 이 앱이 직접 처리한다 — 브라우저
// 입장에서는 배포와 동일하게 "같은 오리진의 /api/*" 다.
const path = require("path");
const fs = require("fs");

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
process.env.SESSION_SECRET = "e2e-site";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const express = require("express");
const { launchBrowser } = require("./browser");
const app = require("../server");
const { store } = require("../src/db");

const SITE_OUT = path.join(__dirname, "..", "..", "..", "Web", "out");

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
  if (!fs.existsSync(path.join(SITE_OUT, "index.html"))) {
    console.log("홈페이지 빌드가 없습니다 — Web/ 에서 `npm run build` 하세요.");
    process.exit(1);
  }

  // 홈페이지 정적 파일을 이 앱 앞에 붙인다(배포의 rewrite 와 같은 효과).
  const host = express();
  host.use(express.static(SITE_OUT, { extensions: ["html"] }));
  host.use((req, res, next) => {
    // trailingSlash: true 라 /login → /login/index.html
    const rel = req.path.replace(/^\/+|\/+$/g, "");
    const candidate = path.join(SITE_OUT, rel, "index.html");
    if (!req.path.startsWith("/api") && candidate.startsWith(SITE_OUT) && fs.existsSync(candidate)) {
      return res.sendFile(candidate);
    }
    next();
  });
  host.use(app);

  const server = await new Promise((r) => {
    const s = host.listen(0, () => r(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchBrowser();
  const shots = path.join(__dirname, "..", "..", "..", "_screens");
  fs.mkdirSync(shots, { recursive: true });

  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();

  out.push("\n[홈페이지 — 로그아웃 상태]");
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  check("5페이지 홈페이지가 뜬다", (await page.locator("header").count()) > 0);
  check("헤더에 로그인 링크", await page.locator('header a[href="/login/"]').first().isVisible());
  check("관리자 버튼 없음", (await page.locator('header a[href="/account/"]').count()) === 0);
  await page.screenshot({ path: path.join(shots, "20-site-logged-out.png") });

  out.push("\n[손님 가입 → 내 계정]");
  await page.locator('header a[href="/login/"]').first().click();
  await page.waitForURL("**/login/**");
  await page.waitForTimeout(400);
  check("로그인 화면", await page.locator('input[type="email"]').isVisible());
  await page.screenshot({ path: path.join(shots, "21-site-login.png") });

  await page.locator('a[href="/signup/"]').first().click();
  await page.waitForURL("**/signup/**");
  await page.fill('input[autocomplete="name"]', "왕손님");
  await page.fill('input[type="email"]', "guest@example.com");
  await page.fill('input[autocomplete="new-password"]', "hunter2hunter");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/account/**", { timeout: 15000 });
  await page.waitForTimeout(700);

  let body = await page.locator("body").innerText();
  check("내 계정 화면 진입", page.url().includes("/account/"));
  check("이메일 표시", body.includes("guest@example.com"), body.slice(0, 150));
  check("손님 계정 화면엔 관리자 안내가 없음", (await page.locator('main a[href*="/admin"]').count()) === 0);
  check("VIP 카드 등록칸이 보인다", body.includes("VIP"), body.slice(0, 250));
  check("이전 불가 안내가 보인다", /옮길 수 없|轉移|cannot be moved/.test(body), body.slice(0, 400));
  await page.screenshot({ path: path.join(shots, "22-site-account-customer.png"), fullPage: true });

  await require("./disable-order-hours")();

  out.push("\n[VIP 카드 등록]");
  const iso = new Date().toISOString().slice(0, 10);
  store.vipCards.push({ id: 9001, card_number: "V0001", discount_percent: 10, issue_date: iso, google_uid: null, account_id: null });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const cardInput = page.locator('form:has-text("VIP") input, input[maxlength="30"]').first();
  await cardInput.fill("V0001");
  await page.locator('form:has(input[maxlength="30"]) button[type="submit"]').first().click();
  await page.waitForTimeout(900);
  body = await page.locator("body").innerText();
  check("카드가 등록되어 표시된다", body.includes("V0001"), body.slice(0, 400));
  check("할인율이 보인다", body.includes("10%"), body.slice(0, 400));
  await page.screenshot({ path: path.join(shots, "23-site-account-vip.png"), fullPage: true });

  out.push("\n[주문 내역이 계정에 뜬다]");
  // 주문 API 는 테이블 인원수가 먼저 정해져 있어야 받는다(실제 화면에서는
  // "몇 분이세요?" 를 먼저 묻는다). 테스트에서는 직접 채운다.
  const t7 = store.tables.find((t) => String(t.number) === "7");
  if (t7) {
    t7.party_size = 2;
    // 시각도 같이 — 없으면 옛 데이터로 보고 만료시킨다(src/partySize.js).
    t7.party_size_updated_at = new Date().toISOString();
  }
  const placed = await page.evaluate(async () => {
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ tableNumber: "7", items: [{ itemId: 1, qty: 1 }] }),
    });
    return { status: res.status, body: await res.json() };
  });
  check("로그인 상태로 주문됨", placed.status === 201, JSON.stringify(placed).slice(0, 200));
  check("VIP 할인이 자동 적용", placed.body.vip_card_number === "V0001", JSON.stringify(placed.body.vip_card_number));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  body = await page.locator("body").innerText();
  check("주문 내역에 표시된다", /NT\$/.test(body) && !/아직 주문 내역이 없|尚無訂單|No orders yet/.test(body), body.slice(0, 500));
  await page.screenshot({ path: path.join(shots, "24-site-account-orders.png"), fullPage: true });

  out.push("\n[사장 계정 — 관리자 버튼]");
  const bossPage = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await bossPage.goto(`${base}/signup/`, { waitUntil: "networkidle" });
  await bossPage.fill('input[autocomplete="name"]', "사장님");
  await bossPage.fill('input[type="email"]', "boss@hangukgwan.tw");
  await bossPage.fill('input[autocomplete="new-password"]', "bosspass1234");
  await bossPage.click('button[type="submit"]');
  await bossPage.waitForURL("**/account/**", { timeout: 15000 });
  await bossPage.waitForTimeout(700);
  const bossBody = await bossPage.locator("body").innerText();
  check("사장 등급 표시", bossBody.includes("사장") || bossBody.includes("負責人") || bossBody.includes("Owner"), bossBody.slice(0, 250));
  check("사장 계정 화면에 관리자 버튼", (await bossPage.locator('main a[href*="/admin"]').count()) > 0);
  await bossPage.screenshot({ path: path.join(shots, "25-site-account-owner.png"), fullPage: true });

  await bossPage.goto(`${base}/`, { waitUntil: "networkidle" });
  await bossPage.waitForTimeout(600);
  const bossHeader = await bossPage.locator("header").innerText();
  check("헤더에도 관리자 버튼", /관리|管理|Admin/.test(bossHeader), bossHeader.slice(0, 200));
  await bossPage.screenshot({ path: path.join(shots, "26-site-home-owner.png") });

  out.push("\n[관리자 대시보드로 재로그인 없이]");
  await bossPage.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await bossPage.waitForTimeout(900);
  check("대시보드가 보인다 (로그인 화면 아님)", await bossPage.locator("#dashboard").isVisible());
  await bossPage.screenshot({ path: path.join(shots, "27-site-admin.png") });

  await browser.close();
  server.close();
  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.log(out.join("\n"));
  console.error("\nHARNESS ERROR:", e.message);
  process.exit(1);
});
