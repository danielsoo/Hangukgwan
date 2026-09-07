// One-time data migration for the 2026-09-07 부대찌개 포장 옵션 피드백.
//
// 사장님 메모(사진 두 장, 2026-09-07): "부대찌개 포장주문할때 두가지
// 옵션이 있대. 不煮外帶 → 조리하지 않은 포장 / 煮熟外帶 → 조리한 포장" —
// seed.js는 새 설치에서만 실행되므로, 이미 살아있는(live) 데이터베이스의
// 부대찌개(코드 71) 항목에는 이 필드를 직접 채워줘야 한다. 같은 값을
// seed.js의 ITEMS.hotpot 항목에도 넣어뒀다 (새 설치는 그쪽에서 이미
// 채워짐).
const MIGRATION_FLAG = "migration_2026_09_07_takeout_options_applied";

async function applyTakeoutOptions20260907(store, { save }) {
  if (store.settings && store.settings[MIGRATION_FLAG]) return;

  const armyStew = store.menuItems.find((m) => m.code === "71");
  if (armyStew && !armyStew.takeout_options) {
    armyStew.takeout_options = "不煮外帶,煮熟外帶";
  }

  store.settings[MIGRATION_FLAG] = true;
  await save();
  console.log("Applied 2026-09-07 takeout-options migration.");
}

module.exports = { applyTakeoutOptions20260907 };
