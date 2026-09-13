// 주문 상태는 여기 한 곳에서만 정한다.
//
// 2026-09-13: 「최근 주문 읽기」가 4초 걸리던 것을 고치면서 필요해졌다.
// 예전 질의는 「paid 도 cancelled 도 아닌 것」($nin)이었는데, **$nin 은
// 인덱스를 못 탄다** — 안 끝난 주문 하나를 찾으려고 영업 시작 이후의 모든
// 주문을 훑었다. 하루가 지날수록 훑을 것이 늘어난다.
//
// 「안 끝난 것」을 「이 셋 중 하나」($in)로 뒤집으면 인덱스를 탄다. 그런데
// 그러려면 상태의 목록이 **정확히** 맞아야 한다. 목록에서 빠진 상태가 하나라도
// 있으면 그 주문은 화면에서 사라지고, 이 가게에서 그건 받을 돈이 사라지는
// 것이다(src/db.js 의 주석).
//
// 그래서 목록을 한 곳에 두고, 라우트의 입력 검사도 같은 목록을 쓰게 한다.
// 상태를 새로 만들면 여기에 안 넣고는 저장 자체가 안 된다.
const OPEN = ["new", "preparing", "served"]; // 아직 받을 돈이 남아 있는 것
const CLOSED = ["paid", "cancelled"]; // 끝난 것
const ALL = OPEN.concat(CLOSED);

function isOpen(status) {
  return OPEN.includes(status);
}
function isKnown(status) {
  return ALL.includes(status);
}

module.exports = { OPEN, CLOSED, ALL, isOpen, isKnown };
