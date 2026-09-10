// 관리자 화면의 "계정" 탭을 실제 브라우저로 확인한다 — 목록이 뜨는지,
// 등급을 바꾸면 반영되는지, 서버가 막는 경우(자기 강등/마지막 사장)를
// 사장님이 이해할 수 있는 문구로 알려주는지, 그리고 손님이 이름에 심어둔
// HTML이 관리자 화면에서 실행되지 않는지.
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
process.env.SESSION_SECRET = "e2e-accounts";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const { launchBrowser } = require("./browser");
const app = require("../server");

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
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchBrowser();
  const shots = path.join(__dirname, "..", "..", "..", "_screens");
  fs.mkdirSync(shots, { recursive: true });

  // 손님 두 명을 API로 만들어 둔다. 한 명은 이름에 스크립트를 심어서 가입.
  const evil = '<img src=x onerror="window.__pwned=1">'
  const api = await browser.newContext()
  const apiPage = await api.newPage()
  await apiPage.goto(`${base}/admin`)
  await apiPage.evaluate(
    async ([evilName]) => {
      await fetch("/api/account/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "guest@example.com", password: "hunter2hunter", name: "왕손님", phone: "0912345678" }),
      })
      await fetch("/api/account/logout", { method: "POST" })
      await fetch("/api/account/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "evil@example.com", password: "hunter2hunter", name: evilName }),
      })
      await fetch("/api/account/logout", { method: "POST" })
    },
    [evil]
  )

  out.push("\n[사장 로그인 → 계정 탭]");
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.dismiss());
  // 사장 계정 생성 + 로그인도 API 로 — 이 테스트의 대상은 관리자 화면이다.
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await fetch("/api/account/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "boss@hangukgwan.tw", password: "bosspass1234", name: "사장님" }),
    });
  });
  await page.reload({ waitUntil: "networkidle" });
  check("대시보드 진입", await page.locator("#dashboard").isVisible());
  const accountsTab = page.locator('.admin-tabs button[data-tab="accounts"]');
  check("계정 탭 버튼이 있다", await accountsTab.isVisible());
  await accountsTab.click();
  await page.waitForTimeout(800);
  check("계정 탭이 열린다", await page.locator("#tab-accounts").isVisible());

  const rows = page.locator("#accountsList .account-row");
  check("계정 3개가 보인다", (await rows.count()) === 3, `count=${await rows.count()}`);
  const listText = await page.locator("#accountsList").innerText();
  check("손님 이름이 보인다", listText.includes("왕손님"), listText.slice(0, 200));
  check("사장 배지가 보인다", listText.includes("사장"));
  await page.screenshot({ path: path.join(shots, "10-admin-accounts.png"), fullPage: true });

  out.push("\n[XSS — 손님이 이름에 심은 HTML]");
  const pwned = await page.evaluate(() => window.__pwned);
  check("손님 이름의 스크립트가 실행되지 않음", !pwned, `__pwned=${pwned}`);
  check("이름이 글자 그대로 보인다", listText.includes("<img src=x"), listText.slice(0, 300));
  check("실제 img 태그가 삽입되지 않음", (await page.locator("#accountsList img").count()) === 0);

  out.push("\n[등급 변경]");
  const guestRow = page.locator('#accountsList .account-row', { hasText: "왕손님" });
  await guestRow.locator("select").selectOption("staff");
  // 확인 다이얼로그(앱 내부 모달)
  await page.locator("#appDialogOk, #appDialogConfirm").first().click();
  await page.waitForTimeout(600);
  const afterText = await page.locator("#accountsList").innerText();
  check("손님 → 직원으로 바뀜", /왕손님[\s\S]{0,20}직원/.test(afterText), afterText.slice(0, 200));
  await page.screenshot({ path: path.join(shots, "11-admin-accounts-promoted.png"), fullPage: true });

  out.push("\n[서버가 막는 경우]");
  const bossRow = page.locator('#accountsList .account-row', { hasText: "사장님" });
  await bossRow.locator("select").selectOption("customer");
  await page.locator("#appDialogOk, #appDialogConfirm").first().click();
  await page.waitForTimeout(700);
  const dialogText = await page.locator("#appDialogMessage").innerText().catch(() => "");
  check("자기 자신 강등은 이유와 함께 거부", dialogText.includes("본인"), dialogText);
  await page.screenshot({ path: path.join(shots, "12-admin-accounts-selfdemote.png") });

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
