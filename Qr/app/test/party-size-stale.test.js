// 테이블에 남은 인원수를 언제 버려야 하는지.
//
// 2026-09-09 사장님: "인원수 물어보는 것도 그래 — 어떤 테이블은 물어보고
// 어떤 테이블은 안 물어봐."
//
// 원인은 "지우는 사람이 없는 경우"였다. party_size 는 결제와 취소로만
// 지워지는데, 손님이 QR 을 찍고 인원수만 답한 뒤 주문 없이 나가면 결제할
// 것도 취소할 것도 없다. 그 숫자가 그 테이블에 영원히 남아, 다음 손님은
// 앞 손님 인원수를 물려받고 질문을 아예 받지 않는다.
//
// 시간으로 만료시키되, 손님이 실제로 앉아 있으면(주문이 살아 있으면) 아무리
// 오래돼도 건드리면 안 된다 — 오래 드시는 손님에게 식사 중에 인원수를 다시
// 묻는 건 원래 문제만큼이나 나쁘다. 그 경계를 여기서 지킨다.
const { STALE_MS, isPartySizeStale, clearIfStale } = require("../src/partySize");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const NOW = Date.parse("2026-09-09T18:00:00Z");
const ago = (ms) => new Date(NOW - ms).toISOString();

function storeWith(orders) {
  return { orders };
}
function table(over) {
  return Object.assign({ number: "7", party_size: 4, party_size_updated_at: ago(0), is_counter: false }, over);
}

out.push("[손님이 앉아 있으면 절대 건드리지 않는다]");
// 여기가 제일 중요하다. 오래 드시는 손님(3시간짜리 회식)의 인원수를 식사
// 중에 날려버리면, 추가 주문할 때 인원수를 다시 묻게 된다.
for (const status of ["new", "preparing", "served"]) {
  const s = storeWith([{ table_number: "7", status }]);
  check(`${status} 주문이 있으면 6시간이 지나도 유지된다`,
    !isPartySizeStale(s, table({ party_size_updated_at: ago(6 * 60 * 60 * 1000) }), NOW));
}
check("방금 앉은 손님(주문 전)의 인원수는 유지된다",
  !isPartySizeStale(storeWith([]), table({ party_size_updated_at: ago(5 * 60 * 1000) }), NOW));
check("메뉴를 오래 보는 손님(1시간 반)도 유지된다",
  !isPartySizeStale(storeWith([]), table({ party_size_updated_at: ago(90 * 60 * 1000) }), NOW));

out.push("\n[주문 없이 오래 남은 숫자는 버린다]");
// 사장님이 겪은 바로 그 경우 — 인원수만 찍고 주문 없이 나간 테이블.
check("주문 한 건 없이 2시간이 지나면 만료된다",
  isPartySizeStale(storeWith([]), table({ party_size_updated_at: ago(STALE_MS + 60 * 1000) }), NOW));
check("점심에 남은 숫자가 저녁 영업에는 사라진다",
  isPartySizeStale(storeWith([]), table({ party_size_updated_at: ago(4 * 60 * 60 * 1000) }), NOW));
// 결제/취소된 주문만 남은 테이블은 "손님이 앉아 있다"가 아니다.
check("결제 완료된 주문만 남았으면 만료된다",
  isPartySizeStale(storeWith([{ table_number: "7", status: "paid" }]), table({ party_size_updated_at: ago(3 * 60 * 60 * 1000) }), NOW));
check("취소된 주문만 남았으면 만료된다",
  isPartySizeStale(storeWith([{ table_number: "7", status: "cancelled" }]), table({ party_size_updated_at: ago(3 * 60 * 60 * 1000) }), NOW));
// 다른 테이블의 주문이 이 테이블을 붙잡아두면 안 된다.
check("옆 테이블 주문은 이 테이블을 붙잡지 않는다",
  isPartySizeStale(storeWith([{ table_number: "8", status: "new" }]), table({ party_size_updated_at: ago(3 * 60 * 60 * 1000) }), NOW));
// 테이블 번호는 곳에 따라 문자열/숫자가 섞여 들어올 수 있다.
check("테이블 번호가 숫자로 들어와도 같은 테이블로 본다",
  !isPartySizeStale(storeWith([{ table_number: 7, status: "new" }]), table({ party_size_updated_at: ago(6 * 60 * 60 * 1000) }), NOW));

out.push("\n[만료랄 것이 없는 경우]");
check("인원수가 없으면 만료가 아니다", !isPartySizeStale(storeWith([]), table({ party_size: null }), NOW));
check("포장 카운터는 인원수를 안 쓰므로 건드리지 않는다",
  !isPartySizeStale(storeWith([]), table({ is_counter: true, party_size_updated_at: ago(10 * 60 * 60 * 1000) }), NOW));

out.push("\n[언제 찍힌 건지 모르는 옛 데이터]");
// 이 기능이 생기기 전에 남은 행에는 party_size_updated_at 이 없다. 모르는
// 숫자를 계속 믿는 것보다, 한 번 더 묻는 쪽이 안전하다.
check("시각이 없으면 만료로 본다", isPartySizeStale(storeWith([]), table({ party_size_updated_at: null }), NOW));
check("시각이 깨져 있어도 만료로 본다", isPartySizeStale(storeWith([]), table({ party_size_updated_at: "쓰레기" }), NOW));
check("그래도 주문이 살아 있으면 유지된다",
  !isPartySizeStale(storeWith([{ table_number: "7", status: "new" }]), table({ party_size_updated_at: null }), NOW));

out.push("\n[clearIfStale 은 실제로 지운다]");
const t1 = table({ party_size_updated_at: ago(3 * 60 * 60 * 1000) });
const changed1 = clearIfStale(storeWith([]), t1, NOW);
check("만료면 true 를 돌려주고 값을 비운다", changed1 === true && t1.party_size === null && t1.party_size_updated_at === null,
  JSON.stringify(t1));
const t2 = table({ party_size_updated_at: ago(10 * 60 * 1000) });
const changed2 = clearIfStale(storeWith([]), t2, NOW);
check("만료가 아니면 false 를 돌려주고 값을 그대로 둔다", changed2 === false && t2.party_size === 4, JSON.stringify(t2));

out.push("\n[경계]");
check("정확히 2시간은 아직 유효하다", !isPartySizeStale(storeWith([]), table({ party_size_updated_at: ago(STALE_MS) }), NOW));
check("2시간 + 1초부터 만료다", isPartySizeStale(storeWith([]), table({ party_size_updated_at: ago(STALE_MS + 1000) }), NOW));
check("만료 기준이 2시간이다", STALE_MS === 2 * 60 * 60 * 1000, String(STALE_MS));

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
