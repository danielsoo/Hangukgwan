// 테이블에 등록된 인원수(party_size)가 "아직 유효한가"를 한 곳에서 판단한다.
//
// 2026-09-09 사장님: "인원수 물어보는 것도 그래 — 어떤 테이블은 물어보고
// 어떤 테이블은 안 물어봐."
//
// 원인: party_size 를 지우는 건 결제와 취소뿐이었다. 그런데 손님이 QR 을
// 찍고 인원수만 답한 뒤 주문 없이 나가는 일이 꽤 흔하다(자리를 옮기거나,
// 메뉴를 보다 마음이 바뀌거나, 그냥 찍어만 본 경우). 그러면 결제할 것도
// 취소할 것도 없으니 지워주는 사람이 아무도 없고, 그 숫자가 그 테이블에
// 영원히 남는다. 다음 손님은 앞 손님 인원수를 그대로 물려받아 아예 질문을
// 받지 못한다 — 그 테이블만 "안 물어보는 테이블"이 된다.
//
// 그래서 시간으로 만료시킨다. 단, 주문이 하나라도 살아 있으면 손님이 실제로
// 앉아 있다는 뜻이므로 아무리 오래돼도 만료시키지 않는다(오래 드시는 손님의
// 인원수를 중간에 날려서 다시 묻게 만들면 안 된다). 만료 대상은 오직
// "인원수만 남고 주문은 하나도 없는" 테이블이다.
//
// 2시간인 이유: 주문을 한 건도 하지 않은 채 2시간을 앉아 있는 손님은 없다.
// 그리고 이 가게 영업시간이 11:00–14:00 / 17:00–21:00 이라, 점심에 남은
// 숫자가 저녁 영업 전에 반드시 사라진다.
const STALE_MS = 2 * 60 * 60 * 1000;

function hasActiveOrder(store, tableNumber) {
  return store.orders.some(
    (o) => String(o.table_number) === String(tableNumber) && o.status !== "paid" && o.status !== "cancelled"
  );
}

/**
 * 이 테이블의 인원수가 지금도 유효한지. 유효하지 않으면(=다음 손님에게 다시
 * 물어봐야 하면) false.
 */
function isPartySizeStale(store, table, now = Date.now()) {
  if (!table || !table.party_size) return false; // 애초에 없으면 만료랄 것도 없다
  if (table.is_counter) return false; // 카운터는 인원수를 안 쓴다
  if (hasActiveOrder(store, table.number)) return false; // 손님이 앉아 있다
  // 예전 데이터에는 party_size_updated_at 이 없을 수 있다. 언제 찍힌 건지
  // 알 수 없는 숫자를 계속 믿는 것보다, 모르면 만료로 보는 쪽이 안전하다 —
  // 최악의 경우 손님에게 한 번 더 묻는 것뿐이고, 반대쪽 실수(엉뚱한 인원수를
  // 물려주고 아예 묻지 않는 것)는 사장님이 겪은 바로 그 증상이다.
  if (!table.party_size_updated_at) return true;
  const t = Date.parse(table.party_size_updated_at);
  if (Number.isNaN(t)) return true;
  return now - t > STALE_MS;
}

/** 만료됐으면 지운다. 지웠으면 true (부르는 쪽이 save() 할지 판단하도록). */
function clearIfStale(store, table, now = Date.now()) {
  if (!isPartySizeStale(store, table, now)) return false;
  table.party_size = null;
  table.party_size_updated_at = null;
  return true;
}

module.exports = { STALE_MS, isPartySizeStale, clearIfStale, hasActiveOrder };
