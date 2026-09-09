// 사이트 전체가 정해진 글자 크기 단계만 쓰는지, 그리고 손님이 읽는 글자가
// 12px 아래로 내려가지 않는지.
//
// 2026-09-09 사장님: "여전히 어떤 건 작고 어떤 건 불필요하게 되어있고."
// 재보니 홈 한 페이지에 서로 다른 크기가 27가지였고(13과 13.5, 14/14.5/
// 15/15.5 처럼 눈으로는 구분이 안 되는 값들이 섞여 있었다), 소스에는 크기
// 지정이 160군데에 23가지 값으로 흩어져 있었다.
//
// 새 크기를 하나 더 만드는 건 언제나 쉬우므로, 규칙을 코드로 지킨다.
const fs = require("fs");
const path = require("path");

const WEB = path.join(__dirname, "..", "..", "..", "Web", "src");

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
    else if (/\.(tsx?|js)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

const files = walk(WEB);
const css = fs.readFileSync(path.join(WEB, "app", "globals.css"), "utf8");

out.push("\n[단계가 정의되어 있다]");
const TOKENS = ["--fs-xs", "--fs-sm", "--fs-base", "--fs-md", "--fs-lg", "--fs-xl", "--fs-title", "--fs-display", "--fs-hero"];
for (const t of TOKENS) check(`${t} 정의됨`, new RegExp(`${t}:\\s*[^;]+;`).test(css));

out.push("\n[손님이 읽는 글자는 12px 아래로 안 내려간다]");
// 단계는 clamp(최소, 기울기, 최대) 형태다. 첫 값이 어떤 화면에서도 내려가지
// 않는 바닥이므로 그걸 본다.
const xsClamp = (css.match(/--fs-xs:\s*clamp\(\s*([0-9.]+)px/) || [, "0"])[1];
check(`--fs-xs 의 최소값이 12px 이상 (${xsClamp}px)`, parseFloat(xsClamp) >= 12, xsClamp);

out.push("\n[화면 크기를 따라간다]");
// 고정 px 로 잡아두면 27인치 모니터에서 본문이 잡지 글씨만 해진다.
// 사장님: "현재 내 모니터에 비해 사이트 글자나 로고 크기나 터무니없이 작아."
for (const t of ["--fs-xs", "--fs-sm", "--fs-base", "--fs-md", "--fs-lg"]) {
  const line = (css.match(new RegExp(`${t}:\\s*([^;]+);`)) || [, ""])[1];
  check(`${t} 가 화면 폭을 쓴다`, /clamp\(/.test(line) && /vw/.test(line), line);
}
// 최대값이 최소값보다 실제로 커야 한다(clamp 만 씌우고 같은 값이면 의미 없다)
for (const t of ["--fs-base", "--fs-lg"]) {
  const m = css.match(new RegExp(`${t}:\\s*clamp\\(\\s*([0-9.]+)px[^,]*,[^,]*,\\s*([0-9.]+)px`));
  check(`${t} 최대값 > 최소값`, m && parseFloat(m[2]) > parseFloat(m[1]), m ? `${m[1]} → ${m[2]}` : "형식 불일치");
}

out.push("\n[크기를 직접 적은 곳이 남아 있지 않다]");
// 예외는 두 개뿐: 드롭다운 화살표(장식)와 큰 장식 숫자.
const ALLOWED_RAW = new Set(["10", "64"]);
const offenders = [];
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  for (const m of src.matchAll(/fontSize: *(?:['"]([0-9.]+)(?:px)?['"]|([0-9.]+))(?![0-9a-zA-Z.])/g)) {
    const v = m[1] || m[2];
    if (!ALLOWED_RAW.has(v)) offenders.push(`${path.relative(WEB, f)}: ${v}`);
  }
  for (const m of src.matchAll(/fontSize: *['"]clamp\(([^'"]*)\)['"]/g)) {
    offenders.push(`${path.relative(WEB, f)}: clamp(${m[1]})`);
  }
}
check("원시 크기 값이 없다", offenders.length === 0, offenders.slice(0, 8).join(" | "));

out.push("\n[사진 자리에 개발용 메모가 남아 있지 않다]");
// 사진이 없는 동안 "招牌菜特寫 · A signature dish, close up" 같은 메모가
// 손님 화면에 그대로 보이고 있었다. label 은 사진이 왔을 때 alt 로만 쓴다.
const ph = fs.readFileSync(path.join(WEB, "components", "ImagePlaceholder.tsx"), "utf8");
const emptyBranch = ph.slice(ph.lastIndexOf("return ("));
check("빈 상태에서 label 을 그리지 않는다", !emptyBranch.includes("{label}"), emptyBranch.slice(0, 200));
check("사진이 오면 label 을 alt 로 쓴다", /alt=\{alt \|\| label\}/.test(ph));

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
