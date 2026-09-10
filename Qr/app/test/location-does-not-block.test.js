// 위치를 못 잡았다고 손님을 돌려보내지 않는다.
//
// 2026-09-10 저녁, 사장님: "이런 오류가 꽤 많은 테이블에서 일어나" —
// 손님 화면에 「無法取得您的位置，請確認已開啟定位功能」 가 뜨고, 확인을
// 눌러도 주문이 들어가지 않았다. 자리에 앉아 계신 손님이 밥을 못 시킨다.
//
// ── 갈라야 하는 두 가지 ────────────────────────────────────────────────
//
//   멀리 있다      → 막는다. QR 사진을 찍어 집에서 주문하는 것이 이 검사의
//                    목적이고, 그건 실제로 막아야 한다.
//   확인을 못 했다 → 받는다. 실내, 권한 거부, 도메인이 바뀌어 권한이 처음부터
//                    다시, 기기 설정 — 대부분 손님 잘못이 아니다. 대신 표를
//                    달아 직원 화면에 보여준다. 자리에 손님이 앉아 있는지는
//                    직원이 눈으로 안다.
//
// 이 둘을 한 덩어리로 묶는 순간 「가게 안 손님을 막는 기능」이 된다.
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
const orderJs = read("public", "js", "order.js");
const adminJs = read("public", "js", "admin.js");

out.push("[1] 서버 — 멀 때만 막는다");
{
  check("★ out_of_range 만 거절한다", /if \(locationError === "out_of_range"\) return res\.status\(403\)/.test(orders), "");
  check("★ 좌표가 없다고 거절하지 않는다", !/if \(locationError\) return res\.status\(403\)/.test(orders), "");
  check("확인 못 한 주문에 표를 단다", /location_unverified: true/.test(orders), "");
  check("확인된 주문에는 그 칸을 안 만든다", /\.\.\.\(locationUnverified \? \{ location_unverified: true \} : \{\}\)/.test(orders), "");
  check("먼 것을 재는 계산은 그대로다", /dist > radius \? "out_of_range" : null/.test(orders), "");
}

out.push("\n[2] 손님 화면 — 위치를 못 잡아도 주문이 나간다");
{
  const failBlock = orderJs.slice(orderJs.indexOf("coords = await getGeolocation()"));
  check("★ 실패해도 되돌아가지 않는다", !/alert\(t\("locationErrorMsg"\)\);\s*\n\s*return;/.test(failBlock.slice(0, 1500)), "");
  check("좌표 없이 보낸다", /coords = null;/.test(failBlock.slice(0, 1500)), "");
  check("★ 실내에서 안 잡히는 고정밀 위치를 끈다", /enableHighAccuracy: false/.test(orderJs), "");
  check("한 번 잡은 위치를 다시 쓴다", /maximumAge: 300000/.test(orderJs), "");
  check("멀다는 응답은 그대로 손님에게 알린다", /out_of_range.*locationOutOfRangeMsg|locationOutOfRangeMsg/.test(orderJs), "");
}

out.push("\n[3] 직원 화면 — 사실만 적는다");
{
  check("주문 카드에 표가 뜬다", /o\.location_unverified \? `<span class="order-card-loc-unverified"/.test(adminJs), "");
  check("카드에 실제로 붙는다", /\$\{movedTag\}\$\{locTag\}/.test(adminJs), "");
  check("두 언어 모두 있다", /orderCardLocUnverified: "📍 위치 미확인"/.test(adminJs) && /orderCardLocUnverified: "📍 位置未確認"/.test(adminJs), "");
  const css = read("public", "css", "admin.css");
  check("★ 경고가 아니라 사실 표시로 보인다 (빨강 아님)", /\.order-card-loc-unverified[\s\S]{0,200}#eef1f5/.test(css), "");
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
