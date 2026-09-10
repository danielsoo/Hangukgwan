// 오전 정산을 안 눌렀으면 저녁 영업 5분 전에 대신 눌러준다.
//
// 사장님(2026-09-10): "일단 기본은 직접 정산을 누르는 걸로 지정할건데 만약
// 그 다음 영업시간 5분전까지 정산이 안 눌려 있으면 눌러줘. 그렇게 하면
// 섞일 염려가 전혀 없을 것 같아."
//
// ── 왜 필요한가 ───────────────────────────────────────────────────────
//
// 오전과 오후를 가르는 기준이 「오전 정산을 누른 시각」이다. 안 누른 날은
// 가를 기준이 없어서 그날 매출이 통째로 「못 가른 날」이 된다. 저녁 손님이
// 들어오기 시작하면 그 뒤로는 영영 못 가른다 — 점심 매출과 저녁 매출이
// 한 덩어리가 된다.
//
// 5분 전인 이유: 그 순간에는 점심 장사가 확실히 끝나 있고 저녁 손님은 아직
// 안 들어왔다. 어느 쪽에 넣어야 할지 헷갈리는 결제가 없는 유일한 틈이다.
process.env.MONGODB_URI = "mongodb://fake/auto-am";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "auto-am-test";
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"), loaded: true, exports: fake, paths: [],
};
const fs = require("fs");
const path = require("path");
const { store } = require("../src/db");
store.settings = store.settings || {};
const st = require("../src/routes/settlements");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}
const setRanges = (ranges) => { store.settings.order_hours = { ranges }; };
const D = "2026-09-10";

out.push("[1] 언제 걸리나");
{
  setRanges([{ start: "11:00", end: "13:35" }, { start: "16:30", end: "20:35" }]);
  check("★ 저녁 영업 5분 전", st.autoAmCutFor(D) === `${D} 16:25:00`, String(st.autoAmCutFor(D)));

  setRanges([{ start: "11:00", end: "13:35" }, { start: "17:00", end: "21:00" }]);
  check("영업시간을 바꾸면 같이 움직인다", st.autoAmCutFor(D) === `${D} 16:55:00`, String(st.autoAmCutFor(D)));

  setRanges([{ start: "11:00", end: "13:35" }, { start: "16:00", end: "20:00" }, { start: "22:00", end: "23:00" }]);
  check("타임이 셋이면 마지막 타임 기준", st.autoAmCutFor(D) === `${D} 21:55:00`, String(st.autoAmCutFor(D)));
}

out.push("\n[2] 가를 수 없으면 아무것도 안 한다");
{
  setRanges([{ start: "11:00", end: "21:00" }]);
  check("★ 한 타임뿐이면 경계가 없다", st.autoAmCutFor(D) === null, String(st.autoAmCutFor(D)));
  setRanges([]);
  check("영업시간이 비어 있어도 터지지 않는다", st.autoAmCutFor(D) === null, String(st.autoAmCutFor(D)));
}

out.push("\n[3] 소스가 지키는 것들");
{
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "settlements.js"), "utf8");
  const fn = src.slice(src.indexOf("async function maybeAutoCloseAm"));
  check("★ 이미 눌렸으면 건드리지 않는다", /existing && existing\.am_closed_at/.test(fn), "");
  check("★ 아직 이르면 DB 도 안 본다", /if \(nowLocal\(\) < cut\) return;/.test(fn), "");
  check("★ 하루에 한 번만 확인한다", /if \(autoAmCloseDoneFor === date\) return;/.test(fn), "");
  check("★ 테스터 모드 기기로는 진짜 정산을 안 돌린다", /if \(testMode\.currentId\(req, store\)\) return;/.test(fn), "");
  // 인스턴스가 여러 개라 같은 순간에 둘이 올 수 있다. 조건부로 박고 실제로
  // 박은 쪽만 문자를 보낸다 — 안 그러면 LINE 이 두 통 간다.
  check("★ 시각을 조건부로 박는다 (문자 두 통 방지)", /am_closed_at: \{ \$in: \[null, undefined\] \}/.test(fn), "");
  check("박은 쪽만 나머지를 한다", /if \(!claim \|\| !claim\.modifiedCount\)/.test(fn), "");
  check("★ 경계는 「지금」이 아니라 그 5분 전 시각", /am_closed_at: cut/.test(fn) && !/am_closed_at: nowLocal\(\)/.test(fn), "");
  check("자동이었다는 표를 남긴다", /am_closed_auto: true/.test(fn), "");
  check("문자에도 자동이었다고 적는다", /자동으로 마감했습니다/.test(fn), "");
  check("★ 실패해도 주문판은 돌아간다", /catch \(e\)[\s\S]{0,120}자동 오전 정산 실패/.test(fn), "");
}

out.push("\n[4] 그 정산이 덮는 것까지만 내린다");
{
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "settlements.js"), "utf8");
  const fn = src.slice(src.indexOf("async function markSettled"));
  // 오전 정산이 저녁 결제까지 내려버리면 저녁 직원이 방금 받은 돈을 화면에서
  // 못 찾는다.
  check("★ closedAt 이전에 결제된 것만", /paidAtOf\(o\) <= closedAt/.test(fn.slice(0, 900)), "");
  check("이미 내려간 것은 다시 안 건드린다", /!o\.settled_at/.test(fn.slice(0, 900)), "");
  check("주문 줄만 쓴다", /await saveOrders\(rows\)/.test(fn.slice(0, 1200)), "");
}

out.push("\n[5] 주문판이 부른다");
{
  const orders = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "orders.js"), "utf8");
  check("★ 주문 목록을 읽을 때마다 확인한다", /maybeAutoCloseAm\(req\);/.test(orders), "");
  // 그 시각에 태블릿이 이 주소를 4초마다 부른다. 크론을 따로 두면 영업시간을
  // 바꿨을 때 같이 안 움직인다.
  check("★ 응답을 기다리게 하지 않는다", !/await maybeAutoCloseAm\(req\)/.test(orders), "");
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
