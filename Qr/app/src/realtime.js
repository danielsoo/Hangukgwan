// 주문 실시간 알림 (Pusher Channels) — 2026-09-07 사장님 피드백: "주문이
// 들어가고 빌지가 나오기까지 너무 오래 걸려" 원인 진단(admin.js의 2초/4초
// 폴링)에 이어, "폴링 없애기"를 원하셔서 추가.
//
// Vercel의 서버리스 함수는 지속 연결(WebSocket)을 직접 붙잡고 있을 수
// 없어서, 이 앱은 예전에 쓰던 Socket.IO 실시간 push를 버리고 폴링으로
// 바꾼 이력이 있다(admin.js의 startPolling() 주석 참고). Pusher Channels는
// 그 지속 연결을 대신 맡아주는 관리형 서비스라, Vercel은 그대로 두고 주문이
// 바뀔 때마다 이 모듈을 통해 "orders" 채널에 이벤트만 쏘면 된다.
//
// PUSHER_APP_ID / PUSHER_KEY / PUSHER_SECRET / PUSHER_CLUSTER 네 환경변수가
// 하나라도 비어 있으면 pusher는 null로 남고 broadcastOrdersChanged()는
// 조용히 아무 것도 안 한다 — 즉, Pusher 계정을 아직 만들지 않았거나 Vercel에
// 환경변수를 안 넣은 상태에서도 앱은 기존과 동일하게(폴링만으로) 정상
// 동작한다. 설정 방법은 claude/realtime-orders-setup.md 참고.
const Pusher = require("pusher");

let pusher = null;
if (process.env.PUSHER_APP_ID && process.env.PUSHER_KEY && process.env.PUSHER_SECRET && process.env.PUSHER_CLUSTER) {
  pusher = new Pusher({
    appId: process.env.PUSHER_APP_ID,
    key: process.env.PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER,
    useTLS: true,
  });
}

// 알림은 **응답보다 먼저** 나가고(아래 TRIGGER_TIMEOUT_MS 주석), 그래도
// 주문 처리를 실패시키지는 않는다. 실제 주문 데이터는 이미 save()로
// MongoDB에 안전하게 저장된 뒤에 호출되는 것뿐이라, Pusher 쪽 오류(키 오타,
// 일시적 장애 등)는 삼키고 그냥 응답한다. admin.js는 이 알림을 못 받아도
// 훨씬 느린 폴백 폴링으로 계속 새 주문을 찾아낸다.
// 이 변경을 일으킨 기기에게는 알림을 되돌려 보내지 않는다.
//
// 2026-09-10: 직원이 「조리 시작」을 누르면 그 기기가 요청을 세 번 보내고
// 있었다 — PATCH 한 번, 그 뒤에 스스로 부르는 loadOrders() 한 번, 그리고
// 서버가 쏜 이 알림을 자기도 받아서 loadOrders() 를 또 한 번. 세 번째는
// 두 번째와 같은 것을 가져오는 순수한 낭비다. 직원 태블릿이 세 대 열려
// 있으면 버튼 한 번에 주문 목록 전체가 네 번 오간다.
//
// Pusher 는 이걸 위한 기능을 갖고 있다: trigger 에 socket_id 를 주면 그
// 소켓 하나만 빼고 나머지 구독자에게 보낸다. 브라우저는 자기 소켓 번호를
// X-Socket-Id 헤더로 실어 보낸다(public/js/admin.js 의 fetch 감싸기).
// 다른 기기들은 지금까지와 똑같이 받는다 — 빠지는 건 "내가 방금 눌러서
// 이미 알고 있는" 기기 하나뿐이다.
//
// 소켓 번호가 없으면(Pusher 미연결, 손님 폰에서 들어온 주문, 헤더를 안
// 붙이는 옛 화면) 예전처럼 전원에게 보낸다.
const SOCKET_ID_RE = /^\d+\.\d+$/;

function socketIdFrom(req) {
  if (!req || typeof req.get !== "function") return null;
  const raw = req.get("x-socket-id");
  // Pusher 는 형식이 어긋난 socket_id 에 동기적으로 예외를 던진다. 주문
  // 처리가 헤더 하나 때문에 실패하면 안 되므로 형식을 먼저 본다.
  return raw && SOCKET_ID_RE.test(raw) ? raw : null;
}

// **응답을 보내기 전에 기다린다.**
//
// 2026-09-11 사장님: "새 주문이 들어오면 화면에 뜨기까지 한 6~7초 딜레이도
// 있고." 예전에는 trigger 를 던져만 놓고 곧바로 res.json() 을 했다. 보통
// 서버라면 그래도 되지만 **서버리스는 응답을 내보내는 순간 인스턴스를
// 얼린다** — 아직 안 끝난 Pusher 요청이 그대로 멈춰 서서, 다음 요청이
// 인스턴스를 깨울 때까지 알림이 안 나간다. 주방 화면이 몇 초씩 늦게 뜨는
// 모양이 딱 이것이다.
//
// 그래서 알림이 실제로 나간 것을 보고 응답한다. 대신 **주문이 Pusher 를
// 기다리다 실패하는 일은 없어야 한다** — 제한 시간을 두고, 넘으면 그냥
// 응답한다(알림은 늦게라도 나가거나 안 나가고, 화면은 폴백 폴링이 잡는다).
// 서울(함수) ↔ 도쿄(Pusher ap3) 왕복이라 평소에는 수십 ms 다.
const TRIGGER_TIMEOUT_MS = 800;

function withTimeout(promise) {
  return new Promise((resolve) => {
    // unref: 이 타이머 하나 때문에 테스트 프로세스가 안 끝나면 안 된다.
    const t = setTimeout(resolve, TRIGGER_TIMEOUT_MS);
    if (typeof t.unref === "function") t.unref();
    promise.then(
      () => { clearTimeout(t); resolve(); },
      (err) => {
        clearTimeout(t);
        console.error("[realtime] pusher trigger failed:", err && err.message);
        resolve();
      }
    );
  });
}

function push(channel, event, payload, socketId) {
  if (!pusher) return Promise.resolve();
  try {
    return withTimeout(
      pusher.trigger(channel, event, payload || {}, socketId ? { socket_id: socketId } : undefined)
    );
  } catch (e) {
    // 위 catch 는 비동기 실패용이다. trigger 자체가 동기적으로 던지는
    // 경우(형식 검사 등)까지 여기서 막아야 주문이 살아남는다.
    console.error("[realtime] pusher trigger threw:", e.message);
    return Promise.resolve();
  }
}

function broadcastOrdersChanged(req) {
  return push("orders", "changed", {}, socketIdFrom(req));
}

/**
 * 주문 말고 **나머지가 바뀌었다**를 알린다 — 인원수, 테이블, 메뉴, 구역.
 *
 * 사장님(2026-09-11): "현재 뭐가 바뀌거나 인원이 추가되거나 메뉴가
 * 추가되거나 그게 바로바로 반영이 안되고 새로고침을 해야 바뀌어있어."
 *
 * 그럴 만했다. 지금까지 화면이 주기적으로 다시 불러오는 것은 **주문뿐**
 * 이었다. 테이블(인원수)과 메뉴는 로그인할 때 한 번 불러오고 끝이라, 옆
 * 태블릿에서 인원을 고치거나 메뉴를 품절로 바꿔도 이 화면은 영영 몰랐다.
 *
 * `what` 은 「무엇을 다시 불러오면 되는가」다. 전부 다시 불러오게 하면
 * 인원수 하나 고칠 때마다 모든 기기가 메뉴 22KB 를 또 받는다.
 */
function broadcastDataChanged(req, what) {
  return push("orders", "data", { what }, socketIdFrom(req));
}

/**
 * 이 라우터에서 나가는 **모든 쓰기**에 알림을 붙인다.
 *
 * 라우트마다 한 줄씩 넣는 방법도 있지만, 그러면 다음에 새 라우트를 넣는
 * 사람이 빠뜨리고 그 한 자리만 조용히 「새로고침해야 보이는」 곳이 된다.
 * 길목에 한 번 걸어두면 빠뜨릴 자리가 없다.
 *
 * 응답 직전에 끼워 넣는 이유는 위 TRIGGER_TIMEOUT_MS 주석과 같다 —
 * 응답 뒤에 하면 서버리스가 얼어붙어 알림이 늦게 나간다.
 */
function broadcastOnWrite(what) {
  return function broadcastOnWriteMiddleware(req, res, next) {
    if (req.method === "GET" || req.method === "HEAD" || !pusher) return next();
    const sendJson = res.json.bind(res);
    res.json = function (body) {
      // 실패한 요청은 아무것도 안 바꿨다.
      // res.locals.skipBroadcast — 쓰기처럼 생겼지만 아무것도 안 바꾸는
      // 라우트가 스스로 빠지는 길 (예: POST /api/tables/:n/seat 은 손님
      // 폰에 쿠키 하나를 묶어줄 뿐이다. 손님이 QR 을 열 때마다 오므로,
      // 여기서 알림을 쏘면 손님 한 명이 앉을 때마다 매장 모든 태블릿이
      // 테이블 목록을 다시 받는다).
      if (res.statusCode >= 400 || (res.locals && res.locals.skipBroadcast)) return sendJson(body);
      broadcastDataChanged(req, what).then(() => sendJson(body));
      return res;
    };
    next();
  };
}


// 자리 하나에만 가는 채널 이름.
//
// 자리 이동 안내는 「그 자리에 앉아 있던 손님의 폰」 한 대에만 가면 된다.
// 모두가 듣는 "orders" 채널에 실으면 매장 안 모든 손님 폰이 남의 자리
// 이동과 주문 번호까지 받아보게 된다 — 쓸 데도 없고, 보낼 이유도 없다.
//
// Pusher 채널 이름에 쓸 수 있는 글자는 a-z A-Z 0-9 _ - = @ , . ; 뿐이다.
// 자리 번호는 사장님이 직접 붙이는 문자열이라(한글도, 공백도 들어갈 수
// 있다) 그대로 쓰면 조용히 실패한다. 안전한 글자만으로 된 번호는 그대로
// 두어 로그에서 알아보기 쉽게 하고, 나머지는 hex 로 바꾼다.
//
// 손님 화면은 이 이름을 스스로 만들지 않는다 — GET /api/tables/:n/party-size
// 가 내려주는 값을 그대로 구독한다. 같은 규칙을 서버와 브라우저 두 곳에
// 두면 한쪽만 고쳐졌을 때 안내가 영영 안 오는 쪽으로 어긋난다.
function channelForTable(number) {
  const n = String(number == null ? "" : number);
  if (/^[A-Za-z0-9_-]{1,80}$/.test(n)) return `table-${n}`;
  return `table-x${Buffer.from(n, "utf8").toString("hex")}`;
}

/**
 * 「이 자리 손님이 저쪽으로 옮겨졌다」를 그 자리 화면에 바로 알린다.
 *
 * 2026-09-10 사장님: "60초마다 갱신하는 게 아니라 그 이벤트가 발생하면
 * 그걸 인지하고 작동하는 방식으로 하면 되는 거 아니야?"
 *
 * 맞다. 직원이 자리 이동을 누르는 그 순간 손님 폰은 이미 그 화면을 켜둔
 * 채 앉아 있다. 폰이 주기적으로 물어보게 하는 대신 여기서 밀어준다.
 *
 * broadcastOrdersChanged 와 같은 이유로 fire-and-forget 이다 — 이동 자체는
 * 이미 저장이 끝났고, Pusher 가 안 될 때(계정 미설정 포함) 이동이 실패하면
 * 안 된다. 그 경우 손님 폰은 예전처럼 화면을 다시 켤 때·주문을 넣기 전에
 * 한 번씩 물어보는 쪽으로 알아낸다(public/js/order.js).
 */
function broadcastTableMoved(from, payload) {
  return push(channelForTable(from), "moved", payload || {}, null);
}

module.exports = {
  broadcastOrdersChanged,
  broadcastDataChanged,
  broadcastOnWrite,
  broadcastTableMoved,
  channelForTable,
  socketIdFrom,
};
