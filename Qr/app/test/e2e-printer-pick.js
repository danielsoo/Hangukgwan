// 각 패드가 가게 프린터 목록에서 자기 프린터를 고른다 — 포트를 입력하지 않고.
//
// 사장님(2026-09-29): "현재 주방쪽이랑 카운터에 2개가 있어. 각 패드에 각
// 프린터기를 등록하고 싶어. 그래서 언제든 모르는 사람들도 굳이 포트 번호를 또
// 입력하고 이럴 거 없이 로그인한 상태에서 각 프린터기를 편하게 변동할 수
// 있게." 카운터 프린터는 블루투스가 아니라 와이파이(IP)로.
//
// 프린터에 직접 닿는 것은 패드의 한국관 POS 앱이다(window.HangukgwanPrint).
// 이 시험은 그 앱을 흉내 내고 — target()/setPrinter()/printBase64() — 화면에서
// 고른 것이 앱에 그대로 저장되는지 본다.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-printer-pick";
process.env.ADMIN_PASSWORD = "ownerpass123";

const fs = require("fs");
const path = require("path");
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

  out.push("[서버 — 가게 프린터 목록]");
  const boss = request.agent(app);
  await boss.post("/api/auth/login").send({ password: "ownerpass123" });
  let r = await boss.put("/api/settings/printers").send({ printers: [KITCHEN, COUNTER] });
  check("저장된다", r.status === 200 && r.body.printers.length === 2, JSON.stringify(r.body));
  check("번호가 붙는다", r.body.printers.every((p) => p.id), "");
  r = await boss.put("/api/settings/printers").send({ printers: [{ name: "x", ip: "192.168.0.1; rm -rf" }] });
  check("★ 이상한 주소는 거절", r.status === 400, `${r.status}`);
  r = await boss.put("/api/settings/printers").send({ printers: [KITCHEN, COUNTER] });
  r = await request(app).get("/api/settings/printers");
  check("로그인 안 하면 못 본다", r.status === 401 || r.status === 403, `${r.status}`);

  const browser = await launchBrowser();
  // 패드 하나 — 앱이 지금 주방 프린터로 찍고 있다.
  async function pad({ target, withSetPrinter = true }) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(({ target, withSetPrinter }) => {
      window.__jobs = [];
      window.__set = [];
      // 진짜 앱은 기기에 저장한다(SharedPreferences) — 새로고침에도 남게 흉내 낸다.
      window.__target = sessionStorage.getItem("__fakeTarget") || target;
      const b = {
        printBase64(b64) { window.__jobs.push(b64); return "queued"; },
        target() { return window.__target; },
        available() { return true; },
      };
      if (withSetPrinter) {
        b.setPrinter = (ip, port) => {
          window.__set.push([ip, port]);
          window.__target = `${ip}:${port}`;
          sessionStorage.setItem("__fakeTarget", window.__target);
          return "ok";
        };
      }
      window.HangukgwanPrint = b;
    }, { target, withSetPrinter });
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

  out.push("\n[주방 패드 — 로그인한 화면에서 고른다]");
  const A = await pad({ target: "192.168.111.142:9100" });
  check("★ 실시간 주문 화면에 「이 기기 프린터」가 있다", await A.page.locator("#printerPickWrap").isVisible());
  const selText = await A.page.locator("#printerPick option:checked").textContent();
  check("★ 지금 쓰는 프린터가 골라져 있다(주방)", selText === KITCHEN.name, selText);
  check("★ 포트를 입력하는 칸이 없다 — 고르기만", (await A.page.locator("#printerPickWrap input").count()) === 0, "");

  // 주방 프린터 고장 — 카운터 프린터로 바꾼다.
  await A.page.selectOption("#printerPick", { label: COUNTER.name });
  await A.page.waitForTimeout(500);
  const set = await A.page.evaluate(() => window.__set);
  check("★★ 앱에 카운터 프린터 IP·포트가 저장된다", JSON.stringify(set) === JSON.stringify([[COUNTER.ip, COUNTER.port]]), JSON.stringify(set));
  check("바꿨다고 말해준다", /카운터 프린터/.test(await A.page.locator("#printerPickMsg").textContent()), await A.page.locator("#printerPickMsg").textContent());

  await A.page.locator("#printerPickTest").click();
  await A.page.waitForTimeout(300);
  check("★ 테스트 한 장이 앱으로 간다", (await A.page.evaluate(() => window.__jobs.length)) === 1, "");

  await A.page.reload({ waitUntil: "networkidle" });
  await A.page.waitForTimeout(1500);
  check("새로고침해도 카운터 프린터로 보인다", (await A.page.locator("#printerPick option:checked").textContent()) === COUNTER.name, "");
  await A.ctx.close();

  out.push("\n[목록에 없는 곳으로 찍고 있으면 그렇게 보여준다]");
  const B = await pad({ target: "10.0.0.9:9100" });
  const btext = await B.page.locator("#printerPick option:checked").textContent();
  check("★ 첫 칸을 몰래 고르지 않는다", /10\.0\.0\.9/.test(btext), btext);
  await B.ctx.close();

  out.push("\n[옛 앱(1.4) — 고를 수 없다고 말한다]");
  const C = await pad({ target: "192.168.111.142:9100", withSetPrinter: false });
  check("고르기 칸이 잠긴다", await C.page.locator("#printerPick").isDisabled(), "");
  check("★ 앱을 업데이트하라고 말한다 — 조용히 안 바뀌지 않는다",
    /1\.5/.test(await C.page.locator("#printerPickMsg").textContent()), await C.page.locator("#printerPickMsg").textContent());
  await C.ctx.close();

  out.push("\n[크롬(앱 밖)에서는 안 보인다 — 프린터에 직접 닿지 못한다]");
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
    await page.evaluate(async () => {
      await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "ownerpass123" }) });
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    check("숨는다", !(await page.locator("#printerPickWrap").isVisible()), "");
    await ctx.close();
  }

  out.push("\n[앱]");
  const java = fs.readFileSync(path.join(__dirname, "../../../kiosk-app/src/tw/hangukgwan/kiosk/MainActivity.java"), "utf8");
  check("★ 앱이 setPrinter 를 연다", /@JavascriptInterface\s+public String setPrinter\(String ip, int port\)/.test(java), "");
  check("앱이 주소를 걸러 받는다", /\[0-9A-Za-z\.\\\\-\]/.test(java), "");

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
