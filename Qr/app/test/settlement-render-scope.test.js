// 결산 화면이 쓰는 도우미가 그 자리에서 실제로 보이는가.
//
// 2026-09-10 사장님(콘솔 캡처와 함께): 결산 화면의 1인당 평균부터 아래가
// 전부 0 이었다. 콘솔에는 이렇게 찍혀 있었다.
//
//   오전/오후 칸을 그리지 못했습니다: ReferenceError: nt is not defined
//     at fill (admin.js:2206)
//     at renderSettlementHalvesInner (admin.js:2212)
//
// 금액을 찍는 nt() 가 renderSettlement **안에** 있는 지역 함수였다. 오전/오후
// 칸을 그리는 함수는 그 바깥에 있어서 못 봤고, 거기서 죽으면서 뒤의 렌더가
// 통째로 멈췄다.
//
// 이 파일은 그 모양이 되돌아오지 않는지 잰다.
//   · 여러 곳에서 쓰는 도우미는 모듈 자리에 있어야 한다
//   · 쓰는 곳보다 위에 있어야 한다 (호출 순서가 바뀌어도 안전하게)
const fs = require("fs");
const path = require("path");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const src = fs.readFileSync(path.join(__dirname, "..", "public", "js", "admin.js"), "utf8");
const lines = src.split("\n");

// admin.js 는 전체가 하나의 IIFE 라 「모듈 자리」는 들여쓰기 2칸이다.
const declOf = (name) => {
  const re = new RegExp(`^(\\s*)(?:const|let|function)\\s+${name}\\b`);
  const hits = [];
  lines.forEach((l, i) => {
    const m = l.match(re);
    if (m) hits.push({ line: i + 1, indent: m[1].length });
  });
  return hits;
};
const usesOf = (name) => {
  const re = new RegExp(`(?<![A-Za-z0-9_$])${name}\\(`);
  return lines.map((l, i) => (re.test(l) ? i + 1 : 0)).filter(Boolean);
};

out.push("[1] 금액 표기 nt()");
{
  const decls = declOf("nt");
  check("★ 딱 한 번만 선언된다", decls.length === 1, JSON.stringify(decls));
  check("★ 모듈 자리에 있다 (들여쓰기 2칸)", decls[0] && decls[0].indent === 2, JSON.stringify(decls));
  const uses = usesOf("nt").filter((u) => u !== (decls[0] && decls[0].line));
  check("여러 곳에서 쓴다", uses.length >= 5, String(uses.length));
  check("★ 쓰는 곳이 전부 선언보다 아래다", decls[0] && uses.every((u) => u > decls[0].line), JSON.stringify(uses.filter((u) => decls[0] && u < decls[0].line)));
}

out.push("\n[2] 오전/오후 칸이 쓰는 다른 도우미들");
{
  // 이 함수는 renderSettlement 바깥에 있다. 거기서 부르는 것들이 전부
  // 모듈 자리에 있어야 같은 사고가 안 난다.
  const start = src.indexOf("function renderSettlementHalvesInner");
  const body = src.slice(start, src.indexOf("\n  }", start));
  for (const helper of ["fmtGuestSplit", "T"]) {
    const decls = declOf(helper);
    check(`${helper}: 모듈 자리`, decls.length >= 1 && decls[0].indent === 2, JSON.stringify(decls));
    check(`${helper}: 실제로 쓰인다`, body.includes(helper + "("), "");
  }
}

out.push("\n[3] 분류 이름 categoryLabel()");
{
  // 2026-09-11: 「안 팔린 메뉴」를 renderSettlement **바깥** 함수에서 그리며
  // 이걸 불렀다가, 지역 함수라 ReferenceError 로 목록이 통째로 비었다.
  // nt() 때와 똑같은 사고다. 브라우저 테스트(e2e-unsold-items)가 잡아줬지만,
  // 여기서 모양 자체를 막아둔다.
  const decls = declOf("categoryLabel");
  check("★ 딱 한 번만 선언된다", decls.length === 1, JSON.stringify(decls));
  check("★ 모듈 자리에 있다 (들여쓰기 2칸)", decls[0] && decls[0].indent === 2, JSON.stringify(decls));
  const uses = usesOf("categoryLabel").filter((u) => u !== (decls[0] && decls[0].line));
  check("여러 곳에서 쓴다", uses.length >= 2, String(uses.length));
  check("★ 쓰는 곳이 전부 선언보다 아래다", decls[0] && uses.every((u) => u > decls[0].line),
    JSON.stringify(uses.filter((u) => decls[0] && u < decls[0].line)));
}

out.push("\n[4] 그래도 터지면 나머지는 그린다");
{
  check("★ 통째로 감싸져 있다", /function renderSettlementHalves\(data\) \{[\s\S]{0,900}try \{[\s\S]{0,120}renderSettlementHalvesInner\(data\);[\s\S]{0,200}catch/.test(src), "");
  check("이유를 콘솔에 남긴다", /오전\/오후 칸을 그리지 못했습니다/.test(src), "");
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
