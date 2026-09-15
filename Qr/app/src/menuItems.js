// 지운 메뉴는 없애지 않고 휴지통에 둔다.
//
// 2026-09-15 사장님: "삭제는 휴지통을 하나 만들어서 복원 버튼을 만들어줬으면
// 좋겠어." 그 앞에: "잘못 삭제해서 같은 메뉴를 다시등록하거나 할 때 오류가
// 있을 것 같아서."
//
// 걱정이 맞았다. 지우고 다시 등록하면 **새 번호**를 받는데, 결산은 메뉴를
// 번호로 묶는다(src/settlement.js — 이름으로 묶으면 이름을 고친 순간 다른
// 메뉴가 되므로 일부러 그렇게 했다). 그래서 같은 해물파전이 결산에서 두 줄로
// 갈라지고, 「얼마나 팔렸나」 추이가 그 지점에서 끊긴다. 이미 지나간 주문을
// 고칠 방법도 없다.
//
// 번호를 살려두면 그 일이 없다. 다시 등록하는 게 아니라 **복원**이 되고,
// 결산은 하나로 이어진다. 실수로 지운 것도 되돌릴 수 있다.
//
// 칸이 아예 없는 것이 「안 지워짐」이다(테스터 태그·위치 미확인 표시와 같은
// 규칙). 그래야 이 기능이 생기기 전의 메뉴가 전부 멀쩡히 살아 있다.
const DELETED_AT = "deleted_at";

/** 휴지통에 있는가. */
function isDeleted(item) {
  return !!(item && item[DELETED_AT]);
}

/** 살아 있는 것만. 메뉴를 목록으로 보여주는 곳은 전부 이걸 거친다. */
function activeItems(items) {
  return (items || []).filter((it) => !isDeleted(it));
}

/** 휴지통에 있는 것만 — 버린 순서대로(최근 것이 위). */
function deletedItems(items) {
  return (items || [])
    .filter(isDeleted)
    .sort((a, b) => String(b[DELETED_AT]).localeCompare(String(a[DELETED_AT])));
}

module.exports = { DELETED_AT, isDeleted, activeItems, deletedItems };
