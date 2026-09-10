// 맵기에는 늘 「基本」이 있고, 그게 기본으로 골라져 있다.
//
// 사장님(2026-09-10): "매운맛 선택이 무조건 첫번째거로 선택되어있어" →
// "맵기 기본에 늘 기본이 있어야 하고 그게 기본 세팅으로 선택이 되어있어야 해."
//
// ── 무슨 일이었나 ─────────────────────────────────────────────────────
//
// 씨앗 데이터는 맵기가 있는 메뉴마다 「基本,小辣」처럼 基本 을 첫 칸에 두고
// 있었다. 화면이 첫 칸을 미리 고르니, 아무것도 안 건드린 손님에게는 基本 이
// 나갔다 — 의도대로다.
//
// 그런데 운영 데이터에서 일부 메뉴의 基本 이 빠져 있었다(「不辣,中辣」,
// 「小辣」). 그러면 첫 칸이 매운맛이 되고, 안 매운 것을 원하던 손님에게
// 매운 것이 나간다. 그 접시는 주방이 다시 만든다.
//
// 고친 방향: 「첫 칸을 고른다」가 아니라 「基本 을 고른다」로 못 박는다.
// 데이터가 어떻게 생겼든 화면에는 늘 基本 이 있고 늘 그것이 켜져 있다.
// 저장된 데이터도 마이그레이션으로 같이 고친다.
const fs = require("fs");
const path = require("path");
const { withBasic, BASIC } = require("../src/migrations/2026-09-10-spice-basic");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}
const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

out.push("[1] 저장된 데이터를 고친다");
{
  check("★ 基本 이 빠진 목록에 맨 앞으로 넣는다", withBasic("不辣,中辣") === "基本,不辣,中辣", withBasic("不辣,中辣"));
  check("★ 한 칸짜리도 고친다", withBasic("小辣") === "基本,小辣", String(withBasic("小辣")));
  check("이미 있으면 건드리지 않는다", withBasic("基本,小辣") === null, String(withBasic("基本,小辣")));
  check("맨 앞이 아니어도 있으면 그대로 둔다", withBasic("小辣,基本") === null, String(withBasic("小辣,基本")));
  check("★ 맵기 칸이 없는 메뉴는 건드리지 않는다", withBasic("") === null && withBasic(null) === null, "");
  check("빈 칸만 있는 값도 안 건드린다", withBasic(" , ") === null, String(withBasic(" , ")));
  check("기본값 이름은 基本", BASIC === "基本", BASIC);
}

out.push("\n[2] 서버가 뜰 때 돌아간다");
{
  const server = read("server.js");
  check("불러온다", /applySpiceBasic20260910/.test(server), "");
  check("실제로 부른다", /await applySpiceBasic20260910\(store, \{ save \}\)/.test(server), "");
  const mig = read("src", "migrations", "2026-09-10-spice-basic.js");
  check("한 번만 돌게 표를 남긴다", /migration_2026_09_10_spice_basic_applied/.test(mig), "");
}

out.push("\n[3] 화면은 데이터와 무관하게 基本 을 보장한다");
{
  const orderJs = read("public", "js", "order.js");
  check("★ 목록에 없으면 화면에서 채워 넣는다", /parts\.includes\(SPICE_BASIC\) \? parts : \[SPICE_BASIC, \.\.\.parts\]/.test(orderJs), "");
  check("★ 처음 열 때 基本 이 골라져 있다", /currentSpiceOption = item\.spice_options \? SPICE_BASIC : null;/.test(orderJs), "");
  check("골라진 칸에 불이 들어온다", /if \(opt === currentSpiceOption\) b\.classList\.add\("active"\);/.test(orderJs), "");
  check("★ 첫 칸을 고르는 옛 방식이 남아 있지 않다", !/spice_options\.split\(","\)\[0\]/.test(orderJs), "");
  check("맵기 칸이 없는 메뉴는 빈 목록이다", /if \(!parts\.length\) return \[\];/.test(orderJs), "");
}

out.push("\n[4] 늘 골라져 있으니 막을 일이 없다");
{
  const orderJs = read("public", "js", "order.js");
  const html = read("public", "order.html");
  check("고르라고 막던 규칙을 걷어냈다", !/SPICE_REQUIRED_MSG/.test(orderJs), "");
  check("그 안내 자리도 같이 걷어냈다", !/spiceRequiredMsg/.test(orderJs) && !/spiceRequiredMsg/.test(html), "");
}

out.push("\n[5] 빌지는 基本 을 안 찍는다");
{
  // 「基本」은 그냥 평소대로 만들라는 뜻이라 주방에 적을 말이 없다.
  const escpos = read("public", "js", "escpos.js");
  check("★ 基本 은 빌지에서 빠진다", /it\.spice_choice !== "基本"/.test(escpos), "");
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
