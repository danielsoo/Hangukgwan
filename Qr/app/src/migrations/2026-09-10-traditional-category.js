// 사장님 요청(2026-09-10): 메뉴 카테고리에 "전통한식요리 / 經典韓式料理"를
// 큰 항목인 구이류(烤肉類)와 기타(其他) 사이에 새로 만들고, 71~83번
// (부대찌개 ~ 골뱅이무침) 13개를 그쪽으로 옮긴다. 옮기고 나면 기타에는
// 남는 항목이 하나도 없어서 기타 카테고리 자체를 없앤다.
//
// 관리자 화면의 카테고리 추가(POST /api/menu/admin/categories)는 항상 맨
// 뒤에만 붙일 수 있고 순서 변경이 없다. 그래서 "구이 다음, 기타 앞"이라는
// 자리는 화면에서 만들 수 없고, 이미 살아 있는 데이터베이스를 직접 고치는
// 이 마이그레이션이 필요하다. 새로 설치하는 경우는 src/seed.js 쪽을 같이
// 고쳐뒀다.
//
// 다른 마이그레이션과 같은 규칙: 자기 플래그를 보고 한 번만 실행되고,
// 서버가 뜰 때마다 다시 불러도 안전하다.
const MIGRATION_FLAG = "migration_2026_09_10_traditional_category_applied";

// 전통한식요리로 옮길 메뉴 코드 — 옮기기 전 기타(其他)에 있던 전부다.
const CODES_TO_MOVE = ["71", "72", "73", "74", "75", "76", "77", "78", "79", "80", "81", "82", "83"];

const NEW_CATEGORY = {
  key: "traditional",
  name_zh: "經典韓式料理",
  name_ko: "전통한식요리",
  name_en: "Classic Korean Dishes",
};

async function applyTraditionalCategory20260910(store, { save, nextId }) {
  if (store.settings && store.settings[MIGRATION_FLAG]) return;

  store.categories = store.categories || [];
  store.menuItems = store.menuItems || [];

  // ---- 1. 카테고리 만들기 (이미 있으면 그걸 그대로 쓴다) ----
  let trad = store.categories.find((c) => c.key === NEW_CATEGORY.key);
  if (!trad) {
    trad = {
      id: nextId("categories"),
      ...NEW_CATEGORY,
      // 순서는 아래 3번에서 전체를 다시 매기니 여기서는 임시값이면 된다.
      sort_order: store.categories.reduce((m, c) => Math.max(m, c.sort_order || 0), 0) + 1,
    };
    store.categories.push(trad);
  }

  // ---- 2. 71~83번을 새 카테고리로 ----
  // 항목끼리의 순서(sort_order)는 손대지 않는다. 메뉴 화면은 같은
  // 카테고리 안에서의 상대적인 순서만 보기 때문에(src/routes/menu.js의
  // categoriesWithItems), 그대로 두면 71→83 순서가 그대로 유지된다.
  for (const code of CODES_TO_MOVE) {
    const item = store.menuItems.find((m) => m.code === code);
    if (item) item.category_id = trad.id;
  }

  // ---- 3. 구이류 바로 뒤에 끼워넣고 번호를 1부터 다시 매기기 ----
  const ordered = store.categories
    .filter((c) => c.id !== trad.id)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const bbqIdx = ordered.findIndex((c) => c.key === "bbq");
  ordered.splice(bbqIdx >= 0 ? bbqIdx + 1 : ordered.length, 0, trad);
  ordered.forEach((c, i) => {
    c.sort_order = i + 1;
  });
  store.categories = ordered;

  // ---- 4. 비어버린 기타(其他) 없애기 ----
  // 사장님이 "기타는 지워라"고 한 건 71~83이 전부 빠져서 빈 칸만 남기
  // 때문이다. 혹시라도 그 사이에 새 메뉴가 기타로 들어와 있으면 지우지
  // 않는다 — 메뉴가 소리 없이 사라지는 쪽이 훨씬 나쁘다.
  const other = store.categories.find((c) => c.key === "other");
  if (other && !store.menuItems.some((m) => m.category_id === other.id)) {
    store.categories = store.categories.filter((c) => c.id !== other.id);
    store.categories
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
      .forEach((c, i) => {
        c.sort_order = i + 1;
      });
  }

  store.settings = store.settings || {};
  store.settings[MIGRATION_FLAG] = true;
  await save();
}

module.exports = { applyTraditionalCategory20260910 };
