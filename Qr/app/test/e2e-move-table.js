// 앉아 있는 손님을 다른 자리로 옮길 수 있는가.
//
// 2026-09-10 사장님: "손님이 주문하고 난 후에도 좌석 이동을 가능하게 해줘.
// 지금은 합산 결제 기능만 있는데 자리 이동 만들어줘."
//
// 합산 결제와 다른 일이다. 합산 결제는 결제할 때만 합칠 뿐 주문이 어느
// 테이블 것인지는 그대로 두는데(그쪽 주석 참고), 자리를 옮기는 건 지금부터
// 그 손님이 저 자리에 있다는 뜻이다 — 다음 주문도, 결산의 테이블별 매출도
// 새 자리로 가야 한다.
//
// 여기서 제일 조심할 것은 이미 결제된 주문이다. 그건 그 자리에서 실제로
// 일어난 매출이라 옮기면 그날 테이블별 매출이 사실과 달라진다.
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
process.env.SESSION_SECRET = "e2e-move-table";
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
  await require("./disable-order-hours")();
  check("사장 로그인", await page.locator("#dashboard").isVisible());

  const tabless = store.tables.filter((t) => !t.is_counter);
  const A = tabless[0].number;
  const B = tabless[1].number;
  const C = tabless[2].number;
  const itemId = store.menuItems[0].id;

  const api = (url, opts) => page.evaluate(async ([u, o]) => {
    const r = await fetch(u, o || undefined);
    let b = null; try { b = await r.json(); } catch (e) {}
    return { status: r.status, body: b };
  }, [url, opts]);
  const post = (url, body) => api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const put = (url, body) => api(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  await put(`/api/tables/${A}/party-size`, { partySize: 3 });
  const first = await post("/api/orders", { tableNumber: A, items: [{ itemId, qty: 1 }] });
  const second = await post("/api/orders", { tableNumber: A, items: [{ itemId, qty: 2 }] });
  check("주문 두 건이 만들어졌다", first.status === 201 && second.status === 201,
    `${first.status}/${second.status}`);
  // 이미 결제된 주문 한 건 — 이건 그 자리에 남아야 한다.
  const paid = await post("/api/orders", { tableNumber: A, items: [{ itemId, qty: 1 }] });
  await api(`/api/orders/${paid.body.id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "paid" }),
  });

  out.push("\n[빈 자리로 옮긴다]");
  const moved = await post("/api/orders/move", { from: A, to: B });
  check("옮겨진다", moved.status === 200, JSON.stringify(moved));
  check("미결제 주문 두 건만 옮겼다", moved.body.moved === 2, JSON.stringify(moved.body));
  {
    const all = (await api("/api/orders")).body;
    const byId = Object.fromEntries(all.map((o) => [o.id, o]));
    check("첫 주문이 새 자리에 있다", String(byId[first.body.id].table_number) === String(B));
    check("둘째 주문도 새 자리에 있다", String(byId[second.body.id].table_number) === String(B));
    // 이미 결제된 주문은 그 자리에서 실제로 일어난 매출이다.
    check("결제된 주문은 옛 자리에 남는다", String(byId[paid.body.id].table_number) === String(A),
      String(byId[paid.body.id].table_number));
    check("어디서 왔는지 남는다", String(byId[first.body.id].moved_from) === String(A),
      byId[first.body.id].moved_from);
  }
  {
    const tables = (await api("/api/tables")).body;
    const a = tables.find((t) => String(t.number) === String(A));
    const b = tables.find((t) => String(t.number) === String(B));
    // 옮긴 자리에서 인원수를 다시 물어보면 안 된다.
    check("인원수도 따라간다", b.party_size === 3, `${b.party_size}`);
    check("옛 자리 인원수는 비워진다", !a.party_size, `${a.party_size}`);
  }

  out.push("\n[이미 손님이 있는 자리로 합친다]");
  await put(`/api/tables/${C}/party-size`, { partySize: 2 });
  await post("/api/orders", { tableNumber: C, items: [{ itemId, qty: 1 }] });
  const merged = await post("/api/orders/move", { from: B, to: C });
  check("합쳐진다", merged.status === 200, JSON.stringify(merged));
  {
    const tables = (await api("/api/tables")).body;
    const c = tables.find((t) => String(t.number) === String(C));
    // 한 테이블이 됐으니 1인당 최소 주문 같은 계산도 합친 인원으로 봐야 한다.
    check("인원수가 더해진다", c.party_size === 5, `${c.party_size}`);
    const all = (await api("/api/orders")).body;
    check("세 건이 한 자리에 모인다",
      all.filter((o) => String(o.table_number) === String(C) && o.status !== "paid").length === 3);
  }

  out.push("\n[막아야 하는 것들]");
  check("같은 자리로는 못 옮긴다", (await post("/api/orders/move", { from: C, to: C })).status === 400);
  check("옮길 게 없으면 막는다", (await post("/api/orders/move", { from: A, to: B })).status === 400);
  check("없는 자리로는 못 옮긴다", (await post("/api/orders/move", { from: C, to: "9999" })).status === 404);
  {
    // 포장 카운터는 자리가 아니다 — 주문들이 서로 무관한 손님 것이라
    // 테이블로 옮기면 누구 것인지 알 수 없어진다.
    await post("/api/tables/counter", {});
    const tables = (await api("/api/tables")).body;
    const counter = tables.find((t) => t.is_counter);
    const r = await post("/api/orders/move", { from: C, to: counter.number });
    check("포장 카운터로는 못 옮긴다", r.status === 400 && r.body.error === "counter_not_movable", JSON.stringify(r));
  }
  {
    // 로그인하지 않은 사람은 남의 손님을 옮길 수 없다.
    const guest = await browser.newContext();
    const gp = await guest.newPage();
    await gp.goto(`${base}/t/${C}`, { waitUntil: "networkidle" });
    const r = await gp.evaluate(async ([from, to]) => {
      const res = await fetch("/api/orders/move", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      return res.status;
    }, [String(C), String(A)]);
    check("로그인 안 하면 못 옮긴다", r === 401 || r === 403, `${r}`);
    await guest.close();
  }

  out.push("\n[화면에서]");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  {
    // 주방에는 이미 옛 번호가 찍힌 티켓이 나가 있다 — 화면에서 그 연결을
    // 볼 수 없으면 "저 주문이 왜 여기 있지" 가 된다.
    check("옮겨온 주문에 표시가 붙는다", (await page.locator(".order-card-moved").count()) >= 1,
      `${await page.locator(".order-card-moved").count()}`);
  }
  await page.locator('.admin-tabs button[data-tab="tables"]').click();
  await page.waitForTimeout(600);
  await page.evaluate((n) => {
    const chip = [...document.querySelectorAll(".table-chip")].find((c) => c.textContent.includes(n));
    if (chip) chip.click();
  }, String(C));
  await page.waitForTimeout(600);
  check("자리 이동 버튼이 있다", await page.locator("#moveTableBtn").isVisible());
  await page.locator("#moveTableBtn").click();
  await page.waitForTimeout(400);
  check("옮길 자리 목록이 열린다", await page.locator("#moveTableBackdrop").isVisible());
  check("자기 자리는 목록에 없다",
    !(await page.locator("#moveTableGrid .table-picker-btn").allInnerTexts()).some((x) => x.trim() === String(C)));
  check("포장 카운터도 목록에 없다",
    !(await page.locator("#moveTableGrid .table-picker-btn").allInnerTexts()).some((x) => /COUNTER|포장|櫃檯/.test(x)));

  await browser.close();
  server.close();
  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
