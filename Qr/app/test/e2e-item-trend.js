// 메뉴 하나를 골라 날짜별 판매 추이를 본다.
//
// 사장님(2026-09-11): "각 메뉴가 결산 날에 따라 팔리는 추이를 그래프로
// 라인차트를 각 메뉴별로 선택하면 볼 수 있게 하면 좋을 것 같은데?"
//
// ── 이 파일이 지키는 것 ──────────────────────────────────────────────
//
//   1. **안 팔린 날이 0 으로 보인다.** 그날을 빼고 보내면 선이 그 구간을
//      건너뛰어서, 「그날은 0개」가 「그날은 없던 날」처럼 그려진다. 추이를
//      보는 이유가 안 나간 구간을 찾는 것인데 그게 안 보이면 소용이 없다.
//   2. **고른 메뉴의 것만 나온다.** 같은 날 다른 메뉴가 잔뜩 팔렸어도.
//   3. **직원은 못 본다.** 여러 날에 걸친 것이라 직원 결산(오늘 하루)과
//      어긋난다.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-item-trend";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.STAFF_PASSWORD = "staffpass123";
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

// 5일치. 가운데 하루(09-11)는 이 메뉴가 한 개도 안 나간 날이다 — 선이
// 거기서 0 으로 내려가야 한다.
const DAYS = ["2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"];
const QTY = { "2026-09-09": 3, "2026-09-10": 7, "2026-09-11": 0, "2026-09-12": 5, "2026-09-13": 2 };

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
  const target = store.menuItems[0];   // 추이를 볼 메뉴
  const other = store.menuItems[1];    // 같은 날 같이 팔리는 다른 메뉴
  const rows = [];
  let id = 830000;
  DAYS.forEach((d, di) => {
    if (QTY[d] > 0) {
      rows.push(mk(++id, d, target, QTY[d], "12:0" + di));
    }
    // 다른 메뉴는 매일 팔린다 — 고른 메뉴 것만 나오는지 보려고.
    rows.push(mk(++id, d, other, 9, "13:0" + di));
  });
  function mk(oid, date, mi, qty, hm) {
    return {
      _id: oid, id: oid, table_number: "1", status: "paid", order_type: "dine_in",
      created_at: `${date} ${hm}:00`, paid_at: `${date} ${hm}:30`, updated_at: `${date} ${hm}:30`,
      payment_method: "cash", party_size: 2, party_adults: 2, party_children: 0,
      subtotal: mi.price * qty, discount_amount: 0, discount_type: null, total: mi.price * qty,
      items: [{
        item_id: mi.id, code: mi.code, name_ko: mi.name_ko, name_zh: mi.name_zh, name_en: mi.name_en,
        qty, unit_price: mi.price, selected_addons: [], option_choice: null, spice_choice: null,
        category_key: null, order_type: "dine_in", paid: true, payment_method: "cash",
        paid_at: `${date} ${hm}:30`, note: "",
      }],
      account_id: null, note: "",
    };
  }
  await getDb().collection("orders").bulkWrite(rows.map((r) => ({ replaceOne: { filter: { _id: r.id }, replacement: r, upsert: true } })));
  store.settings.service_started_at = "2026-09-08 17:00:00";
  await save();

  await page.locator('.admin-tabs button[data-tab="settlement"]').click();
  await page.waitForTimeout(900);
  await page.fill("#settlementStartDate", DAYS[0]);
  await page.fill("#settlementEndDate", DAYS[DAYS.length - 1]);
  await page.waitForTimeout(1800);

  out.push("[메뉴별 추이 탭을 연다]");
  await page.locator('.stl-tab[data-pane="whenItemTrend"]').first().click();
  await page.waitForTimeout(1400);

  const sel = await page.evaluate(() => {
    const s = document.querySelector("#settlementItemTrendSelect");
    return { count: s.options.length, first: s.options[0].textContent.trim(), value: s.value };
  });
  check("메뉴를 고를 수 있다", sel.count >= 5, JSON.stringify(sel));
  check("★ 많이 팔린 것이 위에 온다", sel.first.includes(other.name_ko) || sel.first.includes(other.name_zh),
    `${sel.first} (기대: ${other.name_ko})`);
  check("옆에 수량도 적힌다", /\(\d+/.test(sel.first), sel.first);

  out.push("\n[고른 메뉴의 날짜별 수량이 나온다]");
  await page.selectOption("#settlementItemTrendSelect", String(target.id));
  await page.waitForTimeout(1300);
  const chart = await page.evaluate(() => {
    const c = window.Chart && Chart.getChart ? Chart.getChart(document.querySelector("#settlementItemTrendChart")) : null;
    if (!c) return null;
    return { type: c.config.type, labels: c.data.labels, data: c.data.datasets[0].data };
  });
  check("★ 선 그래프다", chart && chart.type === "line", JSON.stringify(chart && chart.type));
  check(`★ 날짜가 ${DAYS.length}개 다 있다 (안 팔린 날 포함)`, chart && chart.labels.length === DAYS.length,
    JSON.stringify(chart && chart.labels));
  check("★ 날마다 수량이 맞다", chart && JSON.stringify(chart.data) === JSON.stringify(DAYS.map((d) => QTY[d])),
    JSON.stringify(chart && chart.data));
  // ★★ 이 한 줄이 이 기능의 핵심이다.
  check("★★ 한 개도 안 나간 날이 0 으로 찍힌다", chart && chart.data[2] === 0, JSON.stringify(chart && chart.data));
  check("★ 다른 메뉴 것이 안 섞인다 (매일 9개씩 팔린 메뉴)", chart && !chart.data.includes(9),
    JSON.stringify(chart && chart.data));
  const total = await page.evaluate(() => (document.querySelector("#settlementItemTrendTotal") || {}).textContent || "");
  check("기간 합계가 적힌다 (3+7+0+5+2=17)", /17/.test(total), total);

  out.push("\n[하루만 고르면 그렇다고 말해준다]");
  await page.fill("#settlementStartDate", DAYS[1]);
  await page.fill("#settlementEndDate", DAYS[1]);
  await page.waitForTimeout(1600);
  const oneDay = await page.evaluate(() => ({
    note: (document.querySelector("#settlementItemTrendNote") || {}).textContent || "",
    points: (Chart.getChart(document.querySelector("#settlementItemTrendChart")) || { data: { labels: [] } }).data.labels.length,
  }));
  check("★ 점 하나뿐일 때 안내가 뜬다", /하루만|최근 7일|一天/.test(oneDay.note), oneDay.note);
  check("빈 그래프로 두지 않는다", oneDay.points === 1, String(oneDay.points));

  {
    const fs = require("fs");
    const path = require("path");
    const dir = path.join(__dirname, "..", "..", "..", "_screens");
    fs.mkdirSync(dir, { recursive: true });
    await page.fill("#settlementStartDate", DAYS[0]);
    await page.fill("#settlementEndDate", DAYS[DAYS.length - 1]);
    await page.waitForTimeout(1600);
    await page.locator('div.stl-pane[data-pane="whenItemTrend"]').screenshot({ path: path.join(dir, "item-trend.png") });
  }

  out.push("\n[직원은 못 본다]");
  const staffSees = await page.evaluate(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "staffpass123" }) });
    const r = await fetch("/api/settlements/item-trend?item_id=1&start=2026-09-09&end=2026-09-13");
    let body = {};
    try { body = await r.json(); } catch (e) { body = {}; }
    return { status: r.status, hasPoints: Array.isArray(body.points) };
  });
  check("★ 직원 세션은 거절된다", staffSees.status === 401 || staffSees.status === 403, String(staffSees.status));
  check("★ 자료가 실려 나가지 않는다", staffSees.hasPoints === false, JSON.stringify(staffSees));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1300);
  await page.locator('.admin-tabs button[data-tab="settlement"]').click();
  await page.waitForTimeout(1200);
  check("★ 직원 화면에는 탭이 안 보인다", await page.evaluate(() => {
    const t = document.querySelector('.stl-tab[data-pane="whenItemTrend"]');
    return !t || t.offsetParent === null;
  }));

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  await browser.close();
  server.close();
  process.exit(fail === 0 ? 0 : 1);
})();
