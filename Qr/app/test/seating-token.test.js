// 앞 손님 세션이 다음 손님 자리에 섞이지 않게.
//
// 사장님(2026-09-10): "위치 기능을 넣은 건 risk 가 있어서 그래. 주문이 다른
// 곳에서 들어오거나 이미 손님이 있는데 악의적으로 들어와서 다른 걸 주문 할
// 수 있어서 그런거야. 그럼 gps 빼고 qr 코드 매 새 손님마다 새 토큰을 주면?"
//
// ── 이것이 막는 것과 못 막는 것 ───────────────────────────────────────
//
// 벽의 QR 은 누구나 가져갈 수 있는 열쇠다. /t/9 를 열면 토큰을 준다면 사진을
// 찍어둔 사람이 열어도 똑같이 받는다. 그러니 가게 밖 사람을 막는 자물쇠가
// 아니다 — 그건 그 자리에 있어야만 알 수 있는 것이 있어야 하고, 사장님이
// 손님 불편을 이유로 그건 안 하기로 하셨다.
//
// 막는 것은 하나다: **다른 착석에 묶여 있는 기기.** 앞 손님이 쓰던 폰,
// 며칠 전에 열어둔 채 살아 있는 페이지.
//
// ── 처음 보는 기기는 막지 않는다 ──────────────────────────────────────
//
// 오늘 낮에 위치 확인으로 같은 실수를 했다 — 「멀리 있다」와 「확인을 못
// 했다」를 묶어서 앉아 계신 손님을 돌려보냈다. 여기서도 확인이 안 되는 것을
// 위반으로 세지 않는다. 아래 [3]이 그걸 정면으로 잰다.
const seating = require("../src/seating");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}
const dev = () => ({ session: {} });
const T = (over) => Object.assign({ number: "7", party_size: 2, party_size_updated_at: "2026-09-10T10:00:00.000Z" }, over);

out.push("[1] 착석 식별자");
{
  check("앉아 계시면 그 시각이 착석이다", seating.seatingOf(T()) === "2026-09-10T10:00:00.000Z", "");
  check("아무도 안 앉았으면 없다", seating.seatingOf(T({ party_size_updated_at: null })) === null, "");
  check("★ 포장 카운터는 착석이라는 말이 성립하지 않는다", seating.seatingOf(T({ is_counter: true })) === null, "");
}

out.push("\n[2] 앞 손님 세션은 걸린다");
{
  const table = T();
  const phone = dev();
  seating.bind(phone, "7", seating.seatingOf(table));
  check("지금 손님의 폰은 통과한다", seating.isStale(phone, table) === false, "");

  // 결제가 끝나고 새 손님이 앉았다 — 착석이 새로 찍힌다
  const next = T({ party_size_updated_at: "2026-09-10T12:30:00.000Z" });
  check("★ 앞 손님 폰은 다음 손님 자리에 못 넣는다", seating.isStale(phone, next) === true, "");

  // ★ 화면을 다시 열어도 풀리지 않는다.
  //
  // 사장님(2026-09-10): "결제를 하는 순간 그 토큰은 지워지는 거니까 다시
  // 들어가도 접속을 못하게 해야지."
  //
  // 처음 구현은 여기서 갈아탔다. 그러면 묶어둔 것이 아무 의미가 없다 —
  // 잠근 문 옆에 열쇠를 걸어두는 셈이다.
  seating.bind(phone, "7", seating.seatingOf(next));
  check("★ 다시 열어도 갈아타지지 않는다", seating.isStale(phone, next) === true, "");
}

out.push("\n[2-1] 그래도 영영 막지는 않는다");
{
  // 안 잊으면 다음에 진짜로 다시 오신 손님이 못 들어온다 — 같은 폰, 같은
  // 자리, 옛 착석에 묶인 채로.
  const table = T({ party_size_updated_at: "2026-09-11T18:00:00.000Z" });
  const old = { session: { seat: { 7: { id: "2026-09-10T10:00:00.000Z", at: Date.now() - seating.BINDING_TTL_MS - 1000 } } } };
  check("★ 오래된 기록은 잊는다", seating.boundTo(old, "7") === null, "");
  check("★ 다음에 다시 오시면 통과한다", seating.isStale(old, table) === false, "");

  const fresh = { session: { seat: { 7: { id: "2026-09-10T10:00:00.000Z", at: Date.now() } } } };
  check("아직 같은 장사 안이면 그대로 막는다", seating.isStale(fresh, table) === true, "");
}

out.push("\n[2-2] 인원수를 답하는 길로는 들어올 수 있다");
{
  // 결제를 마치고 「더 시킬게요」 하는 손님이 이 길로 다시 들어온다.
  // 그때 그 폰은 방금 끝난 착석에 묶여 있다.
  const phone = dev();
  seating.bind(phone, "7", "2026-09-10T10:00:00.000Z");
  check("빈 자리는 애초에 가릴 것이 없다", seating.isStale(phone, T({ party_size_updated_at: null })) === false, "");
  seating.bind(phone, "7", "2026-09-10T13:00:00.000Z", { force: true });
  check("★ 인원수를 답하면 새 착석으로 묶인다", seating.boundTo(phone, "7") === "2026-09-10T13:00:00.000Z", "");
}

out.push("\n[3] ★★ 처음 보는 기기는 막지 않는다");
{
  // 오늘 낮 위치 확인과 같은 실수를 반복하지 않는다. 확인이 안 되는 것은
  // 위반이 아니다 — 방금 앉아 QR 을 처음 찍은 손님이 여기 걸린다.
  check("★ 아무 데도 안 묶인 기기는 통과한다", seating.isStale(dev(), T()) === false, "");
  check("★ 다른 자리에만 묶인 기기도 이 자리는 처음이다", (() => {
    const d = dev();
    seating.bind(d, "9", "2026-09-10T10:00:00.000Z");
    return seating.isStale(d, T()) === false;
  })(), "");
  check("아무도 안 앉은 자리는 애초에 가릴 것이 없다", (() => {
    const d = dev();
    seating.bind(d, "7", "2026-09-09T10:00:00.000Z");
    return seating.isStale(d, T({ party_size_updated_at: null })) === false;
  })(), "");
}

out.push("\n[4] 자리마다 따로 센다");
{
  const d = dev();
  seating.bind(d, "7", "2026-09-10T10:00:00.000Z");
  check("7번에 묶여 있다", seating.boundTo(d, "7") === "2026-09-10T10:00:00.000Z", "");
  check("9번은 아직 아니다", seating.boundTo(d, "9") === null, "");
  check("숫자로 넣어도 같은 자리로 본다", seating.boundTo({ session: { seat: { 7: "x" } } }, 7) === "x", "");
}

out.push("\n[4-1] 서버가 인원수 바꾸기도 같이 막는다");
{
  // 여기를 안 막으면 착석 토큰이 통째로 무의미해진다 — 앞 손님 폰이 인원수를
  // 다시 답하는 것만으로 지금 착석을 자기 것으로 가져가고, 그 순간부터
  // 주문도 된다. 게다가 앉아 계신 분들의 인원수가 조용히 덮어써진다.
  const fs = require("fs");
  const path = require("path");
  const tables = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "tables.js"), "utf8");
  const put = tables.slice(tables.indexOf('router.put("/:tableNumber/party-size"'));
  check("★ 살아 있는 다른 착석의 인원수는 못 바꾼다", /seating\.isStale\(req, table\)[\s\S]{0,120}seating_stale/.test(put), "");
  check("직원은 지나간다", /const isStaff = !!\(req\.session && req\.session\.isAdmin\);[\s\S]{0,160}isStale/.test(put), "");
  check("인원수를 답한 기기는 force 로 묶는다", /seating\.bind\(req, table\.number, seating\.seatingOf\(table\), \{ force: true \}\)/.test(put), "");
}

out.push("\n[5] 세션이 없는 요청에도 터지지 않는다");
{
  check("세션 없이 묶어도 조용히 넘어간다", (() => { seating.bind({}, "7", "x"); return true; })(), "");
  check("세션 없는 요청은 처음 보는 기기다", seating.isStale({}, T()) === false, "");
}

out.push("\n[6] 떠 있는 페이지가 스스로 통과권을 받아가지 않는다");
{
  // 처음 구현은 bindSeat 을 refreshTableState(주기적으로 도는 함수) 안에서
  // 불렀다. 그러면 앞 손님이 열어둔 채 떠 있는 페이지가 다음 폴링 때 새
  // 착석으로 다시 묶인다 — 막으려던 그 페이지가 스스로 통과권을 받아간다.
  // 사장님이 「이건 누구한테 띄운다는거야」라고 물으신 덕분에 드러났다.
  //
  // 새로 여는 것은 손님이 QR 을 찍는 순간이고, 그때는 그 자리에 있다.
  // 떠 있는 페이지는 새로 열지 않는다 — 그 둘의 차이가 이 기능의 전부다.
  const fs = require("fs");
  const path = require("path");
  const orderJs = fs.readFileSync(path.join(__dirname, "..", "public", "js", "order.js"), "utf8");
  const refresh = orderJs.slice(orderJs.indexOf("async function refreshTableState()"));
  const body = refresh.slice(0, refresh.indexOf("\n  }"));
  check("★ 주기적으로 도는 갱신에서는 다시 묶지 않는다", !/bindSeat\(\)/.test(body), "");
  check("★ 화면을 새로 열 때 한 번 묶는다", /\n  bindSeat\(\);\n/.test(orderJs), "");
  check("묶는 요청은 한 곳에서만 나간다", (orderJs.match(/bindSeat\(\);/g) || []).length === 1, "");
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
