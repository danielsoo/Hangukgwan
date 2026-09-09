// 내용이 놓이는 폭과, 헤더의 정사각 아이콘 버튼 안쪽 정렬.
//
// 2026-09-09 사장님: "톱니바퀴가 정중앙이 아니야. 또 헤더랑 전체적인
// 웹사이트 양 끝 공백이 너무 놀고 있어서."
//
// 두 문제 다 원인이 "같은 값을 여러 군데에 손으로 적어 둔 것"이었다.
//  - 폭: maxWidth: 1320 이 15군데. 노트북 기준 숫자라 큰 모니터에서는
//    양옆이 각각 340px 씩 그냥 비었다.
//  - 톱니바퀴: 버튼마다 alignItems/justifyContent 를 style 로 넣었는데
//    display 를 안 줘서(버튼 기본값은 inline-block) 두 줄 다 무효였다.
//    아이콘은 글자 밑선에 앉아 아래로 치우쳤다.
const fs = require("fs");
const path = require("path");

const WEB = path.join(__dirname, "..", "..", "..", "Web", "src");
const css = fs.readFileSync(path.join(WEB, "app", "globals.css"), "utf8");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(tsx|ts|jsx)$/.test(e.name)) acc.push(p);
  }
  return acc;
}
const files = walk(WEB);

out.push("[내용 폭을 한 곳에서 정한다]");
const shellMax = (css.match(/--shell-max:\s*([^;]+);/) || [, ""])[1].trim();
const shellPad = (css.match(/--shell-pad:\s*([^;]+);/) || [, ""])[1].trim();
check("--shell-max 가 있다", shellMax.length > 0);
check("--shell-pad 가 있다", shellPad.length > 0);
check("--shell-max 가 화면 폭을 따라간다", /vw/.test(shellMax), shellMax);
check("--shell-max 에 상한이 있다", /min\(/.test(shellMax) && /px/.test(shellMax), shellMax);
check("--shell-pad 가 화면 폭을 따라간다", /clamp\(/.test(shellPad) && /vw/.test(shellPad), shellPad);

// 상한이 예전 1320 보다 실제로 넓어야 한다 — 안 그러면 고친 의미가 없다.
const cap = parseFloat((shellMax.match(/([0-9.]+)px/) || [, "0"])[1]);
check("상한이 예전(1320px)보다 넓다", cap > 1320, `${cap}px`);
// 그렇다고 무한정 넓히면 한 줄이 너무 길어져 눈이 다음 줄을 못 찾는다.
check("상한이 지나치게 넓지는 않다", cap <= 1920, `${cap}px`);

out.push("\n[숫자를 다시 흩뿌리지 않는다]");
const hardWidth = [];
const hardPad = [];
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const rel = path.relative(WEB, f);
  for (const m of src.matchAll(/maxWidth: *(\d{4})\b/g)) hardWidth.push(`${rel}: ${m[1]}`);
  // 예전 좌우 여백 값 두 가지 — 헤더와 섹션이 서로 다른 값을 쓰고 있었다.
  for (const m of src.matchAll(/clamp\((?:20px, 3\.5vw|12px, 3vw), 48px\)/g)) hardPad.push(rel);
}
check("네 자리 고정 폭이 남아 있지 않다", hardWidth.length === 0, hardWidth.slice(0, 8).join(" | "));
check("옛 좌우 여백 값이 남아 있지 않다", hardPad.length === 0, [...new Set(hardPad)].join(" | "));

// 껍데기를 쓰는 곳은 폭과 여백을 둘 다 변수로 받아야 한다. 하나만 바꾸면
// 헤더와 본문의 왼쪽 끝이 어긋난다.
const shellUsers = files.filter((f) => fs.readFileSync(f, "utf8").includes("var(--shell-max)"));
check("껍데기를 쓰는 파일이 여럿이다", shellUsers.length >= 10, String(shellUsers.length));
const padMissing = shellUsers.filter((f) => !fs.readFileSync(f, "utf8").includes("var(--shell-pad)"));
check("폭을 쓰는 곳은 여백도 같이 쓴다", padMissing.length === 0, padMissing.map((f) => path.relative(WEB, f)).join(" | "));

out.push("\n[아이콘 버튼이 안쪽을 가운데로 잡는다]");
const btn = (css.match(/\.hg-icon-btn \{([\s\S]*?)\}/) || [, ""])[1];
check(".hg-icon-btn 이 flex 다", /display:\s*inline-flex/.test(btn), btn.trim().slice(0, 80));
check("가로 가운데", /justify-content:\s*center/.test(btn));
check("세로 가운데", /align-items:\s*center/.test(btn));
// 버튼 기본 padding(브라우저마다 다르다)이 남아 있으면 34×34 안에서
// 아이콘이 한쪽으로 밀린다.
check("버튼 기본 여백을 지운다", /padding:\s*0/.test(btn));
check("아이콘이 글자 밑선을 만들지 않는다", /\.hg-icon-btn > svg \{[^}]*display:\s*block/.test(css));

// 정렬을 style 로 되돌려 놓으면(그리고 display 를 또 빠뜨리면) 같은 버그가
// 그대로 돌아온다.
const header = fs.readFileSync(path.join(WEB, "components", "Header.tsx"), "utf8");
const inlineAlign = /alignItems: 'center', justifyContent: 'center', width:/.test(header);
check("헤더가 정렬을 style 로 다시 적지 않는다", !inlineAlign);
check("톱니바퀴가 .hg-icon-btn 을 쓴다", /hg-icon-btn hg-settings-btn/.test(header));
check("햄버거가 .hg-icon-btn 을 쓴다", /hg-icon-btn hg-hamburger/.test(header));
// 톱니바퀴와 로그인이 같은 높이 변수를 쓴다 — 34px 과 42px 로 갈려서
// 나란히 두면 층이 졌다.
check("헤더 버튼 높이를 한 곳에서 정한다", /--hdr-btn-h:/.test(css));
check("톱니바퀴·햄버거가 그 높이를 쓴다",
  (header.match(/height: 'var\(--hdr-btn-h\)'/g) || []).length >= 3,
  String((header.match(/var\(--hdr-btn-h\)/g) || []).length));
// .hg-icon-btn 에 display 가 생겼으니, 햄버거를 숨기는 규칙이 그 뒤에
// 있어야 좁은 화면 전에는 안 보인다.
check("햄버거 숨김 규칙이 뒤에 온다", css.indexOf(".hg-hamburger { display: none; }") > css.indexOf(".hg-icon-btn {"));

out.push("\n[줄바꿈 규칙은 언어별로 다르다]");
// keep-all 은 한국어용이다. 중국어는 띄어쓰기가 없어서 keep-all 을 걸면
// 문단이 통째로 한 줄이 되고, 800px 폭에서 화면 밖으로 흘러넘쳤다.
const kaSel = (css.match(/([^\n{]*)\{\s*\n?\s*word-break:\s*keep-all/) || [, ""])[1];
check("keep-all 은 한국어에만 건다", /:lang\(ko\)/.test(kaSel) && !/:lang\(zh\)/.test(kaSel), kaSel.trim());
// 그러려면 <html lang> 이 실제로 보고 있는 언어를 따라가야 한다.
// layout.tsx 는 zh-Hant 를 박아 두고 한 번도 바꾸지 않았다.
const ctx = fs.readFileSync(path.join(WEB, "context", "LanguageContext.tsx"), "utf8");
check("<html lang> 을 언어에 맞춰 바꾼다", /document\.documentElement\.lang\s*=/.test(ctx));
check("세 언어 모두 태그가 있다", /'zh-TW':\s*'zh-Hant'/.test(ctx) && /ko:\s*'ko'/.test(ctx) && /en:\s*'en'/.test(ctx));

out.push("\n[글 폭이 자기 칸을 넘지 않는다]");
// maxWidth: '24ch' 만 적으면 칸이 그보다 좁아도 줄어들지 않는다.
const rawCh = [];
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  for (const m of src.matchAll(/maxWidth: *'(\d+)ch'/g)) rawCh.push(`${path.relative(WEB, f)}: ${m[1]}ch`);
}
check("ch 폭은 100% 로도 묶여 있다", rawCh.length === 0, rawCh.slice(0, 8).join(" | "));

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
