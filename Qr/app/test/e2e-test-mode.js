// 테스터 모드를 화면에서 실제로 켜고, 써보고, 끈다.
//
// 유닛(test/test-mode.test.js)이 규칙을 지키고, 이 파일은 **사장님이 실제로
// 누르는 길**이 이어져 있는지 본다. 배너가 뜨는가, 켠 뒤에 영업시간 밖에도
// 주문이 들어가는가, 종료 확인창이 무엇이 사라지는지 알려주는가, 끄고 나면
// 진짜 주문이 남아 있는가.
//
// 제일 중요한 것은 마지막이다 — [5]. 진짜 주문이 하나라도 사라지면 이
// 기능은 내보내면 안 된다.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};
process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-test-mode";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const { launchBrowser } = require("./browser");
const app = require("../server");
const { store, save } = require("../src/db");

let pass = 0, fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

(async () => {
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "ownerpass123" }) });
  });

  // 지금이 아닌 시간대를 주문 시간으로 잡아, 손님은 못 넣는 상태를 만든다.
  const { nowLocal } = require("../src/time");
  const h = parseInt(String(nowLocal()).slice(11, 13), 10);
  store.settings.order_hours = {
    enabled: 1,
    ranges: [{ start: `${String((h + 3) % 24).padStart(2, "0")}:00`, end: `${String((h + 4) % 24).padStart(2, "0")}:00` }],
    closed_days: [], day_ranges: {},
  };
  await save();
  const { isOpenNow } = require("../src/openHours");
  check("준비: 지금은 주문을 안 받는 시각이다", isOpenNow(store.settings) === false);

  await page.reload({ waitUntil: "networkidle" });
  const T = store.tables.find((t) => !t.is_counter).number;
  const itemId = store.menuItems[0].id;

  const api = (url, opts) => page.evaluate(async ([u, o]) => {
    const r = await fetch(u, o || undefined);
    let b = null; try { b = await r.json(); } catch (e) {}
    return { status: r.status, body: b };
  }, [url, opts]);
  const post = (u, b) => api(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  const put = (u, b) => api(u, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });

  // 진짜 주문 하나를 미리 넣어둔다(직원 세션이라 영업시간 예외).
  await put(`/api/tables/${T}/party-size`, { partySize: 2 });
  const real = await post("/api/orders", { tableNumber: T, items: [{ itemId, qty: 1 }] });
  check("진짜 주문을 하나 넣어뒀다", real.status === 201, JSON.stringify(real.body).slice(0, 120));
  const realId = real.body.id;

  out.push("\n[1] 켜기 전");
  check("배너가 없다", await page.locator("#testModeBanner").isHidden());
  await page.locator('button[data-tab="settings"]').click();
  await page.waitForTimeout(300);
  check("설정에 테스터 모드 카드가 있다", (await page.locator("#testModeCard").count()) === 1);
  check("「켜기」 버튼이 보인다", await page.locator("#testModeStartBtn").isVisible());

  out.push("\n[2] 켠다");
  await page.locator("#testModeStartBtn").click();
  await page.locator("#appDialogOk").waitFor({ state: "visible", timeout: 5000 });
  await page.locator("#appDialogOk").click();
  await page.locator("#testModeBanner").waitFor({ state: "visible", timeout: 5000 });
  check("배너가 뜬다", await page.locator("#testModeBanner").isVisible());
  check("배너에 사라진다는 말이 있다", /사라집니다/.test(await page.locator("#testModeBannerText").innerText()));
  check("「켜기」 버튼이 사라졌다", await page.locator("#testModeStartBtn").isHidden());
  check("종료 버튼이 보인다", await page.locator("#testModeEndBtn").isVisible());

  out.push("\n[3] 켠 뒤에는 막는 규칙을 지나간다");
  const t1 = await post("/api/orders", { tableNumber: T, items: [{ itemId, qty: 3 }] });
  check("영업시간 밖에도 주문이 들어간다", t1.status === 201, JSON.stringify(t1.body).slice(0, 120));
  check("테스트 표가 붙는다", !!t1.body.test_session);
  const testId = t1.body.id;

  out.push("\n[4] 주문판에서 갈려 보인다");
  await page.locator('button[data-tab="orders"]').click();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(1200);
  const testCard = page.locator(`.order-card[data-order-id="${testId}"]`);
  await testCard.waitFor({ state: "attached", timeout: 8000 });
  check("테스트 주문 카드에 표시가 붙는다", (await testCard.locator(".order-card-test-badge").count()) === 1);
  check("테스트 주문 카드에 테두리가 있다", (await page.locator(`.order-card.test-order[data-order-id="${testId}"]`).count()) === 1);
  const realCard = page.locator(`.order-card[data-order-id="${realId}"]`);
  check("진짜 주문도 같이 보인다", (await realCard.count()) === 1);
  check("진짜 주문에는 표시가 없다", (await realCard.locator(".order-card-test-badge").count()) === 0);

  out.push("\n[5] ★ 끈다 — 무엇이 사라지는지 먼저 보여주고");
  await page.locator('button[data-tab="settings"]').click();
  await page.waitForTimeout(300);
  await page.locator("#testModeEndBtn").click();
  await page.locator("#appDialogOk").waitFor({ state: "visible", timeout: 8000 });
  const msg = await page.locator("#appDialogMessage").innerText();
  check("확인창이 사라질 것을 알려준다", /영구히 사라집니다/.test(msg), msg.slice(0, 120));
  check("지워질 주문 건수가 적혀 있다", /주문 \d+건/.test(msg), msg.slice(0, 160));
  await page.locator("#appDialogOk").click();

  // 종료 뒤 알림창
  await page.locator("#appDialogOk").waitFor({ state: "visible", timeout: 8000 });
  const done = await page.locator("#appDialogMessage").innerText();
  check("종료했다고 알려준다", /종료했어요/.test(done), done.slice(0, 120));
  await page.locator("#appDialogOk").click();
  await page.waitForTimeout(500);

  check("배너가 사라졌다", await page.locator("#testModeBanner").isHidden());
  const gone = await api(`/api/orders/${testId}`);
  check("테스트 주문이 지워졌다", gone.status === 404, String(gone.status));
  const alive = await api(`/api/orders/${realId}`);
  check("★ 진짜 주문은 그대로 있다", alive.status === 200 && alive.body.id === realId, JSON.stringify(alive.body).slice(0, 120));
  check("★ 금액도 그대로다", alive.status === 200 && alive.body.total > 0);

  const t2 = await post("/api/orders", { tableNumber: T, items: [{ itemId, qty: 1 }] });
  check("끄고 나면 규칙이 돌아온다", t2.status === 201 && !t2.body.test_session, JSON.stringify(t2.body).slice(0, 120));

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})();
