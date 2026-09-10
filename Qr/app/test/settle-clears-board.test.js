// 정산하면 결제완료 칸이 비는가 — 그리고 그 줄들이 살아 있는가.
//
// 사장님(2026-09-10): "정산 누르면 결제완료 애들 없어지게 해줘."
//
// 정산은 「여기까지 끊는다」는 뜻이다. 끊은 뒤에도 화면에 남아 있으면 다음
// 장사의 결제와 섞여, 어디까지가 정산한 몫인지 화면만 보고는 가릴 수 없다.
// 오전 정산 뒤 오후 결제가 그 위에 쌓이면 특히 그렇다.
//
// ── 이 파일이 지키는 단 하나 ──────────────────────────────────────────
//
//   **화면에서 내리는 것이지 지우는 것이 아니다.**
//
// 결산 스냅샷도, 테이블의 이전 주문도, 매출 집계도 그 줄들을 계속 읽는다.
// 여기서 줄 자체를 지우면 그날 매출이 통째로 사라진다.
const fs = require("fs");
const path = require("path");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const settlements = read("src", "routes", "settlements.js");
const adminJs = read("public", "js", "admin.js");

out.push("[1] 정산이 표시를 남긴다 (src/routes/settlements.js)");
{
  check("결제된 주문에 settled_at 을 찍는다", /o\.settled_at = closedAt;/.test(settlements), "");
  check("어느 정산이었는지도 남긴다", /o\.settled_shift = shift;/.test(settlements), "");
  check("★ 줄을 지우지 않는다", !/deleteMany|deleteOne|\$unset/.test(settlements), "");
  check("★ 이미 정산된 것은 다시 안 건드린다", /!o\.settled_at/.test(settlements), "");
  check("그날 것만 고른다", /String\(o\.created_at \|\| ""\)\.slice\(0, 10\) === date/.test(settlements), "");
  check("★ 테스트 주문과 진짜 주문을 섞지 않는다", /!!o\.test_session === !!testId/.test(settlements), "");
  check("주문마다 그 줄만 쓴다 (store 통째로 X)", /await saveOrders\(justSettled\)/.test(settlements), "");
  check("몇 건 내렸는지 화면에 알려준다", /settled_orders: justSettled\.length/.test(settlements), "");
}

out.push("\n[2] 화면이 그 표시를 보고 내린다 (public/js/admin.js)");
{
  check("결제완료 칸에서 정산된 것을 뺀다", /cols\.paid = cols\.paid\.filter\(\(o\) => !o\.settled_at\);/.test(adminJs), "");
  check("몇 건 내려갔는지 말한다", /settled_orders[\s\S]{0,300}결제완료 칸의/.test(adminJs), "");
  check("★ 지운 게 아니라는 것까지 말한다", /지운 게 아니라 결산 탭과 테이블 이전 주문에서/.test(adminJs), "");
  check("정산 결과 문구에 실제로 붙는다", /seatNote \+ settledNote \+ lineNote/.test(adminJs), "");
}

out.push("\n[3] 내린 줄을 다른 화면은 계속 읽는다");
{
  // 결산·이력·매출 집계가 settled_at 을 보고 거르기 시작하면 그날 매출이
  // 통째로 사라진다. 어느 쪽에도 그런 조건이 없어야 한다.
  const settlementSrc = read("src", "settlement.js");
  const ordersSrc = read("src", "routes", "orders.js");
  check("★ 매출 계산은 settled_at 을 안 본다", !/settled_at/.test(settlementSrc), "");
  check("★ 주문 목록·이력도 settled_at 으로 안 거른다", !/settled_at/.test(ordersSrc), "");
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
