// 빌지·영수증·화면 — **수량이 메뉴 앞에** 온다.
//
// 2026-10-21 사장님: "지금 영수증이랑 빌지들 그리고 화면까지 메뉴 개수 이렇게 나오는데
// 그걸 개수 메뉴 이렇게 바꿔줄래?"
//
// 이 자리는 원래 반대였다 — 2026-10-06 사장님이 「빌지를 겹쳐 걸면 오른쪽 끝 수량이 안
// 보인다」고 하셔서 수량 열만 오른쪽에서 안으로 들였다(설정 「수량 열 오른쪽 여백」).
// 수량이 **앞으로** 오면 그 문제는 저절로 없어진다 — 왼쪽은 안 가린다. 그래서 그 설정은
// 품목 줄을 더 이상 밀지 않는다. 그것도 같이 잰다.
//
// 앱·RawBT 빌지는 그림(래스터)이다. 그리는 글자(fillText)를 그대로 받아 잰다.
// 종이 폭 576점, 여백 24점(오른끝 552).
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};
process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-ticket-qty-first";
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

  out.push("[설정은 그대로 저장된다 — 품목 줄을 밀지 않을 뿐]");
  const boss = request.agent(app);
  await boss.post("/api/auth/login").send({ password: "ownerpass123" });
  let r = await boss.put("/api/settings/ticket-print").send({ rightMargin: 6.3 });
  check("0.5mm 단위로 저장", r.status === 200 && r.body.rightMargin === 6.5, JSON.stringify(r.body));
  r = await boss.put("/api/settings/ticket-print").send({ rightMargin: 99 });
  check("최대 30mm", r.body.rightMargin === 30, JSON.stringify(r.body));
  r = await boss.put("/api/settings/ticket-print").send({ rightMargin: -5 });
  check("최소 0mm", r.body.rightMargin === 0, JSON.stringify(r.body));
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

  async function drawn(fs, kind, items) {
    return page.evaluate(([fs, kind, items]) => {
      const seen = [];
      const P = CanvasRenderingContext2D.prototype;
      const ft = P.fillText;
      const fr = P.fillRect;
      const lt = P.lineTo;
      P.fillText = function (t, x, y) {
        if (this.canvas.width === 576) seen.push({ t: String(t), x: Math.round(x), y: Math.round(y), align: this.textAlign });
        return ft.apply(this, arguments);
      };
      P.fillRect = function (x, y, w, h) { if (this.canvas.width === 576 && h === 2) seen.push({ t: "—", x: Math.round(x + w), align: "right" }); return fr.apply(this, arguments); };
      P.lineTo = function (x, y) { if (this.canvas.width === 576) seen.push({ t: "—", x: Math.round(x), align: "right" }); return lt.apply(this, arguments); };
      const o = {
        table_number: "7", order_type: "mixed", created_at: "2026-10-06 12:00:00",
        items: items || [{ name_zh: "石鍋拌飯", qty: 2, unit_price: 230 }, { name_zh: "辣炒年糕", qty: 13, unit_price: 190, order_type: "takeout" }],
        total: 2930,
      };
      try {
        if (kind === "move") window.buildEscPosMoveSlip({ from: "3", to: "7", at: "12:00", partySize: 4, orders: [{ id: 12, time: "11:50", summary: "x2 石鍋拌飯" }] }, "韓國館", fs);
        else window.buildEscPosRasterTicket(o, "韓國館", fs, { tableLabel: "桌號 7" }, kind === "price" ? { priceCopy: true } : undefined);
      } finally {
        P.fillText = ft; P.fillRect = fr; P.lineTo = lt;
      }
      return seen;
    }, [fs, kind || "ticket", items || null]);
  }

  out.push("\n[앱 빌지(그림) — 개수가 먼저]");
  const d = await drawn({});
  const qty = d.filter((e) => /^x\d+$/.test(e.t));
  check("★★ 수량(x2·x13)이 둘 다 찍힌다", qty.length === 2, JSON.stringify(qty));
  check("★★ 수량은 종이 왼쪽 끝(24점)에서 시작한다 — 겹쳐 걸어도 왼쪽은 안 가린다",
    qty.length === 2 && qty.every((e) => e.x === 24 && e.align === "left"), JSON.stringify(qty));
  const name1 = d.find((e) => e.t === "石鍋拌飯");
  const qty1 = qty.find((e) => e.t === "x2");
  check("★★ 메뉴 이름은 같은 줄, 수량 뒤에", !!(name1 && qty1 && name1.y === qty1.y && name1.x > qty1.x), JSON.stringify({ qty1, name1 }));
  check("★★ 오른쪽 끝에는 수량이 없다 — 더 이상 그 열이 아니다",
    !d.some((e) => e.align === "right" && /^x\d+$/.test(e.t)), JSON.stringify(d.filter((e) => e.align === "right").map((e) => e.t)));
  const edge = d.filter((e) => e.align === "right" && e.t !== "");
  check("混合·合計·구분선은 그대로 종이 끝 552점", edge.length >= 3 && edge.every((e) => e.x === 552), JSON.stringify(edge.map((e) => [e.t, e.x])));

  const d30 = await drawn({ rightMargin: 30 });
  const qty30 = d30.filter((e) => /^x\d+$/.test(e.t));
  check("★★ 「수량 열 오른쪽 여백」을 30mm 로 해도 수량 자리는 그대로(24점)",
    qty30.length === 2 && qty30.every((e) => e.x === 24), JSON.stringify(qty30));

  const dp = await drawn({}, "price");
  const qtyP = dp.filter((e) => /^x\d+$/.test(e.t));
  check("결제용(금액) 사본도 개수가 먼저", qtyP.length === 2 && qtyP.every((e) => e.x === 24 && e.align === "left"), JSON.stringify(qtyP));
  const mv = await drawn({ rightMargin: 30 }, "move");
  check("자리 이동 빌지는 손대지 않는다(수량 열이 없다)", mv.filter((e) => e.align === "right").every((e) => e.x === 552), JSON.stringify(mv.map((e) => [e.t, e.x])));

  out.push("\n[긴 메뉴 이름 — 자르지 않고 다음 줄로]");
  const long = await drawn({ itemName: 24, itemDetail: 20 }, "ticket", [
    { name_zh: "Pororo ZERO兒童飲料(草莓)", qty: 2, unit_price: 50 },
    { name_zh: "泡菜(辛奇)-僅限外帶", qty: 1, unit_price: 50, order_type: "takeout", option_choice: "Pororo ZERO兒童飲料 草莓 牛奶 葡萄 蘋果 柳橙 水蜜桃" },
  ]);
  const all = long.map((e) => e.t).join("|");
  check("★★ 「…」로 자르지 않는다", !/…/.test(all), all);
  check("★★ 「(草莓)」까지 다 찍힌다(다음 줄로)", long.some((e) => /草莓\)?$/.test(e.t)) && long.some((e) => /^Pororo/.test(e.t)), all);
  const head = long.find((e) => /^Pororo/.test(e.t));
  const lead = long.find((e) => e.t === "x2");
  check("★★ 수량 x2 는 이름 앞, 같은 줄에", !!(head && lead && head.y === lead.y && head.x > lead.x), JSON.stringify({ lead, head }));
  const cont = long.filter((e) => head && e.y > head.y && /草莓/.test(e.t) && !/^Pororo ZERO/.test(e.t));
  check("★★ 넘쳐서 다음 줄로 간 이름은 이름 시작에 맞춰 들여진다",
    cont.length >= 1 && cont.some((e) => e.x === head.x), JSON.stringify({ headX: head && head.x, cont: cont.map((e) => [e.t, e.x]) }));

  out.push("\n[글자 빌지(QZ)]");
  const txt = await page.evaluate(() => {
    // ESC/POS 명령 바이트를 다 떼어낸다 — 굵게(ESC E 1)는 뒤에 1바이트가 더 붙는다
    const strip = (l) => l.replace(/\x1bE./g, "").replace(/\x1b./g, "").replace(/[\x00-\x1f]/g, "");
    const o = { table_number: "7", order_type: "dine_in", created_at: "2026-10-06 12:00:00", items: [{ name_zh: "Pororo ZERO兒童飲料(草莓)Pororo ZERO兒童飲料(草莓)", qty: 2, unit_price: 50 }], total: 100 };
    const s = window.buildEscPosTicket(o, "韓國館", {});
    const short = window.buildEscPosTicket({ ...o, items: [{ name_zh: "石鍋拌飯", qty: 2, unit_price: 230 }] }, "韓國館", { rightMargin: 30 });
    return { lines: s.split("\n").map(strip), short: short.split("\n").map(strip) };
  });
  const itemLine = txt.lines.find((l) => l.includes("x2"));
  check("★★ 품목 줄이 「x2 」로 시작한다", !!itemLine && /^x2 \S/.test(itemLine), JSON.stringify(itemLine));
  const next = txt.lines[txt.lines.indexOf(itemLine) + 1] || "";
  check("★★ 다음 줄로 넘어간 이름은 그 폭만큼 들여진다", /^ {3}\S/.test(next), JSON.stringify(next));
  check("★ 이름이 다 찍힌다", (txt.lines.join("").match(/草莓/g) || []).length === 2, "");
  const shortItem = txt.short.find((l) => l.includes("x2"));
  check("★★ 「오른쪽 여백」 30mm 여도 글자 빌지의 품목 줄은 그대로", /^x2 石鍋拌飯\s*$/.test(shortItem || ""), JSON.stringify(shortItem));

  out.push("\n[왼쪽 여백 — 사장님: 「왼쪽 여백 조절도 가능하게 해줘」]");
  {
    const d0 = await drawn({ leftMargin: 0 });
    const d10 = await drawn({ leftMargin: 10 });
    const first = (arr) => arr.find((e) => /^x\d+$/.test(e.t));
    check("★★ 0mm 면 글자가 종이 왼쪽 끝(0점)에서 시작한다", !!first(d0) && first(d0).x === 0, JSON.stringify(first(d0)));
    check("★★ 10mm 면 80점 안으로", !!first(d10) && first(d10).x === 80, JSON.stringify(first(d10)));
    const name10 = d10.find((e) => e.t === "石鍋拌飯");
    check("★ 이름도 같이 밀린다", !!name10 && name10.x > 80, JSON.stringify(name10));
    const edge10 = d10.filter((e) => e.align === "right" && e.t !== "");
    check("★★ 오른쪽 끝은 그대로 552점 — 왼쪽만 민다", edge10.length >= 3 && edge10.every((e) => e.x === 552), JSON.stringify(edge10.map((e) => [e.t, e.x])));
    const big = await drawn({ leftMargin: 30 });
    check("★ 30mm 까지 — 칸이 줄어도 이름은 안 사라진다", big.some((e) => /石鍋拌飯/.test(e.t)), JSON.stringify(big.map((e) => e.t)));
    const mk = (fsx) => ({ table_number: "7", order_type: "dine_in", created_at: "2026-10-06 12:00:00", items: [{ name_zh: "石鍋拌飯", qty: 2, unit_price: 230 }], total: 460, fsx });
    const txtL = await page.evaluate(() => {
      const o = { table_number: "7", order_type: "dine_in", created_at: "2026-10-06 12:00:00", items: [{ name_zh: "石鍋拌飯", qty: 2, unit_price: 230 }], total: 460 };
      return { on: window.buildEscPosTicket(o, "韓國館", { leftMargin: 10 }), off: window.buildEscPosTicket(o, "韓國館", {}) };
    });
    const GSL = String.fromCharCode(0x1d) + "L" + String.fromCharCode(80) + String.fromCharCode(0);
    check("★★ 글자 빌지(QZ)는 ESC/POS 「왼쪽 여백」 명령(GS L 80점)으로 보낸다", txtL.on.includes(GSL), JSON.stringify(txtL.on.slice(0, 10)));
    check("★ 안 정했으면 그 명령을 안 보낸다 — 예전 빌지 그대로", !txtL.off.includes(String.fromCharCode(0x1d) + "L"), JSON.stringify(txtL.off.slice(0, 10)));
  }

  out.push("\n[미리보기 — 화면에서도 개수가 먼저]");
  await page.locator('.admin-tabs button[data-tab="settings"]').click();
  await page.locator('.settings-nav-btn[data-category="print"]').click();
  await page.waitForTimeout(800);
  const order = await page.evaluate(() => {
    const doc = document.querySelector("#ticketFontPreviewFrame").contentDocument;
    const row = doc && doc.querySelector(".item-main");
    if (!row) return null;
    return [...row.children].map((c) => c.className);
  });
  check("★★ 미리보기도 수량 → 이름 차례", Array.isArray(order) && order[0] === "item-qty" && order[1] === "item-name", JSON.stringify(order));

  // 왼쪽 여백 칸 — 보이고, 미리보기에 바로 비치고, 저장되고, 다시 열어도 남는다
  const li = page.locator("#tfsLeftMargin");
  check("★ 「왼쪽 여백」 칸이 보인다", await li.isVisible(), "");
  check("기본값 3mm — 예전 빌지 그대로", (await li.inputValue()) === "3", await li.inputValue());
  await li.fill("12");
  await li.dispatchEvent("input");
  await page.waitForTimeout(500);
  const padLeft = await page.evaluate(() => {
    const d = document.querySelector("#ticketFontPreviewFrame").contentDocument;
    const r = d && d.querySelector(".receipt");
    return r ? [getComputedStyle(r).paddingLeft, getComputedStyle(r).paddingRight] : [];
  });
  check("★★ 미리보기에 바로 보인다 — 왼쪽만 12mm, 오른쪽은 그대로 4mm",
    Math.abs(parseFloat(padLeft[0]) - 12 * 96 / 25.4) < 1 && Math.abs(parseFloat(padLeft[1]) - 4 * 96 / 25.4) < 1, JSON.stringify(padLeft));
  await page.locator("#saveTicketFontSizesBtn").click();
  await page.waitForTimeout(700);
  check("★ 저장된다", store.settings.ticket_font_sizes.leftMargin === 12, JSON.stringify(store.settings.ticket_font_sizes.leftMargin));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1400);
  await page.locator('.admin-tabs button[data-tab="settings"]').click();
  await page.locator('.settings-nav-btn[data-category="print"]').click();
  await page.waitForTimeout(700);
  check("다시 열어도 12mm", (await page.locator("#tfsLeftMargin").inputValue()) === "12", await page.locator("#tfsLeftMargin").inputValue());

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
