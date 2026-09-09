// 포장 카운터에 주문이 여러 건 쌓였을 때, 사장님이 전부 볼 수 있는지.
//
// 2026-09-09 사장님: "지금 6개까지는 테스트 했는데 그 이상은 드래그로
// 밑으로 내릴 수 있게 되어있어? 아니면 6개 이상은 화면에서 볼 수가 없어?
// 볼 수 있어야 하겠는데."
//
// 포장 카운터는 배치도에 타일 하나로 있고, 누르면 미결제 주문이 카드로
// 나열된다. 12건을 실제로 넣고, 12개가 전부 화면에 닿는지 잰다.
const path = require("path");

const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"),
  filename: require.resolve("mongodb"),
  loaded: true,
  exports: fake,
  paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-counter-many";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const { chromium } = require("playwright");
const app = require("../server");

const N = 12;
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
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.dismiss());
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await fetch("/api/account/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "boss@hangukgwan.tw", password: "bosspass1234", name: "사장님" }),
    });
  });
  await page.reload({ waitUntil: "networkidle" });
  check("사장 로그인", await page.locator("#dashboard").isVisible());

  // 메뉴 한 가지와 포장 카운터를 만들고, 카운터를 구역에 배치한다.
  const setup = await page.evaluate(async (n) => {
    const j = async (url, opts) => {
      const r = await fetch(url, opts);
      let b = null;
      try { b = await r.json(); } catch {}
      return { status: r.status, body: b };
    };
    const H = { "Content-Type": "application/json" };
    // 메뉴는 서버가 이미 기본값으로 심어둔다 — 그중 아무거나 하나 쓴다.
    const menu = await j("/api/menu/admin");
    const item = (menu.body && (menu.body.items || menu.body))[0];
    const counter = await j("/api/tables/counter", { method: "POST", headers: H, body: "{}" });
    const zones = await j("/api/zones");
    const zid = zones.body && zones.body[0] && zones.body[0].id;
    const cid = counter.body && (counter.body.id != null ? counter.body.id : (counter.body.table && counter.body.table.id));
    // 카운터를 구역에 놓는다 — zone_id 가 null 이면 배치도에 안 뜬다.
    const put = await j(`/api/tables/${cid}`, { method: "PATCH", headers: H,
      body: JSON.stringify({ zoneId: zid, x: 20, y: 60, width: 70, height: 70 }) });

    const made = [];
    for (let i = 1; i <= n; i++) {
      const r = await j("/api/orders", { method: "POST", headers: H,
        body: JSON.stringify({
          tableNumber: "COUNTER",
          customerName: `손님${String(i).padStart(2, "0")}`,
          customerPhone: `09000000${String(i).padStart(2, "0")}`,
          items: [{ itemId: item && item.id, qty: 1, orderType: "takeout" }],
        }) });
      made.push(r.status === 200 || r.status === 201 ? r.status : `${r.status}:${JSON.stringify(r.body)}`);
    }
    return { item: item && item.id, counter: counter.status, layout: put.status, made, cid, zid };
  }, N);
  check(`포장 주문 ${N}건이 만들어진다`, setup.made.filter((s) => s === 200 || s === 201).length === N, JSON.stringify(setup));

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(900);

  out.push("\n[결제 탭 — 포장 카운터 타일]");
  await page.locator('.admin-tabs button[data-tab="payment"]').click();
  await page.waitForTimeout(1200);
  const tiles = page.locator("#paymentFloorPlan .table-block");
  if ((await tiles.count()) === 0) {
    console.log("DBG", JSON.stringify(await page.evaluate(async () => {
      const z = await (await fetch("/api/zones")).json();
      const t = await (await fetch("/api/tables")).json();
      const el = document.querySelector("#paymentFloorPlan");
      return { zones: z, counter: t.filter((x) => x.is_counter), tabHidden: document.querySelector("#tab-payment").hidden, html: el && el.innerHTML.slice(0, 300) };
    }), null, 1));
  }
  check("배치도에 카운터 타일이 있다", (await tiles.count()) >= 1, `count=${await tiles.count()}`);
  await tiles.first().click();
  await page.waitForTimeout(900);

  out.push(`\n[포장 주문 ${N}건을 전부 볼 수 있는가]`);
  const cards = page.locator("#tableDetailBody .table-order-block, #tableDetailBody .order-block, #tableDetailBody [data-order-id]");
  const cardCount = await cards.count();
  check(`카드가 ${N}개 그려진다`, cardCount >= N, `count=${cardCount}`);

  // 이름은 손님01 ~ 손님12. 전부 DOM 에 있고, 전부 실제로 스크롤해서 닿아야 한다.
  const body = await page.locator("#tableDetailBody").innerText();
  const missing = [];
  for (let i = 1; i <= N; i++) if (!body.includes(`손님${String(i).padStart(2, "0")}`)) missing.push(i);
  check("12명이 전부 목록에 있다", missing.length === 0, `빠진 번호: ${missing.join(",")}`);

  // 잘려서 못 보는 게 아니라 "스크롤로 내려가는" 상태여야 한다.
  const scroll = await page.evaluate(() => {
    const modal = document.querySelector(".modal-backdrop:not([hidden]) .modal") || document.querySelector(".modal");
    if (!modal) return null;
    const cs = getComputedStyle(modal);
    return {
      overflowY: cs.overflowY,
      scrollH: modal.scrollHeight,
      clientH: modal.clientHeight,
      canScroll: modal.scrollHeight > modal.clientHeight + 1,
    };
  });
  check("목록이 넘치면 스크롤이 생긴다", scroll && (scroll.canScroll || scroll.scrollH <= scroll.clientH + 1), JSON.stringify(scroll));
  check("잘라내지 않는다(overflow-y 가 hidden 이 아니다)", scroll && scroll.overflowY !== "hidden", JSON.stringify(scroll));

  // 마지막 손님 카드까지 실제로 스크롤해서 화면 안에 들어오는지.
  // 화면에서 가장 아래에 있는 카드가 실제로 스크롤해서 보이는지 잰다.
  // 카드는 최신순이라 "손님12"가 맨 위에 온다 — 번호가 아니라 좌표로 고른다.
  // 관리자 화면은 주기적으로 다시 그리므로 DOM 에 표시를 남겨두면 지워진다.
  // 매번 다시 찾는다.
  const lowestNow = () => page.evaluate(() => {
    const modal = document.querySelector(".modal-backdrop:not([hidden]) .modal") || document.querySelector(".modal");
    const names = [...document.querySelectorAll("#tableDetailBody *")]
      .filter((e) => /손님\d\d/.test(e.textContent) && e.children.length === 0);
    if (!names.length) return null;
    const lowest = names.reduce((a, b) => (b.getBoundingClientRect().bottom > a.getBoundingClientRect().bottom ? b : a));
    const r = lowest.getBoundingClientRect();
    const m = modal.getBoundingClientRect();
    return {
      count: names.length,
      text: lowest.textContent.trim().slice(0, 24),
      top: Math.round(r.top), bottom: Math.round(r.bottom),
      mTop: Math.round(m.top), mBottom: Math.round(m.bottom),
      inView: r.top >= m.top - 1 && r.bottom <= m.bottom + 1,
      scrollTop: Math.round(modal.scrollTop),
      atEnd: modal.scrollTop + modal.clientHeight >= modal.scrollHeight - 2,
      canScroll: modal.scrollHeight > modal.clientHeight + 1,
    };
  });

  const g0 = await lowestNow();
  check("주문 12건이 모두 카드로 있다", g0.count === N, JSON.stringify(g0));
  check("목록이 화면보다 길다(=스크롤이 필요한 상황이다)", g0.canScroll, JSON.stringify(g0));
  check("맨 아래 카드는 처음엔 화면 밖이다", !g0.inView, JSON.stringify(g0));

  // 마우스 휠(=태블릿 터치 드래그와 같은 스크롤)로 내려본다.
  await page.mouse.move(720, 500);
  for (let i = 0; i < 14; i++) { await page.mouse.wheel(0, 300); await page.waitForTimeout(60); }
  await page.waitForTimeout(400);
  const g1 = await lowestNow();
  check("실제로 스크롤이 움직였다", g1.scrollTop > 0, JSON.stringify(g1));
  check("끝까지 내려간다", g1.atEnd, JSON.stringify(g1));
  check("스크롤(드래그)로 맨 아래 카드가 화면에 들어온다", g1.inView, JSON.stringify(g1));

  // 다시 위로 올라가 첫 카드도 볼 수 있어야 한다.
  await page.mouse.wheel(0, -8000);
  await page.waitForTimeout(400);
  const g2 = await lowestNow();
  check("위로 되돌아갈 수 있다", g2.scrollTop === 0, JSON.stringify(g2));

  out.push("\n[주문 목록 탭에도 12건이 다 뜬다]");
  // 결제 탭 말고, 주방이 보는 실시간 주문 목록에서도 12건이 다 보여야 한다.
  await page.locator("#tableDetailClose").click();
  await page.waitForTimeout(500);
  await page.locator('.admin-tabs button[data-tab="orders"]').click();
  await page.waitForTimeout(900);
  const boardText = await page.locator(".orders-board").innerText();
  const boardMissing = [];
  for (let i = 1; i <= N; i++) if (!boardText.includes(`손님${String(i).padStart(2, "0")}`)) boardMissing.push(i);
  check("주문 목록에 12명이 전부 있다", boardMissing.length === 0, `빠진 번호: ${boardMissing.join(",")}`);
  const boardOv = await page.evaluate(() => {
    const b = document.querySelector(".orders-board");
    const col = b.querySelector('.order-col[data-status="new"] .col-body');
    const cs = getComputedStyle(col);
    return { overflowY: cs.overflowY, maxH: cs.maxHeight, cards: b.querySelectorAll(".order-card").length,
      colH: Math.round(col.getBoundingClientRect().height), colScrollH: col.scrollHeight };
  });
  check("주문 목록은 높이를 자르지 않는다(페이지가 그냥 길어진다)",
    boardOv.maxH === "none" && boardOv.overflowY !== "hidden", JSON.stringify(boardOv));
  check("주문 카드가 12장이다", boardOv.cards === N, JSON.stringify(boardOv));

  out.push("\n[가게 태블릿 크기(1024×768)에서도 마찬가지인가]");
  // POS 태블릿은 세로가 짧다 — 여기서 잘리면 사장님이 "6개까지만 보인다"고
  // 느끼게 된다. 같은 12건을 태블릿 크기로 다시 확인한다.
  const tab = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const tp = await tab.newPage();
  tp.on("dialog", (d) => d.dismiss());
  await tp.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await tp.evaluate(async () => {
    await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "ownerpass123" }) });
  });
  await tp.reload({ waitUntil: "networkidle" });
  await tp.waitForTimeout(900);
  await tp.locator('.admin-tabs button[data-tab="payment"]').click();
  await tp.waitForTimeout(1100);
  await tp.locator("#paymentFloorPlan .table-block").first().click();
  await tp.waitForTimeout(900);
  const tabLowest = () => tp.evaluate(() => {
    const modal = document.querySelector(".modal-backdrop:not([hidden]) .modal") || document.querySelector(".modal");
    const names = [...document.querySelectorAll("#tableDetailBody *")]
      .filter((e) => /손님\d\d/.test(e.textContent) && e.children.length === 0);
    if (!names.length) return { count: 0 };
    const lowest = names.reduce((a, b) => (b.getBoundingClientRect().bottom > a.getBoundingClientRect().bottom ? b : a));
    const r = lowest.getBoundingClientRect();
    const m = modal.getBoundingClientRect();
    return { count: names.length, canScroll: modal.scrollHeight > modal.clientHeight + 1,
      inView: r.top >= m.top - 1 && r.bottom <= m.bottom + 1,
      atEnd: modal.scrollTop + modal.clientHeight >= modal.scrollHeight - 2,
      scrollTop: Math.round(modal.scrollTop), text: lowest.textContent.trim().slice(0, 24) };
  });
  const tabGeo = await tabLowest();
  check("태블릿에서도 12건이 다 그려진다", tabGeo.count === N, JSON.stringify(tabGeo));
  await tp.screenshot({ path: require("path").join(__dirname, "..", "..", "..", "_screens", "counter-many-tablet-top.png") });
  console.log("MODAL HEAD:", JSON.stringify((await tp.locator("#tableDetailBody").innerText()).split("\n").slice(0, 6)));
  await tp.mouse.move(512, 420);
  for (let i = 0; i < 16; i++) { await tp.mouse.wheel(0, 300); await tp.waitForTimeout(50); }
  await tp.waitForTimeout(300);
  const tabAfter = await tabLowest();
  check("태블릿에서도 스크롤로 맨 아래까지 닿는다", tabAfter.inView && tabAfter.atEnd, JSON.stringify(tabAfter));
  await tp.screenshot({ path: require("path").join(__dirname, "..", "..", "..", "_screens", "counter-many-tablet.png") });
  await tab.close();

  const shots = path.join(__dirname, "..", "..", "..", "_screens");
  require("fs").mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, "counter-many-top.png") });

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
