// 위치 확인을 켜고 끌 수 있다.
//
// 사장님(2026-09-10): "위치 기반을 on off 할 수 있게도 해줘."
//
// 끄면 손님 폰에 위치를 **묻지도 않는다.** 서버만 통과시키고 화면은 그대로
// 물어보면, 손님은 권한 창을 보고 잡히기를 기다린 뒤 아무 쓸모 없는 좌표를
// 보낸다. 끈다는 것은 그 단계 자체가 없어진다는 뜻이어야 한다.
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
const orders = read("src", "routes", "orders.js");
const settings = read("src", "routes", "settings.js");
const orderJs = read("public", "js", "order.js");
const adminJs = read("public", "js", "admin.js");
const adminHtml = read("public", "admin.html");

out.push("[1] 서버 — 꺼져 있으면 아예 안 잰다");
{
  check("★ 첫 줄에서 빠져나온다", /if \(store\.settings\.location_check_enabled === false\) return null;/.test(orders), "");
  check("★ 저장된 적 없으면 켜진 것으로 본다 (=== false 로만 끈다)", !/location_check_enabled !== true/.test(orders), "");
}

out.push("\n[2] 손님 화면이 그 값을 받는다");
{
  check("공개 설정에 들어 있다", /"location_check_enabled",/.test(settings), "");
  check("기본은 켜짐", /map\.location_check_enabled = store\.settings\.location_check_enabled !== false;/.test(settings), "");
  check("★ 꺼져 있으면 위치를 묻는 단계가 사라진다", /const locationOn = s\.location_check_enabled !== false;[\s\S]{0,300}storeLat = !locationOn/.test(orderJs), "");
}

out.push("\n[3] 설정 화면에서 켜고 끈다");
{
  check("스위치가 있다", /id="s_location_check_enabled"/.test(adminHtml), "");
  check("저장할 때 같이 보낸다", (adminJs.match(/location_check_enabled: \$\("#s_location_check_enabled"\)\.checked/g) || []).length >= 2, "");
  check("열 때 지금 값이 찍힌다", /\$\("#s_location_check_enabled"\)\.checked = locOn;/.test(adminJs), "");
  check("★ 껐다는 것이 저장 전에도 바로 보인다", /\$\("#s_location_check_enabled"\)\.onchange/.test(adminJs), "");
  check("두 언어 모두 있다", /labelLocationCheckEnabled: "위치 확인 사용"/.test(adminJs) && /labelLocationCheckEnabled: "啟用位置確認"/.test(adminJs), "");
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
