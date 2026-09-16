// 포장 카운터의 카드 하나하나가 진짜 「따로」인가.
//
// 2026-09-16 사장님(포장 결제창 스크린샷과 함께): "포장 결제 탭도 각 탭들이
// 일반 테이블처럼 세팅 되어야 해. 그냥 3개씩 한 행에 넣어준 것 뿐이야.
// vip 카드도 별개, 결제도 별개 세팅값도."
//
// 카운터의 카드 하나 = 손님 한 명이다. 그런데 한 가지가 테이블 단위로
// 남아 있었다 — **얹어 둔 VIP 카드**.
//
//   pendingVipCardSale = { tableNumber, cardNumber }
//
// 4번 손님에게 카드를 얹으면 그 카드값이 5번·6번 손님의 결제에도 같이
// 붙었다. 먼저 결제하는 사람이 남의 카드값을 내는 셈이다.
//
// 그리고 진짜 테이블의 결제 버튼에는 받을 돈이 적혀 있는데(footerPayBtn)
// 카운터 카드의 버튼에는 없어서, 직원이 부를 숫자를 찾으려면 눈을 위로
// 올려 합계를 봐야 했다.
//
// 재는 것 셋.
//  1) 얹어 둔 카드가 **그 주문 하나**에만 붙는가 — 함수를 꺼내 돌려본다
//  2) 카드마다 자기 「VIP卡販售」 버튼과 금액이 적힌 결제 버튼이 있는가
//  3) 할인 설정은 이미 주문별이었다 — 그대로인가(회귀 방지)
const fs = require("fs");
const path = require("path");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const admin = fs.readFileSync(path.join(__dirname, "../public/js/admin.js"), "utf8");
const slice = (src, header, end) => {
  const i = src.indexOf(header);
  return i < 0 ? "" : src.slice(i, src.indexOf(end, i));
};

out.push("[1. 얹어 둔 카드는 그 주문 하나에만 붙는다]");
{
  // 함수를 파일에서 꺼내 실제로 돌린다 — 「고쳤다」가 아니라 「무슨 답을
  // 내는가」를 봐야 한다.
  const fn = slice(admin, "  function pendingVipCardAmountFor(tableNumber, orderId) {", "\n  }\n") + "\n  }";
  check("함수를 찾았다", fn.length > 100, `${fn.length}`);
  const make = (pending) =>
    new Function(
      "pendingVipCardSale", "vipSalePrice",
      `${fn}\n return pendingVipCardAmountFor;`
    )(pending, 300);

  const onOrder4 = make({ tableNumber: "COUNTER", orderId: 4, cardNumber: "" });
  check("★ 얹은 그 주문에는 붙는다", onOrder4("COUNTER", 4) === 300, `${onOrder4("COUNTER", 4)}`);
  check("★ 옆 손님에게는 안 붙는다", onOrder4("COUNTER", 5) === 0, `${onOrder4("COUNTER", 5)} — 먼저 결제하는 사람이 남의 카드값을 낸다`);
  check("★ 카운터 전체 합계도 안 끌어온다", onOrder4("COUNTER") === 0, `${onOrder4("COUNTER")}`);
  check("문자열로 와도 같은 주문이면 붙는다", onOrder4("COUNTER", "4") === 300, `${onOrder4("COUNTER", "4")}`);

  const onTable = make({ tableNumber: "7", orderId: null, cardNumber: "" });
  check("★ 진짜 테이블은 예전 그대로 — 테이블에 얹는다", onTable("7") === 300, `${onTable("7")}`);
  check("다른 자리에는 안 붙는다", onTable("8") === 0, `${onTable("8")}`);
  check(
    "테이블에 얹은 것을 주문 번호로 물으면 안 나온다",
    onTable("7", 99) === 0,
    "라운드마다 카드값이 반복돼 보인다"
  );

  const none = make(null);
  check("얹은 게 없으면 0", none("COUNTER", 4) === 0, "");
  const noPrice = new Function("pendingVipCardSale", "vipSalePrice", `${fn}\n return pendingVipCardAmountFor;`)(
    { tableNumber: "COUNTER", orderId: 4 }, null
  );
  check("판매가가 안 정해져 있으면 0", noPrice("COUNTER", 4) === 0, "");
}

out.push("\n[2. 카드마다 자기 버튼]");
{
  const parts = slice(admin, "  function buildOrderRoundParts(o, withDismiss) {", "\n  }\n");
  check("라운드 조립 함수를 찾았다", parts.length > 500, `${parts.length}`);
  check(
    "★ 카드마다 자기 「VIP卡販售」 버튼",
    /data-vip-sell-order="\$\{o\.id\}"/.test(parts),
    "footer 버튼 하나로는 누구에게 파는지 고를 수가 없다"
  );
  check("진짜 테이블 라운드에는 안 붙인다", /!isCounterOrder\(o\)\n?\s*\?\s*""\n?\s*:\s*cardPendingAmount/.test(parts.replace(/\r/g, "")), "");
  check(
    "★ 결제 버튼에 그 주문만의 금액이 적힌다",
    /pendingVipCardAmountFor\(o\.table_number, o\.id\)/.test(parts) &&
      /\$\{T\("nextServed"\)\} \(NT\$\$\{money\(cardPayable\)\}\)/.test(parts),
    "진짜 테이블의 결제 버튼에는 적혀 있다 — 같은 모양이어야 한다"
  );
  check(
    "★ 금액은 할인을 뺀 밥값 + 그 주문에 얹은 카드값",
    /const cardPayable = Math\.max\(0, remainingAmountOf\(o\) - \(vipDiscountActive \? vipDiscountAmount : 0\)\) \+ cardPendingAmount;/.test(parts),
    ""
  );

  const block = slice(admin, "  function renderTableOrderBlock(o, withDismiss) {", "\n  }\n");
  check("★ 카드 안에 실제로 그려진다", /\$\{p\.vipSellBtnHtml\}/.test(block), "");
  check(
    "★ 얹어 뒀으면 현금이라는 것을 그 카드에 적는다",
    /p\.cardPendingAmount \? `<div class="vip-sell-pending-note"/.test(block),
    "결제수단 팝업에서 LINE 을 눌러도 이 300 은 현금이다"
  );

  // 누르면 그 주문에 얹는다.
  const handler = slice(admin, '      .querySelectorAll("[data-vip-sell-order]")', "\n      });");
  check("핸들러를 찾았다", handler.length > 200, `${handler.length}`);
  check("★ 그 주문 번호로 얹는다", /pendingVipCardSale = \{ tableNumber: String\(tableNumber\), orderId, cardNumber/.test(handler), "");
  check("★ 한 번 더 누르면 뺀다", /pendingVipCardAmountFor\(tableNumber, orderId\) > 0[\s\S]{0,120}clearPendingVipCardSale\(\)/.test(handler), "");
  check(
    "★ 이미 끝난 주문에는 못 얹는다",
    /o\.status === "paid" \|\| o\.status === "cancelled"\) return false;/.test(handler),
    "붙을 결제가 없으면 카드가 미아가 된다"
  );

  // 결제할 때 같이 팔린다.
  const advance = slice(admin, '      .querySelectorAll("[data-advance-id]")', "\n      });");
  check("결제 핸들러를 찾았다", advance.length > 400, `${advance.length}`);
  check("★ 그 주문에 얹은 카드만 센다", /pendingVipCardAmountFor\(tableNumber, orderId\)/.test(advance), "");
  check("★ 팝업이 두 몫을 갈라 보여준다", /fmtPaymentVipCardPart\(gross - breakdown\.total, cardAmount\)/.test(advance), "");
  check(
    "★ 밥값이 결제된 **뒤에** 판다",
    advance.indexOf("await updateOrderStatus(orderId, toStatus") < advance.indexOf("await sellVipCard(tableNumber"),
    "순서가 반대면 밥값은 실패했는데 카드만 팔린다"
  );
  check("팔리면 얹어 둔 것을 지운다", /if \(sold\.ok\) clearPendingVipCardSale\(\);/.test(advance), "");
  check(
    "★ 안 팔렸으면 조용히 넘기지 않는다",
    /vipSellFailedAfterPay/.test(advance),
    "손님은 돈을 내고 카드를 못 받는다"
  );

  // footer 버튼은 카운터에서 「바로 판매」만.
  const sellBtn = slice(admin, '    const sellBtn = $("#vipSellBtn");', "\n    }\n");
  check("footer 버튼 핸들러를 찾았다", sellBtn.length > 200, `${sellBtn.length}`);
  check(
    "★ 카운터에서는 footer 가 얹지 않는다",
    /if \(isCounterTable \|\| !unpaidOrders\.length\) return false;/.test(sellBtn),
    "누구에게 얹을지 모르는 채로 얹으면 아무 손님에게나 붙는다"
  );
  check("진짜 테이블은 orderId 없이 얹는다", /orderId: null, cardNumber/.test(sellBtn), "");
}

out.push("\n[3. 할인 설정은 이미 주문별이었다 — 그대로인가]");
{
  const parts = slice(admin, "  function buildOrderRoundParts(o, withDismiss) {", "\n  }\n");
  check(
    "★ 카운터는 주문 id 를 scope 로 쓴다",
    /isCounterOrder\(o\)\s*\n?\s*\? renderVipDiscountToggle\(vipCurrentType, String\(o\.id\), manualDiscountValue\)/.test(parts),
    ""
  );
  check(
    "★ 진짜 테이블은 테이블 전체를 공유한다",
    /: renderVipDiscountToggle\(vipCurrentType, "table", manualDiscountValue\)/.test(parts),
    ""
  );
  check(
    "★ 카운터 결제가 그 주문의 설정을 읽는다",
    /counterVipDiscountTypeByOrderId\.get\(orderId\)/.test(admin) &&
      /counterManualDiscountValueByOrderId\.get\(orderId\)/.test(admin),
    ""
  );
  check(
    "★ 결제가 끝나면 그 주문 설정만 지운다",
    /counterVipDiscountTypeByOrderId\.delete\(orderId\);\s*\n\s*counterManualDiscountValueByOrderId\.delete\(orderId\);/.test(admin),
    "테이블 값을 지우면 옆 손님 설정이 같이 풀린다"
  );
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
