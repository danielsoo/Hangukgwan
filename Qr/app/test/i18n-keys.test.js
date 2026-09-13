// 화면에 번역 키가 그대로 노출되지 않는가.
//
// 2026-09-14 사장님이 설정 화면 사진을 보내셨다. 왼쪽 메뉴에 "진단 · 속도"
// 대신 `settingsCatDiag` 라는 글자가 그대로 떠 있었다. 진단 화면을 만들면서
// admin.html 에 data-i18n 키만 넣고 사전에 넣는 것을 잊은 것이다. 기능은
// 멀쩡한데 글자만 안 나오니 시험도 안 잡았다.
//
// 사람이 눈으로 세는 것은 387개짜리 목록에서 통하지 않는다. 그래서 센다.
const fs = require("fs");
const path = require("path");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const PUBLIC = path.join(__dirname, "..", "public");

// 사전 한 덩이 안에 `키:` 가 있는가. 값이 여러 줄이어도 상관없다.
function hasKey(block, key) {
  return new RegExp("(^|[\\s{,])" + key + "\\s*:", "m").test(block);
}

function keysUsedIn(html) {
  return [...new Set([...html.matchAll(/data-i18n(?:-[a-z]+)?="([^"]+)"/g)].map((m) => m[1]))];
}

// 사전이 몇 개든(지금은 ko, zh) 시작점을 찾아 잘라 쓴다. 언어가 하나 늘면
// 여기 목록에 한 줄 넣으면 된다.
function dictionaries(js, names) {
  const starts = names.map((n) => ({ name: n, at: js.indexOf(`\n    ${n}: {`) }));
  const missing = starts.filter((s) => s.at === -1).map((s) => s.name);
  if (missing.length) throw new Error(`사전을 못 찾았다: ${missing.join(", ")}`);
  starts.sort((a, b) => a.at - b.at);
  return starts.map((s, i) => ({
    name: s.name,
    text: js.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : js.length),
  }));
}

function audit(label, htmlFile, jsFile, langs) {
  const html = fs.readFileSync(path.join(PUBLIC, htmlFile), "utf8");
  const js = fs.readFileSync(path.join(PUBLIC, jsFile), "utf8");
  const keys = keysUsedIn(html);
  out.push(`\n[${label}] data-i18n 키 ${keys.length}개`);
  check(`${htmlFile} 가 번역 키를 실제로 쓰고 있다`, keys.length > 0);
  for (const dict of dictionaries(js, langs)) {
    const missing = keys.filter((k) => !hasKey(dict.text, k));
    check(
      `★ ${dict.name} 사전에 빠진 키가 없다`,
      missing.length === 0,
      missing.length ? `빠짐(${missing.length}): ${missing.slice(0, 12).join(", ")}` : ""
    );
  }
}

audit("관리자 화면", "admin.html", "js/admin.js", ["ko", "zh"]);

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
