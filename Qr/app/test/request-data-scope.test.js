// 주문과 상관없는 API가 최근 주문 질의까지 끌고 다니지 않는가.
//
// 운영에서 정적 /admin은 0.5초인데 /api/settings와 /api/menu는 12~15초가
// 걸렸다. 둘의 차이는 공통 API 미들웨어였고, 그 안에서 모든 주소가 최근
// 주문 질의와 콜드 스타트용 DB 작업을 똑같이 기다리고 있었다.
const fs = require("fs");
const path = require("path");
const { needsRecentOrders, needsOrderIdFloor } = require("../src/requestDataScope");
const {
  applyRuntimeIndexes20260913,
  MIGRATION_FLAG: RUNTIME_INDEX_FLAG,
} = require("../src/migrations/2026-09-13-runtime-indexes");
const {
  applyTableOrdersIndex20260913,
  MIGRATION_FLAG: TABLE_ORDERS_INDEX_FLAG,
} = require("../src/migrations/2026-09-13-table-orders-index");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

(async () => {
  out.push("[주문이 필요 없는 주소]");
  for (const url of [
    "/api/settings",
    "/api/settings/ticket-print",
    "/api/menu",
    "/api/menu/admin",
    "/api/auth/me",
    "/api/account/orders?limit=20",
    "/api/users",
    "/api/zones",
    "/api/reservations",
    "/api/line/webhook",
    "/api/members/register-card",
    "/api/vip-cards",
    "/api/vip-cards/sale-settings",
    "/api/_diag",
  ]) {
    check(`${url} → 주문 안 읽음`, needsRecentOrders(url) === false);
  }

  out.push("\n[주문이 반드시 필요한 주소]");
  for (const url of [
    "/api/settlements",
    "/api/test-mode",
    "/api/bootstrap",
  ]) {
    check(`${url} → 주문 읽음`, needsRecentOrders(url) === true);
  }
  check("모르는 새 API는 안전하게 주문을 읽는다", needsRecentOrders("/api/future-route") === true);

  out.push("\n[주문 API도 목록 화면만 전체를 읽는다]");
  check("주방 전체 주문판 → 목록 읽음", needsRecentOrders({ method: "GET", originalUrl: "/api/orders" }) === true);
  for (const [label, req] of [
    ["새 주문", { method: "POST", originalUrl: "/api/orders" }],
    ["주문번호 하나", { method: "GET", originalUrl: "/api/orders/123" }],
    ["상태 변경", { method: "PATCH", originalUrl: "/api/orders/123" }],
    ["품목 변경", { method: "PATCH", originalUrl: "/api/orders/123/items" }],
    ["부분 결제", { method: "PATCH", originalUrl: "/api/orders/123/split-pay" }],
    ["테이블 주문", { method: "GET", originalUrl: "/api/orders/table/7" }],
    ["주문 순서", { method: "PATCH", originalUrl: "/api/orders/reorder" }],
    ["자리 이동", { method: "POST", originalUrl: "/api/orders/move" }],
    ["이전 주문", { method: "GET", originalUrl: "/api/orders/history" }],
    ["온라인 결제", { method: "GET", originalUrl: "/api/payment/checkout?table=7" }],
    ["VIP 카드 판매", { method: "POST", originalUrl: "/api/vip-cards/sell" }],
  ]) {
    check(`${label} → 직접 조회`, needsRecentOrders(req) === false);
  }

  out.push("\n[테이블 주소도 필요한 동작만]");
  const scoped = [
    ["자리 목록", { method: "GET", originalUrl: "/api/tables" }, false],
    ["인원·최소금액 조회", { method: "GET", originalUrl: "/api/tables/7/party-size" }, false],
    ["테이블 삭제 안전 확인", { method: "DELETE", originalUrl: "/api/tables/7" }, false],
    ["QR을 연 폰의 착석 쿠키", { method: "POST", originalUrl: "/api/tables/7/seat" }, false],
    ["인원수 저장", { method: "PUT", originalUrl: "/api/tables/7/party-size" }, false],
    ["자리 배치 저장", { method: "PATCH", originalUrl: "/api/tables/7" }, false],
    ["이동 안내 확인", { method: "POST", originalUrl: "/api/tables/7/moved-ack" }, false],
    ["QR 인쇄", { method: "GET", originalUrl: "/api/tables/qr-sheet" }, false],
  ];
  for (const [label, req, expected] of scoped) {
    check(`${label} → 주문 ${expected ? "읽음" : "안 읽음"}`, needsRecentOrders(req) === expected);
  }

  out.push("\n[주문번호 최대값 조회]");
  check("POST /api/orders에서만 확인", needsOrderIdFloor({ method: "POST", originalUrl: "/api/orders" }));
  check("GET /api/orders에서는 확인하지 않음", !needsOrderIdFloor({ method: "GET", originalUrl: "/api/orders" }));
  check("VIP 카드 판매에서는 확인", needsOrderIdFloor({ method: "POST", originalUrl: "/api/vip-cards/sell" }));
  check("설정 저장에서는 확인하지 않음", !needsOrderIdFloor({ method: "POST", originalUrl: "/api/settings" }));

  out.push("\n[런타임 TTL 인덱스는 DB 전체에서 한 번]");
  const fakeStore = { settings: {} };
  let creates = 0;
  let saves = 0;
  const names = [];
  const fakeDb = {
    collection(name) {
      names.push(name);
      return { async createIndex(spec, opts) {
      creates++;
      if (name === "sessions") {
        check("sessions expires TTL 인덱스 모양", spec.expires === 1 && opts.expireAfterSeconds === 0, JSON.stringify({ spec, opts }));
      } else {
        check("request_log created_at TTL 인덱스 모양", spec.created_at === 1 && opts.expireAfterSeconds > 0, JSON.stringify({ spec, opts }));
      }
    } };
    },
  };
  const deps = {
    async connectDB() {},
    getDb() { return fakeDb; },
    async saveFields(fields) {
      saves++;
      check("완료 표시만 부분 저장", !!fields[`settings.${RUNTIME_INDEX_FLAG}`], JSON.stringify(fields));
    },
  };
  await applyRuntimeIndexes20260913(fakeStore, deps);
  await applyRuntimeIndexes20260913(fakeStore, deps);
  check("두 컬렉션을 한 번씩", names.join(",") === "sessions,request_log", names.join(","));
  check("createIndex 총 두 번", creates === 2, `${creates}번`);
  check("완료 표시 저장 한 번", saves === 1, `${saves}번`);

  out.push("\n[한 테이블 착석 주문 인덱스도 DB 전체에서 한 번]");
  const tableStore = { settings: {} };
  let tableIndexCreates = 0;
  let tableIndexSaves = 0;
  const tableIndexDeps = {
    async connectDB() {},
    getDb() {
      return { collection(name) {
        return { async createIndex(spec) {
          tableIndexCreates++;
          check("orders의 table_number+created_at 인덱스", name === "orders" && spec.table_number === 1 && spec.created_at === 1, JSON.stringify({ name, spec }));
        } };
      } };
    },
    async saveFields(fields) {
      tableIndexSaves++;
      check("테이블 인덱스 완료 표시만 부분 저장", !!fields[`settings.${TABLE_ORDERS_INDEX_FLAG}`], JSON.stringify(fields));
    },
  };
  await applyTableOrdersIndex20260913(tableStore, tableIndexDeps);
  await applyTableOrdersIndex20260913(tableStore, tableIndexDeps);
  check("테이블 인덱스 생성 한 번", tableIndexCreates === 1, `${tableIndexCreates}번`);
  check("테이블 인덱스 완료 저장 한 번", tableIndexSaves === 1, `${tableIndexSaves}번`);

  const serverSrc = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  check("connect-mongo 자체 반복 인덱스 생성은 꺼져 있음", /autoRemove:\s*["']disabled["']/.test(serverSrc));
  check("요청 종류에 따라 includeOrders를 넘김", /refreshStore\(\{ includeOrders \}\)/.test(serverSrc));
  check("테이블 주문 인덱스 마이그레이션이 서버에 연결됨", /applyTableOrdersIndex20260913/.test(serverSrc));

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.log(out.join("\n"));
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
