// 로그인 한 번에 요청 열세 개가 나가고 있었다.
//
// 2026-09-12 사장님: "로그인도 그렇고 버튼 누르는 것도 그렇고 다" 느리다.
//
// 관리자 화면이 뜰 때 admin.js 의 checkAuth() 가 부르는 것들이다 —
// /api/auth/me, /api/orders, /api/menu/admin, /api/tables, /api/settings,
// /api/settings/ticket-print, /api/settings/move-slip, /api/test-mode,
// /api/vip-cards/sale-settings, 그리고 사장이면 staff-permissions, line,
// payment, escpos 까지.
//
// 이 열세 개가 각각 무엇을 하느냐가 핵심이다. **거의 아무것도 안 한다.**
// 전부 동기 함수라 자기 몫의 데이터베이스 질의가 하나도 없다. 그냥 방금
// 읽어온 store 에서 자기 칸을 꺼내 돌려줄 뿐이다.
//
// 그런데 값은 요청마다 따로 치른다. 요청 하나가 서버에 닿으면
//   1. refreshStore() — store 문서 + 최근 주문을 읽는다
//   2. 세션 조회 — 쿠키의 번호로 로그인 상태를 읽는다
// 이 둘을 반드시 거친다(server.js 의 미들웨어). 열세 번이면 스물여섯 번이다.
// **똑같은 문서 하나를 열세 번 다시 읽는다.**
//
// 그래서 한 번에 답한다. 여기서 새로 만드는 것은 아무것도 없다 — 각 칸을
// 만드는 코드는 지금 그 주소를 서비스하는 바로 그 핸들러이고, 아래
// runRoute() 가 그것들을 이 요청 안에서 그대로 돌린다. 베껴 쓰면 한쪽만
// 고쳐져서 조용히 어긋난다.
//
// 실패하면 아무 일도 안 일어난다. 화면은 이 응답에서 못 받은 주소를 예전처럼
// 하나씩 부른다(public/js/admin.js 의 bootCache). 그래서 이 파일이 통째로
// 잘못돼도 가게는 멈추지 않는다.
const express = require("express");
const { isAdminRole } = require("../accounts");

const router = express.Router();

/**
 * 이미 들어온 요청 안에서 다른 GET 라우트를 그대로 돌려 그 응답만 받아온다.
 *
 * 라우터는 그냥 (req, res, next) 함수다. 그래서 주소만 바꾼 요청 하나를
 * 만들어 넘기면, 그 주소를 평소에 처리하는 코드가 평소대로 돈다 — 권한
 * 검사까지 포함해서. req 를 상속(Object.create)으로 만드는 이유는 세션과
 * 쿠키는 그대로 쓰되, 라우터가 붙이는 params 같은 것이 바깥 요청을 더럽히지
 * 않게 하기 위해서다.
 */
function runRoute(router, req, url) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (status, body) => {
      if (done) return;
      done = true;
      resolve({ status, body });
    };
    const sub = Object.create(req);
    sub.url = url;
    sub.originalUrl = url;
    sub.baseUrl = "";
    sub.path = url;
    sub.method = "GET";
    sub.query = {};
    sub.params = {};
    const res = {
      locals: {},
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      set() { return this; },
      setHeader() { return this; },
      type() { return this; },
      json(body) { finish(this.statusCode, body); return this; },
      send(body) { finish(this.statusCode, body); return this; },
      end() { finish(this.statusCode, null); return this; },
    };
    try {
      router(sub, res, () => finish(404, null));
    } catch (e) {
      finish(500, null);
    }
  });
}

// 화면이 부르는 주소 그대로를 열쇠로 쓴다. 브라우저 쪽에서 "이 주소는 이미
// 받아뒀다"로 바로 이어지므로, 부르는 곳 열세 군데를 하나도 안 고쳐도 된다.
const ALWAYS = [
  ["/api/auth/me", "../routes/auth", "/me"],
  ["/api/orders", "../routes/orders", "/"],
  ["/api/menu/admin", "../routes/menu", "/admin"],
  ["/api/tables", "../routes/tables", "/"],
  ["/api/settings", "../routes/settings", "/"],
  ["/api/settings/ticket-print", "../routes/settings", "/ticket-print"],
  ["/api/settings/move-slip", "../routes/settings", "/move-slip"],
  ["/api/settings/escpos", "../routes/settings", "/escpos"],
  ["/api/settings/order-hours", "../routes/settings", "/order-hours"],
  ["/api/settings/print-device", "../routes/settings", "/print-device"],
  ["/api/settings/storage", "../routes/settings", "/storage"],
  ["/api/test-mode", "../routes/testMode", "/"],
  ["/api/vip-cards/sale-settings", "../routes/vipCards", "/sale-settings"],
];
// 사장만 부르는 것들. 직원 화면은 애초에 안 부르므로 넣지 않는다 — 넣으면
// 권한 검사에 걸려 403 만 열 줄 늘어난다.
const OWNER_ONLY = [
  ["/api/settings/staff-permissions", "../routes/settings", "/staff-permissions"],
  ["/api/settings/line", "../routes/settings", "/line"],
  ["/api/settings/payment", "../routes/settings", "/payment"],
  ["/api/settings/service-start", "../routes/settings", "/service-start"],
];

// /api/settings/logo-preview 는 여기 없다. 그건 JSON 이 아니라 이미지라
// (admin.js 가 img.src 로 건다) 이 지도에 담을 수 없다.
router.get("/", async (req, res) => {
  const out = {};
  const role = req.session && req.session.role;

  // 로그인 안 했으면 화면이 알아야 할 것은 그것 하나뿐이다. 로그인 화면은
  // 요청 한 번으로 뜬다.
  const wanted = isAdminRole(role)
    ? ALWAYS.concat(role === "owner" ? OWNER_ONLY : [])
    : [["/api/auth/me", "../routes/auth", "/me"]];

  for (const [key, mod, url] of wanted) {
    try {
      const r = await runRoute(require(mod), req, url);
      // 200 이 아닌 칸은 아예 넣지 않는다. 그러면 화면이 그 주소만 예전처럼
      // 직접 부른다 — 틀린 값을 물려주는 것보다 한 번 더 부르는 게 낫다.
      if (r.status === 200 && r.body !== null && r.body !== undefined) out[key] = r.body;
    } catch (e) {
      // 한 칸이 터져도 나머지는 간다.
    }
  }

  res.set("Cache-Control", "no-store");
  res.json(out);
});

module.exports = router;
module.exports.runRoute = runRoute;
