// 테스터 모드가 켜져 있으면 띠가 보이는가.
//
// 2026-09-14 사장님: "테스터가 켜져있으면 위에 긴 바로 보여줬었는데 지금은
// 안 보여."
//
// 조건이 `thisDevice` 였다. 이 기기가 테스트 기기일 때만 띠가 떴다. 그런데
// 켜둔 것을 잊는 쪽은 오히려 **참여하지 않은 기기**다. 실제로 9/13 새벽에
// 켠 세션이 하루 넘게 열린 채였고 화면에는 아무 표시도 없었다.
//
// admin.html 의 주석은 처음부터 이렇게 적혀 있었다.
//
//   "테스터 모드가 켜져 있으면 화면 어디에 있든 보인다. 이걸 놓치면 테스트
//    주문을 진짜로 착각하거나, 켜둔 줄 모르고 하루를 보낸다."
//
// 의도와 코드가 어긋나 있었던 것이다.
const fs = require("fs");
const path = require("path");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const DIR = path.join(__dirname, "..", "public");
const ADMIN = fs.readFileSync(path.join(DIR, "js", "admin.js"), "utf8");
const HTML = fs.readFileSync(path.join(DIR, "admin.html"), "utf8");
const CSS = fs.readFileSync(path.join(DIR, "css", "admin.css"), "utf8");

function bodyOf(name) {
  const start = ADMIN.indexOf(`function ${name}(`);
  if (start === -1) return "";
  const next = ADMIN.indexOf("\n  function ", start + 1);
  return ADMIN.slice(start, next === -1 ? ADMIN.length : next);
}

(async () => {
  out.push("[띠가 뜨는 조건]");
  const body = bodyOf("renderTestMode");
  check("renderTestMode 을 찾았다 (아래 측정의 전제)", body.length > 0);
  check(
    "★ 켜져 있으면 뜬다 — 이 기기가 참여했는지와 무관하게",
    /banner\.hidden\s*=\s*!st\.active/.test(body),
    "banner.hidden 이 st.active 가 아닌 다른 것을 보고 있다"
  );
  check(
    "★ `thisDevice` 하나로 띠를 숨기지 않는다",
    !/banner\.hidden\s*=\s*!st\.thisDevice/.test(body),
    "thisDevice 로 숨기면 켜둔 줄 모르고 하루를 보낸다"
  );

  out.push("\n[문구는 기기에 따라 갈린다]");
  // 참여하지 않은 기기에 "여기서 만드는 것은 사라집니다"라고 띄우면 그게
  // 더 위험한 거짓말이다 — 그 기기의 주문은 진짜로 남는다.
  check("★ 두 문구를 갈라 쓴다", /testBannerMine/.test(body) && /testBannerOther/.test(body), body.slice(0, 200));
  for (const lang of ["ko", "zh"]) {
    const start = ADMIN.indexOf(`\n    ${lang}: {`);
    const nextKo = ADMIN.indexOf("\n    zh: {", start + 1);
    const block = ADMIN.slice(start, nextKo === -1 ? ADMIN.length : nextKo);
    for (const key of ["testBannerMine", "testBannerOther", "testBannerEndBtn"]) {
      check(`${lang} 사전에 ${key} 가 있다`, new RegExp("(^|[\\s{,])" + key + "\\s*:", "m").test(block));
    }
  }
  check("참여 안 한 기기 문구가 '진짜로 남는다'고 말한다", /testBannerOther: "[^"]*진짜로 남/.test(ADMIN));
  // 2026-09-16 사장님: "테스터 모드에서는 결제 탭에서 결제 완료 했을 때
  // 실시간 주문 탭에서 결제 완료 칸으로 안가는데" — 참여하지 않은 기기에는
  // 테스트 주문이 **아예 안 보인다.** 그 사실을 말해주지 않으면 「결제했는데
  // 결제완료 칸에 안 온다」로 보인다. 띠가 그 자리에서 답해야 한다.
  check(
    "★ 테스트 주문이 이 화면에 안 보인다는 것도 말한다",
    /testBannerOther: "[^"]*안 보입니다/.test(ADMIN),
    "「이 기기는 평소 그대로」만으로는 왜 안 뜨는지 알 수 없다"
  );

  out.push("\n[끄는 버튼은 사장님만]");
  // 서버도 requireOwner 로 막는다. 직원 화면에 눌러도 안 되는 버튼을 두지 않는다.
  check("★ 직원에게는 종료 버튼을 숨긴다", /endBtn\.hidden\s*=\s*currentRole\s*!==\s*"owner"/.test(body), body.slice(0, 300));

  out.push("\n[띠가 실제로 있다]");
  check("admin.html 에 띠가 있다", HTML.includes('id="testModeBanner"'));
  check("띠가 화면 맨 위에 붙어 있다", /\.test-mode-banner\s*\{[^}]*position:\s*sticky/.test(CSS));
  check("★ 참여 안 한 기기용 모양이 따로 있다", CSS.includes(".test-mode-banner.is-other"));
  check("언어를 바꾸면 띠도 다시 그린다", /renderTestMode\(\);/.test(ADMIN.slice(ADMIN.indexOf("refreshOrderHoursI18n();"))));

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
