// 홈페이지 「전체 메뉴 열기」 → 메뉴만 보는 화면(/menu-view).
//
// 2026-09-30 사장님: "이걸 누르면 포장 qr 로 들어가는데 메뉴만 볼 수 있게 해줘
// 그래서 인원, 포장 정보 필요 없이 주문은 안되지만 메뉴는 볼 수 있게 해줘."
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};
process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-menu-view";
process.env.ADMIN_PASSWORD = "ownerpass123";

const { launchBrowser } = require("./browser");
const app = require("../server");
const { resolveSiteDir } = require("../src/site");

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
  await require("./disable-order-hours")();
  const browser = await launchBrowser();

  if (resolveSiteDir()) {
    out.push("[홈페이지 메뉴 페이지]");
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${base}/menu/`, { waitUntil: "networkidle" });
    const href = await page.locator("a.hg-cta-solid").first().getAttribute("href");
    check("★★ 「전체 메뉴 열기」가 포장 주문(/t/COUNTER)이 아니라 메뉴 보기로 간다", href === "/menu-view", href);
    await ctx.close();
  } else {
    out.push("(홈페이지 빌드가 없어 링크 검사는 건너뜀 — Web/ 에서 npm run build)");
  }

  out.push("\n[메뉴 보기 화면]");
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const posted = [];
  page.on("request", (r) => { if (r.method() !== "GET" && /\/api\/orders/.test(r.url())) posted.push(r.url()); });
  await page.goto(`${base}/menu-view`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const vis = async (sel) => page.locator(sel).isVisible();
  check("★★ 인원을 묻지 않는다", !(await vis("#partySizeBackdrop")), "");
  check("★★ 포장 이름·전화를 묻지 않는다", !(await vis("#counterNameBackdrop")), "");
  check("★ 「메뉴 보기 전용 · 주문은 테이블 QR」 안내가 보인다", (await vis("#viewOnlyBanner")) && /QR/.test(await page.locator("#viewOnlyBanner").textContent()), "");
  check("위쪽 표시는 「메뉴」(포장 카운터·테이블 번호가 아니라)", !/포장|櫃檯|桌/.test(await page.locator("#tableBadge").textContent()), await page.locator("#tableBadge").textContent());
  const rows = await page.locator(".item-row").count();
  check("★ 메뉴가 전부 보인다", rows > 20, `${rows}`);
  check("장바구니·주문 기록 버튼이 없다", !(await vis("#cartFab")) && !(await vis("#historyBtn")), "");
  await page.locator(".item-row:not(.item-unavailable)").first().click();
  await page.waitForTimeout(500);
  check("메뉴를 누르면 설명이 열린다", await vis("#itemSheetBackdrop"), "");
  check("★★ 담기 버튼·수량이 없다 — 주문은 안 된다", !(await vis("#addToCartBtn")) && !(await vis("#qtyRow")), "");
  // 2026-10-04 사장님: "설명의 글자를 크게 표시될 수 있도록 수정 요청됨. 고객이 주문시 이 부분을 제대로 보지
  // 못해, 공기밥이 제공된다는 사실을 모른채 공기밥을 별도로 주문하는 일이 지속적으로 발생함."
  // 예전엔 설명이 13px 로 회색 부제목과 같은 크기였다 — 크기 비율과 바탕을 잰다.
  {
    await page.locator("#itemSheetClose").click();
    await page.waitForTimeout(300);
    const boss0 = require("supertest").agent(app);
    await boss0.post("/api/auth/login").send({ password: "ownerpass123" });
    const cats = (await boss0.get("/api/menu/admin")).body;
    const items = (Array.isArray(cats) ? cats : cats.categories || []).flatMap((c) => c.items || []);
    const it = items.find((x) => x.available !== false && !x.soldout) || items[0];
    await boss0.put(`/api/menu/admin/items/${it.id}`).send({ ...it, desc_zh: "點2人份，附白飯2碗", desc_ko: "2인분 주문 시 공기밥 2개 포함" });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await page.locator(`.item-row[data-item-id="${it.id}"]`).first().click();
    await page.waitForTimeout(600);
    const m = await page.evaluate(() => {
      const px = (sel) => parseFloat(getComputedStyle(document.querySelector(sel)).fontSize);
      const d = document.querySelector("#itemDesc");
      const cs = getComputedStyle(d);
      return { text: d.textContent, desc: px("#itemDesc"), title: px("#itemName"), sub: px("#itemSubNames"), weight: Number(cs.fontWeight), bg: cs.backgroundColor, shown: d.offsetHeight > 0 };
    });
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
    check("설명이 보인다", m.shown && /附白飯2碗|공기밥/.test(m.text), JSON.stringify(m));
    check("★★ 설명 글자는 부제목보다 확실히 크다(1.3배 이상) — 예전엔 같았다(13px)", m.desc >= m.sub * 1.3 && m.desc >= 17, JSON.stringify(m));
    check("★ 설명은 이름(20px) 바로 다음 크기 — 이름을 넘지는 않는다", m.desc >= m.title * 0.85 && m.desc <= m.title, JSON.stringify(m));
    check("★ 굵게, 바탕색 있는 칸", m.weight >= 600 && m.bg !== "rgba(0, 0, 0, 0)", JSON.stringify(m));
    await page.locator("#itemSheetClose").click();
    await page.waitForTimeout(300);
    const other = items.find((x) => x.id !== it.id && !x.desc_zh && !x.desc_ko && x.available !== false);
    if (other) {
      await page.locator(`.item-row[data-item-id="${other.id}"]`).first().click();
      await page.waitForTimeout(500);
      check("설명이 없는 메뉴는 빈 노란 칸이 안 보인다", (await page.locator("#itemDesc").evaluate((el) => el.offsetHeight)) === 0, "");
    }
  }
  check("주문이 서버로 가지 않았다", posted.length === 0, JSON.stringify(posted));
  await ctx.close();

  out.push("\n[포장 주문 화면은 그대로]");
  // 시험 가게에는 포장 카운터가 없다 — 사장님으로 하나 만든다.
  const boss = require("supertest").agent(app);
  await boss.post("/api/auth/login").send({ password: "ownerpass123" });
  const made = await boss.post("/api/tables/counter").send({});
  const counterNumber = (made.body.table || made.body).number;
  const c2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await c2.newPage();
  await p2.goto(`${base}/t/${encodeURIComponent(counterNumber)}`, { waitUntil: "networkidle" });
  await p2.waitForTimeout(1500);
  check("포장 QR 은 여전히 이름·전화를 묻는다", await p2.locator("#counterNameBackdrop").isVisible(), "");
  check("보기 전용 안내는 없다", !(await p2.locator("#viewOnlyBanner").isVisible()), "");
  await c2.close();

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
