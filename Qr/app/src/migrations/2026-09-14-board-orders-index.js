// 관리자 주문판은 두 묶음만 읽는다.
//   1) 아직 안 끝난 주문 — {status, created_at}
//   2) 오늘 결제됐고 아직 정산 전인 주문 — {status, updated_at}
//
// 두 번째 인덱스가 없으면 결제완료 칸을 채우려고 쌓여 있는 paid 주문을 모두
// 훑게 된다. 과거 주문이 늘어도 오늘 결제만 바로 찾도록 DB 전체에서 한 번
// 만든다. 이미 배포된 orders 마이그레이션의 완료 표시는 건드릴 수 없으므로
// 별도 마이그레이션이다.
const MIGRATION_FLAG = "migration_2026_09_14_board_orders_index_applied";

async function applyBoardOrdersIndex20260914(store, { getDb, connectDB, saveFields }) {
  if (store.settings && store.settings[MIGRATION_FLAG]) return;

  await connectDB();
  await getDb().collection("orders").createIndex({ status: 1, updated_at: 1 });

  const appliedAt = new Date().toISOString();
  store.settings = store.settings || {};
  store.settings[MIGRATION_FLAG] = appliedAt;
  await saveFields({ [`settings.${MIGRATION_FLAG}`]: appliedAt });
}

module.exports = { applyBoardOrdersIndex20260914, MIGRATION_FLAG };
