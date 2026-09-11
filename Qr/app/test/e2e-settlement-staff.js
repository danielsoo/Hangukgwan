// 직원 계정으로 결산 탭을 실제로 열어본다.
//
// 사장님(2026-09-11): "결산은 현재 사장만 볼 수 있는데 직원이 볼 수 있는 건
// 결산탭에서 해당 하루만 볼 수 있게 해주고 지난 정산 추이처럼 전 데이터를
// 읽어오는 건 직원은 못 보게 해줘."
//
// 단위 테스트(settlement-staff-today-only.test.js)는 서버가 지난 날짜를
// 못 박는지를 본다. 여기서 보는 것은 그 다음이다 — **직원이 눌러서 실제로
// 열리는가, 그리고 열린 화면에 지난 날로 가는 길이 남아 있지 않은가.**
// 탭이 안 열리면 서버가 아무리 열려 있어도 직원에게는 없는 기능이고,
// 날짜 칸이 남아 있으면 막아둔 곳을 화면이 도로 열어준다.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "settlement-staff";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.STAFF_PASSWORD = "staffpass123";
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
const PAST = "2026-08-01";

(async () => {
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.on("dialog", (d) => d.dismiss());

  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await connectDB();
  const items = store.menuItems;
  // 오늘 1,000 한 건, 지난달 9,999 한 건. 숫자를 멀리 떼어 놓아야 「섞였는가」를
  // 큰 숫자 하나로 바로 볼 수 있다.
  const mk = (id, date, total) => {
    const mi = items[id % items.length];
    return {
      _id: id, id, table_number: String(id % 5 + 1), status: "paid", order_type: "dine_in",
      created_at: `${date} 12:00:00`, paid_at: `${date} 12:30:00`, updated_at: `${date} 12:30:00`,
      payment_method: "cash", party_size: 2, party_adults: 2, party_children: 0,
      subtotal: total, discount_amount: 0, discount_type: null, total,
      items: [{
        item_id: mi.id, code: mi.code, name_ko: mi.name_ko, name_zh: mi.name_zh, name_en: mi.name_en,
        qty: 1, unit_price: total, selected_addons: [], option_choice: null, spice_choice: null,
        category_key: (store.categories.find((c) => c.id === mi.category_id) || {}).key || null,
        order_type: "dine_in", paid: true, payment_method: "cash", paid_at: `${date} 12:30:00`, note: "",
      }],
      account_id: null, note: "",
    };
  };
  const rows = [mk(710001, TODAY, 1000), mk(710002, PAST, 9999)];
  await getDb().collection("orders").bulkWrite(rows.map((r) => ({ replaceOne: { filter: { _id: r.id }, replacement: r, upsert: true } })));
  store.settings.service_started_at = "2026-07-01 00:00:00";
  await save();

  await page.evaluate(async () => {
    await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "staffpass123" }) });
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  check("직원으로 들어와 있다", await page.evaluate(() => document.body.classList.contains("role-staff")));

  out.push("[결산 탭이 직원에게도 열린다]");
  const tab = page.locator('.admin-tabs button[data-tab="settlement"]');
  check("탭 버튼이 보인다", await tab.isVisible());
  await tab.click();
  await page.waitForTimeout(1600);
  const vis = (sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    return !!el && !el.hidden && getComputedStyle(el).display !== "none" && el.offsetParent !== null;
  }, sel);
  check("★ 결산 화면이 열린다", await page.evaluate(() => !document.querySelector("#tab-settlement").hidden));

  const revenue = await page.evaluate(() => (document.querySelector("#settlementRevenue") || {}).textContent || "");
  check("★ 오늘 매출만 보인다 (1,000)", /1,000/.test(revenue) && !/10,999/.test(revenue), revenue);

  out.push("\n[지난 날로 가는 길이 화면에 없다]");
  check("★ 시작일 칸이 없다", (await vis("#settlementStartDate")) === false);
  check("★ 종료일 칸이 없다", (await vis("#settlementEndDate")) === false);
  check("★ 최근 7일 버튼이 없다", (await vis("#settlementWeekBtn")) === false);
  check("★ 최근 30일 버튼이 없다", (await vis("#settlementMonthBtn")) === false);
  check("★ CSV 내려받기가 없다", (await vis("#settlementCsvBtn")) === false);
  check("★ 정산 기록 저장이 없다", (await vis("#settlementCloseBtn")) === false);
  check("★ 지난 정산 기록 사이드바가 없다", (await vis("#settlementHistoryList")) === false);
  check("★ 지난 정산 추이 차트가 없다", (await vis("#settlementHistoryChart")) === false);

  out.push("\n[무엇을 보고 있는지는 적혀 있다]");
  const todayLine = await page.evaluate(() => (document.querySelector("#settlementTodayOnly") || {}).textContent || "");
  check("오늘 날짜가 적힌다", todayLine.includes(TODAY), todayLine);
  check("「오늘 하루만」이라고 적힌다", /오늘|今日/.test(todayLine), todayLine);

  out.push("\n[매출을 가르는 것은 직원도 쓴다]");
  // 오전/오후 칸은 그날 하루 안의 이야기라 막을 이유가 없다.
  check("오전 칸이 있다", await vis("#settlementAmBox"));
  await page.locator("#settlementAmBox").click();
  await page.waitForTimeout(1200);
  check("눌러도 화면이 살아 있다", await page.evaluate(() => !document.querySelector("#tab-settlement").hidden));

  out.push("\n[막힌 길로 돌아가지 않는다]");
  // 화면에 길이 없어도 서버가 열려 있으면 소용없다 — 직접 물어본다.
  // 사장님(2026-09-11): "직원 로그인으로는 쳐도 안나오게 해줘."
  const direct = await page.evaluate(async (past) => {
    const r = await fetch(`/api/settlements?start=${past}&end=2026-12-31`);
    const j = await r.json();
    const o = await fetch(`/api/orders/history?start=${past}&end=2026-12-31`);
    const oj = await o.json();
    const h = await fetch("/api/settlements/history");
    return {
      status: r.status, revenue: j.total_revenue, error: j.error,
      ordersStatus: o.status, ordersIsList: Array.isArray(oj) || Array.isArray(oj.orders),
      historyStatus: h.status,
    };
  }, PAST);
  check("★ 주소로 쳐 넣어도 거절된다", direct.status === 403, JSON.stringify(direct));
  check("★ 숫자가 하나도 안 실려 나간다", direct.revenue === undefined, JSON.stringify(direct.revenue));
  check("거절 이유를 알려준다", direct.error === "today_only", String(direct.error));
  check("★ 지난 주문 목록도 거절된다", direct.ordersStatus === 403, String(direct.ordersStatus));
  check("★ 주문이 하나도 안 실려 나간다", direct.ordersIsList === false, String(direct.ordersIsList));
  check("★ 지난 정산 기록은 막혀 있다", direct.historyStatus === 401 || direct.historyStatus === 403, String(direct.historyStatus));

  // 그런데 직원 화면 자체는 멀쩡히 돌아간다 — 거절당하는 길로 아예 안 간다.
  const netFails = await page.evaluate(async () => {
    const r = await fetch("/api/settlements");
    return { status: r.status, revenue: (await r.json()).total_revenue };
  });
  check("직원 화면이 쓰는 길은 200", netFails.status === 200 && netFails.revenue === 1000, JSON.stringify(netFails));

  out.push("\n[사장님 화면은 그대로다]");
  await page.evaluate(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "ownerpass123" }) });
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.locator('.admin-tabs button[data-tab="settlement"]').click();
  await page.waitForTimeout(1600);
  check("사장님에게는 시작일 칸이 있다", await vis("#settlementStartDate"));
  check("사장님에게는 정산 기록 사이드바가 있다", await vis("#settlementHistoryList"));
  check("사장님 화면에는 「오늘만」 줄이 없다", (await vis("#settlementTodayOnly")) === false);
  await page.fill("#settlementStartDate", PAST);
  await page.fill("#settlementEndDate", TODAY);
  await page.waitForTimeout(1600);
  const ownerRevenue = await page.evaluate(() => (document.querySelector("#settlementRevenue") || {}).textContent || "");
  check("★ 사장님은 지난달까지 본다", /10,999/.test(ownerRevenue), ownerRevenue);

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  await browser.close();
  server.close();
  process.exit(fail === 0 ? 0 : 1);
})();
