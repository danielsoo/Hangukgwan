// 결제 창이 태블릿 한 화면에 들어오는가.
//
// 2026-09-16 사장님(스크린샷과 함께):
//   "이거 글자 많아져서 왼쪽으로 빠지는데 오른쪽이 고정이 되었으면 좋겠어.
//    그래서 차라리 처음부터 그 공간을 고려해서 넓직하게 가로길이를 하는 게
//    좋을 것 같아."
//   "테블릿 가로 세로 넓이를 항상 고려해줬으면 좋겠어. 지금 모든 창이나
//    그런 걸 태블릿이 주로 돌아간다고 생각하면 좋을 것 같아."
//   "저 미결제 합계랑 결제완료 의 가장 아래 행은 스크롤 안되고 중간에 있는
//    메뉴들만 스크롤로 해서 결제완료 행은 언제든 고정된 위치에서 편하게
//    누를 수 있게 하는 게 맞는 거 같아."
//
// 세 가지를 잰다.
//
//  1) 금액 칸의 **폭이 고정**인가. 할인이 걸리면 「NT$230」이
//     「NT$230 NT$207」이 된다. 폭을 안 잡아두면 줄이 좌우로 출렁이고,
//     품목·소계·합계의 숫자가 서로 다른 세로선에 선다.
//  2) 창이 **처음부터 넓은가**. 그리고 그 폭이 실제로 **먹는가** —
//     이게 핵심이다. 아래 cascade 참고.
//  3) **가운데만 굴러가는가**. 발(미결제 합계·결제 완료)이 목록 끝까지
//     내려가야 나오면, 제일 자주 누르는 버튼이 제일 찾기 어려워진다.
const fs = require("fs");
const path = require("path");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const css = fs.readFileSync(path.join(__dirname, "../public/css/admin.css"), "utf8");
const admin = fs.readFileSync(path.join(__dirname, "../public/js/admin.js"), "utf8");

/**
 * 「class="modal table-detail-modal" 인 요소에 실제로 먹는 값」을 고른다.
 *
 * 규칙을 그냥 찾아서 있으면 통과, 로 두면 안 된다. 이 파일에서 실제로
 * 그랬다: `.table-detail-modal { max-width: 480px }` 이 위에 있고
 * `.modal { max-width: 560px }` 이 700줄 아래에 있었는데, 둘 다 한 칸짜리
 * 선택자라 **나중 것이 이겼다.** 480px 은 몇 달 동안 조용히 무시되고
 * 있었고, 아무도 몰랐다. 그래서 여기서는 우선순위와 순서까지 따져
 * 「이긴 값」을 고른다.
 */
function winningDecl(classes, prop) {
  const has = (sel) =>
    sel
      .trim()
      .split(/(?=\.)/)
      .every((part) => !part.trim() || classes.includes(part.trim().replace(/^\./, "")));
  const body = css.replace(/@media[^{]*\{/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  let best = null;
  let order = 0;
  while ((m = re.exec(body))) {
    order++;
    const decls = m[2];
    const dm = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "i").exec(decls);
    if (!dm) continue;
    for (const sel of m[1].split(",")) {
      const s = sel.trim();
      // 클래스만으로 이루어진 선택자만 본다(자손 선택자·태그는 이 검사 밖).
      if (!/^\.[A-Za-z0-9_.-]+$/.test(s)) continue;
      if (!has(s)) continue;
      const spec = (s.match(/\./g) || []).length;
      if (!best || spec > best.spec || (spec === best.spec && order >= best.order)) {
        best = { value: dm[1].trim(), spec, order, sel: s };
      }
    }
  }
  return best;
}

out.push("[창 너비 — 처음부터 그 공간을 잡아둔다]");
const w = winningDecl(["modal", "table-detail-modal"], "max-width");
check("결제 창에 너비 규칙이 있다", !!w, "");
check(
  "★ 실제로 먹는 너비가 640px 이상이다",
  !!w && parseInt(w.value, 10) >= 640,
  `${w && w.sel} → ${w && w.value} (.modal 의 560px 에 지면 안 된다)`
);
check(
  "★ 태블릿 세로(768px)에도 들어간다",
  !!w && parseInt(w.value, 10) <= 728,
  `${w && w.value} — 바탕 여백 20px 씩을 뺀 728px 을 넘으면 잘린다`
);
const wide = winningDecl(["modal", "table-detail-modal", "wide"], "max-width");
check("카드가 격자로 뜰 때는 더 넓다", !!wide && parseInt(wide.value, 10) > parseInt(w.value, 10), `${wide && wide.value} vs ${w && w.value}`);

out.push("\n[금액 칸 — 폭이 고정이고 오른쪽 정렬]");
const cell = /\.pay-amount-cell\s*\{([^}]*)\}/.exec(css);
check("금액 칸 규칙이 있다", !!cell, "");
if (cell) {
  check("★ 최소 폭이 잡혀 있다", /min-width:\s*1[0-9]{2}px/.test(cell[1]), cell[1].trim());
  check("★ 오른쪽 정렬이다", /text-align:\s*right/.test(cell[1]), "");
  check("★ 줄바꿈되지 않는다 — 「NT$230 NT$207」이 두 줄로 쪼개지면 안 된다", /white-space:\s*nowrap/.test(cell[1]), "");
  check("★ 늘어나거나 줄어들지 않는다", /flex:\s*0 0 auto/.test(cell[1]), "");
}
check("폰에서는 최소 폭을 풀어준다", /@media[^{]*max-width:\s*5[0-9]{2}px[\s\S]{0,200}?\.pay-amount-cell[\s\S]{0,80}?min-width:\s*0/.test(css), "168px 을 고집하면 메뉴 이름이 짓눌린다");

out.push("\n[같은 세로선에 선다]");
for (const [what, re] of [
  ["품목 줄", /<span class="pay-amount-cell">\$\{vipPriceHtml\(/],
  ["소계", /pay-total-row[\s\S]{0,260}?subtotalLabel[\s\S]{0,120}?pay-amount-cell/],
  ["합계", /pay-total-row[\s\S]{0,260}?totalLabel[\s\S]{0,120}?pay-amount-cell/],
]) {
  check(`★ ${what} 이 금액 칸을 쓴다`, re.test(admin), "");
}
check("소계/합계 줄 규칙이 있다", /\.pay-total-row\s*\{[^}]*display:\s*flex/.test(css), "");

out.push("\n[가운데만 굴러간다]");
check(
  "★ 목록을 굴러가는 칸으로 감싼다",
  /table-detail-scroll">\$\{body\}<\/div>`/.test(admin),
  "감싸지 않으면 창 전체가 굴러가고 결제 버튼이 목록 끝까지 내려간다"
);
check(
  "★ 발은 그 칸 **밖**에 있다",
  /table-detail-scroll">\$\{body\}<\/div>`\s*\+\s*footer/.test(admin),
  "발이 안에 들어가면 같이 굴러간다"
);
const scroll = /\.table-detail-scroll\s*\{([^}]*)\}/.exec(css);
check("굴러가는 칸 규칙이 있다", !!scroll, "");
if (scroll) {
  check("★ 세로로 굴러간다", /overflow-y:\s*auto/.test(scroll[1]), scroll[1].trim());
  check(
    "★ min-height: 0 이 있다 — 없으면 flex 자식이 안 줄어들어 스크롤이 아예 안 생긴다",
    /min-height:\s*0/.test(scroll[1]),
    scroll[1].trim()
  );
}
const modalRule = /\.modal\.table-detail-modal\s*\{([^}]*)\}/.exec(css);
check("★ 창이 세로 flex 다", !!modalRule && /flex-direction:\s*column/.test(modalRule[1]), "");
check("★ 창 자신은 안 굴러간다", !!modalRule && /overflow:\s*hidden/.test(modalRule[1]), "굴러가는 것은 가운데 하나뿐이어야 한다");
const bodyRule = /#tableDetailBody\s*\{([^}]*)\}/.exec(css);
check("본문도 세로 flex 다", !!bodyRule && /flex-direction:\s*column/.test(bodyRule[1]) && /min-height:\s*0/.test(bodyRule[1]), "");
const footRule = /\.table-detail-modal \.table-detail-footer\s*\{([^}]*)\}/.exec(css);
check("★ 발은 줄어들지 않는다", !!footRule && /flex:\s*none/.test(footRule[1]), "");
check("발 뒤가 비치지 않는다", !!footRule && /background:\s*#fff/.test(footRule[1]), "");

out.push("\n[결제 버튼은 언제나 오른쪽 끝]");
//
// 2026-09-16 사장님(두 번째): "일단 결제완료가 여전히 왼쪽으로 빠져."
// 왼쪽 묶음(미결제 합계 + VIP카드 판매)이 넓어지면 결제 버튼이 다음 줄로
// 넘어갔고, 혼자 남은 줄에서는 space-between 이 아무 일도 안 해서 왼쪽에
// 붙었다. 할인이 걸려 「NT$250 NT$238」로 길어지는 순간 그렇게 된다.
// 줄 맨 앞에서 시작하는 규칙만 본다 — `.table-detail-modal .table-detail-footer`
// 같은 다른 규칙에 걸리면 엉뚱한 것을 재게 된다(실제로 한 번 그랬다).
const foot = /\n\.table-detail-footer\s*\{([^}]*)\}/.exec(css);
check("발 규칙이 있다", !!foot, "");
check(
  "★ 발 줄은 안 접힌다 — 접히면 버튼이 다음 줄 왼쪽으로 떨어진다",
  !!foot && /flex-wrap:\s*nowrap/.test(foot[1]),
  foot && foot[1].trim()
);
const footLeft = /\.table-detail-footer-left\s*\{([^}]*)\}/.exec(css);
check(
  "★ 좁아지면 왼쪽 묶음이 자기 안에서 접는다",
  !!footLeft && /flex-wrap:\s*wrap/.test(footLeft[1]) && /min-width:\s*0/.test(footLeft[1]),
  "min-width: 0 이 없으면 flex 자식이 안 줄어들어 버튼을 밀어낸다"
);
const footBtn = /\.table-detail-footer\s*>\s*\.primary-btn\s*\{([^}]*)\}/.exec(css);
check("버튼 규칙이 있다", !!footBtn, "");
if (footBtn) {
  check("★ 버튼은 오른쪽 끝에 붙는다", /margin-left:\s*auto/.test(footBtn[1]), footBtn[1].trim());
  check("★ 버튼은 줄어들지 않는다", /flex:\s*0 0 auto/.test(footBtn[1]), "");
  check("★ 버튼 글자가 쪼개지지 않는다", /white-space:\s*nowrap/.test(footBtn[1]), "");
}

out.push("\n[태블릿에서 창 높이를 실제로 보이는 높이로 잰다]");
//
// 2026-09-16 사장님(태블릿 스크린샷과 함께): "이것도 여전히 짤리고."
// 주문이 많은 자리를 열면 발이 화면 아래로 넘어가 안 보였다.
//
// 태블릿 브라우저에서 100vh 는 **주소창까지 포함한 큰 쪽**이다. 그래서
// 90vh 로 잡은 창이 실제로 보이는 영역보다 길어지고 맨 아래 줄이 숨는다.
// 데스크톱에는 그 차이가 없어서 여기서는 멀쩡해 보인다 — 실제로 그래서
// 못 잡았다. dvh 는 지금 보이는 높이다.
const modalBlock = /\n\.modal\s*\{([^}]*)\}/.exec(css);
check("창 규칙이 있다", !!modalBlock, "");
if (modalBlock) {
  check(
    "★ 창 높이를 dvh 로 잰다",
    /max-height:\s*\d+dvh/.test(modalBlock[1]),
    "vh 만 쓰면 태블릿에서 맨 아래 줄이 주소창 뒤로 숨는다"
  );
  check(
    "★ dvh 를 모르는 브라우저를 위해 vh 를 먼저 적는다",
    /max-height:\s*\d+vh[\s\S]*max-height:\s*\d+dvh/.test(modalBlock[1]),
    "순서가 뒤집히면 옛 브라우저에서 높이가 아예 안 걸린다"
  );
  check(
    "창 자신도 flex 최소 높이에 안 밀린다",
    /min-height:\s*0/.test(modalBlock[1]),
    ""
  );
}
const backdrop = /\.modal-backdrop\s*\{([^}]*)\}/.exec(css);
check(
  "★ 가운데 맞추는 바탕도 같은 높이를 쓴다",
  !!backdrop && /height:\s*100vh[\s\S]*height:\s*100dvh/.test(backdrop[1]),
  "바탕이 큰 쪽으로 잡히면 창이 가운데가 아니라 아래로 밀린다"
);

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
