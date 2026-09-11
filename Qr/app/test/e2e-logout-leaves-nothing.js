// 로그아웃한 자리에 앞사람의 숫자가 남아 있지 않은가.
//
// 사장님(2026-09-11, 실제 화면을 보시고): "사장이 날짜 설정하는대로 같이
// 보는 거 같은데? 지금 보면 1주일 치잖아."
//
// ── 무엇이었나 ──────────────────────────────────────────────────────
//
// 서버는 직원에게 오늘 것만 내주고 있었다(settlement-staff-today-only.test.js).
// 그런데 화면에는 사장님이 조금 전까지 보던 **일주일치 매출이 그대로 남아**
// 있었다. 로그아웃이 화면을 지우지 않고 로그인 칸만 덮었기 때문이다 —
// 직원이 로그인해도 결산을 다시 부르지 않으니, 그 숫자가 그 자리에 그대로
// 앉아 있었다. 새어 나간 곳은 API 가 아니라 **화면**이다.
//
// 이 테스트가 재는 것은 「직원이 무엇을 못 보는가」가 아니라 「앞사람 것이
// 남아 있는가」다. 그래서 통과 조건은 하나다 — 사장님이 보던 그 숫자가
// 직원 화면 어디에도 없어야 한다.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "logout-leaves-nothing";
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
const PAST = "2026-09-05";

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
  // 오늘 1,000 / 지난주 88,000. 두 숫자를 멀리 떼어 놓아야 화면에 남은 것이
  // 누구 것인지 한눈에 갈린다.
  const mk = (id, date, total) => {
    const mi = items[id % items.length];
    return {
      _id: id, id, table_number: String((id % 5) + 1), status: "paid", order_type: "dine_in",
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
  const rows = [mk(720001, TODAY, 1000), mk(720002, PAST, 88000)];
  await getDb().collection("orders").bulkWrite(rows.map((r) => ({ replaceOne: { filter: { _id: r.id }, replacement: r, upsert: true } })));
  store.settings.service_started_at = "2026-07-01 00:00:00";
  await save();

  out.push("[사장님이 일주일치를 본다]");
  await page.evaluate(async () => {
    await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "ownerpass123" }) });
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.locator('.admin-tabs button[data-tab="settlement"]').click();
  await page.waitForTimeout(1200);
  await page.fill("#settlementStartDate", PAST);
  await page.fill("#settlementEndDate", TODAY);
  await page.waitForTimeout(1700);
  const ownerRevenue = await page.evaluate(() => (document.querySelector("#settlementRevenue") || {}).textContent || "");
  check("사장님 화면에 일주일치가 뜬다 (89,000)", /89,000/.test(ownerRevenue), ownerRevenue);

  out.push("\n[로그아웃 버튼을 누른다 — 새로고침 없이]");
  await page.locator("#logoutBtn").click();
  await page.waitForTimeout(2000);
  const afterLogout = await page.evaluate(() => ({
    onLogin: !document.querySelector("#loginScreen").hidden,
    revenue: (document.querySelector("#settlementRevenue") || {}).textContent || "",
    html: document.body.innerHTML,
  }));
  check("로그인 화면으로 돌아온다", afterLogout.onLogin === true);
  // ★ 핵심. 로그아웃한 자리에 사장님 숫자가 남아 있으면 안 된다.
  check("★ 사장님 숫자가 화면에서 사라진다", !/89,000/.test(afterLogout.revenue), afterLogout.revenue);
  check("★ 문서 어디에도 남아 있지 않다", !afterLogout.html.includes("89,000"));

  out.push("\n[같은 화면에서 직원이 로그인한다]");
  await page.fill("#loginPassword", "staffpass123");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2600);
  const staffView = await page.evaluate(() => ({
    roleStaff: document.body.classList.contains("role-staff"),
    settlementOpen: !document.querySelector("#tab-settlement").hidden,
    revenue: (document.querySelector("#settlementRevenue") || {}).textContent || "",
    heroSub: (document.querySelector("#settlementHeroSub") || {}).textContent || "",
    html: document.body.innerHTML,
  }));
  check("직원으로 들어와 있다", staffView.roleStaff === true);
  // ★★ 사장님이 보던 일주일치가 직원 화면에 남아 있으면 안 된다.
  check("★★ 사장님의 일주일치 매출이 안 보인다", !/89,000/.test(staffView.revenue), staffView.revenue);
  check("★★ 일주일 날짜 범위가 안 보인다", !staffView.heroSub.includes(PAST), staffView.heroSub);
  check("★★ 문서 어디에도 남아 있지 않다", !staffView.html.includes("89,000"));

  out.push("\n[직원이 결산을 열면 오늘 것이 나온다]");
  await page.locator('.admin-tabs button[data-tab="settlement"]').click();
  await page.waitForTimeout(1800);
  const staffSettlement = await page.evaluate(() => ({
    revenue: (document.querySelector("#settlementRevenue") || {}).textContent || "",
    todayOnly: (document.querySelector("#settlementTodayOnly") || {}).textContent || "",
  }));
  check("오늘 매출만 (1,000)", /1,000/.test(staffSettlement.revenue) && !/89,000/.test(staffSettlement.revenue), staffSettlement.revenue);
  check("오늘 날짜가 적힌다", staffSettlement.todayOnly.includes(TODAY), staffSettlement.todayOnly);

  out.push("\n[사장님 전용 탭도 물려받지 않는다]");
  // 회원(VIP)·계정 탭도 열린 채로 남으면 같은 사고가 난다. 로그아웃이 화면을
  // 새로 열어주므로 그 길로는 못 남지만, 세션이 다른 창에서 바뀌는 길도 있다
  // — 그건 화면이 새로 열리지 않으니 applyRoleUI() 가 되돌려야 한다.
  // 그 길은 브라우저에서 그대로 재현하기 어려워(세션 전환 순간에 checkAuth 를
  // 다시 태워야 한다) 코드가 그렇게 되어 있는지를 잰다. 없어지면 걸린다.
  const fs = require("fs");
  const path = require("path");
  const js = fs.readFileSync(path.join(__dirname, "..", "public", "js", "admin.js"), "utf8");
  check("★ 로그아웃은 화면을 통째로 새로 연다", /logoutBtn"\)\.onclick[\s\S]{0,900}?location\.reload\(\)/.test(js));
  check("★ 로그인하면 열려 있던 결산을 다시 부른다", /blankSettlement\(\);\s*\n\s*loadSettlement\(\);/.test(js));
  check("★ 못 받아오면 결산 화면을 비운다", /if \(!res\.ok\) \{\s*\n\s*blankSettlement\(\);/.test(js));
  check("★ 사장님 전용 탭이 열려 있으면 직원을 되돌린다", /OWNER_ONLY_TABS\.has\(activeTab\.dataset\.tab\)/.test(js));

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  await browser.close();
  server.close();
  process.exit(fail === 0 ? 0 : 1);
})();
