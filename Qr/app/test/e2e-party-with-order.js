// 인원은 **첫 주문이 들어가는 순간** 자리에 기록된다.
//
// 사장님(2026-09-29): "고객이 주문을 위해 검색하는 동안 인원수가 미리 등록돼
// 있어 혼선이 발생함. 예전 손님기록인지 현재 손님이 주문중인지 혼란스러워
// 직접 삭제해야하는지 결정을 못함. 수정요청 - 주문이 완료됨과 동시에 테이블의
// 손님인원수가 기록될 수 있도록."
//
// 예전: 인원을 답하는 순간 PUT /party-size 로 자리에 박혔다. 손님이 메뉴를
// 고르는 몇 분 동안 관리자 화면에는 주문 없는 「👥」 가 떠 있었다.
//
// 이 시험은 손님 폰으로 실제로 답하고, 고르는 동안 관리자 쪽 자리를 보고,
// 주문을 넣은 뒤 다시 본다.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-party-with-order";
process.env.ADMIN_PASSWORD = "ownerpass123";

const { launchBrowser } = require("./browser");
const request = require("supertest");
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
  await require("../src/db").connectDB();
  await require("./disable-order-hours")();

  const staff = request.agent(app);
  await staff.post("/api/auth/login").send({ password: "ownerpass123" });
  const tableOnAdmin = async (n) => ((await staff.get("/api/tables")).body || []).find((t) => String(t.number) === String(n)) || {};

  const live = store.menuItems.filter((m) => !m.deleted_at && m.available !== 0);
  const food = live.find((m) => !m.min_first_order_qty && !m.mix_options && !m.options);
  const grill = live.find((m) => m.min_first_order_qty && !m.mix_options);
  const T = store.tables.find((t) => !t.is_counter && t.number !== "T").number;

  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  page.on("dialog", (d) => d.dismiss());
  await page.goto(`${base}/t/${encodeURIComponent(T)}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  out.push("[손님이 인원을 답한다 — 어른 3]");
  check("인원을 묻는다", await page.locator("#partySizeBackdrop").isVisible());
  await page.evaluate(() => {
    // 어른을 3 으로 맞춘다(시작값이 무엇이든).
    const val = () => parseInt(document.querySelector("#partyAdultsVal, #partyAdultsCount, .party-adults-val")?.textContent || "0", 10);
    for (let i = 0; i < 10; i++) document.querySelector("#partyAdultsMinus").click();
    for (let i = 0; i < 3; i++) document.querySelector("#partyAdultsPlus").click();
    return val();
  });
  await page.locator("#partySizeConfirmBtn").click();
  await page.waitForTimeout(600);
  check("창이 닫힌다", !(await page.locator("#partySizeBackdrop").isVisible()));

  out.push("\n[★★ 메뉴를 고르는 동안 — 관리자 화면에 인원이 없다]");
  let t = await tableOnAdmin(T);
  check("★★ 자리에 인원이 안 박혔다", !t.party_size, JSON.stringify({ party_size: t.party_size }));
  check("서버 메모리에도 없다", !store.tables.find((x) => x.number === T).party_size, "");

  out.push("\n[새로고침해도 다시 묻지 않는다]");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  check("★ 인원을 다시 묻지 않는다", !(await page.locator("#partySizeBackdrop").isVisible()));
  t = await tableOnAdmin(T);
  check("여전히 자리에는 없다", !t.party_size, "");

  out.push("\n[주문이 거절되면 인원도 안 남는다]");
  if (grill) {
    // 화면을 거치지 않고 같은 기기로 보낸다 — 불판 1인분은 첫 주문 최소에 걸린다.
    const status = await page.evaluate(async ({ T, id }) => {
      const r = await fetch("/api/orders", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableNumber: T, items: [{ itemId: id, qty: 1, orderType: "dine_in" }], party: { adults: 3, children: 0 } }),
      });
      return r.status;
    }, { T, id: grill.id });
    check("불판 1인분은 거절된다", status === 400, `${status}`);
    t = await tableOnAdmin(T);
    check("★ 거절된 주문은 인원을 남기지 않는다", !t.party_size, JSON.stringify({ party_size: t.party_size }));
  }

  out.push("\n[주문을 넣는 순간 — 인원이 같이 기록된다]");
  await page.evaluate((zh) => {
    const row = [...document.querySelectorAll(".item-row")].find((r) => r.textContent.includes(zh));
    if (row) row.click();
  }, food.name_zh);
  await page.waitForTimeout(600);
  await page.locator("#addToCartBtn").click();
  await page.waitForTimeout(400);
  await page.locator("#cartFab").click();
  await page.waitForTimeout(400);
  await page.locator("#submitOrderBtn").click();
  await page.waitForTimeout(2500);
  // 低消 안내가 뜨면 확인한다(가게 설정에 따라).
  const warn = page.locator("#partyWarningBackdrop:not([hidden]) button").last();
  if (await warn.count()) { await warn.click().catch(() => {}); await page.waitForTimeout(2000); }

  const orders = store.orders.filter((o) => o.table_number === T && o.status !== "cancelled");
  check("주문이 들어갔다", orders.length === 1, `${orders.length}`);
  t = await tableOnAdmin(T);
  check("★★ 이제 자리에 3명", t.party_size === 3 && t.party_adults === 3, JSON.stringify({ party_size: t.party_size, adults: t.party_adults }));
  check("★ 주문에도 3명이 찍혔다", orders[0] && orders[0].party_size === 3, JSON.stringify(orders[0] && orders[0].party_size));
  check("★ 착석이 이 주문에서 시작한다", orders[0] && !!orders[0].seating && orders[0].seating === t.party_size_updated_at, JSON.stringify([orders[0] && orders[0].seating, t.party_size_updated_at]));

  out.push("\n[두 번째 주문 — 다시 묻지 않고, 인원을 덮지 않는다]");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  check("★ 인원을 다시 묻지 않는다", !(await page.locator("#partySizeBackdrop").isVisible()));
  const r2 = await page.evaluate(async ({ T, id }) => {
    const r = await fetch("/api/orders", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tableNumber: T, items: [{ itemId: id, qty: 1, orderType: "dine_in" }], party: { adults: 9, children: 0 } }),
    });
    return r.status;
  }, { T, id: food.id });
  check("두 번째 주문이 들어간다", r2 === 201, `${r2}`);
  t = await tableOnAdmin(T);
  check("★ 실려 온 다른 숫자(9)가 앉아 계신 분들의 3 을 덮지 않는다", t.party_size === 3, `${t.party_size}`);

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
