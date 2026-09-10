// 자리를 없앨 때 무엇이 지켜지는가.
//
// 2026-09-10 사장님: "테이블 0은 대체 뭐야. 포장으로 해야지."
//
// 포장 손님이 「테이블 0」 으로 들어오고 있었다. 진짜 포장 카운터는 따로
// 멀쩡히 있는데(is_counter, 번호 COUNTER), 손님에게 나가던 QR 이 번호 0 짜리
// 일반 테이블을 가리키고 있었다. 아무도 못 알아챈 이유는 화면과 인쇄물이
// 자리를 「라벨 있으면 라벨, 없으면 번호」로만 적어서, 라벨이 「포장」이면
// 번호 0 이 어디에도 안 보였기 때문이다.
//
// 정리하려면 그 자리를 지워야 한다. 그런데 지우는 순간 두 가지가 위험하다 —
// 그 자리에 아직 못 받은 돈이 있을 수 있고, 이미 손님 손에 나가 있는 옛 QR
// 이 가리킬 곳을 잃는다. 여기서 그 둘을 잰다.
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
process.env.SESSION_SECRET = "e2e-table-delete";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const { launchBrowser } = require("./browser");
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
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
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
  const del = (url) => api(url, { method: "DELETE" });

  // 운영에 있던 그 자리를 그대로 만든다 — 번호 0, 라벨 "포장".
  const made = await post("/api/tables", { number: "0", label: "포장" });
  check("번호 0 짜리 자리를 만들 수 있다(운영에 실제로 이렇게 있었다)", made.status === 201, JSON.stringify(made.body));
  const T0 = made.body.id;
  const food = store.menuItems.find((m) => !m.min_first_order_qty);

  out.push("[못 받은 돈이 남은 자리는 지워지지 않는다]");
  await put("/api/tables/0/party-size", { adults: 1, children: 0 });
  const order = await post("/api/orders", { tableNumber: "0", items: [{ itemId: food.id, qty: 1 }] });
  check("그 자리에 주문이 들어간다", order.status === 201, JSON.stringify(order.body));
  {
    const r = await del(`/api/tables/${T0}`);
    check("삭제가 거절된다", r.status === 400, `${r.status}`);
    check("이유가 「못 받은 돈」 이라고 돌아온다", r.body && r.body.error === "table_has_unpaid_orders", JSON.stringify(r.body));
    check("자리는 그대로 살아 있다", (await api("/api/tables/0/party-size")).status === 200);
  }

  out.push("");
  out.push("[손님이 앉아만 계셔도 지워지지 않는다]");
  await api(`/api/orders/${order.body.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "cancelled" }) });
  {
    // 취소는 인원수를 지우지 않는다 — 사람은 아직 그 자리에 있다.
    const r = await del(`/api/tables/${T0}`);
    check("삭제가 거절된다", r.status === 400, `${r.status}`);
    check("이유가 「앉아 계심」 이라고 돌아온다", r.body && r.body.error === "table_seated", JSON.stringify(r.body));
  }

  out.push("");
  out.push("[포장 카운터는 아예 지울 수 없다]");
  {
    // 포장 카운터는 처음 쓰일 때 만들어진다(src/routes/tables.js 의
    // getOrCreateCounterTable) — 갓 만든 DB 에는 아직 없으므로 먼저 부른다.
    await post("/api/tables/counter", {});
    const counter = (await api("/api/tables")).body.find((t) => t.is_counter);
    check("포장 카운터가 있다", !!counter);
    const r = await del(`/api/tables/${counter.id}`);
    check("삭제가 거절된다", r.status === 400, `${r.status}`);
    check("이유가 「카운터」 라고 돌아온다", r.body && r.body.error === "counter_not_deletable", JSON.stringify(r.body));
    check("카운터는 그대로 살아 있다", (await api("/api/tables/COUNTER/party-size")).body.is_counter === true);
  }

  out.push("");
  out.push("[QR 인쇄 시트가 번호를 가리지 않는다]");
  {
    // 여기가 이번 일이 안 보였던 자리다 — 라벨만 찍으면 「포장」 이라는
    // 이름의 일반 테이블이 포장 카운터 행세를 해도 아무도 모른다.
    const sheet = await page.evaluate(async () => (await fetch("/api/tables/qr-sheet")).text());
    check("라벨이 보인다", sheet.includes("포장"), "");
    check("번호도 같이 보인다", sheet.includes("0번"), "");
    check("포장 카운터에는 번호를 안 붙인다(자리가 아니다)", !sheet.includes("COUNTER번"), "");
  }

  out.push("");
  out.push("[관리자 화면에서도 번호가 라벨에 가려지지 않는다]");
  {
    // 「外帶」 라는 이름의 0번 테이블이 포장 카운터 행세를 하던 자리다.
    // 목록에도 수기 주문 창에도 번호가 같이 보여야 두 개를 구분할 수 있다.
    await page.reload({ waitUntil: "networkidle" });
    await page.locator('.admin-tabs button[data-tab="tables"]').click();
    await page.waitForTimeout(1200);
    const chips = await page.evaluate(() =>
      [...document.querySelectorAll("#tableChips .num, .table-chip .num")].map((el) => el.textContent.trim())
    );
    check("목록 칩이 「포장 0」 처럼 번호까지 적는다", chips.some((c) => /포장\s*0$/.test(c)), JSON.stringify(chips.slice(0, 40)));

    // 수기 주문 버튼은 실시간 주문 탭 툴바에 있다.
    await page.locator('.admin-tabs button[data-tab="orders"]').click();
    await page.waitForTimeout(600);
    await page.locator("#manualOrderBtn").click();
    await page.waitForTimeout(600);
    const picker = await page.evaluate(() =>
      [...document.querySelectorAll("#manualOrderGrid button")].map((el) => el.textContent.trim())
    );
    check("수기 주문 창도 번호까지 적는다", picker.some((c) => /포장\s*0$/.test(c)), JSON.stringify(picker.slice(0, 40)));
    // 포장 카운터는 번호가 없다 — 자리가 아니다.
    check("포장 카운터에는 번호를 안 붙인다", picker.some((c) => /^포장 카운터$/.test(c)), JSON.stringify(picker));
    await page.locator("#manualOrderClose").click();
    await page.waitForTimeout(300);
  }

  out.push("");
  out.push("[정리가 끝난 자리는 지워진다]");
  await del("/api/tables/0/party-size"); // 손님 나감
  {
    const r = await del(`/api/tables/${T0}`);
    check("이제 지워진다", r.status === 200, JSON.stringify(r.body));
    check("정말 없어졌다", (await api("/api/tables/0/party-size")).status === 404);
  }

  out.push("");
  out.push("[손님 손에 남은 옛 QR — 헛걸음시키지 않는다]");
  {
    // 자리를 지우고 나면 이미 인쇄돼 나간 QR 이 이 상태가 된다.
    const guest = await browser.newContext({ viewport: { width: 420, height: 900 } });
    const gp = await guest.newPage();
    gp.on("dialog", (d) => d.dismiss());
    await gp.goto(`${base}/t/0`, { waitUntil: "networkidle" });
    await gp.waitForTimeout(1200);

    const banner = gp.locator("#closedBanner");
    check("안내가 뜬다", await banner.isVisible());
    const text = await banner.innerText();
    check("「이 QR 은 더 이상 사용하지 않는다」 고 말한다", /더 이상 사용|不使用|no longer in use/.test(text), text);
    check("무엇을 하면 되는지도 적혀 있다", /직원|店員|staff|카운터|櫃檯|counter/.test(text), text);
    // 인원수부터 묻고 실패하는 옛 동작이 남아 있으면 안 된다.
    check("인원수를 묻지 않는다", !(await gp.locator("#partySizeBackdrop").isVisible()));
    check("주문 버튼이 잠겨 있다", await gp.locator("#submitOrderBtn").isDisabled());
    {
      // 사장님이 문구를 눈으로 보고 고칠 수 있게 남긴다.
      const fs = require("fs");
      const path = require("path");
      const dir = path.join(__dirname, "..", "..", "..", "_screens");
      fs.mkdirSync(dir, { recursive: true });
      await gp.screenshot({ path: path.join(dir, "old-qr-notice.png"), clip: { x: 0, y: 0, width: 420, height: 320 } });
    }
    await guest.close();
  }

  await browser.close();
  server.close();
  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
