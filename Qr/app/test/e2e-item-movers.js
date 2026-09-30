// 결산 — 「요즘 달라진 메뉴」 탭과, 「기타」 없이 전 메뉴를 적는 판매 비중.
//
// 2026-09-30 사장님: "기타로 하지 말고 전체다 적어주고 / 메뉴가 갑자기 안
// 팔리거나 갑자기 잘팔리거나 이런 걸 꾸준히 체크하면서 보여줬으면 좋겠는데."
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};
process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-item-movers";
process.env.ADMIN_PASSWORD = "ownerpass123";

const request = require("supertest");
const { launchBrowser } = require("./browser");
const app = require("../server");
const { store, insertOrder } = require("../src/db");
const { taipeiDateString } = require("../src/time");
const { addDays } = require("../src/itemMovers");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

(async () => {
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  await request(app).get("/api/menu");
  store.settings.service_started_at = "2026-01-01 00:00:00";

  const today = taipeiDateString();
  const end = addDays(today, -1);
  const recentStart = addDays(end, -6);
  const items = store.menuItems.filter((m) => !m.deleted_at).slice(0, 20);
  const [up, down] = items;
  let id = 800000;
  const sell = async (m, d, qty) => insertOrder({
    id: ++id, table_number: "5", status: "paid", created_at: `${d} 12:00:00`, updated_at: `${d} 12:30:00`,
    total: m.price * qty, party_size: 2, payment_method: "cash",
    items: [{ item_id: m.id, name_ko: m.name_ko, name_zh: m.name_zh, qty, unit_price: m.price, paid: true, paid_at: `${d} 12:30:00` }],
  });
  for (let d = addDays(recentStart, -28); d <= end; d = addDays(d, 1)) {
    const recent = d >= recentStart;
    await sell(up, d, recent ? 5 : 1);   // 주 7 → 35
    await sell(down, d, recent ? 0 || 0 : 3); // 주 21 → 0
  }
  // 오늘 — 판매 비중용으로 20가지를 조금씩
  for (let i = 0; i < items.length; i++) await sell(items[i], today, 20 - i);

  const browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.dismiss());
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "ownerpass123" }) });
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.locator('.admin-tabs button[data-tab="settlement"]').click();
  await page.waitForTimeout(2500);

  out.push("[요즘 달라진 메뉴]");
  const tabText = await page.locator("#settlementMoversTab").textContent();
  check("★ 탭 이름에 ▲▼ 개수가 붙어 누르지 않아도 보인다", /▲1/.test(tabText) && /▼1/.test(tabText), tabText);
  await page.locator("#settlementMoversTab").click();
  await page.waitForTimeout(400);
  const upText = await page.locator("#settlementMoversUp").textContent();
  const downText = await page.locator("#settlementMoversDown").textContent();
  check("★★ 늘어난 메뉴가 보인다", upText.includes(up.name_ko) && /\+400%/.test(upText), upText);
  check("★★ 안 팔리게 된 메뉴가 보인다(7일간 0개)", downText.includes(down.name_ko) && /7일간 0개/.test(downText), downText);
  check("5주 흐름 선이 있다", (await page.locator("#settlementMoversUp .stl-mover-spark").count()) === 1, "");
  check("「7일간 0개」가 한 줄", await page.evaluate(() => [...document.querySelectorAll(".stl-mover-tag")].every((t) => t.getBoundingClientRect().height < 28)), "");
  check("어느 기간을 견줬는지 말한다", /어제까지 7일/.test(await page.locator("#settlementMoversNote").textContent()), "");
  await page.locator(".stl-tabs[data-tabgroup='sold']").screenshot({ path: process.env.SHOT_MOVERS || "/dev/null" }).catch(() => {});
  if (process.env.SHOT_MOVERS) await page.locator('.stl-pane[data-pane="soldMovers"]').screenshot({ path: process.env.SHOT_MOVERS });

  out.push("\n[판매 비중 — 「기타」 없이 전부]");
  await page.locator('.stl-tab[data-pane="soldPie"]').click();
  await page.waitForTimeout(600);
  const rows = await page.locator("#settlementPieLegend .stl-pie-item").count();
  const legend = await page.locator("#settlementPieLegend").textContent();
  check("★★ 오늘 팔린 20가지가 전부 적힌다", rows === 20, `${rows}`);
  check("★ 「기타」가 없다", !/기타/.test(legend), legend.slice(0, 200));
  check("순위가 붙는다", (await page.locator("#settlementPieLegend .stl-pie-rank").first().textContent()) === "1", "");
  const lifts = JSON.parse((await page.locator("#settlementPie").getAttribute("data-lifts")) || "[]");
  check("원에도 20조각", lifts.length === 20, `${lifts.length}`);
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  check("화면이 옆으로 안 넘친다", fits, "");
  if (process.env.SHOT_PIE) await page.locator('.stl-pane[data-pane="soldPie"]').screenshot({ path: process.env.SHOT_PIE });

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
