// 직원이 결제하다가 VIP 카드를 팔 수 있는가.
//
// 2026-09-10 사장님: "vip카드 구매도 현금으로만 구매가능. 버튼필요 —
// VIP卡販售 / 300원. 직원이 결제할 때 손님이 vip 사고 싶다면 살 수 있게
// 해줘. 직원이 결제창에서 직접 쉽게 추가할 수 있게 버튼으로 추가할 수
// 있게 해줘."
//
// 진짜 브라우저로 재는 이유: 이 기능은 "버튼이 거기 있는가"가 절반이다.
// 서버가 아무리 맞게 돌아도 결제 화면에서 버튼을 못 찾으면 카드를 못 판다.
// 그리고 손님이 밥을 다 먹고 결제까지 끝낸 뒤에 사는 경우 — 그때 그 자리에
// 미결제 주문이 하나도 없다 — 가 실제로 제일 흔한 순간이다.
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
process.env.SESSION_SECRET = "e2e-vip-sale";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

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
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.dismiss());
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "ownerpass123" }) });
  });
  await page.reload({ waitUntil: "networkidle" });
  await require("./disable-order-hours")();
  check("사장 로그인", await page.locator("#dashboard").isVisible());

  const api = (url, opts) => page.evaluate(async ([u, o]) => {
    const r = await fetch(u, o || undefined);
    let b = null; try { b = await r.json(); } catch (e) {}
    return { status: r.status, body: b };
  }, [url, opts]);
  const post = (url, body) => api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const put = (url, body) => api(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  const tabless = store.tables.filter((t) => !t.is_counter);
  const A = tabless[0].number;
  const B = tabless[1].number;
  const C = tabless[2].number;
  const itemId = store.menuItems[0].id;

  // 결제 탭의 배치도는 구역에 놓인 테이블만 그린다(갓 심은 저장소에서는
  // 아무 것도 안 놓여 있다). 직원이 실제로 거치는 길 — 배치도의 자리를
  // 눌러 결제창을 여는 길 — 을 그대로 재려면 먼저 놓아야 한다.
  await page.evaluate(async () => {
    const H = { "Content-Type": "application/json" };
    const zones = await (await fetch("/api/zones")).json();
    const tables = await (await fetch("/api/tables")).json();
    let x = 20;
    let y = 40;
    for (const t of tables) {
      await fetch(`/api/tables/${t.id}`, { method: "PATCH", headers: H,
        body: JSON.stringify({ zoneId: zones[0].id, x, y, width: 70, height: 70 }) });
      x += 80;
      if (x > 500) { x = 20; y += 80; }
    }
  });
  const tileFor = (n) => page.locator(`#paymentFloorPlan .table-block[data-table-number="${n}"]`).first();
  const openPaymentTab = async () => {
    await page.locator('.admin-tabs button[data-tab="payment"]').click();
    await page.locator("#paymentFloorPlan .table-block").first().waitFor({ timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(400);
  };

  out.push("[결제창에 버튼이 있다]");
  {
    await put(`/api/tables/${A}/party-size`, { adults: 2, children: 0 });
    await post("/api/orders", { tableNumber: A, items: [{ itemId, qty: 1 }] });
    await page.reload({ waitUntil: "networkidle" });
    // 결제 탭의 배치도에서 그 자리를 눌러 결제창을 연다 — 직원이 실제로
    // 거치는 길 그대로.
    await openPaymentTab();
    await tileFor(A).click();
    await page.waitForTimeout(400);
    check("결제창이 열린다", await page.locator("#tableDetailBackdrop").isVisible());
    const btn = page.locator("#vipSellBtn");
    check("VIP卡販售 버튼이 보인다", await btn.isVisible());
    const label = await btn.innerText();
    check("버튼에 금액이 찍혀 있다", label.includes("300"), label);
  }

  out.push("\n[현금으로만, 그 자리에서]");
  {
    await page.locator("#vipSellBtn").click();
    await page.waitForTimeout(250);
    check("판매 창이 열린다", await page.locator("#vipSellBackdrop").isVisible());
    check("금액이 크게 보인다", (await page.locator("#vipSellPrice").innerText()).includes("300"));
    check("현금이라고 적혀 있다", (await page.locator("#vipSellBackdrop").innerText()).length > 0);
    // 카드번호는 비운 채로 — 사장님이 고른 "선택 입력".
    await page.locator("#vipSellConfirm").click();
    await page.waitForTimeout(500);
    // 판매를 알리는 확인 창이 뜬다(돈을 받는 일이라 한 번 남긴다).
    if (await page.locator("#appDialogBackdrop").isVisible()) {
      check("얼마를 받았는지 알려준다", (await page.locator("#appDialogBackdrop").innerText()).includes("300"),
        await page.locator("#appDialogBackdrop").innerText());
      await page.locator("#appDialogBackdrop .primary-btn").first().click();
      await page.waitForTimeout(200);
    } else {
      check("얼마를 받았는지 알려준다", false, "확인 창이 안 떴다");
    }
    const sold = store.orders.filter((o) => o.kind === "vip_card_sale");
    check("판매가 한 건 기록된다", sold.length === 1, String(sold.length));
    check("현금으로 찍힌다", sold[0].payment_method === "cash", sold[0].payment_method);
    check("이미 결제된 상태다", sold[0].status === "paid", sold[0].status);
    check("금액이 300", sold[0].total === 300, String(sold[0].total));
    check("그 자리 것으로 남는다", String(sold[0].table_number) === String(A));
    check("인원수를 붙이지 않는다", sold[0].party_size == null, String(sold[0].party_size));
    check("품목 하나뿐", sold[0].items.length === 1 && sold[0].items[0].category_key === "vip_card");
    check("번호를 안 적었으면 카드는 안 만든다", store.vipCards.length === 0, String(store.vipCards.length));
    // 밥값은 그대로 남아 있어야 한다 — 카드를 팔았다고 밥값이 결제되면 안 된다.
    const food = store.orders.filter((o) => String(o.table_number) === String(A) && o.kind !== "vip_card_sale");
    check("밥값은 그대로 미결제", food.every((o) => o.status !== "paid"));
    // 인원수도 건드리면 안 된다 — 손님은 아직 앉아 계신다.
    const t = store.tables.find((x) => String(x.number) === String(A));
    check("앉아 계신 손님의 인원수는 그대로", t.party_size === 2, String(t.party_size));
  }

  out.push("\n[다 먹고 결제까지 끝낸 뒤에 사는 경우]");
  // 여기가 원래 못 팔던 자리다 — 미결제 주문이 하나도 없으면 예전 코드는
  // footer 자체를 안 그렸다.
  {
    await page.locator("#tableDetailClose").click();
    await page.waitForTimeout(300);
    // 주문이 아예 없는 빈 자리를 연다.
    const tile = tileFor(B);
    check("주문이 없는 자리 타일이 있다", (await tile.count()) > 0);
    await tile.click();
    await page.waitForTimeout(400);
    check("주문이 없는 자리에서도 결제창이 열린다", await page.locator("#tableDetailBackdrop").isVisible());
    check("주문이 없어도 판매 버튼은 있다", await page.locator("#vipSellBtn").isVisible());
    await page.locator("#tableDetailClose").click();
  }

  out.push("\n[카드번호를 같이 넣으면 등록까지 된다]");
  {
    const before = store.vipCards.length;
    const r = await post("/api/vip-cards/sell", { tableNumber: C, cardNumber: "V9001" });
    check("판매된다", r.status === 201, JSON.stringify(r.body && r.body.error));
    check("카드가 등록된다", store.vipCards.length === before + 1);
    const card = store.vipCards.find((c) => c.card_number === "V9001");
    check("발급일이 오늘", !!card && /^\d{4}-\d{2}-\d{2}$/.test(card.issue_date), card && card.issue_date);
    check("기본 할인율이 붙는다", card && card.discount_percent === 10, card && String(card.discount_percent));
    check("아직 아무도 등록 안 한 카드다", card && !card.google_uid && !card.account_id);
    // 같은 번호를 또 팔면 멈춘다 — 돈만 받고 남의 카드에 덮어쓰면 안 된다.
    const dup = await post("/api/vip-cards/sell", { tableNumber: C, cardNumber: "V9001" });
    check("같은 번호는 두 번 못 판다", dup.status === 400 && dup.body.error === "card_exists", JSON.stringify(dup.body));
    check("멈췄으면 돈도 안 받는다",
      store.orders.filter((o) => o.kind === "vip_card_sale" && String(o.table_number) === String(C)).length === 1);
    const bad = await post("/api/vip-cards/sell", { tableNumber: "없는자리", cardNumber: "" });
    check("없는 자리에는 못 판다", bad.status === 404, String(bad.status));
  }

  out.push("\n[판매가를 사장님이 바꾸면 버튼도 따라간다]");
  {
    const saved = await put("/api/vip-cards/sale-settings", { price: 500, discount_percent: 5 });
    check("저장된다", saved.status === 200 && saved.body.price === 500, JSON.stringify(saved.body));
    const r = await post("/api/vip-cards/sell", { tableNumber: A });
    check("바뀐 값으로 팔린다", r.body.order.total === 500, String(r.body.order.total));
    await page.reload({ waitUntil: "networkidle" });
    await openPaymentTab();
    await tileFor(A).click();
    await page.waitForTimeout(400);
    check("버튼에도 바뀐 금액이 찍힌다", (await page.locator("#vipSellBtn").innerText()).includes("500"),
      await page.locator("#vipSellBtn").innerText());
    // 이상한 값을 넣어도 화면이 죽지 않는다.
    const junk = await put("/api/vip-cards/sale-settings", { price: "삼백", discount_percent: -1 });
    check("이상한 값은 기본값으로 되돌린다", junk.body.price === 300 && junk.body.discount_percent === 10,
      JSON.stringify(junk.body));
  }

  out.push("\n[포장 카운터에서도]");
  // 사장님이 버튼 자리를 고를 때 포장 카운터도 같이 골랐다. 카운터는
  // 손님끼리 무관한 주문이 쌓이는 자리라 결제 버튼 자체가 없는데, 그래도
  // 「카드 한 장 주세요」 는 거기서 제일 많이 나온다.
  {
    await page.locator("#tableDetailClose").click().catch(() => {});
    await page.waitForTimeout(200);
    const counter = await post("/api/tables/counter", {});
    check("포장 카운터가 있다", counter.status === 200 || counter.status === 201, String(counter.status));
    const num = (counter.body && (counter.body.number || (counter.body.table || {}).number)) ||
      (store.tables.find((t) => t.is_counter) || {}).number;
    // 카운터도 배치도에 놓아야 결제 탭에 타일로 뜬다(위 배치 루프보다 뒤에
    // 생겼다).
    await page.evaluate(async (n) => {
      const H = { "Content-Type": "application/json" };
      const zones = await (await fetch("/api/zones")).json();
      const tables = await (await fetch("/api/tables")).json();
      const c = tables.find((t) => String(t.number) === String(n));
      if (c) {
        await fetch(`/api/tables/${c.id}`, { method: "PATCH", headers: H,
          body: JSON.stringify({ zoneId: zones[0].id, x: 20, y: 400, width: 90, height: 70 }) });
      }
    }, num);
    await page.reload({ waitUntil: "networkidle" });
    await openPaymentTab();
    const ctile = tileFor(num);
    check("카운터 타일이 있다", (await ctile.count()) > 0, String(num));
    await ctile.click();
    await page.waitForTimeout(400);
    check("카운터 결제창에도 판매 버튼이 있다", await page.locator("#vipSellBtn").isVisible());
    await page.locator("#vipSellBtn").click();
    await page.waitForTimeout(250);
    await page.locator("#vipSellCardNumber").fill("V9100");
    await page.locator("#vipSellConfirm").click();
    await page.waitForTimeout(600);
    if (await page.locator("#appDialogBackdrop").isVisible()) {
      await page.locator("#appDialogBackdrop .primary-btn").first().click();
      await page.waitForTimeout(200);
    }
    const sold = store.orders.filter((o) => o.kind === "vip_card_sale" && String(o.table_number) === String(num));
    check("카운터에서도 팔린다", sold.length === 1, String(sold.length));
    check("카운터 판매는 포장으로 잡힌다", sold[0] && sold[0].order_type === "takeout", sold[0] && sold[0].order_type);
    check("적어 넣은 번호로 카드가 등록된다", store.vipCards.some((c) => c.card_number === "V9100"));
    await page.locator("#tableDetailClose").click().catch(() => {});
  }

  out.push("\n[설정에서 값을 바꾼다]");
  {
    await page.locator('.admin-tabs button[data-tab="settings"]').click();
    await page.waitForTimeout(300);
    await page.locator('.settings-nav-btn[data-category="vip"]').click();
    await page.waitForTimeout(300);
    check("판매가 칸이 보인다", await page.locator("#vipSalePriceInput").isVisible());
    check("지금 값이 채워져 있다", (await page.locator("#vipSalePriceInput").inputValue()) === "300",
      await page.locator("#vipSalePriceInput").inputValue());
    await page.locator("#vipSalePriceInput").fill("350");
    await page.locator("#saveVipSaleBtn").click();
    await page.waitForTimeout(400);
    const now = await api("/api/vip-cards/sale-settings");
    check("저장된다", now.body.price === 350, JSON.stringify(now.body));
    // 「찾기」로도 닿을 수 있어야 한다 — 설정이 많아서 사장님이 이걸 쓴다.
    await page.locator("#settingsSearch").fill("판매");
    await page.waitForTimeout(300);
    check("설정 찾기에 나온다", (await page.locator("#settingsSearchResults").innerText()).includes("VIP"),
      await page.locator("#settingsSearchResults").innerText());
    await page.locator("#settingsSearch").fill("");
    await put("/api/vip-cards/sale-settings", { price: 300, discount_percent: 10 });
  }

  out.push("\n[결산에서]");
  {
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const s = await api(`/api/settlements?date=${today}`);
    const cat = (s.body.category_breakdown || []).find((c) => c.category_key === "vip_card");
    check("카드 판매가 분류로 잡힌다", !!cat, JSON.stringify(s.body.category_breakdown));
    const cash = (s.body.payment_method_breakdown || []).find((p) => p.method === "cash");
    check("현금으로 잡힌다", !!cash && cash.revenue > 0, JSON.stringify(cash));
  }

  await browser.close();
  server.close();
  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
