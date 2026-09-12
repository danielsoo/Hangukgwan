// 기다리는 동안 화면이 기다린다고 말하는가.
//
// 2026-09-12 사장님(화면 사진과 함께): "결산탭을 누르거나 날짜를 변경하면
// 이 상태가 정지상태가 너무 오래 유지돼"
//
// 사진 속 화면은 「매출 —」, 「총합 NT$0」 이었다. 그게 이 문제의 핵심이다 —
// **기다리는 중인 것과 매출이 0 인 것이 똑같이 보인다.** 영업 중에 직원이
// 그걸 보면 장사가 안 된 줄 안다. 느린 것보다 이쪽이 더 나쁘다.
//
// 그래서 여기서 재는 것은 「빠른가」가 아니라 「기다리는 중이라고 말하는가,
// 그리고 앞의 숫자를 지우지 않는가」다. 속도는 서버 쪽 문제이고 따로 잰다
// (test/roundtrips.test.js, 설정 > 진단 · 속도).
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
process.env.SESSION_SECRET = "e2e-settlement-loading";
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

  // 결산 요청을 일부러 늦춘다. 실제로 느린 순간을 만들어야 「그때 화면이
  // 무엇을 보여주는가」를 볼 수 있다.
  let delayMs = 0;
  await page.route("**/api/settlements**", async (route) => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    await route.continue();
  });

  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.locator("#loginPassword").pressSequentially("ownerpass123", { delay: 5 });
  await page.locator("#loginBtn").click();
  await page.waitForSelector("#dashboard", { state: "visible", timeout: 15000 });
  await page.waitForLoadState("networkidle");

  out.push("[결산 탭을 누르면]");
  delayMs = 1500;
  await page.locator('[data-tab="settlement"]').first().click();
  await page.waitForTimeout(300);

  const busy = await page.locator("#tab-settlement.stl-busy").count();
  check("★ 기다리는 중이라고 화면이 말한다", busy > 0, `stl-busy ${busy}`);
  const loadingVisible = await page.locator(".stl-loading").first().isVisible().catch(() => false);
  check("★ 「불러오는 중」 줄이 보인다", loadingVisible, String(loadingVisible));
  const loadingText = loadingVisible ? await page.locator(".stl-loading").first().innerText() : "";
  check("무엇을 기다리는지 적혀 있다", /결산|載入/.test(loadingText), loadingText);

  await page.waitForTimeout(2200);
  const stillBusy = await page.locator("#tab-settlement.stl-busy").count();
  check("★ 다 되면 그 표시가 사라진다", stillBusy === 0, `stl-busy ${stillBusy}`);
  const loadingGone = await page.locator(".stl-loading").first().isVisible().catch(() => true);
  check("「불러오는 중」 줄도 사라진다", !loadingGone, String(loadingGone));

  out.push("\n[날짜를 바꾸면 — 앞의 숫자를 지우지 않는다]");
  // 비우면 새 값이 올 때까지 근거 없는 0 을 보게 되고, 그건 「매출이 없다」로
  // 읽힌다. 흐리게 두고 바뀌어야 한다.
  const before = await page.locator("#settlementRevenue, .settlement-hero").first().innerText().catch(() => "");
  delayMs = 1200;
  await page.evaluate(() => {
    const el = document.querySelector("#settlementStartDate");
    el.value = "2026-09-01";
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(300);
  const during = await page.locator("#settlementRevenue, .settlement-hero").first().innerText().catch(() => "");
  check("★ 기다리는 동안 앞의 숫자가 그대로 있다", during === before, `${JSON.stringify(before)} → ${JSON.stringify(during)}`);
  const dimmed = await page.locator("#tab-settlement.stl-busy").count();
  check("다만 기다리는 중인 것은 표가 난다", dimmed > 0, String(dimmed));

  out.push("\n[늦게 온 옛 답이 새 답을 덮어쓰지 않는다]");
  // 날짜를 두 번 빠르게 바꾸면 앞 요청이 나중에 도착할 수 있다. 그대로
  // 그리면 화면이 뒤로 간다.
  const seen = [];
  await page.route("**/api/settlements?*", async (route) => {
    const u = new URL(route.request().url());
    const start = u.searchParams.get("start") || "";
    seen.push(start);
    // 먼저 부른 것을 더 늦게 돌려준다 — 순서를 일부러 뒤집는다.
    await new Promise((r) => setTimeout(r, start === "2026-09-02" ? 1500 : 200));
    await route.continue();
  });
  await page.evaluate(() => {
    const el = document.querySelector("#settlementStartDate");
    el.value = "2026-09-02";
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(120);
  await page.evaluate(() => {
    const el = document.querySelector("#settlementStartDate");
    el.value = "2026-09-03";
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(2500);
  check("두 번 다 나갔다 (시나리오가 성립했다)", seen.includes("2026-09-02") && seen.includes("2026-09-03"), JSON.stringify(seen));
  const finalStart = await page.locator("#settlementStartDate").inputValue();
  check("★ 화면이 마지막으로 고른 날짜를 보고 있다", finalStart === "2026-09-03", finalStart);
  const endBusy = await page.locator("#tab-settlement.stl-busy").count();
  check("★ 기다림 표시가 남아 있지 않다", endBusy === 0, String(endBusy));

  await browser.close();
  server.close();
  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.log(out.join("\n"));
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
