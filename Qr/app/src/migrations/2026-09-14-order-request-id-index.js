// 같은 주문이 두 번 들어가는 것을 데이터베이스가 막는다.
//
// 2026-09-14 사장님: "폰주문시 주문송출버튼 누르면 로딩이라는 화면없이 그냥
// 잠깐 멈추고 있어. 그래서 다시 누르게 되는데" — 그날 52건 중 6건.
//
// 화면 쪽 잠금(public/js/order.js)과 요청 앞의 조회(src/routes/orders.js)로
// 거의 다 걸리지만, 정확히 같은 순간에 들어온 두 요청은 둘 다 조회를 통과할
// 수 있다. 게다가 이 앱은 Vercel 인스턴스가 여럿이라 「둘 다」가 서로 다른
// 프로세스일 수 있어서, 코드 안의 잠금으로는 원리상 못 막는다. 마지막 한 겹은
// 데이터베이스여야 한다.
//
// 부분 인덱스로 만든다. client_request_id 가 없는 주문 — 직원 수기 주문,
// VIP 카드 판매(src/routes/vipCards.js), 이 배포 전의 옛 주문, 표를 안 보내는
// 옛 손님 화면 — 은 이 인덱스에 아예 안 들어간다. 그래야 「칸이 없는 것」끼리
// 겹쳤다고 막히는 일이 없다.
const MIGRATION_FLAG = "migration_2026_09_14_order_request_id_index_applied";
const INDEX_NAME = "client_request_id_unique";

async function applyOrderRequestIdIndex20260914(store, { getDb, connectDB, saveFields }) {
  if (store.settings && store.settings[MIGRATION_FLAG]) return;

  await connectDB();
  await getDb()
    .collection("orders")
    .createIndex(
      { client_request_id: 1 },
      {
        unique: true,
        partialFilterExpression: { client_request_id: { $type: "string" } },
        name: INDEX_NAME,
      }
    );

  const appliedAt = new Date().toISOString();
  store.settings = store.settings || {};
  store.settings[MIGRATION_FLAG] = appliedAt;
  await saveFields({ [`settings.${MIGRATION_FLAG}`]: appliedAt });
}

module.exports = { applyOrderRequestIdIndex20260914, MIGRATION_FLAG, INDEX_NAME };
