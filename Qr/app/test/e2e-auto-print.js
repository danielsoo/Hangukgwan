// 빌지가 빠짐없이, 한 번만 나오는가.
//
// 2026-09-10 사장님(장사 중): "지금까지 4건 주문됐거든. 3건은 주문시 2장씩.
// 9번테이블 1건은 아예 안나왔어 ㅋㅋ 강제 인쇄했지."
//
// 두 장씩 나오는 건 정상이다(주방용+결제용, 2026-09-07). 문제는 한 건이
// 통째로 안 나온 것이다. 화면에는 떴고, 인쇄 실패 표시도 없었다.
//
// 원인은 「새 주문」의 뜻이었다. 화면을 켠 뒤 목록이 바뀐 것만 새 주문으로
// 봤고, 켠 직후 첫 응답은 통째로 건너뛰었다(밀린 주문을 몰아 찍지 않으려고).
// 그래서 손님이 주문한 그 순간 태블릿이 새로고침 중이었으면 — 배포, 앱
// 재시작, 네트워크가 끊겼다 붙는 것, 전부 장사 중에 실제로 일어난다 —
// 그 주문은 「켤 때 이미 있던 주문」이 되어 영영 안 찍힌다.
//
// 그리고 사장님: "하나에 고정으로 되거나 다른 곳에서 못 키게 막아줘."
// 자동 인쇄는 기기마다 따로 켜는 것이라 두 대에서 켜면 빌지가 두 벌 나온다.
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
process.env.SESSION_SECRET = "e2e-auto-print";
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

// 실제 프린터가 없으니 마지막 단계(브라우저 인쇄 창)를 가로챈다.
// printKitchenTicket 은 POS 앱 → QZ Tray → RawBT 를 차례로 시도하고 전부
// 없으면 window.open 으로 내려온다. 테스트 브라우저에는 셋 다 없다.
const STUB_PRINT = () => {
  window.__prints = [];
  window.open = function () {
    const doc = {
      open() {}, close() {},
      write(html) { window.__prints.push(html); },
      fonts: { ready: Promise.resolve() },
    };
    return { document: doc, focus() {}, print() {} };
  };
};

(async () => {
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchBrowser();

  async function newAdmin() {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(STUB_PRINT);
    const page = await ctx.newPage();
    page.on("dialog", (d) => d.dismiss());
    await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
    await page.evaluate(async () => {
      await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "ownerpass123" }) });
    });
    await page.reload({ waitUntil: "networkidle" });
    return { ctx, page };
  }

  const A = await newAdmin();
  await require("./disable-order-hours")();
  check("사장 로그인", await A.page.locator("#dashboard").isVisible());

  const table = store.tables.find((t) => !t.is_counter);
  table.party_size = 2;
  const itemId = store.menuItems[0].id;
  const placeOrder = (page) => page.evaluate(async ([n, id]) => {
    const r = await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tableNumber: n, items: [{ itemId: id, qty: 1 }] }) });
    return (await r.json()).id;
  }, [table.number, itemId]);
  const printCount = (page) => page.evaluate(() => (window.__prints || []).length);

  out.push("[켤 때 밀려 있던 주문은 몰아 찍지 않는다]");
  {
    await placeOrder(A.page);
    await A.page.locator("#autoPrintToggle").check();
    await A.page.waitForTimeout(400);
    // 자동 인쇄를 켜기 전에 들어온 주문 — 켰다고 지금 와서 찍으면 안 된다.
    await A.page.reload({ waitUntil: "networkidle" });
    await A.page.waitForTimeout(1200);
    check("이미 있던 주문은 안 찍는다", (await printCount(A.page)) === 0, String(await printCount(A.page)));
  }

  out.push("\n[새 주문은 한 번 찍는다]");
  {
    await placeOrder(A.page);
    await A.page.waitForTimeout(3000); // 폴링 한 바퀴
    const n = await printCount(A.page);
    check("한 번 찍는다", n === 1, String(n));
    // 폴링이 계속 도는 동안 같은 주문을 또 찍으면 안 된다.
    await A.page.waitForTimeout(4000);
    check("폴링이 돌아도 또 안 찍는다", (await printCount(A.page)) === 1, String(await printCount(A.page)));
    // 2026-09-07 사장님 요청으로 한 번 찍을 때 주방용+결제용 두 장이 나온다.
    // 사장님이 오늘 말한 "2장씩"이 이것이다 — 중복이 아니라 설계다.
    check("한 번에 주방용+결제용 두 장이 담긴다",
      (await A.page.evaluate(() => (window.__prints[0] || "").includes("receipt-page-break"))),
      "빌지 한 장만 담겨 있다");
  }

  out.push("\n[새로고침해도 이미 찍은 건 다시 안 찍는다]");
  {
    await A.page.reload({ waitUntil: "networkidle" });
    await A.page.waitForTimeout(1500);
    check("다시 안 찍는다", (await printCount(A.page)) === 0, String(await printCount(A.page)));
  }

  out.push("\n[새로고침하는 동안 들어온 주문 — 9번 테이블]");
  // 여기가 사장님이 겪은 자리다. 예전 코드는 화면을 켠 첫 응답을 통째로
  // 건너뛰어서, 그 사이에 들어온 주문이 영영 안 찍혔다.
  {
    const id = await placeOrder(A.page); // 화면이 안 보고 있는 사이에 들어온 주문
    await A.page.reload({ waitUntil: "networkidle" });
    await A.page.waitForTimeout(2500);
    const n = await printCount(A.page);
    check("켜자마자 찍는다", n === 1, `${n}장 (주문 ${id})`);
    check("그 주문의 빌지가 맞다",
      (await A.page.evaluate(() => window.__prints.join(""))).includes(String(id)),
      String(id));
  }

  out.push("\n[자동 인쇄는 켠 기기들이 같이 찍는다 — 2026-09-29]");
  // 사장님(2026-09-29): "단말기(POS)별로 프린트를 별도로 사용할 수 있도록 ...
  // 홀 프린터의 오류/고장 등 유사시 카운터 단말기/프린터를 즉시 교체 투입".
  // 자동 인쇄는 「두 곳 다 자동」. 예전(09-10)의 「한 기기에서만 / 옮길지
  // 묻기」는 이 결정으로 바뀌었다.
  {
    const d = await A.page.evaluate(async () => (await fetch("/api/settings/print-device")).json());
    check("켠 기기가 서버 목록에 적힌다", (d.devices || []).length === 1, JSON.stringify(d));
    check("어떤 기기인지도 적힌다", !!d.name, JSON.stringify(d));
    check("이 기기에서 인쇄한다고 보여준다",
      (await A.page.locator("#printDeviceNote").innerText()).length > 0,
      await A.page.locator("#printDeviceNote").innerText());

    // 두 번째 기기(카운터) — 브라우저 컨텍스트가 다르면 localStorage 도 다르다.
    const B = await newAdmin();
    await B.page.waitForTimeout(800);
    check("켜기 전에는 「어디서 찍는지」가 뜬다",
      (await B.page.locator("#printDeviceNote").innerText()).length > 0,
      await B.page.locator("#printDeviceNote").innerText());
    check("이 기기는 아직 안 찍으니 눈에 띈다",
      (await B.page.locator("#printDeviceNote").getAttribute("class")).includes("is-elsewhere"));

    // 켠다 — 묻지 않는다. 뺏지도 않는다.
    await B.page.locator("#autoPrintToggle").check();
    await B.page.waitForTimeout(600);
    check("★ 옮길지 묻지 않는다", !(await B.page.locator("#appDialogBackdrop").isVisible()));
    const both = await B.page.evaluate(async () => (await fetch("/api/settings/print-device")).json());
    check("★ 목록에 둘 다 있다", (both.devices || []).length === 2, JSON.stringify(both));

    // ★★ 새 주문 하나 — 두 기기가 각자 한 장씩(=각자 주방용+결제용 한 번).
    const beforeA = await printCount(A.page);
    const beforeB = await printCount(B.page);
    await placeOrder(B.page);
    await A.page.waitForTimeout(3500);
    await B.page.waitForTimeout(3500);
    const dA = (await printCount(A.page)) - beforeA;
    const dB = (await printCount(B.page)) - beforeB;
    check("★★ 홀(A)도 찍는다", dA === 1, `${dA}`);
    check("★★ 카운터(B)도 찍는다", dB === 1, `${dB}`);
    // 2026-09-30 사장님: "자동으로 바로 조리 중으로 넘어가는데 … 다시 없애려고 해 …
    // 자동으로 안 움직이게." 두 기기가 다 찍고 나서도 주문은 「신규」에 남는다.
    const st = await A.page.evaluate(async () => (await (await fetch("/api/orders")).json()).map((o) => o.status));
    check("★★ 찍혀도 「신규」에 그대로 — 자동으로 「조리 중」으로 안 넘어간다", st.length > 0 && st.every((x) => x === "new"), JSON.stringify(st));
    await A.page.waitForTimeout(3500);
    const again = (await printCount(A.page)) - beforeA;
    check("★ 「신규」에 남아 있어도 같은 주문을 또 찍지 않는다", again === 1, `${again}`);

    await A.page.reload({ waitUntil: "networkidle" });
    await A.page.waitForTimeout(1200);
    check("★ 다른 기기가 켰다고 이 기기 토글이 꺼지지 않는다", await A.page.locator("#autoPrintToggle").isChecked());
    check("자동 인쇄 중인 기기가 둘 다 적힌다",
      (await A.page.locator("#printDeviceNote").innerText()).includes("·"),
      await A.page.locator("#printDeviceNote").innerText());

    // 남의 것을 함부로 놓을 수 없다 — 모르는 번호로 놓아도 목록은 그대로.
    await A.page.evaluate(async () => {
      await fetch("/api/settings/print-device", { method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: null, releaseId: "남의기기" }) });
    });
    const after = await A.page.evaluate(async () => (await fetch("/api/settings/print-device")).json());
    check("★ 남의 번호로는 아무도 안 빠진다", (after.devices || []).length === 2, JSON.stringify(after));

    // 카운터에서 끈다 — 카운터만 빠지고 홀은 계속 찍는다.
    await B.page.locator("#autoPrintToggle").uncheck();
    await B.page.waitForTimeout(600);
    const one = await B.page.evaluate(async () => (await fetch("/api/settings/print-device")).json());
    check("★ 끈 기기만 빠진다", (one.devices || []).length === 1, JSON.stringify(one));
    const a2 = await printCount(A.page);
    const b2 = await printCount(B.page);
    await placeOrder(A.page);
    await A.page.waitForTimeout(3500);
    await B.page.waitForTimeout(3500);
    check("홀은 계속 찍는다", (await printCount(A.page)) - a2 === 1, `${(await printCount(A.page)) - a2}`);
    check("끈 카운터는 안 찍는다", (await printCount(B.page)) === b2, `${(await printCount(B.page)) - b2}`);
    await B.ctx.close();
  }

  out.push("\n[자동 인쇄가 꺼져 있으면]");
  {
    // 켠 적 없는 기기. 주문이 와도 안 찍고, 나중에 켰다고 그동안 쌓인 걸
    // 몰아 찍지도 않는다.
    const C = await newAdmin();
    await C.page.waitForTimeout(900);
    await placeOrder(C.page);
    await C.page.waitForTimeout(3000);
    check("꺼져 있으면 안 찍는다", (await printCount(C.page)) === 0, String(await printCount(C.page)));
    await C.page.locator("#autoPrintToggle").check();
    await C.page.waitForTimeout(400);
    if (await C.page.locator("#appDialogBackdrop").isVisible()) {
      await C.page.locator("#appDialogBackdrop .primary-btn").first().click();
      await C.page.waitForTimeout(500);
    }
    await C.page.waitForTimeout(3000);
    check("켜도 그동안 쌓인 걸 몰아 찍지 않는다", (await printCount(C.page)) === 0,
      String(await printCount(C.page)));
    await placeOrder(C.page);
    await C.page.waitForTimeout(3000);
    check("켠 뒤에 온 주문은 찍는다", (await printCount(C.page)) === 1, String(await printCount(C.page)));
    await C.ctx.close();
  }

  out.push("\n[POS 앱으로 나갈 때 — 두 장이 한 번에]");
  // 2026-09-10 사장님(장사 중): "프린트는 잘 되는 거 같은데 여전히 1장만
  // 나오는 테이블이 있다니까."
  //
  // 주방용과 결제용을 따로 두 번 보내고 있었다. 값싼 열전사 프린터는 9100
  // 포트에 연결을 하나만 받고 버퍼도 작아서, 첫 장이 나오는 동안 두 번째를
  // 보내면 조용히 사라진다. 품목이 많은 테이블에서만 1장이 나온 이유다.
  {
    // 앞 절의 기기들을 정리한다 — 그쪽이 먼저 찍으면 주문이 「조리 중」으로
    // 넘어가서 여기서는 찍을 것이 없어진다.
    await A.ctx.close();
    const P = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await P.addInitScript(() => {
      // 태블릿의 한국관 POS 앱이 심어주는 것과 같은 모양의 브릿지.
      window.__jobs = [];
      window.HangukgwanPrint = {
        printBase64(b64) { window.__jobs.push(b64); return "queued"; },
      };
    });
    const pp = await P.newPage();
    pp.on("dialog", (d) => d.dismiss());
    await pp.goto(`${base}/admin`, { waitUntil: "networkidle" });
    await pp.evaluate(async () => {
      await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "ownerpass123" }) });
    });
    await pp.reload({ waitUntil: "networkidle" });
    await pp.waitForTimeout(900);
    await pp.locator("#autoPrintToggle").check();
    await pp.waitForTimeout(400);
    if (await pp.locator("#appDialogBackdrop").isVisible()) {
      await pp.locator("#appDialogBackdrop .primary-btn").first().click();
      await pp.waitForTimeout(500);
    }

    // 앞 절에서 결제가 끝나 인원수가 지워졌다 — 다시 앉히지 않으면 주문
    // 자체가 안 들어간다.
    await pp.evaluate(async (n) => {
      await fetch(`/api/tables/${n}/party-size`, { method: "PUT",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adults: 2, children: 0 }) });
    }, table.number);

    // 품목이 많은 주문 — 사장님이 1장만 나왔다고 한 쪽이 바로 이런 것이다.
    await pp.evaluate(async ([n, ids]) => {
      await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableNumber: n, items: ids.map((id) => ({ itemId: id, qty: 2 })) }) });
    }, [table.number, store.menuItems.slice(0, 6).map((m) => m.id)]);
    await pp.waitForTimeout(4000);

    const jobs = await pp.evaluate(() => window.__jobs.length);
    check("프린터에 한 번만 보낸다", jobs === 1, `${jobs}번 보냈다`);
    // 한 줄기 안에 커팅이 두 번 있어야 종이가 두 장으로 나온다.
    const cuts = await pp.evaluate(() => {
      const bin = atob(window.__jobs[0] || "");
      let n = 0;
      for (let i = 0; i + 3 < bin.length; i++) {
        if (bin.charCodeAt(i) === 0x1d && bin.charCodeAt(i + 1) === 0x56 &&
            bin.charCodeAt(i + 2) === 0x42 && bin.charCodeAt(i + 3) === 0x00) n++;
      }
      return n;
    });
    check("그 한 줄기 안에 두 장이 들어 있다", cuts === 2, `커팅 ${cuts}번`);
    check("브라우저 인쇄로 새지 않는다", (await printCount(pp)) === 0, String(await printCount(pp)));

    // 주문 두 건이 같이 들어와도 차례로 보낸다 — 한꺼번에 보내면 프린터에
    // 연결을 두 개 여는 셈이라 한쪽이 사라진다.
    await pp.evaluate(async ([n, id]) => {
      const H = { "Content-Type": "application/json" };
      await fetch("/api/orders", { method: "POST", headers: H, body: JSON.stringify({ tableNumber: n, items: [{ itemId: id, qty: 1 }] }) });
      await fetch("/api/orders", { method: "POST", headers: H, body: JSON.stringify({ tableNumber: n, items: [{ itemId: id, qty: 1 }] }) });
    }, [table.number, itemId]);
    await pp.waitForTimeout(5000);
    const jobs2 = await pp.evaluate(() => window.__jobs.length);
    check("두 건이면 두 번, 주문마다 한 번씩", jobs2 === 3, `${jobs2}번 (앞의 1번 포함)`);
    await P.close();
  }


  await browser.close();
  server.close();
  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
