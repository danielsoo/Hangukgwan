// 결산의 「지난 주문 불러오기」에서 예전 빌지를 다시 뽑는다.
//
// 사장님(2026-09-11): "결산탭에서도 인쇄랑 미리보기 그대로 가능하게 해줘.
// 언제든 예전 것 출력하고 싶거나 영수증 미리보기 하고 싶을 떄 할 수 있게
// 해줘." / "가격이 너무 오른쪽으로 밀려서 벽에 붙어서 불편해보여 왼쪽으로
// 위치 이동해줘."
//
// ── 이 파일이 지키는 것 ─────────────────────────────────────────────
//
//   1. 인쇄·미리보기 버튼이 줄마다 있고, **실시간 주문판과 같은 빌지**를
//      부른다. 여기만 따로 만들면 주방에 두 가지 종이가 나간다.
//   2. 그 버튼을 눌러도 줄이 같이 펼쳐지지 않는다 (버튼 안의 버튼 문제).
//   3. 금액이 오른쪽 벽에 붙어 있지 않다.
//   4. 여러 번 나눠 시킨 묶음은 머리의 「한 번에 인쇄」가 묶음 전체를 한 장으로
//      뽑는다(2026-10-03 사장님: "여러번 주문했어도 한 번에 인쇄할 수 있게 해줘").
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-stl-actions";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const { launchBrowser } = require("./browser");
const app = require("../server");
const { store, getDb, connectDB, save } = require("../src/db");
const { taipeiDateString } = require("../src/time");

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
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  // 한국관 POS 앱 흉내 — 종이 대신 보낸 바이트 수를 적는다.
  await ctx.addInitScript(() => {
    window.__jobs = [];
    window.HangukgwanPrint = {
      printBase64(b64) { window.__jobs.push(b64.length); return "queued"; },
      target() { return "192.168.111.142:9100"; },
      available() { return true; },
    };
  });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.dismiss());
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "ownerpass123" }) });
  });

  await connectDB();
  const D = taipeiDateString();
  const menu = store.menuItems.filter((m) => !m.deleted_at);
  const table = store.tables.find((t) => !t.is_counter);
  const rows = [0, 1, 2].map((i) => ({ item: menu[i] })).map(({ item }, i) => ({
    _id: 950000 + i, id: 950000 + i, table_number: String(table.number), status: "paid",
    order_type: "dine_in", created_at: `${D} 12:0${i}:00`, updated_at: `${D} 12:1${i}:00`,
    paid_at: `${D} 12:1${i}:00`, payment_method: "cash", party_size: 2, party_adults: 2, party_children: 0,
    subtotal: item.price, discount_amount: 0, total: item.price,
    items: [{ item_id: item.id, code: item.code, name_ko: item.name_ko, name_zh: item.name_zh,
      name_en: item.name_en, qty: 1, unit_price: item.price, selected_addons: [], option_choice: null,
      spice_choice: null, order_type: "dine_in", paid: true, payment_method: "cash", note: "" }],
    account_id: null, note: "", visit_key: "e2e-visit-1", payment_ids: ["e2e-pay-1"],
  }));
  await getDb().collection("orders").bulkWrite(
    rows.map((r) => ({ replaceOne: { filter: { _id: r.id }, replacement: r, upsert: true } }))
  );
  store.settings.service_started_at = `${D} 00:00:00`;
  await save();

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1300);
  await page.locator('.admin-tabs button[data-tab="settlement"]').click();
  await page.waitForTimeout(900);
  await page.fill("#settlementStartDate", D);
  await page.fill("#settlementEndDate", D);
  await page.waitForTimeout(1600);

  const L = "#settlementOrdersList";
  const head = page.locator(`${L} .stl-order:has(.stl-order-rounds) .stl-order-head`).first();
  check("한 자리 세 번 주문이 한 줄(묶음)로 나온다", (await head.count()) === 1 && /3번에 나눠/.test(await head.innerText()), "");

  out.push("[★★ 묶음 머리에 「한 번에 인쇄」·미리보기]");
  check("★ 「한 번에 인쇄」 버튼", (await head.locator("[data-stl-print-group]").innerText()).includes("한 번에 인쇄"), "");
  check("★ 미리보기 버튼", (await head.locator("[data-stl-preview-group]").count()) === 1, "");

  out.push("\n[★★ 미리보기에 세 번 시킨 것이 다 한 장에 — 줄은 안 펼쳐진다]");
  {
    const openBefore = await page.locator(`${L} .stl-order-body`).count();
    await head.locator("[data-stl-preview-group]").click();
    await page.waitForTimeout(800);
    check("★ 미리보기 창이 열린다", await page.locator("#ticketPreviewBackdrop").isVisible(), "");
    const text = await page.locator("#ticketPreviewFrame").evaluate((f) => (f.contentDocument && f.contentDocument.body.innerText) || "");
    const names = rows.map((r) => r.items[0].name_zh);
    check("★★ 세 라운드 품목이 다 들어 있다", names.every((n) => text.includes(n)), `${names} / ${text.slice(0, 120)}`);
    check("★ 합계는 세 라운드를 더한 금액", text.includes(String(rows.reduce((a, r) => a + r.total, 0))), "");
    await page.locator("#ticketPreviewClose").click();
    const openAfter = await page.locator(`${L} .stl-order-body`).count();
    check("★ 줄은 그대로 (안 펼쳐짐)", openAfter === openBefore, `${openBefore} → ${openAfter}`);
  }

  out.push("\n[★★ 한 번에 인쇄 = 한 건 인쇄와 같은 장 수]");
  {
    const b0 = await page.evaluate(() => window.__jobs.length);
    await head.locator("[data-stl-print-group]").click();
    await page.waitForTimeout(1500);
    const groupJobs = await page.evaluate((b) => window.__jobs.slice(b), b0);
    await head.click({ position: { x: 80, y: 10 } });
    await page.waitForTimeout(600);
    check("★ 줄을 누르면 라운드가 펼쳐진다", (await page.locator(`${L} .stl-order-round`).count()) === 3, "");
    const b1 = await page.evaluate(() => window.__jobs.length);
    await page.locator(`${L} .stl-order-round [data-stl-print]`).first().click();
    await page.waitForTimeout(1500);
    const roundJobs = await page.evaluate((b) => window.__jobs.slice(b), b1);
    check("★★ 한 번 눌러 나간다", groupJobs.length > 0, JSON.stringify(groupJobs));
    check("★★ 라운드 하나 뽑을 때와 같은 장 수 — 세 번 따로가 아니다", groupJobs.length === roundJobs.length, `${groupJobs.length} vs ${roundJobs.length}`);
    check("★ 묶음 종이가 더 길다(품목이 더 많다)", groupJobs[0] > roundJobs[0], `${groupJobs[0]} vs ${roundJobs[0]}`);
  }

  out.push("\n[★ 금액이 오른쪽 벽에 안 붙는다]");
  {
    const gap = await page.evaluate(() => {
      const head = document.querySelector("#settlementOrdersList .stl-order-head");
      const total = head.querySelector(".stl-order-total");
      return Math.round(head.getBoundingClientRect().right - total.getBoundingClientRect().right);
    });
    // 예전에는 펼침표(22px)만 두고 벽에 붙어 있었다. 이제 버튼 두 개가 그
    // 오른쪽에 있어서 금액이 안쪽으로 들어온다.
    check("★ 금액 오른쪽에 여유가 생겼다", gap > 120, `${gap}px`);
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  await browser.close();
  server.close();
  process.exit(fail === 0 ? 0 : 1);
})();
