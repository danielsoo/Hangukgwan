// 테스터 모드 — 켜고, 뭐든 해보고, 끄면 되돌아가는가.
//
// 2026-09-10 사장님: "테스터 모드를 키면 매장 시간, 품절 이런 거 대부분의
// 것들 전부 무시한 채로 뭐든 만들 수 있게 해줘. 그리고 테스터 모드 종료를
// 하면 그 모드동안 만들었던 거 전부 원래대로 삭제하고 되돌려주는 기능."
//
// ── 이 파일이 지키는 단 하나 ──────────────────────────────────────────
//
//   **진짜 손님의 주문은 어떤 경우에도 지워지지 않는다.**
//
// 테스터 모드를 켜둔 사이에도 벽의 QR 을 찍은 손님은 주문한다. 그것까지
// 테스트로 잡히면 「종료」 버튼 한 번에 받을 돈이 사라진다. 아래 [5]가
// 그것을 정면으로 잰다 — 테스트 중에 들어온 진짜 주문을 하나 만들어두고,
// 종료한 뒤에도 그대로 있는지 본다. 다른 모든 검사가 통과해도 그 하나가
// 실패하면 이 기능은 내보내면 안 된다.
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
process.env.SESSION_SECRET = "test-mode-test";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const request = require("supertest");
const app = require("../server");
// save() 까지 부르는 것이 중요하다. 이 앱은 요청마다 store 를 몽고에서
// 다시 읽으므로(src/db.js refreshStore), 메모리만 고치면 바로 다음 요청에서
// 날아간다. 실제로 이 테스트를 처음 돌렸을 때 "영업시간 밖" 을 만들어둔 것이
// 그렇게 사라져서, 검사가 아무것도 검사하지 않고 통과할 뻔했다.
const { store, save } = require("../src/db");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

// 로그인 상태를 들고 다니는 작은 클라이언트. 기기 하나에 해당한다.
function device() {
  const jar = [];
  const send = (method, url) => {
    const r = request(app)[method](url);
    if (jar.length) r.set("Cookie", jar.join("; "));
    const then = r.then.bind(r);
    r.then = (fn, rej) =>
      then((res) => {
        const set = res.headers["set-cookie"];
        if (set) for (const c of set) {
          const bare = c.split(";")[0];
          const name = bare.split("=")[0];
          const i = jar.findIndex((x) => x.split("=")[0] === name);
          if (i >= 0) jar[i] = bare; else jar.push(bare);
        }
        return fn ? fn(res) : res;
      }, rej);
    return r;
  };
  return {
    get: (u) => send("get", u),
    post: (u) => send("post", u),
    put: (u) => send("put", u),
    patch: (u) => send("patch", u),
  };
}

(async () => {
  // ---- 준비: 사장 기기, 직원 기기(평소), 손님 폰(평소) ----
  const boss = device();
  await boss.post("/api/auth/login").send({ password: "ownerpass123" });
  const staff = device();
  await staff.post("/api/auth/login").send({ password: "ownerpass123" });
  const guest = device(); // 로그인 안 한 진짜 손님

  const T = store.tables.find((t) => !t.is_counter).number;
  const T2 = store.tables.filter((t) => !t.is_counter)[1].number;
  const itemId = store.menuItems[0].id;
  const soldOutId = store.menuItems[1].id;

  // 영업시간을 지금 확실히 "닫힘"으로 만들어 둔다. 그래야 "영업시간을
  // 무시하는가"를 진짜로 잴 수 있다 — 마침 열려 있는 시각에 돌리면 이
  // 검사는 아무것도 검사하지 않는다.
  // 저장 형태는 settings.order_hours (src/openHours.js 맨 위 주석).
  //
  // 「지금이 아닌 한 시간」을 주문 시간으로 잡는다. 고정된 시각을 박아두면
  // 하루 중 언제 돌리느냐에 따라 이 테스트가 아무것도 검사하지 않게 된다 —
  // 실제로 test/e2e-open-hours.js 가 그 이유로 영업시간에 실패한다.
  const { nowLocal: _now } = require("../src/time");
  const hourNow = parseInt(String(_now()).slice(11, 13), 10);
  const from = String((hourNow + 3) % 24).padStart(2, "0");
  const to = String((hourNow + 4) % 24).padStart(2, "0");
  store.settings.order_hours = {
    enabled: 1,
    ranges: [{ start: `${from}:00`, end: `${to}:00` }],
    closed_days: [],
    day_ranges: {},
  };
  // 두 번째 메뉴를 품절로.
  store.menuItems.find((m) => m.id === soldOutId).available = 0;
  await save();

  // 확인: 정말로 지금 "닫힘" 인가. 이걸 안 보면 아래 [1]과 [3]이 무엇을
  // 재는지 알 수 없다 — 마침 영업시간이면 둘 다 조용히 무의미해진다.
  {
    const { isOpenNow } = require("../src/openHours");
    check("준비: 지금은 주문을 안 받는 시각이다", isOpenNow(store.settings) === false);
  }

  out.push("[1] 켜기 전 — 평소 규칙이 그대로 산다");
  {
    await guest.put(`/api/tables/${T}/party-size`).send({ partySize: 2 });
    const r = await guest.post("/api/orders").send({ tableNumber: T, items: [{ itemId, qty: 1 }] });
    check("영업시간 밖이면 손님은 주문 못 한다", r.status === 403 && r.body.error === "closed_now", JSON.stringify(r.body));
  }

  out.push("\n[2] 켜기 — 켠 기기만 테스트가 된다");
  let session;
  {
    // 켜기 전에 「엉뚱한 기기」가 인쇄 담당을 쥐고 있는 상태를 만들어 둔다.
    // 아래 [11] 이 이걸 쓴다 — 종료가 이 값을 되돌려 놓으면 안 된다.
    await boss.put("/api/settings/print-device").send({ id: "dev-off-lan", name: "사장님 폰" });
    const r = await boss.post("/api/test-mode/start").send({});
    check("사장이 켤 수 있다", r.status === 200 && r.body.active === true, JSON.stringify(r.body));
    check("켠 기기는 바로 참여 상태", r.body.thisDevice === true);
    session = store.settings.test_session;
    check("활성 세션이 store 에 남는다", !!(session && session.id));

    const s = await staff.get("/api/test-mode");
    check("다른 직원 기기도 '켜져 있다'는 것은 안다", s.body.active === true);
    check("그러나 그 기기는 아직 테스트가 아니다", s.body.thisDevice === false, JSON.stringify(s.body));
  }

  out.push("\n[3] 테스트 기기는 막는 규칙들을 지나간다");
  let testOrderId;
  {
    // 인원수를 일부러 지운다 — 그것도 무시해야 한다.
    const table = store.tables.find((t) => t.number === String(T2));
    table.party_size = null;

    const r = await boss.post("/api/orders").send({ tableNumber: T2, items: [{ itemId, qty: 1 }] });
    check("영업시간 밖에도 주문된다", r.status === 201, JSON.stringify(r.body));
    check("인원수를 안 물어도 주문된다", r.status === 201);
    testOrderId = r.body.id;
    check("테스트 표가 붙는다", r.body.test_session === session.id, JSON.stringify(r.body.test_session));

    const so = await boss.post("/api/orders").send({ tableNumber: T2, items: [{ itemId: soldOutId, qty: 1 }] });
    check("품절 메뉴도 주문된다", so.status === 201, JSON.stringify(so.body));

    check("금액은 진짜 그대로 계산된다", r.body.total > 0 && r.body.total === r.body.subtotal, JSON.stringify({ t: r.body.total, s: r.body.subtotal }));
  }

  out.push("\n[4] 테스트 주문은 평소 화면에 안 보인다");
  {
    const mine = await boss.get("/api/orders");
    const theirs = await staff.get("/api/orders");
    check("테스트 기기에는 보인다", mine.body.some((o) => o.id === testOrderId));
    check("평소 기기에는 안 보인다", !theirs.body.some((o) => o.id === testOrderId), JSON.stringify(theirs.body.map((o) => o.id)));

    const one = await staff.get(`/api/orders/${testOrderId}`);
    check("주소를 알아도 평소 기기에는 안 열린다", one.status === 404, String(one.status));
  }

  out.push("\n[5] ★ 테스트 중에 들어온 진짜 손님 주문");
  let realOrderId;
  {
    // 직원이 대신 넣는 진짜 주문(직원은 영업시간 예외라 평소에도 된다).
    const r = await staff.post("/api/orders").send({ tableNumber: T, items: [{ itemId, qty: 2 }] });
    check("진짜 주문이 들어간다", r.status === 201, JSON.stringify(r.body));
    realOrderId = r.body.id;
    check("진짜 주문에는 테스트 표가 없다", !r.body.test_session, String(r.body.test_session));

    const theirs = await staff.get("/api/orders");
    check("평소 기기에 보인다", theirs.body.some((o) => o.id === realOrderId));
    const mine = await boss.get("/api/orders");
    check("테스트 기기에도 보인다 (테스트 중에도 장사는 해야 한다)", mine.body.some((o) => o.id === realOrderId));
  }

  out.push("\n[6] 결산 — 테스트 기기는 테스트만, 평소 기기는 진짜만");
  {
    // 대만 날짜로 물어야 한다. UTC 날짜를 쓰면 대만이 자정을 넘긴 뒤
    // (UTC 16:00~24:00, 대만 새벽) 어제 날짜로 결산을 물어보게 되고, 방금
    // 넣은 주문이 없는 날이라 매출이 0 으로 나온다 — 코드가 아니라 이
    // 테스트가 하루에 여덟 시간씩 틀리던 자리다(2026-09-11 새벽에 걸렸다).
    // e2e-vip-sale.js 도 같은 이유로 +8시간을 더한다.
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

    // 매출이 잡히려면 결제가 돼 있어야 한다. 테스트 주문 하나를 결제한다.
    const paid = await boss.patch(`/api/orders/${testOrderId}`).send({ status: "paid", paymentMethod: "cash" });
    check("테스트 주문을 결제할 수 있다", paid.status === 200, JSON.stringify(paid.body).slice(0, 120));

    const mine = await boss.get(`/api/settlements?start=${today}&end=${today}`);
    check("테스트 기기 결산이 나온다", mine.status === 200, String(mine.status));
    check("테스트 매출이 잡힌다", mine.body.total_revenue > 0, JSON.stringify(mine.body.total_revenue));

    // 진짜 주문도 하나 결제해 두고, 두 숫자가 서로 안 섞이는지 본다.
    await staff.patch(`/api/orders/${realOrderId}`).send({ status: "paid", paymentMethod: "cash" });
    const theirs = await staff.get(`/api/settlements?start=${today}&end=${today}`);
    check("평소 기기 결산도 나온다", theirs.status === 200);
    check(
      "★ 두 숫자가 섞이지 않는다",
      theirs.body.total_revenue !== mine.body.total_revenue &&
        theirs.body.total_revenue > 0 &&
        mine.body.total_revenue > 0,
      `테스트 ${mine.body.total_revenue} / 진짜 ${theirs.body.total_revenue}`
    );

    out.push("  -- 마감도 된다 (2026-09-10 사장님: 결산까지 구현) --");
    const close = await boss.post("/api/settlements/close").send({});
    check("테스트 기기도 마감할 수 있다", close.status === 200, JSON.stringify(close.body).slice(0, 120));
    check("그 마감에는 테스트 표가 붙는다", close.body.test_session === session.id, String(close.body.test_session));

    const myHist = await boss.get("/api/settlements/history");
    check("테스트 기기 기록에 그 마감이 보인다", (myHist.body || []).some((r) => r.test_session === session.id));
    const theirHist = await staff.get("/api/settlements/history");
    check(
      "★ 평소 기기 기록에는 테스트 마감이 안 보인다",
      !(theirHist.body || []).some((r) => r.test_session),
      JSON.stringify((theirHist.body || []).map((r) => r.date))
    );

    // 평소 기기로 진짜 마감을 하나 찍어둔다. [9]에서 이게 살아남는지 본다.
    const realClose = await staff.post("/api/settlements/close").send({});
    check("평소 기기의 진짜 마감이 찍힌다", realClose.status === 200 && !realClose.body.test_session, JSON.stringify(realClose.body.test_session));

    out.push("  -- 정산은 되지만 LINE 은 안 나간다 --");
    store.settings.line_notify_enabled = true;
    await save();
    const shift = await boss.post("/api/settlements/shift-close").send({ shift: "am" });
    check("테스트 기기도 정산을 누를 수 있다", shift.status === 200, JSON.stringify(shift.body).slice(0, 120));
    check(
      "★ 직원 LINE 으로는 안 나간다",
      shift.body.line && shift.body.line.sent === false && shift.body.line.error === "test_mode",
      JSON.stringify(shift.body.line)
    );
  }

  out.push("\n[7] 손님 폰을 참여시키기");
  {
    const bad = await guest.get("/api/test-mode/join?token=아무거나");
    check("아무 토큰으로는 못 들어온다", bad.status === 403, String(bad.status));

    const ok = await guest.get(`/api/test-mode/join?token=${encodeURIComponent(session.token)}&to=/t/${T2}`);
    check("맞는 토큰이면 들어온다", ok.status === 302, String(ok.status));
    check("원하는 자리로 보내준다", ok.headers.location === `/t/${T2}`, ok.headers.location);

    const evil = await guest.get(`/api/test-mode/join?token=${encodeURIComponent(session.token)}&to=//evil.example.com`);
    check("바깥 주소로는 안 보낸다", evil.headers.location === "/admin", evil.headers.location);

    const r = await guest.post("/api/orders").send({ tableNumber: T2, items: [{ itemId, qty: 1 }] });
    check("이제 그 폰도 영업시간을 지나간다", r.status === 201, JSON.stringify(r.body));
    check("그 주문에도 테스트 표가 붙는다", r.body.test_session === session.id);
  }

  out.push("\n[8] 설정과 메뉴를 바꿔본다");
  const beforeName = store.settings.store_name_ko;
  {
    store.settings.store_name_ko = "테스트로 바꾼 이름";
    store.menuItems.find((m) => m.id === itemId).price = 99999;
    await save();
    const pv = await boss.get("/api/test-mode/preview-end");
    check("미리보기가 온다", pv.status === 200, String(pv.status));
    check("바뀐 설정을 짚어준다", (pv.body.settings || []).includes("store_name_ko"), JSON.stringify(pv.body.settings));
    check("바뀐 메뉴를 짚어준다", (pv.body.menu.modified || []).some((m) => m.id === itemId), JSON.stringify(pv.body.menu));
    check("지워질 주문 수를 알려준다", pv.body.rows.orders >= 3, JSON.stringify(pv.body.rows));
  }

  out.push("\n[9] ★★ 종료 — 테스트만 사라지고 진짜는 남는다");
  {
    // 테스트 중에 인쇄 담당을 가게 태블릿으로 옮긴다. [11] 이 이 값을 본다.
    await boss.put("/api/settings/print-device").send({ id: "dev-tablet", name: "가게 태블릿" });
    const r = await boss.post("/api/test-mode/end").send({});
    check("종료된다", r.status === 200 && r.body.ok === true, JSON.stringify(r.body));
    check("테스트 주문이 지워졌다", r.body.deleted.orders >= 3, JSON.stringify(r.body.deleted));

    const gone = await boss.get(`/api/orders/${testOrderId}`);
    check("테스트 주문은 이제 없다", gone.status === 404, String(gone.status));

    const alive = await boss.get(`/api/orders/${realOrderId}`);
    check("★ 진짜 손님 주문은 그대로 있다", alive.status === 200 && alive.body.id === realOrderId, JSON.stringify(alive.body).slice(0, 150));
    check("★ 금액도 그대로다", alive.status === 200 && alive.body.total > 0);

    check("설정이 되돌아왔다", store.settings.store_name_ko === beforeName, String(store.settings.store_name_ko));
    check("메뉴 가격이 되돌아왔다", store.menuItems.find((m) => m.id === itemId).price !== 99999);
    check("활성 세션이 사라졌다", !store.settings.test_session);
    check("테스트 마감도 지워졌다", (r.body.deleted.daily_settlements || 0) >= 1, JSON.stringify(r.body.deleted));

    const hist = await boss.get("/api/settlements/history");
    check("★ 진짜 마감은 그대로 있다", (hist.body || []).length >= 1, JSON.stringify((hist.body || []).map((x) => x.date)));
    check("★ 남은 마감에 테스트 표가 없다", !(hist.body || []).some((x) => x.test_session), JSON.stringify(hist.body || []));
  }

  out.push("\n[10] 종료하면 참여했던 기기가 전부 같이 풀린다");
  {
    const g = await guest.post("/api/orders").send({ tableNumber: T2, items: [{ itemId, qty: 1 }] });
    check("참여했던 손님 폰이 다시 영업시간에 막힌다", g.status === 403 && g.body.error === "closed_now", JSON.stringify(g.body));

    const s = await boss.get("/api/test-mode");
    check("상태가 꺼짐으로 보인다", s.body.active === false, JSON.stringify(s.body));
  }

  out.push("\n[11] 종료해도 인쇄 담당은 되돌리지 않는다");
  {
    // 2026-09-10 사장님이 여기에 걸릴 뻔했다. 테스터 모드를 켠 뒤 인쇄 담당을
    // 가게 태블릿으로 옮겼는데, 종료하면 설정이 「켜기 전」으로 돌아가면서
    // 담당도 프린터에 닿지 못하는 기기로 같이 돌아간다. 그 순간부터 자동
    // 인쇄가 조용히 멈추고 아무도 이유를 모른다.
    //
    // print_device 는 「가게를 어떻게 운영하는가」가 아니라 「지금 어느 기기가
    // 켜져 있는가」다. 테스트로 만든 값이 아니므로 되돌릴 대상이 아니다.
    const pd = store.settings.print_device || {};
    check("★ 테스트 중에 옮긴 담당이 그대로다", pd.id === "dev-tablet", JSON.stringify(pd));
    check("★ 켜기 전 담당으로 돌아가지 않았다", pd.id !== "dev-off-lan", JSON.stringify(pd));
  }

  out.push("\n[12] 권한");
  {
    const anon = device();
    const r = await anon.post("/api/test-mode/start").send({});
    check("로그인 안 한 사람은 못 켠다", r.status === 401 || r.status === 403, String(r.status));
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
