// 맵기에는 늘 「基本」이 있고, 그게 기본으로 골라져 있다.
//
// 사장님(2026-09-10): "매운맛 선택이 무조건 첫번째거로 선택되어있어" →
// "맵기 기본에 늘 기본이 있어야 하고 그게 기본 세팅으로 선택이 되어있어야 해."
//
// ── 무슨 일이었나 ─────────────────────────────────────────────────────
//
// 씨앗 데이터는 맵기가 있는 메뉴마다 「基本,小辣」처럼 基本 을 첫 칸에 두고
// 있었다. 화면이 첫 칸을 미리 고르니, 아무것도 안 건드린 손님에게는 基本 이
// 나갔다 — 의도대로다.
//
// 그런데 운영 데이터에서 일부 메뉴의 基本 이 빠져 있었다(「不辣,中辣」,
// 「小辣」). 그러면 첫 칸이 매운맛이 되고, 안 매운 것을 원하던 손님에게
// 매운 것이 나간다. 그 접시는 주방이 다시 만든다.
//
// 고친 방향: 「첫 칸을 고른다」가 아니라 「基本 을 고른다」로 못 박는다.
// 데이터가 어떻게 생겼든 화면에는 늘 基本 이 있고 늘 그것이 켜져 있다.
// 저장된 데이터도 마이그레이션으로 같이 고친다.
const fs = require("fs");
const path = require("path");
const { withBasic, BASIC } = require("../src/migrations/2026-09-10-spice-basic");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}
const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

out.push("[1] 저장된 데이터를 고친다");
{
  check("★ 基本 이 빠진 목록에 맨 앞으로 넣는다", withBasic("不辣,中辣") === "基本,不辣,中辣", withBasic("不辣,中辣"));
  check("★ 한 칸짜리도 고친다", withBasic("小辣") === "基本,小辣", String(withBasic("小辣")));
  check("이미 있으면 건드리지 않는다", withBasic("基本,小辣") === null, String(withBasic("基本,小辣")));
  check("맨 앞이 아니어도 있으면 그대로 둔다", withBasic("小辣,基本") === null, String(withBasic("小辣,基本")));
  check("★ 맵기 칸이 없는 메뉴는 건드리지 않는다", withBasic("") === null && withBasic(null) === null, "");
  check("빈 칸만 있는 값도 안 건드린다", withBasic(" , ") === null, String(withBasic(" , ")));
  check("기본값 이름은 基本", BASIC === "基本", BASIC);
}

out.push("\n[2] 서버가 뜰 때 돌아간다");
{
  const server = read("server.js");
  check("불러온다", /applySpiceBasic20260910/.test(server), "");
  check("실제로 부른다", /await applySpiceBasic20260910\(store, \{ save \}\)/.test(server), "");
  const mig = read("src", "migrations", "2026-09-10-spice-basic.js");
  check("한 번만 돌게 표를 남긴다", /migration_2026_09_10_spice_basic_applied/.test(mig), "");
}

out.push("\n[3] 「무엇이 기본 칸인가」는 한 곳에서 정한다 (public/js/spice.js)");
{
  // 실제로 돌려본다. 정규식으로 코드 모양만 보면, 모양은 맞는데 답이 틀린
  // 경우를 못 잡는다 — 2026-09-12 에 바로 그 일이 있었다.
  const win = {};
  new Function("window", read("public", "js", "spice.js"))(win);
  const S = win.HG_SPICE;
  check("파일이 규칙을 내놓는다", !!(S && S.isBasic && S.optionsOf && S.defaultOf), "");

  check("基本 은 기본이다", S.isBasic("基本"));
  // ★★ 사장님(2026-09-12): "기본을 지우고 기본(중라)로 고쳤거든. 일부러
  // 그렇게 고쳤는데 기본이 앞에 또 나왔어." 글자가 똑같은지를 보던 것이
  // 원인이었다.
  check("★★ 基本(中辣) 도 기본이다", S.isBasic("基本(中辣)"));
  check("기본(중라) 처럼 한글로 적어도 — 은 아니다 (基本 으로 시작해야 한다)", S.isBasic("기본(중라)") === false);
  check("小辣 는 기본이 아니다", S.isBasic("小辣") === false);
  check("빈 값도 기본이 아니다", S.isBasic("") === false && S.isBasic(null) === false);

  out.push("  · 목록");
  check("★ 기본이 없으면 맨 앞에 채워 넣는다",
    S.optionsOf("不辣,中辣").join(",") === "基本,不辣,中辣", S.optionsOf("不辣,中辣").join(","));
  check("이미 있으면 그대로 둔다", S.optionsOf("基本,小辣").join(",") === "基本,小辣", S.optionsOf("基本,小辣").join(","));
  // ★★ 이것이 사장님이 보신 증상이다 — 고치기 전에는 「基本,基本(中辣),小辣」.
  check("★★ 基本(中辣) 로 고쳐두면 基本 을 또 넣지 않는다",
    S.optionsOf("基本(中辣),小辣").join(",") === "基本(中辣),小辣", S.optionsOf("基本(中辣),小辣").join(","));
  check("맵기 칸이 없는 메뉴는 빈 목록", S.optionsOf("").length === 0 && S.optionsOf(null).length === 0);

  out.push("  · 처음 골라져 있는 값");
  check("★ 기본 칸이 골라져 있다", S.defaultOf("基本,小辣") === "基本", String(S.defaultOf("基本,小辣")));
  // 「基本」으로 저장하면 주문에 사장님이 지운 이름이 남는다.
  check("★★ 사장님이 고쳐 둔 이름 그대로 고른다",
    S.defaultOf("基本(中辣),小辣") === "基本(中辣)", String(S.defaultOf("基本(中辣),小辣")));
  check("★ 기본이 빠진 데이터에서도 매운 것이 안 골라진다",
    S.defaultOf("小辣,中辣") === "基本", String(S.defaultOf("小辣,中辣")));
  check("맵기 칸이 없으면 null", S.defaultOf("") === null);

  out.push("  · 빌지에 적을 말이 있는가 (isBasic 과 다른 질문이다)");
  // 사장님(2026-09-12): "맵기 옵션에 있던 기본을 버리고 基本(中辣) 이거를
  // 추가했으니까 基本(中辣) 이게 뜨는 게 맞지."
  check("「基本」은 안 적는다 (평소대로라는 뜻)", S.isSilentOnTicket("基本"));
  check("★★ 사장님이 써 넣은 「基本(中辣)」는 빌지에 나간다", S.isSilentOnTicket("基本(中辣)") === false);
  check("小辣 는 당연히 나간다", S.isSilentOnTicket("小辣") === false);
  // 같은 값을 두고 두 함수의 답이 갈리는 자리 — 이 갈림이 이 파일의 요점이다.
  check("★ 기본 자리이면서 빌지에는 나간다",
    S.isBasic("基本(中辣)") === true && S.isSilentOnTicket("基本(中辣)") === false);
}

out.push("\n[4] 세 화면이 그 규칙을 같이 쓴다");
{
  // 손님 화면과 빌지가 서로 다르게 판단하면, 화면에는 안 매운 것으로
  // 보이는데 주방에는 매운 것으로 나간다.
  const orderJs = read("public", "js", "order.js");
  const adminJs = read("public", "js", "admin.js");
  const escpos = read("public", "js", "escpos.js");
  const orderHtml = read("public", "order.html");
  const adminHtml = read("public", "admin.html");

  check("손님 화면: 목록", /window\.HG_SPICE\.optionsOf\(/.test(orderJs), "");
  check("손님 화면: 처음 골라지는 값", /window\.HG_SPICE\.defaultOf\(item\.spice_options\)/.test(orderJs), "");
  check("골라진 칸에 불이 들어온다", /if \(opt === currentSpiceOption\) b\.classList\.add\("active"\);/.test(orderJs), "");
  check("★ 첫 칸을 고르는 옛 방식이 남아 있지 않다", !/spice_options\.split\(","\)\[0\]/.test(orderJs), "");
  check("★ 글자를 맞대보던 옛 방식이 남아 있지 않다",
    !/!== "基本"/.test(orderJs) && !/!== "基本"/.test(adminJs) && !/!== "基本"/.test(escpos), "");
  check("관리자 미리보기", (adminJs.match(/HG_SPICE\.isSilentOnTicket/g) || []).length >= 2, "");
  check("실제 인쇄", /HG_SPICE\.isSilentOnTicket/.test(escpos), "");
  // 빌지 쪽에서 isBasic 을 쓰면 「基本(中辣)」가 종이에서 사라진다.
  check("★ 빌지는 기본 자리 검사가 아니라 적을 말 검사를 쓴다",
    !/HG_SPICE\.isBasic/.test(escpos), "");
  check("두 화면이 그 파일을 불러온다",
    /src="\/js\/spice\.js"/.test(orderHtml) && /src="\/js\/spice\.js"/.test(adminHtml), "");
}

out.push("\n[5] 늘 골라져 있으니 막을 일이 없다");
{
  const orderJs = read("public", "js", "order.js");
  const html = read("public", "order.html");
  check("고르라고 막던 규칙을 걷어냈다", !/SPICE_REQUIRED_MSG/.test(orderJs), "");
  check("그 안내 자리도 같이 걷어냈다", !/spiceRequiredMsg/.test(orderJs) && !/spiceRequiredMsg/.test(html), "");
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
