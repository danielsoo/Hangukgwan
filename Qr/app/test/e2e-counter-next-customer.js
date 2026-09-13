// 포장 카운터 — 주문마다 손님이 바뀐다.
//
// 2026-09-13 사장님: "전화로 오는 포장주문은 우리가 직접 입력하는거라 매번
// 이름과 전번를 물어봐야하거든. 그 다음주문부터 안물어봐서 같은 사람으로
// 찍혀."
//
// 이름과 전화번호가 sessionStorage 에 남아 있어서 두 번째 주문부터는 아예
// 묻지 않고 앞 손님 것을 그대로 붙여 보냈다. 키오스크 앱에서는 수기 주문이
// 새 탭을 못 열고 같은 탭에서 이동하므로(admin.js manualOrderBtn) 그 탭이
// 하루 종일 살아 있고, 전화 주문 전부가 첫 손님 이름으로 찍힌다.
//
// 여기서 재는 것:
//   1. 주문이 들어가면 이름·전화번호가 비워져서 다음 주문에 다시 묻는다
//   2. 두 주문의 customer_name/phone 이 실제로 서로 다르게 저장된다
//   3. 손님이 바뀌면 이 기기의 주문 기록(hgk_orders_*)이 끊긴다
//      — 「내역」 합계와 온라인 결제 금액에 남의 주문이 섞이면 안 된다
//   4. 같은 손님이 이어서 주문하면 기록은 그대로 둔다
//      — 방금 넣은 주문을 내역에서 못 보면 온라인 결제를 못 한다
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
process.env.SESSION_SECRET = "e2e-counter-next-customer";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const { launchBrowser } = require("./browser");
const disableOrderHours = require("./disable-order-hours");
const app = require("../server");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) {
    pass++;
    out.push(`  ok   ${name}`);
  } else {
    fail++;
    out.push(`  FAIL ${name}  ${extra}`);
  }
}

const A = { name: "홍길동", phone: "0911111111" };
const B = { name: "김철수", phone: "0922222222" };

(async () => {
  const server = await new Promise((r) => {
    const s = app.listen(0, () => r(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 } });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.dismiss());

  // 카운터를 만든다. 관리자 화면을 먼저 열어 사장 계정을 등록해야 한다.
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await fetch("/api/account/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "boss@hangukgwan.tw", password: "bosspass1234", name: "사장님" }),
    });
  });
  await page.reload({ waitUntil: "networkidle" });
  const counterNumber = await page.evaluate(async () => {
    const r = await fetch("/api/tables/counter", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const b = await r.json().catch(() => ({}));
    const t = b.table || b;
    return t && t.number;
  });
  check("포장 카운터가 만들어진다", !!counterNumber, `number=${counterNumber}`);
  await disableOrderHours();

  // ---- 손님 화면을 실제로 몰아본다 ----
  await page.goto(`${base}/t/${encodeURIComponent(counterNumber)}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  // 카운터는 인원수 대신 이름·전화번호를 묻는다.
  const askedFirst = await page.locator("#counterNameBackdrop").isVisible();
  check("첫 주문에 이름·전화번호를 묻는다", askedFirst);

  // 안 물어보면 채울 수 없다 — 그게 바로 이 테스트가 잡으려는 버그이므로,
  // 여기서 기다리다 타임아웃으로 죽지 않고 false 를 돌려준다. 그래야 아래
  // check 들이 "무엇이 어긋났는지"를 그대로 찍고 끝난다.
  async function fillWho(who) {
    if (!(await page.locator("#counterNameBackdrop").isVisible())) return false;
    await page.locator("#counterNameInput").fill(who.name);
    await page.locator("#counterPhoneInput").fill(who.phone);
    await page.locator("#counterNameConfirmBtn").click();
    await page.waitForTimeout(250);
    return true;
  }
  async function placeOrder() {
    await page.locator("#menuList .item-row").first().click();
    await page.waitForTimeout(300);
    await page.locator("#addToCartBtn").click();
    await page.waitForTimeout(250);
    await page.locator("#cartFab").click();
    await page.waitForTimeout(250);
    await page.locator("#submitOrderBtn").click();
    await page.waitForTimeout(900);
  }
  const savedWho = () =>
    page.evaluate(() => ({
      name: sessionStorage.getItem("hgk_counter_name"),
      phone: sessionStorage.getItem("hgk_counter_phone"),
    }));
  const localOrderIds = (n) =>
    page.evaluate((num) => JSON.parse(localStorage.getItem(`hgk_orders_${num}`) || "[]"), n);

  await fillWho(A);
  const afterFill = await savedWho();
  check("확인을 누르면 이름이 기억된다(새로고침 대비)", afterFill.name === A.name, JSON.stringify(afterFill));

  await placeOrder();
  check("첫 주문이 들어간다", await page.locator("#confirmBackdrop").isVisible());
  const idsAfterFirst = await localOrderIds(counterNumber);
  check("첫 주문이 이 기기 기록에 남는다", idsAfterFirst.length === 1, JSON.stringify(idsAfterFirst));

  // ★ 여기가 사장님이 겪으신 자리다.
  const clearedWho = await savedWho();
  check("주문이 들어가면 이름이 비워진다", !clearedWho.name && !clearedWho.phone, JSON.stringify(clearedWho));

  await page.locator("#backToMenuBtn").click();
  await page.waitForTimeout(250);

  // 두 번째 주문 — 다시 물어야 한다.
  await page.locator("#menuList .item-row").first().click();
  await page.waitForTimeout(300);
  await page.locator("#addToCartBtn").click();
  await page.waitForTimeout(250);
  await page.locator("#cartFab").click();
  await page.waitForTimeout(250);
  await page.locator("#submitOrderBtn").click();
  await page.waitForTimeout(500);
  const askedAgain = await page.locator("#counterNameBackdrop").isVisible();
  check("다음 주문에 이름·전화번호를 다시 묻는다", askedAgain);

  if (askedAgain) {
    await fillWho(B);
    const idsAfterSwitch = await localOrderIds(counterNumber);
    check("손님이 바뀌면 앞 손님 주문 기록이 끊긴다", idsAfterSwitch.length === 0, JSON.stringify(idsAfterSwitch));
    await page.locator("#submitOrderBtn").click();
    await page.waitForTimeout(900);
  } else {
    // 안 물어봤다 = 앞 손님 이름 그대로 주문이 들어갔다. 아래 「이름이 서로
    // 다르다」가 그 결과를 그대로 찍는다.
    check("손님이 바뀌면 앞 손님 주문 기록이 끊긴다", false, "이름을 아예 안 물어봤다");
  }
  check("두 번째 주문이 들어간다", await page.locator("#confirmBackdrop").isVisible());

  // ---- 서버에 실제로 어떻게 저장됐나 ----
  const stored = await page.evaluate(async (num) => {
    const r = await fetch(`/api/orders/table/${encodeURIComponent(num)}`);
    const list = await r.json();
    return list.map((o) => ({ id: o.id, name: o.customer_name, phone: o.customer_phone, pickup: o.pickup_number }));
  }, counterNumber);
  check("주문 두 건이 있다", stored.length === 2, JSON.stringify(stored));
  const names = stored.map((o) => o.name).sort();
  check("두 주문의 이름이 서로 다르다", names.join(",") === [A.name, B.name].sort().join(","), JSON.stringify(stored));
  const phones = stored.map((o) => o.phone).sort();
  check("두 주문의 전화번호가 서로 다르다", phones.join(",") === [A.phone, B.phone].sort().join(","), JSON.stringify(stored));
  check("픽업 번호는 각각 따로 붙는다", new Set(stored.map((o) => o.pickup)).size === 2, JSON.stringify(stored));

  // ---- 같은 손님이 이어서 주문하면 기록은 그대로 ----
  await page.locator("#backToMenuBtn").click();
  await page.waitForTimeout(250);
  const idsBeforeSame = await localOrderIds(counterNumber);
  await page.locator("#menuList .item-row").first().click();
  await page.waitForTimeout(300);
  await page.locator("#addToCartBtn").click();
  await page.waitForTimeout(250);
  await page.locator("#cartFab").click();
  await page.waitForTimeout(250);
  await page.locator("#submitOrderBtn").click();
  await page.waitForTimeout(500);
  await fillWho(B); // 같은 분이 이어서 — 안 물어보면 그대로 지나간다
  const idsAfterSame = await localOrderIds(counterNumber);
  check(
    "같은 손님이 이어서 주문하면 기록을 끊지 않는다",
    idsAfterSame.length === idsBeforeSame.length && idsBeforeSame.length > 0,
    `before=${JSON.stringify(idsBeforeSame)} after=${JSON.stringify(idsAfterSame)}`
  );

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
