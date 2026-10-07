// 결산 탭이 세 요청을 줄줄이 세우지 않는가.
//
// 2026-09-14 사장님: 결산 기록 한 줄을 누르면 4초. 로그로 재보니 요청 하나
// 하나는 1.0~1.2초인데 세 개가 차례로 서 있었다.
//
//   GET /api/settlements            p50 1,192ms
//   GET /api/settlements/history    p50 1,490ms   (이미 나란히)
//   GET /api/orders/history         p50 1,029ms   ← renderSettlement 안에서
//                                                   불려서 출발조차 못 했다
//
// 「지난 주문 목록」이 필요로 하는 것은 화면의 날짜 칸과 오전/오후뿐이고,
// 결산 응답에서 가져오는 값은 하나도 없다. 기다릴 이유가 없었다.
//
// 이 성질은 눈에 안 보인다 — 줄줄이 세워도 화면은 똑같이 나오고 느리기만
// 하다. 그래서 코드가 그 순서를 지키는지 여기서 본다.
const fs = require("fs");
const path = require("path");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const ADMIN = fs.readFileSync(path.join(__dirname, "..", "public", "js", "admin.js"), "utf8");

// 함수 하나만 잘라낸다. 파일 전체에서 찾으면 다른 곳의 같은 이름에 걸린다.
function bodyOf(name) {
  const start = ADMIN.indexOf(`async function ${name}(`);
  if (start === -1) return null;
  const nextFn = ADMIN.indexOf("\n  function ", start + 1);
  const nextAsync = ADMIN.indexOf("\n  async function ", start + 1);
  const end = Math.min(...[nextFn, nextAsync].filter((x) => x > start).concat([ADMIN.length]));
  return ADMIN.slice(start, end);
}

(async () => {
  out.push("[결산을 불러오는 길]");
  const body = bodyOf("loadSettlementInner");
  check("loadSettlementInner 을 찾았다 (아래 측정의 전제)", !!body);

  if (body) {
    const iOrders = body.indexOf("loadSettlementOrders(start, end)");
    const iHistory = body.indexOf("loadSettlementHistory()");
    const iAwait = body.indexOf("await resPromise");
    check("세 요청이 모두 이 함수에서 출발한다", iOrders !== -1 && iHistory !== -1 && iAwait !== -1,
      `orders ${iOrders}, history ${iHistory}, await ${iAwait}`);
    check(
      "★ 지난 주문 목록이 결산 본문을 기다리지 않고 출발한다",
      iOrders !== -1 && iAwait !== -1 && iOrders < iAwait,
      `loadSettlementOrders(start, end) 가 ${iOrders === -1 ? "아예 없다" : (iOrders < iAwait ? "앞" : "뒤") + "에 있다"}`
    );
    check(
      "★ 지난 정산 기록도 기다리지 않고 출발한다",
      iHistory !== -1 && iAwait !== -1 && iHistory < iAwait,
      `loadSettlementHistory() 가 ${iHistory === -1 ? "아예 없다" : (iHistory < iAwait ? "앞" : "뒤") + "에 있다"}`
    );
    // 출발만 시키고 안 기다리면, 늦게 온 답이 다음 화면을 덮어쓸 수 있다.
    check("출발시킨 것을 나중에 기다린다", body.includes("await ordersPromise"));
  }

  out.push("\n[결산 본문과 지난 주문이 같은 날짜를 본다]");
  const ordersBody = bodyOf("loadSettlementOrders") || "";
  check(
    "★ 지난 주문 함수가 결산에서 받은 시작일·종료일을 우선한다",
    /startOverride\s*\|\|[\s\S]{0,120}settlementStartDate/.test(ordersBody) &&
      /endOverride\s*\|\|[\s\S]{0,120}settlementEndDate/.test(ordersBody),
    "빠른 기간 버튼은 응답 전까지 입력칸이 옛 날짜라, 다시 읽으면 오늘만 조회한다"
  );

  out.push("\n[늦게 온 옛 응답이 새 화면을 덮지 않는다]");
  for (const [name, seq] of [
    ["loadSettlementOrders", "settlementOrdersSeq"],
    ["loadItemTrend", "itemTrendSeq"],
    ["loadReservations", "reservationsSeq"],
  ]) {
    const requestBody = bodyOf(name) || "";
    const assigned = requestBody.indexOf(`const mySeq = ++${seq}`);
    const awaited = requestBody.indexOf("await res.json()");
    const guarded = requestBody.lastIndexOf(`mySeq !== ${seq}`);
    check(`${name}: 요청마다 순번을 올린다`, assigned !== -1, seq);
    check(
      `★ ${name}: 응답을 받은 뒤 마지막 요청인지 확인한다`,
      awaited !== -1 && guarded > awaited,
      `json ${awaited}, guard ${guarded}`
    );
  }

  out.push("\n[같은 요청이 두 번 나가지 않는다]");
  const render = ADMIN.slice(ADMIN.indexOf("function renderSettlement(data"));
  const renderBody = render.slice(0, render.indexOf("\n  const fmtOrderTableTag"));
  check("renderSettlement 을 찾았다 (아래 측정의 전제)", renderBody.length > 0 && renderBody.length < ADMIN.length);
  const callsInRender = (renderBody.match(/loadSettlementOrders\(\)/g) || []).length;
  check(
    "★ renderSettlement 은 조건 없이 다시 부르지 않는다",
    callsInRender === 0 || /ordersAlreadyLoading[\s\S]{0,80}loadSettlementOrders\(\)/.test(renderBody),
    `renderSettlement 안의 호출 ${callsInRender}회 — 조건 없이 부르면 같은 요청이 두 번 나간다`
  );

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
