// 결제 방식 고르는 칸이 누를 만큼 큰가 — 화면에서 실제로 재본다.
//
// 사장님(2026-09-11): "결제창에서 현금, 라인페이, 신용카드 선택하는 창을
// 좀더 크게 만들어줘. 설정에서 화면을 크게하면 모든화면이 다 크게 되니까
// 그 창만 더 크면 되겠음."
//
// ── 이 파일이 지키는 세 가지 ────────────────────────────────────────
//
//   1. **칸이 크다.** 손님 앞에서 한 손으로 누르는 버튼이다. 숫자로 못
//      박아두면 다음에 누가 여백을 줄이다가 조용히 예전 크기로 돌아간다.
//   2. **2×2 를 지킨다.** 한 줄로 늘어놓으면 칸마다 좁아져서, 키운 이유인
//      「누르기 쉬움」이 도로 사라진다. 폰 너비에서도 마찬가지다.
//   3. **금액도 같이 크다.** 고르는 버튼만 키우고 합계를 그대로 두면,
//      정작 손님에게 불러줄 숫자가 그 창에서 제일 작은 글자가 된다.
//
// 화면 글자 크기 설정(body zoom)은 건드리지 않는다 — 그걸 올려야만 커지는
// 것이라면 사장님 말씀대로 「모든 화면이 다 커지는」 문제가 그대로다.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-payment-method-size";
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

// 「크다」가 무엇인지 여기서 한 번만 정한다.
const MIN_H = 80;        // 칸 높이 (px) — 손가락으로 누르는 자리
const MIN_W = 150;       // 칸 너비 (px)
const MIN_FONT = 24;     // 글자 크기 (px)
const MIN_SUMMARY = 18;  // 합계 글자 크기 (px)
const PHONE_MIN_H = 64;  // 폰 너비에서의 최소 높이

(async () => {
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.dismiss());
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "ownerpass123" }) });
  });
  await page.reload({ waitUntil: "networkidle" });
  await require("./disable-order-hours")();

  const item = store.menuItems.find((m) => !m.min_first_order_qty);
  const T = store.tables.find((t) => !t.is_counter).number;
  await page.evaluate(async ([t, itemId]) => {
    const H = { "Content-Type": "application/json" };
    await fetch(`/api/tables/${t}/party-size`, { method: "PUT", headers: H, body: JSON.stringify({ partySize: 2 }) });
    await fetch("/api/orders", { method: "POST", headers: H,
      body: JSON.stringify({ tableNumber: t, items: [{ itemId, qty: 1 }] }) });
    const tables = await (await fetch("/api/tables")).json();
    const zones = await (await fetch("/api/zones")).json();
    const target = tables.find((x) => String(x.number) === String(t));
    await fetch(`/api/tables/${target.id}`, { method: "PATCH", headers: H,
      body: JSON.stringify({ zoneId: zones[0].id, x: 20, y: 40, width: 70, height: 70 }) });
  }, [T, item.id]);

  const openPaymentPopup = async () => {
    await page.reload({ waitUntil: "networkidle" });
    await page.locator('.admin-tabs button[data-tab="payment"]').click();
    await page.locator("#paymentFloorPlan .table-block").first().waitFor({ timeout: 15000 });
    await page.locator(`#paymentFloorPlan .table-block:has(> span:text-is("${T}"))`).first().click();
    await page.waitForTimeout(700);
    await page.locator("#tableDetailSelectAll").check();
    await page.waitForTimeout(400);
    await page.locator("#tableDetailBody .pay-selected-items-btn").first().click();
    await page.locator("#paymentMethodBackdrop").waitFor({ state: "visible", timeout: 10000 });
    await page.waitForTimeout(500);
  };

  const measure = () =>
    page.evaluate(() => {
      const btns = [...document.querySelectorAll("#paymentMethodBtns [data-payment-method]")];
      const read = (el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return { method: el.dataset.paymentMethod, w: Math.round(r.width), h: Math.round(r.height),
          top: Math.round(r.top), font: parseFloat(cs.fontSize) };
      };
      const sum = document.querySelector("#paymentMethodSummary");
      const modal = document.querySelector(".payment-method-modal");
      const cancel = document.querySelector("#paymentMethodCancel");
      const mr = modal.getBoundingClientRect();
      const cr = cancel.getBoundingClientRect();
      return {
        btns: btns.map(read),
        summaryFont: parseFloat(getComputedStyle(sum).fontSize),
        zoom: getComputedStyle(document.body).zoom,
        modal: { left: Math.round(mr.left), right: Math.round(mr.right), bottom: Math.round(mr.bottom) },
        cancelBottom: Math.round(cr.bottom),
        viewport: { w: window.innerWidth, h: window.innerHeight },
        docScrollW: document.documentElement.scrollWidth,
      };
    });

  await openPaymentPopup();
  const m = await measure();

  out.push("[태블릿/PC 에서]");
  check("네 칸이 다 있다", m.btns.length === 4, JSON.stringify(m.btns.map((b) => b.method)));
  for (const b of m.btns) {
    check(`★ ${b.method} 칸이 ${MIN_H}px 이상 높다 (${b.h}px)`, b.h >= MIN_H, String(b.h));
    check(`★ ${b.method} 칸이 ${MIN_W}px 이상 넓다 (${b.w}px)`, b.w >= MIN_W, String(b.w));
    check(`★ ${b.method} 글자가 ${MIN_FONT}px 이상이다 (${b.font}px)`, b.font >= MIN_FONT, String(b.font));
  }
  // 2×2 — 서로 다른 y 가 정확히 둘이어야 한다.
  const rows = new Set(m.btns.map((b) => b.top));
  check("★ 2×2 로 놓인다", rows.size === 2, `줄 ${rows.size}개: ${[...rows].join(", ")}`);
  check(`★ 합계 글자도 ${MIN_SUMMARY}px 이상이다 (${m.summaryFont}px)`, m.summaryFont >= MIN_SUMMARY, String(m.summaryFont));

  out.push("\n[화면 글자 크기 설정을 건드리지 않았다]");
  // 이게 1(=100%)인데도 칸이 크다는 것이 이 변경의 핵심이다. 설정을 올려야만
  // 커지는 것이라면 「모든 화면이 다 커지는」 문제가 그대로다.
  check("★ 화면 배율은 기본값 그대로", m.zoom === "1" || m.zoom === "" || m.zoom === "normal", String(m.zoom));

  out.push("\n[창이 화면 안에 들어온다]");
  check("가로로 안 넘친다", m.docScrollW <= m.viewport.w, `${m.docScrollW} > ${m.viewport.w}`);
  check("취소 버튼까지 화면 안에 있다", m.cancelBottom <= m.viewport.h, `${m.cancelBottom} > ${m.viewport.h}`);

  {
    const fs = require("fs");
    const path = require("path");
    const dir = path.join(__dirname, "..", "..", "..", "_screens");
    fs.mkdirSync(dir, { recursive: true });
    const box = await page.locator(".payment-method-modal").boundingBox();
    if (box) await page.screenshot({ path: path.join(dir, "payment-method-size.png"), clip: box });
  }

  out.push("\n[폰 너비(390px)에서도]");
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(500);
  const p = await measure();
  for (const b of p.btns) {
    check(`${b.method} 칸이 ${PHONE_MIN_H}px 이상 높다 (${b.h}px)`, b.h >= PHONE_MIN_H, String(b.h));
  }
  const phoneRows = new Set(p.btns.map((b) => b.top));
  check("★ 폰에서도 2×2 를 지킨다", phoneRows.size === 2, `줄 ${phoneRows.size}개`);
  check("★ 폰에서도 가로로 안 넘친다", p.docScrollW <= p.viewport.w, `${p.docScrollW} > ${p.viewport.w}`);
  check("창이 화면 밖으로 안 나간다", p.modal.left >= 0 && p.modal.right <= p.viewport.w,
    `${p.modal.left} ~ ${p.modal.right} (화면 ${p.viewport.w})`);

  out.push("\n[할인이 걸려 못 누를 때도 칸은 그대로다]");
  // 「지금은 못 누른다」가 「버튼이 사라졌다」로 읽히면 안 된다.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(300);
  const locked = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("#paymentMethodBtns [data-payment-method]")];
    btns.forEach((b) => { if (b.dataset.paymentMethod !== "cash") { b.disabled = true; b.style.opacity = "0.4"; } });
    return btns.map((b) => ({ method: b.dataset.paymentMethod, h: Math.round(b.getBoundingClientRect().height) }));
  });
  check("★ 못 누르는 칸도 크기가 같다", new Set(locked.map((b) => b.h)).size === 1, JSON.stringify(locked));

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  await browser.close();
  server.close();
  process.exit(fail === 0 ? 0 : 1);
})();
