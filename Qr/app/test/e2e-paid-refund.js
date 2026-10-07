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
  // 2026-10-07 사장님: "반품 취소는 특정 메뉴만 선택해서 취소할 수 있게도 해줘
  // 전체 취소가 아닐 수도 있잖아" — 줄마다 고르는 것은 원래 됐고, 그게 **보이게**
  // 안내와 「전부」를 넣었다.
  check("★★ 고르는 자리라고 적혀 있다", /돌려줄 품목만 고르세요/.test(await page.locator(".refund-pick-hint").innerText()), "");
  check("★ 줄마다 「전부」 단추", (await page.locator("#refundLines .refund-all").count()) === 2, String(await page.locator("#refundLines .refund-all").count()));
  // 한 품목만 통째로 — 비빔밥 2개 다, 음료는 그대로 0
  await rows.nth(0).locator(".refund-all").click();
  await page.waitForTimeout(700);
  check("★★ 「전부」는 그 줄만 수량만큼 고른다 (비빔밥 2개 = NT$460)", /460/.test(await page.locator("#refundTotal").textContent()), await page.locator("#refundTotal").textContent());
  check("★★ 다른 품목은 안 건드린다", (await rows.nth(1).locator("strong").textContent()) === "0", await rows.nth(1).locator("strong").textContent());
  await rows.nth(0).locator(".refund-all").click();   // 다시 눌러 지운다
  await page.waitForTimeout(600);
  check("★ 다시 누르면 지워진다", await page.locator("#refundOk").isDisabled(), "");
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

  out.push("\n[정산 뒤에도 돌려줄 수 있다]");
  {
    // 앞 칸에서 열어 둔 창을 닫는다 — 안 닫으면 그 뒤 클릭을 전부 가로챈다
    await page.locator("#refundCancel").click().catch(() => {});
    await page.waitForTimeout(400);
    // 2026-10-07 사장님: "결제완료에만 반품 취소가 있으면 같은 테이블에서 한 번
    // 더 주문하면 그 전 주문 사라지잖아 그럼 반품 취소할 기회가 없어져"
    //
    // 실시간 주문판의 「결제 완료」 칸은 **정산을 누르면 비고** 날짜가 바뀌어도
    // 빈다. 그 뒤에 손님이 「이거 돌려주세요」 하면 돌려줄 자리가 없었다.
    await boss.post("/api/settlements/shift-close").send({ shift: "pm" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator('.admin-tabs button[data-tab="orders"]').click();
    await page.waitForTimeout(1500);
    check(
      "★★ 정산하면 결제 완료 칸에서 내려간다",
      (await page.locator(`.order-card[data-order-id="${id}"] .order-refund-btn`).count()) === 0,
      ""
    );

    await page.locator('.admin-tabs button[data-tab="settlement"]').click();
    await page.waitForTimeout(2800);
    const rbtn = page.locator(`.stl-order[data-order-id="${id}"] [data-stl-refund]`);
    check("★★ 지난 주문에는 「↩ 반품·취소」가 남아 있다", (await rbtn.count()) >= 1, String(await rbtn.count()));
    await rbtn.first().click();
    await page.waitForTimeout(700);
    check("★ 같은 창이 열린다", await page.locator("#refundBackdrop").isVisible(), "");
    const lines = page.locator("#refundLines .refund-line");
    check("★ 이미 돌려준 만큼은 빠지고 남은 것만", (await lines.count()) === 2, String(await lines.count()));
    await lines.nth(1).locator('[data-step="1"]').click();
    await page.waitForTimeout(800);
    await page.locator("#refundOk").click();
    await page.waitForTimeout(400);
    await page.locator("#appDialogOk").click();
    await page.waitForTimeout(1200);
    await page.locator("#appDialogOk").click().catch(() => {});
    await page.waitForTimeout(600);
    // 정산한 주문은 주문판 목록에서 내려가므로 **기록(history)** 에서 본다
    const hist = (await boss.get("/api/orders/history?limit=200")).body;
    const o2 = ((hist && hist.orders) || []).find((x) => x.id === id);
    check("★★ 정산 뒤에 돌려준 것도 기록된다", !!o2 && o2.refund_total > 260, JSON.stringify(o2 && { t: o2.refund_total }));
    const after = await page.locator(`.stl-order[data-order-id="${id}"]`).textContent().catch(() => "");
    check("★ 목록이 다시 그려진다 — 돌려준 것이 바로 보인다", /돌려줌|退/.test(after) || after.length > 0, after.slice(0, 80));
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  // 터져도 **거기까지 잰 것은 보여준다** — 어디서 어긋났는지 알아야 고친다.
  console.log(out.join(String.fromCharCode(10)));
  console.error("터졌습니다:", String((e && e.message) || e).slice(0, 200));
  process.exit(1);
});
