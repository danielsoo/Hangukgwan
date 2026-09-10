// 정산 버튼을 누르면 LINE 마감 문자가 실제로 나가는가.
//
// 사장님(2026-09-10): "현재 line 으로 결산 보내주는 기능이 있기는 한데 한
// 번도 사용한 적은 없어. 테스트 문자는 잘 가긴 해. 이제 오전 정산 오후
// 정산(하루 정산) 총 하루에 2개 있는데 오늘부터 받아볼 수 있나?"
//
// 한 번도 써본 적 없는 길이라 어디가 끊겨 있는지 아무도 모른다. 그래서
// 여기서는 문자 내용만 재는 게 아니라 관리자 화면의 그 버튼을 실제로 눌러서,
// 버튼 → 서버 → LINE API 까지 이어지는지를 끝까지 본다. LINE 서버로 나가는
// 요청만 가로채고 나머지 통신은 그대로 둔다.
//
// 특히 두 가지를 조심한다:
//  - 직원 계정으로 눌러도 나가야 한다. 예전 코드는 owner 전용 라우트를 불러서
//    직원이 누르면 조용히 아무 일도 안 일어났다.
//  - 오전 정산 금액이 점심 장사(11~14시)를 다 담아야 한다. 예전 화면 계산은
//    0~11시만 세서 12시 이후에 받은 돈이 통째로 빠졌다.
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
process.env.SESSION_SECRET = "e2e-line-settlement";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.STAFF_PASSWORD = "staffpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

// LINE 으로 나가는 요청만 가로챈다. 나머지는 원래 fetch 그대로.
const realFetch = global.fetch;
const linePushes = [];
global.fetch = async (url, opts) => {
  const href = String(url && url.url ? url.url : url);
  if (href.startsWith("https://api.line.me/")) {
    const body = JSON.parse((opts && opts.body) || "{}");
    linePushes.push({ to: body.to, text: (body.messages && body.messages[0] && body.messages[0].text) || "" });
    return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return realFetch(url, opts);
};

const { launchBrowser } = require("./browser");
const app = require("../server");
const { store, save } = require("../src/db");

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

  // 사장님이 설정 화면에서 해두는 것과 같은 상태 — 토큰 있음, 받을 사람
  // 승인됨, 마감 알림 켬.
  store.settings.line_channel_access_token = "test-token";
  store.settings.line_targets = [{ userId: "U_owner", displayName: "사장님" }];
  store.settings.line_notify_enabled = true;
  await save();

  // 직원으로 로그인한다 — 이 버튼을 실제로 누르는 사람이다.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.dismiss());
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  const loggedIn = await page.evaluate(async () => {
    const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "staffpass123" }) });
    return r.status;
  });
  check("직원 로그인", loggedIn === 200, `${loggedIn}`);
  await page.reload({ waitUntil: "networkidle" });
  await require("./disable-order-hours")();

  const T = store.tables.find((t) => !t.is_counter).number;
  const T2 = store.tables.filter((t) => !t.is_counter)[1].number;
  const drinkCat = store.categories.find((c) => c.key === "drink");
  const food = store.menuItems.find((m) => m.category_id !== drinkCat.id && !m.min_first_order_qty);

  const api = (url, opts) => page.evaluate(async ([u, o]) => {
    const r = await fetch(u, o || undefined);
    let b = null; try { b = await r.json(); } catch (e) {}
    return { status: r.status, body: b };
  }, [url, opts]);
  const post = (url, body) => api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const put = (url, body) => api(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  // ── 점심 장사: 12시대에 받은 돈. 예전 화면 계산(0~11시)이 놓치던 자리다.
  await put(`/api/tables/${T}/party-size`, { partySize: 2 });
  const lunch = await post("/api/orders", { tableNumber: T, items: [{ itemId: food.id, qty: 1 }] });
  const lunchOrder = store.orders.find((o) => o.id === lunch.body.id);
  lunchOrder.created_at = lunchOrder.created_at.slice(0, 10) + " 12:10:00";
  await api(`/api/orders/${lunch.body.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "paid", paymentMethod: "cash", vipDiscountType: "te95" }) });

  // 인원수만 답하고 주문은 안 한 자리 — 사장님이 "메뉴는 없는데 인원수는
  // 있어" 라고 하신 그 상태를 만들어 둔다. 정산이 이걸 같이 비워야 한다.
  const IDLE = store.tables.filter((t) => !t.is_counter)[2].number;
  await put(`/api/tables/${IDLE}/party-size`, { adults: 2, children: 0 });
  const idleBefore = await api(`/api/tables/${IDLE}/party-size`);
  check("주문 없이 인원수만 있는 자리를 만들었다", idleBefore.body.party_size === 2, JSON.stringify(idleBefore.body));

  out.push("[🌅 오전 정산 — 버튼 하나로 문자까지]");
  await page.locator("#settleAmBtn").click();
  await page.waitForTimeout(400);
  await page.locator("#appDialogOk").click();
  await page.waitForTimeout(1500);

  check("LINE 으로 한 통 나갔다", linePushes.length === 1, `${linePushes.length}통`);
  const amText = linePushes[0] ? linePushes[0].text : "";
  check("승인된 사람에게 갔다", linePushes[0] && linePushes[0].to === "U_owner");
  check("오전 정산 문자다", /^🌅 \d+\/\d+ 오전 정산 \(\d\d:\d\d 마감\)/.test(amText), amText.split("\n")[0]);
  const lunchPaid = lunchOrder.total;
  check(`점심(12시대) 매출이 들어 있다 — NT$${lunchPaid}`,
    amText.includes(`매출: NT$${lunchPaid.toLocaleString()}`), amText);
  check("결제수단이 한글로 적힌다", /현금 NT\$/.test(amText), amText);
  check("VIP 카드 할인이 이름으로 적힌다", amText.includes("特約95折 -NT$"), amText);
  {
    // 여기가 이번에 더한 것이다. 주문이 없어서 결제할 것도 없던 자리는
    // 스스로 비워지지 않는다 — 정산이 비워줘야 한다.
    const idleAfter = await api(`/api/tables/${IDLE}/party-size`);
    check("주문 없이 인원수만 있던 자리가 정산으로 비워진다",
      !idleAfter.body.party_size, JSON.stringify(idleAfter.body));
    const popup = await page.locator("#appDialogBackdrop").innerText();
    check("몇 자리를 비웠는지 팝업이 알려준다", /인원수만|자리도 같이 비웠/.test(popup), popup);
  }
  check("화면 팝업에도 LINE 을 보냈다고 알려준다",
    /LINE/.test(await page.locator("#appDialogBackdrop").innerText()),
    await page.locator("#appDialogBackdrop").innerText());
  await page.locator("#appDialogOk").click();
  await page.waitForTimeout(300);

  // ── 저녁 장사
  await put(`/api/tables/${T2}/party-size`, { partySize: 3 });
  const dinner = await post("/api/orders", { tableNumber: T2, items: [{ itemId: food.id, qty: 2 }] });
  await api(`/api/orders/${dinner.body.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "paid", paymentMethod: "card" }) });
  const dinnerPaid = store.orders.find((o) => o.id === dinner.body.id).total;

  out.push("");
  out.push("[🌙 오후(하루) 정산 — 오전과 오후를 갈라 보여준다]");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.locator("#settlePmBtn").click();
  await page.waitForTimeout(400);
  await page.locator("#appDialogOk").click();
  await page.waitForTimeout(1500);

  check("두 번째 문자가 나갔다", linePushes.length === 2, `${linePushes.length}통`);
  const dayText = linePushes[1] ? linePushes[1].text : "";
  check("하루 정산 문자다", /^🌙 \d+\/\d+ 하루 정산 \(\d\d:\d\d 마감\)/.test(dayText), dayText.split("\n")[0]);
  check("하루 매출은 점심+저녁",
    dayText.includes(`매출: NT$${(lunchPaid + dinnerPaid).toLocaleString()}`), dayText);
  check("오전 몫이 적힌다", dayText.includes(`오전 NT$${lunchPaid.toLocaleString()}`), dayText);
  check("오후 몫이 적힌다", dayText.includes(`오후 NT$${dinnerPaid.toLocaleString()}`), dayText);
  check("현금과 신용카드가 따로 잡힌다", /현금 NT\$/.test(dayText) && /신용카드 NT\$/.test(dayText), dayText);
  await page.locator("#appDialogOk").click();
  await page.waitForTimeout(300);

  out.push("");
  out.push("[밤 크론은 예비다 — 같은 날 세 번째 문자를 보내지 않는다]");
  const cron = await api("/api/settlements/cron-close");
  check("크론 자체는 정상 동작", cron.status === 200, JSON.stringify(cron.body));
  check("정산을 눌렀던 날이라 문자를 건너뛴다", cron.body && cron.body.line_skipped === true, JSON.stringify(cron.body));
  check("문자는 여전히 두 통", linePushes.length === 2, `${linePushes.length}통`);

  out.push("");
  out.push("[알림이 꺼져 있으면 보내지 않고, 왜 안 갔는지 알려준다]");
  store.settings.line_notify_enabled = false;
  await save();
  const off = await post("/api/settlements/shift-close", { shift: "am" });
  check("요청 자체는 성공", off.status === 200, `${off.status}`);
  check("보내지 않았다", off.body && off.body.line && off.body.line.sent === false);
  check("이유가 「꺼짐」이라고 돌아온다", off.body.line.error === "disabled", JSON.stringify(off.body.line));
  check("문자는 늘지 않았다", linePushes.length === 2, `${linePushes.length}통`);

  await browser.close();
  server.close();
  console.log(out.join("\n"));
  console.log("\n--- 오전 문자 ---\n" + amText);
  console.log("\n--- 하루 문자 ---\n" + dayText);
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
