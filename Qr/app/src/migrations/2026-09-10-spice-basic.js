// 맵기 선택에 「基本」을 되돌려 놓는다.
//
// 사장님(2026-09-10): "맵기 기본에 늘 기본이 있어야 하고 그게 기본 세팅으로
// 선택이 되어있어야 해."
//
// 무슨 일이었나:
//
// 씨앗 데이터(src/seed.js)는 맵기가 있는 메뉴마다 「基本,小辣」처럼 基本 을
// 첫 칸에 두고 있었다. 손님 화면은 첫 칸을 미리 골라두므로, 아무것도 안
// 건드린 손님에게는 基本 이 나갔다 — 의도대로다.
//
// 그런데 운영 데이터에서 일부 메뉴의 基本 이 빠져 있었다(예: 「不辣,中辣」,
// 「小辣」). 그러면 첫 칸이 매운맛이 되고, 아무것도 안 고른 손님에게 小辣 가
// 나간다. 사장님이 「매운맛 선택이 무조건 첫번째거로 선택되어있어」라고
// 하신 것이 이 상태다.
//
// 화면 쪽에서도 基本 을 보장하지만(public/js/order.js), 저장된 데이터 자체를
// 고쳐두지 않으면 관리자 메뉴 편집 화면과 빌지에는 계속 어긋난 목록이 보인다.
//
// 이미 있는 매운맛 칸은 건드리지 않는다. 없는 곳에 基本 을 맨 앞에 끼울 뿐이다.
const MIGRATION_FLAG = "migration_2026_09_10_spice_basic_applied";
const BASIC = "基本";

function withBasic(raw) {
  const parts = String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return null; // 맵기 칸이 없는 메뉴는 그대로 둔다
  if (parts.includes(BASIC)) return null; // 이미 있다
  return [BASIC, ...parts].join(",");
}

async function applySpiceBasic20260910(store, { save }) {
  if (store.settings && store.settings[MIGRATION_FLAG]) return;

  const fixed = [];
  for (const item of store.menuItems || []) {
    const next = withBasic(item.spice_options);
    if (!next) continue;
    item.spice_options = next;
    fixed.push(item.code || item.id);
  }

  store.settings[MIGRATION_FLAG] = new Date().toISOString();
  await save();
  if (fixed.length) {
    console.log(`[migration] 맵기 「基本」을 되돌렸습니다: ${fixed.length}개 (${fixed.join(", ")})`);
  }
}

module.exports = { applySpiceBasic20260910, withBasic, BASIC };
