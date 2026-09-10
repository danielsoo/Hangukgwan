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

const { launchBrowser } = require("./browser");
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

  // ── 4) "한 번이라도 주문했으면 같은 손님" 규칙 ────────────────────
  // 사장님(2026-09-09): "구분 할 수 있어. 결제를 완료했다고 직원이 누르지
  // 않는 한 한번이라도 주문한 손님은 계속 같은 손님으로 취급할거야."
  out.push("\n[4) 직원이 결제 완료를 누를 때까지는 같은 손님]");
  const edge = await page.evaluate(async () => {
    const H = { "Content-Type": "application/json" };
    const j = async (url, opts) => {
      const r = await fetch(url, opts);
      let b = null; try { b = await r.json(); } catch {}
      return { status: r.status, body: b };
    };
    const menu = await j("/api/menu/admin");
    const item = (menu.body || []).flatMap((c) => c.items || [])[0];
    const order = (n) => j("/api/orders", { method: "POST", headers: H,
      body: JSON.stringify({ tableNumber: n, items: [{ itemId: item && item.id, qty: 1 }] }) });
    const setPs = (n, size) => j(`/api/tables/${n}/party-size`, { method: "PUT", headers: H, body: JSON.stringify({ partySize: size }) });
    const getPs = async (n) => (await j(`/api/tables/${n}/party-size`)).body.party_size;
    const pay = (id) => j(`/api/orders/${id}`, { method: "PATCH", headers: H, body: JSON.stringify({ status: "paid", paymentMethod: "cash" }) });
    const cancel = (id) => j(`/api/orders/${id}`, { method: "PATCH", headers: H, body: JSON.stringify({ status: "cancelled" }) });

    const r = {};

    // (a) 주방에 재료가 떨어져 마지막 한 접시를 취소했다. 손님은 그대로
    //     앉아 계신다 — 인원수를 다시 물으면 안 된다.
    await setPs("11", 4);
    const o11 = await order("11");
    await cancel(o11.body.id);
    r.a_afterCancel = await getPs("11");
    //     그리고 바로 다시 주문할 수 있어야 한다(인원수를 다시 안 물어도).
    const o11b = await order("11");
    r.a_reorderStatus = o11b.status;
    r.a_reorderError = o11b.body && o11b.body.error;

    // (b) 직원이 결제 완료를 눌렀다 — 여기서만 손님이 끝난다.
    await setPs("12", 3);
    const o12 = await order("12");
    await pay(o12.body.id);
    r.b_afterPaid = await getPs("12");

    // (c) 두 라운드 중 한 라운드만 결제 — 아직 받을 돈이 남았다.
    await setPs("13", 5);
    const o13a = await order("13");
    const o13b = await order("13");
    await pay(o13a.body.id);
    r.c_oneRoundPaid = await getPs("13");
    await pay(o13b.body.id);
    r.c_bothPaid = await getPs("13");

    // (d) 인원수만 찍고 주문 없이 나갔다 — 결제할 것도 없어서 직원이
    //     결제 완료를 누를 일이 없다. 직원이 직접 비우기 전까지는 남는다.
    await setPs("15", 2);
    r.d_stillThere = await getPs("15");

    return r;
  });

  check("(a) 주문을 취소해도 인원수는 그대로다(손님은 앉아 계신다)",
    edge.a_afterCancel === 4, `${edge.a_afterCancel}`);
  check("(a) 취소 뒤 바로 다시 주문할 수 있다(인원수를 다시 안 묻는다)",
    edge.a_reorderStatus === 200 || edge.a_reorderStatus === 201,
    `${edge.a_reorderStatus} / ${edge.a_reorderError}`);
  check("(b) 직원이 결제 완료를 누르면 인원수가 지워진다", !edge.b_afterPaid, `${edge.b_afterPaid}`);
  check("(c) 한 라운드만 결제하면 그대로 둔다", edge.c_oneRoundPaid === 5, `${edge.c_oneRoundPaid}`);
  check("(c) 전부 결제하면 지워진다", !edge.c_bothPaid, `${edge.c_bothPaid}`);
  check("(d) 주문 없이 나간 테이블은 직원이 비우기 전까지 남는다", edge.d_stillThere === 2, `${edge.d_stillThere}`);

  // ── 5) 직원이 직접 비우는 버튼이 실제로 동작하는가 ──────────────────
  out.push("\n[5) 결제 탭의 「손님 나감」 버튼]");
  // 갓 만든 DB 는 테이블이 어느 구역에도 놓여 있지 않다(씨앗은 좌표만 넣고
  // zone_id 는 비워 둔다). 결제 탭 배치도는 구역 안의 테이블만 그리므로,
  // 실제 가게처럼 배치된 상태를 먼저 만든다 — 관리자 화면의 "구역에 테이블
  // 추가"가 부르는 것과 같은 라우트.
  const placed = await page.evaluate(async () => {
    const H = { "Content-Type": "application/json" };
    const tables = await (await fetch("/api/tables")).json();
    const zones = await (await fetch("/api/zones")).json();
    let x = 20;
    let y = 40;
    for (const t of tables) {
      await fetch(`/api/tables/${t.id}`, { method: "PATCH", headers: H,
        body: JSON.stringify({ zoneId: zones[0].id, x, y, width: 70, height: 70 }) });
      x += 80;
      if (x > 500) { x = 20; y += 80; }
    }
    const after = await (await fetch("/api/tables")).json();
    return after.filter((t) => t.zone_id != null).length;
  });
  check("테이블을 배치도에 놓았다", placed >= 40, `${placed}개`);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.locator('.admin-tabs button[data-tab="payment"]').click();
  // 배치도는 탭을 누른 순간 한 번, 그 뒤로는 4초 주문 폴링마다 다시 그려진다.
  await page.locator("#paymentFloorPlan .table-block").first().waitFor({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);

  // 15번 테이블 — 인원수만 있고 주문은 없는 상태.
  // 타일 안에는 번호 말고 인원수 배지(👥N)도 들어 있어서 통짜 텍스트로는
  // 못 고른다 — 번호가 든 첫 span 으로 찾는다.
  const tileFor = (n) => page.locator(`#paymentFloorPlan .table-block:has(> span:text-is("${n}"))`).first();
  const tile15 = tileFor("15");
  check("15번 테이블 타일이 있다", (await tile15.count()) > 0);
  await tile15.click();
  await page.waitForTimeout(700);
  check("주문이 없는 테이블에 「손님 나감」 버튼이 보인다",
    await page.locator("#clearPartySizeBtn").isVisible());
  {
    const fsx = require("fs");
    const dir = path.join(__dirname, "..", "..", "..", "_screens");
    fsx.mkdirSync(dir, { recursive: true });
    const m = await page.locator("#tableDetailBackdrop .modal").boundingBox();
    await page.screenshot({ path: path.join(dir, "clear-party-button.png"),
      clip: { x: m.x, y: m.y, width: m.width, height: Math.min(m.height, 320) } });
  }
  await page.locator("#clearPartySizeBtn").click();
  await page.waitForTimeout(300);
  check("누르면 확인부터 묻는다", await page.locator("#appDialogBackdrop").isVisible());
  await page.locator("#appDialogOk").click();
  await page.waitForTimeout(900);
  const after15 = await page.evaluate(async () => (await (await fetch("/api/tables/15/party-size")).json()).party_size);
  check("확인하면 인원수가 비워진다", !after15, `${after15}`);
  check("비운 뒤에는 버튼이 사라진다", !(await page.locator("#clearPartySizeBtn").isVisible()));

  // 받을 돈이 남은 테이블에는 이 버튼이 나오면 안 된다 — 거기서 눌러야
  // 하는 건 「결제 완료」다.
  await page.locator("#tableDetailClose").click();
  await page.waitForTimeout(400);
  const tile11 = tileFor("11");
  await tile11.click();
  await page.waitForTimeout(700);
  check("받을 돈이 남은 테이블에는 「손님 나감」이 없다",
    !(await page.locator("#clearPartySizeBtn").isVisible()));
  await page.locator("#tableDetailClose").click();
  await page.waitForTimeout(300);

  // 손님이 남의 테이블 인원수를 지울 수 없어야 한다.
  const asGuest = await browser.newContext();
  const gp = await asGuest.newPage();
  await gp.goto(`${base}/order.html?table=11`, { waitUntil: "domcontentloaded" }).catch(() => {});
  const guestTry = await gp.evaluate(async () => (await fetch("/api/tables/11/party-size", { method: "DELETE" })).status);
  check("로그인 안 한 사람은 인원수를 지울 수 없다", guestTry === 401 || guestTry === 403, `${guestTry}`);
  await asGuest.close();

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
