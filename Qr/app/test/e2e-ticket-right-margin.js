// 주문서(빌지) 오른쪽 여백 — 겹쳐 걸어도 수량(x2)이 보이게.
//
// 2026-10-06 사장님: "주방으로 들어가는 빌지의 숫자탭이 오른쪽 끝에 있는데 그걸 조금 들여 쓸 수 있을까?
// 빌지가 조금이라도 겹치면 안보인대"
//
// 앱·RawBT 빌지는 그림(래스터)이다. 그 바이트를 풀어 **가장 오른쪽 잉크가 종이 오른끝에서 몇 점
// 떨어져 있는지**를 직접 센다. 203dpi 라 1mm = 8점. 예전엔 24점(3mm)이었다.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};
process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-ticket-right-margin";
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
  let r = await boss.put("/api/settings/ticket-print").send({ rightMargin: 6.3 });
  check("0.5mm 단위로 저장", r.status === 200 && r.body.rightMargin === 6.5, JSON.stringify(r.body));
  r = await boss.put("/api/settings/ticket-print").send({ rightMargin: 99 });
  check("최대 30mm", r.body.rightMargin === 30, JSON.stringify(r.body));
  r = await boss.put("/api/settings/ticket-print").send({ rightMargin: -5 });
  check("최소 0mm", r.body.rightMargin === 0, JSON.stringify(r.body));
  r = await boss.put("/api/settings/ticket-print").send({ storeName: 20 });
  check("다른 칸만 저장해도 오른쪽 여백은 그대로", r.body.rightMargin === 0 && r.body.storeName === 20, JSON.stringify(r.body));
  delete store.settings.ticket_font_sizes.rightMargin;

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

  // 빌지 바이트 → 줄마다 가장 오른쪽 잉크(점). kind: ticket | move
  async function measure(rm, kind = "ticket") {
    return page.evaluate(([rm, kind]) => {
      const fs = rm === undefined ? {} : { rightMargin: rm };
      const o = { table_number: "7", order_type: "dine_in", created_at: "2026-10-06 12:00:00", items: [{ name_zh: "石鍋拌飯", qty: 2, unit_price: 230 }, { name_zh: "辣炒年糕", qty: 13, unit_price: 190 }], total: 2930 };
      const b = kind === "move"
        ? window.buildEscPosMoveSlip({ from: "3", to: "7", at: "12:00", partySize: 4, orders: [{ id: 12, time: "11:50", summary: "石鍋拌飯 x2" }] }, "韓國館", fs)
        : window.buildEscPosRasterTicket(o, "韓國館", fs, { tableLabel: "桌號 7" });
      let i = 2;
      let rightmost = -1;
      let W = 0;
      while (i + 8 <= b.length && b[i] === 0x1d && b[i + 1] === 0x76 && b[i + 2] === 0x30) {
        const wb = b[i + 4] | (b[i + 5] << 8);
        const rows = b[i + 6] | (b[i + 7] << 8);
        W = wb * 8;
        i += 8;
        for (let y = 0; y < rows; y++)
          for (let x = wb - 1; x >= 0; x--) {
            const v = b[i + y * wb + x];
            if (!v) continue;
            let bit = 0;
            while (!(v & (1 << bit))) bit++;
            rightmost = Math.max(rightmost, x * 8 + (7 - bit));
            break;
          }
        i += rows * wb;
      }
      return { gap: W - 1 - rightmost, W };
    }, [rm, kind]);
  }

  out.push("\n[앱 빌지(그림) — 오른끝에서 가장 오른쪽 글자까지]");
  const mDef = await measure(undefined);
  const m8 = await measure(8);
  const m0 = await measure(0);
  const m15 = await measure(15);
  check(`★★ 설정 안 해도 8mm 들어간다 — 오른끝에서 ${mDef.gap}점(${(mDef.gap / 8).toFixed(1)}mm), 예전 24점(3mm)`, mDef.gap >= 24 + 64 && mDef.gap === m8.gap, JSON.stringify({ mDef, m8 }));
  check("0mm 면 예전 그대로(3mm)", m0.gap >= 24 && m0.gap < 24 + 8, JSON.stringify(m0));
  check("★ 15mm → 0mm 보다 120점 더 안쪽", m15.gap - m0.gap === 120, JSON.stringify({ m0, m15 }));
  const mv0 = await measure(0, "move");
  const mv8 = await measure(8, "move");
  check("★ 자리 이동 빌지도 같은 여백(같은 줄에 걸린다)", mv8.gap - mv0.gap === 64, JSON.stringify({ mv0, mv8 }));
  const txt = await page.evaluate(() => {
    const o = { table_number: "7", order_type: "dine_in", created_at: "2026-10-06 12:00:00", items: [{ name_zh: "石鍋拌飯", qty: 2, unit_price: 230 }], total: 460 };
    const at = (s) => (s.split("\n").find((l) => l.includes("x2")) || "").indexOf("x2");
    return [at(window.buildEscPosTicket(o, "韓國館", { rightMargin: 0 })), at(window.buildEscPosTicket(o, "韓國館", {}))];
  });
  check("글자 빌지(QZ)도 수량이 안쪽으로(8mm ≈ 5칸)", txt[0] - txt[1] === 5, JSON.stringify(txt));

  out.push("\n[설정 화면]");
  await page.locator('.admin-tabs button[data-tab="settings"]').click();
  await page.locator('.settings-nav-btn[data-category="print"]').click();
  await page.waitForTimeout(500);
  const input = page.locator("#tfsRightMargin");
  check("★ 「오른쪽 여백」 칸이 보인다", await input.isVisible(), "");
  check("기본값 8", (await input.inputValue()) === "8", await input.inputValue());
  await input.fill("12");
  await input.dispatchEvent("input");
  await page.waitForTimeout(400);
  const pad = await page.evaluate(() => {
    const d = document.querySelector("#ticketFontPreviewFrame").contentDocument;
    const el = d && d.querySelector(".receipt");
    return el ? getComputedStyle(el).paddingRight : "";
  });
  check("★ 미리보기에 바로 보인다(4 + 12mm)", Math.abs(parseFloat(pad) - 16 * 96 / 25.4) < 1, pad);
  await page.locator("#saveTicketFontSizesBtn").click();
  await page.waitForTimeout(600);
  check("★ 저장된다", store.settings.ticket_font_sizes.rightMargin === 12, JSON.stringify(store.settings.ticket_font_sizes));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  check("다시 열어도 12mm", (await page.locator("#tfsRightMargin").inputValue()) === "12", await page.locator("#tfsRightMargin").inputValue());

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
