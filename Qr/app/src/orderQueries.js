// 목록 전체가 필요하지 않은 주문 경로의 작은, 인덱스 기반 질의들.
//
// 주문은 이미 `_id = 주문번호`인 개별 MongoDB 문서다. 이 파일은 한 주문,
// 한 테이블, 한 착석만 필요한 요청이 `loadRecentOrders()`로 가게 전체 주문을
// 메모리에 올리지 않게 한다.
const { findOrders, findOrderById, recentCutoff } = require("./db");
const { OPEN } = require("./orderStatus");
const { seatingStartOf } = require("./partySize");
const { serviceStartedAt } = require("./serviceStart");

function openFilter(store, tableNumber) {
  const filter = {
    table_number: String(tableNumber),
    status: { $in: OPEN },
  };
  const started = serviceStartedAt(store);
  if (started) filter.created_at = { $gte: started };
  return filter;
}

async function openOrdersForTable(store, tableNumber, opts = {}) {
  return findOrders(openFilter(store, tableNumber), opts);
}

async function openOrdersForAll(store, opts = {}) {
  const filter = { status: { $in: OPEN } };
  const started = serviceStartedAt(store);
  if (started) filter.created_at = { $gte: started };
  return findOrders(filter, opts);
}

// 예전 공통 목록(loadRecentOrders)에 들어오던 범위와 똑같이 가른다. 주문번호
// 하나를 `_id`로 먼저 읽은 뒤 메모리에서 확인하므로 DB가 훑는 문서는 한 건뿐이다.
// 이 검사가 없으면 주소에 오래된 번호를 넣어 몇 달 전 손님의 주문을 공개하거나
// 운영 화면 밖의 완료 주문을 다시 고칠 수 있게 된다.
async function operationalOrderById(store, id) {
  const order = await findOrderById(id);
  if (!order) return null;
  const created = String(order.created_at || "");
  const started = serviceStartedAt(store);
  if (started && created < started) return null;
  if (OPEN.includes(order.status)) return order;
  const cutoff = recentCutoff();
  const from = started && started > cutoff ? started : cutoff;
  return created >= from ? order : null;
}

/**
 * 지금 착석에서 **돈을 낸 주문이 하나라도 있었나.** 있으면 하나만 돌려준다.
 *
 * 2026-09-14 사장님(손님 폰 사진과 함께): "이미 먹고 나간 손님것까지 주문
 * 내용에 떠."
 *
 * 6번 테이블 기록이 이랬다.
 *
 *     12:05:47  4명 착석
 *     12:06:20  주문 658 (1,640)
 *     12:09:07  주문 660 (650)
 *     12:09:23  658 결제완료   ← 660 이 남아 있어 자리를 안 비운다 (맞다)
 *     12:13:21  660 취소       ← 여기서 멈췄다
 *
 * 취소는 일부러 자리를 안 비운다 — 재료가 떨어져 한 접시를 취소했다고 앉아
 * 계신 손님을 내보내면 안 되니까. 그 규칙 자체는 옳다.
 *
 * 그런데 이 경우는 **결제된 주문이 있고 남은 미결제가 없다.** 손님은 다 내고
 * 나갔는데 자리만 잡혀 있다. 그러면 다음 손님 폰은 인원수를 묻지 않고 앞
 * 손님의 착석 시각을 그대로 물려받아, 앞 손님의 「已結帳 1,640」이 그대로
 * 뜬다. 남의 계산서를 보게 되는 것이다.
 *
 * 「돈을 낸 적이 있는가」가 그 둘을 가른다. 결제가 한 번도 없는 자리는
 * 아직 앉아 계신 손님이므로 건드리지 않는다.
 *
 * 한 건만 있으면 되므로 limit 1 에 번호만 가져온다.
 */
async function paidInSeating(store, table) {
  if (!table || table.is_counter) return [];
  const seat = seatingStartOf(table);
  if (!seat) return [];
  return findOrders(
    { table_number: String(table.number), status: "paid", created_at: { $gte: seat } },
    { limit: 1, projection: { id: 1 } }
  );
}

async function ordersForSeating(store, table, opts = {}) {
  if (!table || table.is_counter) return [];
  const seat = seatingStartOf(table);
  if (!seat) return openOrdersForTable(store, table.number, opts);
  return findOrders(
    {
      table_number: String(table.number),
      created_at: { $gte: seat },
    },
    opts
  );
}

async function ordersForNewOrder(store, table, today) {
  if (!table) return [];
  // 첫 주문 여부와 픽업번호에는 품목 배열·메모·결제 정보가 필요 없다. 주문이
  // 오래 이어진 테이블에서도 작은 필드만 네트워크로 가져온다.
  const opts = {
    projection: { id: 1, table_number: 1, status: 1, created_at: 1 },
  };
  if (!table.is_counter) return ordersForSeating(store, table, opts);
  // 포장 카운터의 짧은 픽업번호는 오늘 몇 번째 주문인지로 정한다.
  return findOrders(
    {
      table_number: String(table.number),
      created_at: { $gte: `${today} 00:00:00`, $lte: `${today} 23:59:59` },
    },
    opts
  );
}

module.exports = {
  openFilter,
  paidInSeating,
  openOrdersForTable,
  openOrdersForAll,
  operationalOrderById,
  ordersForSeating,
  ordersForNewOrder,
};
