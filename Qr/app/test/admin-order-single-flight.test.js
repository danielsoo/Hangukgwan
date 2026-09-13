// 관리자 패드의 주문 재조회가 느려져도 GET /api/orders가 겹치지 않는가.
// 실제 admin.js의 잠금 코드를 꺼내 지연된 요청으로 실행한다. 이름만 있는
// 정적 검사로는 실수로 잠금을 일찍 푸는 회귀를 잡지 못한다.
const fs = require("fs");
const path = require("path");

const adminJs = fs.readFileSync(path.join(__dirname, "../public/js/admin.js"), "utf8");
const start = adminJs.indexOf("  let ordersLoadInFlight = null;");
const end = adminJs.indexOf("\n  async function loadOrdersOnce()", start);

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

(async () => {
  check("실제 잠금 코드를 찾는다", start >= 0 && end > start, `${start}, ${end}`);
  if (start < 0 || end <= start) throw new Error("admin.js에서 주문 single-flight 코드를 찾지 못했습니다.");

  let calls = 0;
  let active = 0;
  let maxActive = 0;
  const releases = [];
  function delayedLoad() {
    calls++;
    active++;
    maxActive = Math.max(maxActive, active);
    return new Promise((resolve) => releases.push(() => {
      active--;
      resolve(calls);
    }));
  }

  const code = `${adminJs.slice(start, end)}\nreturn { loadOrders };`;
  const gate = new Function("loadOrdersOnce", "console", code)(delayedLoad, { error() {} });

  const first = gate.loadOrders();
  const second = gate.loadOrders();
  const third = gate.loadOrders();
  check("★ 세 호출이 같은 진행 중 요청을 기다린다", first === second && second === third);
  check("★ 실제 요청은 하나만 시작한다", calls === 1, `${calls}개`);

  releases.shift()();
  await first;
  await Promise.resolve();
  check("★ 기다리던 여러 알림은 후속 요청 하나로 합친다", calls === 2, `${calls}개`);
  check("★ 동시 실행은 끝까지 1개를 넘지 않는다", maxActive === 1, `${maxActive}개`);

  releases.shift()();
  await Promise.resolve();
  await Promise.resolve();
  check("후속 요청 뒤에는 잠금이 풀린다", active === 0, `${active}개`);

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.log(out.join("\n"));
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
