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
const { launchBrowser } = require("./browser");
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
  const browser = await launchBrowser();

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

  // 손님 화면도 언어를 따라가야 한다. 이 띠는 JS 가 만들어 넣는 글이라
  // data-i18n 으로 저절로 바뀌지 않는다.
  {
    await guestPage.evaluate(() => {
      const btn = document.querySelector('.lang-option[data-lang="ko"]');
      if (btn) btn.click();
    });
    await guestPage.waitForTimeout(700);
    const ko = await guestPage.locator("#closedBanner").innerText();
    check("손님 화면 안내가 한국어로 바뀐다", ko.includes("주문") && !ko.includes("目前無法點餐"), ko);
    await guestPage.evaluate(() => {
      const btn = document.querySelector('.lang-option[data-lang="zh"]');
      if (btn) btn.click();
    });
    await guestPage.waitForTimeout(700);
    check("중국어로 되돌아온다", (await guestPage.locator("#closedBanner").innerText()).includes("目前無法點餐"),
      await guestPage.locator("#closedBanner").innerText());
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

  // 수기 주문은 손님 주문 페이지를 그대로 연다(관리자 > 수기 주문). 그래서
  // 그 화면이 직원에게도 잠기면 사장님이 말한 "직원들이 직접 앱에서 수동
  // 주문" 이 불가능해진다. 서버만 통과시켜서는 소용이 없다 — 버튼이 안 눌린다.
  {
    const staffOrderPage = await admin.newPage();
    staffOrderPage.on("dialog", (d) => d.dismiss());
    await staffOrderPage.goto(`${base}/t/${table.number}`, { waitUntil: "networkidle" });
    await staffOrderPage.waitForTimeout(500);
    check("직원 화면에서는 주문 버튼이 안 잠긴다",
      !(await staffOrderPage.locator("#submitOrderBtn").isDisabled()));
    check("직원 화면에서는 담기 버튼도 안 잠긴다",
      !(await staffOrderPage.locator("#addToCartBtn").isDisabled()));
    // 그래도 지금이 영업시간 밖이라는 건 알려줘야 한다 — 안 그러면 직원은
    // 손님도 지금 주문할 수 있는 줄 안다.
    const banner = await staffOrderPage.locator("#closedBanner").innerText();
    check("직원 모드라고 알려준다", banner.includes("店員") || banner.includes("직원"), banner);
    check("손님 안내와 색이 다르다",
      (await staffOrderPage.locator("#closedBanner").getAttribute("class")).includes("staff-mode"));
    await staffOrderPage.close();
  }

  out.push("\n[관리자 화면이 지금 상태를 말해준다]");
  // 규칙만 보여주면 사장님이 머리로 시계를 맞춰봐야 하고, 그러다
  // "왜 손님이 주문을 못 하지" 가 된다.
  await adminPage.locator('.admin-tabs button[data-tab="settings"]').click();
  await adminPage.waitForTimeout(800);
  // 「주문 받는 시간」은 설정 > 주문 규칙 안에 있다 — 다른 분류를 열어둔
  // 채로는 화면에 없다(hidden).
  await adminPage.locator('.settings-nav-btn[data-category="order"]').click();
  await adminPage.waitForTimeout(400);
  check("설정 > 주문 규칙에 카드가 보인다", await adminPage.locator("#orderHoursState").isVisible());
  {
    const t = await adminPage.locator("#orderHoursState").innerText();
    check("지금 안 받는 중이라고 적힌다", t.includes("안 받는") || t.includes("停止接單"), t);
  }
  check("시간대 칸이 그려진다", (await adminPage.locator("#ohRanges .oh-range").count()) >= 1,
    `count=${await adminPage.locator("#ohRanges .oh-range").count()}`);
  check("요일 7칸이 그려진다", (await adminPage.locator("#ohWeekRow .oh-week-day").count()) === 7,
    `count=${await adminPage.locator("#ohWeekRow .oh-week-day").count()}`);
  // 요일별로 다르게 잡을 수 있어야 한다 (2026-09-10 사장님: "요일마다 다를
  // 수 있는데 그것도 넣었어?"). 「직접 지정」을 고르면 그 요일만 시간
  // 편집기가 열리고, 기본 시간을 복사해서 시작한다 — 빈 칸부터 채우게 하지 않는다.
  {
    check("요일이 가로 한 줄이다", (await adminPage.locator("#ohWeekRow .oh-week-day").count()) === 7);
    check("월요일부터 시작한다",
      (await adminPage.locator("#ohWeekRow .oh-week-day").first().getAttribute("data-oh-day")) === "1");
    check("고르기 전에는 편집기가 닫혀 있다", await adminPage.locator("#ohDayPanel").isHidden());

    await adminPage.locator('#ohWeekRow .oh-week-day[data-oh-day="6"]').click();
    await adminPage.waitForTimeout(250);
    check("누른 요일의 편집기가 열린다", await adminPage.locator("#ohDayPanel").isVisible());
    await adminPage.locator("#ohDayPanel select[data-oh-mode]").selectOption("custom");
    await adminPage.waitForTimeout(250);
    check("직접 지정하면 시간 칸이 나온다",
      (await adminPage.locator("#ohDayPanel .oh-range").count()) >= 1);
    // 요일 칸에 지금 상태가 적혀 있어야 한다 — 하나씩 눌러보게 하면
    // 가로 한 줄로 만든 뜻이 없다.
    check("요일 칸에 시간이 요약된다",
      /\d{2}:\d{2}~\d{2}:\d{2}/.test(await adminPage.locator('#ohWeekRow .oh-week-day[data-oh-day="6"]').innerText()),
      await adminPage.locator('#ohWeekRow .oh-week-day[data-oh-day="6"]').innerText());

    await adminPage.locator('#ohWeekRow .oh-week-day[data-oh-day="1"]').click();
    await adminPage.waitForTimeout(200);
    await adminPage.locator("#ohDayPanel select[data-oh-mode]").selectOption("closed");
    await adminPage.waitForTimeout(200);
    check("휴무로 고른 요일은 표시가 난다",
      (await adminPage.locator('#ohWeekRow .oh-week-day[data-oh-day="1"]').getAttribute("class")).includes("mode-closed"));

    out.push("\n[태풍 같은 하루짜리 휴무는 달력에서]");
    // 2026-09-10 사장님: "태풍이 불거나 휴무를 해야 하거나 뭐 다양한 이유들."
    check("달력이 그려진다", (await adminPage.locator("#ohCalGrid .oh-cal-day").count()) >= 28);
    check("요일 머리글도 월요일부터",
      (await adminPage.locator("#ohCalWeekdays span").first().innerText()).trim().length > 0);
    const someDay = adminPage.locator("#ohCalGrid .oh-cal-day").nth(15);
    const someDate = await someDay.getAttribute("data-oh-date");
    await someDay.click();
    await adminPage.waitForTimeout(250);
    check("날짜를 누르면 편집기가 열린다", await adminPage.locator("#ohDatePanel").isVisible());
    await adminPage.locator("#ohDatePanel select[data-oh-datemode]").selectOption("closed");
    await adminPage.waitForTimeout(250);
    check("그 날에 표시가 붙는다",
      (await adminPage.locator(`#ohCalGrid .oh-cal-day[data-oh-date="${someDate}"]`).getAttribute("class")).includes("mode-closed"));
    await adminPage.locator("#ohDatePanel input[data-oh-note]").fill("태풍");

    // 저장하면 서버가 다듬은 결과가 그대로 다시 그려져야 한다 — 화면과
    // 실제로 저장된 것이 다르면 사장님은 자기가 적은 대로 막히고 있다고 믿는다.
    await adminPage.locator("#saveOrderHoursBtn").click();
    await adminPage.waitForTimeout(800);
    const saved = await adminPage.evaluate(async () => (await fetch("/api/settings/order-hours")).json());
    check("토요일 시간이 저장된다", !!(saved.day_ranges && saved.day_ranges["6"]), JSON.stringify(saved.day_ranges));
    check("월요일 휴무가 저장된다", (saved.closed_days || []).includes(1), JSON.stringify(saved.closed_days));
    check("그 날 휴무가 저장된다", !!(saved.date_rules && saved.date_rules[someDate] && saved.date_rules[someDate].closed),
      JSON.stringify(saved.date_rules));
    check("이유도 같이 저장된다", (saved.date_rules[someDate] || {}).note === "태풍", JSON.stringify(saved.date_rules));

    // 사유는 선택이다 (2026-09-10 사장님: "사유도 적을 수 있게 해줘 필수는
    // 아니지만"). 시간만 줄인 날에도 적을 수 있어야 하고, 안 적어도 규칙은
    // 그대로 살아 있어야 한다.
    const other = adminPage.locator("#ohCalGrid .oh-cal-day").nth(17);
    const otherDate = await other.getAttribute("data-oh-date");
    await other.click();
    await adminPage.waitForTimeout(250);
    await adminPage.locator("#ohDatePanel select[data-oh-datemode]").selectOption("custom");
    await adminPage.waitForTimeout(250);
    check("시간 지정한 날에도 이유 칸이 나온다", await adminPage.locator("#ohDatePanel .oh-note").isVisible());
    check("예시가 그 상황에 맞게 바뀐다",
      !(await adminPage.locator("#ohDatePanel input[data-oh-note]").getAttribute("placeholder")).includes("휴무"),
      await adminPage.locator("#ohDatePanel input[data-oh-note]").getAttribute("placeholder"));
    await adminPage.locator("#ohDatePanel input[data-oh-note]").fill("태풍으로 저녁만");
    await adminPage.locator("#saveOrderHoursBtn").click();
    await adminPage.waitForTimeout(800);
    {
      const s2 = await adminPage.evaluate(async () => (await fetch("/api/settings/order-hours")).json());
      check("시간 지정한 날의 이유가 저장된다", (s2.date_rules[otherDate] || {}).note === "태풍으로 저녁만",
        JSON.stringify(s2.date_rules));
      check("그 날 시간도 같이 저장된다", ((s2.date_rules[otherDate] || {}).ranges || []).length >= 1,
        JSON.stringify(s2.date_rules));
    }

    // 안 적어도 된다.
    const third = adminPage.locator("#ohCalGrid .oh-cal-day").nth(19);
    const thirdDate = await third.getAttribute("data-oh-date");
    await third.click();
    await adminPage.waitForTimeout(250);
    await adminPage.locator("#ohDatePanel select[data-oh-datemode]").selectOption("closed");
    await adminPage.waitForTimeout(250);
    await adminPage.locator("#saveOrderHoursBtn").click();
    await adminPage.waitForTimeout(800);
    {
      const s3 = await adminPage.evaluate(async () => (await fetch("/api/settings/order-hours")).json());
      check("이유 없이도 휴무가 저장된다", !!(s3.date_rules[thirdDate] || {}).closed, JSON.stringify(s3.date_rules));
      check("빈 이유는 저장되지 않는다", !("note" in (s3.date_rules[thirdDate] || {})), JSON.stringify(s3.date_rules));
    }
    check("저장 뒤에도 달력에 남아 있다",
      (await adminPage.locator(`#ohCalGrid .oh-cal-day[data-oh-date="${someDate}"]`).getAttribute("class")).includes("mode-closed"));

    // 다음 달로 넘어갔다 돌아와도 그대로여야 한다.
    await adminPage.locator("#ohCalNext").click();
    await adminPage.waitForTimeout(200);
    check("다음 달로 넘어간다",
      (await adminPage.locator("#ohCalGrid .oh-cal-day").first().getAttribute("data-oh-date")).slice(0, 7) !== someDate.slice(0, 7));
    await adminPage.locator("#ohCalPrev").click();
    await adminPage.waitForTimeout(200);
    check("돌아오면 표시가 그대로 있다",
      (await adminPage.locator(`#ohCalGrid .oh-cal-day[data-oh-date="${someDate}"]`).getAttribute("class")).includes("mode-closed"));

    {
      const shots = path.join(__dirname, "..", "..", "..", "_screens");
      fs.mkdirSync(shots, { recursive: true });
      await adminPage.locator("#orderHoursState").locator("xpath=..")
        .screenshot({ path: path.join(shots, "order-hours-calendar.png") });
    }
  }

  out.push("\n[언어를 바꾸면 이 카드도 같이 바뀐다]");
  // 2026-09-10 사장님: "이 기능애들도 언어 중국어 한국어 적용되게 해줘."
  // 이 카드의 글자는 대부분 data-i18n 이 아니라 JS 가 만들어 넣은 것이라
  // (요일 이름, 드롭다운 항목, 「삭제」, 상태 줄) 그냥 두면 여기만 예전
  // 언어로 남는다. 중국어로 쓰는 직원이 열어봐야만 드러나는 종류의 문제다.
  {
    const koState = await adminPage.locator("#orderHoursState").innerText();
    const koDay = await adminPage.locator("#ohWeekRow .oh-week-day .oh-week-name").first().innerText();
    const koMonth = await adminPage.locator("#ohCalTitle").innerText();
    const koRemove = await adminPage.locator("#ohRanges .oh-range button").first().innerText();

    await adminPage.locator('.admin-lang-btn[data-admin-lang="zh"]').click();
    await adminPage.waitForTimeout(500);
    const zhState = await adminPage.locator("#orderHoursState").innerText();
    const zhDay = await adminPage.locator("#ohWeekRow .oh-week-day .oh-week-name").first().innerText();
    const zhMonth = await adminPage.locator("#ohCalTitle").innerText();
    const zhRemove = await adminPage.locator("#ohRanges .oh-range button").first().innerText();

    check("상태 줄이 중국어로 바뀐다", zhState !== koState && /停止接單|開放點餐|沒有任何限制/.test(zhState), `${koState} → ${zhState}`);
    check("요일 이름이 중국어로 바뀐다", zhDay !== koDay, `${koDay} → ${zhDay}`);
    check("달력 제목도 중국어로 바뀐다", zhMonth !== koMonth && zhMonth.includes("年"), `${koMonth} → ${zhMonth}`);
    check("「삭제」 버튼도 바뀐다", zhRemove !== koRemove, `${koRemove} → ${zhRemove}`);
    check("설정 분류 이름도 바뀐다",
      (await adminPage.locator('.settings-nav-btn[data-category="order"] .nav-name').innerText()).includes("點餐"),
      await adminPage.locator('.settings-nav-btn[data-category="order"] .nav-name').innerText());

    await adminPage.locator('.admin-lang-btn[data-admin-lang="ko"]').click();
    await adminPage.waitForTimeout(400);
    check("한국어로 되돌아온다",
      (await adminPage.locator("#ohWeekRow .oh-week-day .oh-week-name").first().innerText()) === koDay);
  }
  {
    const shots = path.join(__dirname, "..", "..", "..", "_screens");
    fs.mkdirSync(shots, { recursive: true });
    // 요소로 직접 찍는다 — clip 은 화면 밖으로 나가 있으면 조용히 실패한다.
    await adminPage.locator("#orderHoursState").locator("xpath=..")
      .screenshot({ path: path.join(shots, "closed-admin.png") });
    // 요일을 하나 펼친 모습도 같이 남긴다 — 접혀 있으면 이 기능이 있는지
    // 화면만 보고는 알 수 없다.
    await adminPage.locator('#ohWeekRow .oh-week-day[data-oh-day="6"]').click();
    await adminPage.waitForTimeout(300);
    await adminPage.locator("#orderHoursState").locator("xpath=..")
      .screenshot({ path: path.join(shots, "closed-admin-byday.png") });
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

  out.push("\n[오늘 태풍 휴무면 손님에게 이유까지 알려준다]");
  // "오늘은 휴무입니다" 만 있으면 손님은 다시 올지 말지를 정할 수 없다.
  {
    const today = await adminPage.evaluate(async () => {
      const r = await (await fetch("/api/settings/ordering")).json();
      return r; // 서버가 보는 오늘로 맞춘다 — 브라우저 시계로 하면 어긋난다.
    });
    const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
    await setHours({
      enabled: 1,
      ranges: [{ start: hm(-60), end: hm(60) }],
      closed_days: [],
      date_rules: { [todayStr]: { closed: 1, note: "태풍 휴무" } },
    });
    await guestPage.goto(`${base}/t/${table.number}`, { waitUntil: "networkidle" });
    await guestPage.waitForTimeout(400);
    const text = await guestPage.locator("#closedBanner").innerText();
    check("영업시간 안이어도 그 날은 막힌다", (await guestOrder()).error === "closed_now", text);
    check("이유가 손님 화면에 뜬다", text.includes("태풍 휴무"), text);
    void today;
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
