// 정산 버튼이 미결제를 결제완료로 바꾸지 않는다.
//
// 2026-10-17 사장님: 전날(10-16) 결산 화면의 「⚠️ 미결제/문제 주문 2건 · NT$5,170」이 다음 날
// 안 보였다 — "뭐야?". 「🌙 오후 정산」이 확인을 받으면 남은 미결제를 전부 결제완료(결제수단 미지정)로
// 바꿔 판에서 지웠기 때문이다. 받았는지 모르는 돈이 매출로 잡히고 경고가 사라진다. 사장님이
// 「남겨 두기」(1번)를 고르셨다. 이 시험은 버튼을 실제로 눌러 **주문 상태가 그대로인지**를 잰다.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};
process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-close-keeps-unpaid";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.STAFF_PASSWORD = "staffpass123";

const { launchBrowser } = require("./browser");
const app = require("../server");
const { store, saveOrder, findOrderById } = require("../src/db");

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
  // 가게 패드는 타이베이 시각이다 — 「오늘 주문」을 화면이 패드 시계로 가른다.
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: "Asia/Taipei" })).newPage();
  page.on("dialog", (d) => d.dismiss());
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.evaluate(() => fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "staffpass123" }) }));
  await page.reload({ waitUntil: "networkidle" });
  await require("./disable-order-hours")();

  const api = (url, opts) => page.evaluate(async ([u, o]) => {
    const r = await fetch(u, o || undefined);
    let b = null; try { b = await r.json(); } catch (e) {}
    return { status: r.status, body: b };
  }, [url, opts]);
  const json = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  const tables = store.tables.filter((t) => !t.is_counter);
  const food = store.menuItems.find((m) => !m.min_first_order_qty && m.price > 0);
  // 낸 손님 하나, 안 낸 손님 둘
  await api(`/api/tables/${tables[0].number}/party-size`, json("PUT", { partySize: 2 }));
  const paid = await api("/api/orders", json("POST", { tableNumber: tables[0].number, items: [{ itemId: food.id, qty: 1 }] }));
  await api(`/api/orders/${paid.body.id}`, json("PATCH", { status: "paid", paymentMethod: "cash" }));
  const paidTotal = store.orders.find((o) => o.id === paid.body.id).total;
  const unpaidIds = [];
  for (const t of tables.slice(1, 3)) {
    await api(`/api/tables/${t.number}/party-size`, json("PUT", { partySize: 2 }));
    const r = await api("/api/orders", json("POST", { tableNumber: t.number, items: [{ itemId: food.id, qty: 2 }] }));
    unpaidIds.push(r.body.id);
  }
  const unpaidTotal = unpaidIds.reduce((s, id) => s + store.orders.find((o) => o.id === id).total, 0);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  out.push("[🌙 오후 정산 — 미결제 2건이 남은 채로]");
  await page.locator("#settlePmBtn").click();
  await page.waitForTimeout(400);
  const ask = await page.locator("#appDialogMessage").innerText();
  check("★ 묻는 말: 미결제 2건을 결제완료로 바꾸지 않고 남긴다고", /2건/.test(ask) && /그대로 남겨요/.test(ask) && !/전부 결제완료 처리/.test(ask), ask);
  await page.locator("#appDialogOk").click();
  await page.waitForTimeout(1500);
  const done = await page.locator("#appDialogMessage").innerText();
  check(`★ 끝난 뒤에도 「결제 안 된 2건(NT$${unpaidTotal.toLocaleString()})은 그대로」라고 말한다`, /결제 안 된 2건/.test(done) && done.includes(unpaidTotal.toLocaleString()), done);
  await page.locator("#appDialogOk").click().catch(() => {});

  // 결제완료가 되면 메모리 목록에서 빠질 수 있으므로 저장소에서 읽는다.
  const rows = await Promise.all(unpaidIds.map((id) => findOrderById(id)));
  const states = rows.map((o) => o && o.status);
  check(`★★ 미결제 주문은 결제완료가 되지 않는다 (${states.join(", ")})`, states.every((s) => s !== "paid"), states.join());
  check("★ 결제수단 「미지정」으로 매출에 잡히지 않는다", rows.every((o) => o && !o.payment_method), "");
  const snap = await api("/api/settlements");
  check(`매출은 실제로 받은 것만 (NT$${paidTotal})`, snap.body && snap.body.total_revenue === paidTotal, JSON.stringify(snap.body && snap.body.total_revenue));

  out.push("\n[다음 날 결산 — 경고가 남는다]");
  // 2시간 넘게 묵은 미결제가 「⚠ 미결제/문제 주문」이다. 주문 시각을 3시간 앞으로 돌려(날이 바뀌어도)
  // 사장님이 그 날짜 결산을 여는 것처럼 본다.
  const p2 = (n) => String(n).padStart(2, "0");
  let day = null;
  for (const id of unpaidIds) {
    const o = store.orders.find((x) => x.id === id) || (await findOrderById(id));
    const [d0, t0] = o.created_at.split(" ");
    const d = new Date(Date.UTC(...d0.split("-").map((v, i) => Number(v) - (i === 1 ? 1 : 0)), ...t0.split(":").map(Number)) - 3 * 3600 * 1000);
    day = `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
    o.created_at = `${day} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
    await saveOrder(o);
  }
  const boss = await (await browser.newContext()).newPage();
  await boss.goto(`${base}/admin`);
  await boss.evaluate(() => fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "ownerpass123" }) }));
  const after = await boss.evaluate(async (d) => (await fetch(`/api/settlements?start=${d}&end=${d}`)).json(), day);
  check(`★★ 그 날 결산에 「⚠ 미결제 2건 · NT$${unpaidTotal.toLocaleString()}」가 남는다`, after.problem_order_count === 2 && after.problem_amount === unpaidTotal, JSON.stringify({ c: after.problem_order_count, a: after.problem_amount }));

  await browser.close();
  server.close();
  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
