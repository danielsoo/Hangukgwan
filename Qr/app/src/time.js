// Centralized Taiwan-time helpers. Vercel (and most serverless hosts) run
// the process clock in UTC by default, with no TZ env var set — before this
// module existed, order timestamps were generated from the *host's* local
// time (see the old nowLocal() in orders.js), which silently meant every
// order/kitchen-ticket time shown to customers and staff was actually UTC,
// several hours off from real Taipei wall-clock time. Every timestamp and
// "which business day does this belong to" decision in the app should go
// through here instead of `new Date()` directly, so it's correct regardless
// of what timezone the server process itself happens to be running in.
const TZ = "Asia/Taipei";

// 형식기를 **한 번만** 만든다.
//
// 2026-09-14, 이 줄 하나가 비싼 것을 실측으로 알았다. 매 호출마다
// Intl.DateTimeFormat 을 새로 만들고 있었는데,
//
//     첫 호출        388ms   ← ICU 데이터를 그때 읽는다. 콜드 스타트마다
//     그 뒤 한 번      4.7ms  ← 만드는 값이 매번 든다
//
// 4.7ms 는 혼자 보면 작지만 이 함수는 아주 자주 불린다. 주문 하나하나에
// 시각을 박고(src/servicePeriod.js), 결산은 주문마다 날짜를 가른다. 100건
// 결산이면 그것만으로 0.5초가 몽고와 아무 상관없이 CPU 에서 사라진다.
//
// 형식기는 **상태가 없다.** 같은 설정으로 만든 것을 계속 다시 쓰면 된다.
// 찾은 계기는 엉뚱했다 — store-read-parallel 시험이 "두 읽기가 나란히
// 안 간다"고 했는데, 실제로는 첫 호출의 388ms 가 두 읽기 사이에 끼어
// 이벤트 루프를 붙잡고 있었다. 시험이 느린 것을 잡은 게 맞았다.
let FORMATTER = null;
function formatter() {
  if (!FORMATTER) {
    FORMATTER = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }
  return FORMATTER;
}

function taipeiParts(d = new Date()) {
  const parts = formatter().formatToParts(d);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  if (map.hour === "24") map.hour = "00"; // some ICU implementations emit "24:00" for midnight
  return map;
}

// "YYYY-MM-DD HH:MM:SS" in Taipei time — same string format the rest of the
// app already expects for order created_at/updated_at.
function nowLocal(d = new Date()) {
  const p = taipeiParts(d);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

// "YYYY-MM-DD" business-day string in Taipei time.
function taipeiDateString(d = new Date()) {
  const p = taipeiParts(d);
  return `${p.year}-${p.month}-${p.day}`;
}

// 뜰 때 미리 한 번 만들어 둔다. ICU 데이터를 읽는 값(수십~수백 ms)은 어차피
// 한 번은 내야 하는데, 그것이 **요청 한가운데**에서 나면 그 순간 이벤트
// 루프가 멈춘다. 나란히 보낸 두 읽기가 그 사이에 갈라지는 것을 실제로 봤다.
// 모듈을 읽는 자리로 옮기면 같은 값을 내고도 요청의 결정 경로에서 빠진다.
formatter();

module.exports = { nowLocal, taipeiDateString };
