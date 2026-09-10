// 결산 그래프가 진짜로 그려지는가 — 픽셀을 센다.
//
// 사장님(2026-09-10): "여기도 볼 수 있게 해줘. 지금은 비어있어."
//
// 「Chart 가 있다」와 「화면에 그래프가 보인다」는 다른 말이다. 그 사이에
// 캔버스 크기 0, 숨겨진 칸, 빈 데이터가 있다. 그래서 여기서는 캔버스에
// 실제로 칠해진 점이 있는지 센다 — 하나도 안 칠해져 있으면 사장님 눈에
// 보이는 것은 빈 상자다.
//
// 이 테스트가 가능해진 것도 파일을 우리 서버로 옮긴 덕이다. 바깥 CDN 을
// 부르던 동안에는 시험 환경에 바깥 인터넷이 없어서 무엇을 재도 「빈칸」이
// 나왔고, 그래서 아무도 이 고장을 못 잡았다.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "settlement-charts";
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

// 캔버스에 칠해진(=배경이 아닌) 점의 수. 0 이면 빈 상자다.
const ink = (page, sel) =>
  page.evaluate((s) => {
    const c = document.querySelector(s);
    if (!c || !c.width || !c.height) return { w: c ? c.width : 0, h: c ? c.height : 0, ink: 0 };
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 8) n++;
    return { w: c.width, h: c.height, ink: n };
  }, sel);

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
  await page.waitForTimeout(1200);

  out.push("[그래프 파일이 우리 서버에서 나간다]");
  const lib = await page.evaluate(() => ({
    chart: typeof Chart,
    src: [...document.querySelectorAll("script[src]")].map((s) => s.getAttribute("src")).filter((s) => /chart/i.test(s)),
  }));
  check("★ Chart 가 만들어졌다", lib.chart === "function", lib.chart);
  check("★ 우리 주소에서 왔다", lib.src.length === 1 && lib.src[0].startsWith("/js/chart.umd.min.js"), JSON.stringify(lib.src));
  // ?v= 지문이 붙어야 배포한 날 태블릿이 옛 파일을 안 붙든다.
  check("배포 지문이 붙어 있다", /\?v=/.test(lib.src[0] || ""), lib.src[0]);

  // 하루치를 심는다 — 시간대가 흩어져 있어야 시간대 그래프가 의미가 있다.
  await connectDB();
  const items = store.menuItems;
  const rows = [];
  for (let i = 0; i < 40; i++) {
    const mi = items[i % items.length];
    const hour = 11 + (i % 9);
    const total = 300 + (i % 7) * 120;
    rows.push({
      _id: 800000 + i, id: 800000 + i, table_number: String((i % 30) + 1), status: "paid",
      order_type: "dine_in", created_at: `${D} ${String(hour).padStart(2, "0")}:${String((i * 11) % 60).padStart(2, "0")}:00`,
      paid_at: `${D} ${String(hour).padStart(2, "0")}:50:00`, updated_at: `${D} ${String(hour).padStart(2, "0")}:50:00`,
      payment_method: "cash", party_size: 2, party_adults: 2, party_children: 0,
      subtotal: total, discount_amount: 0, discount_type: null, total,
      items: [{ item_id: mi.id, code: mi.code, name_ko: mi.name_ko, name_zh: mi.name_zh, name_en: mi.name_en,
        qty: 1, unit_price: total, selected_addons: [], option_choice: null, spice_choice: null,
        category_key: (store.categories.find((c) => c.id === mi.category_id) || {}).key || null,
        order_type: "dine_in", paid: true, payment_method: "cash", paid_at: `${D} ${hour}:50:00`, note: "" }],
      account_id: null, note: "",
    });
  }
  await getDb().collection("orders").bulkWrite(rows.map((r) => ({ replaceOne: { filter: { _id: r.id }, replacement: r, upsert: true } })));
  store.settings.service_started_at = "2026-09-08 17:00:00";
  await save();

  await page.locator('.admin-tabs button[data-tab="settlement"]').click();
  await page.waitForTimeout(900);
  await page.fill("#settlementStartDate", D);
  await page.fill("#settlementEndDate", D);
  await page.waitForTimeout(1600);

  out.push("\n[★★ 시간대별 그래프에 실제로 점이 칠해진다]");
  const hourly = await ink(page, "#settlementHourlyChart");
  check("캔버스에 크기가 있다", hourly.w > 100 && hourly.h > 50, JSON.stringify(hourly));
  check("★ 빈 상자가 아니다", hourly.ink > 500, JSON.stringify(hourly));
  check("못 그렸다는 문구는 없다", (await page.locator(".stl-chart-missing").count()) === 0, "");

  out.push("\n[품목 그래프]");
  await page.locator('.stl-tab[data-pane="soldItems"]').click();
  await page.waitForTimeout(1200);
  const soldItems = await ink(page, "#settlementItemsChart");
  check("★ 빈 상자가 아니다", soldItems.ink > 500, JSON.stringify(soldItems));

  out.push("\n[매출 추이 그래프]");
  await page.locator('.stl-tab[data-pane="whenTrend"]').click();
  await page.waitForTimeout(1200);
  const trend = await ink(page, "#settlementTrendChart");
  check("★ 빈 상자가 아니다", trend.ink > 300, JSON.stringify(trend));

  out.push("\n[★ 오전만 보기로 가도 그래프가 따라온다]");
  // 걸러진 결산에서도 그래프가 다시 그려져야 한다. 여기서 빈칸이 되면
  // 오전만 보기가 「그래프가 사라지는 버튼」이 된다.
  await page.locator('.stl-tab[data-pane="whenHourly"]').click();
  await page.waitForTimeout(800);
  const amBox = await page.locator("#settlementAmBox").count();
  if (amBox) {
    await page.locator("#settlementAmBox").click();
    await page.waitForTimeout(1600);
    const amHourly = await ink(page, "#settlementHourlyChart");
    check("★ 걸러도 그래프가 그려진다", amHourly.ink > 300, JSON.stringify(amHourly));
  } else {
    check("오전/오후 칸이 있다", false, "칸을 못 찾았다");
  }

  out.push("\n[★★ 파일을 못 받아오면 말을 한다]");
  // 그 하루의 진짜 고장을 그대로 재현한다 — Chart 가 없는 화면.
  const page2 = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page2.on("dialog", (d) => d.dismiss());
  // 파일 요청 자체를 막아 버린다. 404 였던 그날과 같은 상태다.
  await page2.route("**/js/chart.umd.min.js*", (route) => route.abort());
  await page2.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page2.evaluate(async () => {
    await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "ownerpass123" }) });
  });
  await page2.reload({ waitUntil: "networkidle" });
  await page2.waitForTimeout(1200);
  await page2.locator('.admin-tabs button[data-tab="settlement"]').click();
  await page2.waitForTimeout(900);
  await page2.fill("#settlementStartDate", D);
  await page2.fill("#settlementEndDate", D);
  await page2.waitForTimeout(1600);
  const missing = await page2.evaluate(() => {
    const el = document.querySelector("#settlementHourlyChart").closest(".settlement-chart-wrap").querySelector(".stl-chart-missing");
    return { has: !!el, text: el ? el.textContent : "", visible: el ? el.getBoundingClientRect().height > 20 : false };
  });
  check("★ Chart 가 없어도 화면은 산다", typeof (await page2.evaluate(() => document.querySelector("#settlementRevenue").textContent)) === "string", "");
  check("★ 그 자리에 이유가 적힌다", missing.has === true, JSON.stringify(missing));
  check("★ 눈에 보인다", missing.visible === true, JSON.stringify(missing));
  check("빈 문구가 아니다", missing.text.trim().length > 5, missing.text);
  // 숫자 자체는 그대로 나와야 한다 — 그래프를 못 그린 것이지 매출이 없는 게 아니다.
  const rev = await page2.evaluate(() => document.querySelector("#settlementRevenue").textContent);
  check("★ 매출 숫자는 그대로 보인다", /[1-9]/.test(rev), rev);

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  await browser.close();
  server.close();
  process.exit(fail === 0 ? 0 : 1);
})();
