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
  // 이 손님이 아까 결제한 라운드 — 이것도 따라가야 한다.
  // 사장님(2026-09-10): "결국 같은 손님인 거잖아. 그럼 따라가는 게 맞는 거 같은데."
  const paid = await post("/api/orders", { tableNumber: A, items: [{ itemId, qty: 1 }] });
  await api(`/api/orders/${paid.body.id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "paid" }),
  });

  out.push("\n[빈 자리로 옮긴다]");
  const moved = await post("/api/orders/move", { from: A, to: B });
  check("옮겨진다", moved.status === 200, JSON.stringify(moved));
  check("이 손님 것 세 건이 다 옮겨진다", moved.body.moved === 3, JSON.stringify(moved.body));
  check("그 중 결제 완료가 한 건이라고 알려준다", moved.body.moved_paid === 1, JSON.stringify(moved.body));
  {
    const all = (await api("/api/orders")).body;
    const byId = Object.fromEntries(all.map((o) => [o.id, o]));
    check("첫 주문이 새 자리에 있다", String(byId[first.body.id].table_number) === String(B));
    check("둘째 주문도 새 자리에 있다", String(byId[second.body.id].table_number) === String(B));
    check("이미 결제한 라운드도 따라간다", String(byId[paid.body.id].table_number) === String(B),
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

  out.push("\n[먼저 앉았다 간 손님 것은 안 따라간다]");
  // 이 손님이 결제한 라운드까지 옮기기 때문에, 경계가 없으면 낮에 그 자리에
  // 앉았다 간 다른 손님의 결제까지 함께 옮겨진다. 그건 아무도 눈치채지
  // 못하고 되돌릴 수도 없다. 경계는 「지금 앉아 있는 손님이 앉은 시각」이다.
  {
    const D = tabless[3].number;
    const E = tabless[4].number;
    // 손님 1 — 앉고, 시키고, 다 결제하고 나간다(결제하면 인원수가 지워진다).
    await put(`/api/tables/${D}/party-size`, { partySize: 2 });
    const oldGuest = await post("/api/orders", { tableNumber: D, items: [{ itemId, qty: 1 }] });
    await api(`/api/orders/${oldGuest.body.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "paid" }),
    });
    {
      const tables = (await api("/api/tables")).body;
      const d = tables.find((t) => String(t.number) === String(D));
      check("다 결제하면 인원수가 지워진다", !d.party_size, `${d.party_size}`);
    }
    // 주문 시각은 초 단위라, 실제 손님처럼 시간이 흐른 뒤에 다음 손님이
    // 앉아야 경계가 의미를 갖는다. 현실에서는 몇 분씩 벌어진다.
    await page.waitForTimeout(1200);
    // 손님 2 — 같은 자리에 새로 앉는다.
    await put(`/api/tables/${D}/party-size`, { partySize: 4 });
    const newGuest = await post("/api/orders", { tableNumber: D, items: [{ itemId, qty: 1 }] });

    const r = await post("/api/orders/move", { from: D, to: E });
    check("지금 손님 것만 옮긴다", r.body.moved === 1, JSON.stringify(r.body));
    const all = (await api("/api/orders")).body;
    const byId = Object.fromEntries(all.map((o) => [o.id, o]));
    check("지금 손님 주문은 옮겨진다", String(byId[newGuest.body.id].table_number) === String(E));
    check("먼저 앉았던 손님의 결제는 그 자리에 남는다",
      String(byId[oldGuest.body.id].table_number) === String(D),
      String(byId[oldGuest.body.id].table_number));
  }

  {
    // 한 번 더 옮겨도 아까 결제한 라운드가 계속 따라와야 한다. 옮길 때
    // 「앉은 시각」을 지금으로 새로 찍으면 여기서 떨어져 나간다.
    const all = (await api("/api/orders")).body;
    const byId = Object.fromEntries(all.map((o) => [o.id, o]));
    check("두 번 옮겨도 결제한 라운드가 따라온다", String(byId[paid.body.id].table_number) === String(C),
      String(byId[paid.body.id].table_number));
  }

  out.push("\n[전체 결제 전까지는 같은 손님이다]");
  // 사장님(2026-09-10): "어떤 손님이 주문을 하고 몇개만 주문을 하던 자리를
  // 옮기던 시간이 오래 걸리던 전체 결제를 하지 않는 이상 이 손님은 같은
  // 손님으로 인식을 할거야."
  //
  // 그 「같은 손님」을 들고 있는 것이 인원수(party_size)다. 자리를 옮겨도
  // 따라가고, 일부만 결제해도 남고, 전체 결제에서만 사라진다.
  {
    const F = tabless[5].number;
    const G = tabless[6].number;
    await put(`/api/tables/${F}/party-size`, { partySize: 4 });
    const r1 = await post("/api/orders", { tableNumber: F, items: [{ itemId, qty: 1 }] });
    const r2 = await post("/api/orders", { tableNumber: F, items: [{ itemId, qty: 1 }] });
    // 한 라운드만 결제 — 손님은 아직 앉아 있다.
    await api(`/api/orders/${r1.body.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "paid" }),
    });
    {
      const t = (await api("/api/tables")).body.find((x) => String(x.number) === String(F));
      check("일부만 결제하면 인원수가 남는다", t.party_size === 4, `${t.party_size}`);
    }
    // 자리를 옮겨도 같은 손님이다 — 새 자리에서 인원수를 다시 묻지 않는다.
    await post("/api/orders/move", { from: F, to: G });
    {
      const tables = (await api("/api/tables")).body;
      check("옮겨도 인원수가 그대로 따라간다",
        tables.find((x) => String(x.number) === String(G)).party_size === 4);
      check("옛 자리에는 안 남는다", !tables.find((x) => String(x.number) === String(F)).party_size);
      const all = (await api("/api/orders")).body;
      const byId = Object.fromEntries(all.map((o) => [o.id, o]));
      check("결제한 라운드도 새 자리로", String(byId[r1.body.id].table_number) === String(G));
      check("안 받은 라운드도 새 자리로", String(byId[r2.body.id].table_number) === String(G));
    }
    // 전체 결제 — 이때 비로소 다른 손님이 된다.
    await api(`/api/orders/${r2.body.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "paid" }),
    });
    {
      const t = (await api("/api/tables")).body.find((x) => String(x.number) === String(G));
      check("전체 결제하면 그때 인원수가 사라진다", !t.party_size, `${t.party_size}`);
    }
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

  out.push("\n[자리 이동 빌지]");
  // 2026-09-10 사장님: "자리이동하면 자리이동 빌지도 하나 나왔으면 좋겠어."
  // 주방과 홀에는 이미 옛 번호가 찍힌 주문서가 나가 있다. 화면에서만 바뀌면
  // 종이를 들고 다니는 사람은 그 사실을 모른다.
  {
    // 종이에 실제로 나가는 바이트를 본다. 프린터가 없는 자리에서는
    // 브라우저 인쇄로 떨어지는데, 그건 아래에서 따로 확인한다.
    const slip = await page.evaluate(() => {
      const bytes = window.buildEscPosMoveSlip(
        { from: "5", to: "8", at: "19:32", partySize: 4, orders: [{ id: 12, time: "19:05", summary: "돌솥비빔밥×2" }] },
        "한국관"
      );
      // GS v 0 밴드가 몇 줄씩 나가는지 — 값싼 프린터는 큰 이미지를 통째로
      // 버린다(2026-09-09 "어떤 테이블은 주방만 나옴"). 주문서와 같은
      // 포장 함수를 쓰는지 여기서 확인된다.
      const bands = [];
      for (let i = 0; i < bytes.length - 8; i++) {
        if (bytes[i] === 0x1d && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x30 && bytes[i + 3] === 0x00) {
          const wb = bytes[i + 4] | (bytes[i + 5] << 8);
          const rows = bytes[i + 6] | (bytes[i + 7] << 8);
          bands.push({ wb, rows });
          i += 8 + wb * rows - 1;
        }
      }
      return { len: bytes.length, init: bytes[0] === 0x1b && bytes[1] === 0x40, bands,
        tail: Array.from(bytes.slice(-7)) };
    });
    check("빌지 바이트가 만들어진다", slip.len > 1000, `${slip.len}`);
    check("프린터 초기화로 시작한다", slip.init);
    check("래스터로 나간다", slip.bands.length >= 1, JSON.stringify(slip.bands));
    check("밴드가 128줄을 넘지 않는다", slip.bands.every((b) => b.rows <= 128), JSON.stringify(slip.bands));
    check("한 밴드가 프린터 버퍼보다 작다", slip.bands.every((b) => b.wb * b.rows <= 16384), JSON.stringify(slip.bands));
    check("끝에 커팅이 들어간다", slip.tail.slice(-4).join(",") === "29,86,66,0", JSON.stringify(slip.tail));
  }
  {
    // 프린터가 하나도 안 잡힌 자리에서는 브라우저 인쇄로 떨어진다. 그때
    // 나가는 종이에 무엇이 찍히는지 — 팝업을 열어보기는 어려우니 만들어지는
    // 내용을 그대로 본다.
    const printed = await page.evaluate(() =>
      window.__moveSlipHtmlForTest({ from: "5", to: "8", at: "19:32", partySize: 4, orders: [] })
    );
    check("브라우저 인쇄용 종이도 만들어진다", printed.includes("자리 이동"), printed.slice(0, 80));
    check("옛 자리와 새 자리가 크게 찍힌다", /class="big">\s*5 → 8/.test(printed), printed.slice(0, 400));
    check("새 QR 안내가 들어간다", printed.includes("새 자리 QR"));
  }

  out.push("\n[화면을 켜둔 채로 있어도 안내가 뜬다]");
  // 2026-09-10 사장님: "손님이 보고있는 원래 테이블 qr 화면에서 자리 이동
  // 메시지랑 리다이렉트용 확인 버튼이 안 떠."
  //
  // 안내를 화면을 처음 불러올 때만 확인하고 있었다. 그런데 자리를 옮기는 그
  // 순간 손님은 이미 그 화면을 켜둔 채 앉아 있다 — 새로고침을 할 이유가 없다.
  //
  // 그리고 직원이 대신 넣어준 주문은 이 폰에 주문 번호가 없다. 사장님이
  // 실제로 그렇게 시험하셨고, 그래서 더 안 떴다.
  {
    const P = tabless[11].number;
    const Q = tabless[12].number;
    await put(`/api/tables/${P}/party-size`, { adults: 2, children: 1 });
    // 손님 폰은 이 자리 화면을 켜두기만 한다 — 주문은 직원이 대신 넣는다.
    const seated = await browser.newContext({ viewport: { width: 420, height: 900 } });
    const sp = await seated.newPage();
    sp.on("dialog", (d) => d.dismiss());
    await sp.goto(`${base}/t/${P}`, { waitUntil: "networkidle" });
    await sp.waitForTimeout(700);
    check("앉은 손님에게는 안내가 없다", await sp.locator("#movedBackdrop").isHidden());
    {
      const seen = await sp.evaluate((k) => localStorage.getItem(`hgk_seat_${k}`), String(P));
      check("폰이 「이 자리에 앉은 손님」 표시를 남긴다", !!seen, String(seen));
    }
    await post("/api/orders", { tableNumber: P, items: [{ itemId, qty: 1 }] }); // 직원이 대신
    await post("/api/orders/move", { from: P, to: Q });

    // 새로고침 없이. 1분을 기다릴 수 없으니 폰을 다시 집어드는 쪽으로 부른다 —
    // 실제로 자리를 옮긴 직후가 딱 그 순간이다.
    await sp.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await sp.waitForTimeout(800);
    check("새로고침 없이 안내가 뜬다", await sp.locator("#movedBackdrop").isVisible());
    check("직원이 대신 넣은 주문이어도 알아본다",
      (await sp.locator("#movedBackdrop").innerText()).includes(String(Q)),
      await sp.locator("#movedBackdrop").innerText());
    await sp.locator("#movedGoBtn").click();
    await sp.waitForURL(`**/t/${Q}`, { timeout: 5000 });
    check("확인을 누르면 새 자리로 간다", sp.url().endsWith(`/t/${Q}`), sp.url());
    await seated.close();
  }

  out.push("\n[옮겨진 손님 폰이 새 자리로 데려다준다]");
  // 2026-09-10 사장님: "이미 손님이 해당 qr 코드로 되어있잖아. 그럼 qr 코드
  // 이미 들어가있다면 이동을 도와드리겠다고 하고 확인 버튼만 있게 해줘."
  //
  // 손님 폰에는 아직 옛 자리 화면이 떠 있다. 그대로 주문하면 그 주문만 빈
  // 자리로 들어가고, 주방은 아무도 없는 자리로 음식을 낸다.
  {
    const J = tabless[9].number;
    const K = tabless[10].number;
    await put(`/api/tables/${J}/party-size`, { partySize: 2 });
    const mine = await post("/api/orders", { tableNumber: J, items: [{ itemId, qty: 1 }] });

    const guest = await browser.newContext({ viewport: { width: 420, height: 900 } });
    const gp = await guest.newPage();
    gp.on("dialog", (d) => d.dismiss());
    // 손님 폰이 그 자리에서 주문한 적이 있다는 흔적 — 실제로는 주문할 때
    // 저장된다(saveOrderToHistory).
    await gp.goto(`${base}/t/${J}`, { waitUntil: "networkidle" });
    await gp.evaluate(([t, id]) => localStorage.setItem(`hgk_orders_${t}`, JSON.stringify([id])), [String(J), mine.body.id]);

    await post("/api/orders/move", { from: J, to: K });

    await gp.reload({ waitUntil: "networkidle" });
    await gp.waitForTimeout(600);
    check("옛 자리를 열면 안내가 뜬다", await gp.locator("#movedBackdrop").isVisible());
    {
      const text = await gp.locator("#movedBackdrop").innerText();
      check("어느 자리로 갔는지 알려준다", text.includes(String(K)), text);
      check("QR 을 다시 찍어도 된다고 알려준다", /QR/.test(text), text);
      // 사장님이 정한 문구(2026-09-10): "자리 이동을 요청하신 것 같아요!
      // 주문 링크 이동도 도와드릴께요 / 확인".
      check("버튼은 「확인」 하나뿐이다",
        (await gp.locator("#movedGoBtn").innerText()).trim() === "確認",
        await gp.locator("#movedGoBtn").innerText());
      check("고를 것이 하나뿐이다", (await gp.locator("#movedBackdrop button").count()) === 1,
        `${await gp.locator("#movedBackdrop button").count()}`);
    }
    // 확인 하나면 새 자리로 간다.
    await gp.locator("#movedGoBtn").click();
    await gp.waitForURL(`**/t/${K}`, { timeout: 5000 });
    check("확인을 누르면 새 자리로 간다", gp.url().endsWith(`/t/${K}`), gp.url());
    {
      // 사장님이 배포 전에 눈으로 확인할 수 있게 찍어둔다 — 확인 버튼
      // 하나뿐인 화면인지가 여기서 보인다.
      await gp.goBack({ waitUntil: "networkidle" });
      await gp.waitForTimeout(600);
      const shots = path.join(__dirname, "..", "..", "..", "_screens");
      fs.mkdirSync(shots, { recursive: true });
      await gp.screenshot({ path: path.join(shots, "moved-customer.png") });
      await gp.goto(`${base}/t/${K}`, { waitUntil: "networkidle" });
    }
    // 새 자리에서 「내 주문」이 비어 있으면 손님은 주문이 사라진 줄 안다.
    const carried = await gp.evaluate((t) => JSON.parse(localStorage.getItem(`hgk_orders_${t}`) || "[]"), String(K));
    check("주문 내역도 새 자리로 옮겨진다", carried.includes(mine.body.id), JSON.stringify(carried));
    check("새 자리에서는 안내가 안 뜬다", await gp.locator("#movedBackdrop").isHidden());

    // 옛 자리는 이제 비어 있다 — 사장님: "원래있던 건 이제 비워지는 거지."
    {
      const t = (await api("/api/tables")).body.find((x) => String(x.number) === String(J));
      check("옛 자리에 인원수가 없다", !t.party_size, `${t.party_size}`);
      const left = (await api("/api/orders")).body.filter(
        (o) => String(o.table_number) === String(J) && o.status !== "cancelled"
      );
      check("옛 자리에 남은 주문이 없다", left.length === 0, JSON.stringify(left.map((o) => o.id)));
    }

    // 그 자리에 새로 앉은 다른 손님에게는 뜨면 안 된다 — 그게 더 큰 혼란이다.
    const other = await browser.newContext({ viewport: { width: 420, height: 900 } });
    const op = await other.newPage();
    op.on("dialog", (d) => d.dismiss());
    await op.goto(`${base}/t/${J}`, { waitUntil: "networkidle" });
    await op.waitForTimeout(600);
    check("아무 상관 없는 손님에게는 안 뜬다", await op.locator("#movedBackdrop").isHidden());
    check("그 손님에게는 인원수를 묻는다", await op.locator("#partySizeBackdrop").isVisible());

    // 새 손님이 인원수를 찍으면 안내는 거기서 끝난다.
    await put(`/api/tables/${J}/party-size`, { partySize: 3 });
    await gp.goto(`${base}/t/${J}`, { waitUntil: "networkidle" });
    await gp.waitForTimeout(600);
    check("새 손님이 앉으면 안내가 사라진다", await gp.locator("#movedBackdrop").isHidden());

    await guest.close();
    await other.close();
  }

  out.push("\n[설정 > 인쇄에서 고칠 수 있다]");
  // 2026-09-10 사장님: "이것도 설정 -> 인쇄 에서 수정할 수 있게 해줘."
  {
    await page.locator('.admin-tabs button[data-tab="settings"]').click();
    await page.waitForTimeout(700);
    await page.locator('.settings-nav-btn[data-category="print"]').click();
    await page.waitForTimeout(400);
    check("자리 이동 빌지 카드가 보인다", await page.locator("#moveSlipEnabledToggle").isVisible());
    check("미리보기가 있다", await page.locator("#moveSlipPreviewFrame").isVisible());
    // 미리보기는 실제로 인쇄되는 그 HTML 그대로여야 한다 — 따로 그린
    // 그림이면 화면과 종이가 조금씩 달라지고, 그 차이는 종이가 나온 뒤에야 보인다.
    const previewText = await page.frameLocator("#moveSlipPreviewFrame").locator("body").innerText();
    check("미리보기에 자리 번호가 크게 들어간다", previewText.includes("5 → 8"), previewText.slice(0, 120));

    // 크기를 바꾸면 미리보기가 따라온다.
    await page.locator("#msTables").fill("28");
    await page.waitForTimeout(300);
    const css = await page.frameLocator("#moveSlipPreviewFrame").locator("head style").innerText();
    check("바꾼 크기가 미리보기에 반영된다", /\.big[^}]*font-size: 28px/.test(css), css.slice(0, 200));

    await page.locator("#saveMoveSlipBtn").click();
    await page.waitForTimeout(700);
    const saved = await page.evaluate(async () => (await fetch("/api/settings/move-slip")).json());
    check("저장된다", saved.tables === 28, JSON.stringify(saved));
    check("켜짐/끄기도 같이 저장된다", saved.enabled === true && saved.showOrders === true, JSON.stringify(saved));

    // 저장한 크기가 실제로 나가는 종이에 쓰이는지 — 설정만 저장되고 인쇄가
    // 예전 크기로 나가면 아무 의미가 없다.
    const usesSaved = await page.evaluate(() => {
      const html = window.__moveSlipHtmlForTest({ from: "5", to: "8", at: "19:32", orders: [] }, { tables: 28 });
      return /\.big[^}]*font-size: 28px/.test(html);
    });
    check("인쇄에도 그 크기가 쓰인다", usesSaved);

    // 범위 밖 값은 서버가 잘라낸다 — 오타 하나로 종이를 낭비하거나 못 읽는
    // 빌지가 나오면 안 된다.
    const clamped = await page.evaluate(async () => {
      const r = await fetch("/api/settings/move-slip", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tables: 999, storeNameWeight: 12345 }),
      });
      return r.json();
    });
    check("너무 큰 크기는 잘라낸다", clamped.tables === 40, JSON.stringify(clamped));
    check("굵기는 100 단위로 맞춘다", clamped.storeNameWeight === 900, JSON.stringify(clamped));

    // 껐으면 인쇄하지 않는다.
    await page.evaluate(async () => {
      await fetch("/api/settings/move-slip", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      });
    });
    const off = await page.evaluate(async () => (await fetch("/api/settings/move-slip")).json());
    check("끌 수 있다", off.enabled === false, JSON.stringify(off));
    {
      // 사장님이 배포 전에 눈으로 확인할 수 있게 찍어둔다.
      const shots = path.join(__dirname, "..", "..", "..", "_screens");
      fs.mkdirSync(shots, { recursive: true });
      await page.locator("#moveSlipEnabledToggle").locator("xpath=../..").screenshot({ path: path.join(shots, "move-slip-settings.png") });
    }
    await page.evaluate(async () => {
      await fetch("/api/settings/move-slip", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true, tables: 34 }),
      });
    });
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
