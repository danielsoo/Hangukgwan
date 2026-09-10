// 빌지가 빠지지 않게 하는 규칙.
//
// 2026-09-10 사장님(장사 중): "지금까지 4건 주문됐거든. 3건은 주문시 2장씩.
// 9번테이블 1건은 아예 안나왔어 ㅋㅋ 강제 인쇄했지." / "한 대만 켜져있을텐데
// 그게 큰 의미가 있는거야? 그렇다면 하나에 고정으로 되거나 다른 곳에서 못
// 키게 막아줘."
//
// 두 장씩은 정상이다(주방용+결제용, 2026-09-07). 안 나온 한 건이 문제였다.
//
// 이 파일은 그 두 가지가 되돌아오지 않는지를 소스에서 잰다. 실제 동작은
// test/e2e-auto-print.js 가 브라우저로 잰다.
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
const adminJs = read("public", "js", "admin.js");
const adminHtml = read("public", "admin.html");
const settingsJs = read("src", "routes", "settings.js");

out.push("[「새 주문」의 기준이 기기에 남는다]");
// 예전 기준(메모리에만 있는 목록 + 첫 응답 통째로 건너뛰기)이 겹치면
// 새로고침 중에 들어온 주문이 영영 안 찍힌다. 9번 테이블이 그랬다.
check("판단한 주문을 기기에 남긴다", /localStorage\.setItem\(DECIDED_KEY/.test(adminJs));
check("켤 때 그 기록을 읽는다", /localStorage\.getItem\(DECIDED_KEY\)/.test(adminJs));
// 주석에는 남아 있어도 된다(왜 바꿨는지의 기록이다). 코드에 없어야 한다.
check("예전의 isFirstLoad 판정이 사라졌다",
  !/const isFirstLoad =/.test(adminJs) && !/!isFirstLoad &&/.test(adminJs),
  "화면을 켠 첫 응답을 통째로 건너뛰는 규칙이 남아 있다");
check("메모리에만 있던 목록도 사라졌다", !/knownOrderIds/.test(adminJs),
  "새로고침하면 잊어버리는 기준이 아직 인쇄를 정하고 있다");
check("찍기 전에 판단 표시를 먼저 남긴다",
  /pending\.forEach\(\(o\) => decidedOrderIds\.add\(o\.id\)\);\s*\n\s*writeDecidedIds\(\);/.test(adminJs),
  "인쇄가 끝나기를 기다리면 그 사이 응답이 같은 주문을 또 찍는다");
// 자동 인쇄가 꺼져 있어도 「판단했다」로 남겨야 한다 — 안 그러면 나중에
// 켜는 순간 그동안 쌓인 신규 주문이 한꺼번에 쏟아진다.
{
  const i = adminJs.indexOf("pending.forEach((o) => decidedOrderIds.add(o.id));");
  const j = adminJs.indexOf("if (autoPrintOn && printHereAllowed())");
  check("자동 인쇄가 꺼져 있어도 판단은 남긴다", i > 0 && j > i, `${i} / ${j}`);
}
check("저장이 막힌 기기에서도 죽지 않는다", /decidedStorageOk = false/.test(adminJs));
check("기록이 무한정 쌓이지 않는다", /DECIDED_KEEP/.test(adminJs));

out.push("\n[인쇄는 한 기기에서만]");
check("서버에 인쇄 기기를 적는 길이 있다", /router\.get\("\/print-device", requireAdmin,/.test(settingsJs));
check("바꾸는 길도 있다", /router\.put\("\/print-device", requireAdmin,/.test(settingsJs));
check("남의 것은 못 놓는다", /not_holder/.test(settingsJs),
  "폰에서 토글을 끄는 것만으로 태블릿 인쇄가 풀린다");
check("켤 때 물어본다", /printDeviceTakeoverConfirm/.test(adminJs));
check("어느 기기가 인쇄하는지 화면에 뜬다", /id="printDeviceNote"/.test(adminHtml));
check("다른 기기면 눈에 띄게", /is-elsewhere/.test(adminJs) && /is-elsewhere/.test(read("public", "css", "admin.css")));
check("빼앗기면 그 기기 토글이 꺼진다",
  /if \(!mine && autoPrintOn\)/.test(adminJs),
  "켜져 있다고 믿는 채로 안 찍히는 기기가 남는다");
// 켤 때마다 서로 뺏으면 주방 프린터가 오늘은 태블릿, 내일은 폰이 된다.
check("화면을 켠다고 남의 것을 뺏지 않는다",
  /if \(autoPrintOn && !printDevice\.id\) await claimPrintDevice\(\);/.test(adminJs));

out.push("\n[막는 쪽보다 찍는 쪽으로 기운다]");
// 빌지가 두 장 나오는 것보다 안 나오는 게 훨씬 비싸다. 오늘 그 값을 치렀다.
{
  const m = adminJs.match(/function printHereAllowed\(\) \{([\s\S]*?)\n  \}/);
  check("판정 함수가 있다", !!m);
  const body = m ? m[1] : "";
  check("값을 못 읽었으면 찍는다", /if \(!printDevice\.known\) return true;/.test(body));
  check("아무도 안 맡았으면 찍는다", /if \(!printDevice\.id\) return true;/.test(body));
  check("막는 건 「다른 기기가 분명히 맡고 있을 때」 하나뿐",
    /return printDevice\.id === myDeviceId\(\);/.test(body));
}

out.push("\n[두 장은 그대로 둔다]");
// 사장님 확인(2026-09-10): "정상 — 주방용+결제용". 이건 2026-09-07 요청이라
// 실수로 한 장으로 줄이면 결제용이 사라진다.
check("브라우저 인쇄는 두 장을 한 작업에 담는다",
  /const bodyHtml = `<div class="receipt-page-break">\$\{kitchenReceipt\}<\/div>\$\{priceReceipt\}`/.test(adminJs));
check("ESC/POS 인쇄도 두 장을 만든다",
  /rawKitchen = buildEscPosTicket\(o, storeName\)/.test(adminJs) &&
  /rawPriceCopy = buildEscPosTicket\(o, storeName, \{ priceCopy: true/.test(adminJs));

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
