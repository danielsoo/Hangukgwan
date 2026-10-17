// 결제수단 없이 결제완료가 된 주문을 미결제로 되돌리는 규칙.
//
// 2026-10-17 사장님: 10-16 결산의 「⚠ 미결제 2건 · NT$5,170」이 다음 날 사라졌다. 예전 「🌙 오후 정산」이
// 확인을 받으면 남은 미결제를 결제수단 없이 결제완료로 바꿨기 때문이다(그 길은 이제 없다 —
// e2e-close-keeps-unpaid.js). "어제것도 되돌려줄 수 있나?" → 사장님만 되돌린다(POST /api/orders/:id/unpay).
//
// **결제수단이 하나도 없는 결제완료**만 된다. 현금·카드·LinePay·온라인처럼 실제로 받은 결제, 부분결제로
// 한 품목이라도 받은 것, 결제 묶음(payment_ids)으로 낸 것, 돌려준 기록이 있는 것은 되돌리지 않는다 —
// 받은 돈을 「안 받음」으로 만들면 서랍과 장부가 어긋난다. 그런 것은 반품·취소를 쓴다.

/** 되돌릴 수 없는 이유. 되돌릴 수 있으면 null. */
function unpayableReason(o) {
  if (!o) return "not_found";
  if (o.status !== "paid") return "order_not_paid";
  if (o.kind === "vip_card_sale") return "has_payment_method";
  if (o.payment_method || (o.items || []).some((it) => it.payment_method)) return "has_payment_method";
  if ((Array.isArray(o.payment_ids) && o.payment_ids.length) || o.payment_id) return "has_payment_method";
  if ((Array.isArray(o.refunds) && o.refunds.length) || Number(o.refund_total) > 0) return "has_refunds";
  return null;
}

/** 「서빙 완료」로 돌린다. 정산이 결제완료 칸에서 내린 표시도 지우고, 되돌린 기록을 남긴다. */
function revertToUnpaid(order, at) {
  order.status = "served";
  order.updated_at = at;
  delete order.settled_at;
  order.unpaid_reverted = [...(Array.isArray(order.unpaid_reverted) ? order.unpaid_reverted : []), { at, by: "owner" }];
  return order;
}

module.exports = { unpayableReason, revertToUnpaid };
