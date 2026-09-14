// 손님 장바구니의 「삭제」 버튼이 글자를 쪼개지 않는가.
//
// 사장님(2026-09-14, 손님 화면 사진과 함께): "저거 빨간색으로 동그라미
// 그려준 게 디자인이 너무 엉성해. 가로로 길게 제대로 해줘."
//
// 「移除」가 移 / 除 로 두 줄에 쪼개져 동그라미 밖으로 삐져나와 있었다.
// 원인은 이 한 줄이었다.
//
//     .cart-item-qty-ctrl button { width: 24px; height: 24px; ... }
//
// −/+ 를 위한 규칙인데 같은 자리의 삭제 버튼까지 물려받았다. 24px 안에 두
// 글자가 안 들어가니 줄바꿈이 난다. 한국어 「삭제」도 두 글자, 영어
// 「Remove」는 여섯 글자라 **세 언어 모두** 깨진다.
const fs = require("fs");
const path = require("path");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const APP = path.join(__dirname, "..");
const CSS = fs.readFileSync(path.join(APP, "public", "css", "main.css"), "utf8");
const ORDER = fs.readFileSync(path.join(APP, "public", "js", "order.js"), "utf8");
const I18N = fs.readFileSync(path.join(APP, "public", "js", "i18n.js"), "utf8");

// 규칙 하나를 { } 까지 통째로 꺼낸다.
function ruleFor(selector) {
  const i = CSS.indexOf(selector);
  if (i === -1) return null;
  const open = CSS.indexOf("{", i);
  const close = CSS.indexOf("}", open);
  return open === -1 || close === -1 ? null : CSS.slice(open + 1, close);
}

(async () => {
  out.push("[삭제 버튼이 −/+ 와 다른 것이 된다]");
  check("★ 삭제 버튼에 자기 클래스가 있다", /class="cart-item-remove"[^>]*data-act="remove"|data-act="remove"[^>]*class="cart-item-remove"/.test(ORDER),
    "클래스가 없으면 .cart-item-qty-ctrl button 규칙을 그대로 받는다");
  check("인라인 style 로 때우지 않는다", !/data-act="remove" style=/.test(ORDER));

  const rule = ruleFor(".cart-item-qty-ctrl .cart-item-remove");
  check("★ 삭제 버튼 규칙이 있다", !!rule);
  if (rule) {
    check("★ 글자를 쪼개지 않는다 (white-space: nowrap)", /white-space:\s*nowrap/.test(rule),
      "이게 빠지면 두 글자가 다시 두 줄이 된다");
    check("★ 가로로는 글자에 맞춰 늘어난다 (width: auto)", /width:\s*auto/.test(rule),
      "고정 너비면 언어가 바뀔 때마다 깨진다");
    check("좌우 여백이 있다", /padding:\s*0\s+\d+px/.test(rule));
    check("★ 좁은 화면에서 찌그러지지 않는다 (flex: none)", /flex:\s*none/.test(rule));
    check("−/+ 와 높이가 같다", /height:\s*28px/.test(rule));
  }

  out.push("\n[−/+ 는 여전히 동그라미다]");
  const qty = ruleFor(".cart-item-qty-ctrl button");
  check("−/+ 규칙이 있다", !!qty);
  if (qty) {
    check("가로세로가 같다 (동그라미)", /width:\s*28px/.test(qty) && /height:\s*28px/.test(qty), qty.trim());
    check("둥글다", /border-radius:\s*999px/.test(qty));
  }

  out.push("\n[세 언어 모두 글자 수가 다르다 — 그래서 고정 너비면 안 된다]");
  const words = {};
  for (const m of I18N.matchAll(/remove:\s*"([^"]+)"/g)) words[m[1]] = (m[1] || "").length;
  const lens = Object.entries(words).map(([w, n]) => `${w}(${n})`);
  check("★ 세 언어의 「삭제」를 모두 찾았다", Object.keys(words).length >= 3, lens.join(", "));
  check("★ 길이가 서로 다르다", new Set(Object.values(words)).size > 1, lens.join(", "));

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
