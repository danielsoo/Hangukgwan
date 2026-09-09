// 언어마다 문구가 빠짐없이 있는가.
//
// 2026-09-10 사장님: "이 기능애들도 언어 중국어 한국어 적용되게 해줘."
//
// 새 기능을 넣을 때 한국어만 적고 중국어를 잊는 일이 반복된다. 빠져도
// 화면은 멀쩡히 뜬다 — T() 가 없는 키는 키 이름이나 다른 언어 문구를 그대로
// 내보내기 때문이다. 그래서 중국어로 쓰는 직원이 열어봐야만 드러난다.
// 여기서 미리 잡는다.
//
// 파일을 그대로 require 할 수 없어서(브라우저용 IIFE, document 를 쓴다)
// 표의 키만 읽어낸다. 문구의 내용이 아니라 "빠진 키가 있는가" 만 본다.
const fs = require("fs");
const path = require("path");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

// "  lang: {" 로 시작해서 같은 들여쓰기의 "}," 로 끝나는 덩어리 안의
// 최상위 키들을 읽는다. 값 안에 중괄호가 들어가는 경우는 지금 없고,
// 있으면 아래 균형 계산이 알아서 건너뛴다.
function keysOf(src, langLine) {
  const start = src.indexOf(langLine);
  if (start < 0) return null;
  let i = src.indexOf("{", start);
  let depth = 0;
  let end = i;
  for (; end < src.length; end++) {
    if (src[end] === "{") depth++;
    else if (src[end] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  const body = src.slice(i + 1, end);
  const keys = new Set();
  // 한 단계 안쪽(들여쓰기 6칸 또는 4칸)의 "key:" 만 센다.
  for (const m of body.matchAll(/^\s{4,6}([A-Za-z_][A-Za-z0-9_]*):/gm)) keys.add(m[1]);
  return keys;
}

function compare(label, file, langs) {
  const src = fs.readFileSync(file, "utf8");
  const sets = {};
  for (const [lang, line] of Object.entries(langs)) {
    const k = keysOf(src, line);
    check(`${label}: ${lang} 표를 읽었다`, !!k && k.size > 20, k ? `${k.size}개` : "못 찾음");
    sets[lang] = k || new Set();
  }
  const names = Object.keys(sets);
  const base = names[0];
  for (const other of names.slice(1)) {
    const missing = [...sets[base]].filter((k) => !sets[other].has(k));
    const extra = [...sets[other]].filter((k) => !sets[base].has(k));
    check(`${label}: ${other} 에 빠진 문구가 없다`, missing.length === 0,
      missing.slice(0, 12).join(", ") + (missing.length > 12 ? ` … +${missing.length - 12}` : ""));
    check(`${label}: ${other} 에만 있는 문구도 없다`, extra.length === 0,
      extra.slice(0, 12).join(", ") + (extra.length > 12 ? ` … +${extra.length - 12}` : ""));
  }
  out.push(`  ·    ${label}: ${names.map((n) => `${n} ${sets[n].size}개`).join(" / ")}`);
}

out.push("[관리자 화면]");
compare("admin.js", path.join(__dirname, "..", "public", "js", "admin.js"), {
  ko: "\n    ko: {",
  zh: "\n    zh: {",
});

out.push("\n[손님 화면]");
compare("i18n.js", path.join(__dirname, "..", "public", "js", "i18n.js"), {
  zh: "\n  zh: {",
  ko: "\n  ko: {",
  en: "\n  en: {",
});

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
