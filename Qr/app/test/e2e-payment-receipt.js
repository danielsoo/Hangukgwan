// 결제 탭: 품목 고르기 → 결제 → 현금 → 「영수증을 출력하시겠습니까?」 → 한 장.
//
// 사장님(2026-09-29): "결제할 때 품목 선택해서 결제한 것들만 눌러서 결제
// 누르고 결제 방식까지 나오잖아 현금 카드 라인 뭐 이런 거 그거까지 누르면
// 영수증을 출력하시겠습니까를 만드는거야."
//
// 프린터는 한국관 POS 앱을 흉내 낸다(window.HangukgwanPrint). 종이 내용은
// test/payment-receipt.test.js 가 잰다 — 여기서는 흐름과 「몇 장이 나갔나」.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-payment-receipt";
process.env.ADMIN_PASSWORD = "ownerpass123";

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
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript(() => {
    window.__jobs = [];
    window.HangukgwanPrint = {
      printBase64(b64) { window.__jobs.push(b64.length); return "queued"; },
      target() { return "192.168.111.142:9100"; },
      available() { return true; },
    };
  });
  const page = await ctx.newPage();
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "ownerpass123" }) });
  });
  await page.reload({ waitUntil: "networkidle" });
  await require("./disable-order-hours")();

  const food = store.menuItems.find((m) => !m.deleted_at && !m.min_first_order_qty && !m.mix_options && !m.options);
  const tables = store.tables.filter((t) => !t.is_counter && t.number !== "T");

  async function seat(T) {
    await page.evaluate(async ([t, foodId]) => {
      const H = { "Content-Type": "application/json" };
      await fetch("/api/orders", { method: "POST", headers: H,
        body: JSON.stringify({ tableNumber: t, items: [{ itemId: foodId, qty: 2 }], party: { adults: 2, children: 0 } }) });
      const tbl = await (await fetch("/api/tables")).json();
      const zones = await (await fetch("/api/zones")).json();
      const target = tbl.find((x) => String(x.number) === String(t));
      await fetch(`/api/tables/${target.id}`, { method: "PATCH", headers: H,
        body: JSON.stringify({ zoneId: zones[0].id, x: 20 + Math.random() * 400, y: 40, width: 70, height: 70 }) });
    }, [T, food.id]);
  }
  async function payTable(T) {
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const before = await page.evaluate(() => window.__jobs.length);
    await page.locator('.admin-tabs button[data-tab="payment"]').click();
    await page.locator("#paymentFloorPlan .table-block").first().waitFor({ timeout: 15000 });
    await page.locator(`#paymentFloorPlan .table-block:has(> span:text-is("${T}"))`).first().click();
    await page.waitForTimeout(700);
    await page.locator("#tableDetailSelectAll").check();
    await page.waitForTimeout(300);
    await page.locator("#tableDetailBody .pay-selected-items-btn").first().click();
    await page.waitForTimeout(400);
    const methodShown = await page.locator("#paymentMethodBackdrop").isVisible();
    await page.locator('#paymentMethodBackdrop [data-payment-method="cash"]').click();
    await page.waitForTimeout(1500);
    const askShown = await page.locator("#appDialogBackdrop").isVisible();
    const askText = askShown ? await page.locator("#appDialogMessage").innerText() : "";
    const after = await page.evaluate(() => window.__jobs.length);
    const paid = store.orders.filter((o) => o.table_number === String(T)).every((o) => o.status === "paid");
    return { methodShown, askShown, askText, printed: after - before, paid };
  }

  // 2026-09-30 사장님: "결제 후 고객의 요청으로 결제명세서를 출력하고자 할 때
  // 결제완료 구역의 해당명세서 인쇄를 누르면 프린트되도록 요청. 결제된 명세서는
  // 주방용이 불필요하고, 고객이 모두 요청하는 것이 아니므로 결제 후 프린트
  // 여부를 묻는 절차 역시 불필요함."
  out.push("[결제 → 현금 — 묻지 않고, 찍지 않는다]");
  await seat(tables[0].number);
  const r = await payTable(tables[0].number);
  check("결제 방식 창이 먼저 뜬다", r.methodShown, "");
  check("결제가 된다", r.paid, "");
  check("★★ 「영수증을 출력하시겠습니까?」를 묻지 않는다", !/영수증/.test(r.askText), r.askText);
  check("★ 결제만으로는 종이가 안 나간다", r.printed === 0, `${r.printed}`);

  out.push("\n[결제 완료 칸의 카드 → 영수증 한 장]");
  await page.keyboard.press("Escape").catch(() => {});
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  const paidOrder = store.orders.find((o) => o.table_number === String(tables[0].number) && o.status === "paid");
  const card = page.locator(`.order-card[data-order-id="${paidOrder.id}"]`);
  await card.first().scrollIntoViewIfNeeded();
  const btn = card.locator("button", { hasText: "영수증" });
  check("★ 결제된 카드에 「🧾 영수증」 버튼", (await btn.count()) === 1, `${await btn.count()}`);
  const before = await page.evaluate(() => window.__jobs.length);
  await btn.first().click();
  await page.waitForTimeout(1500);
  const jobs = await page.evaluate((b) => window.__jobs.slice(b), before);
  check("★★ 누르면 한 장만 나간다 — 주방용 없이", jobs.length === 1, JSON.stringify(jobs));
  check("오류 창이 안 뜬다", !(await page.locator("#appDialogBackdrop").isVisible()), "");

  out.push("\n[결제 안 된 카드의 인쇄는 그대로 — 주방으로]");
  await seat(tables[1].number);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  const open = store.orders.find((o) => o.table_number === String(tables[1].number) && o.status !== "paid");
  const openCard = page.locator(`.order-card[data-order-id="${open.id}"]`);
  check("결제 안 된 카드는 「인쇄」", (await openCard.locator("button", { hasText: "인쇄" }).count()) >= 1 && (await openCard.locator("button", { hasText: "영수증" }).count()) === 0, "");

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
