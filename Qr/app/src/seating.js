// 「지금 이 자리에 앉아 계신 손님」을 가리는 표.
//
// 사장님(2026-09-10): "위치 기능을 넣은 건 risk 가 있어서 그래. 주문이 다른
// 곳에서 들어오거나 이미 손님이 있는데 악의적으로 들어와서 다른 걸 주문
// 할 수 있어서 그런거야. 그럼 gps 빼고 qr 코드 매 새 손님마다 새 토큰을
// 주면? 그럼 qr코드 다시 안 뽑고도 가능한 거잖아 리다이렉트로."
//
// ── 이 파일이 하는 것과 못 하는 것 ────────────────────────────────────
//
// 벽에 붙은 QR 은 누구나 가져갈 수 있는 열쇠다. /t/9 를 열면 토큰을 준다면,
// 사진을 찍어둔 사람이 열어도 똑같이 받는다. 그러니 이것은 「가게 밖 사람을
// 막는 자물쇠」가 아니다. 그건 그 자리에 있어야만 알 수 있는 것(좌석 PIN
// 같은)이 있어야 되고, 사장님이 손님 불편을 이유로 그건 안 하기로 하셨다.
//
// 이것이 실제로 하는 일:
//   · 앞 손님 세션으로 다음 손님 자리에 주문이 섞이는 것을 막는다
//   · 며칠 전에 열어둔 채 살아 있는 페이지를 죽인다
//   · 주문마다 「어느 착석의 것인가」가 남는다 — 나중에 따질 근거가 된다
//
// ── 착석 식별자를 새로 만들지 않는다 ──────────────────────────────────
//
// table.party_size_updated_at 이 이미 그 일을 하고 있다. 손님이 앉아 인원을
// 답할 때 찍히고, 자리를 옮기면 따라가고(movePartySize), 결제가 끝나면
// 비워진다(clearPartySizeIfSettled). 착석 하나에 값 하나가 정확히 대응한다.
// 여기에 랜덤 id 를 하나 더 만들면 두 값이 어긋날 자리만 생긴다.
//
// 손님 폰은 이 값을 보내지 않는다 — 서버가 세션에 적어 둔다. 그래서 값을
// 알아낸다고 흉내낼 수 있는 것이 아니다.

/** 이 자리의 지금 착석. 아직 아무도 안 앉았으면 null. */
function seatingOf(table) {
  if (!table || table.is_counter) return null;
  return table.party_size_updated_at || null;
}

// 묶어둔 기록은 이만큼 지나면 잊는다.
//
// 안 잊으면 다음에 진짜로 다시 오신 손님이 영영 못 들어온다 — 같은 폰,
// 같은 자리, 그런데 옛 착석에 묶인 채로 남아 있으니까. 한 번의 장사보다
// 넉넉하고 다음 날까지는 안 가는 길이로 잡는다.
const BINDING_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * 이 요청을 보낸 기기를 지금 착석에 묶는다.
 *
 * **이미 다른 착석에 묶여 있으면 덮어쓰지 않는다.** 이게 이 기능의 전부다.
 *
 * 사장님(2026-09-10): "결제를 하는 순간 그 토큰은 지워지는 거니까 다시
 * 들어가도 접속을 못하게 해야지."
 *
 * 덮어쓰게 두면 앞 손님이 화면을 다시 열기만 해도 지금 착석으로 갈아탄다.
 * 그러면 묶어둔 것이 아무 의미가 없다 — 잠근 문 옆에 열쇠를 걸어두는 셈이다.
 *
 * force 는 인원수를 답하는 순간에만 쓴다(PUT /party-size). 그건 그 자리에
 * 앉아서 하는 일이고, 결제하고 나서 「더 시킬게요」 하는 손님이 정확히
 * 이 길로 다시 들어온다. 대신 그 자리에 이미 다른 착석이 살아 있으면
 * 부르는 쪽에서 먼저 막는다(isStale).
 */
function bind(req, tableNumber, seating, opts) {
  if (!req || !req.session || !seating) return;
  if (!req.session.seat) req.session.seat = {};
  const key = String(tableNumber);
  const cur = req.session.seat[key];
  if (!(opts && opts.force) && cur && cur.id && cur.id !== seating && !expired(cur)) return;
  req.session.seat[key] = { id: seating, at: Date.now() };
}

function expired(entry) {
  if (!entry || !entry.at) return true;
  return Date.now() - entry.at > BINDING_TTL_MS;
}

/** 이 기기가 묶여 있는 착석. 없거나 오래됐으면 null. */
function boundTo(req, tableNumber) {
  const m = req && req.session && req.session.seat;
  const entry = m && m[String(tableNumber)];
  if (!entry) return null;
  // 예전 형식(문자열)으로 남아 있는 것도 읽는다 — 배포 직후 이미 열려 있던
  // 손님 화면이 이 모양이다.
  if (typeof entry === "string") return entry;
  return expired(entry) ? null : entry.id || null;
}

/**
 * 이 기기가 지금 이 자리에 주문할 수 있는가.
 *
 * 「아니오」로 돌려주는 경우를 최대한 좁게 둔다. 오늘 낮에 위치 확인으로
 * 앉아 계신 손님을 돌려보낸 일이 있었다(claude/2026-09-10-location-gate.md).
 * 확인이 안 된다고 막으면 잃는 게 훨씬 크다.
 *
 *   · 포장 카운터 — 자리가 아니다. 착석이라는 말이 성립하지 않는다
 *   · 아직 아무도 안 앉은 자리 — 가릴 착석이 없다. 인원수를 먼저 묻는
 *     기존 규칙이 그대로 문지기다
 *   · **처음 보는 기기** — 막지 않는다. 아래 참고
 *   · 직원·테스트 기기 — 부르는 쪽에서 먼저 걸러낸다
 *
 * 처음 보는 기기를 막지 않는 이유:
 *
 * 그 기기는 「앞 손님 것」이 아니라 「아직 모르는 것」이다. 둘은 다르다.
 * 막아버리면 방금 자리에 앉아 QR 을 처음 찍은 손님이 걸린다 — 화면이
 * 자리 상태를 받아오기 전에 빠르게 주문하는 경우, 직원이 인원수를 대신
 * 넣어준 자리에 손님이 뒤늦게 들어오는 경우처럼.
 *
 * 오늘 낮에 위치 확인으로 똑같은 실수를 했다. 「멀리 있다」와 「확인을 못
 * 했다」를 한 덩어리로 묶어서 앉아 계신 손님을 돌려보냈다
 * (claude/2026-09-10-location-gate.md). 여기서도 같다 — 확인이 안 되는
 * 것을 위반으로 세지 않는다.
 *
 * 막는 것은 「다른 착석에 묶여 있는 기기」 하나다. 그게 정확히 앞 손님
 * 세션이고, 이 기능이 원래 잡으려던 것이다.
 */
function isStale(req, table) {
  const seating = seatingOf(table);
  if (!seating) return false;
  const bound = boundTo(req, table.number);
  if (!bound) return false;
  return bound !== seating;
}

module.exports = { seatingOf, bind, boundTo, isStale, BINDING_TTL_MS };
