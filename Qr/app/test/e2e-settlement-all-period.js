// 「전체 기간」으로 한 번에 볼 수 있는가.
//
// 사장님(2026-09-11): "기간을 전체로도 선택할 수 있게 해줘."
//
// 「전체」가 어디서부터인지는 화면이 지어내면 안 된다. 영업 시작 전 주문은
// 어떤 기간을 골라도 매출에서 빠지므로(src/serviceStart.js), 화면이 임의로
// 「아주 옛날」을 잡으면 0 만 잔뜩 붙은 그래프가 된다. 그래서 서버가
// 시작일을 정해 내려주고(all_time_start) 버튼은 그것을 쓴다.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-all-period";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const { launchBrowser } = require("./browser");
const app = require("../server");
const { store, getDb, connectDB, save } = require("../src/db");
const { taipeiDateString } = require("../src/settlement");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const TODAY = taipeiDateString();
const OPEN_DAY = "2026-09-08";       // 영업 시작일
const BEFORE = "2026-08-20";         // 그 전 — 테스트로 친다
const MID = "2026-09-10";

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
  // 관리자 화면이 살아 있는지 먼저 본다. admin.js 는 통째로 IIFE 하나라,
  // 어느 한 줄에서 터지면(예: 없는 요소에 onclick 을 걸면) 그 뒤가 전부
  // 안 돌고 **로그인 화면에서 안 넘어간다.** 실제로 이 기능을 만들다
  // 버튼을 HTML 에 넣기 전에 핸들러부터 달아서 그렇게 됐다(2026-09-11).
  check("★ 관리자 화면이 뜬다 (admin.js 가 안 죽었다)",
    await page.evaluate(() => !document.querySelector("#dashboard").hidden));

  await connectDB();
  const mi = store.menuItems[0];
  const mk = (oid, date, total, hm = "18:30") => ({
    _id: oid, id: oid, table_number: "1", status: "paid", order_type: "dine_in",
    created_at: `${date} ${hm}:00`, paid_at: `${date} ${hm}:30`, updated_at: `${date} ${hm}:30`,
    payment_method: "cash", party_size: 2, party_adults: 2, party_children: 0,
    subtotal: total, discount_amount: 0, discount_type: null, total,
    items: [{
      item_id: mi.id, code: mi.code, name_ko: mi.name_ko, name_zh: mi.name_zh, name_en: mi.name_en,
      qty: 1, unit_price: total, selected_addons: [], option_choice: null, spice_choice: null,
      category_key: null, order_type: "dine_in", paid: true, payment_method: "cash",
      paid_at: `${date} ${hm}:30`, note: "",
    }],
    account_id: null, note: "",
  });
  const rows = [
    mk(840001, BEFORE, 90000),   // 영업 시작 전 — 어디서도 안 세야 한다
    mk(840002, OPEN_DAY, 1000),  // 영업 첫날 저녁
    mk(840003, MID, 2000),
    mk(840004, TODAY, 3000, "12:10"),
  ];
  await getDb().collection("orders").bulkWrite(rows.map((r) => ({ replaceOne: { filter: { _id: r.id }, replacement: r, upsert: true } })));
  store.settings.service_started_at = `${OPEN_DAY} 17:00:00`;
  await save();

  await page.locator('.admin-tabs button[data-tab="settlement"]').click();
  await page.waitForTimeout(1600);

  out.push("[버튼이 있다]");
  const btn = page.locator("#settlementAllBtn");
  check("★ 「전체 기간」 버튼이 보인다", await btn.isVisible());
  check("최근 30일 옆에 있다", await page.evaluate(() => {
    const m = document.querySelector("#settlementMonthBtn");
    return !!(m && m.nextElementSibling && m.nextElementSibling.id === "settlementAllBtn");
  }));

  out.push("\n[눌러보면 영업 시작일부터 오늘까지다]");
  await btn.click();
  await page.waitForTimeout(1800);
  const range = await page.evaluate(() => ({
    start: document.querySelector("#settlementStartDate").value,
    end: document.querySelector("#settlementEndDate").value,
    sub: (document.querySelector("#settlementHeroSub") || {}).textContent || "",
    revenue: (document.querySelector("#settlementRevenue") || {}).textContent || "",
  }));
  check(`★ 시작일이 영업 시작일 (${range.start})`, range.start === OPEN_DAY, `${range.start} vs ${OPEN_DAY}`);
  check(`★ 종료일이 오늘 (${range.end})`, range.end === TODAY, `${range.end} vs ${TODAY}`);
  // 1,000 + 2,000 + 3,000 = 6,000. 영업 시작 전의 90,000 은 안 들어간다.
  check("★★ 영업 시작 뒤 매출만 합친다 (6,000)", /6,000/.test(range.revenue), range.revenue);
  check("★★ 영업 시작 전 90,000 이 안 섞인다", !/96,000|90,000/.test(range.revenue), range.revenue);
  check("기간이 그대로 적힌다", range.sub.includes(OPEN_DAY) && range.sub.includes(TODAY), range.sub);

  out.push("\n[화면이 시작일을 지어내지 않는다]");
  // 서버가 내려준 값을 쓰는지 확인. 화면이 임의로 「아주 옛날」을 잡으면
  // 영업 전 날짜들이 0 으로 줄줄이 붙는다.
  const fromServer = await page.evaluate(async () => (await (await fetch("/api/settlements")).json()).all_time_start);
  check("★ 서버가 시작일을 내려준다", fromServer === "2026-09-08", String(fromServer));
  check("★ 버튼이 그 값을 그대로 쓴다", range.start === fromServer, `${range.start} vs ${fromServer}`);

  out.push("\n[다른 기간 버튼은 그대로다]");
  await page.locator("#settlementTodayBtn").click();
  await page.waitForTimeout(1500);
  const todayOnly = await page.evaluate(() => ({
    start: document.querySelector("#settlementStartDate").value,
    end: document.querySelector("#settlementEndDate").value,
  }));
  check("오늘 버튼은 오늘 하루", todayOnly.start === TODAY && todayOnly.end === TODAY, JSON.stringify(todayOnly));

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  await browser.close();
  server.close();
  process.exit(fail === 0 ? 0 : 1);
})();
