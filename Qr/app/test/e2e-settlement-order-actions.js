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
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.dismiss());
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "ownerpass123" }) });
  });

  await connectDB();
  const D = taipeiDateString();
  const item = store.menuItems[0];
  const table = store.tables.find((t) => !t.is_counter);
  const rows = [0, 1, 2].map((i) => ({
    _id: 950000 + i, id: 950000 + i, table_number: String(table.number), status: "paid",
    order_type: "dine_in", created_at: `${D} 12:0${i}:00`, updated_at: `${D} 12:1${i}:00`,
    paid_at: `${D} 12:1${i}:00`, payment_method: "cash", party_size: 2, party_adults: 2, party_children: 0,
    subtotal: item.price, discount_amount: 0, total: item.price,
    items: [{ item_id: item.id, code: item.code, name_ko: item.name_ko, name_zh: item.name_zh,
      name_en: item.name_en, qty: 1, unit_price: item.price, selected_addons: [], option_choice: null,
      spice_choice: null, order_type: "dine_in", paid: true, payment_method: "cash", note: "" }],
    account_id: null, note: "",
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

  const rowsN = await page.locator("#settlementOrdersList .stl-order").count();
  check("지난 주문이 나온다", rowsN >= 3, String(rowsN));

  out.push("[★★ 줄마다 인쇄·미리보기가 있다]");
  check("★ 인쇄 버튼", (await page.locator("#settlementOrdersList [data-stl-print]").count()) === rowsN, "");
  check("★ 미리보기 버튼", (await page.locator("#settlementOrdersList [data-stl-preview]").count()) === rowsN, "");

  out.push("\n[★★ 버튼을 눌러도 줄이 펼쳐지지 않는다]");
  {
    // <button> 안에 <button> 은 못 넣어서 줄 전체를 div 로 바꿨다. 그 과정에서
    // 버튼 클릭이 줄 토글까지 같이 태우면, 인쇄할 때마다 줄이 열렸다 닫힌다.
    const openBefore = await page.locator("#settlementOrdersList .stl-order-body").count();
    const [popup] = await Promise.all([
      page.waitForEvent("popup", { timeout: 8000 }).catch(() => null),
      page.locator("#settlementOrdersList [data-stl-preview]").first().click(),
    ]);
    await page.waitForTimeout(600);
    check("★ 미리보기 창이 열린다", !!popup, "창이 안 열림");
    if (popup) {
      const text = await popup.evaluate(() => document.body.innerText).catch(() => "");
      check("★ 빌지 내용이 들어 있다", text.length > 20, text.slice(0, 60));
      await popup.close();
    }
    const openAfter = await page.locator("#settlementOrdersList .stl-order-body").count();
    check("★ 줄은 그대로 (안 펼쳐짐)", openAfter === openBefore, `${openBefore} → ${openAfter}`);
  }

  out.push("\n[줄을 누르면 여전히 펼쳐진다]");
  {
    const before = await page.locator("#settlementOrdersList .stl-order-body").count();
    await page.locator("#settlementOrdersList .stl-order-head").first().click({ position: { x: 80, y: 10 } });
    await page.waitForTimeout(600);
    const after = await page.locator("#settlementOrdersList .stl-order-body").count();
    check("★ 펼쳐진다", after === before + 1, `${before} → ${after}`);
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
