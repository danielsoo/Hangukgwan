// 손님 QR 화면은 가게 전체가 아니라 지금 연 테이블의 현재 착석 주문만 읽는다.
//
// 인원수를 이미 입력한 자리에서는 결제된 라운드까지 포함해 착석 시각 이후를
// 찾으므로 `{table_number, created_at}` 복합 인덱스가 필요하다. 인원수가 없는
// 자리의 미결제 주문은 기존 `{table_number, status}` 인덱스를 쓴다.
const MIGRATION_FLAG = "migration_2026_09_13_table_orders_index_applied";

async function applyTableOrdersIndex20260913(store, { getDb, connectDB, saveFields }) {
  if (store.settings && store.settings[MIGRATION_FLAG]) return;

  await connectDB();
  await getDb().collection("orders").createIndex({ table_number: 1, created_at: 1 });

  const appliedAt = new Date().toISOString();
  store.settings = store.settings || {};
  store.settings[MIGRATION_FLAG] = appliedAt;
  await saveFields({ [`settings.${MIGRATION_FLAG}`]: appliedAt });
}

module.exports = { applyTableOrdersIndex20260913, MIGRATION_FLAG };
