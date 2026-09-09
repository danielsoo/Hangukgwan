// 품절 기간을 직원이 실제로 찍고, 손님 화면에서 정말 사라지는가.
//
// 2026-09-09 사장님: "김밥이나 다른 음식들은 당일 품절이라서 다음날 자동으로
// 품절 풀어지게... 직원들이 다음날 잊어버릴까봐 간절히 물어봄."
//
// 규칙 자체는 test/availability.test.js 가 시각 단위로 잰다. 여기서는 그
// 규칙이 화면과 주문까지 실제로 이어지는지를 본다 — 배지 한 번, 「오늘만」
// 한 번으로 끝나는지, 손님 메뉴에서 사라지는지, 주소를 알아도 주문이
// 막히는지, 그리고 다음날이 되면 아무도 손대지 않아도 돌아오는지.
const path = require("path");
const fs = require("fs");

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
process.env.SESSION_SECRET = "e2e-soldout";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const { chromium } = require("playwright");
const app = require("../server");
const { store, save } = require("../src/db");
const { today, addDays } = require("../src/availability");

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
    await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "ownerpass123" }) });
  });
  await page.reload({ waitUntil: "networkidle" });
  check("사장 로그인", await page.locator("#dashboard").isVisible());
  await require("./disable-order-hours")();

  await page.locator('.admin-tabs button[data-tab="menu"]').click();
  await page.waitForTimeout(900);

  const firstRow = page.locator("#menuCategories tbody tr").first();
  const dishName = (await firstRow.locator("td").nth(2).innerText()).trim();
  const dishId = await page.evaluate(async () => {
    const cats = await (await fetch("/api/menu/admin")).json();
    return cats.flatMap((c) => c.items)[0].id;
  });
  out.push(`  ·    시험할 메뉴: ${dishName} (id ${dishId})`);

  out.push("\n[배지를 눌러 「오늘만 품절」을 찍는다]");
  const pill = page.locator(`[data-soldout-id="${dishId}"]`);
  check("품절 배지가 누를 수 있는 버튼이다", await pill.isVisible());
  check("처음에는 판매 중이다", (await pill.innerText()).includes("판매"), await pill.innerText());
  await pill.click();
  await page.waitForTimeout(400);
  check("품절 설정 창이 열린다", await page.locator("#soldOutBackdrop").isVisible());
  // 수정 폼이 같이 열리면 안 된다 — 행 전체에도 클릭이 걸려 있다.
  check("메뉴 수정 창은 같이 열리지 않는다", !(await page.locator("#itemModalBackdrop").isVisible().catch(() => false)));
  const shots = path.join(__dirname, "..", "..", "..", "_screens");
  fs.mkdirSync(shots, { recursive: true });
  {
    const m = await page.locator("#soldOutBackdrop .modal").boundingBox();
    await page.screenshot({ path: path.join(shots, "soldout-modal.png"), clip: m });
  }
  await page.locator('#soldOutBackdrop .soldout-mode[data-mode="today"]').click();
  await page.locator("#soldOutSave").click();
  await page.waitForTimeout(900);
  check("창이 닫힌다", !(await page.locator("#soldOutBackdrop").isVisible()));
  check("배지가 품절로 바뀐다", (await pill.innerText()).includes("품절"), await pill.innerText());
  const note = await page.locator(`[data-soldout-id="${dishId}"]`).locator("xpath=../div[@class='soldout-note']").innerText().catch(() => "");
  check("배지 밑에 「오늘만 품절」이라고 적힌다", note.includes("오늘만"), note);
  {
    const tbl = await page.locator("#menuCategories table").first().boundingBox();
    await page.screenshot({ path: path.join(shots, "soldout-row.png"),
      clip: { x: tbl.x, y: tbl.y, width: tbl.width, height: Math.min(tbl.height, 260) } });
  }

  out.push("\n[손님 화면에서 사라지고, 주문도 막힌다]");
  const guest = await browser.newContext();
  const gp = await guest.newPage();
  await gp.goto(`${base}/order.html?table=7`, { waitUntil: "domcontentloaded" });
  const menuNow = await gp.evaluate(async () => {
    const cats = await (await fetch("/api/menu")).json();
    return cats.flatMap((c) => c.items).map((i) => i.id);
  });
  check("손님 메뉴에서 빠진다", !menuNow.includes(dishId), `${menuNow.length}개 중 남아 있음`);
  const orderTry = await gp.evaluate(async (id) => {
    await fetch("/api/tables/7/party-size", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ partySize: 2 }) });
    const r = await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tableNumber: "7", items: [{ itemId: id, qty: 1 }] }) });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, dishId);
  // 화면에서 사라져도 주소만 알면 주문되는 일이 없어야 한다.
  check("주소를 알아도 주문이 안 된다", orderTry.status === 400 && orderTry.body.error === "no_valid_items",
    JSON.stringify(orderTry));

  out.push("\n[다음날 아무도 손대지 않아도 돌아온다]");
  // 시간을 앞으로 돌릴 수 없으니, 저장된 날짜를 어제로 옮겨 "어제 찍은
  // 오늘만 품절"을 만든다. 되돌리는 예약 작업이 없어도 풀려야 한다.
  {
    const it = store.menuItems.find((m) => m.id === dishId);
    // 이틀 전으로 옮긴다. 어제로 옮기면 지금이 영업 시작(11:00) 전인
    // 새벽일 때 "아직 안 풀린 게 맞는" 상태라 결과가 시각에 따라 흔들린다 —
    // 그 경계는 test/availability.test.js 가 시각을 못 박고 잰다.
    const past = addDays(today(), -2);
    it.soldout_from = past;
    it.soldout_until = past;
    await save();
  }
  const menuNext = await gp.evaluate(async () => {
    const cats = await (await fetch("/api/menu")).json();
    return cats.flatMap((c) => c.items).map((i) => i.id);
  });
  check("다음날 손님 메뉴에 돌아온다", menuNext.includes(dishId));
  const orderNext = await gp.evaluate(async (id) => {
    const r = await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tableNumber: "7", items: [{ itemId: id, qty: 1 }] }) });
    return r.status;
  }, dishId);
  check("다음날 주문도 된다", orderNext === 200 || orderNext === 201, `${orderNext}`);
  await guest.close();

  out.push("\n[기간 지정]");
  await page.reload({ waitUntil: "networkidle" });
  await page.locator('.admin-tabs button[data-tab="menu"]').click();
  await page.waitForTimeout(900);
  await page.locator(`[data-soldout-id="${dishId}"]`).click();
  await page.waitForTimeout(400);
  await page.locator('#soldOutBackdrop .soldout-mode[data-mode="range"]').click();
  check("기간을 고르면 날짜 칸이 나온다", await page.locator("#soldOutRangeFields").isVisible());
  // 종료일이 시작일보다 빠르면 막아야 한다.
  await page.fill("#soldOutFrom", addDays(today(), 3));
  await page.fill("#soldOutUntil", addDays(today(), 1));
  await page.locator("#soldOutSave").click();
  await page.waitForTimeout(400);
  check("종료일이 시작일보다 빠르면 막는다", await page.locator("#soldOutError").isVisible());
  check("막혔으면 창이 안 닫힌다", await page.locator("#soldOutBackdrop").isVisible());
  // 제대로 넣으면 저장된다.
  await page.fill("#soldOutFrom", addDays(today(), 1));
  await page.fill("#soldOutUntil", addDays(today(), 3));
  await page.locator("#soldOutSave").click();
  await page.waitForTimeout(900);
  const saved = await page.evaluate(async (id) => {
    const cats = await (await fetch("/api/menu/admin")).json();
    return cats.flatMap((c) => c.items).find((i) => i.id === id);
  }, dishId);
  check("기간이 저장된다", saved.soldout_from === addDays(today(), 1) && saved.soldout_until === addDays(today(), 3),
    JSON.stringify(saved));
  check("시작 전이라 아직 팔린다", saved.available === 1, JSON.stringify(saved));

  out.push("\n[계속 품절 / 판매 중으로 되돌리기]");
  await page.locator(`[data-soldout-id="${dishId}"]`).click();
  await page.waitForTimeout(400);
  await page.locator('#soldOutBackdrop .soldout-mode[data-mode="always"]').click();
  await page.locator("#soldOutSave").click();
  await page.waitForTimeout(900);
  const always = await page.evaluate(async (id) => {
    const cats = await (await fetch("/api/menu/admin")).json();
    return cats.flatMap((c) => c.items).find((i) => i.id === id);
  }, dishId);
  check("계속 품절이면 available_stored 가 0", always.available_stored === 0, JSON.stringify(always));
  check("계속 품절을 고르면 기간은 지워진다", !always.soldout_from && !always.soldout_until, JSON.stringify(always));

  await page.locator(`[data-soldout-id="${dishId}"]`).click();
  await page.waitForTimeout(400);
  await page.locator('#soldOutBackdrop .soldout-mode[data-mode="on_sale"]').click();
  await page.locator("#soldOutSave").click();
  await page.waitForTimeout(900);
  const back = await page.evaluate(async (id) => {
    const cats = await (await fetch("/api/menu/admin")).json();
    return cats.flatMap((c) => c.items).find((i) => i.id === id);
  }, dishId);
  check("판매 중으로 되돌아온다", back.available === 1 && back.available_stored === 1, JSON.stringify(back));
  check("되돌리면 기간도 지워진다", !back.soldout_from && !back.soldout_until, JSON.stringify(back));

  out.push("\n[직원 권한이 없으면 못 바꾼다]");
  const noPerm = await page.evaluate(async (id) => {
    // 메뉴 수정 권한이 없는 사람이 주소를 직접 두드리는 경우 — 서버가 막아야
    // 한다. 여기서는 로그아웃 상태로 확인한다.
    await fetch("/api/auth/logout", { method: "POST" });
    const r = await fetch(`/api/menu/admin/items/${id}/soldout`, { method: "PATCH",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "always" }) });
    return r.status;
  }, dishId);
  check("로그인 안 하면 품절을 바꿀 수 없다", noPerm === 401 || noPerm === 403, `${noPerm}`);

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
