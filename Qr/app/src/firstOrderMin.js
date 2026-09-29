// 불판 메뉴의 「첫 주문 최소 N인분」(min_first_order_qty) — 무엇이 「첫 주문」인가.
//
// 사장님(2026-09-29): "9/28 19:22 A16. 첫 주문 후 동판 1인분만 주문했는데,
// 기본 2인분부터 주문인데 이게 정상적으로 주문 접수 됨. 확인 요망."
//
// 예전 규칙은 「이 자리의 첫 주문」이었다. A16 은 다른 메뉴를 먼저 시켰으므로
// 동판을 시키는 순간에는 이미 첫 주문이 아니었고, 검사 자체를 건너뛰었다.
// 사장님 뜻은 **「이 자리에서 이 메뉴를 처음 시킬 때」** 다 — 불판은 한 번
// 올리면 2인분부터라는 것이지, 자리에 처음 앉았을 때만의 이야기가 아니다.
//
// 「이 자리」는 지금 앉아 계신 손님의 착석이다(ordersForSeating). 결제한
// 라운드도 같은 손님 것이므로 센다. 취소된 주문은 안 센다 — 불판이 안 올라갔다.
//
// 서버(src/routes/orders.js)와 손님 화면(GET /api/tables/:n/party-size 의
// ordered_item_ids)이 이 파일 하나를 쓴다. 두 곳이 따로 세면 화면은 통과시키고
// 서버는 막거나, 그 반대가 된다.

/** 이 착석에서 이미 시킨 메뉴 id 들(문자열). 취소된 주문은 뺀다. */
function orderedItemIdsOf(orders) {
  const ids = new Set();
  for (const o of orders || []) {
    if (!o || o.status === "cancelled") continue;
    for (const it of o.items || []) {
      if (it && it.item_id != null && (it.qty || 0) > 0) ids.add(String(it.item_id));
    }
  }
  return ids;
}

/**
 * 이번 주문이 최소 수량을 어기는가. 어기면 { itemId, min }, 아니면 null.
 *
 * lines: 이번 주문 줄들({ item_id, qty }). 같은 메뉴가 여러 줄(牛/豬 섞기)이면
 * 더해서 본다. alreadyOrdered: 위 orderedItemIdsOf 의 결과 — 여기 있는 메뉴는
 * 이 자리에서 이미 한 번 올라갔으므로 1인분 추가도 된다.
 */
function firstOrderMinViolation(menuItems, lines, alreadyOrdered, isDeleted) {
  const qtyByItem = {};
  for (const v of lines || []) qtyByItem[String(v.item_id)] = (qtyByItem[String(v.item_id)] || 0) + (v.qty || 0);
  for (const mi of menuItems || []) {
    if (isDeleted && isDeleted(mi)) continue;
    if (!mi.min_first_order_qty) continue;
    const key = String(mi.id);
    if (alreadyOrdered && alreadyOrdered.has(key)) continue;
    const orderedQty = qtyByItem[key] || 0;
    if (orderedQty > 0 && orderedQty < mi.min_first_order_qty) {
      return { itemId: mi.id, min: mi.min_first_order_qty };
    }
  }
  return null;
}

module.exports = { orderedItemIdsOf, firstOrderMinViolation };
