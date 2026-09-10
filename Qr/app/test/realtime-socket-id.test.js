// 자기가 누른 변경을 자기가 다시 받아오던 것 (2026-09-10)
//
// 사장님: "주문 → 조리중 → 서빙완료 버튼 5~20초." 주된 원인은 리전이었지만
// (claude/2026-09-10-mongo-region.md), 그 위에 이것이 얹혀 있었다 — 버튼
// 한 번에 누른 기기가 요청을 세 번 보냈다. PATCH 하나, 그 뒤의
// loadOrders() 하나, 그리고 서버가 쏜 Pusher "changed" 를 자기도 받아서
// loadOrders() 를 또 하나.
//
// 이 테스트가 재는 것은 "세 번째가 안 나가는가" 다. 브라우저가 자기 소켓
// 번호를 헤더로 보내고, 서버가 그 소켓만 빼고 알림을 쏘는지.
//
// 형식 검사가 있는 이유가 더 중요하다: Pusher 는 어긋난 socket_id 에
// 동기적으로 예외를 던진다. 헤더 하나 때문에 주문 저장이 실패하면 그건
// 느린 것보다 훨씬 나쁘다.
process.env.PUSHER_APP_ID = "test-app";
process.env.PUSHER_KEY = "test-key";
process.env.PUSHER_SECRET = "test-secret";
process.env.PUSHER_CLUSTER = "ap3";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

// pusher 를 가짜로 바꿔치기한다 — 실제로 쏘지 않고, 무엇을 어떤 인자로
// 불렀는지만 기록한다.
const calls = [];
let throwOnTrigger = false;
class FakePusher {
  constructor(cfg) {
    this.cfg = cfg;
  }
  trigger(channel, event, data, params) {
    calls.push({ channel, event, data, params });
    if (throwOnTrigger) throw new Error("Invalid socket id");
    return Promise.resolve();
  }
}
require.cache[require.resolve("pusher")] = {
  id: require.resolve("pusher"),
  filename: require.resolve("pusher"),
  loaded: true,
  exports: FakePusher,
};

const { broadcastOrdersChanged, socketIdFrom } = require("../src/realtime");

const out = [];
let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    passed++;
    out.push(`  ok   ${name}`);
  } else {
    failed++;
    out.push(`  FAIL ${name}${detail ? "  " + detail : ""}`);
  }
}
function reqWith(headerValue) {
  return { get: (k) => (k.toLowerCase() === "x-socket-id" ? headerValue : undefined) };
}

out.push("[1] socketIdFrom — Pusher 가 받는 형식만 통과시킨다");
check("정상 소켓 번호", socketIdFrom(reqWith("123456.7890123")) === "123456.7890123");
check("req 자체가 없으면 null", socketIdFrom(undefined) === null);
check("get 이 없는 객체면 null", socketIdFrom({}) === null);
check("헤더가 없으면 null", socketIdFrom(reqWith(undefined)) === null);
check("빈 문자열이면 null", socketIdFrom(reqWith("")) === null);
check("점이 없으면 null", socketIdFrom(reqWith("1234567890")) === null);
check("글자가 섞이면 null", socketIdFrom(reqWith("abc.def")) === null);
check("앞뒤에 뭐가 붙으면 null", socketIdFrom(reqWith(" 123.456 ")) === null);
check("여러 줄이면 null (헤더 주입)", socketIdFrom(reqWith("123.456\n789.012")) === null);

out.push("\n[2] 누른 기기 하나만 빼고 나머지에게 쏜다");
calls.length = 0;
broadcastOrdersChanged(reqWith("123456.7890123"));
check("한 번 쏜다", calls.length === 1, JSON.stringify(calls));
check("orders 채널의 changed", calls[0] && calls[0].channel === "orders" && calls[0].event === "changed");
check(
  "그 소켓을 제외한다",
  calls[0] && calls[0].params && calls[0].params.socket_id === "123456.7890123",
  JSON.stringify(calls[0] && calls[0].params)
);

out.push("\n[3] 소켓 번호가 없으면 예전처럼 전원에게");
calls.length = 0;
broadcastOrdersChanged(reqWith(undefined));
check("그래도 쏜다", calls.length === 1);
check("제외 대상 없음", calls[0] && calls[0].params === undefined, JSON.stringify(calls[0] && calls[0].params));

calls.length = 0;
broadcastOrdersChanged();
check("req 없이 불러도 쏜다 (손님 주문 등)", calls.length === 1 && calls[0].params === undefined);

out.push("\n[4] 알림이 실패해도 주문은 살아남는다");
calls.length = 0;
throwOnTrigger = true;
let threw = false;
try {
  broadcastOrdersChanged(reqWith("123456.7890123"));
} catch (e) {
  threw = true;
}
throwOnTrigger = false;
check("trigger 가 동기적으로 던져도 밖으로 새지 않는다", !threw);

out.push("\n[5] 라우트가 req 를 넘기지 않으면 위의 모든 것이 무의미하다");
const ordersSrc = fs.readFileSync(path.join(__dirname, "../src/routes/orders.js"), "utf8");
const withReq = (ordersSrc.match(/broadcastOrdersChanged\(req\)/g) || []).length;
const withoutReq = (ordersSrc.match(/broadcastOrdersChanged\(\s*\)/g) || []).length;
check(`호출부가 전부 req 를 넘긴다 (${withReq}곳)`, withReq >= 6, `req 없이 부르는 곳 ${withoutReq}`);
check("req 없이 부르는 곳이 없다", withoutReq === 0);

out.push("\n[6] 브라우저가 헤더를 붙인다 — /api 로 나가는 것에만");
const adminSrc = fs.readFileSync(path.join(__dirname, "../public/js/admin.js"), "utf8");
check("fetch 를 감싼다", /window\.fetch\s*=\s*function/.test(adminSrc));
check("X-Socket-Id 를 넣는다", /headers\.set\("X-Socket-Id"/.test(adminSrc));
check("소켓 번호를 Pusher 연결에서 읽는다", /pusherClient\.connection\.socket_id/.test(adminSrc));
check('/api 가 아니면 손대지 않는다', /url\.startsWith\("\/api\/"\)/.test(adminSrc));
check("감싸기 전의 fetch 를 보관한다", /const nativeFetch = window\.fetch\.bind\(window\)/.test(adminSrc));

out.push("\n[7] 알림을 뺐으면 화면은 스스로 갱신해야 한다");
// 이 절이 이 파일에서 제일 중요하다. 누른 기기에게 알림을 안 보내기로 한
// 순간, "요청만 던져놓고 서버가 되쏘는 알림을 기다려 화면을 고치던" 자리는
// 전부 아무 일도 안 하는 버튼이 된다. 실제로 「조리 시작」과 「취소」가
// 그랬다 — 알림 제외를 넣은 커밋에서 잡지 못하고 넘어갈 뻔했다.
check("「다음 단계」 버튼이 응답으로 직접 갱신한다", /const updated = await updateOrderStatus\(o\.id, NEXT_STATUS\[o\.status\]\);\s*\n\s*if \(!applyOrderUpdate\(updated\)\) await loadOrders\(\);/.test(adminSrc));
check("「취소」 버튼이 응답으로 직접 갱신한다", /const updated = await updateOrderStatus\(o\.id, "cancelled"\);\s*\n\s*if \(!applyOrderUpdate\(updated\)\) await loadOrders\(\);/.test(adminSrc));
check("드래그로 칼럼을 옮겨도 응답으로 갱신한다", /applyOrderUpdate\(updated\); \/\/ 서버가 돌려준 그 한 건만/.test(adminSrc));
check("테이블 상세의 단계/결제 버튼도 마찬가지", /applied = applyOrderUpdate\(await updateOrderStatus\(orderId, toStatus\)\)/.test(adminSrc));

// 결과를 버리는 호출이 남아 있으면 그 자리는 알림에 매달려 있을 가능성이
// 높다. 지금 허용되는 것은 두 가지뿐이다.
const bareCalls = (adminSrc.match(/^\s*updateOrderStatus\(/gm) || []).length;
check(
  "결과를 안 쓰는 호출은 한 곳뿐 (markPrintSucceededAndAdvance — 스스로 renderOrders 한다)",
  bareCalls === 1,
  `${bareCalls}곳`
);
check(
  "그 한 곳은 로컬 상태를 고치고 다시 그린다",
  /o\.status = "preparing";\s*\n\s*updateOrderStatus\(o\.id, "preparing"\);\s*\n\s*renderOrders\(\);/.test(adminSrc)
);

out.push("\n[8] 칼럼 정렬 규칙이 서버와 같아야 한다");
// applyOrderUpdate 는 "배열의 어느 자리에 넣어도 화면은 같다"에 기대고 있다.
// 그 전제는 renderOrders 가 서버와 **같은 규칙**으로 칼럼을 정렬할 때만
// 참이다. 두 곳이 조용히 갈라지면 카드가 엉뚱한 자리에 서고, 원인을 찾기
// 어렵다. 그래서 규칙을 이루는 줄들을 양쪽에서 직접 대조한다.
const RULE = [
  "const aHas = a.queue_order != null;",
  "const bHas = b.queue_order != null;",
  "if (aHas && bHas) return a.queue_order - b.queue_order;",
  "if (aHas !== bHas) return aHas ? -1 : 1;",
  "return b.id - a.id;",
];
const serverSort = ordersSrc.replace(/\s+/g, " ");
const clientSort = adminSrc.replace(/\s+/g, " ");
RULE.forEach((line) => {
  const needle = line.replace(/\s+/g, " ");
  check(`서버·화면 양쪽에 같은 줄: ${line}`, serverSort.includes(needle) && clientSort.includes(needle));
});
check("renderOrders 가 세 칼럼을 정렬한다", /cols\.new = sortWithinColumn\(cols\.new\);/.test(adminSrc) && /cols\.preparing = sortWithinColumn\(cols\.preparing\);/.test(adminSrc) && /cols\.served = sortWithinColumn\(cols\.served\);/.test(adminSrc));
check("정렬은 복사본에 한다 (orders 배열 자체를 흔들지 않게)", /return list\.slice\(\)\.sort/.test(adminSrc));

console.log(out.join("\n"));
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
