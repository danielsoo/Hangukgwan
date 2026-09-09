// 지난 주문을 불러올 수 있는가.
//
// 2026-09-10 사장님: "전에 있던 테이블 그거 불러올 수 있으면 좋겠어. 어느
// 테이블에서 언제 몇시에 뭐를 시켰고 그런 게 다 기록을 하고 있잖아 우리가.
// 그래서 그게 결제완료가 되는 순간 그거 자체로도 저장이 되어서 나중에
// 필요할 때 불러올 수 있게."
//
// 기록은 이미 다 남고 있었다(주문 한 건이 자기 문서로 저장된다 — src/db.js).
// 없던 건 꺼내 보는 길뿐이다. 그래서 이 테스트가 확인하는 건 "저장되는가"가
// 아니라 "몇 달 전 것도 찾아지는가"다 — 화면이 들고 있는 최근 며칠치만
// 뒤지면 그 이상은 영영 못 찾는다.
const path = require("path");
const fs = require("fs");

const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "order-history";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const { chromium } = require("playwright");
const app = require("../server");
const { store, getDb, connectDB, save, RECENT_DAYS } = require("../src/db");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

// 몇 달 전 날짜 — 메모리에는 절대 없는 범위다.
const OLD = "2026-06-15";
const MID = "2026-07-20";

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
  await page.waitForTimeout(1000);

  await connectDB();
  const mk = (id, date, time, table, opts = {}) => Object.assign({
    _id: id, id, table_number: table, status: "paid", order_type: "dine_in",
    created_at: `${date} ${time}:00`, paid_at: `${date} ${time}:00`,
    payment_method: "cash", party_size: 4, total: 1200, discount_amount: 0,
    items: [
      { item_id: 1, code: "11", name_ko: "돌솥비빔밥", name_zh: "石鍋拌飯", name_en: "Bibimbap",
        qty: 2, unit_price: 300, option_choice: "보통", selected_addons: [], payment_method: "cash" },
      { item_id: 2, code: "21", name_ko: "짜장면", name_zh: "炸醬麵", name_en: "Jajangmyeon",
        qty: 2, unit_price: 300, selected_addons: [], payment_method: "cash" },
    ],
    account_id: null, note: "",
  }, opts);

  await getDb().collection("orders").bulkWrite([
    mk(700001, OLD, "12:30", "7"),
    mk(700002, OLD, "19:10", "12"),
    mk(700003, MID, "13:05", "7", { status: "cancelled", total: 600 }),
    mk(700004, MID, "18:40", "COUNTER", {
      pickup_number: 3, customer_name: "박윤수", customer_phone: "0912345678",
      order_type: "takeout", payment_method: "linepay",
      items: [{ item_id: 3, code: "31", name_ko: "부대찌개", name_zh: "部隊鍋", qty: 1, unit_price: 600,
        takeout_choice: "不煮外帶", order_type: "takeout", selected_addons: [], payment_method: "linepay" }],
      total: 600,
    }),
  ].map((r) => ({ replaceOne: { filter: { _id: r.id }, replacement: r, upsert: true } })));
  store.settings.service_started_at = "2026-01-01 00:00:00";
  await save();

  out.push("[메모리에 없는 몇 달 전 주문도 찾아진다]");
  // 이것이 이 기능의 핵심이다 — 화면이 들고 있는 건 최근 며칠치뿐이다.
  const inMemory = store.orders.map((o) => o.id);
  check(`메모리에는 옛 주문이 없다 (최근 ${RECENT_DAYS}일치만 들고 있다)`,
    !inMemory.includes(700001), inMemory.join(","));

  const api = (qs) => page.evaluate(async (q) => {
    const r = await fetch(`/api/orders/history?${q}`);
    return { status: r.status, body: await r.json().catch(() => null) };
  }, qs);

  const june = await api(`start=${OLD}&end=${OLD}`);
  check("6월 주문이 불러와진다", june.status === 200 && june.body.orders.length === 2,
    `${june.status} / ${june.body && june.body.count}`);
  check("최신 것부터 온다", june.body.orders[0].id === 700002, JSON.stringify(june.body.orders.map((o) => o.id)));
  check("무엇을 시켰는지까지 온다",
    june.body.orders[0].items.length === 2 && june.body.orders[0].items[0].name_ko === "돌솥비빔밥",
    JSON.stringify(june.body.orders[0].items.map((i) => i.name_ko)));
  check("몇 시에 시켰는지도 온다", june.body.orders[0].created_at.includes("19:10"));

  out.push("\n[찾는 방법]");
  const table7 = await api(`start=2026-01-01&end=2026-12-31&table=7`);
  check("테이블 번호로 찾는다", table7.body.orders.every((o) => o.table_number === "7") && table7.body.orders.length === 2,
    JSON.stringify(table7.body.orders.map((o) => o.table_number)));
  const byDish = await api(`start=2026-01-01&end=2026-12-31&q=짜장면`);
  check("메뉴 이름으로 찾는다", byDish.body.orders.length === 3, `${byDish.body.count}건`);
  const byZh = await api(`start=2026-01-01&end=2026-12-31&q=部隊鍋`);
  check("중국어 메뉴 이름으로도 찾는다", byZh.body.orders.length === 1 && byZh.body.orders[0].id === 700004,
    JSON.stringify(byZh.body.orders.map((o) => o.id)));
  const byName = await api(`start=2026-01-01&end=2026-12-31&q=박윤수`);
  check("포장 손님 이름으로 찾는다", byName.body.orders.length === 1 && byName.body.orders[0].id === 700004);
  const byCode = await api(`start=2026-01-01&end=2026-12-31&q=31`);
  check("메뉴 번호로도 찾는다", byCode.body.orders.some((o) => o.id === 700004), JSON.stringify(byCode.body.orders.map((o) => o.id)));
  const paidOnly = await api(`start=2026-01-01&end=2026-12-31&status=paid`);
  check("취소된 주문을 걸러낼 수 있다", paidOnly.body.orders.every((o) => o.status === "paid") && paidOnly.body.orders.length === 3,
    `${paidOnly.body.count}건`);
  const cancelled = await api(`start=2026-01-01&end=2026-12-31&status=cancelled`);
  check("취소된 것만 볼 수도 있다", cancelled.body.orders.length === 1 && cancelled.body.orders[0].id === 700003);
  const none = await api(`start=2026-01-01&end=2026-12-31&q=없는메뉴`);
  check("없으면 빈 목록을 준다", none.body.orders.length === 0 && none.status === 200);

  out.push("\n[영업 시작 전 주문은 여기서도 안 나온다]");
  // 결산에서 안 세는 것을 목록에서만 보여주면 두 화면의 숫자가 달라 보인다.
  store.settings.service_started_at = "2026-07-01 00:00:00";
  await save();
  const afterStart = await api(`start=2026-01-01&end=2026-12-31`);
  check("6월(테스트 기간) 주문이 빠진다",
    !afterStart.body.orders.some((o) => o.id === 700001 || o.id === 700002),
    JSON.stringify(afterStart.body.orders.map((o) => o.id)));
  check("7월 주문은 그대로 나온다", afterStart.body.orders.some((o) => o.id === 700004));
  store.settings.service_started_at = "2026-01-01 00:00:00";
  await save();

  out.push("\n[사장님만 볼 수 있다]");
  // 어느 손님이 언제 무엇을 먹었는지가 다 들어 있다.
  const guest = await browser.newContext();
  const gp = await guest.newPage();
  await gp.goto(`${base}/order.html?table=7`, { waitUntil: "domcontentloaded" }).catch(() => {});
  const noAuth = await gp.evaluate(async () => (await fetch("/api/orders/history?start=2026-01-01&end=2026-12-31")).status);
  check("로그인 안 하면 볼 수 없다", noAuth === 401 || noAuth === 403, `${noAuth}`);
  await guest.close();

  out.push("\n[화면에서 실제로 보인다]");
  await page.locator('.admin-tabs button[data-tab="settlement"]').click();
  await page.waitForTimeout(800);
  await page.fill("#settlementStartDate", OLD);
  await page.fill("#settlementEndDate", MID);
  await page.waitForTimeout(1500);
  const rows = page.locator("#settlementOrdersList .stl-order");
  check("목록에 주문이 그려진다", (await rows.count()) === 4, `${await rows.count()}줄`);
  const firstText = await rows.first().innerText();
  check("시간과 테이블이 한 줄에 보인다", /\d\d:\d\d/.test(firstText), firstText.replace(/\n/g, " | "));
  check("무엇을 시켰는지 미리보기가 있다", firstText.includes("부대찌개") || firstText.includes("비빔밥"),
    firstText.replace(/\n/g, " | "));

  // 펼치면 상세가 나온다 — 처음부터 다 펼치면 200건이 벽이 된다.
  check("처음에는 접혀 있다", (await page.locator(".stl-order-body").count()) === 0);
  await rows.first().locator(".stl-order-head").click();
  await page.waitForTimeout(300);
  check("누르면 펼쳐진다", (await page.locator(".stl-order-body").count()) === 1);
  const body = await page.locator(".stl-order-body").first().innerText();
  check("품목과 금액이 나온다", /NT\$/.test(body), body.replace(/\n/g, " | "));
  check("결제수단·상태가 나온다", body.includes("결제") && body.includes("상태"), body.replace(/\n/g, " | "));
  await rows.first().locator(".stl-order-head").click();
  await page.waitForTimeout(300);
  check("다시 누르면 접힌다", (await page.locator(".stl-order-body").count()) === 0);

  // 화면에서 찾기
  await page.fill("#settlementOrderTable", "7");
  await page.locator("#settlementOrderSearchBtn").click();
  await page.waitForTimeout(900);
  check("화면에서 테이블 번호로 좁힌다", (await rows.count()) === 2, `${await rows.count()}줄`);
  await page.fill("#settlementOrderTable", "");
  await page.fill("#settlementOrderSearch", "박윤수");
  await page.locator("#settlementOrderSearchBtn").click();
  await page.waitForTimeout(900);
  check("화면에서 이름으로 찾는다", (await rows.count()) === 1, `${await rows.count()}줄`);
  check("포장 손님은 픽업 번호로 표시된다",
    (await rows.first().innerText()).includes("📦"), await rows.first().innerText());

  out.push("\n[목록이 화면을 늘리지 않는다]");
  // 처음엔 이걸 빠뜨려서, 방금 짧게 만든 결산 화면이 주문 200건 때문에
  // 도로 6,600픽셀이 됐다(테스트가 잡았다). 목록 안쪽에서만 스크롤된다.
  const scroll = await page.evaluate(() => {
    const el = document.querySelector("#settlementOrdersList");
    const cs = getComputedStyle(el);
    return { maxH: cs.maxHeight, overflowY: cs.overflowY, height: Math.round(el.getBoundingClientRect().height) };
  });
  check("목록에 높이 상한이 있다", scroll.maxH !== "none", JSON.stringify(scroll));
  check("목록 안에서 스크롤된다", scroll.overflowY === "auto" || scroll.overflowY === "scroll", JSON.stringify(scroll));
  check("목록이 500픽셀을 넘지 않는다", scroll.height <= 500, `${scroll.height}px`);

  const shots = path.join(__dirname, "..", "..", "..", "_screens");
  fs.mkdirSync(shots, { recursive: true });
  await page.fill("#settlementOrderSearch", "");
  await page.locator("#settlementOrderSearchBtn").click();
  await page.waitForTimeout(900);
  await rows.first().locator(".stl-order-head").click();
  await page.waitForTimeout(300);
  const box = await page.locator("#settlementOrdersList").boundingBox();
  await page.screenshot({ path: path.join(shots, "order-history.png"),
    clip: { x: box.x - 24, y: box.y - 70, width: box.width + 48, height: Math.min(box.height + 100, 520) } });

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
