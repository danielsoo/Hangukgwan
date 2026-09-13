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
  openOrdersForTable,
  openOrdersForAll,
  operationalOrderById,
  ordersForSeating,
  ordersForNewOrder,
};
