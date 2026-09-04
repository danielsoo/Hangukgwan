// One-time data migration for the 2026-09-04 메뉴 피드백 (items 19-21).
//
// 2026-09-followup.js is already on origin/main (pushed + deployed), so its
// MIGRATION_FLAG has already fired against the live database — adding new
// steps there would silently never run, same reason 2026-09-feedback.js
// itself was never touched after it shipped. This is a fresh file/flag
// instead, same pattern as always: idempotent, safe to call on every server
// boot, no-ops after its first successful run.
const MIGRATION_FLAG = "migration_2026_09_04_menu_fixes_applied";

async function applyMenuFixes20260904(store, { save, deletePhoto }) {
  if (store.settings && store.settings[MIGRATION_FLAG]) return;

  // ---- 19. 짬뽕(26)/짬뽕밥(27): 맵기 선택 없애기 ----
  // "특별히 맵기 안 바꾸면 기본맛이야" 피드백과 별개로, 이 두 메뉴는 애초에
  // 맵기 선택 자체를 없애기로 함 — spice_options를 지우면 손님 화면/관리자
  // 화면 모두에서 맵기 선택지가 아예 보이지 않는다 (is_spicy 매운맛 배지는
  // 그대로 유지, 표시용 아이콘일 뿐 spice_options와는 별개 필드).
  for (const code of ["26", "27"]) {
    const item = store.menuItems.find((m) => m.code === code);
    if (item && item.spice_options) item.spice_options = null;
  }

  // ---- 20. 韓國飲料(91) 삭제 ----
  // "제일 첫번째 한국음료 사진 없는 것 아예 삭제" — 음료 카테고리 맨 앞의
  // 韓國飲料/한국 음료수(코드 91)만 사진이 없던 항목이라 통째로 삭제.
  const drink91 = store.menuItems.find((m) => m.code === "91");
  if (drink91) {
    if (drink91.photo_url) {
      const photoId = (drink91.photo_url.match(/^\/api\/photo\/([a-f0-9]{24})$/) || [])[1];
      if (photoId) await deletePhoto(photoId);
    }
    store.menuItems = store.menuItems.filter((m) => m.id !== drink91.id);
  }

  // ---- 21. 포도봉봉 중복 제거 ----
  // "포도 봉봉 마지막에 또 들어갔음. 삭제" — 정식 항목은 코드 101
  // (2026-09-feedback.js가 upsert로 생성). 그 이후 관리자 메뉴 추가 패널로
  // 한 번 더 들어간 걸로 보이는, 이름은 같지만 코드/아이디가 다른 항목이
  // 목록 맨 뒤(새로 추가된 항목은 항상 sort_order 맨 끝)에 있는 상태 — 정식
  // 항목(코드 101)만 남기고 나머지는 전부 삭제.
  const bongbongDupes = store.menuItems.filter(
    (m) => m.code !== "101" && (m.name_ko === "포도봉봉" || m.name_zh === "Bong Bong 葡萄汁")
  );
  for (const dupe of bongbongDupes) {
    if (dupe.photo_url) {
      const photoId = (dupe.photo_url.match(/^\/api\/photo\/([a-f0-9]{24})$/) || [])[1];
      if (photoId) await deletePhoto(photoId);
    }
    store.menuItems = store.menuItems.filter((m) => m.id !== dupe.id);
  }

  store.settings[MIGRATION_FLAG] = true;
  await save();
  console.log("Applied 2026-09-04 menu-fixes migration.");
}

module.exports = { applyMenuFixes20260904 };
