// 매운맛은 손님이 직접 고른다.
//
// 사장님(2026-09-10): "매운맛 선택이 무조건 첫번째거로 선택되어있어.
// 메뉴 들어가면 매운정도에 아무것도 선택이 안되어있게. 내가 눌러야 선택되게."
//
// 첫 칸을 미리 켜두면 손님은 「이미 고른 것」으로 보고 그냥 담는다. 안 매운
// 것을 원하던 손님에게 中辣가 나가고, 그 접시는 주방이 다시 만든다.
//
// ── 미리 고르지 않기로 했으면 안 고른 채로 담기게 두면 안 된다 ────────
//
// 둘 중 하나만 하면 오히려 나빠진다. 기본값을 없애고 검사를 안 넣으면
// 매운맛이 빈 채로 주방에 도착하는데, 그건 손님이 「상관없다」고 답한 것이
// 아니라 화면이 물어보지 않은 것이다. 주방은 그 둘을 구별할 수 없다.
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
const orderJs = read("public", "js", "order.js");
const orderHtml = read("public", "order.html");
const css = read("public", "css", "main.css");

out.push("[1] 미리 고르지 않는다");
{
  check("★ 시트를 열 때 매운맛은 비어 있다", /currentSpiceOption = null;/.test(orderJs), "");
  check("★ 첫 칸에 미리 불을 켜지 않는다", !/if \(i === 0\) b\.classList\.add\("active"\);[\s\S]{0,200}currentSpiceOption/.test(orderJs), "");
  check("눌러야 켜진다", /b\.onclick = \(\) => \{[\s\S]{0,120}currentSpiceOption = opt\.trim\(\);[\s\S]{0,160}b\.classList\.add\("active"\)/.test(orderJs), "");
}

out.push("\n[2] 안 고르면 담기지 않는다");
{
  check("★ 매운맛이 있는 메뉴는 고르기 전에 못 담는다", /if \(currentItem\.spice_options && !currentSpiceOption\)/.test(orderJs), "");
  check("담기를 멈춘다", /if \(currentItem\.spice_options && !currentSpiceOption\)[\s\S]{0,600}return;/.test(orderJs), "");
  check("★ 왜 안 담기는지 화면에 적는다", /spiceRequiredMsg/.test(orderJs) && /id="spiceRequiredMsg"/.test(orderHtml), "");
  check("그 자리로 화면을 옮겨준다", /itemSpiceOptions"\)\.scrollIntoView/.test(orderJs), "");
  check("세 언어 모두 있다", /SPICE_REQUIRED_MSG = \{[\s\S]{0,220}zh:[\s\S]{0,220}ko:[\s\S]{0,220}en:/.test(orderJs), "");
  check("고르면 안내가 사라진다", /spiceRequiredMsg"\)\.hidden = true;/.test(orderJs), "");
  check("시트를 다시 열면 안내가 없다", /if \(spiceMsg\) spiceMsg\.hidden = true;/.test(orderJs), "");
  check("안내가 눈에 띈다", /\.options-required-msg[\s\S]{0,160}#c0272d/.test(css), "");
}

out.push("\n[3] 매운맛이 없는 메뉴는 그대로다");
{
  // 매운맛 칸이 아예 없는 메뉴까지 막으면 아무것도 못 담는다.
  check("★ spice_options 가 있는 메뉴만 막는다", /currentItem\.spice_options && !currentSpiceOption/.test(orderJs), "");
  check("고기 선택(options)은 예전처럼 첫 칸이 기본이다", /currentOption = item\.options \? item\.options\.split\(","\)\[0\]\.trim\(\) : null;/.test(orderJs), "");
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
