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

/**
 * 품목 한 줄의 금액.
 *
 *     밥값 × 수량  +  고른 옵션 값  +  추가 옵션 값
 *
 * 옵션 값은 **수량을 안 곱한다.**
 *
 * 2026-09-16 사장님: "닭갈비 같은 경우는 기본 주문이 2인분이여서 그런지 저
 * 옵션이 1개를 올렸는데 2개 올라간 가격으로 측정이 돼." 그리고 "가격에 넣은
 * 그 액수만큼 올라가게 해줘. 최소 주문 관련 없이."
 *
 * 닭갈비는 첫 주문이 2인분이라 수량이 2 에서 시작한다. 예전에는 추가 옵션
 * 값에도 그 2 가 곱해져서, 치즈 하나를 얹었는데 두 개 값이 붙었다. 손님이
 * 체크한 것은 하나다. **적어둔 금액이 그대로 한 번 붙는 것**이 사장님이
 * 정한 규칙이다.
 */
function optionPriceOfItem(it) {
  const p = Number((it && it.option_price) || 0);
  return Number.isFinite(p) ? p : 0;
}
function addonsTotalOf(it) {
  return ((it && it.selected_addons) || []).reduce((a, x) => a + (x.price || 0), 0);
}
function lineTotalOf(it) {
  return (it.unit_price || 0) * (it.qty || 0) + optionPriceOfItem(it) + addonsTotalOf(it);
}

/**
 * 할인이 걸리는 금액 — **추가 옵션은 뺀다.**
 *
 * 2026-09-16 사장님: "추가 옵션으로 들어가는 모든 주문은 할인을 하면 안돼."
 *
 * 크기 같은 「하나만 고르는 옵션」의 값은 뺀 것에 들어간다 — 그건 이 음식의
 * 값 자체지 따로 시킨 것이 아니다. 추가 옵션(사리면·볶음밥 추가)은 얹어
 * 시킨 것이라 뺀다.
 */
/**
 * 이 품목은 **이미 할인이 들어간 세트**인가.
 *
 * 2026-09-16 사장님: "김밥 + 라면 세트 메뉴 그거 이미 할인이 들어간 거라
 * 추가 vip 할인이나 퍼센트 할인에는 적용이 안되도록 해줘 할인 제외 애들처럼."
 *
 * 세트는 original_price(따로 시켰을 때의 값)가 price 보다 높게 적혀 있다 —
 * 손님 화면이 그걸로 취소선과 「-NT$50」 을 그린다(order.js priceHtml).
 * 그 차이가 곧 이미 깎아준 금액이다. 거기에 또 9折 을 걸면 두 번 깎인다.
 *
 * 따로 켜고 끄는 표를 두지 않는다. **정가를 적어둔 것 자체가** 「이건 이미
 * 싸게 파는 것」이라는 뜻이고, 그 말을 두 군데서 다르게 하면 언젠가 갈린다.
 */
function isSetDiscountItem(it) {
  if (!it) return false;
  const original = Number(it.original_price || 0);
  // 주문에 찍힌 품목은 unit_price, 메뉴 쪽은 price 에 값이 있다.
  const now = Number(it.unit_price != null ? it.unit_price : it.price || 0);
  return original > 0 && now > 0 && original > now;
}

/**
 * 할인이 걸리는 금액 — **밥값만**. 옵션 값은 전부 뺀다.
 *
 * 2026-09-16 사장님(결제창 스크린샷과 함께): "결제할 때 차라리 추가 옵션들도
 * 하위 항목들로 가격 다 나오게 해줘. 그리고 옵션들은 할인이 적용 안되어야
 * 해." — 「옵션들」은 둘 다다: 하나만 고르는 옵션(option_price, 크기 등)도,
 * 여러 개 고르는 추가 옵션(selected_addons, 泡麵·拌飯)도.
 *
 * 그래서 화면은 옵션을 품목 아래 하위 줄로 따로 떼어 값까지 찍고
 * (public/js/admin.js payItemSubLinesHtml), 할인은 그 위의 밥값 줄에만
 * 걸린다. 여기가 옵션 값을 포함하면 화면에서 안 깎인 줄이 실제로는 깎인다.
 */
function discountBaseOf(it) {
  return (it.unit_price || 0) * (it.qty || 0);
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
//
// map(base, it): 그 줄에서 실제로 더할 값. 생략하면 기준 금액 그대로 더한다.
// 할인액을 줄 단위로 내림해서 더할 때 쓴다(아래 floorRule 주석).
function sumItems(items, indexes, exclude, map) {
  const idxs = indexes || items.map((_, i) => i);
  return idxs.reduce((s, i) => {
    const it = items[i];
    // 이미 깎아 파는 세트는 **어떤 할인의 기준에도** 안 들어간다.
    //
    // 2026-09-16 사장님: "김밥 + 라면 세트 메뉴 그거 이미 할인이 들어간 거라
    // 추가 vip 할인이나 퍼센트 할인에는 적용이 안되도록 해줘."
    //
    // 같은 날 저녁에 **직접 입력만은 예외로** 바뀌었다 — "직접 입력은 무조건
    // 총 금액에서 빼줘 (…) 내가 말하는 기준은 직접입력이야." 그래서 이
    // 리듀서는 이제 特約95折/VIP9折 전용이고, 직접 입력은 아래
    // fullEligibleTotal 이 따로 센다.
    if (!it || isCardSaleItem(it) || isSetDiscountItem(it) || (exclude && exclude(it))) return s;
    // 할인 기준이므로 추가 옵션은 빼고 더한다(위 discountBaseOf).
    const base = discountBaseOf(it);
    return s + (map ? map(base, it) : base);
  }, 0);
}

// 特約95折/VIP9折의 기준 금액 — 음료·주류를 뺀 나머지.
function discountEligibleTotal(items, indexes, isDrink) {
  return sumItems(items, indexes, isDrink);
}

/**
 * 직접 입력(재량 할인)의 기준 금액 — **손님이 내는 돈 전부**.
 *
 * 2026-09-16 사장님: "직접 입력은 무조건 총 금액에서 빼줘. 퍼센트인던
 * 금액이던." 이어서 "내가 말하는 기준은 직접입력이야."
 *
 * 그러니 여기서는 **아무것도 안 뺀다** — 음료도, 기타도, 이미 깎아 파는
 * 세트도, 크기 옵션도, 추가 옵션도 전부 들어간다. 화면에 뜬 「합계」가 곧
 * 이 금액이다.
 *
 * 다른 할인들의 제한을 물려받지 않는 이유:
 *   · 「음료 제외」는 特約95折/VIP9折 라는 **물리 카드 프로그램**의 규칙이다.
 *   · 「세트·옵션 제외」도 그 카드 할인과 퍼센트 할인이 정가에 두 번 걸리지
 *     않게 하려는 것이었다(같은 날 아침).
 * 직접 입력은 사장님이 그 자리에서 정하는 금액이다. 「2,910원 받을 건데
 * 200원 빼주자」고 했으면 200원이 빠져야 하고, 「10%」라고 했으면 2,910 의
 * 10% 여야 한다 — 화면에 안 보이는 2,500 의 10% 가 아니라.
 *
 * VIP 카드 판매(NT$300)만은 여전히 뺀다. 카드값을 깎아주는 건 말이 안 되고,
 * 기준에 섞이면 밥값에서 떼려던 퍼센트가 카드값까지 먹는다.
 */
function fullEligibleTotal(items, indexes) {
  const idxs = indexes || items.map((_, i) => i);
  return idxs.reduce((s, i) => {
    const it = items[i];
    if (!it || isCardSaleItem(it)) return s;
    return s + lineTotalOf(it);
  }, 0);
}

// ---------------------------------------------------------------------------
// 소수점은 **전부 내림**이다.
//
// 2026-09-16 사장님(결제창 스크린샷과 함께): "결제창에서 할인적용시 1원단위
// 불일치 / 소숫점은 그냥 다 내림으로 하려고 해."
//
// 그 스크린샷의 자리: 韓式紫菜捲 NT$150 에 特約95折. 150 × 0.95 = 142.5 다.
//   - 품목 줄은 「깎는 금액」을 반올림했다 — 150 - round(7.5) = 142
//   - 소계/합계는 「받는 금액」을 반올림했다 — 150 - round(142.5) = 143
// 같은 142.5 를 서로 다른 쪽으로 굴려서 1원이 어긋난 것이다.
//
// 기준을 하나로 못 박는다: **손님이 내는 금액을 내림한다.** 깎는 금액이
// 아니라 받는 금액이다 — 손님한테 유리한 쪽이고, 화면에 실제로 크게 보이는
// 숫자도 그쪽이다. 150 → 142(할인 8원).
function payableAfterRate(amount, rate) {
  const base = Number(amount) || 0;
  const r = Number(rate);
  if (!Number.isFinite(base) || !Number.isFinite(r)) return base;
  return Math.floor(base * r);
}

// 위 규칙에서 나오는 할인액 = 원래 금액 - 내림한 실수령액.
function discountByRate(amount, rate) {
  const base = Number(amount) || 0;
  return base - payableAfterRate(base, rate);
}
// ---------------------------------------------------------------------------

// 합계를 한 번에 굴리는 옛 방식 — 여기서도 내림을 쓴다. 지금 결제 경로는
// computeVipDiscountItems(줄 단위)를 쓰지만, 품목 목록 없이 금액만 들고 있는
// 자리(예: 옛 테스트, 외부 호출)가 남아 있어 남겨 둔다.
function computeVipDiscount(vipDiscountType, eligibleTotal) {
  const rate = VIP_DISCOUNT_RATES[vipDiscountType];
  if (!rate) return 0;
  return discountByRate(eligibleTotal, rate);
}

// 실제 결제에서 쓰는 VIP 할인액 — **줄마다 따로 내림해서 더한다.**
//
// 합계를 한 번에 내림하면 품목 줄들의 합과 소계가 또 어긋난다(150짜리 둘이면
// 줄은 142+142=284, 합계는 floor(300×0.95)=285). 화면이 품목마다 할인가를
// 보여주는 이상, 그 줄들을 더한 값이 곧 소계여야 한다. 그래서 기준을 줄로
// 내린다 — 화면(public/js/admin.js vipDiscountClientTotal)도 같은 식이다.
function computeVipDiscountItems(vipDiscountType, items, indexes, isDrink) {
  const rate = VIP_DISCOUNT_RATES[vipDiscountType];
  if (!rate) return 0;
  return sumItems(items, indexes, isDrink, (base) => discountByRate(base, rate));
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
  const vipAmount = computeVipDiscountItems(vipDiscountType, items, indexes, isDrink);
  const afterVip = Math.max(0, fullEligibleTotal(items, indexes) - vipAmount);
  let manualAmount = 0;
  if (manualDiscount) {
    // 퍼센트도 「받는 금액을 내림」(위 payableAfterRate) — 남은 금액 전체를
    // 한 번에 굴린다. 재량 할인은 품목별로 나눠 보여주지 않으니(화면에도
    // 소계/합계에만 뜬다) 줄 단위로 내릴 기준이 없다.
    manualAmount =
      manualDiscount.mode === "percent"
        ? afterVip - payableAfterRate(afterVip, 1 - manualDiscount.value / 100)
        : Math.floor(manualDiscount.value);
    // 남은 금액보다 많이 깎을 수는 없다(음수 청구 방지).
    manualAmount = Math.min(afterVip, Math.max(0, manualAmount));
  }
  return { vipAmount, manualAmount, afterVip, total: vipAmount + manualAmount };
}

// 特約95折/VIP9折 이 **빼는** 분류.
//
// 2026-09-14 사장님: "지금은 음료 주류만 빠지는데 기타 항목도 모두 할인
// 안하게 해줘."
//
// 이 매장은 주류를 따로 안 나누고 음료(drink) 안에 같이 둔다. 기타(其他)는
// key "other" 다 — 2026-09-10 에 남는 항목이 없으면 지우도록 돼 있지만
// (src/migrations/2026-09-10-traditional-category.js), 그 사이 새 메뉴가
// 들어가 있었으면 살아 있다.
//
// 목록을 여기 한 곳에만 두고 서버도 화면도 이것을 받아 쓴다. 두 군데서 따로
// 적으면 화면이 보여주는 금액과 실제로 받는 금액이 언젠가 갈린다.
const DISCOUNT_EXCLUDED_CATEGORY_KEYS = ["drink", "other"];

// 이름으로도 알아본다.
//
// 2026-09-16 사장님이 다시: "그리고 할인은 기타, 음료 는 모두 적용 안돼."
// 키 목록만으로는 못 잡는 경우가 있다 — 분류의 key 는 만들 때 한 번
// 정해지고 화면에 안 보인다. 「기타」라고 보이는 분류의 key 가 other 가
// 아닐 수 있고, 사장님은 그것을 알 방법이 없다. 보이는 이름으로도 같이
// 잡는다.
//
// 이름 맞추기는 어디까지나 **처음 값을 정해주는 용도**다. 최종 판단은
// 분류 자신의 discount_excluded 표이고(아래), 그 표는 메뉴 관리에서
// 사장님이 직접 켜고 끈다. 이름으로 잘못 잡혔으면 그 자리에서 풀 수 있다.
const DISCOUNT_EXCLUDED_NAME_HINTS = ["기타", "其他", "음료", "飲料", "饮料", "주류", "酒類", "酒类"];

/**
 * 이 분류는 할인에서 빠지는가.
 *
 * 분류에 적힌 표(discount_excluded)가 있으면 그것만 본다 — 사장님이
 * 메뉴 관리에서 정한 값이다. 표가 아예 없는 옛 데이터일 때만 키/이름으로
 * 짐작한다. 마이그레이션이 한 번 돌고 나면 전부 표를 갖는다.
 */
function isDiscountExcludedCategory(cat) {
  if (!cat) return false;
  if (cat.discount_excluded !== undefined && cat.discount_excluded !== null) {
    return !!cat.discount_excluded;
  }
  return guessDiscountExcluded(cat);
}

/**
 * 이 **메뉴 한 줄**은 할인에서 빠지는가.
 *
 * 2026-09-16 사장님: "모든 주문마다 할인 적용 온 오프 할 수 있게 메뉴
 * 관리에서 할 수 있게 해줘."
 *
 * 분류 단위만으로는 안 되는 경우가 있다 — 같은 분류 안에서 어떤 메뉴는
 * 깎아주고 어떤 메뉴는 안 깎는 식. 그래서 메뉴 자신이 표를 하나 더 들 수
 * 있게 하고, **그 표가 분류를 이긴다.**
 *
 *   item.discount_excluded === null/undefined  → 분류를 따른다(기본값)
 *   item.discount_excluded === true            → 이 메뉴만 할인 안 함
 *   item.discount_excluded === false           → 분류가 제외여도 이 메뉴는 할인함
 *
 * 세 번째가 핵심이다 — 「음료 분류는 전부 할인 안 함, 그런데 이 하나는
 * 해줌」을 표현할 방법이 없으면 사장님이 분류를 통째로 풀어야 한다.
 */
function isDiscountExcludedMenuItem(item, cat) {
  if (item && item.discount_excluded !== undefined && item.discount_excluded !== null) {
    return !!item.discount_excluded;
  }
  return isDiscountExcludedCategory(cat);
}

/** 표가 없는 분류의 처음 값. 키가 맞거나 이름이 맞으면 제외로 본다. */
function guessDiscountExcluded(cat) {
  if (!cat) return false;
  if (DISCOUNT_EXCLUDED_CATEGORY_KEYS.includes(cat.key)) return true;
  const names = [cat.name_ko, cat.name_zh, cat.name_en]
    .map((v) => String(v == null ? "" : v).trim())
    .filter(Boolean);
  return names.some((n) => DISCOUNT_EXCLUDED_NAME_HINTS.includes(n));
}

module.exports = {
  DISCOUNT_EXCLUDED_CATEGORY_KEYS,
  isSetDiscountItem,
  addonsTotalOf,
  discountBaseOf,
  DISCOUNT_EXCLUDED_NAME_HINTS,
  isDiscountExcludedCategory,
  isDiscountExcludedMenuItem,
  guessDiscountExcluded,
  VIP_DISCOUNT_RATES,
  lineTotalOf,
  discountEligibleTotal,
  fullEligibleTotal,
  payableAfterRate,
  discountByRate,
  computeVipDiscount,
  computeVipDiscountItems,
  parseManualDiscount,
  discountTypeKey,
  computeDiscountAmount,
};
