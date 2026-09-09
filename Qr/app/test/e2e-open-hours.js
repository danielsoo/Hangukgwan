// 영업시간 밖에는 손님이 QR 로 주문하지 못하고, 직원은 그대로 되는가.
//
// 2026-09-10 사장님: "영업시간이 아닐 때는 직원을 제외하고 qr 코드로 주문
// 안되게 해줘."
//
// 규칙 자체(몇 시부터 몇 시까지, 브레이크, 휴무 요일, 자정 넘김)는
// test/open-hours.test.js 가 분 단위로 잰다. 여기서는 그 규칙이 실제로
// 화면과 주문까지 이어지는지를 본다 — 손님 화면이 잠기는가, 주소를 알아도
// 막히는가, 직원은 그대로 되는가, 그리고 영업시간이 되면 풀리는가.
//
// 여기서 제일 조심할 것은 "잘못 막는" 쪽이다. 못 막으면 직원이 주문을
// 지우면 그만이지만, 잘못 막히면 손님은 그냥 나가고 우리는 그런 일이
// 있었다는 것조차 모른다.
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
process.env.SESSION_SECRET = "e2e-open-hours";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");
const app = require("../server");
const { store, save } = require("../src/db");
const { nowLocal } = require("../src/time");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

// 지금 시각을 기준으로 구간을 만든다. 테스트가 몇 시에 돌든 같은 뜻이 되도록
// — "밤 11시에 돌리면 통과, 점심에 돌리면 실패" 하는 테스트는 없느니만 못하다.
function hm(offsetMinutes) {
  const now = nowLocal();
  const base = parseInt(now.slice(11, 13), 10) * 60 + parseInt(now.slice(14, 16), 10);
  const m = ((base + offsetMinutes) % 1440 + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

(async () => {
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

  const admin = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const adminPage = await admin.newPage();
  adminPage.on("dialog", (d) => d.dismiss());
  await adminPage.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await adminPage.evaluate(async () => {
    await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "ownerpass123" }) });
  });
  await adminPage.reload({ waitUntil: "networkidle" });
  check("사장 로그인", await adminPage.locator("#dashboard").isVisible());

  // 손님이 주문하려면 인원수가 먼저 있어야 한다(src/routes/orders.js).
  // 여기서 재려는 건 영업시간이지 인원수가 아니라, 미리 채워둔다.
  const table = store.tables.find((t) => !t.is_counter);
  table.party_size = 2;
  await save();
  const itemId = store.menuItems[0].id;

  async function setHours(cfg) {
    const res = await adminPage.evaluate(async (body) => {
      const r = await fetch("/api/settings/order-hours", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      return { status: r.status, body: await r.json() };
    }, cfg);
    return res;
  }

  // 손님은 로그인하지 않은 완전히 별개의 브라우저다 — 직원 세션이 섞이면
  // "직원은 되는데 손님은 안 된다" 를 잰다고 할 수 없다.
  const guest = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const guestPage = await guest.newPage();
  guestPage.on("dialog", (d) => d.dismiss());

  async function guestOrder() {
    return guestPage.evaluate(async ([n, id]) => {
      const r = await fetch("/api/orders", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableNumber: n, items: [{ itemId: id, qty: 1 }] }),
      });
      let b = null; try { b = await r.json(); } catch (e) {}
      return { status: r.status, error: b && b.error };
    }, [table.number, itemId]);
  }

  out.push("\n[규칙을 안 켰으면 아무것도 막지 않는다]");
  // 이 줄이 무너지면 배포하는 순간 전 매장이 주문을 못 받는다.
  await setHours({ enabled: 0, ranges: [{ start: hm(60), end: hm(120) }] });
  await guestPage.goto(`${base}/t/${table.number}`, { waitUntil: "networkidle" });
  check("안내 띠가 안 보인다", await guestPage.locator("#closedBanner").isHidden());
  check("주문 버튼이 안 잠긴다", !(await guestPage.locator("#submitOrderBtn").isDisabled()));
  {
    const r = await guestOrder();
    check("손님 주문이 들어간다", r.status === 201, JSON.stringify(r));
  }

  out.push("\n[영업시간 밖 — 손님]");
  // 지금부터 1시간 뒤에 여는 가게. 즉 지금은 닫혀 있다.
  await setHours({ enabled: 1, ranges: [{ start: hm(60), end: hm(180) }], closed_days: [] });
  await guestPage.goto(`${base}/t/${table.number}`, { waitUntil: "networkidle" });
  await guestPage.waitForTimeout(400);
  check("안내 띠가 보인다", await guestPage.locator("#closedBanner").isVisible());
  {
    const text = await guestPage.locator("#closedBanner").innerText();
    check("주문을 못 받는다고 말한다", text.includes("目前無法點餐") || text.includes("주문"), text);
    check("언제부터 되는지 말해준다", text.includes(hm(60)), text);
    check("직원에게 말하라고 안내한다", text.includes("店員") || text.includes("직원"), text);
  }
  check("주문 버튼이 잠긴다", await guestPage.locator("#submitOrderBtn").isDisabled());
  check("담기 버튼도 잠긴다", await guestPage.locator("#addToCartBtn").isDisabled());
  // 메뉴는 그대로 보여야 한다 — 사장님이 고른 쪽이 "메뉴는 보이고 주문만 잠금".
  check("메뉴는 그대로 보인다", (await guestPage.locator("#menuList .item-row").count()) > 0);
  {
    // 사장님이 배포 전에 눈으로 확인할 수 있게 찍어둔다.
    const shots = path.join(__dirname, "..", "..", "..", "_screens");
    fs.mkdirSync(shots, { recursive: true });
    await guestPage.screenshot({ path: path.join(shots, "closed-customer.png") });
  }
  {
    const r = await guestOrder();
    check("주소를 알아도 서버가 막는다", r.status === 403 && r.error === "closed_now", JSON.stringify(r));
  }

  out.push("\n[영업시간 밖 — 직원은 그대로]");
  // 전화 주문이나 마감 후 정리 주문을 직원이 대신 넣는 일은 실제로 있다.
  // 그것까지 막으면 직원은 시스템을 우회하고, 그 매출은 장부에서 사라진다.
  {
    const r = await adminPage.evaluate(async ([n, id]) => {
      const res = await fetch("/api/orders", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableNumber: n, items: [{ itemId: id, qty: 1 }] }),
      });
      let b = null; try { b = await res.json(); } catch (e) {}
      return { status: res.status, error: b && b.error };
    }, [table.number, itemId]);
    check("직원 주문은 들어간다", r.status === 201, JSON.stringify(r));
  }

  out.push("\n[관리자 화면이 지금 상태를 말해준다]");
  // 규칙만 보여주면 사장님이 머리로 시계를 맞춰봐야 하고, 그러다
  // "왜 손님이 주문을 못 하지" 가 된다.
  await adminPage.locator('.admin-tabs button[data-tab="settings"]').click();
  await adminPage.waitForTimeout(800);
  // 「주문 받는 시간」은 설정 > 매장 정보 안에 있다 — 다른 분류를 열어둔
  // 채로는 화면에 없다(hidden).
  await adminPage.locator('.settings-nav-btn[data-category="store"]').click();
  await adminPage.waitForTimeout(400);
  check("설정 > 매장 정보에 카드가 보인다", await adminPage.locator("#orderHoursState").isVisible());
  {
    const t = await adminPage.locator("#orderHoursState").innerText();
    check("지금 안 받는 중이라고 적힌다", t.includes("안 받는") || t.includes("停止接單"), t);
  }
  check("시간대 칸이 그려진다", (await adminPage.locator("#ohRanges .oh-range").count()) >= 1,
    `count=${await adminPage.locator("#ohRanges .oh-range").count()}`);
  check("휴무 요일 7개가 그려진다", (await adminPage.locator("#ohClosedDays .oh-day").count()) === 7);
  {
    const shots = path.join(__dirname, "..", "..", "..", "_screens");
    fs.mkdirSync(shots, { recursive: true });
    // 요소로 직접 찍는다 — clip 은 화면 밖으로 나가 있으면 조용히 실패한다.
    await adminPage.locator("#orderHoursState").locator("xpath=..")
      .screenshot({ path: path.join(shots, "closed-admin.png") });
  }

  out.push("\n[영업시간이 되면 풀린다]");
  // 아무도 손대지 않아도 풀려야 한다 — 예약 작업이 아니라 물어볼 때마다
  // 계산하는 방식이라 서버가 자다 깨도 어긋나지 않는다.
  await setHours({ enabled: 1, ranges: [{ start: hm(-60), end: hm(60) }], closed_days: [] });
  await guestPage.goto(`${base}/t/${table.number}`, { waitUntil: "networkidle" });
  await guestPage.waitForTimeout(400);
  check("안내 띠가 사라진다", await guestPage.locator("#closedBanner").isHidden());
  check("주문 버튼이 풀린다", !(await guestPage.locator("#submitOrderBtn").isDisabled()));
  {
    const r = await guestOrder();
    check("손님 주문이 다시 들어간다", r.status === 201, JSON.stringify(r));
  }

  out.push("\n[오늘이 휴무면 하루 종일 안 받는다]");
  const todayDow = new Date(Date.UTC(
    parseInt(nowLocal().slice(0, 4), 10),
    parseInt(nowLocal().slice(5, 7), 10) - 1,
    parseInt(nowLocal().slice(8, 10), 10)
  )).getUTCDay();
  await setHours({ enabled: 1, ranges: [{ start: hm(-60), end: hm(60) }], closed_days: [todayDow] });
  {
    const r = await guestOrder();
    check("영업시간 안이어도 휴무면 막힌다", r.status === 403 && r.error === "closed_now", JSON.stringify(r));
  }

  await browser.close();
  server.close();
  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
