// 인원수를 어른(大)/아이(小)로 나눠 받기 — 2026-09-10 사장님: "인원수 물을 때
// 어른(大), 아이(小) 묻기".
//
// 여기서 지켜야 하는 것은 두 가지다.
//   1. party_size 는 계속 총원이다. 결산·빌지·1인 1메뉴가 이미 그 값을 쓰고
//      있어서, 여기가 어른 수로 바뀌면 아무 말 없이 숫자가 틀어진다.
//   2. 구분이 생기기 전에 앉은 손님(party_adults 가 없는 자리)은 전체를
//      어른으로 친다. 0으로 두면 그 손님들에게만 「어른 수」를 쓰는 안내가
//      조용히 사라진다.
const { clearPartySizeIfSettled, movePartySize, partyBreakdownOf } = require("../src/partySize");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const table = (over) => Object.assign({ id: 1, number: "7" }, over);

out.push("[내역 읽기]");
check("어른 3 · 아이 1", (() => {
  const b = partyBreakdownOf(table({ party_size: 4, party_adults: 3, party_children: 1 }));
  return b.adults === 3 && b.children === 1 && b.total === 4;
})());
check("구분이 없던 자리는 전부 어른", (() => {
  const b = partyBreakdownOf(table({ party_size: 4 }));
  return b.adults === 4 && b.children === 0 && b.total === 4;
})());
check("아무도 없는 자리는 0", partyBreakdownOf(table({})).total === 0);
check("자리 자체가 없어도 터지지 않는다", partyBreakdownOf(null).total === 0);
check("아이만 앉은 자리도 그대로 읽는다", (() => {
  const b = partyBreakdownOf(table({ party_size: 2, party_adults: 0, party_children: 2 }));
  return b.adults === 0 && b.children === 2;
})());

out.push("\n[결제가 끝나면 내역까지 비운다]");
{
  const s = {
    orders: [{ table_number: "7", status: "paid" }],
    tables: [table({ party_size: 4, party_adults: 3, party_children: 1, party_size_updated_at: "2026-09-10T10:00:00Z" })],
  };
  check("지운다", clearPartySizeIfSettled(s, "7") === true);
  const t = s.tables[0];
  // 총원만 지우고 내역을 남기면, 다음 손님 자리에 지난 손님의 아이 수가
  // 그대로 남아 있다가 어딘가에서 다시 쓰인다.
  check("총원·어른·아이가 모두 비워진다", t.party_size === null && t.party_adults === null && t.party_children === null);
}
{
  const s = {
    orders: [{ table_number: "7", status: "served" }],
    tables: [table({ party_size: 4, party_adults: 3, party_children: 1 })],
  };
  check("안 받은 돈이 남아 있으면 그대로 둔다", clearPartySizeIfSettled(s, "7") === false && s.tables[0].party_adults === 3);
}

out.push("\n[자리 이동 — 내역도 따라간다]");
{
  const s = { orders: [], tables: [
    table({ id: 1, number: "5", party_size: 4, party_adults: 3, party_children: 1, party_size_updated_at: "2026-09-10T10:00:00Z" }),
    table({ id: 2, number: "8" }),
  ] };
  check("옮긴다", movePartySize(s, "5", "8") === true);
  const to = s.tables[1], from = s.tables[0];
  check("새 자리에 총원이 간다", to.party_size === 4);
  // 옮긴 자리에서 아이 수를 다시 물어보면, 인원수를 옮기는 의미가 없다.
  check("어른/아이도 그대로 간다", to.party_adults === 3 && to.party_children === 1);
  check("옛 자리는 비워진다", from.party_size === null && from.party_adults === null && from.party_children === null);
}
{
  // 이미 손님이 있는 자리로 합치는 경우 — 두 집이 한 테이블이 된다.
  const s = { orders: [], tables: [
    table({ id: 1, number: "5", party_size: 3, party_adults: 2, party_children: 1, party_size_updated_at: "2026-09-10T11:00:00Z" }),
    table({ id: 2, number: "8", party_size: 2, party_adults: 2, party_children: 0, party_size_updated_at: "2026-09-10T10:00:00Z" }),
  ] };
  movePartySize(s, "5", "8");
  const to = s.tables[1];
  check("합치면 총원이 더해진다", to.party_size === 5);
  check("어른끼리·아이끼리 더해진다", to.party_adults === 4 && to.party_children === 1);
  check("어른+아이 = 총원", to.party_adults + to.party_children === to.party_size);
  check("앉은 시각은 더 이른 쪽", to.party_size_updated_at === "2026-09-10T10:00:00Z");
}
{
  // 구분이 생기기 전에 앉아 있던 손님이 새 자리로 옮겨지는 경우.
  const s = { orders: [], tables: [
    table({ id: 1, number: "5", party_size: 4, party_size_updated_at: "2026-09-10T10:00:00Z" }),
    table({ id: 2, number: "8" }),
  ] };
  movePartySize(s, "5", "8");
  const to = s.tables[1];
  check("구분 없던 손님은 전부 어른으로 옮겨진다", to.party_adults === 4 && to.party_children === 0 && to.party_size === 4);
}
{
  // 구분이 있는 손님이, 구분이 없던 자리로 합쳐지는 경우.
  const s = { orders: [], tables: [
    table({ id: 1, number: "5", party_size: 3, party_adults: 1, party_children: 2, party_size_updated_at: "2026-09-10T11:00:00Z" }),
    table({ id: 2, number: "8", party_size: 2, party_size_updated_at: "2026-09-10T10:00:00Z" }),
  ] };
  movePartySize(s, "5", "8");
  const to = s.tables[1];
  check("합계가 어긋나지 않는다", to.party_adults + to.party_children === to.party_size, JSON.stringify(to));
  check("먼저 앉아 있던 2명은 어른으로 남는다", to.party_adults === 3 && to.party_children === 2);
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
