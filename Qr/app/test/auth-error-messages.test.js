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

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
