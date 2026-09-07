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

// Fire-and-forget, on purpose: 실제 주문 데이터는 이미 save()로 MongoDB에
// 안전하게 저장된 뒤에 호출되는 것뿐이라, Pusher 쪽 오류(키 오타, 일시적
// 장애 등)가 주문 처리 자체를 실패시키면 안 된다. admin.js는 이 알림을
// 못 받아도 훨씬 느린 폴백 폴링(realtime 미설정 시와 동일한 주기)으로
// 계속 새 주문을 찾아낸다.
function broadcastOrdersChanged() {
  if (!pusher) return;
  pusher.trigger("orders", "changed", {}).catch((err) => {
    console.error("[realtime] pusher trigger failed:", err.message);
  });
}

module.exports = { broadcastOrdersChanged };
