// 결산 탭을 처음 열었을 때, 아래 지난 주문 목록이 위와 같은 날을 보는가.
//
// 2026-09-26 사장님: "여긴 테이블이 65개인데 2번 사진은 왜 131 개야"
//
// 위: 「주문 75건 (테이블 65 · 포장 10)」
// 아래: 「주문 154건 (테이블 131 · 포장 23) (가장 최근 것부터 보여드려요…)」
//
// 원인: 목록은 결산 응답을 기다리지 않고 먼저 출발한다(2026-09-14 속도
// 개선). 처음 여는 순간 날짜 칸은 비어 있고, 빈 날짜로 물으면 서버는 날짜를
// 안 걸고 최근 200건을 준다 — 어제 것까지 섞였다. 위 결산은 서버가 빈
// 날짜를 오늘로 채우므로 오늘 것만 셌다.
//
// 그래서 이 시험은 **어제와 오늘에 주문을 깔고, 탭을 처음 연다.**
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "settlement-list-today";
process.env.ADMIN_PASSWORD = "ownerpass123";

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

const TODAY = taipeiDateString();
const Y = new Date(`${TODAY}T12:00:00Z`);
Y.setUTCDate(Y.getUTCDate() - 1);
const YESTERDAY = Y.toISOString().slice(0, 10);

function row(id, day, table, hh) {
  const at = `${day} ${hh}:00:00`;
  return {
    _id: id, id, table_number: String(table), status: "paid", order_type: "dine_in",
    created_at: `${day} ${hh}:00:00`, updated_at: at, service_period: Number(hh) < 16 ? "am" : "pm",
    seating: `${day} ${hh}:00:00|${table}`, party_size: 2, subtotal: 300, total: 300, discount_amount: 0,
    payment_ids: [id],
    items: [{ name_ko: "밥", name_zh: "飯", qty: 1, unit_price: 300, paid: true, paid_at: at, payment_method: "cash" }],
  };
}

(async () => {
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  await connectDB();
  store.settings.service_started_at = `${YESTERDAY} 00:00:00`;
  await save();
  // 오늘 다섯 팀, 어제 여섯 팀.
  const rows = [];
  for (let i = 0; i < 5; i++) rows.push(row(700000 + i, TODAY, i + 1, "12"));
  for (let i = 0; i < 6; i++) rows.push(row(710000 + i, YESTERDAY, i + 1, "18"));
  await getDb().collection("orders").bulkWrite(
    rows.map((r) => ({ replaceOne: { filter: { _id: r.id }, replacement: r, upsert: true } }))
  );

  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on("dialog", (d) => d.dismiss());
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "ownerpass123" }) });
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  out.push(`[결산 탭을 처음 연다 — 오늘 ${TODAY} 다섯 팀, 어제 여섯 팀]`);
  // 날짜 칸을 만지지 않는다. 사장님이 한 그대로다.
  await page.locator('.admin-tabs button[data-tab="settlement"]').click();
  await page.waitForTimeout(2500);
  const hero = await page.locator("#settlementHeroSub").textContent();
  const list = await page.locator("#settlementOrdersCount").textContent();
  out.push(`        위:   ${hero}`);
  out.push(`        목록: ${list}`);
  check("위는 오늘 다섯 팀", /주문 5건/.test(hero || ""), hero);
  check("★★ 목록도 오늘 다섯 팀 — 어제 것이 섞이지 않는다", /^주문 5건/.test((list || "").trim()), list);
  check("★ 「가장 최근 것부터」 로 잘렸다고 하지 않는다", !/가장 최근/.test(list || ""), list);
  const days = await page.locator("#settlementOrdersList").evaluate((el) => el.textContent);
  check("★ 목록에 어제 날짜가 없다", !days.includes(YESTERDAY.slice(5)), "");

  await browser.close();
  server.close();
  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
