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
  // 2026-09-16 에 조건이 하나 늘었다 — 「테스트 테이블」 주문은 자동으로 안
  // 찍는다(test/test-table.test.js). 글자 그대로 찾지 말고 시작만 맞춘다.
  const j = adminJs.indexOf("if (autoPrintOn && printHereAllowed()");
  check("자동 인쇄가 꺼져 있어도 판단은 남긴다", i > 0 && j > i, `${i} / ${j}`);
}
check("저장이 막힌 기기에서도 죽지 않는다", /decidedStorageOk = false/.test(adminJs));
check("기록이 무한정 쌓이지 않는다", /DECIDED_KEEP/.test(adminJs));

// 2026-09-29: 「한 기기에서만」 → **자동 인쇄를 켠 기기들이 같이 찍는다.**
//
// 사장님: "단말기(POS)별로 프린트를 별도로 사용할 수 있도록 설정 요망 ... 홀
// 프린터의 오류/고장 등 유사시 카운터 단말기/프린터를 즉시 교체 투입하여
// 영업시간 공백 최소화." 자동 인쇄는 「두 곳 다 자동」을 고르셨다.
// 09-10 의 「다른 곳에서 못 키게 막아줘」는 이 결정으로 바뀌었다.
out.push("\n[자동 인쇄는 켠 기기들이 같이 찍는다]");
check("서버에 인쇄 기기를 적는 길이 있다", /router\.get\("\/print-device", requireAdmin,/.test(settingsJs));
check("바꾸는 길도 있다", /router\.put\("\/print-device", requireAdmin,/.test(settingsJs));
check("★ 담당이 목록이다", /print_devices/.test(settingsJs) && /MAX_PRINT_DEVICES/.test(settingsJs), "");
check("★ 끄면 자기만 빠진다 — 남의 기기는 그대로",
  /list = list\.filter\(\(d\) => d\.id !== rid\);/.test(settingsJs),
  "폰에서 토글을 끄는 것만으로 태블릿 인쇄가 풀린다");
check("★ 켤 때 남의 것을 뺏지 않는다 — 옮길지 묻지도 않는다",
  !/showConfirm\(T\("printDeviceTakeoverConfirm"\)/.test(adminJs), "");
check("★ 담당 목록을 store 통째로 안 쓴다", /saveFields\(\{ "settings\.print_devices"/.test(settingsJs), "");
check("어느 기기들이 인쇄하는지 화면에 뜬다", /id="printDeviceNote"/.test(adminHtml) && /printDevicesList/.test(adminJs));
check("이 기기가 목록에 없으면 눈에 띄게", /is-elsewhere/.test(adminJs) && /is-elsewhere/.test(read("public", "css", "admin.css")));
check("화면을 켤 때 토글이 켜져 있으면 목록에 들어간다",
  /if \(autoPrintOn && printDevice\.known && !amPrintDevice\(\)\) await claimPrintDevice\(\);/.test(adminJs));
check("★★ 다른 기기가 먼저 찍고 「조리 중」으로 넘긴 막 들어온 주문도 잡는다",
  /o\.status === "new" \|\| \(o\.status === "preparing" && justArrived\(o\)\)/.test(adminJs),
  "먼저 찍은 기기가 상태를 넘기면 늦게 본 기기는 영영 못 찍는다");
check("오래된 것은 안 잡는다 — 켠 기기가 몰아 찍지 않게", /PRINT_CATCHUP_MS = 3 \* 60 \* 1000/.test(adminJs), "");

out.push("\n[RawBT(블루투스)는 기기마다]");
check("★ 이 기기에 적는다", /localStorage\.setItem\(RAWBT_HERE_KEY/.test(adminJs), "");
check("★ 인쇄 경로가 가게 전체 값 대신 이 기기 값을 본다", !/cfg\.rawbtEnabled &&|!cfg\.rawbtEnabled\)/.test(adminJs), "");
check("정한 적 없으면 예전 가게 값을 따른다", /return !!\(cfg && cfg\.rawbtEnabled\);/.test(adminJs), "");

out.push("\n[막는 쪽보다 찍는 쪽으로 기운다]");
// 빌지가 두 장 나오는 것보다 안 나오는 게 훨씬 비싸다(2026-09-10 9번 테이블).
{
  const m = adminJs.match(/function printHereAllowed\(\) \{([\s\S]*?)\n  \}/);
  check("판정 함수가 있다", !!m);
  const body = m ? m[1] : "";
  check("값을 못 읽었으면 찍는다", /if \(!printDevice\.known\) return true;/.test(body));
  check("아무도 안 켰으면 찍는다", /if \(!\(printDevice\.devices \|\| \[\]\)\.length\) return true;/.test(body));
  check("막는 건 「켠 기기 목록에 이 기기가 없을 때」 하나뿐", /return amPrintDevice\(\);/.test(body));
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
