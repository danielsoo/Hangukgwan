// 결제 시점 할인 계산 — 特約95折/VIP9折(물리 VIP 카드)와 직원 재량의
// 직접 입력 할인. 돈이 걸린 계산이라 라우트에서 떼어내 따로 둔다
// (test/discounts.test.js).
//
// 규칙의 출처:
// - 2026-09-06 사장님: "vip 카드를 소지중이면 세일을 해주거든. 1. 特約
//   95折 2. VIP 9折... 이 할인은 음료와 주류는 빼고 적용돼. 또 현금만 돼."
// - 2026-09-07 사장님: "vip 할인 옆에 결제자 재량으로 특정 금액/퍼센트
//   할인(직접 입력)이 가능하도록 넣어줘." — 이쪽은 음료도 빼지 않고,
//   결제수단 제한도 없다.
// - 2026-09-10 사장님: "vip 할인 2개랑 직접 치는 걸 중복으로 할 수 있게
//   해줘. 예를 들어 vip 할인을 했더니 2원의 잔돈이 있어서 재량으로 2원을
//   깎아주려고." — 그래서 둘을 같이 걸 수 있고, 순서가 정해진다.

const { isCardSaleItem } = require("./vip");

const VIP_DISCOUNT_RATES = { te95: 0.95, vip9: 0.9 };

// 품목 한 줄의 금액 — 추가 옵션(addons)까지 더한 뒤 수량을 곱한다.
function lineTotalOf(it) {
  const addonsTotal = (it.selected_addons || []).reduce((a, x) => a + x.price, 0);
  return (it.unit_price + addonsTotal) * it.qty;
}

// indexes를 주면 그 인덱스들만(부분 결제로 이번에 실제 결제되는 품목만),
// 생략하면 items 전체를 더한다. exclude(it)가 참이면 그 줄은 뺀다.
//
// VIP 카드 판매(NT$300)는 어떤 할인의 기준에도 절대 들어가지 않는다.
// 카드값을 9折 해주는 건 말이 안 되고, 재량 할인의 기준 금액에 섞이면
// "밥값의 2원을 떼려던" 퍼센트가 카드값까지 먹는다. 지금 판매는 자기
// 주문 한 건으로 따로 기록되므로(src/routes/vipCards.js) 이 줄이 실제로
// 쓰일 일은 없지만, 나중에 누가 카드를 밥값 주문에 끼워 넣더라도 돈 계산이
// 조용히 틀리지는 않게 여기서 한 번 막아둔다.
function sumItems(items, indexes, exclude) {
  const idxs = indexes || items.map((_, i) => i);
  return idxs.reduce((s, i) => {
    const it = items[i];
    if (!it || isCardSaleItem(it) || (exclude && exclude(it))) return s;
    return s + lineTotalOf(it);
  }, 0);
}

// 特約95折/VIP9折의 기준 금액 — 음료·주류를 뺀 나머지.
function discountEligibleTotal(items, indexes, isDrink) {
  return sumItems(items, indexes, isDrink);
}

// 재량 할인의 기준이 되는 전체 금액 — 음료·주류를 빼지 않는다. 特約95折/
// VIP9折의 "음료 제외"는 그 물리 카드 프로그램 고유 규칙일 뿐, 직원 재량
// 할인까지 같은 제한을 물려받을 이유가 없다.
function fullEligibleTotal(items, indexes) {
  return sumItems(items, indexes, null);
}

function computeVipDiscount(vipDiscountType, eligibleTotal) {
  const rate = VIP_DISCOUNT_RATES[vipDiscountType];
  if (!rate) return 0;
  return eligibleTotal - Math.round(eligibleTotal * rate);
}

// 직원이 입력한 값이라 서버가 미리 정해둔 카탈로그가 없다. 범위만 여기서
// 검증하고(퍼센트는 0~100, 금액은 양수만), 실제로 청구액을 넘는지는
// computeDiscountAmount가 남은 금액으로 다시 clamp한다. 유효하지 않으면
// null — 결제 자체는 그대로 진행되어야 하므로 조용히 무시한다.
function parseManualDiscount(body) {
  const mode = body.manualDiscountMode === "percent" || body.manualDiscountMode === "amount" ? body.manualDiscountMode : null;
  const value = Number(body.manualDiscountValue);
  if (!mode || !Number.isFinite(value) || value <= 0) return null;
  return { mode, value: mode === "percent" ? Math.min(value, 100) : value };
}

// 결산의 할인 종류별 집계(src/settlement.js)에 남길 이름 — 둘을 같이
// 걸었을 때는 "te95+manual"처럼 붙여서 한 종류로 센다. 어느 쪽이 얼마인지
// 까지 쪼개 저장하려면 주문 문서에 필드를 더 만들어야 하는데, 사장님이
// 결산에서 보는 건 "할인으로 얼마가 나갔나"라서 여기까지면 충분하다.
function discountTypeKey(vipDiscountType, manualDiscount) {
  const parts = [];
  if (vipDiscountType) parts.push(vipDiscountType);
  if (manualDiscount) parts.push("manual");
  return parts.length ? parts.join("+") : null;
}

// 이번 결제에서 깎아줄 총액. 순서가 핵심이다: 特約95折/VIP9折를 자기
// 규칙(음료 제외)대로 먼저 적용하고, 재량 할인은 그러고 남은 실수령액에서
// 다시 뺀다. 잔돈을 떼는 게 원래 목적("2원의 잔돈이 있어서 재량으로 2원을
// 깎아주려고")이니 기준이 "깎고 난 뒤의 금액"이어야 맞다. 퍼센트로
// 입력했을 때도 같은 기준을 쓴다.
//
// 둘 중 하나만 걸려 있으면 예전과 결과가 완전히 같다 — 재량만 걸면 VIP
// 할인액이 0이라 기준이 그대로 전체 금액이고, VIP만 걸면 재량액이 0이다.
//
// isDrink(it): 그 품목이 음료·주류인지 판별하는 함수(호출부가 주입한다 —
// 메뉴 카테고리를 봐야 알 수 있는데 그건 이 모듈의 관심사가 아니다).
function computeDiscountAmount(vipDiscountType, manualDiscount, items, indexes, isDrink) {
  const vipAmount = computeVipDiscount(vipDiscountType, discountEligibleTotal(items, indexes, isDrink));
  const afterVip = Math.max(0, fullEligibleTotal(items, indexes) - vipAmount);
  let manualAmount = 0;
  if (manualDiscount) {
    manualAmount =
      manualDiscount.mode === "percent"
        ? Math.round(afterVip * (manualDiscount.value / 100))
        : Math.round(manualDiscount.value);
    // 남은 금액보다 많이 깎을 수는 없다(음수 청구 방지).
    manualAmount = Math.min(afterVip, Math.max(0, manualAmount));
  }
  return { vipAmount, manualAmount, afterVip, total: vipAmount + manualAmount };
}

module.exports = {
  VIP_DISCOUNT_RATES,
  lineTotalOf,
  discountEligibleTotal,
  fullEligibleTotal,
  computeVipDiscount,
  parseManualDiscount,
  discountTypeKey,
  computeDiscountAmount,
};
