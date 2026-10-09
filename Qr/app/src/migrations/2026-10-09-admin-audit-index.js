// 관리자 변경 기록은 속도 기록보다 오래 보되 무한히 쌓이지 않게 180일 TTL.
// 완료 표시는 DB 전체에 하나라 서버리스 인스턴스마다 인덱스를 다시 확인하지 않는다.
const adminAudit = require("../adminAudit");

const MIGRATION_FLAG = "migration_2026_10_09_admin_audit_index_applied";

async function applyAdminAuditIndex20261009(store, { getDb, connectDB, saveFields }) {
  if (store.settings && store.settings[MIGRATION_FLAG]) return;
  await connectDB();
  await getDb().collection(adminAudit.COLLECTION).createIndex(
    { created_at: 1 },
    { expireAfterSeconds: adminAudit.KEEP_DAYS * 24 * 60 * 60 }
  );
  const appliedAt = new Date().toISOString();
  store.settings = store.settings || {};
  store.settings[MIGRATION_FLAG] = appliedAt;
  await saveFields({ [`settings.${MIGRATION_FLAG}`]: appliedAt });
}

module.exports = { applyAdminAuditIndex20261009, MIGRATION_FLAG };
