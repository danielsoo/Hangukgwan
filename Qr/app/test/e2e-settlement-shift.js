// 오전 칸을 눌러 그 시간대만 본다 — 실제로 눌러본다.
//
// 사장님(2026-09-10): "오전, 오후 정산을 클릭해서 해당 내용을 볼 수 있으면
// 좋겠어. 현재는 Total 내용만 보여지는데, Shift 별로 클릭하면 해당 Shift만
// 볼 수 있으면 더 디테일할거야."
//
// 단위 테스트(settlement-shift-view.test.js)는 서버가 제대로 거르는지를 본다.
// 여기서 보는 것은 그 다음이다 — **눌러서 실제로 바뀌는가.** 서버가 아무리
// 잘 갈라도 칸이 안 눌리면 사장님에게는 없는 기능이다.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "settlement-shift";
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
  await page.waitForTimeout(1200);

  await connectDB();
  const items = store.menuItems;
  // 오전 세 건(현금, 1,000원씩), 오후 두 건(LINE, 2,000원씩). 표를 직접
  // 박아둔다 — 화면이 그 표를 그대로 따라가는지 보는 것이 목적이다.
  const mk = (id, table, half, at, total, pay) => {
    const mi = items[id % items.length];
    return {
      _id: id, id, table_number: String(table), status: "paid", order_type: "dine_in",
      created_at: `${D} ${at}`, paid_at: `${D} ${at}`, updated_at: `${D} ${at}`,
      service_period: half, payment_method: pay, party_size: 2, party_adults: 2, party_children: 0,
      subtotal: total, discount_amount: 0, discount_type: null, total,
      items: [{
        item_id: mi.id, code: mi.code, name_ko: mi.name_ko, name_zh: mi.name_zh, name_en: mi.name_en,
        qty: 1, unit_price: total, selected_addons: [], option_choice: null, spice_choice: null,
        category_key: (store.categories.find((c) => c.id === mi.category_id) || {}).key || null,
        order_type: "dine_in", paid: true, payment_method: pay, paid_at: `${D} ${at}`, note: "",
      }],
      account_id: null, note: "",
    };
  };
  const rows = [
    mk(700001, 1, "am", "11:30:00", 1000, "cash"),
    mk(700002, 2, "am", "12:10:00", 1000, "cash"),
    mk(700003, 3, "am", "12:50:00", 1000, "cash"),
    mk(700004, 4, "pm", "18:10:00", 2000, "linepay"),
    mk(700005, 5, "pm", "19:20:00", 2000, "linepay"),
  ];
  await getDb().collection("orders").bulkWrite(rows.map((r) => ({ replaceOne: { filter: { _id: r.id }, replacement: r, upsert: true } })));
  store.settings.service_started_at = "2026-09-08 17:00:00";
  await save();

  await page.locator('.admin-tabs button[data-tab="settlement"]').click();
  await page.waitForTimeout(900);
  await page.fill("#settlementStartDate", D);
  await page.fill("#settlementEndDate", D);
  await page.waitForTimeout(1500);

  const read = () =>
    page.evaluate(() => {
      const txt = (sel) => (document.querySelector(sel) || {}).textContent || "";
      const vis = (sel) => {
        const el = document.querySelector(sel);
        return !!el && !el.hidden && getComputedStyle(el).display !== "none";
      };
      return {
        revenue: txt("#settlementRevenue"),
        guests: txt("#settlementGuests"),
        am: txt("#settlementAmRevenue"),
        pm: txt("#settlementPmRevenue"),
        totalBadge: vis("#settlementTotalBadge"),
        shiftBadge: vis("#settlementShiftBadge") ? txt("#settlementShiftBadge") : "",
        reset: vis("#settlementShiftReset"),
        note: vis("#settlementShiftNote"),
        amActive: !!document.querySelector("#settlementAmBox.is-active"),
        pmActive: !!document.querySelector("#settlementPmBox.is-active"),
        payMethods: [...document.querySelectorAll("#settlementPaymentMethodBars .stl-bar-name")].map((e) => e.textContent.trim()),
        orderCount: txt("#settlementOrdersCount"),
      };
    });

  out.push("[처음에는 합산]");
  const before = await read();
  check("매출은 하루치 7,000", /7,000/.test(before.revenue), before.revenue);
  check("손님 수는 10명", before.guests.trim() === "10", before.guests);
  check("오전 칸 3,000", /3,000/.test(before.am), before.am);
  check("오후 칸 4,000", /4,000/.test(before.pm), before.pm);
  check("「합산」 표가 보인다", before.totalBadge === true, JSON.stringify(before.totalBadge));
  check("시간대 표는 안 보인다", before.shiftBadge === "", before.shiftBadge);
  check("결제수단이 두 가지", before.payMethods.length === 2, JSON.stringify(before.payMethods));

  out.push("\n[★★ 오전 칸을 누른다]");
  await page.locator("#settlementAmBox").click();
  await page.waitForTimeout(1400);
  const am = await read();
  check("★ 큰 숫자가 오전 것으로 바뀐다", /3,000/.test(am.revenue), am.revenue);
  check("★ 손님 수도 오전 것", am.guests.trim() === "6", am.guests);
  check("★ 오전만 보고 있다고 적힌다", /오전|上午/.test(am.shiftBadge), am.shiftBadge);
  check("「합산」 표는 물러난다", am.totalBadge === false, JSON.stringify(am.totalBadge));
  check("합산으로 돌아가는 버튼이 뜬다", am.reset === true, "");
  check("아래가 이 시간대라는 안내가 뜬다", am.note === true, "");
  check("★ 고른 칸이 눈에 남는다", am.amActive === true && am.pmActive === false, JSON.stringify(am));
  check("★ 오후 칸은 그대로 살아 있다", /4,000/.test(am.pm), am.pm);
  check("★ 결제수단이 현금 하나로 줄었다", am.payMethods.length === 1, JSON.stringify(am.payMethods));
  check("★ 주문 목록도 3건으로 줄었다", /^3/.test(am.orderCount.trim()), am.orderCount);

  out.push("\n[오후로 건너뛴다]");
  await page.locator("#settlementPmBox").click();
  await page.waitForTimeout(1400);
  const pm = await read();
  check("★ 오후 것으로 바뀐다", /4,000/.test(pm.revenue), pm.revenue);
  check("고른 칸이 옮겨간다", pm.pmActive === true && pm.amActive === false, JSON.stringify(pm));
  check("결제수단은 LINE 하나", pm.payMethods.length === 1, JSON.stringify(pm.payMethods));
  check("주문 목록은 2건", /^2/.test(pm.orderCount.trim()), pm.orderCount);

  out.push("\n[같은 칸을 다시 누르면 합산으로]");
  await page.locator("#settlementPmBox").click();
  await page.waitForTimeout(1400);
  const back = await read();
  check("★ 다시 하루치", /7,000/.test(back.revenue), back.revenue);
  check("고른 칸이 없다", back.amActive === false && back.pmActive === false, JSON.stringify(back));
  check("「합산」 표가 돌아온다", back.totalBadge === true, "");
  check("결제수단도 둘로 돌아온다", back.payMethods.length === 2, JSON.stringify(back.payMethods));

  out.push("\n[「합산 보기」 버튼으로도 돌아온다]");
  await page.locator("#settlementAmBox").click();
  await page.waitForTimeout(1300);
  await page.locator("#settlementShiftReset").click();
  await page.waitForTimeout(1300);
  const viaBtn = await read();
  check("★ 하루치로 돌아온다", /7,000/.test(viaBtn.revenue), viaBtn.revenue);
  check("버튼은 다시 숨는다", viaBtn.reset === false, "");

  out.push("\n[날짜를 바꾸면 합산으로 돌아간다]");
  // 어제 오후를 보다 오늘로 넘어왔는데 여전히 오후만 보이면 그게 더 헷갈린다.
  await page.locator("#settlementAmBox").click();
  await page.waitForTimeout(1300);
  await page.fill("#settlementStartDate", "2026-09-08");
  await page.fill("#settlementEndDate", D);
  await page.waitForTimeout(1500);
  const ranged = await read();
  check("★ 고른 칸이 풀린다", ranged.amActive === false && ranged.pmActive === false, JSON.stringify(ranged));

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  await browser.close();
  server.close();
  process.exit(fail === 0 ? 0 : 1);
})();
