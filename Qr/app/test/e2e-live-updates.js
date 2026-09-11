// 다른 기기에서 바꾼 것이 **새로고침 없이** 이 화면에 나타나는가.
//
// 사장님(2026-09-11): "현재 뭐가 바뀌거나 인원이 추가되거나 메뉴가
// 추가되거나 그게 바로바로 반영이 안되고 새로고침을 해야 바뀌어있어.
// 이거 실시간 바뀌는 걸로 적용해야 할 것 같아. 안 그럼 운영하는데 차질이
// 있을 것 같아."
//
// 서버가 알림을 쏘는지는 realtime-push.test.js 가 잰다. 여기서 보는 것은
// 그 다음이다 — **알림이 도착했을 때 화면이 실제로 바뀌는가.** 서버가
// 아무리 잘 쏴도 화면이 안 듣거나, 듣고도 그리지 않으면 사장님에게는
// 아무것도 안 바뀐 것이다.
//
// 이 환경에는 Pusher 계정이 없으므로 브라우저의 Pusher 를 가짜로 바꿔
// 끼운다. 가짜는 「연결됐다」고 말하고, 테스트가 원할 때 이벤트를 하나
// 떨어뜨린다. 나머지(구독·핸들러·다시 불러오기·다시 그리기)는 전부 진짜다.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-live-updates";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";
// /api/settings 가 realtime.enabled 를 true 로 내려보내게 한다 — 화면이
// 구독 코드를 타야 이 테스트가 의미가 있다. 서버 쪽 Pusher 는 아래에서
// 가짜로 바꿔 끼우므로 밖으로 나가는 요청은 없다.
process.env.PUSHER_APP_ID = "test-app";
process.env.PUSHER_KEY = "test-key";
process.env.PUSHER_SECRET = "test-secret";
process.env.PUSHER_CLUSTER = "ap3";
class FakePusher {
  constructor() {}
  trigger() { return Promise.resolve(); }
}
require.cache[require.resolve("pusher")] = {
  id: require.resolve("pusher"), filename: require.resolve("pusher"),
  loaded: true, exports: FakePusher, paths: [],
};

const { launchBrowser } = require("./browser");
const app = require("../server");
const { store } = require("../src/db");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

// 브라우저에 끼울 가짜 Pusher. 진짜와 같은 모양만 흉내 낸다.
const FAKE_PUSHER_SCRIPT = `
window.__pusherEvents = {};
window.Pusher = function () {
  this.connection = { bind: function (name, fn) { if (name === "connected") setTimeout(fn, 0); } };
  this.subscribe = function () {
    return { bind: function (event, fn) { window.__pusherEvents[event] = fn; } };
  };
};
window.__emit = function (event, payload) {
  if (window.__pusherEvents[event]) window.__pusherEvents[event](payload);
};
`;

(async () => {
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await ctx.addInitScript(FAKE_PUSHER_SCRIPT);
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.dismiss());
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "ownerpass123" }) });
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  check("화면이 실시간 모드로 붙었다", await page.evaluate(() => !!window.__pusherEvents.changed),
    JSON.stringify(await page.evaluate(() => Object.keys(window.__pusherEvents))));
  check("★ 주문 말고 나머지 알림도 듣고 있다", await page.evaluate(() => !!window.__pusherEvents.data));

  const T = store.tables.find((t) => !t.is_counter).number;

  // ── 인원수 ────────────────────────────────────────────────────────
  out.push("\n[다른 기기에서 인원을 바꾼다]");
  const partyOnScreen = () =>
    page.evaluate((t) => {
      const el = [...document.querySelectorAll("#tablesList .table-chip")]
        .find((c) => ((c.querySelector(".num") || {}).textContent || "").trim() === t);
      if (!el) return "(칩을 못 찾음)";
      const badge = el.querySelector(".table-party-badge");
      return badge ? badge.textContent.trim() : "(인원 없음)";
    }, String(T));

  const before = await partyOnScreen();
  // 이 화면을 거치지 않는 진짜 다른 손님/기기처럼 서버에 직접 넣는다.
  const put = await fetch(`${base}/api/tables/${encodeURIComponent(T)}/party-size`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ partySize: 7, adults: 7, children: 0 }),
  });
  check("다른 기기의 인원 입력이 저장됐다", put.ok, String(put.status));
  await page.waitForTimeout(400);
  const stillOld = await partyOnScreen();
  check("아직 화면은 모른다 (알림 전)", !/7/.test(stillOld) || stillOld === before, stillOld.slice(0, 80));

  await page.evaluate(() => window.__emit("data", { what: "tables" }));
  await page.waitForTimeout(900);
  const after = await partyOnScreen();
  // ★ 새로고침을 한 번도 안 했다.
  check("★★ 새로고침 없이 인원 7명이 화면에 뜬다", /7/.test(after), after.slice(0, 120));

  // ── 메뉴 ──────────────────────────────────────────────────────────
  out.push("\n[다른 기기에서 메뉴를 추가한다]");
  await page.locator('.admin-tabs button[data-tab="menu"]').click();
  await page.waitForTimeout(700);
  const NEW_NAME = "실시간테스트김치전";
  const menuHas = () => page.evaluate((n) => document.querySelector("#menuCategories").textContent.includes(n), NEW_NAME);
  check("아직 없다", (await menuHas()) === false);

  // 다른 기기처럼 로그인한 세션으로 서버에 직접 넣는다.
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "ownerpass123" }),
  });
  const cookie = (login.headers.getSetCookie ? login.headers.getSetCookie() : [login.headers.get("set-cookie")])
    .filter(Boolean).map((c) => c.split(";")[0]).join("; ");
  const cat = store.categories[0];
  const created = await fetch(`${base}/api/menu/admin/items`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ category_id: cat.id, code: "9911", name_ko: NEW_NAME, name_zh: "測試泡菜煎餅", price: 200 }),
  });
  check("다른 기기의 메뉴 추가가 저장됐다", created.ok, `${created.status} ${await created.text().catch(() => "")}`);
  await page.waitForTimeout(400);
  check("아직 화면은 모른다 (알림 전)", (await menuHas()) === false);

  await page.evaluate(() => window.__emit("data", { what: "menu" }));
  await page.waitForTimeout(900);
  check("★★ 새로고침 없이 새 메뉴가 화면에 뜬다", await menuHas());

  // ── 엉뚱한 것까지 다시 받지 않는다 ─────────────────────────────────
  out.push("\n[인원 하나 고칠 때 메뉴까지 다시 받지는 않는다]");
  const seen = [];
  page.on("request", (r) => { const u = r.url(); if (u.includes("/api/")) seen.push(u.replace(base, "")); });
  await page.evaluate(() => window.__emit("data", { what: "tables" }));
  await page.waitForTimeout(800);
  check("테이블만 다시 부른다", seen.some((u) => u.startsWith("/api/tables")), JSON.stringify(seen));
  check("★ 메뉴는 안 부른다", !seen.some((u) => u.startsWith("/api/menu")), JSON.stringify(seen));

  out.push("\n[한 번도 새로고침하지 않았다]");
  // 이 페이지는 로그인 직후의 그 문서 그대로다 — 위의 모든 변화가
  // 새로고침 없이 일어났다는 뜻이다.
  check("★ 같은 문서에서 다 일어났다",
    await page.evaluate(() => performance.getEntriesByType("navigation").length === 1));

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  await browser.close();
  server.close();
  process.exit(fail === 0 ? 0 : 1);
})();
