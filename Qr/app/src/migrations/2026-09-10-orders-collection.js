// 주문을 store 문서 밖으로 옮긴다 (2026-09-10).
//
// 사장님: "주문 → 조리중 → 서빙완료 넘어가는 버튼 누르면 최소 5~20초 이상
// 걸림. / 결제 완료 누르면 최소 5초 이상."
//
// 원인과 설계는 src/db.js 의 "주문은 store 문서 밖에 산다" 주석에 있다.
// 여기서는 이미 살아 있는 데이터베이스의 store.orders 를 새 orders
// 컬렉션으로 한 번 옮기고, 원래 자리를 비운다.
//
// 옮기는 순서가 중요하다 — 먼저 컬렉션에 다 넣고(성공을 확인하고), 그
// 다음에 store 문서에서 지운다. 반대로 하면 중간에 끊겼을 때 주문이 사라진다.
// 두 단계 사이에서 끊기면 같은 주문이 양쪽에 있는 상태가 되는데, 그건
// 데이터가 없어지는 것이 아니라 다음 실행에서 그대로 이어서 정리된다.
const MIGRATION_FLAG = "migration_2026_09_10_orders_collection_applied";

async function applyOrdersCollection20260910(store, { save, getDb, connectDB }) {
  await connectDB();
  const db = getDb();
  const col = db.collection("orders");

  // 조회에 쓰는 두 필드에 인덱스를 만든다. 요청마다 "안 끝난 주문 + 최근
  // 며칠"을 찾고, 결산은 날짜 범위를 찾는다. 인덱스가 없으면 컬렉션 전체를
  // 훑게 되어 문서를 쪼갠 의미가 반쯤 사라진다.
  // createIndex 는 이미 있으면 아무 일도 하지 않는다(매번 불러도 안전).
  await col.createIndex({ created_at: 1 });
  await col.createIndex({ status: 1, created_at: 1 });
  await col.createIndex({ account_id: 1, created_at: -1 });
  await col.createIndex({ table_number: 1, status: 1 });

  if (store.settings && store.settings[MIGRATION_FLAG]) return;

  // store 문서에 아직 남아 있는 주문을 읽는다. refreshStore() 는 이제
  // orders 를 걸러서 가져오므로(projection), 여기서만 원본을 직접 본다.
  const doc = await db.collection("store").findOne({ _id: "main" }, { projection: { orders: 1 } });
  const legacy = (doc && Array.isArray(doc.orders) ? doc.orders : []).filter((o) => o && o.id != null);

  if (legacy.length) {
    // 이미 옮겨진 것은 건너뛰지 않고 그대로 덮어쓴다(upsert) — 중간에
    // 끊겼다가 다시 도는 경우에도 결과가 같아야 한다.
    const CHUNK = 500;
    for (let i = 0; i < legacy.length; i += CHUNK) {
      const part = legacy.slice(i, i + CHUNK);
      await col.bulkWrite(
        part.map((o) => ({
          replaceOne: { filter: { _id: o.id }, replacement: { ...o, _id: o.id }, upsert: true },
        }))
      );
    }
    // 전부 들어갔는지 세어보고 나서 지운다. 하나라도 모자라면 원본을 그대로
    // 두고 다음에 다시 시도한다 — 느린 채로 도는 편이 잃는 것보다 낫다.
    const moved = await col.countDocuments({ _id: { $in: legacy.map((o) => o.id) } });
    if (moved < legacy.length) {
      console.warn(`orders 이관 중단: ${moved}/${legacy.length} 만 옮겨짐. store 문서는 그대로 둡니다.`);
      return;
    }
  }

  // 이제 원래 자리를 비운다. $unset 이라 store 문서 전체를 다시 쓰지 않는다.
  await db.collection("store").updateOne({ _id: "main" }, { $unset: { orders: "" } });

  store.settings[MIGRATION_FLAG] = true;
  await save();
  console.log(`Moved ${legacy.length} orders out of the store document into their own collection.`);
}

module.exports = { applyOrdersCollection20260910, MIGRATION_FLAG };
