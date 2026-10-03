// 결제 탭: 품목 고르기 → 결제 → 현금 → 「영수증을 출력하시겠습니까?」(3초 뒤 저절로 취소).
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
  async function payTable(T, { press } = {}) {
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
    await page.locator("#appDialogBackdrop").waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    const askShown = await page.locator("#appDialogBackdrop").isVisible();
    const askText = askShown ? await page.locator("#appDialogMessage").innerText() : "";
    const cancel1 = askShown ? await page.locator("#appDialogCancel").innerText() : "";
    let cancel2 = "";
    if (press === "ok") {
      await page.locator("#appDialogOk").click();
      await page.waitForTimeout(1500);
    } else {
      await page.waitForTimeout(1100);
      cancel2 = await page.locator("#appDialogCancel").innerText();
      await page.waitForTimeout(2900);
    }
    const askGone = !(await page.locator("#appDialogBackdrop").isVisible());
    const cancelAfter = await page.locator("#appDialogCancel").innerText();
    const detailClosed = !(await page.locator("#tableDetailBackdrop").isVisible());
    const after = await page.evaluate(() => window.__jobs.length);
    const paid = store.orders.filter((o) => o.table_number === String(T)).every((o) => o.status === "paid");
    return { methodShown, askShown, askText, cancel1, cancel2, askGone, cancelAfter, detailClosed, printed: after - before, paid };
  }

  // 2026-10-03 사장님: "결제 누르고 결제 방법 누르고 영수증 출력하시겠습니까? 를
  // 나오게 해주고 3초 동안 확인 안 누르면 자동 취소 되게 해줘 / 취소(3) -
  // 취소(2) -취소(1) -> 취소" + "결제 완료 후 이 대기창이 3초 후 또는 즉시 닫힐 수
  // 있도록". (09-30 에 묻는 창을 없앴던 것을 되돌린다 — 대신 저절로 닫힌다.)
  out.push("[결제 → 현금 → 묻고, 3초 뒤 저절로 취소]");
  await seat(tables[0].number);
  const r = await payTable(tables[0].number);
  check("결제 방식 창이 먼저 뜬다", r.methodShown, "");
  check("결제가 된다", r.paid, "");
  check("★★ 「영수증을 출력하시겠습니까?」를 묻는다", /영수증/.test(r.askText), r.askText);
  check("★ 취소 버튼이 「취소(3)」으로 시작한다", r.cancel1 === "취소(3)", r.cancel1);
  check("★ 1초 뒤 「취소(2)」", r.cancel2 === "취소(2)", r.cancel2);
  check("★★ 안 누르면 3초 뒤 창이 저절로 닫힌다", r.askGone, "");
  check("닫힌 뒤 버튼 글자는 「취소」로 돌아온다", r.cancelAfter === "취소", r.cancelAfter);
  check("★ 저절로 취소 → 종이가 안 나간다", r.printed === 0, `${r.printed}`);
  check("★★ 다 낸 테이블 창은 닫힌다 — X 를 안 눌러도", r.detailClosed, "");

  out.push("\n[결제 → 현금 → 확인 → 한 장]");
  await seat(tables[2].number);
  const r2 = await payTable(tables[2].number, { press: "ok" });
  check("결제가 된다", r2.paid, "");
  check("★★ 확인을 누르면 한 장", r2.printed === 1, `${r2.printed}`);
  check("테이블 창이 닫힌다", r2.detailClosed, "");

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
