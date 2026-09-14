// 새 배포가 나가면 가게 화면이 스스로 새로고침하는가.
//
// 사장님(2026-09-14): "부모님이 대만에 있어서 언제든 내가 수정해서 apk 를 줄
// 수 있는데 엄빠가 내일 한국으로 돌아가."
//
// APK 는 Play 내부 테스트로 이미 자동으로 간다. 문제는 웹 쪽이었다. 가게
// 태블릿은 주문판을 하루 종일 켜둔다 — 껐다 켜는 일이 거의 없다. 그래서 새
// 배포가 나가도 어제 받은 자바스크립트를 계속 쓴다. 지금까지는 "새로고침 한
// 번만 눌러줘"로 닿았는데 옆에 아무도 없으면 그게 안 된다. **고쳐도 안 닿는
// 것은 안 고친 것과 같다.**
const fs = require("fs");
const path = require("path");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const APP = path.join(__dirname, "..");
const SERVER = fs.readFileSync(path.join(APP, "server.js"), "utf8");
const TIMING = fs.readFileSync(path.join(APP, "public", "js", "clientTiming.js"), "utf8");
const ADMIN = fs.readFileSync(path.join(APP, "public", "js", "admin.js"), "utf8");

(async () => {
  out.push("[서버가 지금 배포의 지문을 보낸다]");
  check("★ 모든 응답에 X-App-Version 을 적는다", /res\.set\("X-App-Version",\s*require\("\.\/src\/assetVersion"\)\.assetVersion\(\)\)/.test(SERVER));
  // 지문을 못 구했다고 요청이 죽으면 안 된다.
  check("지문을 못 구해도 요청은 그대로 간다", /X-App-Version[\s\S]{0,200}catch[\s\S]{0,120}next\(\)/.test(SERVER));
  // 아주 앞에 있어야 한다 — 뒤에 두면 먼저 끝나는 응답에는 안 붙는다.
  check("★ 미들웨어 맨 앞쪽에 있다", SERVER.indexOf("X-App-Version") < SERVER.indexOf("storeRefreshAndFlush"));

  out.push("\n[화면이 그것을 알아챈다]");
  check("★ 응답에서 지문을 읽는다", /headers\.get\("X-App-Version"\)/.test(TIMING));
  check("★ 자기 지문은 script 주소의 ?v= 에서 얻는다", /[?&]v=\(\[\^&\]\+\)/.test(TIMING) || /v=\(\[\^&\]/.test(TIMING));
  check("요청을 새로 만들지 않는다 (이미 오가는 답에 얹힌다)",
    !/setInterval[\s\S]{0,120}X-App-Version/.test(TIMING) && /noteBuild\(res\)/.test(TIMING));

  out.push("\n[배포가 굴러가는 동안 깜빡이지 않는다]");
  // 배포 중에는 인스턴스마다 옛것/새것이 섞여 나온다. 한 번 다르다고 바로
  // 새로고침하면 그 몇 분 동안 여러 번 깜빡인다.
  check("★ 같은 새 지문을 두 번 봐야 친다", /if \(seenBuild !== v\)[\s\S]{0,160}return;/.test(TIMING));
  check("★ 30초는 떨어져 있어야 한다", /STEADY_MS = 30000/.test(TIMING) && /now - seenAt < STEADY_MS/.test(TIMING));
  check("★ 옛 인스턴스를 다시 만나면 세던 것을 접는다", /v === MY_BUILD[\s\S]{0,120}seenBuild = null/.test(TIMING));
  check("한 번만 알린다", /announced = true/.test(TIMING) && /if \(!MY_BUILD \|\| announced\) return;/.test(TIMING));

  out.push("\n[바쁠 때는 새로고침하지 않는다]");
  // 주문을 넣는 중이거나 결제 창이 열려 있는데 화면이 사라지면 그건 고장으로
  // 보인다. 새로고침은 미루면 그만이다.
  for (const [label, pat] of [
    ["날아가 있는 요청", /window\.HG_INFLIGHT > 0/],
    ["끌고 있는 중", /draggingOrderId \|\| floorPlanDragging/],
    ["열려 있는 창", /\.modal, \.modal-backdrop/],
    ["울리는 알림", /#alarmStopBtn/],
    ["입력 중", /INPUT\|TEXTAREA\|SELECT/],
    ["저장 안 된 설정", /\.settings-dirty/],
  ]) {
    check(`★ ${label} 이면 미룬다`, pat.test(ADMIN), "busyReason 에서 안 봄");
  }
  check("★ 판단하다 터지면 바쁜 것으로 친다", /catch \(e\) \{[\s\S]{0,200}상태를 못 읽음/.test(ADMIN),
    "여기서 false 로 떨어지면 누르던 것이 사라진다");
  check("바쁘면 15초 뒤 다시 본다", /setTimeout\(reloadWhenIdle, RELOAD_CHECK_MS\)/.test(ADMIN));
  check("조용하면 새로고침한다", /reloadWhenIdle[\s\S]{0,400}location\.reload\(\)/.test(ADMIN));
  check("★ 알림을 한 번만 받는다", /if \(pendingReload\) return;/.test(ADMIN));

  out.push("\n[두 화면 모두 이 파일을 읽는다]");
  for (const page of ["admin.html", "order.html"]) {
    const html = fs.readFileSync(path.join(APP, "public", page), "utf8");
    check(`${page} 이 clientTiming.js 를 읽는다`, html.includes("/js/clientTiming.js"));
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
