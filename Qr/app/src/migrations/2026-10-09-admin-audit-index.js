// 관리자 변경 기록은 자동 삭제하지 않는다. 잠시 배포됐을 수 있는 180일 TTL
// 인덱스도 찾아 제거한 뒤, 조회 속도만 위한 일반 인덱스로 다시 만든다.
const adminAudit = require("../adminAudit");

const MIGRATION_FLAG = "migration_2026_10_09_admin_audit_permanent_index_applied";

async function applyAdminAuditIndex20261009(store, { getDb, connectDB, saveFields }) {
  if (store.settings && store.settings[MIGRATION_FLAG]) return;
  await connectDB();
  const collection = getDb().collection(adminAudit.COLLECTION);
  // 이전 코드의 기본 이름이다. 인덱스가 없으면 MongoDB 오류 26(IndexNotFound)은
  // 정상이다. 테스트용 DB처럼 dropIndex가 없는 구현도 그대로 통과한다.
  if (typeof collection.dropIndex === "function") {
    try {
      await collection.dropIndex("created_at_1");
    } catch (e) {
      if (!(e && (e.code === 26 || e.codeName === "IndexNotFound"))) throw e;
    }
  }
  await collection.createIndex(
    { created_at: -1 },
    { name: "admin_audit_created_at_desc" }
  );
  const appliedAt = new Date().toISOString();
  store.settings = store.settings || {};
  store.settings[MIGRATION_FLAG] = appliedAt;
  await saveFields({ [`settings.${MIGRATION_FLAG}`]: appliedAt });
}

module.exports = { applyAdminAuditIndex20261009, MIGRATION_FLAG };
