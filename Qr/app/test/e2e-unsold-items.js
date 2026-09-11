// 전체 메뉴가 많이 팔린 순으로 뻗고, 스크롤을 내리면 안 팔린 것이 나오는가.
//
// 사장님(2026-09-11): "전체 메뉴를 막대그래프로 좌에서 우로 뻗는 그 그래프로
// 해서 팔린 횟수를 적어서 스크롤 내리면 안 팔리는 애들이 보일 수 있게 하는
// 게 좋을 것 같아. 결산에 들어가면 될 것 같아."
//
// 계산은 settlement-unsold-items.test.js 가 잰다. 여기서 보는 것은 화면이다 —
// 실제로 좌에서 우로 뻗는가, 안 팔린 것이 아래에 모이는가, 그리고 **이 목록
// 때문에 결산 화면이 다시 길어지지 않는가.** 이 화면은 한 번 너무 길어져서
// 갈아엎은 적이 있다.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-all-menu";
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
  // 세 가지만 판다 — 10개, 4개, 1개. 나머지 수십 가지는 0 이다.
  const PLAN = [
    { mi: store.menuItems[0], qty: 10 },
    { mi: store.menuItems[1], qty: 4 },
    { mi: store.menuItems[2], qty: 1 },
  ];
  const soldOutOne = store.menuItems[6];
  soldOutOne.available = 0;
  await save();

  const rows = PLAN.map((p, i) => ({
    _id: 750001 + i, id: 750001 + i, table_number: String(i + 1), status: "paid", order_type: "dine_in",
    created_at: `${D} 12:0${i}:00`, paid_at: `${D} 12:3${i}:00`, updated_at: `${D} 12:3${i}:00`,
    payment_method: "cash", party_size: 2, party_adults: 2, party_children: 0,
    subtotal: p.mi.price * p.qty, discount_amount: 0, discount_type: null, total: p.mi.price * p.qty,
    items: [{
      item_id: p.mi.id, code: p.mi.code, name_ko: p.mi.name_ko, name_zh: p.mi.name_zh, name_en: p.mi.name_en,
      qty: p.qty, unit_price: p.mi.price, selected_addons: [], option_choice: null, spice_choice: null,
      category_key: null, order_type: "dine_in", paid: true, payment_method: "cash",
      paid_at: `${D} 12:3${i}:00`, note: "",
    }],
    account_id: null, note: "",
  }));
  await getDb().collection("orders").bulkWrite(rows.map((r) => ({ replaceOne: { filter: { _id: r.id }, replacement: r, upsert: true } })));
  store.settings.service_started_at = "2026-09-08 17:00:00";
  await save();

  await page.locator('.admin-tabs button[data-tab="settlement"]').click();
  await page.waitForTimeout(900);
  await page.fill("#settlementStartDate", D);
  await page.fill("#settlementEndDate", D);
  await page.waitForTimeout(1700);

  const heightBefore = await page.evaluate(() => document.querySelector("#tab-settlement").scrollHeight);

  out.push("[전체 메뉴 탭을 연다]");
  await page.locator('.stl-tab[data-pane="allMenu"]').first().click();
  await page.waitForTimeout(700);

  const read = () =>
    page.evaluate(() => {
      const wrap = document.querySelector("#settlementAllMenu");
      const rows = [...wrap.querySelectorAll(".stl-menu-row")];
      const trackW = rows.length ? rows[0].querySelector(".stl-menu-track").getBoundingClientRect().width : 0;
      return {
        head: (document.querySelector("#settlementAllMenuHead") || {}).textContent || "",
        count: rows.length,
        rows: rows.map((r) => {
          const fill = r.querySelector(".stl-menu-fill");
          return {
            name: r.querySelector(".stl-menu-name").textContent.trim(),
            qty: r.querySelector(".stl-menu-qty").textContent.trim(),
            fill: fill ? Math.round((fill.getBoundingClientRect().width / trackW) * 100) : 0,
            zero: r.classList.contains("is-zero"),
          };
        }),
        scrollH: wrap.scrollHeight,
        clientH: wrap.clientHeight,
      };
    });

  const m = await read();
  check("메뉴가 통째로 나온다", m.count === store.menuItems.length, `${m.count} vs ${store.menuItems.length}`);
  check("★ 맨 위가 제일 많이 팔린 것", m.rows[0].name.startsWith(PLAN[0].mi.name_ko), m.rows[0].name);
  check("★ 수량이 적혀 있다", /10/.test(m.rows[0].qty), m.rows[0].qty);
  check("★ 막대가 좌에서 우로 뻗는다 (1등이 꽉)", m.rows[0].fill >= 98, String(m.rows[0].fill));
  check("★ 4개짜리는 그만큼만", Math.abs(m.rows[1].fill - 40) <= 3, `${m.rows[1].fill}% (기대 40%)`);
  check("★ 1개짜리는 더 짧게", m.rows[2].fill > 0 && m.rows[2].fill < 20, String(m.rows[2].fill));

  out.push("\n[스크롤을 내리면 안 팔린 것들이 있다]");
  check("★ 맨 아래는 0 이다", m.rows[m.rows.length - 1].zero === true && /^0/.test(m.rows[m.rows.length - 1].qty),
    JSON.stringify(m.rows[m.rows.length - 1]));
  check("★ 팔린 셋은 0 이 아니다", m.rows.slice(0, 3).every((r) => !r.zero), JSON.stringify(m.rows.slice(0, 3)));
  check("0 인 줄들이 연달아 뒤에 모여 있다",
    m.rows.findIndex((r) => r.zero) === 3 && m.rows.slice(3).every((r) => r.zero),
    String(m.rows.findIndex((r) => r.zero)));
  check("★ 품절은 따로 표시된다", await page.evaluate(() => !!document.querySelector("#settlementAllMenu .stl-menu-soldout")));
  check("몇 개가 안 팔렸는지 위에 적힌다", /\d+/.test(m.head) && m.head.length > 10, m.head);

  out.push("\n[메뉴가 늘어도 화면은 안 길어진다]");
  // 51줄을 그대로 펼치면 결산 화면이 다시 한없이 길어진다 — 이 화면을
  // 갈아엎은 이유로 도로 돌아간다. 목록은 **제 안에서** 굴러야 한다.
  check("★ 목록은 제 안에서 굴린다", m.scrollH > m.clientH, `${m.scrollH} > ${m.clientH}`);
  check(`★ 메뉴가 ${m.count}개여도 높이는 묶여 있다 (${m.clientH}px)`, m.clientH <= 560, `${m.clientH}px`);
  // 그리고 기본으로 보이는 화면(분류별)은 이 기능이 생기기 전과 같아야 한다.
  await page.locator('.stl-tab[data-pane="soldCategory"]').first().click();
  await page.waitForTimeout(500);
  const heightBack = await page.evaluate(() => document.querySelector("#tab-settlement").scrollHeight);
  check(`★ 기본 화면 높이는 그대로다 (${heightBefore} → ${heightBack})`, Math.abs(heightBack - heightBefore) <= 4,
    `${heightBefore} → ${heightBack}`);
  await page.locator('.stl-tab[data-pane="allMenu"]').first().click();
  await page.waitForTimeout(400);

  {
    const fs = require("fs");
    const path = require("path");
    const dir = path.join(__dirname, "..", "..", "..", "_screens");
    fs.mkdirSync(dir, { recursive: true });
    const box = await page.locator('div.stl-pane[data-pane="allMenu"]').boundingBox();
    if (box) await page.screenshot({ path: path.join(dir, "all-menu-bars.png"), clip: box });
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  await browser.close();
  server.close();
  process.exit(fail === 0 ? 0 : 1);
})();
