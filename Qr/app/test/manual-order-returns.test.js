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

  out.push("\n[실시간 주문 탭으로 이동 — 기다리지 않고 바로]");
//
// 2026-09-16 사장님(완료 화면 스크린샷과 함께): "단말기로 수기주문완료후
// 실시간주문탭으로 자동 복귀되도록해줘. 주문하고 뜨는 이걸 실시간 주문
// 탭으로 이동으로 바꿔줘."
//
// 자동 복귀는 2026-09-14 에 넣었는데 **키오스크 앱 안에서만** 걸렸다.
// 보통 브라우저로 쓰는 단말기는 새 탭으로 열려서 ?fromAdmin=1 이 안 붙고,
// 그래서 완료 화면에 「繼續加點」만 남았다. 사장님이 본 화면이 그것이다.
const adminSrc = fs.readFileSync(path.join(__dirname, "../public/js/admin.js"), "utf8");
check(
  "★ 새 탭으로 여는 길에도 fromAdmin 이 붙는다",
  /window\.open\(`\/t\/\$\{encodeURIComponent\(t\.number\)\}\?fromAdmin=1`/.test(adminSrc),
  "안 붙으면 보통 브라우저 단말기에서는 돌아가는 길이 아예 안 뜬다"
);
check("완료 화면에 큰 버튼 자리가 있다", /id="goToAdminOrdersBtn"/.test(html), "");
check(
  "★ 수기 주문일 때만 켠다 — 손님에게 관리자 화면은 갈 곳이 아니다",
  /if \(fromAdmin\) \{[\s\S]{0,900}?goToAdminOrdersBtn/.test(src),
  ""
);
check("세 언어가 다 있다", /ADMIN_ORDERS_BTN = \{[\s\S]{0,200}?zh:[\s\S]{0,200}?ko:[\s\S]{0,200}?en:/.test(src), "");
check(
  "★ 실시간 주문 탭을 못 박아 부른다",
  /ADMIN_ORDERS_URL = "\/admin#orders"/.test(src),
  "그냥 /admin 이면 나중에 기본 탭이 바뀌는 순간 약속이 깨진다"
);
check(
  "★ 관리자 화면이 그 #탭이름 을 실제로 연다",
  /function openTabFromHash\(\)/.test(adminSrc) && /openTabFromHash\(\);/.test(adminSrc),
  "주소에 적어놓고 아무도 안 읽으면 소용없다"
);
check(
  "★ 누르면 기다리지 않고 바로 간다",
  /goToAdminOrdersBtn[\s\S]{0,400}?cancelAdminReturn\(\)[\s\S]{0,80}?goBackToAdmin\(\)/.test(src),
  ""
);
check(
  "★ 새 탭으로 열려 왔으면 그 탭을 닫는다 — 관리자 화면이 둘이 되면 안 된다",
  /if \(window\.opener\)[\s\S]{0,200}?window\.close\(\)/.test(src),
  ""
);
check(
  "닫기가 막혀도 갈 길이 있다",
  /window\.close\(\)[\s\S]{0,300}?location\.href = ADMIN_ORDERS_URL/.test(src),
  ""
);
check(
  "자동 복귀도 같은 길을 쓴다",
  /setTimeout\(goBackToAdmin, ADMIN_RETURN_MS\)/.test(src),
  "두 길이 갈라지면 하나만 고쳐진다"
);
check("「계속 추가」는 둘째 버튼이 된다", /backToMenuBtn[\s\S]{0,120}?classList\.add\("secondary-btn"\)/.test(src), "");

console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
