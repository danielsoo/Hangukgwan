// 결제 완료 카드 → 「↩ 반품·취소」 → 수 고르기 → 돌려주기.
//
// 2026-10-03 사장님: "결제된 거 반품, 취소 같은 기능을 넣어줘. 음식이나 조리 같은
// 건 취소고 음료수 라면 봉지 등 반품할 수 있는 건 반품할 수 있게 해줘."
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};
process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-paid-refund";
process.env.ADMIN_PASSWORD = "ownerpass123";

const request = require("supertest");
const { launchBrowser } = require("./browser");
const app = require("../server");
const { store } = require("../src/db");

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
  await require("./disable-order-hours")();
  const boss = request.agent(app);
  await boss.post("/api/auth/login").send({ password: "ownerpass123" });
  const byName = (n) => store.menuItems.find((m) => m.name_ko === n && !m.deleted_at);
  let r = await boss.post("/api/orders").send({
    tableNumber: "7",
    items: [{ itemId: byName("돌솥비빔밥").id, qty: 2 }, { itemId: byName("대만 음료수").id, qty: 2 }],
    party: { adults: 2, children: 0 },
  });
  const id = r.body.id;
  await boss.patch(`/api/orders/${id}`).send({ status: "paid", paymentMethod: "cash" });

  const browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.dismiss());
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "ownerpass123" }) });
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  const card = page.locator(`.order-card[data-order-id="${id}"]`);
  const btn = card.locator(".order-refund-btn");
  check("★ 결제 완료 카드에 「↩ 반품·취소」", (await btn.count()) === 1, "");
  await btn.click();
  await page.waitForTimeout(400);
  check("창이 열린다", await page.locator("#refundBackdrop").isVisible(), "");
  const rows = page.locator("#refundLines .refund-line");
  check("결제된 품목이 줄마다", (await rows.count()) === 2, `${await rows.count()}`);
  check("★★ 비빔밥은 「취소」", /취소/.test(await rows.nth(0).locator(".refund-kind").textContent()), await rows.nth(0).textContent());
  check("★★ 음료는 「반품」", /반품/.test(await rows.nth(1).locator(".refund-kind").textContent()), await rows.nth(1).textContent());
  check("고르기 전에는 돌려주기 버튼이 잠겨 있다", await page.locator("#refundOk").isDisabled(), "");
  await rows.nth(1).locator('[data-step="1"]').click();
  await page.waitForTimeout(600);
  check("★ 고르면 돌려줄 금액이 보인다(서버 계산)", /NT\$30/.test(await page.locator("#refundTotal").textContent()), await page.locator("#refundTotal").textContent());
  await page.locator("#refundLines .refund-line").nth(0).locator('[data-step="1"]').click();
  await page.waitForTimeout(600);
  check("둘 다 — NT$260", /NT\$260/.test(await page.locator("#refundTotal").textContent()), await page.locator("#refundTotal").textContent());
  await page.locator("#refundReason").fill("손님 요청");
  await page.locator("#refundOk").click();
  await page.waitForTimeout(300);
  check("★ 정말 돌려줄지 한 번 묻는다", /NT\$260/.test(await page.locator("#appDialogMessage").textContent()), await page.locator("#appDialogMessage").textContent());
  await page.locator("#appDialogOk").click();
  await page.waitForTimeout(800);
  const msg = await page.locator("#appDialogMessage").textContent();
  check("기록했다고 말한다", /돌려준 것으로 기록/.test(msg), msg);
  await page.locator("#appDialogOk").click();
  await page.waitForTimeout(400);

  const o = (await boss.get("/api/orders")).body.find((x) => x.id === id);
  check("★★ 서버에 남는다 — 돌려준 260, 사유", o && o.refund_total === 260 && o.refunds[0].reason === "손님 요청", JSON.stringify(o && o.refunds));
  check("★ 카드에 「↩ 돌려줌 −NT$260」, 받은 돈은 260", /돌려줌 −NT\$260/.test(await card.textContent()) && /NT\$260/.test(await card.locator(".order-card-total").textContent()), await card.locator(".order-card-total").textContent());

  out.push("\n[결산]");
  await page.locator('.admin-tabs button[data-tab="settlement"]').click();
  await page.waitForTimeout(2500);
  const alerts = await page.locator(".stl-refund-alert").textContent().catch(() => "");
  check("★ 결산에 「결제 후 돌려줌 · 취소 1개 · 반품 1개」", /취소 1개/.test(alerts) && /반품 1개/.test(alerts), alerts);
  const s = (await boss.get("/api/settlements")).body;
  check("★★ 매출에서 빠진다(520 − 260 = 260)", s.total_revenue === 260, `${s.total_revenue}`);

  out.push("\n[패드 폭]");
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.locator('.admin-tabs button[data-tab="orders"]').click();
  await page.waitForTimeout(600);
  await card.locator(".order-refund-btn").click();
  await page.waitForTimeout(400);
  const fits = await page.evaluate(() => {
    const m = document.querySelector(".refund-modal").getBoundingClientRect();
    return m.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth;
  });
  check("세로 패드에서 창이 화면 안에", fits, "");
  if (process.env.SHOT) await page.locator(".refund-modal").screenshot({ path: process.env.SHOT });

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
