// 결제수단 없이 결제완료가 된 주문을 미결제로 되돌린다.
//
// 2026-10-17 사장님: 10-16 결산의 「⚠ 미결제 2건 · NT$5,170」이 다음 날 사라졌다 — 예전 「🌙 오후 정산」이
// 남은 미결제를 결제수단 없이 결제완료로 바꿨기 때문이다(그 길은 이제 없다, e2e-close-keeps-unpaid.js).
// "어제것도 되돌려줄 수 있나?" → 결산 > 지난 주문에 「↶ 미결제로 되돌리기」(사장님만).
//
// 재는 것: 그 버튼은 **결제수단 없는 결제완료에만** 있다 · 누르면 주문이 미결제로 돌아가고 · 그 날 마감
// 기록의 매출에서 빠지고 · 현금으로 받은 주문은 서버도 거절한다 · 직원은 못 한다.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};
process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-unpay-paid";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.STAFF_PASSWORD = "staffpass123";

const { launchBrowser } = require("./browser");
const app = require("../server");
const { store, findOrderById, findDocs } = require("../src/db");

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
  const login = async (pw) => {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: "Asia/Taipei" })).newPage();
    page.on("dialog", (d) => d.dismiss());
    await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
    await page.evaluate((p) => fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: p }) }), pw);
    await page.reload({ waitUntil: "networkidle" });
    return page;
  };
  const boss = await login("ownerpass123");
  await require("./disable-order-hours")();
  const api = (page, url, opts) => page.evaluate(async ([u, o]) => {
    const r = await fetch(u, o || undefined);
    let b = null; try { b = await r.json(); } catch (e) {}
    return { status: r.status, body: b };
  }, [url, opts]);
  const json = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });

  const tables = store.tables.filter((t) => !t.is_counter);
  const food = store.menuItems.find((m) => !m.min_first_order_qty && m.price > 0);
  const make = async (t, qty, pay) => {
    await api(boss, `/api/tables/${t.number}/party-size`, json("PUT", { partySize: 2 }));
    const r = await api(boss, "/api/orders", json("POST", { tableNumber: t.number, items: [{ itemId: food.id, qty }] }));
    // 예전 오후 정산이 보내던 것 그대로 — 결제수단 없이 { status: "paid" }
    await api(boss, `/api/orders/${r.body.id}`, json("PATCH", pay ? { status: "paid", paymentMethod: pay } : { status: "paid" }));
    return (await findOrderById(r.body.id));
  };
  const forced = await make(tables[0], 2, null);
  const cash = await make(tables[1], 1, "cash");
  // 아직 안 낸 주문 하나
  await api(boss, `/api/tables/${tables[2].number}/party-size`, json("PUT", { partySize: 2 }));
  const openOrder = (await api(boss, "/api/orders", json("POST", { tableNumber: tables[2].number, items: [{ itemId: food.id, qty: 1 }] }))).body;
  // 그 날 마감 기록 — 되돌리면 이것도 다시 세야 월·연 결산이 맞는다.
  await api(boss, "/api/settlements/close", json("POST", {}));
  const day = forced.created_at.slice(0, 10);
  const [snap0] = await findDocs("daily_settlements", { date: day, test_session: { $exists: false } });
  check(`마감 기록에 결제완료 두 주문이 다 매출로 (NT$${snap0 && snap0.total_revenue})`, snap0 && snap0.total_revenue === forced.total + cash.total, JSON.stringify(snap0 && snap0.total_revenue));

  out.push("\n[결산 > 지난 주문 — 버튼은 결제수단 없는 것에만]");
  await boss.locator('.admin-tabs button[data-tab="settlement"]').click();
  await boss.waitForTimeout(1500);
  await boss.locator(`[data-stl-unpay="${forced.id}"]`).first().waitFor({ timeout: 8000 }).catch(() => {});
  check("★★ 결제수단 없는 결제완료 줄에 「↶ 미결제로 되돌리기」", (await boss.locator(`[data-stl-unpay="${forced.id}"]`).count()) === 1, "");
  check("★★ 현금으로 받은 줄에는 없다", (await boss.locator(`[data-stl-unpay="${cash.id}"]`).count()) === 0, "");

  // 2026-10-18 사장님: "결제수단이 있는지 없는지 모르겠어" — 줄 머리에 어떻게 받았나를 적는다.
  const tagOf = (id) => boss.locator(`.stl-order[data-order-id="${id}"] .stl-pay-tags`).first().innerText().catch(() => "");
  const tf = await tagOf(forced.id);
  const tc = await tagOf(cash.id);
  check(`★★ 줄 머리에 결제수단 — 결제수단 없는 줄은 「⚠ 결제수단 없음」(${tf}), 현금 줄은 「현금」(${tc})`, /결제수단 없음/.test(tf) && /현금/.test(tc) && !/결제수단 없음/.test(tc), JSON.stringify({ tf, tc }));
  check("「결제수단 없음」은 빨간 표", (await boss.locator(`.stl-order[data-order-id="${forced.id}"] .stl-pay-tag.is-none`).count()) === 1, "");
  if (process.env.SHOT_DIR) await boss.locator("#settlementOrdersList").screenshot({ path: require("path").join(process.env.SHOT_DIR, "stl-paytag.png") }).catch(() => {});

  // 2026-10-18 사장님: "결제수단 없이 결제된 것들만 모아서 볼 수 있는 것도 만들어줘 결제 안된것들이랑"
  out.push("\n[상태로 모아 보기]");
  const ids = async (status) => {
    await boss.selectOption("#settlementOrderStatus", status);
    await boss.waitForTimeout(1000);
    return boss.locator("#settlementOrdersList .stl-order").evaluateAll((els) => els.map((e) => Number(e.dataset.orderId)));
  };
  const nm = await ids("no_method");
  check(`★★ 「⚠ 결제수단 없이 결제완료」 → 그 주문만 (${nm.join(",")})`, nm.length === 1 && nm[0] === forced.id, JSON.stringify(nm));
  const up = await ids("unpaid");
  check(`★★ 「미결제」 → 안 낸 주문만 (${up.join(",")})`, up.length === 1 && up[0] === openOrder.id, JSON.stringify(up));
  const all = await ids("");
  check("전체 상태로 돌아오면 셋 다", all.length === 3, JSON.stringify(all));

  out.push("\n[서버도 막는다]");
  const r1 = await api(boss, `/api/orders/${cash.id}/unpay`, json("POST"));
  check("★ 현금 결제는 되돌리지 않는다(400 has_payment_method)", r1.status === 400 && r1.body.error === "has_payment_method", JSON.stringify(r1));
  const staff = await login("staffpass123");
  const r2 = await api(staff, `/api/orders/${forced.id}/unpay`, json("POST"));
  check(`★ 직원은 못 한다(${r2.status})`, r2.status === 401 || r2.status === 403, JSON.stringify(r2));
  check("직원 화면엔 버튼이 없다", (await staff.locator("[data-stl-unpay]").count()) === 0, "");

  out.push("\n[누르면]");
  await boss.locator(`[data-stl-unpay="${forced.id}"]`).first().click();
  await boss.waitForTimeout(400);
  const ask = await boss.locator("#appDialogMessage").innerText();
  check("★ 한 번 묻는다 — 매출에서 빠지고 ⚠ 미결제에 잡힌다고", /미결제\(서빙 완료\)로 되돌릴까요/.test(ask) && /매출에서 빠지고/.test(ask), ask);
  await boss.locator("#appDialogOk").click();
  await boss.waitForTimeout(1500);
  const after = await findOrderById(forced.id);
  check(`★★ 주문이 미결제(서빙 완료)로 돌아간다 (${after.status})`, after.status === "served" && !after.settled_at, JSON.stringify({ s: after.status, settled: after.settled_at }));
  check("되돌린 기록이 남는다", Array.isArray(after.unpaid_reverted) && after.unpaid_reverted.length === 1, JSON.stringify(after.unpaid_reverted));
  const [snap1] = await findDocs("daily_settlements", { date: day, test_session: { $exists: false } });
  check(`★★ 그 날 마감 기록 매출에서 빠진다 (NT$${snap0.total_revenue} → NT$${snap1.total_revenue})`, snap1.total_revenue === cash.total, JSON.stringify(snap1.total_revenue));
  const live = await api(boss, `/api/settlements?start=${day}&end=${day}`);
  check("결산 화면 매출도 받은 것만", live.body.total_revenue === cash.total, JSON.stringify(live.body.total_revenue));
  check("버튼이 사라진다(다시 그렸다)", (await boss.locator(`[data-stl-unpay="${forced.id}"]`).count()) === 0, "");
  const again = await api(boss, `/api/orders/${forced.id}/unpay`, json("POST"));
  check("두 번 되돌리지 않는다(400 order_not_paid)", again.status === 400 && again.body.error === "order_not_paid", JSON.stringify(again));
  const board = await api(boss, "/api/orders");
  const list = Array.isArray(board.body) ? board.body : (board.body && board.body.orders) || [];
  check("★ 실시간 주문판 목록에 다시 뜬다", list.some((o) => o.id === forced.id && o.status === "served"), JSON.stringify(list.map((o) => [o.id, o.status])));

  await browser.close();
  server.close();
  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
