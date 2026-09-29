// 패드 프로필 — 로그인하면 「이 기기는 어디인가요?」, 고르면 그 프로필의
// 프린터와 자동 인쇄가 이 패드에 적용된다. 터치 수는 프로필마다 센다.
//
// 사장님(2026-09-29): "패드 프로필을 만들어줘. 여러명이 한 프로필 들어가도
// 되니까. 그냥 해당 프로필의 ip 와 프린터기 그것 때문에 있으면 좋겠다고 느낀
// 거야 / 그리고 얼마나 많은 터치 이벤트가 있는지도 프로필 별로 알 수도 있을 것
// 같고."
//
// 패드의 한국관 POS 앱(window.HangukgwanPrint)을 흉내 낸다 — e2e-printer-pick.js 와 같은 방법.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-pad-profile";
process.env.ADMIN_PASSWORD = "ownerpass123";

const { launchBrowser } = require("./browser");
const request = require("supertest");
const app = require("../server");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const KITCHEN = { name: "주방 프린터", ip: "192.168.111.142", port: 9100 };
const COUNTER = { name: "카운터 프린터", ip: "192.168.111.150", port: 9100 };

(async () => {
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  await request(app).get("/api/menu");

  const boss = request.agent(app);
  await boss.post("/api/auth/login").send({ password: "ownerpass123" });
  let r = await boss.put("/api/settings/printers").send({ printers: [KITCHEN, COUNTER] });
  const [kp, cp] = r.body.printers;
  r = await boss.put("/api/settings/pad-profiles").send({
    profiles: [
      { name: "주방", printerId: kp.id, autoPrint: true },
      { name: "카운터", printerId: cp.id, autoPrint: true },
    ],
  });
  const [kitchen, counter] = r.body.profiles;

  const browser = await launchBrowser();
  async function pad({ target = "192.168.111.150:9100", app: isApp = true, viewport = { width: 1280, height: 800 } } = {}) {
    const ctx = await browser.newContext({ viewport });
    if (isApp) {
      await ctx.addInitScript((target) => {
        window.__set = [];
        window.__target = sessionStorage.getItem("__fakeTarget") || target;
        window.HangukgwanPrint = {
          printBase64() { return "queued"; },
          target() { return window.__target; },
          available() { return true; },
          setPrinter(ip, port) {
            window.__set.push([ip, port]);
            window.__target = `${ip}:${port}`;
            sessionStorage.setItem("__fakeTarget", window.__target);
            return "ok";
          },
        };
      }, target);
    }
    const page = await ctx.newPage();
    page.on("dialog", (d) => d.dismiss());
    await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
    await page.evaluate(async () => {
      await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "ownerpass123" }) });
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    return { ctx, page };
  }
  const printDevices = async () => (await boss.get("/api/settings/print-device")).body.devices || [];

  out.push("[주방 패드 — 처음 로그인하면 묻는다]");
  const A = await pad({ target: "192.168.111.150:9100" });
  check("★ 「이 기기는 어디인가요?」가 뜬다", await A.page.locator("#padProfileBackdrop").isVisible(), "");
  const choices = await A.page.locator("#padProfileChoices button").allTextContents();
  check("프로필 두 개가 보인다", choices.length === 2 && /주방/.test(choices[0]) && /카운터/.test(choices[1]), JSON.stringify(choices));
  check("어느 프린터인지도 적혀 있다", /주방 프린터/.test(choices[0]), choices[0]);
  await A.page.locator("#padProfileChoices button", { hasText: "주방" }).first().click();
  await A.page.waitForTimeout(800);
  check("창이 닫힌다", !(await A.page.locator("#padProfileBackdrop").isVisible()), "");
  const set = await A.page.evaluate(() => window.__set);
  check("★★ 앱에 주방 프린터가 저장된다", JSON.stringify(set) === JSON.stringify([[KITCHEN.ip, KITCHEN.port]]), JSON.stringify(set));
  check("★ 자동 인쇄가 켜진다", await A.page.locator("#autoPrintToggle").isChecked(), "");
  let devs = await printDevices();
  check("★ 「자동 인쇄 중」 목록에 「주방」으로 들어간다", devs.some((d) => d.name === "주방"), JSON.stringify(devs));
  check("★ 위에 「📍 주방」이 보인다", (await A.page.locator("#padProfileBadge").textContent()) === "📍 주방", await A.page.locator("#padProfileBadge").textContent());
  check("프린터 고르기 칸도 주방 프린터", (await A.page.locator("#printerPick option:checked").textContent()) === KITCHEN.name, "");

  await A.page.reload({ waitUntil: "networkidle" });
  await A.page.waitForTimeout(1500);
  check("★ 새로고침하면 다시 묻지 않는다(기기에 남는다)", !(await A.page.locator("#padProfileBackdrop").isVisible()), "");
  check("「📍 주방」 그대로", (await A.page.locator("#padProfileBadge").textContent()) === "📍 주방", "");

  out.push("\n[📍 를 눌러 카운터로 바꾼다 — 홀 프린터 고장]");
  await A.page.locator("#padProfileBadge").click();
  await A.page.waitForTimeout(300);
  check("창이 다시 뜬다", await A.page.locator("#padProfileBackdrop").isVisible(), "");
  check("지금 프로필이 표시된다", /주방/.test(await A.page.locator("#padProfileChoices button.is-current").textContent()), "");
  await A.page.locator("#padProfileChoices button", { hasText: "카운터" }).first().click();
  await A.page.waitForTimeout(800);
  const set2 = await A.page.evaluate(() => window.__set);
  check("★★ 앱이 카운터 프린터로 바뀐다", JSON.stringify(set2[set2.length - 1]) === JSON.stringify([COUNTER.ip, COUNTER.port]), JSON.stringify(set2));
  check("「📍 카운터」", (await A.page.locator("#padProfileBadge").textContent()) === "📍 카운터", "");
  devs = await printDevices();
  const mine = devs.filter((d) => d.name === "카운터" || d.name === "주방");
  check("★ 같은 기기가 두 번 들어가지 않고 이름만 바뀐다", mine.length === 1 && mine[0].name === "카운터", JSON.stringify(devs));

  out.push("\n[두 번째 패드도 「카운터」 — 여러 패드가 한 프로필]");
  const B = await pad({ target: "192.168.111.142:9100" });
  await B.page.locator("#padProfileChoices button", { hasText: "카운터" }).first().click();
  await B.page.waitForTimeout(800);
  devs = await printDevices();
  check("★ 두 패드 모두 자동 인쇄 목록에 있다", devs.filter((d) => d.name === "카운터").length === 2, JSON.stringify(devs));

  out.push("\n[터치 수 — 프로필마다 센다]");
  for (let i = 0; i < 7; i++) await B.page.mouse.click(400, 500);
  for (let i = 0; i < 3; i++) await A.page.mouse.click(400, 500);
  // 설정 탭에 들어가면 모아 둔 것을 먼저 보내고 표를 새로 그린다.
  await B.page.locator('.admin-tabs button[data-tab="settings"]').click();
  await B.page.waitForTimeout(800);
  await A.page.locator('.admin-tabs button[data-tab="settings"]').click();
  await A.page.waitForTimeout(800);
  await A.page.locator('.admin-tabs button[data-tab="orders"]').click();
  await A.page.locator('.admin-tabs button[data-tab="settings"]').click();
  await A.page.waitForTimeout(800);
  r = await boss.get("/api/settings/pad-touches");
  const cRow = (r.body.rows || []).find((x) => x.profile === counter.id) || {};
  // B: 뽑기 1 + 7 + 탭 1 = 9 안팎, A: 3 + 탭 … — 정확한 수보다 「프로필로 모였다」를 본다.
  check("★★ 두 패드의 터치가 「카운터」 한 줄에 모인다", cRow.today >= 10, JSON.stringify(r.body.rows));
  check("「주방」으로 있을 때 누른 것은 주방 몫", ((r.body.rows || []).find((x) => x.profile === kitchen.id) || { today: 0 }).today >= 1, JSON.stringify(r.body.rows));
  const tableText = await A.page.locator("#padTouchTable").textContent();
  check("★ 설정 화면 표에 프로필 이름과 수가 보인다", /카운터/.test(tableText) && /오늘/.test(tableText) && /최근 7일/.test(tableText), tableText);
  await B.ctx.close();

  out.push("\n[사장님 폰(크롬) — 「프로필 없이 쓰기」]");
  const C = await pad({ app: false, viewport: { width: 390, height: 844 } });
  check("묻는다", await C.page.locator("#padProfileBackdrop").isVisible(), "");
  await C.page.locator("#padProfileNone").click();
  await C.page.waitForTimeout(500);
  check("자동 인쇄를 건드리지 않는다", !(await C.page.locator("#autoPrintToggle").isChecked()), "");
  await C.page.reload({ waitUntil: "networkidle" });
  await C.page.waitForTimeout(1500);
  check("★ 다시 묻지 않는다", !(await C.page.locator("#padProfileBackdrop").isVisible()), "");
  check("📍 는 「프로필」로 보인다(누르면 고를 수 있다)", /프로필/.test(await C.page.locator("#padProfileBadge").textContent()), "");
  await C.ctx.close();

  out.push("\n[설정 > 인쇄 — 프로필 편집]");
  await A.page.locator('.settings-nav-btn[data-category="print"]').click();
  await A.page.waitForTimeout(300);
  check("★ 설정 > 인쇄에 표가 보인다", await A.page.locator("#padTouchTable").isVisible(), "");
  await A.page.locator("#addPadProfileBtn").click();
  const rows = A.page.locator("#padProfilesList .pad-profile-row");
  check("추가하면 한 줄 늘어난다", (await rows.count()) === 3, "");
  await rows.nth(2).locator(".pad-profile-name").fill("2층");
  await rows.nth(2).locator(".pad-profile-printer").selectOption({ label: `🖨️ ${KITCHEN.name}` });
  await A.page.locator("#savePadProfilesBtn").click();
  await A.page.waitForTimeout(500);
  r = await boss.get("/api/settings/pad-profiles");
  const p3 = r.body.profiles[2] || {};
  check("★ 저장된다 — 이름·프린터", p3.name === "2층" && p3.printerId === kp.id, JSON.stringify(r.body.profiles));
  await A.ctx.close();

  out.push("\n[패드 크기에서 위쪽이 안 깨진다 — 📍 가 붙어도]");
  for (const [w, h] of [[1280, 800], [1024, 700], [960, 600], [800, 1280]]) {
    const P = await pad({ viewport: { width: w, height: h } });
    const first = P.page.locator("#padProfileChoices button").first();
    if (await first.isVisible()) await first.click();
    await P.page.waitForTimeout(500);
    const m = await P.page.evaluate(() => {
      const tabs = document.querySelector(".admin-tabs");
      const badge = document.querySelector("#padProfileBadge").getBoundingClientRect();
      const top = document.querySelector(".admin-topbar").getBoundingClientRect();
      return {
        tabsFit: tabs.scrollWidth <= tabs.clientWidth + 1, over: tabs.scrollWidth - tabs.clientWidth, bw: Math.round(badge.width),
        badgeIn: badge.width > 0 && badge.right <= innerWidth && badge.bottom <= top.bottom,
        pageFits: document.documentElement.scrollWidth <= innerWidth,
      };
    });
    check(`★ ${w}×${h}: 탭이 전부 보인다`, m.tabsFit, JSON.stringify(m));
    check(`${w}×${h}: 📍 가 위 줄 안에 보인다`, m.badgeIn, JSON.stringify(m));
    check(`${w}×${h}: 화면이 옆으로 안 넘친다`, m.pageFits, "");
    await P.ctx.close();
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
