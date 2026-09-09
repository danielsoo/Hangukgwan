// 테이블에 등록된 인원수(party_size)를 언제 지우는가 — 규칙을 한 곳에 둔다.
//
// 2026-09-09 사장님: "구분 할 수 있어. 결제를 완료했다고 직원이 누르지 않는
// 한 한번이라도 주문한 손님은 계속 같은 손님으로 취급할거야."
//
// 그래서 인원수를 지우는 경우는 딱 둘이다.
//   1. 직원이 「결제 완료」를 눌러 그 테이블에 안 받은 돈이 없어졌을 때
//   2. 직원이 결제 탭에서 그 테이블의 「손님 나감」을 직접 눌렀을 때
//
// 시간이 지났다고 알아서 지우지 않는다. 손님이 두 시간을 앉아 계셔도,
// 주문을 한 건 하고 오래 이야기하시다가 더 시켜도, 직원이 결제 완료를
// 누르기 전까지는 같은 손님이다.
//
// 주문 취소는 지우지 않는다. 주방에 재료가 떨어져서 한 접시를 취소하는
// 것과 손님이 나가는 것은 전혀 다른 일이고, 앞의 것 때문에 앉아 계신
// 손님에게 인원수를 다시 묻게 되면 안 된다. 예전에는 "살아 있는 주문이
// 하나도 없으면" 지웠는데, 그 규칙에서는 마지막 주문을 취소하는 순간
// 손님이 나간 것으로 처리됐다.

/** 이 테이블에 아직 안 받은 돈이 있는가(취소된 건 셈에서 뺀다). */
function hasUnpaidOrder(store, tableNumber) {
  return store.orders.some(
    (o) => String(o.table_number) === String(tableNumber) && o.status !== "paid" && o.status !== "cancelled"
  );
}

/**
 * 결제가 하나 끝난 뒤 부르는 정리. 그 테이블에 안 받은 돈이 남아 있으면
 * 아무것도 하지 않는다(손님이 아직 앉아 계신다). 지웠으면 true 를 돌려주니
 * 부르는 쪽이 save() 여부를 판단하면 된다.
 *
 * 결제로만 부른다 — 취소로는 부르지 않는다(위 주석 참고).
 */
function clearPartySizeIfSettled(store, tableNumber) {
  if (hasUnpaidOrder(store, tableNumber)) return false;
  const table = store.tables.find((t) => String(t.number) === String(tableNumber));
  if (!table || !table.party_size) return false;
  table.party_size = null;
  table.party_size_updated_at = null;
  return true;
}

/**
 * 자리 이동 — 인원수도 손님을 따라간다.
 *
 * 2026-09-10 사장님: "손님이 주문하고 난 후에도 좌석 이동을 가능하게 해줘."
 *
 * 이 파일에 두는 이유: 인원수를 지우는 코드가 여기저기 흩어지면 위의 규칙이
 * 조용히 무너진다. 여기서 비우는 건 "손님이 나갔다" 가 아니라 "그 손님이
 * 저쪽 자리로 갔다" 이고, 그래서 저쪽에 그대로 옮겨 붙는다 — 옮긴 자리에서
 * 인원수를 다시 물어보면 안 된다.
 *
 * 이미 손님이 있는 자리로 합치는 경우에는 두 인원을 더한다. 그 자리는 이제
 * 한 테이블이고, 1인당 최소 주문 같은 계산이 인원수를 쓴다.
 */
function movePartySize(store, fromNumber, toNumber) {
  const from = store.tables.find((t) => String(t.number) === String(fromNumber));
  const to = store.tables.find((t) => String(t.number) === String(toNumber));
  if (!from || !to || !from.party_size) return false;
  to.party_size = (to.party_size || 0) + from.party_size;
  // 「언제부터 앉아 있는가」도 그대로 따라간다. 자리를 옮겼다고 이 손님이
  // 방금 온 손님이 되는 것은 아니다 — 사장님(2026-09-10): "자리를 옮기던
  // 시간이 오래 걸리던 전체 결제를 하지 않는 이상 이 손님은 같은 손님."
  // 두 자리를 합칠 때는 더 이른 쪽이 이 자리의 시작이다.
  const starts = [to.party_size_updated_at, from.party_size_updated_at].filter(Boolean).sort();
  to.party_size_updated_at = starts[0] || new Date().toISOString();
  from.party_size = null;
  from.party_size_updated_at = null;
  return true;
}

/**
 * 이 자리에 지금 앉아 있는 손님이 언제부터 앉아 있는가 — Taipei 시각
 * "YYYY-MM-DD HH:MM:SS" 로, 주문의 created_at 과 그대로 비교할 수 있게.
 *
 * 인원수를 찍은 시각이 곧 그 손님이 앉은 시각이다. 전체 결제가 끝나면
 * 인원수가 지워지므로(위 clearPartySizeIfSettled), 이 값이 있다는 것은
 * "그 손님이 아직 앉아 있다" 는 뜻이고 그 뒤의 주문은 전부 그 손님 것이다.
 * 사장님(2026-09-10): "전체 결제를 하지 않는 이상 이 손님은 같은 손님."
 *
 * 자리 이동이 이걸 쓴다. 이 손님이 아까 결제한 라운드도 같이 옮겨야 하는데,
 * 경계가 없으면 오늘 낮에 그 자리에 앉았다 간 다른 손님의 결제까지 함께
 * 옮겨진다. 그건 아무도 눈치채지 못하고 되돌릴 수도 없다.
 */
function seatingStartOf(table) {
  if (!table || !table.party_size || !table.party_size_updated_at) return null;
  const t = new Date(table.party_size_updated_at);
  if (Number.isNaN(t.getTime())) return null;
  // 대만은 UTC+8 고정(서머타임 없음)이라 이 변환은 늘 정확하다.
  return new Date(t.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
}

module.exports = { hasUnpaidOrder, clearPartySizeIfSettled, movePartySize, seatingStartOf };
