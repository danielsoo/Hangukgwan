// 서버가 살아 있는 동안 자동으로 쌓이는 두 컬렉션의 TTL 인덱스.
//
// connect-mongo와 requestLog는 원래 새 Vercel 인스턴스마다 createIndex를
// 실행했다. 일반 서버라면 부팅 한 번이지만 서버리스에서는 이미 있는 같은
// 인덱스를 콜드 스타트마다 다시 확인하게 된다. 인덱스는 DB 전체에 하나면
// 충분하므로 여기서 한 번 만들고 store.settings에 완료 표시를 둔다.
//
// 플래그는 두 인덱스 생성이 성공한 뒤에만 쓰므로 새 설치와 중간 실패도
// 안전하게 다시 시도한다.
const requestLog = require("../requestLog");

const MIGRATION_FLAG = "migration_2026_09_13_runtime_indexes_applied";

async function applyRuntimeIndexes20260913(store, { getDb, connectDB, saveFields }) {
  if (store.settings && store.settings[MIGRATION_FLAG]) return;

  await connectDB();
  const db = getDb();
  await db.collection("sessions").createIndex(
    { expires: 1 },
    { background: true, expireAfterSeconds: 0 }
  );
  await db.collection(requestLog.COLLECTION).createIndex(
    { created_at: 1 },
    { expireAfterSeconds: requestLog.KEEP_DAYS * 24 * 60 * 60 }
  );

  const appliedAt = new Date().toISOString();
  store.settings = store.settings || {};
  store.settings[MIGRATION_FLAG] = appliedAt;
  await saveFields({ [`settings.${MIGRATION_FLAG}`]: appliedAt });
}

module.exports = { applyRuntimeIndexes20260913, MIGRATION_FLAG };
