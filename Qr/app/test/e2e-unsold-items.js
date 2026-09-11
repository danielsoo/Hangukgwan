// 안 팔린 메뉴가 화면에서 실제로 보이고 펼쳐지는가.
//
// 사장님(2026-09-11): "판매항목과 수량 보는 것만큼 판매되지 않은 항목도
// 보였으면 좋겠어. 전혀 판매되지 않는 항목이 뭔지도 알 수 있도록."
//
// 계산은 settlement-unsold-items.test.js 가 잰다. 여기서 보는 것은 그
// 다음이다 — 접혀 있어도 개수가 읽히는가, 눌러서 펼쳐지는가, 그리고
// **이 칸 때문에 결산 화면이 다시 길어지지 않는가.** 이 화면은 한 번
// 너무 길어져서 갈아엎은 적이 있다.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-unsold";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const { launchBrowser } = require("./browser");
const app = require("../server");
const { store, getDb, connectDB, save } = require("../src/db");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const D = "2026-09-09";

(async () => {
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.on("dialog", (d) => d.dismiss());
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "ownerpass123" }) });
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  await connectDB();
  // 메뉴 두 가지만 판다. 나머지 수십 가지는 한 개도 안 나간 날이다.
  const sold = store.menuItems.slice(0, 2);
  const unsoldSample = store.menuItems[5];
  // 하나는 품절로 둔다 — 「안 팔린」 것과 「못 판」 것이 화면에서 갈리는지.
  const soldOutOne = store.menuItems[6];
  soldOutOne.available = 0;
  await save();

  const mk = (id, mi) => ({
    _id: id, id, table_number: "1", status: "paid", order_type: "dine_in",
    created_at: `${D} 12:00:00`, paid_at: `${D} 12:30:00`, updated_at: `${D} 12:30:00`,
    payment_method: "cash", party_size: 2, party_adults: 2, party_children: 0,
    subtotal: mi.price, discount_amount: 0, discount_type: null, total: mi.price,
    items: [{
      item_id: mi.id, code: mi.code, name_ko: mi.name_ko, name_zh: mi.name_zh, name_en: mi.name_en,
      qty: 1, unit_price: mi.price, selected_addons: [], option_choice: null, spice_choice: null,
      category_key: null, order_type: "dine_in", paid: true, payment_method: "cash",
      paid_at: `${D} 12:30:00`, note: "",
    }],
    account_id: null, note: "",
  });
  const rows = sold.map((mi, i) => mk(740001 + i, mi));
  await getDb().collection("orders").bulkWrite(rows.map((r) => ({ replaceOne: { filter: { _id: r.id }, replacement: r, upsert: true } })));
  store.settings.service_started_at = "2026-09-08 17:00:00";
  await save();

  await page.locator('.admin-tabs button[data-tab="settlement"]').click();
  await page.waitForTimeout(900);
  await page.fill("#settlementStartDate", D);
  await page.fill("#settlementEndDate", D);
  await page.waitForTimeout(1700);

  out.push("[결산 화면이 이 칸 때문에 길어지지 않는다]");
  // 기본 탭은 「분류별」이라 이 칸은 화면에 없다. 여기서 늘어나면 이 화면을
  // 갈아엎은 이유(너무 길다)로 도로 돌아간다.
  const heightBefore = await page.evaluate(() => document.querySelector("#tab-settlement").scrollHeight);
  check("★ 처음에는 화면에 안 나온다", await page.evaluate(() => {
    const el = document.querySelector("#settlementUnsold");
    return !el || el.offsetParent === null;
  }));

  out.push("\n[품목별 판매 현황을 연다]");
  await page.locator('.stl-tab[data-pane="soldItems"]').first().click();
  await page.waitForTimeout(700);
  const toggleText = await page.evaluate(() => (document.querySelector("#settlementUnsoldToggle") || {}).textContent || "");
  check("★ 안 팔린 메뉴 줄이 보인다", toggleText.length > 0, toggleText);
  check("★ 펼치지 않아도 개수가 읽힌다", /\d+개/.test(toggleText), toggleText);
  check("전체 메뉴 수도 같이 적힌다", /중\)/.test(toggleText), toggleText);
  check("아직 목록은 접혀 있다", await page.evaluate(() => document.querySelector("#settlementUnsoldList").hidden === true));

  out.push("\n[눌러서 펼친다]");
  await page.locator("#settlementUnsoldToggle").click();
  await page.waitForTimeout(500);
  const listText = await page.evaluate(() => (document.querySelector("#settlementUnsoldList") || {}).textContent || "");
  check("★ 목록이 펼쳐진다", await page.evaluate(() => document.querySelector("#settlementUnsoldList").hidden === false));
  check("★ 안 팔린 메뉴 이름이 보인다", listText.includes(unsoldSample.name_ko || unsoldSample.name_zh),
    `${unsoldSample.name_ko} / ${listText.slice(0, 120)}`);
  check("★ 팔린 메뉴는 이 목록에 없다", !listText.includes(sold[0].name_ko || sold[0].name_zh),
    `${sold[0].name_ko} / ${listText.slice(0, 120)}`);
  check("★ 품절은 따로 표시된다", await page.evaluate(() => !!document.querySelector("#settlementUnsoldList .is-soldout")));
  check("분류별로 묶여 있다", await page.evaluate(() => document.querySelectorAll("#settlementUnsoldList .stl-unsold-cat").length >= 2),
    String(await page.evaluate(() => document.querySelectorAll("#settlementUnsoldList .stl-unsold-cat").length)));

  await page.locator("#settlementUnsoldToggle").click();
  await page.waitForTimeout(400);
  check("다시 누르면 접힌다", await page.evaluate(() => document.querySelector("#settlementUnsoldList").hidden === true));

  out.push("\n[다른 탭으로 돌아가면 높이도 돌아온다]");
  await page.locator('.stl-tab[data-pane="soldCategory"]').first().click();
  await page.waitForTimeout(500);
  const heightAfter = await page.evaluate(() => document.querySelector("#tab-settlement").scrollHeight);
  check(`★ 결산 화면 높이가 그대로다 (${heightBefore} → ${heightAfter})`, Math.abs(heightAfter - heightBefore) <= 4,
    `${heightBefore} → ${heightAfter}`);

  {
    const fs = require("fs");
    const path = require("path");
    const dir = path.join(__dirname, "..", "..", "..", "_screens");
    fs.mkdirSync(dir, { recursive: true });
    await page.locator('.stl-tab[data-pane="soldItems"]').first().click();
    await page.waitForTimeout(400);
    await page.locator("#settlementUnsoldToggle").click();
    await page.waitForTimeout(500);
    const box = await page.locator("#settlementUnsold").boundingBox();
    if (box) await page.screenshot({ path: path.join(dir, "unsold-items.png"), clip: box });
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  await browser.close();
  server.close();
  process.exit(fail === 0 ? 0 : 1);
})();
