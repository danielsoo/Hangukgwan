// 할인 제외를 분류 자신이 들고 있게 한다.
//
// 사장님(2026-09-16): "그리고 할인은 기타, 음료 는 모두 적용 안돼."
// 같은 요청이 두 번째다 — 2026-09-14 에도 "지금은 음료 주류만 빠지는데 기타
// 항목도 모두 할인 안하게 해줘" 가 있었고, 그때는 코드에 키 목록
// (DISCOUNT_EXCLUDED_CATEGORY_KEYS = ["drink", "other"])을 적는 것으로
// 끝냈다.
//
// 그 방법의 문제: key 는 분류를 만들 때 한 번 정해지고 **화면에 안 보인다.**
// 「기타」라고 보이는 분류의 key 가 other 가 아니면 할인이 그대로 걸리는데,
// 사장님은 그 사실을 알 방법도 고칠 방법도 없다. 두 번째 요청이 온 이유가
// 그것으로 보인다.
//
// 이제 분류마다 discount_excluded 표를 달고, 메뉴 관리에서 켜고 끈다.
// 여기서는 그 표의 **처음 값**만 정해준다 — 키가 맞거나(drink/other) 보이는
// 이름이 기타·음료·주류면 켜고, 나머지는 끈다. 그 뒤로는 사장님이 정한다.
//
// 다른 마이그레이션과 같은 규칙: 자기 플래그를 보고 한 번만 실행되고,
// 서버가 뜰 때마다 다시 불러도 안전하다.
const { guessDiscountExcluded } = require("../discounts");

const MIGRATION_FLAG = "migration_2026_09_16_discount_excluded_applied";

async function applyDiscountExcludedFlag20260916(store, { save }) {
  if (store.settings && store.settings[MIGRATION_FLAG]) return;

  store.categories = store.categories || [];
  let on = 0;
  for (const cat of store.categories) {
    // 이미 표가 있으면 손대지 않는다 — 사장님이 정한 값일 수 있다.
    if (cat.discount_excluded !== undefined && cat.discount_excluded !== null) continue;
    cat.discount_excluded = guessDiscountExcluded(cat);
    if (cat.discount_excluded) on++;
  }

  store.settings = store.settings || {};
  store.settings[MIGRATION_FLAG] = true;
  await save();
  console.log(`[migration] 할인 제외 표: ${store.categories.length}개 분류 중 ${on}개를 제외로 표시.`);
}

module.exports = { applyDiscountExcludedFlag20260916 };
