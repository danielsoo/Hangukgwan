// store 문서에 판 번호(rev)를 처음 달아준다.
//
// 이 값이 있어야 매 요청이 37KB 를 다시 받지 않고 "바뀌었나"만 물어볼 수
// 있다(src/db.js STORE_REV 주석에 왜 그게 394ms 인지 적어뒀다). 값이 없는
// 동안에는 예전처럼 통째로 읽으므로, 이 마이그레이션이 한 번 돌기 전까지도
// 화면은 멀쩡하다 — 느릴 뿐이다.
//
// storeWrite 가 어차피 판 번호를 붙이므로, 여기서는 빈 갱신 한 번이면 된다.
const MIGRATION_FLAG = "migration_2026_09_14_store_rev_applied";

async function applyStoreRev20260914(store, { storeWrite, saveFields }) {
  if (store.settings && store.settings[MIGRATION_FLAG]) return;
  const appliedAt = new Date().toISOString();
  store.settings = store.settings || {};
  store.settings[MIGRATION_FLAG] = appliedAt;
  // saveFields 도 storeWrite 를 거치므로 판 번호가 같이 붙는다.
  await saveFields({ [`settings.${MIGRATION_FLAG}`]: appliedAt });
}

module.exports = { applyStoreRev20260914, MIGRATION_FLAG };
