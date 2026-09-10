// 오전 손님 + 오후 손님 = 하루 손님. 언제나.
//
// 사장님(2026-09-10): "인원이 오전 오후 합치면 총 72명인데 합계는 51이야."
//
// ── 이 파일이 지키는 단 하나 ──────────────────────────────────────────
//
//   **오전 몫 + 오후 몫 = 합계.** 손님 수도, 어른도, 아이도.
//
// 왜 어긋났었나: 합계는 (테이블, 날짜)로 묶어서 그 자리의 가장 큰 한 팀만
// 셌다. 7번 자리에 점심 4명, 저녁 3명이 앉으면 합계는 max(4,3)=4 로 눌리고
// 오전·오후는 각자 안에서 4 와 3 을 세니 7 이 된다. 자리마다 작은 쪽 인원이
// 통째로 사라진 것이다 — 그래서 21명이 없어졌다.
//
// 합계 쪽이 오전·오후보다 굵게 묶이는 순간 두 숫자가 어긋나고, 어긋나면
// 사장님은 어느 쪽도 못 믿는다. 그래서 묶음 열쇠에 반나절이 들어간다.
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
// half: "am" | "pm" | null(옛 주문 — 표가 없다)
const order = (table, size, half, at, extra = {}) => ({
  id: ++seq,
  table_number: table,
  status: "paid",
  created_at: `${D} ${at}`,
  updated_at: `${D} ${at}`,
  total: 1000,
  party_size: size,
  party_adults: size,
  party_children: 0,
  items: [],
  ...(half ? { service_period: half } : {}),
  ...extra,
});
const S = (orders, opts = {}) => computeSettlement(orders, D, D, opts);
// 오전 정산을 안 눌러도 저녁 시작 시각으로 가를 수 있게 해주는 힌트.
const EVE = { eveningStartsAt: "16:25" };

function invariant(s, label) {
  check(`★ ${label}: 오전+오후 = 손님 수`,
    s.half_split.am.guest_count + s.half_split.pm.guest_count === s.guest_count,
    `${s.half_split.am.guest_count}+${s.half_split.pm.guest_count} vs ${s.guest_count}`);
  check(`★ ${label}: 오전+오후 = 어른`,
    s.half_split.am.adult_count + s.half_split.pm.adult_count === s.adult_count,
    `${s.half_split.am.adult_count}+${s.half_split.pm.adult_count} vs ${s.adult_count}`);
  check(`★ ${label}: 오전+오후 = 아이`,
    s.half_split.am.child_count + s.half_split.pm.child_count === s.child_count,
    `${s.half_split.am.child_count}+${s.half_split.pm.child_count} vs ${s.child_count}`);
}

out.push("[1] ★★ 한 자리에 점심 손님과 저녁 손님");
{
  // 사장님이 본 그 버그 그대로. 예전에는 합계가 4 였다.
  const s = S([order("7", 4, "am", "12:00:00"), order("7", 3, "pm", "18:00:00")]);
  check("★ 합계가 두 팀을 다 센다", s.guest_count === 7, String(s.guest_count));
  check("오전은 4명", s.half_split.am.guest_count === 4, String(s.half_split.am.guest_count));
  check("오후는 3명", s.half_split.pm.guest_count === 3, String(s.half_split.pm.guest_count));
  invariant(s, "점심+저녁");
}

out.push("\n[2] 한 팀이 같은 반나절에 여러 번 주문하면 한 번만 센다");
{
  const s = S([order("7", 4, "am", "12:00:00"), order("7", 4, "am", "12:40:00")]);
  check("★ 두 번 안 센다", s.guest_count === 4, String(s.guest_count));
  invariant(s, "재주문");
}

out.push("\n[3] 같은 반나절에 일행이 늘면 큰 쪽 하나");
{
  const s = S([order("7", 2, "am", "12:00:00"), order("7", 5, "am", "12:40:00")]);
  check("★ 큰 쪽만 센다", s.guest_count === 5, String(s.guest_count));
  invariant(s, "일행 합류");
}

out.push("\n[4] 자리마다 따로 센다");
{
  const s = S([order("7", 4, "am", "12:00:00"), order("9", 2, "am", "12:10:00")]);
  check("두 자리를 더한다", s.guest_count === 6, String(s.guest_count));
  invariant(s, "두 자리");
}

out.push("\n[5] ★ 앉은 시각(seating)이 있으면 그걸로 가른다");
{
  // 같은 자리, 같은 오후에 앞 팀이 나가고 새 팀이 앉은 경우. 반나절만으로는
  // 한 팀으로 눌리는데, seating 이 다르면 두 팀으로 센다.
  const a = order("7", 4, "pm", "17:00:00", { seating: "2026-09-10T08:50:00.000Z" });
  const b = order("7", 2, "pm", "19:30:00", { seating: "2026-09-10T11:20:00.000Z" });
  const s = S([a, b]);
  check("★ 앞 팀과 뒤 팀을 따로 센다", s.guest_count === 6, String(s.guest_count));
  check("오후도 따로 센다", s.half_split.pm.guest_count === 6, String(s.half_split.pm.guest_count));
  invariant(s, "연속 두 팀");
}

out.push("\n[6] ★ 같은 seating 이면 여러 번 주문해도 한 팀");
{
  const seat = "2026-09-10T08:50:00.000Z";
  const s = S([
    order("7", 4, "pm", "17:00:00", { seating: seat }),
    order("7", 4, "pm", "17:40:00", { seating: seat }),
    order("7", 4, "pm", "18:20:00", { seating: seat }),
  ]);
  check("★ 한 번만 센다", s.guest_count === 4, String(s.guest_count));
  invariant(s, "같은 seating");
}

out.push("\n[7] 표가 없는 옛 주문도 시각으로 갈라 센다");
{
  // service_period 가 없던 시절의 주문. 저녁 시작 시각으로 가른다.
  const s = S([order("7", 4, null, "12:00:00"), order("7", 3, null, "18:00:00")], EVE);
  check("★ 합계가 두 팀을 다 센다", s.guest_count === 7, String(s.guest_count));
  invariant(s, "옛 주문");
}

out.push("\n[8] 못 가르는 날은 합계에는 들어가되 두 몫에는 안 들어간다");
{
  // 경계를 지어내지 않는다 — 그 대신 화면이 "못 갈랐다"고 말한다.
  const s = S([order("7", 4, null, "12:00:00"), order("9", 3, null, "18:00:00")]);
  check("합계는 둘 다 센다", s.guest_count === 7, String(s.guest_count));
  check("오전은 비어 있다", s.half_split.am.guest_count === 0, String(s.half_split.am.guest_count));
  check("오후도 비어 있다", s.half_split.pm.guest_count === 0, String(s.half_split.pm.guest_count));
  check("★ 못 갈랐다고 말한다", s.half_split.unsplit_dates.includes(D), JSON.stringify(s.half_split.unsplit_dates));
}

out.push("\n[9] 어른·아이 합은 여전히 손님 수와 같다");
{
  const lunch = { ...order("7", 4, "am", "12:00:00"), party_adults: 2, party_children: 2 };
  const dinner = { ...order("7", 3, "pm", "18:00:00"), party_adults: 3, party_children: 0 };
  const s = S([lunch, dinner]);
  check("손님 7명", s.guest_count === 7, String(s.guest_count));
  check("★ 어른+아이 = 손님 수", s.adult_count + s.child_count === s.guest_count, `${s.adult_count}+${s.child_count}`);
  check("어른 5 · 아이 2", s.adult_count === 5 && s.child_count === 2, `${s.adult_count}/${s.child_count}`);
  invariant(s, "어른아이");
}

out.push("\n[10] ★ 회전 시간도 점심·저녁을 한 덩어리로 세지 않는다");
{
  // 예전에는 점심 첫 주문(12:00)부터 저녁 마지막 결제(19:00)까지를 한 팀이
  // 앉아 있던 시간으로 세서 420분이 나왔다. 화면의 「평균 337분」이 그것이다.
  const lunch = { ...order("7", 4, "am", "12:00:00"), updated_at: `${D} 13:00:00` };
  const dinner = { ...order("7", 3, "pm", "18:00:00"), updated_at: `${D} 19:00:00` };
  const s = S([lunch, dinner]);
  check("★ 점심 60분·저녁 60분의 평균", s.avg_turnover_minutes === 60, String(s.avg_turnover_minutes));
}

out.push("\n[11] 포장은 인원에 안 들어간다");
{
  const takeout = { id: ++seq, table_number: "포장", status: "paid", created_at: `${D} 12:00:00`, updated_at: `${D} 12:10:00`, total: 500, items: [], service_period: "am" };
  const s = S([order("7", 4, "am", "12:00:00"), takeout]);
  check("손님은 4명 그대로", s.guest_count === 4, String(s.guest_count));
  invariant(s, "포장");
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
