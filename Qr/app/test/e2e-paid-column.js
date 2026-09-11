// 결제완료 칼럼 — 결제된 것은 **전부 남고**, 정산이 한 번에 치운다.
//
// 사장님(2026-09-11): "지금 보면 실시간 주문탭에 7개라고 뜨는데 결산에서는
// 총 9건이야. 그리고 실제로 9건은 맞아. 이미 결제 완료된 테이블과 같은
// 테이블이 주문이 들어오면 ... 중복되는 걸 없애달라고 했어. 헷갈릴까봐
// 그것 때문에 그런 거야?"
//
// 맞았다. 「테이블당 최근 1건」 규칙이 걸려 있었고 그래서 9건이 7장으로
// 보였다. 특히 포장 카운터는 QR 하나를 모든 손님이 같이 써서, 서로 아무
// 상관 없는 王緦苹 님과 陳小姐 님이 똑같이 table_number "COUNTER" 로
// 들어오고 나중 분이 앞 분을 덮었다.
//
// 그래서 사장님이 정하신 답: "실시간 주문 탭에서 결제 완료 중복 없애는 거
// 아예 삭제해주고 그냥 계속 남게 해주고 정산때는 전부 삭제해주면 돼."
//
// 화면에 보이는 장수와 결산 건수가 같아야 한다. 쌓이는 것은 정산이 치운다 —
// 그게 「여기까지 끊는다」는 자리다.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-paid-column";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const { launchBrowser } = require("./browser");
const app = require("../server");
const { store, getDb, connectDB, save } = require("../src/db");
const { nowLocal } = require("../src/time");

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
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.on("dialog", (d) => d.dismiss());
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "ownerpass123" }) });
  });

  await connectDB();
  // 포장 카운터 자리를 만든다 (없으면 게으르게 만들어지는 자리다).
  await page.evaluate(async () => { await fetch("/api/tables/counter", { method: "POST" }); });
  await connectDB();
  const counter = store.tables.find((t) => t.is_counter);
  const table = store.tables.find((t) => !t.is_counter);
  const item = store.menuItems[0];

  const now = nowLocal();
  const at = (mmss) => `${now.slice(0, 11)}${mmss}`;
  let id = 900000;
  const paid = (tableNumber, clock, extra = {}) => ({
    _id: ++id, id, table_number: String(tableNumber), status: "paid",
    order_type: "dine_in", created_at: at(clock), updated_at: at(clock), paid_at: at(clock),
    payment_method: "cash", party_size: 2, party_adults: 2, party_children: 0,
    subtotal: item.price, discount_amount: 0, total: item.price,
    items: [{ item_id: item.id, code: item.code, name_ko: item.name_ko, name_zh: item.name_zh,
      name_en: item.name_en, qty: 1, unit_price: item.price, selected_addons: [], option_choice: null,
      spice_choice: null, order_type: "dine_in", paid: true, payment_method: "cash", note: "" }],
    account_id: null, note: "", ...extra,
  });

  // 사장님 화면 그대로 만든다.
  //  · 같은 테이블 두 라운드 → 한 장으로 접히는 게 맞다
  //  · 포장 두 분 → 두 장이어야 한다 (예전에는 한 장으로 덮였다)
  const rows = [
    paid(table.number, "12:03:00"),
    paid(table.number, "12:04:00"),
    paid(counter.number, "12:01:00", { pickup_number: 3, customer_name: "王緦苹", order_type: "takeout" }),
    paid(counter.number, "12:23:00", { pickup_number: 4, customer_name: "陳小姐", order_type: "takeout" }),
  ];
  // 주문은 store 문서가 아니라 자기 컬렉션에 산다(2026-09-10 분리).
  await getDb().collection("orders").bulkWrite(
    rows.map((r) => ({ replaceOne: { filter: { _id: r.id }, replacement: r, upsert: true } }))
  );
  // 영업 시작 전 주문은 화면에서 빠진다 — 오늘 것으로 보이게 맞춰둔다.
  store.settings.service_started_at = `${now.slice(0, 11)}00:00:00`;
  await save();

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1800);

  const cards = await page.evaluate(() => {
    const col = document.querySelector('.order-col[data-status="paid"]');
    if (!col) return null;
    return {
      count: (col.querySelector(".col-count") || {}).textContent || "",
      cards: [...col.querySelectorAll(".order-card")].map((c) => c.innerText.replace(/\n/g, " | ").slice(0, 70)),
    };
  });

  check("결제완료 칼럼을 찾았다", !!cards, "칼럼을 못 찾음");
  out.push("[결제완료 칼럼에 뜬 카드] " + (cards ? cards.count : ""));
  out.push((cards ? cards.cards : []).map((c) => "   " + c).join("\n") || "   (없음)");

  const list = cards ? cards.cards : [];
  const counterCards = list.filter((c) => /📦/.test(c));
  const tableCards = list.filter((c) => !/📦/.test(c));

  out.push("\n[★★ 결제된 것은 전부 남는다 — 화면 장수 = 결산 건수]");
  check("★ 네 건이 네 장으로 보인다", (cards ? cards.cards.length : 0) === 4, JSON.stringify(cards && cards.cards.length));
  check("★ 칼럼 숫자도 4", /\(4\)/.test(cards ? cards.count : ""), cards ? cards.count : "");
  // 같은 자리에서 두 번 결제해도 두 장이다 — 예전에는 늦은 것 하나만 남았다.
  check("★ 같은 테이블의 두 라운드가 둘 다 있다", tableCards.length === 2, JSON.stringify(tableCards));
  // 포장은 이게 특히 중요하다. 서로 다른 손님이 같은 「자리」로 들어온다.
  check("★ 포장 두 분이 둘 다 있다", counterCards.length === 2, JSON.stringify(counterCards));
  check("★ 王緦苹 님이 안 사라진다", counterCards.some((c) => /王緦苹/.test(c)), JSON.stringify(counterCards));
  check("★ 陳小姐 님도 그대로", counterCards.some((c) => /陳小姐/.test(c)), JSON.stringify(counterCards));

  out.push("\n[★★ 정산하면 한 번에 내려간다]");
  {
    // 쌓이는 것은 여기서 치운다. 「여기까지 끊는다」는 뜻이라, 끊은 뒤에도
    // 남아 있으면 다음 장사의 결제와 섞인다.
    await page.evaluate(async () => {
      const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
      await fetch("/api/settlements/shift-close", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: today, shift: "day" }),
      });
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1800);
    const after = await page.evaluate(() => {
      const col = document.querySelector('.order-col[data-status="paid"]');
      return col ? { count: col.querySelector(".col-count").textContent, n: col.querySelectorAll(".order-card").length } : null;
    });
    check("★ 정산 뒤에는 한 장도 안 남는다", after && after.n === 0, JSON.stringify(after));
  }

  out.push("\n[중복 제거 코드가 남아 있지 않다]");
  {
    const fs = require("fs");
    const js = fs.readFileSync(require("path").join(__dirname, "../public/js/admin.js"), "utf8");
    check("★ 테이블당 1건으로 접는 코드가 없다", !/latestPaidByTable/.test(js), "");
    check("★ 묶는 열쇠도 없다", !/paidCardKey/.test(js), "");
    // 정산으로 치우는 길은 그대로 있어야 한다.
    check("정산한 것은 계속 걸러낸다", /cols\.paid\.filter\(\(o\) => !o\.settled_at\)/.test(js), "");
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  await browser.close();
  server.close();
  process.exit(fail === 0 ? 0 : 1);
})();
