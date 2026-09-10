// 손님이 자기 주문내역에서 자기 주문을 볼 수 있는가.
//
// 2026-09-10 사장님: "내 폰에서 직원이 수기로 추가한 주문도 qr 코드
// 주문내역에도 안 떠." / "둘 다 같은 테이블이었고 아직 주문이 없다고 떠."
//
// 원인은 결제였다. 손님 주문내역이 결제된 주문을 빼고 보여주고 있어서,
// 한 라운드를 결제하는 순간 아직 앉아 계신 손님 화면에서 그 주문이 사라졌다.
// 사장님 규칙은 "전체 결제를 하지 않는 이상 같은 손님" 이므로, 앉아 있는
// 동안에는 이미 결제한 라운드도 자기 주문내역에 남아야 한다.
//
// 여기서 제일 조심할 것은 돈이다. 「합계」와 온라인 결제 금액은 아직 안 낸
// 것만이어야 한다 — 결제된 것까지 더하면 화면 숫자와 실제 청구액이 어긋난다.
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
process.env.SESSION_SECRET = "e2e-history-paid";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const path = require("path");
const fs = require("fs");
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
  const admin = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await admin.newPage();
  page.on("dialog", (d) => d.dismiss());
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "ownerpass123" }) });
  });
  await page.reload({ waitUntil: "networkidle" });
  await require("./disable-order-hours")();

  const api = (url, opts) => page.evaluate(async ([u, o]) => {
    const r = await fetch(u, o || undefined);
    let b = null; try { b = await r.json(); } catch (e) {}
    return { status: r.status, body: b };
  }, [url, opts]);
  const post = (url, body) => api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const put = (url, body) => api(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  const T = store.tables.find((t) => !t.is_counter).number;
  const itemId = store.menuItems[0].id;
  await put(`/api/tables/${T}/party-size`, { partySize: 2 });

  // 직원이 수기로 넣은 주문 — 손님 폰이 아니라 관리자 세션에서 들어간다.
  const staffRound = await post("/api/orders", { tableNumber: T, items: [{ itemId, qty: 1 }] });
  check("직원 수기 주문이 들어간다", staffRound.status === 201, JSON.stringify(staffRound));

  const guest = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const gp = await guest.newPage();
  gp.on("dialog", (d) => d.dismiss());
  await gp.goto(`${base}/t/${T}`, { waitUntil: "networkidle" });
  await gp.waitForTimeout(500);

  async function openHistory() {
    await gp.locator("#historyBtn").click();
    await gp.waitForTimeout(600);
    return {
      text: await gp.locator("#historyList").innerText(),
      total: await gp.locator("#historyTotalBig").innerText(),
      paidRows: await gp.locator("#historyList .history-item.paid").count(),
      close: async () => {
        await gp.locator("#historyClose").click();
        await gp.waitForTimeout(200);
      },
    };
  }

  out.push("[직원이 대신 넣은 주문도 손님 주문내역에 뜬다]");
  // 손님 폰은 그 주문을 넣은 적이 없다(localStorage 에 없다). 자기 폰으로
  // 넣은 것만 보여주면 직원이 대신 넣은 주문은 영영 안 보인다.
  {
    const h = await openHistory();
    check("「아직 주문이 없어요」가 아니다",
      (await gp.locator("#historyList .history-item").count()) >= 1, h.text);
    check("금액이 잡힌다", !/^\D*0\D*$/.test(h.total), h.total);
    await h.close();
  }

  out.push("\n[한 라운드를 결제해도 사라지지 않는다]");
  // 여기가 사장님이 겪은 그 자리다. 결제하는 순간 손님 화면이 비어 버렸다.
  const second = await post("/api/orders", { tableNumber: T, items: [{ itemId, qty: 2 }] });
  await api(`/api/orders/${staffRound.body.id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "paid" }),
  });
  {
    const h = await openHistory();
    check("결제한 라운드가 목록에 남는다", h.paidRows >= 1, `paidRows=${h.paidRows}`);
    check("결제 완료라고 표시된다", /결제 완료|已結帳|paid/.test(h.text), h.text);
    check("이미 낸 금액을 따로 알려준다", /이미 결제|已結帳金額|Already paid/.test(h.text), h.text);
    // 합계는 아직 안 낸 것만 — 여기에 결제된 것까지 더하면 화면과 실제
    // 청구액이 어긋난다(서버는 미결제만 청구한다).
    const unpaidTotal = second.body.total;
    check("합계는 아직 안 낸 금액만", h.total.replace(/\D/g, "") === String(unpaidTotal),
      `${h.total} vs ${unpaidTotal}`);
    {
      const shots = path.join(__dirname, "..", "..", "..", "_screens");
      fs.mkdirSync(shots, { recursive: true });
      await gp.screenshot({ path: path.join(shots, "history-paid.png") });
    }
    await h.close();
  }

  out.push("\n[전체 결제하면 다음 손님은 빈 화면에서 시작한다]");
  // 앉은 시각이 경계라, 전체 결제로 인원수가 지워지면 그 뒤의 손님에게는
  // 앞 손님 주문이 보이지 않아야 한다.
  await api(`/api/orders/${second.body.id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "paid" }),
  });
  {
    const t = (await api("/api/tables")).body.find((x) => String(x.number) === String(T));
    check("전체 결제로 인원수가 지워진다", !t.party_size, `${t.party_size}`);
    const next = await browser.newContext({ viewport: { width: 420, height: 900 } });
    const np = await next.newPage();
    np.on("dialog", (d) => d.dismiss());
    await np.goto(`${base}/t/${T}`, { waitUntil: "networkidle" });
    await np.waitForTimeout(600);
    // 새 손님에게는 인원수부터 묻는다 — 그 창이 떠 있는 것 자체가 앞 손님이
    // 끝났다는 뜻이다.
    check("새 손님에게는 인원수를 묻는다", await np.locator("#partySizeBackdrop").isVisible());
    await np.locator("#partySizeConfirmBtn").click();
    await np.waitForTimeout(400);
    await np.locator("#historyBtn").click();
    await np.waitForTimeout(600);
    check("다음 손님에게는 앞 손님 주문이 안 보인다",
      (await np.locator("#historyList .history-item").count()) === 0,
      await np.locator("#historyList").innerText());
    await next.close();
  }

  await browser.close();
  server.close();
  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
