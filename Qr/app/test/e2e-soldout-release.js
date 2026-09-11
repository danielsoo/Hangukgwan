// 품절이 언제 풀리는지 화면이 말해주는가 — 실제로 열어서 읽어본다.
//
// 사장님(2026-09-11): "이거 품절 10일까지였는데 오늘 11일인데 안 풀렸어."
//
// 서버는 제때 풀어주고 있었다. 문제는 화면이었다.
//
//   1. 배지에 「9/10 ~ 9/10」만 있어서, 11일 아침엔 당연히 풀렸어야 한다고
//      읽힌다. 실제로는 그날 영업 시작(11:00)에 풀리는데 그 말이 없었다.
//   2. 메뉴 목록은 로그인할 때 한 번 불러온 것을 계속 쓴다. 가게 태블릿은
//      화면을 켜둔 채라, 시각이 지나도 어제 목록을 그대로 보여주고 있었다.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "soldout-release";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const { launchBrowser } = require("./browser");
const app = require("../server");
const { store, connectDB, save } = require("../src/db");
const { taipeiDateString } = require("../src/time");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const statusOf = (page, code) =>
  page.evaluate((c) => {
    const tr = [...document.querySelectorAll("#menuCategories tr")].find(
      (r) => r.children[1] && r.children[1].textContent === String(c)
    );
    return tr ? tr.children[4].innerText.replace(/\n/g, " | ") : null;
  }, code);

(async () => {
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  page.on("dialog", (d) => d.dismiss());

  // 먼저 화면을 한 번 열어야 서버가 메뉴를 심는다.
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "ownerpass123" }) });
  });

  await connectDB();
  const item = store.menuItems[0];
  const today = taipeiDateString();
  // 사장님이 걸어두셨던 그 품절과 같은 모양: 오늘 하루짜리.
  item.soldout_from = today;
  item.soldout_until = today;
  store.settings.store_hours = "11:00-13:35, 16:30-20:35";
  delete store.settings.soldout_release_time;
  await save();

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1400);
  await page.locator('.admin-tabs button[data-tab="menu"]').click();
  await page.waitForTimeout(1000);

  out.push("[★★ 배지가 언제 풀리는지 말한다]");
  {
    const txt = await statusOf(page, item.code);
    check("품절로 보인다", /품절|售完/.test(txt || ""), String(txt));
    // 이게 없어서 사장님이 「안 풀렸어」로 보신 것이다.
    check("★ 풀리는 시각이 적혀 있다", /풀림|恢復/.test(txt || ""), String(txt));
    check("★ 시각이 영업 시작(11:00)이다", /11:00/.test(txt || ""), String(txt));
    // 「오늘까지 품절」이면 내일 풀린다. 오늘 날짜가 아니라 내일 날짜가 적혀야 한다.
    const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
    const md = `${Number(tomorrow.slice(5, 7))}월 ${Number(tomorrow.slice(8, 10))}일`;
    check("★ 내일 날짜가 적힌다", (txt || "").includes(md), `${md} vs ${txt}`);
  }

  out.push("\n[★★ 그 시각에 스스로 다시 불러오도록 알람이 걸려 있다]");
  {
    // 화면이 기다리고 있는지, 아니면 아예 안 기다리는지. 사장님 태블릿은
    // 화면을 켜둔 채라 이 알람이 없으면 어제 목록을 계속 보여준다.
    const armed = await page.evaluate(() => window.__soldOutRefreshAt);
    check("★ 알람이 걸려 있다", typeof armed === "string" && armed.length > 10, String(armed));
    check("★ 그 시각이 아직 안 지났다", armed && Date.parse(armed) > Date.now(), String(armed));
  }

  out.push("\n[해제 시각을 사장님이 바꾸면 화면이 따라간다]");
  {
    await page.locator('.admin-tabs button[data-tab="settings"]').click();
    await page.waitForTimeout(900);
    // 설정은 분류로 접혀 있다 — 「주문 규칙」을 열어야 이 카드가 보인다.
    await page.locator('.settings-nav-btn[data-category="order"]').click();
    await page.waitForTimeout(500);
    const field = page.locator("#s_soldout_release_time");
    check("★ 「주문 규칙」 안에 있다", await field.isVisible(), "");
    check("설정 칸이 있다", (await field.count()) === 1, "");
    check("비어 있으면 영업 시작을 따른다고 적힌다",
      /11:00/.test(await page.locator("#soldOutReleaseEffective").textContent()), "");

    // 자정으로 바꾼다.
    await field.fill("00:00");
    // 저장 버튼은 이 카드 안에 있다 — 고쳐놓고 저장할 곳이 없으면 안 고친 것과 같다.
    check("★ 이 카드에 저장 버튼이 있다", await page.locator("#saveSoldOutReleaseBtn").isVisible(), "");
    await page.locator("#saveSoldOutReleaseBtn").click();
    await page.waitForTimeout(1200);
    const saved = await page.evaluate(async () => (await fetch("/api/settings").then((r) => r.json())).soldout_release_time);
    check("★ 저장된다", saved === "00:00", String(saved));

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1400);
    await page.locator('.admin-tabs button[data-tab="menu"]').click();
    await page.waitForTimeout(900);
    const txt = await statusOf(page, item.code);
    check("★ 배지가 새 시각을 말한다", /00:00/.test(txt || ""), String(txt));
    check("11:00 은 더 이상 안 적힌다", !/11:00/.test(txt || ""), String(txt));
  }

  out.push("\n[이상한 값은 저장되지 않는다]");
  {
    // 저장은 됐다고 해놓고 조용히 예전 시각으로 돌아가면, 사장님은 고른 대로
    // 됐다고 믿는다. 서버가 막는다.
    const after = await page.evaluate(async () => {
      const r = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soldout_release_time: "25:99" }) });
      const s = await fetch("/api/settings").then((x) => x.json());
      return { status: r.status, value: s.soldout_release_time, hours: s.store_hours };
    });
    check("★ 틀린 값은 거절한다", after.status === 400, JSON.stringify(after));
    // 빈 칸처럼 다뤄서 조용히 지워버리면, 고른 시각이 저장된 줄 알고 사라진다.
    check("★ 고른 시각이 그대로 남는다", after.value === "00:00", JSON.stringify(after));
    // 한 칸이 틀렸다고 나머지가 반쯤 저장되면 안 된다.
    const halfSaved = await page.evaluate(async () => {
      const before = (await fetch("/api/settings").then((r) => r.json())).store_phone || "";
      await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soldout_release_time: "99:99", store_phone: "0000-000-000" }) });
      const after = (await fetch("/api/settings").then((r) => r.json())).store_phone || "";
      return { before, after };
    });
    check("★ 거절되면 다른 칸도 안 바뀐다", halfSaved.before === halfSaved.after, JSON.stringify(halfSaved));

    const cleared = await page.evaluate(async () => {
      await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soldout_release_time: "" }) });
      return (await fetch("/api/settings").then((r) => r.json())).soldout_release_time;
    });
    check("★ 비우면 지워진다 (영업 시작을 따른다)", cleared == null, String(cleared));
  }

  out.push("\n[팔리고 있으면 알람을 안 건다]");
  {
    item.soldout_from = null;
    item.soldout_until = null;
    await save();
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1400);
    const armed = await page.evaluate(() => window.__soldOutRefreshAt);
    check("★ 기다릴 것이 없으면 안 기다린다", armed == null, String(armed));
    const txt = await statusOf(page, item.code);
    check("판매 중으로 돌아온다", /판매|供應/.test(txt || ""), String(txt));
    check("풀림 줄도 사라진다", !/풀림|恢復/.test(txt || ""), String(txt));
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  await browser.close();
  server.close();
  process.exit(fail === 0 ? 0 : 1);
})();
