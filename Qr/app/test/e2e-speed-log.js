// 화면이 잰 시간이 실제로 서버에 닿는가.
//
// 2026-09-12 사장님: "모든 이벤트에 속도를 측정할 수 있게 해줘. 분명 대만
// 기준 오늘 아침 영업때는 빨랐는데 저녁 영업때는 갑자기 느려졌어. 느려지면
// 영업에 지장이 가."
//
// 서버가 재는 값은 서버 안에서 보낸 시간뿐이다. 신주에서 서울까지 오가는
// 시간, 연결 맺는 시간, 함수가 깨어나는 시간은 서버가 자기 시계로 못 본다.
// 그런데 사장님이 기다리는 것은 그 전부다. 그래서 화면이 잰 값을 다음
// 요청의 헤더에 얹어 보낸다.
//
// 이건 브라우저에서만 확인할 수 있다. 유닛 테스트는 헤더를 직접 만들어
// 넣으므로, 「화면이 정말로 붙이는가」는 못 잰다 — 오늘 실제로 한 번
// 놓쳤다(붙이는 코드가 아예 안 들어간 채로 유닛 테스트는 전부 통과했다).
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
process.env.SESSION_SECRET = "e2e-speed-log";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const { launchBrowser } = require("./browser");
const app = require("../server");
const db = require("../src/db");
const requestLog = require("../src/requestLog");

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

  // 실제로 나간 헤더를 본다 — 코드 모양이 아니라.
  const withTiming = [];
  page.on("request", (r) => {
    const h = r.headers()["x-client-timing"];
    if (h) withTiming.push(h);
  });

  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.locator("#loginPassword").pressSequentially("ownerpass123", { delay: 5 });
  await page.locator("#loginBtn").click();
  await page.waitForSelector("#dashboard", { state: "visible", timeout: 15000 });
  await page.waitForLoadState("networkidle");
  // 몇 번 더 오가게 해서 앞 요청의 값이 다음 요청에 얹히도록 한다.
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => fetch("/api/tables").then((r) => r.json()));
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(400);

  out.push("[화면이 잰 값을 붙여 보낸다]");
  check("★ X-Client-Timing 헤더가 실제로 나갔다", withTiming.length > 0, `${withTiming.length}번`);
  if (withTiming.length) {
    const sample = withTiming[withTiming.length - 1];
    check("주소|시간|상태 모양이다", /\/api\/[^|]*\|\d+\|\d+/.test(sample), sample.slice(0, 120));
    check("주소의 숫자는 :id 로 모인다 (있다면)", !/\/\d+\|/.test(sample), sample.slice(0, 120));
    check("ASCII 만 들어 있다 (아니면 브라우저가 요청을 거부한다)", /^[\x20-\x7E]*$/.test(sample), sample.slice(0, 120));
    check("헤더가 너무 커지지 않는다", sample.length <= 1500, `${sample.length}자`);
  }

  out.push("\n[그 값이 기록으로 남는다]");
  const handle = db.getDb();
  await page.evaluate(() => fetch("/api/tables").then((r) => r.json())); // 마지막 것을 밀어낸다
  await page.waitForTimeout(500);
  const clientRows = await handle.collection(requestLog.COLLECTION).find({ src: "client" }).toArray();
  check("★ 화면이 잰 줄이 몽고에 있다", clientRows.length > 0, `${clientRows.length}줄`);
  const serverRows = await handle.collection(requestLog.COLLECTION).find({ src: "server" }).toArray();
  check("서버가 잰 줄도 있다", serverRows.length > 0, `${serverRows.length}줄`);
  check("서버 줄에는 몽고 시간이 들어 있다", serverRows.some((r) => typeof r.mongo_ms === "number"), JSON.stringify(serverRows[0] || {}).slice(0, 160));

  out.push("\n[사장 화면에서 그 요약을 볼 수 있다]");
  await page.locator('.tab-btn[data-tab="settings"], [data-tab="settings"]').first().click().catch(() => {});
  await page.waitForTimeout(300);
  const navOk = await page.locator('.settings-nav-btn[data-category="diag"]').count();
  check("설정에 「진단 · 속도」 자리가 있다", navOk > 0, String(navOk));
  if (navOk) {
    await page.locator('.settings-nav-btn[data-category="diag"]').click();
    await page.waitForTimeout(800);
    const text = await page.locator("#diagSummary").innerText();
    check("★ 빈 화면이 아니다", text.trim().length > 0, text.slice(0, 120));
    check("불러오지 못했다고 하지 않는다", !/불러오지 못/.test(text), text.slice(0, 160));
    check("★ 시간대별이 보인다 (아침과 저녁을 가르는 표)", /시간대별/.test(text) || /아직 쌓인/.test(text), text.slice(0, 200));
    check("내려받기 버튼이 있다", (await page.locator("#diagDownloadBtn").count()) > 0);
  }

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
