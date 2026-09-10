// 「조리 시작」을 누르면 카드가 그 자리에서 움직이는가.
//
// 2026-09-10 사장님: "주문 → 조리중 → 서빙완료 로 넘어가는 버튼 누르면
// 최소 5~20초 이상 걸림."
//
// 가장 큰 원인은 몽고가 서울인데 함수가 버지니아였던 것이지만
// (claude/2026-09-10-mongo-region.md), 그 위에 이 버튼 고유의 문제가
// 있었다. 이 버튼은 PATCH 를 던져놓기만 하고 화면 갱신은 **서버가 되쏘는
// Pusher 알림**에 기대고 있었다. 그래서 카드가 움직이려면
//   PATCH 왕복 → 서버가 Pusher 로 쏨 → 브라우저가 받음 → 목록 전체 재조회
// 가 차례로 다 끝나야 했다. 누른 사람이 기다리는 시간이 그 넷의 합이었다.
//
// 이 테스트가 어려운 이유: 테스트 환경에는 Pusher 가 없어서 화면이 2초
// 폴링으로도 결국 갱신된다. 즉 "결국 조리중으로 갔는가" 만 보면 고치기
// 전에도 통과한다. 그래서 **시간을 잰다.** 폴링이 한 번도 돌 수 없는
// 시간 안에 카드가 움직여야 한다. 그 안에 움직였다면 버튼이 서버 응답으로
// 스스로 갱신했다는 뜻이고, 못 움직였다면 무언가를 기다리고 있다는 뜻이다.
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
process.env.SESSION_SECRET = "e2e-advance-fast";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const { chromium } = require("playwright");
const app = require("../server");
const { store } = require("../src/db");

// 관리자 화면의 폴링 주기(admin.js 의 startPolling). 이보다 넉넉히 짧은
// 시간 안에 움직여야 "폴링 덕분"이 아니라 "버튼이 스스로" 라고 말할 수 있다.
const POLL_MS = 2000;
const BUDGET_MS = 800;

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
  page.on("dialog", (d) => d.accept());
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "ownerpass123" }) });
  });
  await page.reload({ waitUntil: "networkidle" });
  await require("./disable-order-hours")();

  const api = (url, opts) => page.evaluate(async ([u, o]) => {
    const r = await fetch(u, o || undefined);
    let b = null; try { b = await r.json(); } catch (e) {}
    return { status: r.status, body: b };
  }, [url, opts]);
  const post = (url, body) => api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const put = (url, body) => api(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  const T = store.tables.find((t) => !t.is_counter).number;
  const itemId = store.menuItems[0].id;
  await put(`/api/tables/${T}/party-size`, { partySize: 2 });

  const card = (id) => page.locator(`.order-col[data-status="preparing"] .order-card[data-order-id="${id}"]`);
  const newCard = (id) => page.locator(`.order-col[data-status="new"] .order-card[data-order-id="${id}"]`);

  // 폴링이 끼어들지 못하게, 누르기 직전에 화면을 최신으로 맞춰둔다.
  async function freshBoard() {
    await page.evaluate(() => window.__hgLoadOrders && window.__hgLoadOrders());
    await page.waitForTimeout(POLL_MS + 300);
  }

  out.push("[「조리 시작」을 누른 그 자리에서 카드가 움직인다]");
  {
    const r = await post("/api/orders", { tableNumber: T, items: [{ itemId, qty: 1 }] });
    check("주문이 들어간다", r.status === 201, JSON.stringify(r).slice(0, 200));
    const id = r.body.id;

    await freshBoard();
    check("카드가 신규 칼럼에 있다", (await newCard(id).count()) === 1);

    const btn = newCard(id).locator("button.primary").first();
    const t0 = Date.now();
    await btn.click();
    await card(id).waitFor({ state: "attached", timeout: 5000 });
    const took = Date.now() - t0;

    check(`카드가 조리중으로 갔다 (${took}ms)`, (await card(id).count()) === 1);
    check(
      `폴링(${POLL_MS}ms)을 기다리지 않았다 — ${BUDGET_MS}ms 안에 움직였다`,
      took < BUDGET_MS,
      `${took}ms 걸렸다. 버튼이 서버 응답으로 스스로 갱신하지 않고 무언가를 기다리고 있다는 뜻이다.`
    );
    check("신규 칼럼에서는 빠졌다", (await newCard(id).count()) === 0);

    // 서버에도 실제로 반영됐는지. 화면만 낙관적으로 바꿔놓고 저장이 안 된
    // 상태라면 그게 더 나쁘다.
    const after = await api(`/api/orders/${id}`);
    check("서버에도 preparing 으로 저장됐다", after.body && after.body.status === "preparing", JSON.stringify(after.body).slice(0, 120));
  }

  out.push("\n[한 번 더 — 조리중에서 서빙완료로]");
  {
    const served = (id) => page.locator(`.order-col[data-status="served"] .order-card[data-order-id="${id}"]`);
    const r = await post("/api/orders", { tableNumber: T, items: [{ itemId, qty: 2 }] });
    const id = r.body.id;
    await freshBoard();
    await newCard(id).locator("button.primary").first().click();
    await card(id).waitFor({ state: "attached", timeout: 5000 });
    await page.waitForTimeout(POLL_MS + 300); // 폴링이 한 번 지나가도 제자리인지

    check("폴링이 지나가도 조리중에 그대로 있다", (await card(id).count()) === 1);

    const t0 = Date.now();
    await card(id).locator("button.primary").first().click();
    await served(id).waitFor({ state: "attached", timeout: 5000 });
    const took = Date.now() - t0;
    check(`서빙완료로 갔다 (${took}ms)`, (await served(id).count()) === 1);
    check(`이번에도 ${BUDGET_MS}ms 안에`, took < BUDGET_MS, `${took}ms`);
  }

  out.push("\n[취소 버튼도 같은 자리에서 사라진다]");
  {
    const r = await post("/api/orders", { tableNumber: T, items: [{ itemId, qty: 1 }] });
    const id = r.body.id;
    await freshBoard();
    check("취소 전에는 신규에 있다", (await newCard(id).count()) === 1);
    const buttons = newCard(id).locator("button");
    const n = await buttons.count();
    let cancelBtn = null;
    for (let i = 0; i < n; i++) {
      const t = (await buttons.nth(i).innerText()).trim();
      if (/취소|取消|Cancel/i.test(t)) { cancelBtn = buttons.nth(i); break; }
    }
    check("취소 버튼이 있다", !!cancelBtn);
    if (cancelBtn) {
      // 취소는 먼저 확인을 묻는다(admin.js 의 showConfirm — 브라우저 기본
      // 대화상자가 아니라 화면 안의 것이라 #appDialogOk 를 눌러야 한다).
      // 시간은 사람이 「확인」을 누른 뒤부터 잰다.
      await cancelBtn.click();
      await page.locator("#appDialogOk").waitFor({ state: "visible", timeout: 5000 });
      const t0 = Date.now();
      await page.locator("#appDialogOk").click();
      await newCard(id).waitFor({ state: "detached", timeout: 5000 });
      const took = Date.now() - t0;
      check(`신규에서 사라졌다 (${took}ms)`, (await newCard(id).count()) === 0);
      check(`${BUDGET_MS}ms 안에`, took < BUDGET_MS, `${took}ms`);
      const after = await api(`/api/orders/${id}`);
      check("서버에도 cancelled 로 저장됐다", after.body && after.body.status === "cancelled");
    }
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})();
