// 주문서(빌지) 오른쪽 여백 — 겹쳐 걸어도 수량(x2)이 보이게.
//
// 2026-10-06 사장님: "주방으로 들어가는 빌지의 숫자탭이 오른쪽 끝에 있는데 그걸 조금 들여 쓸 수 있을까?
// 빌지가 조금이라도 겹치면 안보인대"
//
// 같은 날: "빌지 자체의 오른쪽 경계를 들여써달라는 게 아니라 나머지는 냅두고 숫자 열만" — 수량 열만 들인다.
// 앱·RawBT 빌지는 그림(래스터)이다. 그리는 글자의 오른끝 x 를 받아 잰다. 203dpi 라 1mm = 8점.
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

  // 같은 날 사장님: "빌지 자체의 오른쪽 경계를 들여써달라는 게 아니라 나머지는 냅두고 숫자 열만" —
  // 그리는 글자(fillText)를 받아 **오른쪽 정렬 글자마다 오른끝 x** 를 본다. 종이 폭 576점, 원래 여백 24점.
  async function drawnAt(rm, kind = "ticket") {
    return page.evaluate(([rm, kind]) => {
      const seen = [];
      const P = CanvasRenderingContext2D.prototype;
      const ft = P.fillText;
      const fr = P.fillRect;
      const lt = P.lineTo;
      P.fillText = function (t, x, y) { if (this.canvas.width === 576 && this.textAlign === "right") seen.push({ t: String(t), x: Math.round(x) }); return ft.apply(this, arguments); };
      P.fillRect = function (x, y, w, h) { if (this.canvas.width === 576 && h === 2) seen.push({ t: "—", x: Math.round(x + w) }); return fr.apply(this, arguments); };
      P.lineTo = function (x, y) { if (this.canvas.width === 576) seen.push({ t: "—", x: Math.round(x) }); return lt.apply(this, arguments); };
      const fs = rm === undefined ? {} : { rightMargin: rm };
      const o = { table_number: "7", order_type: "mixed", created_at: "2026-10-06 12:00:00", items: [{ name_zh: "石鍋拌飯", qty: 2, unit_price: 230 }, { name_zh: "辣炒年糕", qty: 13, unit_price: 190, order_type: "takeout" }], total: 2930 };
      try {
        if (kind === "move") window.buildEscPosMoveSlip({ from: "3", to: "7", at: "12:00", partySize: 4, orders: [{ id: 12, time: "11:50", summary: "石鍋拌飯 x2" }] }, "韓國館", fs);
        else window.buildEscPosRasterTicket(o, "韓國館", fs, { tableLabel: "桌號 7" }, kind === "price" ? { priceCopy: true } : undefined);
      } finally {
        P.fillText = ft; P.fillRect = fr; P.lineTo = lt;
      }
      return seen;
    }, [rm, kind]);
  }

  out.push("\n[앱 빌지(그림) — 수량 열만 안으로]");
  const d8 = await drawnAt(undefined);
  const d0 = await drawnAt(0);
  const d15 = await drawnAt(15);
  const qtyX = (d) => d.filter((e) => /^x\d+$/.test(e.t)).map((e) => e.x);
  const otherX = (d) => d.filter((e) => !/^x\d+$/.test(e.t)).map((e) => e.x);
  check(`★★ 설정 안 해도 수량(x2·x13)은 8mm 안쪽 — 오른끝 ${qtyX(d8).join("·")}점 (종이 끝 552점보다 64점 안)`, qtyX(d8).length === 2 && qtyX(d8).every((x) => x === 552 - 64), JSON.stringify(qtyX(d8)));
  check(`★★ 나머지(混合·合計·구분선)는 그대로 종이 끝 552점 (${[...new Set(otherX(d8))].join("·")})`, otherX(d8).length >= 3 && otherX(d8).every((x) => x === 552), JSON.stringify(d8));
  check("0mm 면 수량도 예전 그대로(552)", qtyX(d0).every((x) => x === 552), JSON.stringify(qtyX(d0)));
  check("★ 15mm → 수량만 120점 안쪽", qtyX(d15).every((x) => x === 552 - 120) && otherX(d15).every((x) => x === 552), JSON.stringify(d15));
  const dp = await drawnAt(8, "price");
  check("결제용(금액) 사본도 수량 열만", qtyX(dp).every((x) => x === 552 - 64) && otherX(dp).every((x) => x === 552), JSON.stringify(dp));
  const mv = await drawnAt(30, "move");
  check("자리 이동 빌지는 손대지 않는다(수량 열이 없다)", mv.every((e) => e.x === 552), JSON.stringify(mv));
  const txt = await page.evaluate(() => {
    const o = { table_number: "7", order_type: "dine_in", created_at: "2026-10-06 12:00:00", items: [{ name_zh: "石鍋拌飯", qty: 2, unit_price: 230 }], total: 460 };
    const lines = (s) => s.split("\n");
    const at = (s) => (lines(s).find((l) => l.includes("x2")) || "").indexOf("x2");
    const div = (s) => (lines(s).find((l) => /^-{10,}$/.test(l.replace(/^\x1b.{2}/, ""))) || "").replace(/^\x1b.{2}/, "").length;
    const a = window.buildEscPosTicket(o, "韓國館", { rightMargin: 0 });
    const b = window.buildEscPosTicket(o, "韓國館", {});
    return [at(a), at(b), div(a), div(b)];
  });
  check("글자 빌지(QZ)도 수량만 안쪽으로(8mm ≈ 5칸), 구분선은 그대로", txt[0] - txt[1] === 5 && txt[2] === txt[3] && txt[2] > 0, JSON.stringify(txt));

  // 2026-10-06 사장님: "잘리지 말고 다음 줄로 넘겨줘" — 가장 긴 메뉴 「Pororo ZERO兒童飲料(草莓)」가
  // 여백 8mm 에서 「…」로 잘려 딸기·우유를 못 가렸다. 그리는 글자를 그대로 받아 본다.
  out.push("\n[긴 메뉴 이름 — 자르지 않고 다음 줄로]");
  const drawn = await page.evaluate(() => {
    const seen = [];
    const orig = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (t, x, y) {
      if (this.canvas.height > 0 && this.canvas.width === 576) seen.push({ t: String(t), x: Math.round(x), y: Math.round(y) });
      return orig.apply(this, arguments);
    };
    const run = (fs, items) => {
      seen.length = 0;
      window.buildEscPosRasterTicket({ table_number: "7", order_type: "dine_in", created_at: "2026-10-06 12:00:00", items, total: 100 }, "韓國館", fs, { tableLabel: "桌號 7" });
      return seen.slice();
    };
    const long = [
      { name_zh: "Pororo ZERO兒童飲料(草莓)", qty: 2, unit_price: 50 },
      { name_zh: "泡菜(辛奇)-僅限外帶", qty: 1, unit_price: 50, order_type: "takeout", option_choice: "Pororo ZERO兒童飲料 草莓 牛奶 葡萄 蘋果 柳橙 水蜜桃" },
    ];
    const r = { big: run({ rightMargin: 8, itemName: 24, itemDetail: 20 }, long), small: run({ rightMargin: 0 }, [{ name_zh: "石鍋拌飯", qty: 1, unit_price: 230 }]) };
    CanvasRenderingContext2D.prototype.fillText = orig;
    return r;
  });
  const all = drawn.big.map((d) => d.t).join("|");
  check("★★ 「…」로 자르지 않는다", !/…/.test(all), all);
  check("★★ 「(草莓)」까지 다 찍힌다(다음 줄로)", drawn.big.some((d) => /草莓\)?$/.test(d.t)) && drawn.big.some((d) => /^Pororo/.test(d.t)), all);
  const qty = drawn.big.find((d) => d.t === "x2");
  const head = drawn.big.find((d) => /^Pororo/.test(d.t));
  check("★ 수량 x2 는 이름 첫 줄 오른쪽에", qty && head && qty.y === head.y, JSON.stringify({ qty, head }));
  const opt = drawn.big.filter((d) => /草莓|葡萄|蘋果|柳橙|水蜜桃/.test(d.t) && !/^Pororo ZERO兒童飲料\(/.test(d.t));
  check("옵션 줄도 넘치면 다음 줄로, 「└」 뒤에 맞춰 들여서", opt.length >= 2 && opt[1].x > 24, JSON.stringify(opt));
  check("짧은 이름은 예전 그대로 한 줄", drawn.small.filter((d) => /石鍋拌飯/.test(d.t)).length === 1, "");
  const txt2 = await page.evaluate(() => window.buildEscPosTicket({ table_number: "7", order_type: "dine_in", created_at: "2026-10-06 12:00:00", items: [{ name_zh: "Pororo ZERO兒童飲料(草莓)Pororo ZERO兒童飲料(草莓)", qty: 2, unit_price: 50 }], total: 100 }, "韓國館", {}));
  check("글자 빌지(QZ)도 이름이 다 찍힌다", txt2.includes("x2") && (txt2.match(/草莓/g) || []).length === 2 && (txt2.match(/Pororo/g) || []).length === 2, "");

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
    const q = d && d.querySelector(".item-qty");
    const r = d && d.querySelector(".receipt");
    return q && r ? [getComputedStyle(q).marginRight, getComputedStyle(r).paddingRight] : [];
  });
  check("★ 미리보기에 바로 보인다 — 수량만 12mm, 종이 오른쪽은 그대로 4mm", Math.abs(parseFloat(pad[0]) - 12 * 96 / 25.4) < 1 && Math.abs(parseFloat(pad[1]) - 4 * 96 / 25.4) < 1, JSON.stringify(pad));
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
