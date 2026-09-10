// 결산의 인원을 어른·아이로 가른다.
//
// 사장님(2026-09-10): "결산에 들어가는 인원 성인 아이 따로 구분해서 집계해줘."
//
// ── 이 파일이 지키는 단 하나 ──────────────────────────────────────────
//
//   **어른 + 아이 = 손님 수.** 언제나.
//
// 화면에 「손님 9명」과 「어른 6 · 아이 5」가 나란히 뜨면 어느 쪽도 못 믿게
// 된다. 어른과 아이를 각각 최대값으로 따로 뽑으면 정확히 그렇게 된다 —
// 같은 자리에서 「어른 2·아이 0」과 「어른 1·아이 2」가 있었으면 각각의
// 최대는 2 와 2 라서 합이 4 인데, 실제로 센 인원은 3 이다.
const { computeSettlement } = require("../src/settlement");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}
const D = "2026-09-10";
let seq = 0;
const order = (table, size, adults, children, at = "12:00:00") => ({
  id: ++seq, table_number: table, status: "paid",
  created_at: `${D} ${at}`, updated_at: `${D} 13:00:00`,
  total: 1000, party_size: size, party_adults: adults, party_children: children, items: [],
});
const S = (orders) => computeSettlement(orders, D);

out.push("[1] 기본");
{
  const s = S([order("7", 4, 2, 2)]);
  check("어른을 센다", s.adult_count === 2, JSON.stringify(s.adult_count));
  check("아이를 센다", s.child_count === 2, JSON.stringify(s.child_count));
  check("★ 합이 손님 수와 같다", s.adult_count + s.child_count === s.guest_count, `${s.adult_count}+${s.child_count} vs ${s.guest_count}`);
}

out.push("\n[2] ★★ 같은 자리에서 인원이 바뀌어도 합이 안 어긋난다");
{
  // 어른·아이를 따로 최대값으로 뽑으면 여기서 2+2=4 가 되어 손님 수 3 과
  // 어긋난다. 가장 큰 한 번을 통째로 골라야 한다.
  const s = S([order("7", 2, 2, 0, "12:00:00"), order("7", 3, 1, 2, "12:40:00")]);
  check("★ 손님 수는 큰 쪽 하나만 센다", s.guest_count === 3, String(s.guest_count));
  check("★ 어른·아이도 그 한 번의 것을 쓴다", s.adult_count === 1 && s.child_count === 2, `${s.adult_count}/${s.child_count}`);
  check("★ 합이 손님 수와 같다", s.adult_count + s.child_count === s.guest_count, "");
}

out.push("\n[3] 구분이 생기기 전 손님은 전부 어른");
{
  // 2026-09-10 이전 주문에는 party_adults 가 아예 없다. 0 으로 두면 옛
  // 날짜를 열어본 결산에서 어른이 통째로 사라진다.
  const legacy = { id: 99, table_number: "9", status: "paid", created_at: `${D} 12:00:00`, updated_at: `${D} 13:00:00`, total: 1000, party_size: 3, items: [] };
  const s = S([legacy]);
  check("★ 옛 주문도 어른으로 잡힌다", s.adult_count === 3 && s.child_count === 0, `${s.adult_count}/${s.child_count}`);
  check("합이 손님 수와 같다", s.adult_count + s.child_count === s.guest_count, "");
}

out.push("\n[4] 저장된 값이 안 맞으면 인원 쪽을 믿는다");
{
  const s = S([order("7", 4, 9, 1)]); // 어른 9 + 아이 1 = 10, 그런데 인원은 4
  check("★ 인원을 넘지 않는다", s.adult_count + s.child_count === s.guest_count, `${s.adult_count}+${s.child_count} vs ${s.guest_count}`);
  check("아이는 그대로 두고 어른을 맞춘다", s.child_count === 1 && s.adult_count === 3, `${s.adult_count}/${s.child_count}`);

  const s2 = S([order("8", 3, 0, 9)]); // 아이가 인원보다 많다
  check("아이가 인원을 넘으면 인원까지만", s2.child_count === 3 && s2.adult_count === 0, `${s2.adult_count}/${s2.child_count}`);
}

out.push("\n[5] 자리마다 따로 세고 더한다");
{
  const s = S([order("7", 4, 2, 2), order("8", 3, 3, 0), order("9", 2, 1, 1)]);
  check("손님 9명", s.guest_count === 9, String(s.guest_count));
  check("어른 6 · 아이 3", s.adult_count === 6 && s.child_count === 3, `${s.adult_count}/${s.child_count}`);
}

out.push("\n[6] 인원이 없는 주문은 안 센다");
{
  const takeout = { id: 50, table_number: "COUNTER", status: "paid", created_at: `${D} 12:00:00`, updated_at: `${D} 13:00:00`, total: 500, items: [] };
  const s = S([takeout]);
  check("포장은 인원에 안 들어간다", s.guest_count === 0 && s.adult_count === 0 && s.child_count === 0, JSON.stringify([s.guest_count, s.adult_count, s.child_count]));
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
