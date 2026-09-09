// 결산 화면이 눈에 들어오는가 — 위계, 막대, 탭, 접기.
//
// 2026-09-10 사장님: "지금 사실 결산 탭 보는 게 너무 복잡해. 눈에 딱
// 들어오지도 않고 뭔가 체계적이지 못한 것 같아. ui 적으로."
//
// 항목을 요청받을 때마다 카드와 표를 아래로 붙여서 화면이 5,000픽셀이
// 넘었고, 매출과 "평균 테이블 회전 시간"이 같은 크기로 나란히 있었다.
// 40줄짜리 품목표가 화면 절반을 먹어 나머지는 전부 스크롤 밖이었다.
//
// "보기 좋다"는 잴 수 없지만, 그 원인들은 잴 수 있다 — 화면 길이, 가장 큰
// 숫자가 무엇인지, 한 번에 몇 줄을 보여주는지, 문제가 없을 때 경고가
// 사라지는지.
const path = require("path");
const fs = require("fs");

const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "settlement-ui";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const { chromium } = require("playwright");
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
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.on("dialog", (d) => d.dismiss());
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "ownerpass123" }) });
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  // 실제 하루치를 만든다 — 결제수단 다섯 가지, 매장/포장, 할인, 취소.
  await connectDB();
  const items = store.menuItems;
  const methods = ["cash", "cash", "cash", "linepay", "card", "card", "other", "online"];
  const rows = [];
  for (let i = 0; i < 80; i++) {
    const m = methods[i % methods.length];
    const its = [0, 1, 2].slice(0, 1 + (i % 3)).map((k) => {
      const mi = items[(i * 3 + k) % items.length];
      return { item_id: mi.id, code: mi.code, name_ko: mi.name_ko, name_zh: mi.name_zh, name_en: mi.name_en,
        qty: 1 + (k % 2), unit_price: mi.price, selected_addons: [], option_choice: null, spice_choice: null,
        category_key: (store.categories.find((c) => c.id === mi.category_id) || {}).key || null,
        order_type: i % 5 === 0 ? "takeout" : "dine_in", paid: true, payment_method: m, note: "" };
    });
    const subtotal = its.reduce((a, x) => a + x.unit_price * x.qty, 0);
    const disc = i % 7 === 0 ? Math.round(subtotal * 0.1) : 0;
    rows.push({ _id: 600000 + i, id: 600000 + i, table_number: String((i % 38) + 1),
      status: i % 17 === 0 ? "cancelled" : "paid", order_type: i % 5 === 0 ? "takeout" : "dine_in",
      created_at: `${D} ${String(11 + (i % 10)).padStart(2, "0")}:${String((i * 7) % 60).padStart(2, "0")}:00`,
      paid_at: `${D} ${String(12 + (i % 9)).padStart(2, "0")}:00:00`, payment_method: m,
      party_size: 1 + (i % 5), subtotal, discount_amount: disc, discount_type: disc ? "vip10" : null,
      total: subtotal - disc, items: its, account_id: null, note: "" });
  }
  await getDb().collection("orders").bulkWrite(rows.map((r) => ({ replaceOne: { filter: { _id: r.id }, replacement: r, upsert: true } })));
  store.settings.service_started_at = "2026-09-08 17:00:00";
  await save();

  await page.locator('.admin-tabs button[data-tab="settlement"]').click();
  await page.waitForTimeout(900);
  await page.fill("#settlementStartDate", D);
  await page.fill("#settlementEndDate", D);
  await page.waitForTimeout(1400);

  out.push("[한 화면에 들어오는가]");
  const height = await page.evaluate(() => document.querySelector("#tab-settlement").scrollHeight);
  // 고치기 전에는 5,000픽셀이 넘었다. 정확한 숫자를 못 박기보다, 다시
  // 아래로 무한정 늘어나는 것을 막는 선을 둔다.
  check("화면이 2,600픽셀을 넘지 않는다", height <= 2600, `${height}px`);

  out.push("\n[가장 큰 숫자가 매출인가]");
  const sizes = await page.evaluate(() => {
    const px = (sel) => {
      const el = document.querySelector(sel);
      return el ? parseFloat(getComputedStyle(el).fontSize) : 0;
    };
    return {
      revenue: px("#settlementRevenue"),
      guests: px("#settlementGuests"),
      turnover: px("#settlementTurnover"),
      blockTitle: px(".stl-block-title"),
    };
  });
  check("매출이 손님 수보다 확실히 크다", sizes.revenue >= sizes.guests * 1.8, JSON.stringify(sizes));
  check("매출이 회전 시간보다 확실히 크다", sizes.revenue >= sizes.turnover * 1.8, JSON.stringify(sizes));
  check("매출이 블록 제목보다 크다", sizes.revenue > sizes.blockTitle, JSON.stringify(sizes));
  check("매출 숫자가 실제로 크다(35px 이상)", sizes.revenue >= 35, `${sizes.revenue}px`);

  out.push("\n[막대가 실제로 그려지는가]");
  // span 은 인라인이라 height/width 가 안 먹는다 — 처음에 이걸 빠뜨려서
  // 회색 트랙만 보였다. 차트 라이브러리 없이도 보여야 하는 부분이라 잰다.
  const bars = await page.evaluate(() => {
    const fills = [...document.querySelectorAll("#settlementPaymentMethodBars .stl-bar-fill")];
    return fills.map((f) => f.getBoundingClientRect().width);
  });
  check("결제수단 막대가 여러 개 있다", bars.length >= 4, `${bars.length}개`);
  check("막대에 실제 너비가 있다", bars.every((w) => w > 2), JSON.stringify(bars.map((w) => Math.round(w))));
  check("큰 값의 막대가 더 길다", bars[0] > bars[bars.length - 1], JSON.stringify(bars.map((w) => Math.round(w))));

  out.push("\n[숫자가 서로 맞는가]");
  const total = await page.locator("#settlementPaymentMethodTotal").innerText();
  const revenue = await page.locator("#settlementRevenue").innerText();
  check("결제수단 총합이 매출과 같다", total === revenue, `${total} vs ${revenue}`);
  check("맞다는 것을 화면이 말해준다",
    (await page.locator("#settlementReconcileNote").innerText()).includes("일치"));

  out.push("\n[품목표가 화면을 먹지 않는가]");
  const shown = await page.evaluate(() => {
    document.querySelector('[data-pane="soldItems"]').hidden = false;
    return document.querySelectorAll("#settlementItemsBody tr").length;
  });
  check("처음에는 10줄만 보여준다", shown === 10, `${shown}줄`);
  await page.locator('.stl-tab[data-pane="soldItems"]').click();
  await page.waitForTimeout(300);
  check("전체 보기 버튼이 있다", await page.locator("#settlementItemsMore").isVisible());
  await page.locator("#settlementItemsMore").click();
  await page.waitForTimeout(300);
  const expanded = await page.evaluate(() => document.querySelectorAll("#settlementItemsBody tr").length);
  check("누르면 전부 펼쳐진다", expanded > 20, `${expanded}줄`);
  await page.locator("#settlementItemsMore").click();
  await page.waitForTimeout(300);
  check("다시 누르면 접힌다",
    (await page.evaluate(() => document.querySelectorAll("#settlementItemsBody tr").length)) === 10);

  out.push("\n[탭이 갈아 끼워지는가]");
  await page.locator('.stl-tab[data-pane="soldCategory"]').click();
  await page.waitForTimeout(200);
  check("분류별로 돌아온다", await page.locator('[data-pane="soldCategory"].stl-pane').isVisible());
  check("품목별은 숨는다", !(await page.locator('[data-pane="soldItems"].stl-pane').isVisible()));
  await page.locator('.stl-tab[data-pane="whenTable"]').click();
  await page.waitForTimeout(200);
  check("테이블별로 바뀐다", await page.locator('[data-pane="whenTable"].stl-pane').isVisible());
  check("다른 묶음의 탭은 안 건드린다", await page.locator('[data-pane="soldCategory"].stl-pane').isVisible());

  out.push("\n[챙길 것이 있을 때만 띠가 뜬다]");
  check("취소가 있으니 띠가 보인다", await page.locator("#settlementAlerts").isVisible());
  const alertText = await page.locator("#settlementAlerts").innerText();
  check("띠에 금액이 같이 나온다", /NT\$/.test(alertText), alertText);

  const shots = path.join(__dirname, "..", "..", "..", "_screens");
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, "settlement-redesigned.png"), fullPage: true });

  // 아무 일 없는 날 — 띠가 통째로 사라져야 한다. "0건"을 매일 보여주면
  // 그 자리가 배경이 되어, 정작 숫자가 생긴 날에도 눈에 안 들어온다.
  await page.fill("#settlementStartDate", "2026-09-01");
  await page.fill("#settlementEndDate", "2026-09-01");
  await page.waitForTimeout(1200);
  check("기록 없는 날에는 띠가 사라진다", !(await page.locator("#settlementAlerts").isVisible()));
  check("할인 묶음도 사라진다", !(await page.locator("#settlementDiscountBlock").isVisible()));
  check("빈 목록에는 안내 문구가 나온다",
    (await page.locator("#settlementPaymentMethodBars").innerText()).includes("기록이 없어요"));

  await browser.close();
  server.close();
  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.log(out.join("\n"));
  console.error("HARNESS ERROR:", e.message, e.stack);
  process.exit(1);
});
