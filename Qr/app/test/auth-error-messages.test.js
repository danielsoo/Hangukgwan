// 로그인 화면이 오류를 사장님이 알아볼 수 있게 말하는지.
//
// 2026-09-08 실제로 겪은 일: Firebase 승인된 도메인에 주소를 안 넣은 상태로
// 구글 버튼을 누르면 화면에는 "문제가 발생했습니다. 잠시 후 다시 시도해
// 주세요." 만 떴다. 무엇을 해야 하는지는 브라우저 콘솔에만 있었고, 그건
// 사장님이 열어볼 곳이 아니다.
//
// AuthShell.tsx 는 TSX 라 여기서 require 할 수 없어서, 매핑 표와 문구가
// 실제로 존재하는지 소스에서 확인한다.
const fs = require("fs");
const path = require("path");

const WEB = path.join(__dirname, "..", "..", "..", "Web", "src");
const shell = fs.readFileSync(path.join(WEB, "components", "account", "AuthShell.tsx"), "utf8");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const NEEDED = {
  "auth/unauthorized-domain": "google_domain_not_authorized",
  "auth/operation-not-allowed": "google_not_enabled",
  "auth/popup-blocked": "google_popup_blocked",
  "auth/network-request-failed": "network_failed",
};

out.push("\n[Firebase 오류를 우리 문구로 옮긴다]");
for (const [code, key] of Object.entries(NEEDED)) {
  check(`${code} → ${key}`, shell.includes(`'${code}': '${key}'`), "매핑 없음");
}
// Firebase 는 "Firebase: Error (auth/unauthorized-domain)." 같은 문장으로 던진다.
check("문장 속에서 auth/... 코드를 뽑아낸다", /match\(\/auth\\\/\[a-z-\]\+\/i\)/.test(shell), "정규식 없음");

out.push("\n[팝업 차단은 '취소' 로 삼키지 않는다]");
// 사용자가 닫은 게 아니라 브라우저가 막은 것이라, 조용히 넘어가면
// "버튼을 눌러도 아무 일이 없다" 가 된다.
const cancelFn = (shell.match(/export function isPopupCancel[\s\S]*?\n}/) || [""])[0];
check("isPopupCancel 이 popup-blocked 를 포함하지 않는다", !/popup-blocked/.test(cancelFn), cancelFn.slice(0, 200));
check("사용자가 닫은 경우는 여전히 취소로 본다", /popup-closed/.test(cancelFn));

out.push("\n[세 언어 모두 문구가 있다]");
for (const lang of ["ko", "en", "zh-TW"]) {
  const src = fs.readFileSync(path.join(WEB, "locales", `${lang}.ts`), "utf8");
  for (const key of Object.values(NEEDED)) {
    check(`${lang}: ${key}`, new RegExp(`${key}:\\s*'[^']+'`).test(src), "문구 없음/비어있음");
  }
}

out.push("\n[문구가 실제로 무엇을 하라고 말하는지]");
const ko = fs.readFileSync(path.join(WEB, "locales", "ko.ts"), "utf8");
const line = (ko.match(/google_domain_not_authorized:\s*'([^']+)'/) || [, ""])[1];
check("어디로 가야 하는지 알려준다", /Authentication/.test(line) && /승인된 도메인/.test(line), line);
check("일반 오류 문구와 다르다", !/문제가 발생했습니다/.test(line), line);

out.push("\n[타입에도 들어가 있다 — 언어 하나만 빠지는 것을 막는다]");
const types = fs.readFileSync(path.join(WEB, "locales", "types.ts"), "utf8");
for (const key of Object.values(NEEDED)) {
  check(`types: ${key}`, new RegExp(`${key}:\\s*string`).test(types));
}

out.push("\n[서버에 닿지 못한 것과 비밀번호가 틀린 것은 다르다]");
// 2026-09-10 사장님이 로컬에서 겪은 일 — 홈페이지만 따로 띄우면 그 포트에는
// API 가 없어서 404 가 오는데, 화면에는 "문제가 발생했습니다" 만 떴다.
// 원인(주소가 안 맞는다)이 어디에도 안 나오니 비밀번호를 몇 번이고 다시
// 치게 된다. 닿지 못한 것과 서버가 거절한 것은 해야 할 일이 다르다.
{
  const authCtx = fs.readFileSync(path.join(WEB, "context", "AuthContext.tsx"), "utf8");
  check("fetch 가 실패하면 network_error 로 구분한다",
    /catch \{[\s\S]*?throw new Error\('network_error'\)/.test(authCtx), "구분이 없다");
  check("JSON 이 아닌 404 는 api_not_found 로 구분한다",
    /res\.status === 404 \? 'api_not_found'/.test(authCtx), "구분이 없다");
  check("그래도 서버가 준 오류 코드는 그대로 쓴다",
    /throw new Error\(data\.error \|\| 'server_error'\)/.test(authCtx));
  for (const lang of ["ko", "en", "zh-TW"]) {
    const src = fs.readFileSync(path.join(WEB, "locales", `${lang}.ts`), "utf8");
    check(`${lang}: network_error 문구가 있다`, /network_error:/.test(src));
    check(`${lang}: api_not_found 문구가 있다`, /api_not_found:/.test(src));
  }
  const ko = fs.readFileSync(path.join(WEB, "locales", "ko.ts"), "utf8");
  const line = (/network_error: '([^']*)'/.exec(ko) || [, ""])[1];
  check("연결 실패 문구가 비밀번호 탓을 하지 않는다",
    !/비밀번호|이메일/.test(line), line);
  check("연결 실패 문구가 무엇을 확인할지 말해준다", /연결/.test(line), line);
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
