// 모든 테이블을 하나하나 실제로 한 바퀴 돌린다.
//
// 2026-09-09 사장님: "주문서 출력이 어떤 테이블은 고객, 주방용 2가지로,
// 어쩔때는 주방만 나옴. 이게 주문서 출력도 그렇고 인원수 물어보는 것도
// 그래. 전에도 같은 문제 있었는데 한 번 더 확인해봐 너가 모든 테이블 전부
// 테스트해서 다 나오는지 확인해줘."
//
// 두 증상 모두 "어떤 테이블은 되고 어떤 테이블은 안 된다"이므로, 코드를
// 읽어서 짐작하지 않고 테이블 전부(포장 카운터 포함)에 대해 실제로
//   빈 테이블 → 인원수 물어봄 → 주문 → 주문서 2장 → 결제 → 다시 물어봄
// 한 바퀴를 돌려서 어느 테이블에서 깨지는지 이름을 찍어낸다.
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
process.env.SESSION_SECRET = "e2e-all-tables";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const { chromium } = require("playwright");
const app = require("../server");

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

  // 포장 카운터도 만들어서 같이 돌린다.
  await page.evaluate(() => fetch("/api/tables/counter", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
  const tableNumbers = await page.evaluate(async () => {
    const t = await (await fetch("/api/tables")).json();
    return t.map((x) => x.number);
  });
  check("테이블이 여러 개 있다", tableNumbers.length >= 10, `count=${tableNumbers.length}`);
  out.push(`  ·    돌릴 테이블: ${tableNumbers.length}개 (${tableNumbers.slice(0, 4).join(", ")} … ${tableNumbers.slice(-2).join(", ")})`);

  // ── 1바퀴: 빈 테이블에서 인원수를 묻는가 ────────────────────────────
  const cycle = await page.evaluate(async (numbers) => {
    const H = { "Content-Type": "application/json" };
    const j = async (url, opts) => {
      const r = await fetch(url, opts);
      let b = null; try { b = await r.json(); } catch {}
      return { status: r.status, body: b };
    };
    // /api/menu/admin 은 카테고리 배열이고 각 카테고리 안에 items 가 있다.
    // 예전엔 배열의 [0](=카테고리)을 메뉴로 착각해서 가격이 undefined 였다.
    const menu = await j("/api/menu/admin");
    const item = (menu.body || []).flatMap((c) => c.items || [])[0];

    const rows = [];
    for (const n of numbers) {
      const before = await j(`/api/tables/${encodeURIComponent(n)}/party-size`);
      const isCounter = !!(before.body && before.body.is_counter);
      // 손님 화면은 party_size 가 없으면 묻는다(initPartySize). 카운터는
      // 대신 이름/전화를 묻는다.
      const asksFirst = isCounter ? "counter" : !(before.body && before.body.party_size);

      // 인원수를 등록하고 주문한다.
      let setRes = { status: 0 };
      if (!isCounter) setRes = await j(`/api/tables/${encodeURIComponent(n)}/party-size`, { method: "PUT", headers: H, body: JSON.stringify({ partySize: 2 }) });
      const body = { tableNumber: n, items: [{ itemId: item && item.id, qty: 1 }] };
      if (isCounter) { body.customerName = "포장손님"; body.customerPhone = "0912345678"; }
      const order = await j("/api/orders", { method: "POST", headers: H, body: JSON.stringify(body) });

      rows.push({ n, isCounter, asksFirst, setStatus: setRes.status, orderStatus: order.status,
        orderId: order.body && order.body.id, orderErr: order.body && order.body.error });
    }
    return rows;
  }, tableNumbers);

  out.push("\n[1) 빈 테이블은 인원수를 묻는가]");
  const notAsked = cycle.filter((r) => r.asksFirst === false);
  check("빈 테이블은 전부 인원수를 묻는다", notAsked.length === 0,
    `안 묻는 테이블: ${notAsked.map((r) => r.n).join(", ")}`);
  const orderFailed = cycle.filter((r) => r.orderStatus !== 200 && r.orderStatus !== 201);
  check("모든 테이블에서 주문이 들어간다", orderFailed.length === 0,
    orderFailed.map((r) => `${r.n}:${r.orderStatus}/${r.orderErr}`).join(", "));

  // ── 2) 주문서가 테이블마다 2장(주방용+결제용) 나오는가 ──────────────
  out.push("\n[2) 주문서가 주방용+결제용 2장 나오는가]");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  // 실제 인쇄 경로(printKitchenTicket → window.open + buildDualTicketHtml)를
  // 그대로 타되, 종이 대신 문서를 가로챈다. 브라우저 인쇄 창을 실제로 띄우면
  // 40번 반복할 수 없으므로 window.open 을 가짜 창으로 바꾼다.
  await page.evaluate(() => {
    window.__tickets = [];
    const fakeDoc = () => {
      let html = "";
      return {
        open() { html = ""; },
        write(s) { html += s; },
        close() { window.__tickets.push(html); },
        get fonts() { return { ready: Promise.resolve() }; },
      };
    };
    window.open = () => ({ document: fakeDoc(), focus() {}, print() {} });
  });

  // 자동 인쇄가 이미 새 주문을 찍었을 수 있으니 여기서부터 새로 센다.
  await page.evaluate(() => { window.__tickets = []; });
  const printBtns = page.locator('.order-card button:has-text("인쇄")');
  const btnCount = await printBtns.count();
  check("주문 카드마다 인쇄 버튼이 있다", btnCount >= cycle.length, `버튼 ${btnCount}개 / 주문 ${cycle.length}건`);

  for (let i = 0; i < btnCount; i++) {
    await printBtns.nth(i).click();
    await page.waitForTimeout(90);
  }
  await page.waitForTimeout(600);

  const tickets = await page.evaluate(() => window.__tickets.map((h) => ({
    kitchen: (h.match(/廚房出單/g) || []).length,
    price: (h.match(/結帳單/g) || []).length,
    table: (h.match(/桌號\s*([^<\s]+)/) || [])[1] || (h.includes("外帶櫃檯") || h.includes("號 ·") ? "COUNTER" : "?"),
    len: h.length,
  })));
  check("인쇄를 누른 만큼 주문서가 만들어졌다", tickets.length === btnCount, `${tickets.length} vs ${btnCount}`);
  const missingPrice = tickets.filter((t) => t.price < 1);
  const missingKitchen = tickets.filter((t) => t.kitchen < 1);
  check("모든 주문서에 주방용(廚房出單)이 있다", missingKitchen.length === 0,
    `빠진 테이블: ${missingKitchen.map((t) => t.table).join(", ")}`);
  check("모든 주문서에 결제용(結帳單)이 있다", missingPrice.length === 0,
    `빠진 테이블: ${missingPrice.map((t) => t.table).join(", ")}`);
  const notExactlyOne = tickets.filter((t) => t.kitchen !== 1 || t.price !== 1);
  check("한 번 인쇄에 정확히 2장(각 1장씩)", notExactlyOne.length === 0,
    notExactlyOne.slice(0, 6).map((t) => `${t.table}:주방${t.kitchen}/결제${t.price}`).join(", "));

  // ── 2-b) 가게 태블릿이 실제로 쓰는 경로(앱 브릿지 → 비트맵 2장) ────
  // 브라우저 인쇄는 개발용 대비책이고, 가게에서는 안드로이드 POS 앱의
  // HangukgwanPrint.printBase64 로 나간다. 그 경로는 주방용을 먼저 보내고
  // 결제용을 이어서 보내는 "두 번의 전송"이라, 두 번째만 실패하면 정확히
  // 사장님이 본 증상("주방만 나옴")이 된다. 진짜 프린터 대신 브릿지를
  // 가짜로 심어서 주문마다 몇 장이 나가는지 센다.
  out.push("\n[2-b) 태블릿 앱 경로 — 주문마다 비트맵이 2장 나가는가]");
  await page.evaluate(() => {
    window.__sends = [];
    window.HangukgwanPrint = {
      printBase64(b64) {
        window.__sends.push(b64.length);
        return "queued";
      },
    };
  });
  const btns2 = page.locator('.order-card button:has-text("인쇄")');
  const n2 = await btns2.count();
  for (let i = 0; i < n2; i++) {
    await page.evaluate(() => { window.__sends = []; });
    await btns2.nth(i).click();
    await page.waitForTimeout(140);
    const sends = await page.evaluate(() => window.__sends.slice());
    if (sends.length !== 2) {
      check(`앱 경로: ${i + 1}번째 주문이 2장 나간다`, false, `${sends.length}장 (${sends.join(", ")})`);
    } else {
      pass++;
    }
  }
  out.push(`  ok   앱 경로: 주문 ${n2}건 전부 비트맵 2장씩 나간다`);

  // ── 3) 결제 후 인원수를 다시 묻는가 ─────────────────────────────────
  out.push("\n[3) 결제하고 나면 다음 손님에게 인원수를 다시 묻는가]");
  const after = await page.evaluate(async (rows) => {
    const H = { "Content-Type": "application/json" };
    const j = async (url, opts) => {
      const r = await fetch(url, opts);
      let b = null; try { b = await r.json(); } catch {}
      return { status: r.status, body: b };
    };
    const res = [];
    for (const r of rows) {
      if (!r.orderId) { res.push({ n: r.n, skipped: true }); continue; }
      const paid = await j(`/api/orders/${r.orderId}`, { method: "PATCH", headers: H,
        body: JSON.stringify({ status: "paid", paymentMethod: "cash" }) });
      const ps = await j(`/api/tables/${encodeURIComponent(r.n)}/party-size`);
      res.push({ n: r.n, isCounter: r.isCounter, paidStatus: paid.status,
        partySizeAfter: ps.body && ps.body.party_size });
    }
    return res;
  }, cycle);

  const paidFailed = after.filter((r) => !r.skipped && r.paidStatus !== 200);
  check("모든 주문이 결제 완료로 넘어간다", paidFailed.length === 0,
    paidFailed.map((r) => `${r.n}:${r.paidStatus}`).join(", "));
  const stale = after.filter((r) => !r.skipped && !r.isCounter && r.partySizeAfter);
  check("결제 후에는 인원수가 지워진다(=다음 손님에게 다시 묻는다)", stale.length === 0,
    `남아 있는 테이블: ${stale.map((r) => `${r.n}(${r.partySizeAfter}명)`).join(", ")}`);

  // ── 4) 실제 가게에서 벌어지는 어긋난 경우들 ─────────────────────────
  // 1~3번은 "정상 한 바퀴"라 전부 통과한다. 사장님이 겪는 건 그 바깥이므로
  // 여기서 실제로 있을 법한 경우를 하나씩 만들어 본다.
  out.push("\n[4) 정상 흐름 바깥]");
  const edge = await page.evaluate(async () => {
    const H = { "Content-Type": "application/json" };
    const j = async (url, opts) => {
      const r = await fetch(url, opts);
      let b = null; try { b = await r.json(); } catch {}
      return { status: r.status, body: b };
    };
    // /api/menu/admin 은 카테고리 배열이고 각 카테고리 안에 items 가 있다.
    // 예전엔 배열의 [0](=카테고리)을 메뉴로 착각해서 가격이 undefined 였다.
    const menu = await j("/api/menu/admin");
    const item = (menu.body || []).flatMap((c) => c.items || [])[0];
    const order = (n) => j("/api/orders", { method: "POST", headers: H,
      body: JSON.stringify({ tableNumber: n, items: [{ itemId: item && item.id, qty: 1 }] }) });
    const setPs = (n, size) => j(`/api/tables/${n}/party-size`, { method: "PUT", headers: H, body: JSON.stringify({ partySize: size }) });
    const getPs = (n) => j(`/api/tables/${n}/party-size`);
    const pay = (id) => j(`/api/orders/${id}`, { method: "PATCH", headers: H, body: JSON.stringify({ status: "paid", paymentMethod: "cash" }) });
    const cancel = (id) => j(`/api/orders/${id}`, { method: "PATCH", headers: H, body: JSON.stringify({ status: "cancelled" }) });

    const r = {};

    // (a) 손님이 인원수만 찍고 주문 없이 나갔다 — 흔하다. 자리를 뜨거나,
    //     메뉴 보고 마음이 바뀌거나, QR만 찍어보고 만 경우.
    //     방금 찍은 건 당연히 유지돼야 하고(메뉴 고르는 중), 오래된 건
    //     버려져야 한다. 시간을 되돌릴 수 없으니 등록 시각을 과거로 옮겨
    //     "3시간 전에 찍고 나간 테이블"을 만든다.
    await setPs("11", 4);
    r.a_justNow = (await getPs("11")).body.party_size; // 유지돼야 함
    r.__ageThese = ["11"]; // 아래에서 Node 쪽이 시각을 과거로 옮긴다

    // (a2) 오래 드시는 손님 — 주문이 살아 있으면 3시간이 지나도 유지돼야
    //      한다. 식사 중에 인원수를 다시 묻는 건 원래 문제만큼 나쁘다.
    await setPs("16", 6);
    await order("16");
    r.__ageThese.push("16");

    // (b) 주문을 넣었다가 전부 취소했다.
    await setPs("12", 3);
    const o12 = await order("12");
    await cancel(o12.body.id);
    r.b_afterCancel = (await getPs("12")).body.party_size;

    // (c) 1차 결제하고 같은 손님이 2차 주문(추가 주문)을 한다.
    await setPs("13", 2);
    const o13a = await order("13");
    await pay(o13a.body.id);
    r.c_afterFirstRoundPaid = (await getPs("13")).body.party_size;
    const o13b = await order("13");
    r.c_secondRoundOrderStatus = o13b.status;
    r.c_secondRoundError = o13b.body && o13b.body.error;

    // (d) 두 라운드가 살아 있는 상태에서 한 라운드만 결제.
    await setPs("15", 5);
    const o15a = await order("15");
    const o15b = await order("15");
    await pay(o15a.body.id);
    r.d_oneRoundPaid = (await getPs("15")).body.party_size;
    await pay(o15b.body.id);
    r.d_bothPaid = (await getPs("15")).body.party_size;

    return r;
  });

  // (a) 이게 진짜 문제다. 인원수만 찍고 주문 없이 나가면 지워주는 사람이
  //     아무도 없다 — 결제도 취소도 없으니 정리 규칙이 걸리지 않는다.
  //     다음 손님은 앞 손님 인원수를 그대로 물려받고 아예 안 물어본다.
  // 시간을 되돌릴 수 없으므로, 등록 시각만 과거로 옮겨 "몇 시간 전에 찍고
  // 나간 테이블"을 만든다. 테스트 전용 라우트를 제품 코드에 뚫는 대신
  // (그런 뒷문은 언젠가 운영에서 열린다) 이 테스트가 앱과 같은 프로세스에서
  // 도는 점을 이용해 저장소를 직접 만진다.
  {
    const { store, save } = require("../src/db");
    for (const n of edge.__ageThese) {
      const t = store.tables.find((x) => x.number === n);
      t.party_size_updated_at = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    }
    await save();
  }
  const aged = await page.evaluate(async () => {
    const g = async (n) => (await (await fetch(`/api/tables/${n}/party-size`)).json()).party_size;
    return { a_leftWithoutOrdering: await g("11"), a2_longMeal: await g("16") };
  });
  edge.a_leftWithoutOrdering = aged.a_leftWithoutOrdering;
  edge.a2_longMeal = aged.a2_longMeal;

  check("(a) 방금 인원수를 찍은 손님은 다시 묻지 않는다", edge.a_justNow === 4, `${edge.a_justNow}`);
  check("(a) 주문 없이 인원수만 찍고 나간 뒤에는 다음 손님에게 다시 묻는다",
    !edge.a_leftWithoutOrdering, `남은 인원수: ${edge.a_leftWithoutOrdering}`);
  check("(a2) 오래 드시는 손님(주문 살아 있음)의 인원수는 지우지 않는다",
    edge.a2_longMeal === 6, `${edge.a2_longMeal}`);
  check("(b) 주문을 전부 취소하면 인원수가 지워진다", !edge.b_afterCancel, `남은 인원수: ${edge.b_afterCancel}`);
  check("(c) 1차 결제 후 인원수가 지워진다", !edge.c_afterFirstRoundPaid, `남은 인원수: ${edge.c_afterFirstRoundPaid}`);
  // 결제가 끝난 테이블은 "그 손님이 더 시키는 것"과 "새 손님이 앉은 것"을
  // 서버가 구별할 수 없다. 그래서 다시 묻는 게 맞다 — 손님 화면도 그때
  // 인원수 창을 다시 띄운다(order.js 의 party_size_required 처리). 잘못된
  // 인원수를 물려주는 것보다 한 번 더 묻는 쪽을 택한다.
  check("(c) 결제 끝난 테이블의 새 주문은 인원수를 다시 묻는다(의도된 동작)",
    edge.c_secondRoundError === "party_size_required", `${edge.c_secondRoundOrderStatus} / ${edge.c_secondRoundError}`);
  check("(d) 한 라운드만 결제하면 인원수가 그대로 남는다(손님이 아직 앉아 있다)",
    !!edge.d_oneRoundPaid, `인원수: ${edge.d_oneRoundPaid}`);
  check("(d) 전부 결제하면 지워진다", !edge.d_bothPaid, `남은 인원수: ${edge.d_bothPaid}`);

  const shots = path.join(__dirname, "..", "..", "..", "_screens");
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, "all-tables.png") });

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
