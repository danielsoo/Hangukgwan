// 주문서(빌지) 위 여백을 설정에서 mm 로 정한다.
//
// 2026-09-30 사장님: "주문서 상단 여백을 조정할 수 있는 기능도 함께 추가해줘."
//
// 앱·RawBT 로 나가는 빌지는 그림(래스터)이다 — escpos.js 가 캔버스에 그려
// GS v 0 로 보낸다. 여기서는 그 바이트를 풀어 **첫 글자 위에 빈 줄이 몇 점
// 있는지**를 직접 센다. 203dpi 라 1mm = 8점.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};
process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-ticket-top-margin";
process.env.ADMIN_PASSWORD = "ownerpass123";

const request = require("supertest");
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

(async () => {
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  await request(app).get("/api/menu");

  out.push("[서버 — 저장 범위]");
  const boss = request.agent(app);
  await boss.post("/api/auth/login").send({ password: "ownerpass123" });
  let r = await boss.put("/api/settings/ticket-print").send({ topMargin: 12.3 });
  check("0.5mm 단위로 저장", r.status === 200 && r.body.topMargin === 12.5, JSON.stringify(r.body));
  r = await boss.put("/api/settings/ticket-print").send({ topMargin: 99 });
  check("최대 30mm", r.body.topMargin === 30, JSON.stringify(r.body));
  r = await boss.put("/api/settings/ticket-print").send({ topMargin: -5 });
  check("최소 0mm", r.body.topMargin === 0, JSON.stringify(r.body));
  r = await boss.put("/api/settings/ticket-print").send({ storeName: 20 });
  check("다른 칸만 저장해도 위 여백은 그대로", r.body.topMargin === 0 && r.body.storeName === 20, JSON.stringify(r.body));
  check("store 를 통째로 안 쓴다", /saveFields\(\{ "settings\.ticket_font_sizes"/.test(require("fs").readFileSync(require("path").join(__dirname, "../src/routes/settings.js"), "utf8")), "");
  delete store.settings.ticket_font_sizes.topMargin;

  const browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.dismiss());
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "ownerpass123" }) });
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  // 빌지 바이트 → 첫 글자까지 빈 줄 수, 전체 높이.
  async function measure(topMargin) {
    return page.evaluate((tm) => {
      const fs = tm === undefined ? {} : { topMargin: tm };
      const o = { table_number: "7", order_type: "dine_in", created_at: "2026-09-30 12:00:00", items: [{ name_zh: "石鍋拌飯", qty: 1, unit_price: 230 }], total: 230 };
      const b = window.buildEscPosRasterTicket(o, "韓國館", fs, { tableLabel: "桌號 7" });
      let i = 2; // ESC @
      let row = 0, firstInk = -1, height = 0;
      while (i + 8 <= b.length && b[i] === 0x1d && b[i + 1] === 0x76 && b[i + 2] === 0x30) {
        const wb = b[i + 4] | (b[i + 5] << 8);
        const rows = b[i + 6] | (b[i + 7] << 8);
        i += 8;
        for (let y = 0; y < rows; y++, row++) {
          let ink = false;
          for (let x = 0; x < wb; x++) if (b[i + y * wb + x]) { ink = true; break; }
          if (ink && firstInk < 0) firstInk = row;
        }
        i += rows * wb;
        height += rows;
      }
      return { firstInk, height };
    }, topMargin);
  }

  out.push("\n[앱 빌지(그림) — 첫 글자 위 빈 줄]");
  const m0 = await measure(0);
  const mDef = await measure(undefined);
  const m10 = await measure(10);
  const m30 = await measure(30);
  const m35 = await measure(3.5);
  check("★ 설정 안 하면 3.5mm 와 똑같다(예전 고정값 28점)", mDef.height === m35.height && mDef.firstInk === m35.firstInk, JSON.stringify({ mDef, m35 }));
  // 기본 3.5mm(28점) 기준으로 잰다 — 1mm = 8점.
  check("★★ 10mm → 첫 글자가 기본보다 52점(6.5mm) 더 내려간다", m10.firstInk - mDef.firstInk === 52 && m10.height - mDef.height === 52, JSON.stringify({ mDef, m10 }));
  check("30mm → 기본보다 212점", m30.firstInk - mDef.firstInk === 212, JSON.stringify({ mDef, m30 }));
  check("★ 0mm 로 줄이면 위가 붙는다", m0.firstInk < mDef.firstInk && m0.height < mDef.height, JSON.stringify({ m0, mDef }));
  check("★ 0mm 에서도 첫 줄 글자 윗부분이 잘리지 않는다", m0.firstInk >= 2, JSON.stringify(m0));

  out.push("\n[설정 화면]");
  await page.locator('.admin-tabs button[data-tab="settings"]').click();
  await page.locator('.settings-nav-btn[data-category="print"]').click();
  await page.waitForTimeout(500);
  const input = page.locator("#tfsTopMargin");
  check("★ 「위 여백」 칸이 보인다", await input.isVisible(), "");
  check("기본값 3.5", (await input.inputValue()) === "3.5", await input.inputValue());
  await input.fill("8");
  await input.dispatchEvent("input");
  await page.waitForTimeout(400);
  const pad = await page.evaluate(() => {
    const d = document.querySelector("#ticketFontPreviewFrame").contentDocument;
    const el = d && d.querySelector(".receipt");
    return el ? getComputedStyle(el).paddingTop : "";
  });
  check("★ 미리보기에 바로 보인다(8mm)", Math.abs(parseFloat(pad) - 8 * 96 / 25.4) < 1, pad);
  await page.locator("#saveTicketFontSizesBtn").click();
  await page.waitForTimeout(600);
  check("★ 저장된다", store.settings.ticket_font_sizes.topMargin === 8, JSON.stringify(store.settings.ticket_font_sizes));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  check("다시 열어도 8mm", (await page.locator("#tfsTopMargin").inputValue()) === "8", await page.locator("#tfsTopMargin").inputValue());
  const lay = await page.evaluate(() => {
    const row = document.querySelector(".ticket-top-margin-field").getBoundingClientRect();
    return row.height < 60 && document.documentElement.scrollWidth <= innerWidth;
  });
  check("줄이 안 깨진다", lay, "");

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
