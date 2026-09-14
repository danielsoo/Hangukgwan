// 수기 주문을 넣고 나면 관리자 화면으로 저절로 돌아가는가.
//
// 2026-09-14 사장님: "단말기로 수기주문완료후 실시간주문탭으로 자동 복귀되도록."
//
// 이 화면은 직원이 손님 대신 주문을 넣으려고 잠깐 들어온 곳이다. 넣고 나면
// 볼 일이 없는데 지금까지는 「관리자로」를 직접 눌러야 했다.
//
// 지켜야 하는 것이 세 가지다.
//   1) 직원이 넣은 수기 주문이면 돌아간다
//   2) **손님 주문은 절대 안 돌아간다** — 벽의 QR 로 들어온 손님 화면이
//      관리자 화면으로 넘어가면 가게 장부가 손님 폰에 열린다
//   3) 「계속 추가」를 누르면 안 돌아간다 — 메뉴를 고르는 중에 넘어가면
//      담던 것이 사라진다
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
const html = fs.readFileSync(path.join(__dirname, "../public/order.html"), "utf8");

// 주문 흐름을 그대로 꺼내 돌린다.
const flowFrom = src.indexOf("  async function submitOrderFlow(");
const flowTo = src.indexOf("\n  function saveOrderToHistory(", flowFrom);
const flow = src.slice(flowFrom, flowTo);

function run({ fromAdmin, ok = true }) {
  const calls = { returned: 0 };
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
    refreshMinSpend: async () => 0,
    minSpendRequired: 0,
    showPartyWarningModal() {},
    storeLat: null,
    storeLng: null,
    locationOrNothing: async () => null,
    authHeadersNow: async () => ({ "Content-Type": "application/json" }),
    firebaseAuth: null,
    fetch: async () => (ok
      ? { ok: true, status: 201, json: async () => ({ id: 901 }) }
      : { ok: false, status: 403, json: async () => ({ error: "closed_now" }) }),
    tableNumber: "7",
    setSubmitBusy() {},
    applyOrderingState() {},
    saveOrderToHistory() {},
    renderCartFab() {},
    cartChanged() {},
    showConfirmation() {},
    alert() {},
    closedMessage: () => "",
    ordering: {},
    sessionStorage: { removeItem() {} },
    COUNTER_NAME_KEY: "n",
    COUNTER_PHONE_KEY: "p",
    fromAdmin,
    returnToAdminAfterOrder() { calls.returned++; },
  };
  const names = Object.keys(stub);
  const harness = new Function(
    ...names,
    `let submitting = false;
     let cartToken = "T";
     let activeOrderId = null;
     let hasPriorOrder = false;
     let counterCustomerPhone = null;
     ${flow}
     return { submitOrderFlow };`
  )(...names.map((n) => stub[n]));
  return { harness, calls };
}

(async () => {
  check("주문 흐름을 찾는다", flowFrom > 0 && flowTo > flowFrom, `${flowFrom}, ${flowTo}`);

  out.push("\n[직원이 넣은 수기 주문]");
  {
    const { harness, calls } = run({ fromAdmin: true });
    await harness.submitOrderFlow(false);
    check("★ 관리자 화면으로 돌아간다", calls.returned === 1, `${calls.returned}번`);
  }

  out.push("\n[손님이 QR 로 들어온 주문]");
  {
    const { harness, calls } = run({ fromAdmin: false });
    await harness.submitOrderFlow(false);
    check("★ 손님 화면은 절대 안 돌아간다", calls.returned === 0, `${calls.returned}번 — 손님 폰에 가게 장부가 열린다`);
  }

  out.push("\n[주문이 실패했을 때]");
  {
    const { harness, calls } = run({ fromAdmin: true, ok: false });
    await harness.submitOrderFlow(false);
    check("★ 안 들어갔으면 안 돌아간다", calls.returned === 0, `${calls.returned}번 — 실패한 줄 모르고 넘어간다`);
  }

  out.push("\n[「계속 추가」를 누르면]");
  check(
    "★ 돌아가려던 것을 멈춘다",
    /\$\("#backToMenuBtn"\)\.onclick = \(\) => \{\s*(\/\/[^\n]*\n\s*)*cancelAdminReturn\(\);/.test(src),
    "메뉴를 고르는 중에 화면이 넘어가면 담던 것이 사라진다"
  );

  out.push("\n[안내 없이 넘어가지 않는다]");
  check("돌아간다는 줄이 있다", /id="confirmReturnNote"/.test(html), "");
  check("세 언어가 다 있다", /ADMIN_RETURN_NOTE = \{[\s\S]{0,200}zh:[\s\S]{0,200}ko:[\s\S]{0,200}en:/.test(src), "");
  check("완료 화면을 보여주고 나서 돌아간다", /ADMIN_RETURN_MS = (\d+)/.test(src) && Number(RegExp.$1) >= 800, RegExp.$1);

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
