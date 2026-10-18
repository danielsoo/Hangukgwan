// 나눠 내기 — 한 번의 결제를 여러 결제수단으로(2026-10-18, src/splitTender.js).
//
// 사장님: "결제 할 때 고객들이 현금 특정 가격과 남은 건 카드로 결제하려고 할 때가 있대" →
// "현금만 그런 거 말고 여러개를 따로 해서 할 수 있게 해줄래?"
//
// 결제 창 → 「➗ 나눠 내기」 → 현금 칸에 금액 → 카드 「나머지」 → 「나눠서 결제」. 재는 것:
//   · 남은 돈이 0 이 아니면 결제 단추가 안 눌린다
//   · 라운드 두 개를 한 번에 내도 결산의 현금·카드 칸이 손님이 낸 그대로다
//   · 영수증이 나간다 / 서버가 합이 안 맞는 결제를 거절하고 까닭을 말한다
//   · 特約95折(현금만)이 걸리면 나눠 내기도 잠긴다
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-split-pay";
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
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: "Asia/Taipei" });
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

  const food = store.menuItems.find((m) => !m.deleted_at && !m.min_first_order_qty && !m.mix_options && !m.options && m.price >= 100);
  const tables = store.tables.filter((t) => !t.is_counter && t.number !== "T");
  const api = (url, method, body) => page.evaluate(async ([u, m, b]) => {
    const r = await fetch(u, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, [url, method, body]);

  async function seat(T, rounds = 1) {
    for (let k = 0; k < rounds; k++) {
      await page.evaluate(async ([t, foodId]) => {
        await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tableNumber: t, items: [{ itemId: foodId, qty: 2 }], party: { adults: 2, children: 0 } }) });
      }, [T, food.id]);
    }
    await page.evaluate(async (t) => {
      const H = { "Content-Type": "application/json" };
      const tbl = await (await fetch("/api/tables")).json();
      const zones = await (await fetch("/api/zones")).json();
      const target = tbl.find((x) => String(x.number) === String(t));
      await fetch(`/api/tables/${target.id}`, { method: "PATCH", headers: H,
        body: JSON.stringify({ zoneId: zones[0].id, x: 20 + Math.random() * 400, y: 40, width: 70, height: 70 }) });
    }, T);
  }
  async function openPay(T) {
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await page.locator('.admin-tabs button[data-tab="payment"]').click();
    await page.locator("#paymentFloorPlan .table-block").first().waitFor({ timeout: 15000 });
    await page.locator(`#paymentFloorPlan .table-block:has(> span:text-is("${T}"))`).first().click();
    await page.waitForTimeout(700);
    await page.locator("#tableDetailSelectAll").check();
    await page.waitForTimeout(300);
  }

  const T1 = tables[0].number;
  await seat(T1, 2);
  const due = store.orders.filter((o) => o.table_number === String(T1)).reduce((a, o) => a + o.total, 0);
  const cash = Math.floor(due / 3);

  out.push(`[결제 창 → 나눠 내기 (낼 돈 NT$${due}, 라운드 2개)]`);
  await openPay(T1);
  await page.locator("#tableDetailBody .pay-selected-items-btn").first().click();
  await page.waitForTimeout(400);
  check("★ 결제 창에 「➗ 여러 결제수단으로 나눠 내기」", await page.locator("#paySplitOpen").isVisible(), "");
  await page.locator("#paySplitOpen").click();
  await page.waitForTimeout(300);
  const dueShown = await page.locator("#paySplitDueAmt").innerText();
  check("★★ 낼 돈이 보인다", dueShown.replace(/[^0-9]/g, "") === String(due), dueShown);
  check("네 수단 칸(현금·LinePay·카드·기타)", (await page.locator("[data-split-amt]").count()) === 4, "");
  check("처음엔 「나눠서 결제」가 안 눌린다", await page.locator("#paySplitGo").isDisabled(), "");
  await page.locator("#paySplit_cash").fill(String(cash));
  await page.waitForTimeout(150);
  const left1 = await page.locator("#paySplitLeft").innerText();
  check("★ 현금만 넣으면 「남은 돈」이 보이고 아직 못 누른다", /남은 돈/.test(left1) && left1.replace(/[^0-9]/g, "") === String(due - cash) && (await page.locator("#paySplitGo").isDisabled()), left1);
  await page.locator('[data-split-rest="card"]').click();
  await page.waitForTimeout(150);
  const cardVal = await page.locator("#paySplit_card").inputValue();
  check("★★ 카드 「나머지」를 누르면 남은 돈이 카드 칸에", cardVal === String(due - cash), cardVal);
  check("딱 맞으면 「✓ 딱 맞아요」, 눌린다", /딱 맞아요/.test(await page.locator("#paySplitLeft").innerText()) && !(await page.locator("#paySplitGo").isDisabled()), "");
  await page.locator("#paySplit_linepay").fill("50");
  await page.waitForTimeout(150);
  check("넘치게 넣으면 「더 많아요」, 못 누른다", /더 많아요/.test(await page.locator("#paySplitLeft").innerText()) && (await page.locator("#paySplitGo").isDisabled()), await page.locator("#paySplitLeft").innerText());
  await page.locator("#paySplit_linepay").fill("");
  await page.waitForTimeout(150);
  const before = await page.evaluate(() => window.__jobs.length);
  await page.locator("#paySplitGo").click();
  await page.locator("#appDialogBackdrop").waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  if (await page.locator("#appDialogBackdrop").isVisible()) await page.locator("#appDialogOk").click();
  await page.waitForTimeout(1500);
  const mine = store.orders.filter((o) => o.table_number === String(T1));
  check("★★ 라운드 두 개가 다 결제됐다", mine.length === 2 && mine.every((o) => o.status === "paid"), mine.map((o) => o.status).join(","));
  const sumM = (m) => mine.flatMap((o) => (o.split_tenders || []).flatMap((r) => r.tenders)).filter((t) => t.method === m).reduce((a, t) => a + t.amount, 0);
  check("★★ 주문에 남은 몫: 현금·카드 합이 낸 그대로", sumM("cash") === cash && sumM("card") === due - cash, `cash ${sumM("cash")} card ${sumM("card")}`);
  check("영수증(확인을 누름) 한 장", (await page.evaluate(() => window.__jobs.length)) - before === 1, "");

  out.push("\n[결산 — 서랍이 맞는다]");
  const st = await api("/api/settlements", "GET");
  const bm = Object.fromEntries(((st.body && st.body.payment_method_breakdown) || []).map((e) => [e.method, e.revenue]));
  check("★★ 결산 현금 칸 = 현금으로 낸 돈", bm.cash === cash, JSON.stringify(bm));
  check("★★ 결산 카드 칸 = 카드로 낸 돈", bm.card === due - cash, JSON.stringify(bm));
  check("결제수단 총합 = 매출", st.body.payment_method_total === st.body.total_revenue, `${st.body.payment_method_total} / ${st.body.total_revenue}`);

  out.push("\n[서버가 한 번 더 본다]");
  const T2 = tables[1].number;
  await seat(T2, 1);
  const o2 = store.orders.find((o) => o.table_number === String(T2) && o.status !== "paid");
  const sel = { selections: [{ orderId: o2.id, itemIndexes: [0] }] };
  const bad = await api("/api/orders/pay-table", "POST", { ...sel, paymentMethod: "split", tenders: [{ method: "cash", amount: 1 }, { method: "card", amount: 1 }] });
  check("★★ 합이 안 맞으면 400 split_mismatch + 서버가 센 낼 돈", bad.status === 400 && bad.body.error === "split_mismatch" && bad.body.due === o2.total, JSON.stringify(bad));
  check("거절되면 아무것도 결제되지 않는다", store.orders.find((o) => o.id === o2.id).status !== "paid", "");
  const junk = await api("/api/orders/pay-table", "POST", { ...sel, paymentMethod: "split", tenders: [{ method: "gold", amount: o2.total }] });
  check("모르는 수단은 400 invalid_split", junk.status === 400 && junk.body.error === "invalid_split", JSON.stringify(junk));
  const vip = await api("/api/orders/pay-table", "POST", { ...sel, vipDiscountType: "te95", paymentMethod: "split", tenders: [{ method: "cash", amount: 10 }, { method: "card", amount: 10 }] });
  check("★ 特約95折(현금만)에 나눠 내기는 막힌다", vip.status === 400 && vip.body.error === "discount_requires_cash", JSON.stringify(vip));
  const one = await api("/api/orders/pay-table", "POST", { ...sel, paymentMethod: "split", tenders: [{ method: "linepay", amount: o2.total }] });
  const o2b = store.orders.find((o) => o.id === o2.id);
  check("수단이 하나뿐이면 그냥 그 수단 결제", one.status === 200 && o2b.payment_method === "linepay" && !o2b.split_tenders, JSON.stringify({ s: one.status, m: o2b.payment_method }));

  out.push("\n[포장 카운터 길(PATCH /:id)도 나눠 낸다]");
  const T3 = tables[2].number;
  await seat(T3, 1);
  const o3 = store.orders.find((o) => o.table_number === String(T3) && o.status !== "paid");
  const p3 = await api(`/api/orders/${o3.id}`, "PATCH", { status: "paid", paymentMethod: "split", tenders: [{ method: "cash", amount: o3.total - 10 }, { method: "other", amount: 10 }] });
  const o3b = store.orders.find((o) => o.id === o3.id);
  check("★ 결제되고 몫이 남는다", p3.status === 200 && o3b.status === "paid" && o3b.payment_method === "split" && o3b.split_tenders.length === 1, JSON.stringify(p3.body && p3.body.error));
  const p3bad = await api(`/api/orders/${o3.id}`, "PATCH", { status: "paid", paymentMethod: "split", tenders: [{ method: "cash", amount: 1 }, { method: "card", amount: 1 }] });
  check("합이 안 맞으면 거절(이미 낸 품목은 낼 돈이 0)", p3bad.status === 400, JSON.stringify(p3bad));

  out.push("\n[特約95折이 걸리면 화면에서도 잠긴다]");
  const T4 = tables[3].number;
  await seat(T4, 1);
  await openPay(T4);
  const te = page.locator('#tableDetailBody [data-vip-discount-btn][data-vip-discount-scope="table"]').first();
  if (await te.count()) {
    await te.click();
    await page.waitForTimeout(300);
    await page.locator("#tableDetailBody .pay-selected-items-btn").first().click();
    await page.waitForTimeout(300);
    check("★ 할인이 걸리면 「나눠 내기」 단추가 잠긴다", await page.locator("#paySplitOpen").isDisabled(), "");
    await page.locator("#paymentMethodCancel").click();
  } else {
    out.push("  (特約95折 단추를 못 찾아 화면 확인은 건너뜀 — 서버 쪽은 위에서 잼)");
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
