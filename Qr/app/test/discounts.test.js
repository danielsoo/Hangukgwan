// 결제 시점 할인 계산 — 特約95折/VIP9折(음료 제외, 현금만)와 직원 재량의
// 직접 입력 할인, 그리고 2026-09-10부터 가능해진 둘의 중복 적용.
//
// 사장님(2026-09-10): "vip 할인 2개랑 직접 치는 걸 중복으로 할 수 있게
// 해줘. 예를 들어 vip 할인을 했더니 2원의 잔돈이 있어서 재량으로 2원을
// 깎아주려고." — 그래서 순서가 규칙의 전부다. VIP를 먼저 적용하고, 재량은
// 그러고 남은 실수령액에서 뺀다. 순서가 뒤집히면 손님이 내는 돈이 달라진다.
const {
  discountEligibleTotal,
  fullEligibleTotal,
  computeVipDiscount,
  lineTotalOf,
  parseManualDiscount,
  discountTypeKey,
  computeDiscountAmount,
} = require("../src/discounts");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

// 음식 1000 + 음료 100 = 전체 1100, 이 중 할인 대상(음료 제외)은 1000.
const food = { unit_price: 1000, qty: 1, drink: false };
const drink = { unit_price: 100, qty: 1, drink: true };
const ITEMS = [food, drink];
const isDrink = (it) => !!it.drink;
const amount = (v) => ({ mode: "amount", value: v });
const percent = (v) => ({ mode: "percent", value: v });
const calc = (type, manual, items = ITEMS, indexes) => computeDiscountAmount(type, manual, items, indexes, isDrink);

out.push("[기준 금액]");
check("VIP 기준은 음료를 뺀다", discountEligibleTotal(ITEMS, null, isDrink) === 1000);
check("재량 기준은 음료를 포함한다", fullEligibleTotal(ITEMS) === 1100);
// 2026-09-16 사장님: "추가 옵션으로 들어가는 모든 주문은 할인을 하면 안돼."
// 같은 날 다시, 결제창 스크린샷과 함께: "옵션들은 할인이 적용 안되어야 해."
// 「옵션들」은 둘 다다 — 크기 같은 하나만 고르는 옵션(option_price)도,
// 여러 개 고르는 추가 옵션(selected_addons)도.
//
// **그 규칙은 特約95折/VIP9折 것이다.** 같은 날 저녁에 직접 입력은 예외가
// 됐다 — "직접 입력은 무조건 총 금액에서 빼줘 (…) 내가 말하는 기준은
// 직접입력이야"(test/manual-discount-base.test.js).
const noDrinkAtAll = () => false;
check("★ VIP 기준은 추가 옵션을 뺀다",
  discountEligibleTotal([{ unit_price: 100, qty: 3, selected_addons: [{ price: 50 }] }], null, noDrinkAtAll) === 300,
  "추가 옵션까지 세면 450 이 된다");
check("★ VIP 기준은 크기 옵션 값도 뺀다",
  discountEligibleTotal([{ unit_price: 100, qty: 3, option_price: 150 }], null, noDrinkAtAll) === 300,
  "옵션 값까지 세면 450 이 된다");
check("★ 직접 입력 기준은 그 둘을 다 넣는다 — 손님이 내는 돈 전부",
  fullEligibleTotal([{ unit_price: 100, qty: 3, option_price: 150 }]) === 450,
  "화면에 뜬 합계가 450 인데 300 의 10% 를 깎으면 직원이 부를 숫자를 못 맞춘다");
// 옵션 값은 수량을 안 곱한다 — 닭갈비(첫 주문 2인분)에서 두 배가 되던 건.
// 할인 기준에서는 빠지지만, 손님이 내는 줄 금액에는 딱 한 번 붙는다.
check("★ 수량이 늘어도 옵션 값은 한 번",
  lineTotalOf({ unit_price: 100, qty: 5, option_price: 150 }) === 650);

out.push("");
out.push("[하나만 걸었을 때 — 2026-09-10 이전과 결과가 같아야 한다]");
check("特約95折은 음료 제외 금액의 5%", calc("te95", null).total === 50);
check("VIP9折은 음료 제외 금액의 10%", calc("vip9", null).total === 100);
check("재량 금액은 음료 포함 전체에서", calc(null, amount(2)).total === 2);
check("재량 퍼센트도 음료 포함 전체 기준", calc(null, percent(10)).total === 110);
check("아무것도 안 걸면 0", calc(null, null).total === 0);

out.push("");
out.push("[둘을 같이 걸었을 때 — VIP 먼저, 남은 금액에서 재량]");
const both = calc("te95", amount(2));
check("VIP 몫은 그대로 50", both.vipAmount === 50);
check("VIP 뒤 남은 실수령액은 1050", both.afterVip === 1050);
check("잔돈 2원이 그대로 빠진다", both.manualAmount === 2);
check("총 할인 52 → 손님은 1048을 낸다", both.total === 52 && 1100 - both.total === 1048);
check("재량 퍼센트는 VIP 뒤 금액 기준(1050의 10%)", calc("te95", percent(10)).manualAmount === 105);
check("VIP9折과도 같이 걸린다", calc("vip9", amount(2)).total === 102);

out.push("");
out.push("[더 깎을 수 없는 한계]");
const over = calc("te95", amount(99999));
check("남은 금액보다 많이 깎지 않는다", over.manualAmount === 1050);
check("총 할인이 전체 금액을 넘지 않는다", over.total === 1100);
check("재량 100%면 실수령 0", 1100 - calc("te95", percent(100)).total === 0);

out.push("");
out.push("[부분 결제 — 이번에 결제되는 품목만]");
check("음식만 결제하면 음료는 계산에 없다", calc("te95", amount(2), ITEMS, [0]).total === 52);
check("음료만 결제하면 VIP 할인은 0", calc("te95", null, ITEMS, [1]).total === 0);
check("음료만 결제해도 재량 할인은 먹는다", calc("te95", amount(2), ITEMS, [1]).total === 2);

out.push("");
out.push("[직원 입력값 검증]");
check("금액 파싱", JSON.stringify(parseManualDiscount({ manualDiscountMode: "amount", manualDiscountValue: "30" })) === '{"mode":"amount","value":30}');
check("퍼센트는 100을 넘지 못한다", parseManualDiscount({ manualDiscountMode: "percent", manualDiscountValue: 250 }).value === 100);
check("0이나 음수는 무시", parseManualDiscount({ manualDiscountMode: "amount", manualDiscountValue: 0 }) === null);
check("숫자가 아니면 무시", parseManualDiscount({ manualDiscountMode: "amount", manualDiscountValue: "몰라" }) === null);
check("모드가 없으면 무시", parseManualDiscount({ manualDiscountValue: 30 }) === null);

out.push("");
out.push("[결산에 남는 이름]");
check("VIP만", discountTypeKey("te95", null) === "te95");
check("재량만", discountTypeKey(null, amount(2)) === "manual");
check("둘 다 걸면 붙여서 한 종류", discountTypeKey("te95", amount(2)) === "te95+manual");
check("아무것도 없으면 null", discountTypeKey(null, null) === null);

out.push("");
out.push("[비율표 자체]");
check("te95 = 5% 할인", computeVipDiscount("te95", 1000) === 50);
check("vip9 = 10% 할인", computeVipDiscount("vip9", 1000) === 100);
check("모르는 값은 할인 없음", computeVipDiscount("bogus", 1000) === 0);

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
