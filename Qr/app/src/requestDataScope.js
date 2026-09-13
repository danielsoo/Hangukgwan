// 어느 API가 최근 주문 배열(store.orders)을 실제로 쓰는가.
//
// store 문서(메뉴·설정·테이블·VIP 카드)는 작지만, 최근 주문은 별도
// 컬렉션에서 인덱스 질의로 읽는다(src/db.js loadRecentOrders). 예전에는 모든
// API가 그 질의를 무조건 치러서, 주문 DB가 잠깐 밀리면 로그인·설정·
// 메뉴까지 함께 5~15초씩 멈췄다.
//
// 안전을 위해 "주문이 필요 없는 것이 확실한" 경로만 아래에 적고, 모르는 새
// 경로는 기본적으로 주문을 읽는다. 새 라우트를 추가했는데 분류를 잊더라도
// 데이터가 빠지는 쪽이 아니라 왕복이 하나 더 생기는 쪽으로 실패한다.
const ORDER_FREE_PREFIXES = [
  "/api/account",      // 지난 주문은 필요한 핸들러가 findOrders()로 직접 읽는다
  "/api/users",
  "/api/auth",
  "/api/menu",
  "/api/zones",
  "/api/settings",
  "/api/reservations", // 별도 reservations 컬렉션
  "/api/line/webhook",
  "/api/members",
  "/api/_diag",        // 진단 핸들러가 주문 읽기 자체를 따로 재므로 중복 금지
  "/api/photo",        // 현재는 공통 미들웨어 앞에서 끝나지만 분류도 명시한다
];

function pathOf(reqOrPath) {
  const raw = typeof reqOrPath === "string"
    ? reqOrPath
    : (reqOrPath && (reqOrPath.originalUrl || reqOrPath.path || reqOrPath.url));
  return String(raw || "").split("?")[0].replace(/\/$/, "") || "/";
}

function under(path, prefix) {
  return path === prefix || path.startsWith(prefix + "/");
}

function needsRecentOrders(reqOrPath) {
  const path = pathOf(reqOrPath);
  const method = typeof reqOrPath === "string"
    ? null
    : String((reqOrPath && reqOrPath.method) || "GET").toUpperCase();

  if (under(path, "/api/tables")) {
    // 목록 GET은 사라진 인원수를 살아 있는 주문에서 복구하고, 테이블 DELETE는
    // 미결제 주문이 있으면 막는다. party-size GET은 해당 테이블 하나만 라우트
    // 안에서 직접 질의하므로 가게 전체 최근 주문은 읽지 않는다.
    if (path === "/api/tables") return false;
    if (/^\/api\/tables\/[^/]+\/party-size$/.test(path)) {
      return false;
    }
    if (/^\/api\/tables\/[^/]+$/.test(path) && method === "DELETE") return false;
    return false;
  }

  if (under(path, "/api/orders")) {
    // 주방 전체 주문판만 목록이 필요하다. 새 주문, 손님의 내 주문, 주문번호
    // 하나 조회는 각 라우트가 `_id` 또는 table_number로 직접 읽는다.
    if (path === "/api/orders") return method === null || method === "GET";
    if (under(path, "/api/orders/history")) return false;
    if (under(path, "/api/orders/table")) return false;
    if (/^\/api\/orders\/\d+$/.test(path) && (method === null || method === "GET")) return false;
    if (path === "/api/orders/reorder" && method === "PATCH") return false;
    if (path === "/api/orders/move" && method === "POST") return false;
    if (/^\/api\/orders\/\d+(?:\/items|\/split-pay)?$/.test(path) && method === "PATCH") return false;
    // 모르는 새 주문 쓰기 경로는 안전하게 전체 목록을 유지한다.
    return true;
  }

  // VIP 카드 판매도 paid 주문 한 건을 직접 insert한다.
  if (under(path, "/api/vip-cards/sell")) return false;
  if (under(path, "/api/vip-cards")) return false;

  // 온라인 결제도 해당 테이블/결제에 적힌 주문번호만 직접 읽는다.
  if (under(path, "/api/payment")) return false;

  return !ORDER_FREE_PREFIXES.some((prefix) => under(path, prefix));
}

// 전체 API가 아니라 새 주문번호가 만들어지는 두 요청에서만, 과거에 뒤로 간
// 적이 있는 nextId 안전판(orders 최대 번호 조회)을 실행한다.
function needsOrderIdFloor(req) {
  if (!req || String(req.method || "").toUpperCase() !== "POST") return false;
  const path = pathOf(req);
  return path === "/api/orders" || path === "/api/vip-cards/sell";
}

module.exports = { ORDER_FREE_PREFIXES, pathOf, needsRecentOrders, needsOrderIdFloor };
