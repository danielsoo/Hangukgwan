// 손님이 「주문완료」를 보기까지, 쓸데없이 줄 서 있지 않은가.
//
// 2026-09-14 사장님: "손님이 qr 을 읽고 주문했을 때 주문완료를 보는 시간이
// 너무 길다고 피드백이 왔어."
//
// 화면이 기다리던 것은 셋이었고, 셋을 차례로 세워놨었다.
//
//   1) 低消가 모자라지 않은지 물어보기 — 왕복 한 번
//   2) 위치 잡기 — 실내에서는 제한 시간 8초를 다 쓰고 실패한다
//   3) 주문 보내기
//
// 셋은 서로 아무 상관이 없다. 그런데 손님은 1+2+3 을 다 기다렸다. 게다가 2 는
// 8초를 기다려서 얻는 것이 없는 기다림이다 — 못 잡으면 어차피 좌표 없이
// 보내고, 서버는 그런 주문을 받아 표만 달아둔다
// (claude/2026-09-10-location-gate.md).
//
// 실제 order.js 의 코드를 그대로 꺼내 잰다. 「동시에 시작하도록 고쳤다」는
// 코드에 그렇게 적혀 있는지가 아니라, 정말로 합이 아니라 최대값만큼만
// 걸리는지로 확인해야 한다.
const fs = require("fs");
const path = require("path");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const src = fs.readFileSync(path.join(__dirname, "../public/js/order.js"), "utf8");

// ── 위치 헬퍼들을 그대로 꺼낸다 ──────────────────────────────────────
const helpersFrom = src.indexOf("  let warmGeoAt = 0;");
const helpersTo = src.indexOf("  function setSubmitBusy(on) {");
const helpers = src.slice(helpersFrom, helpersTo);

// ── 주문 흐름도 그대로 꺼낸다 ────────────────────────────────────────
const flowFrom = src.indexOf("  async function submitOrderFlow(");
const flowTo = src.indexOf("\n  function saveOrderToHistory(", flowFrom);
const flow = src.slice(flowFrom, flowTo);

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  check("위치 헬퍼를 찾는다", helpersFrom > 0 && helpersTo > helpersFrom, `${helpersFrom}, ${helpersTo}`);
  check("주문 흐름을 찾는다", flowFrom > 0 && flowTo > flowFrom, `${flowFrom}, ${flowTo}`);

  out.push("\n[위치를 언제까지 기다리는가]");
  {
    // 영영 안 잡히는 폰. 실내에서 실제로 이렇다.
    let started = 0;
    const make = (opts) =>
      new Function(
        "getGeolocation", "storeLat", "storeLng",
        `${helpers}
         return { warmGeolocation, acquireGeolocation, locationOrNothing, GEO_WAIT_MS };`
      )(opts.getGeolocation, 24.83, 121.0);

    const api = make({ getGeolocation: () => { started++; return new Promise(() => {}); } });
    check("기다림에 상한이 있다", typeof api.GEO_WAIT_MS === "number" && api.GEO_WAIT_MS > 0, String(api.GEO_WAIT_MS));
    check(
      "상한이 브라우저 제한 시간(8초)보다 한참 짧다",
      api.GEO_WAIT_MS <= 4000,
      `${api.GEO_WAIT_MS}ms — 이만큼 손님이 완료 화면을 못 본다`
    );

    const t0 = Date.now();
    const coords = await api.locationOrNothing();
    const waited = Date.now() - t0;
    check("★ 안 잡히면 좌표 없이 그냥 보낸다", coords === null, JSON.stringify(coords));
    check(
      "★ 상한만큼만 기다린다",
      waited >= api.GEO_WAIT_MS - 100 && waited < api.GEO_WAIT_MS + 600,
      `${waited}ms (상한 ${api.GEO_WAIT_MS}ms)`
    );
  }

  out.push("\n[미리 잡아둔 것을 그대로 쓰는가]");
  {
    let started = 0;
    let release = null;
    const api = new Function(
      "getGeolocation", "storeLat", "storeLng",
      `${helpers}
       return { warmGeolocation, acquireGeolocation, locationOrNothing };`
    )(
      () => { started++; return new Promise((r) => { release = () => r({ lat: 1, lng: 2 }); }); },
      24.83, 121.0
    );

    api.warmGeolocation(); // 장바구니를 연 순간
    check("장바구니를 열면 잡기 시작한다", started === 1, `${started}번`);
    const p = api.locationOrNothing(); // 손님이 送出 을 누른다
    await tick(0);
    check(
      "★ 주문할 때 처음부터 다시 잡지 않는다",
      started === 1,
      `${started}번 잡았다 — 미리 잡아둔 보람이 없다`
    );
    release();
    check("미리 잡아둔 값이 그대로 온다", JSON.stringify(await p) === JSON.stringify({ lat: 1, lng: 2 }), "");
  }

  out.push("\n[셋을 동시에 시작하는가]");
  {
    // 低消 조회와 위치 잡기에 각각 300ms 를 물린다. 차례로 세우면 600ms,
    // 동시에 시작하면 300ms 남짓이어야 한다.
    const SLOW = 300;
    let busy = false;
    const stub = {
      $: () => ({ hidden: false, disabled: false, classList: { toggle() {} }, textContent: "" }),
      t: (k) => k,
      cart: [{ itemId: 1, qty: 1, orderType: "dine_in", addons: [] }],
      cartTotal: () => 230,
      partySize: 2,
      isCounterTable: false,
      counterCustomerName: null,
      pendingSeatingPrompt: null,
      askSeatingIfOpen() {},
      refreshMinSpend: async () => { await tick(SLOW); return 0; },
      minSpendRequired: 0,
      showPartyWarningModal() {},
      storeLat: 24.83,
      storeLng: 121.0,
      locationOrNothing: async () => { await tick(SLOW); return { lat: 24.83, lng: 121.0 }; },
      authHeadersNow: async () => ({ "Content-Type": "application/json" }),
      firebaseAuth: null,
      fetch: async () => ({ ok: true, status: 201, json: async () => ({ id: 901 }) }),
      tableNumber: "7",
      setSubmitBusy: (on) => { busy = on; },
      applyOrderingState() {},
      saveOrderToHistory() {},
      renderCartFab() {},
      showConfirmation() {},
      alert() {},
      sessionStorage: { removeItem() {} },
      COUNTER_NAME_KEY: "n",
      COUNTER_PHONE_KEY: "p",
    };
    const names = Object.keys(stub);
    const harness = new Function(
      ...names,
      `let submitting = false;
       let cartToken = "TOKEN-SPEED";
       let activeOrderId = null;
       let hasPriorOrder = false;
       let counterCustomerPhone = null;
       ${flow}
       return { submitOrderFlow };`
    )(...names.map((n) => stub[n]));

    const t0 = Date.now();
    const finished = await Promise.race([
      harness.submitOrderFlow(false).then(() => true),
      tick(5000).then(() => false),
    ]);
    const took = Date.now() - t0;
    check("주문 흐름이 끝난다", finished === true, "안 끝났다");
    check(
      "★ 低消 조회와 위치 잡기를 동시에 한다",
      took < SLOW * 2 - 60,
      `${took}ms — 차례로 세우면 ${SLOW * 2}ms, 동시에 하면 ${SLOW}ms 남짓`
    );
    check("끝나면 잠금이 풀린다", busy === false, `busy=${busy}`);
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
