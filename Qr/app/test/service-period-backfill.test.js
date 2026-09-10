// 이미 쌓인 주문에도 오전/오후 표를 채운다.
//
// 사장님(2026-09-10): "오전 오후가 사라졌네. 이전 주문도 백필로 너가
// 채워줄 수 있지 않아?"
//
// 표를 박기 시작한 것이 오늘부터라, 그 전 주문에는 칸이 없어서 결산의
// 오전/오후가 통째로 비었다.
//
// ── 채우되 없던 사실을 만들지는 않는다 ───────────────────────────────
//
//   · 날짜마다 **그날의 영업시간**을 본다. 지금 시각 하나로 전부 밀지 않는다
//   · 한 타임만 연 날은 그냥 둔다. 없는 것은 「모른다」이지 「오전」이 아니다
//   · 이미 박혀 있는 표는 안 건드린다. 들어오는 순간에 찍힌 값이 가장 정확하다
const fs = require("fs");
const path = require("path");
const { cutFor } = require("../src/migrations/2026-09-10-service-period-backfill");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}
const D = "2026-09-10";
const TWO = { order_hours: { ranges: [{ start: "11:00", end: "13:35" }, { start: "16:30", end: "20:35" }] } };
const ONE = { order_hours: { ranges: [{ start: "11:00", end: "21:00" }] } };

out.push("[1] 그날의 경계");
{
  check("두 타임이면 저녁 시작 5분 전", cutFor(TWO, D) === `${D} 16:25:00`, String(cutFor(TWO, D)));
  check("★ 한 타임뿐이면 안 채운다", cutFor(ONE, D) === null, String(cutFor(ONE, D)));
  check("영업시간이 없어도 터지지 않는다", cutFor({}, D) === null, String(cutFor({}, D)));
  // src/servicePeriod.js 와 같은 값이어야 한다. 다르면 백필한 옛 주문과
  // 오늘 들어온 주문이 서로 다른 기준으로 갈린다.
  const { serviceCutAt } = require("../src/servicePeriod");
  check("★ 실시간으로 박는 것과 같은 시각", cutFor(TWO, D) === serviceCutAt(TWO, D), `${cutFor(TWO, D)} vs ${serviceCutAt(TWO, D)}`);
}

out.push("\n[2] 무엇을 고르고 무엇을 건드리지 않나");
{
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "migrations", "2026-09-10-service-period-backfill.js"), "utf8");
  check("★ 표가 없는 주문만 고른다", /service_period: \{ \$exists: false \}/.test(src), "");
  check("★ 그 칸 하나만 쓴다", /\$set: \{ service_period:/.test(src), "");
  check("주문 전체를 다시 쓰지 않는다", !/replaceOne/.test(src), "");
  check("날짜별 경계를 한 번만 구한다", /cutByDate/.test(src), "");
  check("★ 한 번에 다 보내지 않는다 (시간 제한)", /const CHUNK = 500/.test(src), "");
  check("한 번만 돌게 표를 남긴다", /migration_2026_09_10_service_period_backfill_applied/.test(src), "");
  check("몇 건 채우고 몇 건 건너뛰었는지 남긴다", /채움[\s\S]{0,40}건너뜀/.test(src), "");

  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  check("서버가 뜰 때 돈다", /await applyServicePeriodBackfill20260910\(store, \{ getDb, connectDB, save \}\)/.test(server), "");
}

out.push("\n[3] 가를 수 없으면 화면이 그렇다고 말한다");
{
  // 아무 말도 안 하면 「오전 오후가 사라졌네」로 보인다. 실제로 그랬다.
  const js = fs.readFileSync(path.join(__dirname, "..", "public", "js", "admin.js"), "utf8");
  check("★ 칸이 안 보일 때 이유를 적는다", /if \(!usable\) \{[\s\S]{0,300}settlementHalvesNone/.test(js), "");
  check("합산은 정확하다고 못 박는다", /위의 합산은 정확합니다/.test(js), "");
  check("두 언어 모두 있다", /settlementHalvesNone: "오전·오후를/.test(js) && /settlementHalvesNone: "這段期間無法分/.test(js), "");
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
