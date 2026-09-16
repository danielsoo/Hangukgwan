// 돈은 천 자리마다 쉼표가 찍히는가 — 화면도, 종이도, 손님 화면도.
//
// 2026-09-16 사장님: "그리고 모든 돈이 표시되는 액수에는 천 자리수마다 , 를
// 표시해줘 1,000 이렇게. 저 사진이라면 7,120 이렇게. 더 크면 7,120,120
// 이렇게."
//
// NT$7120 과 NT$712 는 흘깃 보면 같아 보인다. 마감에 서랍을 맞추거나 손님에게
// 금액을 부를 때 자릿수를 세고 있으면 안 된다.
//
// ── 이 시험이 재는 방식 ────────────────────────────────────────────────
//
// 「쉼표가 있나」를 글자로 훑지 않는다. 각 파일에서 **금액을 찍는 함수를
// 떼어내 실제로 돌려** 답을 본다. 그리고 남아 있는 NT$ 자리를 전부 세어,
// 하나라도 그 함수를 안 지나면 잡는다 — 한 자리만 빠져도 그 자리만 조용히
// 옛 모양으로 남는다.
const fs = require("fs");
const path = require("path");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const admin = read("public", "js", "admin.js");
const escpos = read("public", "js", "escpos.js");
const order = read("public", "js", "order.js");

/** 파일에서 함수 하나를 떼어내 돌린다. */
function lift(src, header, name, prelude = "") {
  const start = src.indexOf(header);
  if (start < 0) return null;
  const end = src.indexOf("\n  }\n", start);
  if (end < 0) return null;
  // eslint-disable-next-line no-new-func
  return new Function(`${prelude}\n${src.slice(start, end + 4)}\n return ${name};`)();
}

out.push("[관리자 화면]");
const adminMoney = lift(admin, "  function money(v) {", "money");
check("금액을 찍는 함수가 있다", typeof adminMoney === "function");
if (adminMoney) {
  check("★ 1000 → 1,000", adminMoney(1000) === "1,000", adminMoney(1000));
  check("★ 7120 → 7,120", adminMoney(7120) === "7,120", adminMoney(7120));
  check("★ 7120120 → 7,120,120", adminMoney(7120120) === "7,120,120", adminMoney(7120120));
  check("네 자리 미만은 그대로", adminMoney(230) === "230", adminMoney(230));
  check("0 은 0", adminMoney(0) === "0", adminMoney(0));
  check("음수도 자른다", adminMoney(-12345) === "-12,345", adminMoney(-12345));
  // 「NT$」 뒤에 아무것도 안 적히는 자리가 있다(판매가를 아직 안 정한 VIP
  // 카드). 거기에 0 을 찍으면 공짜라는 뜻이 된다.
  check("★ 빈 값은 빈 값으로 둔다 — 0 을 지어내지 않는다", adminMoney("") === "" && adminMoney(null) === "" && adminMoney(undefined) === "", `${adminMoney("")}/${adminMoney(null)}`);
  check("숫자가 아니면 그대로 둔다", adminMoney("무료") === "무료", adminMoney("무료"));
}

out.push("\n[종이 — 손님이 들고 가는 것]");
const escMoney = lift(escpos, "  function money(v) {", "money");
check("종이에도 같은 함수가 있다", typeof escMoney === "function");
if (escMoney && adminMoney) {
  for (const v of [1000, 7120, 7120120, 230, 0, ""]) {
    check(`화면과 종이가 같은 답을 낸다 (${JSON.stringify(v)})`, escMoney(v) === adminMoney(v), `${escMoney(v)} vs ${adminMoney(v)}`);
  }
}

out.push("\n[손님 화면]");
// 이 화면의 money() 는 통화 기호까지 붙인다(NT$ / ₩ / US$).
const orderMoney = lift(order, "  function money(n) {", "money", 'const CURRENCY_SYMBOL = { TWD: "NT$" };\nconst currency = "TWD";');
check("금액을 찍는 함수가 있다", typeof orderMoney === "function");
if (orderMoney) {
  check("★ 통화 기호와 쉼표가 같이 붙는다", orderMoney(7120) === "NT$7,120", orderMoney(7120));
  check("★ 더 큰 금액도", orderMoney(7120120) === "NT$7,120,120", orderMoney(7120120));
  check("네 자리 미만은 그대로", orderMoney(230) === "NT$230", orderMoney(230));
}
const orderComma = /const comma = \(n\) => \(Number\.isFinite/.test(order);
check("문구 안에 박히는 금액에도 규칙이 있다", orderComma, "최소 주문 금액 안내 같은 문구");
check(
  "★ 그 규칙이 쓰이는 곳보다 먼저 선언된다",
  order.indexOf("const comma = (n)") < order.indexOf("MIN_SPEND_NOTICE"),
  "뒤에 있으면 그 문구를 일찍 부르는 순간 터진다"
);

out.push("\n[빠진 자리가 없는가]");
// NT$ 뒤에 값을 끼워 넣는 자리를 전부 세어, 하나라도 money() 를 안 지나면 잡는다.
for (const [name, src, fn] of [["관리자 화면", admin, "money"], ["종이", escpos, "money"], ["손님 화면", order, "comma"]]) {
  const spots = src.match(/NT\$\$\{[^{}]*\}/g) || [];
  const bare = spots.filter((t) => !t.startsWith(`NT$\${${fn}(`));
  check(
    `★ ${name} — NT$ 자리 ${spots.length}개가 전부 ${fn}() 를 지난다`,
    bare.length === 0,
    bare.slice(0, 3).join(" , ")
  );
}
// 안 지나는 자리가 생기면 잡히는지 — 한 군데를 일부러 되돌려 본다.
// 바꿔 넣을 때 문자열을 쓰면 안 된다 — replace 의 치환 문자열에서 `$$` 는
// `$` 한 글자로 줄어든다. 함수로 넘겨야 적은 그대로 들어간다.
const broken = admin.replace("NT$${money(o.total)}", () => "NT$${o.total}");
const brokenSpots = (broken.match(/NT\$\$\{[^{}]*\}/g) || []).filter((t) => !t.startsWith("NT$${money("));
check("★ 한 자리만 빠져도 잡힌다", brokenSpots.length === 1, `${brokenSpots.length}`);

out.push("\n[창이 무엇보다 위에 있다]");
// 2026-09-16 사장님: "펼치면 저 위에가 x 가 없어지고 잘리는 것 같아."
// 목록을 펼치면 창이 길어져 위로 올라가는데, 테스터 모드 띠가 그 위를 덮어
// 닫기(✕) 버튼이 가려졌다. 창을 못 닫는 것은 갇히는 것이다.
const css = read("public", "css", "admin.css");
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
const zOf = (sel) => {
  // 주석을 먼저 걷어낸다. 안 그러면 주석 안에 적어둔 숫자를 규칙의 값으로
  // 읽는다 — 실제로 이 검사가 주석 속 「z-index: 60」에 먼저 걸렸다.
  const m = new RegExp(`\\n${sel.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*\\{([^}]*)\\}`).exec(cssNoComments);
  const z = m && /z-index:\s*(\d+)/.exec(m[1]);
  return z ? parseInt(z[1], 10) : null;
};
const zModal = zOf(".modal-backdrop");
const zBanner = zOf(".test-mode-banner");
const zTopbar = zOf(".admin-topbar");
check("창 바탕에 층이 정해져 있다", zModal != null, `${zModal}`);
check("★ 창이 테스터 모드 띠보다 위다", zModal != null && zBanner != null && zModal > zBanner, `창 ${zModal} vs 띠 ${zBanner}`);
check("★ 창이 위쪽 메뉴 바보다 위다", zModal != null && zTopbar != null && zModal > zTopbar, `창 ${zModal} vs 메뉴 ${zTopbar}`);

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
