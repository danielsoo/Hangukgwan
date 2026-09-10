// 特約95折/VIP9折과 직접 입력 할인을 같이 걸 수 있는가 — 화면에서 실제로.
//
// 사장님(2026-09-10): "현재 vip 할인 2개랑 직접 치는 걸 중복으로 할 수 있게
// 해줘. 예를 들어 vip 할인을 했더니 2원의 잔돈이 있어서 재량으로 2원을
// 깎아주려고."
//
// 산수 자체는 test/discounts.test.js 가 잰다. 여기서 보는 건 그 산수까지
// 가는 길이다: 두 버튼이 서로를 밀어내지 않는지(예전에는 재량을 누르는 순간
// 特約95折이 꺼졌다), 화면의 합계와 결제 팝업이 같은 금액을 말하는지, 그리고
// 직원이 실제로 결제를 눌렀을 때 그 금액이 그대로 저장되는지. 화면 숫자와
// 저장 금액이 어긋나면 그날 장부가 안 맞는다.
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
process.env.SESSION_SECRET = "e2e-discount-stack";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const { chromium } = require("playwright");
const app = require("../server");
const { store } = require("../src/db");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}
const digits = (s) => (String(s).match(/\d+/g) || []).map(Number);

(async () => {
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.dismiss());
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "ownerpass123" }) });
  });
  await page.reload({ waitUntil: "networkidle" });
  await require("./disable-order-hours")();

  // 음식 한 가지 + 음료 한 가지. 特約95折은 음료를 빼고, 재량 할인은 음료도
  // 포함해서 계산하므로 둘의 차이가 드러나려면 음료가 한 줄 있어야 한다.
  const drinkCat = store.categories.find((c) => c.key === "drink");
  const foodItem = store.menuItems.find((m) => m.category_id !== drinkCat.id && !m.min_first_order_qty);
  const drinkItem = store.menuItems.find((m) => m.category_id === drinkCat.id);
  const T = store.tables.find((t) => !t.is_counter).number;

  const seeded = await page.evaluate(async ([t, foodId, drinkId]) => {
    const H = { "Content-Type": "application/json" };
    await fetch(`/api/tables/${t}/party-size`, { method: "PUT", headers: H, body: JSON.stringify({ partySize: 2 }) });
    const r = await fetch("/api/orders", { method: "POST", headers: H,
      body: JSON.stringify({ tableNumber: t, items: [{ itemId: foodId, qty: 1 }, { itemId: drinkId, qty: 1 }] }) });
    const order = await r.json();
    // 결제 탭 배치도는 구역 안에 놓인 테이블만 그린다 — 갓 만든 DB 는
    // 좌표만 있고 zone_id 가 비어 있어서 이 테이블부터 배치해준다.
    const tables = await (await fetch("/api/tables")).json();
    const zones = await (await fetch("/api/zones")).json();
    const target = tables.find((x) => String(x.number) === String(t));
    await fetch(`/api/tables/${target.id}`, { method: "PATCH", headers: H,
      body: JSON.stringify({ zoneId: zones[0].id, x: 20, y: 40, width: 70, height: 70 }) });
    return { orderId: order.id, total: order.total };
  }, [T, foodItem.id, drinkItem.id]);

  const foodPrice = foodItem.price;
  const drinkPrice = drinkItem.price;
  const fullTotal = foodPrice + drinkPrice;
  // 화면과 서버가 따라야 할 정답을 여기서 한 번만 손으로 적는다.
  const vipAmount = foodPrice - Math.round(foodPrice * 0.95); // 特約95折은 음료 제외
  const afterVip = fullTotal - vipAmount;
  const MANUAL = 2; // 사장님 예시 그대로 — 잔돈 2원
  const expectedDiscount = vipAmount + MANUAL;
  const expectedPayable = fullTotal - expectedDiscount;

  check("주문 합계가 음식+음료다", seeded.total === fullTotal, `${seeded.total} vs ${fullTotal}`);

  await page.reload({ waitUntil: "networkidle" });
  await page.locator('.admin-tabs button[data-tab="payment"]').click();
  await page.locator("#paymentFloorPlan .table-block").first().waitFor({ timeout: 15000 });
  await page.locator(`#paymentFloorPlan .table-block:has(> span:text-is("${T}"))`).first().click();
  await page.waitForTimeout(700);

  const te95Btn = page.locator('#tableDetailBody [data-vip-discount-btn="te95"]').first();
  const vip9Btn = page.locator('#tableDetailBody [data-vip-discount-btn="vip9"]').first();
  const manualBtn = page.locator("#tableDetailBody [data-manual-discount-btn]").first();
  // 켜진 버튼은 빨간 배경(--red)으로 칠해진다 — 화면에서 직원이 실제로
  // 구분하는 그 표시를 그대로 본다.
  const isOn = async (loc) => {
    const bg = await loc.evaluate((el) => getComputedStyle(el).backgroundColor);
    return bg !== "rgb(255, 255, 255)" && bg !== "rgba(0, 0, 0, 0)";
  };

  out.push("[두 버튼이 서로를 밀어내지 않는다]");
  check("할인 버튼 세 개가 보인다", (await te95Btn.count()) && (await vip9Btn.count()) && (await manualBtn.count()));

  await te95Btn.click();
  await page.waitForTimeout(300);
  check("特約95折이 켜진다", await isOn(te95Btn));

  await manualBtn.click();
  await page.waitForTimeout(300);
  check("직접 입력 팝업이 뜬다", await page.locator("#manualDiscountBackdrop").isVisible());
  await page.locator("#manualDiscountModeAmount").click();
  await page.locator("#manualDiscountValueInput").fill(String(MANUAL));
  await page.locator("#manualDiscountOk").click();
  await page.waitForTimeout(500);

  // 여기가 이 변경의 핵심이다. 예전에는 이 시점에 特約95折이 꺼졌다.
  check("직접 입력을 넣어도 特約95折이 그대로 켜져 있다", await isOn(te95Btn));
  check("직접 입력도 같이 켜진다", await isOn(manualBtn));
  check("입력한 금액이 버튼에 보인다", /2/.test(await manualBtn.innerText()), await manualBtn.innerText());

  {
    // 두 버튼이 같이 빨갛게 켜져 있는 모습 — 사장님이 눈으로 확인하는 그 화면.
    const fs = require("fs");
    const path = require("path");
    const dir = path.join(__dirname, "..", "..", "..", "_screens");
    fs.mkdirSync(dir, { recursive: true });
    const m = await page.locator("#tableDetailBackdrop .modal").boundingBox();
    if (m) await page.screenshot({ path: path.join(dir, "discount-stack.png"), clip: m });
  }

  out.push("\n[화면 합계가 두 할인을 모두 반영한다]");
  const bodyText = await page.locator("#tableDetailBody").innerText();
  check(`합계에 실수령액 ${expectedPayable}이 보인다`, digits(bodyText).includes(expectedPayable),
    bodyText.split("\n").slice(-6).join(" / "));
  check("할인 전 원래 금액도 같이 보인다(취소선)", digits(bodyText).includes(fullTotal));

  out.push("\n[特約95折/VIP9折끼리는 여전히 하나만]");
  await vip9Btn.click();
  await page.waitForTimeout(300);
  check("VIP9折을 누르면 特約95折은 꺼진다", (await isOn(vip9Btn)) && !(await isOn(te95Btn)));
  check("그래도 직접 입력은 살아 있다", await isOn(manualBtn));
  await te95Btn.click(); // 원래 시나리오(特約95折)로 되돌린다
  await page.waitForTimeout(300);

  out.push("\n[결제 팝업이 두 할인을 순서대로 보여준다]");
  await page.locator("#tableDetailSelectAll").check();
  await page.waitForTimeout(400);
  await page.locator("#tableDetailBody .pay-selected-items-btn").first().click();
  await page.waitForTimeout(500);
  const popup = await page.locator("#paymentMethodBackdrop").innerText();
  check("VIP 할인액이 적힌다", popup.includes(`-NT$${vipAmount}`), popup);
  check("재량 할인액이 따로 적힌다", popup.includes(`-NT$${MANUAL}`), popup);
  check(`실수령액이 ${expectedPayable}이다`, popup.includes(`NT$${expectedPayable}`), popup);
  // "할인은 현금만"은 VIP 카드 프로그램 규칙 — 둘을 같이 걸어도 살아 있어야
  // 한다(재량 할인만 걸었을 때는 제한이 없다).
  const cardDisabled = await page.locator('#paymentMethodBackdrop [data-payment-method="card"]').isDisabled();
  check("VIP 할인이 걸려 있으면 신용카드는 잠긴다", cardDisabled);

  out.push("\n[누른 금액이 그대로 저장된다]");
  await page.locator('#paymentMethodBackdrop [data-payment-method="cash"]').click();
  await page.waitForTimeout(1200);
  const saved = await page.evaluate(async (id) => {
    const list = await (await fetch("/api/orders?all=1")).json();
    const arr = Array.isArray(list) ? list : list.orders || [];
    return arr.find((o) => o.id === id) || null;
  }, seeded.orderId);
  check("주문을 다시 찾을 수 있다", !!saved);
  check(`저장된 할인액이 ${expectedDiscount}이다`, saved && saved.discount_amount === expectedDiscount,
    saved && `${saved.discount_amount}`);
  check("할인 종류가 둘 다 남는다", saved && saved.discount_type === "te95+manual",
    saved && `${saved.discount_type}`);
  check("결제 완료로 넘어갔다", saved && saved.status === "paid", saved && saved.status);

  await browser.close();
  server.close();
  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
