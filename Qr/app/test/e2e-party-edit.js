// 결제 탭 테이블 창의 「👥 인원 수정」 — 누르고, 고치고, 저장하면 제목의
// (어른-아이) 가 바뀐다. 서버 쪽 규칙은 test/party-edit.test.js 가 잰다.
//
// 사장님(2026-09-29): "수기로 수정하는 항목에 인원수 수정이 아직 없는듯.
// 메뉴는 추가 취소 등 수정 가능한데, 인원수는 없는거같애. 내가 못찾는지도."
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-party-edit";
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

  // 손님이 「1명」으로 앉아 한 번 시켰다.
  const food = store.menuItems.find((m) => !m.deleted_at && !m.min_first_order_qty && !m.mix_options && m.available !== 0);
  const T = store.tables.find((t) => !t.is_counter && t.number !== "T").number;
  const guest = request.agent(app);
  await guest.put(`/api/tables/${T}/party-size`).send({ adults: 1, children: 0 });
  const r = await guest.post("/api/orders").send({ tableNumber: T, items: [{ itemId: food.id, qty: 1, orderType: "dine_in" }] });
  check("손님 주문이 들어갔다", r.status === 201, `${r.status}`);

  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  page.on("dialog", (d) => d.dismiss());
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "ownerpass123" }) });
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await page.locator('.admin-tabs button[data-tab="tables"]').click();
  await page.waitForTimeout(600);
  await page.evaluate((n) => {
    const chip = [...document.querySelectorAll(".table-chip")].find((c) => c.textContent.trim().startsWith(n));
    if (chip) chip.click();
  }, String(T));
  await page.waitForTimeout(700);

  out.push("[테이블 창]");
  const btn = page.locator("#editPartyBtn");
  check("★ 「인원 수정」 버튼이 보인다", await btn.isVisible());
  const titleBefore = await page.evaluate(() => [...document.querySelectorAll("h2")].map((h) => h.textContent).join(" | "));
  check("처음엔 (1-0)", /\(1-0\)/.test(titleBefore || ""), titleBefore);

  await btn.click();
  await page.waitForTimeout(300);
  check("수정 창이 열린다", await page.locator("#partyEditBackdrop").isVisible());
  // 어른 +2, 아이 +1 → 3-1
  await page.locator("#partyEditAdultsPlus").click();
  await page.locator("#partyEditAdultsPlus").click();
  await page.locator("#partyEditChildrenPlus").click();
  check("모두 4명", /4/.test(await page.locator("#partyEditTotal").textContent()), await page.locator("#partyEditTotal").textContent());
  await page.locator("#partyEditSave").click();
  await page.waitForTimeout(1200);

  check("창이 닫힌다", !(await page.locator("#partyEditBackdrop").isVisible()));
  const titleAfter = await page.evaluate(() => [...document.querySelectorAll("h2")].map((h) => h.textContent).join(" | "));
  check("★ 제목이 (3-1) 로 바뀐다", /\(3-1\)/.test(titleAfter), titleAfter);
  const t = store.tables.find((x) => x.number === T);
  check("★ 서버에도 3-1", t.party_adults === 3 && t.party_children === 1, JSON.stringify([t.party_adults, t.party_children]));

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
