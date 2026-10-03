// 결제된 것의 반품·취소 (2026-10-03).
//
// 사장님: "결제된 거 반품, 취소 같은 기능을 넣어줘. 음식이나 조리 같은 건
// 취소고 음료수 라면 봉지 등 반품할 수 있는 건 반품할 수 있게 해줘."
//
// 주문을 지우거나 품목을 고쳐 쓰지 않는다 — 결제된 것은 장부다. 대신 주문에
// 「돌려준 기록」(order.refunds)을 덧붙이고, 품목마다 돌려준 수(refunded_qty)와
// 주문 전체의 돌려준 금액(refund_total)을 적는다. 결산은 받은 금액에서 이것을
// 뺀다(src/settlement.js netTotalOf · applyRefunds).
//
// 반품과 취소의 차이는 **물건이 돌아오는가**다.
//   · 반품(return) — 음료·주류·사리면(라면 봉지)처럼 그대로 돌려받을 수 있는 것
//   · 취소(cancel) — 조리한 음식. 돌아올 물건이 없다
// 어느 쪽인지는 품목의 분류로 정한다(isReturnableItem). 돈을 돌려주는 것은 같다.

const { lineTotalOf } = require("./discounts");

// 음료(drink)·기타(other) 분류 = 포장된 것 / 조리하지 않는 것.
const RETURNABLE_CATEGORY_KEYS = ["drink", "other"];
const RETURNABLE_NAME_HINTS = ["음료", "飲料", "饮料", "주류", "酒類", "酒类", "기타", "其他"];

function isReturnableItem(it, categoryNameOf = () => "") {
  if (!it) return false;
  if (RETURNABLE_CATEGORY_KEYS.includes(it.category_key)) return true;
  const catName = String(categoryNameOf(it) || "");
  return RETURNABLE_NAME_HINTS.some((h) => catName.includes(h));
}

/** 이 줄에서 아직 돌려줄 수 있는 수. 결제된 줄만. */
function refundableQty(order, it) {
  if (!order || !it) return 0;
  const paid = order.status === "paid" || !!it.paid;
  if (!paid) return 0;
  return Math.max(0, (Number(it.qty) || 0) - (Number(it.refunded_qty) || 0));
}

/**
 * 이 줄에서 qty 개를 돌려줄 때의 금액 — **실제로 받은 만큼**.
 *
 * 할인을 받은 주문이면 할인이 걸린 품목은 할인된 비율만큼만 돌려준다. 할인에서
 * 빠지는 품목(음료 등, isExcluded)은 정가 그대로다. 할인은 주문에 한 덩어리로
 * 적혀 있으므로(order.discount_amount), 할인이 걸리는 줄들의 합계에 대한 비율로
 * 나눈다 — 받은 돈보다 더 돌려주는 일이 없게.
 */
function refundAmountFor(order, index, qty, isExcluded = () => false) {
  const it = (order.items || [])[index];
  if (!it || !(qty > 0)) return 0;
  const perUnit = lineTotalOf(it) / (Number(it.qty) || 1);
  const gross = perUnit * qty;
  const off = Math.max(0, Number(order.discount_amount) || 0);
  if (!off || isExcluded(it)) return Math.round(gross);
  const eligible = (order.items || []).reduce((s, x) => s + (isExcluded(x) ? 0 : lineTotalOf(x)), 0);
  const rate = eligible > 0 ? Math.min(1, off / eligible) : 0;
  return Math.round(gross * (1 - rate));
}

/**
 * 결산용 — 돌려준 수만큼 품목 수를 줄인 사본. 품목별·분류별·시간대 판매 수가
 * 돌려준 것을 빼고 센다. 받은 금액은 netTotalOf 가 refund_total 을 빼서 맞춘다.
 */
function applyRefunds(o) {
  if (!o || !Array.isArray(o.items) || !o.items.some((it) => Number(it && it.refunded_qty) > 0)) return o;
  const items = o.items
    .map((it) => {
      const r = Number(it.refunded_qty) || 0;
      if (!r) return it;
      const qty = (Number(it.qty) || 0) - r;
      return { ...it, qty, refunded_qty: 0, option_price: it.option_price && it.qty ? (it.option_price * qty) / it.qty : it.option_price };
    })
    .filter((it) => (Number(it.qty) || 0) > 0);
  return { ...o, items };
}

module.exports = { RETURNABLE_CATEGORY_KEYS, isReturnableItem, refundableQty, refundAmountFor, applyRefunds };
