// 결제기록·정산 스냅샷·예약을 store 문서 밖으로 옮긴다 (2026-09-10, 2차).
//
// 사장님: "지금 미리 준비하면 안되는거야?"
//
// 맞는 말이다. 주문(1차 이관)만큼 급하지는 않지만 — 셋을 다 합쳐 연 3~4MB,
// 한도까지 3~4년 — 옮기는 비용은 지금이 가장 싸다. 실제 영업이 9월 8일
// 저녁에 시작해서 옮길 기록이 아직 몇 줄뿐이고, 3년 뒤에 하면 수만 건의
// 돈 기록을 옮겨야 한다. 이런 작업의 위험은 데이터가 쌓일수록 커지지
// 줄지 않는다.
//
// 순서는 1차와 같다 — 먼저 컬렉션에 다 넣고 개수를 확인한 뒤에야 원래
// 자리를 비운다. 중간에 끊기면 양쪽에 있는 상태가 되는데, 그건 데이터가
// 없어지는 것이 아니라 다음 실행에서 이어서 정리된다.
//
// vipCards 는 옮기지 않는다: 물리 카드 수만큼만 늘어나 사실상 고정이고
// (200장에 0.03MB), 주문마다 VIP 할인을 보느라 매번 읽어야 해서 메모리에
// 있는 편이 맞다.
const MIGRATION_FLAG = "migration_2026_09_10_split_collections_applied";

// [문서 안의 키, 컬렉션 이름, 조회에 쓰는 인덱스들]
const MOVES = [
  ["payments", "payments", [{ merchant_trade_no: 1 }, { table_number: 1, status: 1 }, { created_at: -1 }]],
  ["daily_settlements", "daily_settlements", [{ date: -1 }]],
  ["reservations", "reservations", [{ date: 1, time: 1 }, { status: 1 }]],
];

async function applySplitCollections20260910(store, { save, getDb, connectDB }) {
  await connectDB();
  const db = getDb();

  // 인덱스는 매번 만들어도 안전하다(있으면 아무 일도 하지 않는다). 이관
  // 표시와 무관하게 두는 이유는, 표시만 남고 인덱스가 없는 상태로 굳는 걸
  // 막기 위해서다 — 인덱스가 없으면 컬렉션 전체를 훑게 되어 쪼갠 의미가
  // 반쯤 사라진다.
  for (const [, name, indexes] of MOVES) {
    for (const spec of indexes) await db.collection(name).createIndex(spec);
  }

  if (store.settings && store.settings[MIGRATION_FLAG]) return;

  const moved = {};
  for (const [key, name] of MOVES) {
    const doc = await db.collection("store").findOne({ _id: "main" }, { projection: { [key]: 1 } });
    const legacy = (doc && Array.isArray(doc[key]) ? doc[key] : []).filter((r) => r && r.id != null);
    moved[key] = legacy.length;
    if (!legacy.length) continue;

    const col = db.collection(name);
    const CHUNK = 500;
    for (let i = 0; i < legacy.length; i += CHUNK) {
      const part = legacy.slice(i, i + CHUNK);
      await col.bulkWrite(
        part.map((r) => ({ replaceOne: { filter: { _id: r.id }, replacement: { ...r, _id: r.id }, upsert: true } }))
      );
    }
    const count = await col.countDocuments({ _id: { $in: legacy.map((r) => r.id) } });
    if (count < legacy.length) {
      console.warn(`${key} 이관 중단: ${count}/${legacy.length} 만 옮겨짐. store 문서는 그대로 둡니다.`);
      return; // 하나라도 모자라면 아무것도 지우지 않는다
    }
  }

  // 전부 확인됐으니 원래 자리를 비운다. $unset 이라 store 문서 전체를
  // 다시 쓰지 않는다.
  const unset = {};
  for (const [key] of MOVES) unset[key] = "";
  await db.collection("store").updateOne({ _id: "main" }, { $unset: unset });

  store.settings[MIGRATION_FLAG] = true;
  await save();
  console.log(
    `Moved out of the store document: ${MOVES.map(([k]) => `${k} ${moved[k] || 0}`).join(", ")}.`
  );
}

module.exports = { applySplitCollections20260910, MIGRATION_FLAG, MOVES };
