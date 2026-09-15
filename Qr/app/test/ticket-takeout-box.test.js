// 포장 빌지의 표시는 이모지가 아니라 그린 네모여야 한다.
//
// 2026-09-14 사장님: "포장주문 빌지에 박스모양 아이콘 대신 '外' 바꾸기" →
// "지금 박스가 찌그러져서 잘 인지가 안되는데 충분히 사이즈 있고 박스라는 게
// 보이면 더 좋을 것 같거든" → 시안 B(까맣게 채운 네모)에 글자는 「外」 한 자.
//
// 왜 이모지가 찌그러졌나: 열전사 프린터는 점이 찍히거나 안 찍히거나(1비트)다.
// escpos.js 의 rasterCanvasToEscPos 가 밝기 절반에서 자른다(lum < 128).
// 이모지는 글꼴 그림이라 가는 선과 옅은 부분이 많은데, 그때 그것들이 통째로
// 사라지고 남은 덩어리만 뭉친다. 꽉 찬 검정 네모는 잃을 것이 없다.
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

out.push("[빌지에 이모지가 안 남아 있다]");
// 화면(주문 카드·결산 목록)의 📦 는 그대로 둔다 — 거기는 진짜 화면이라
// 이모지가 잘 나온다. 종이로 가는 세 자리만 본다.
{
  // 1) HTML 빌지
  const receiptFrom = admin.indexOf("function buildReceiptBodyHtml(");
  const receiptTo = admin.indexOf("\n  function buildTicketHtml(", receiptFrom);
  const receipt = admin.slice(receiptFrom, receiptTo);
  check("HTML 빌지를 찾는다", receiptFrom > 0 && receiptTo > receiptFrom, `${receiptFrom}, ${receiptTo}`);
  check("★ HTML 빌지에 📦 가 없다", !receipt.includes("\u{1F4E6}"), "이모지가 남아 있다");
  check("★ 까만 네모에 「外」", /<span class="takeout-box">外<\/span>/.test(receipt), "");
  check("네모가 진짜 까맣다", /\.takeout-box \{[\s\S]{0,260}background: #000;[\s\S]{0,120}color: #fff;/.test(admin), "");
  check(
    "★ 인쇄할 때 배경색이 안 빠진다",
    /\.takeout-box \{[\s\S]{0,400}print-color-adjust: exact/.test(admin),
    "배경이 빠지면 흰 글씨만 남아 아무것도 안 보인다"
  );
}
{
  // 2) 앱(래스터) · 3) RawBT — 둘 다 labelInfo 로 넘긴다
  const labels = admin.match(/const labelInfo = \{[\s\S]{0,260}?\};/g) || [];
  check("빌지로 넘기는 자리가 둘이다", labels.length === 2, `${labels.length}개`);
  check("★ 둘 다 그림으로 넘긴다", labels.every((l) => /takeoutBox: counter \? "外" : null/.test(l)), labels.join(" | "));
  // 화면(주문 카드)의 📦 는 그대로 둔다 — 여기서 보는 것은 **빌지로 넘기는
  // 이름표** 둘뿐이다. 넓게 잡으면 화면 쪽까지 걸려 엉뚱하게 실패한다.
  const ticketLabels = admin.match(/const tableLabel = counter[\s\S]{0,300}?;\n/g) || [];
  check("빌지용 이름표가 둘이다", ticketLabels.length === 2, `${ticketLabels.length}개`);
  check(
    "★ 빌지용 이름표에 📦 가 없다",
    ticketLabels.every((t) => !t.includes("\u{1F4E6}")),
    ticketLabels.filter((t) => t.includes("\u{1F4E6}")).join(" | ")
  );
  // 화면 쪽은 손대지 않았다는 것도 같이 지킨다.
  check("화면의 주문 카드에는 📦 가 그대로다", /fmtCounterOrderTag[\s\S]{0,260}\u{1F4E6}/u.test(admin), "화면 표시까지 같이 지웠다");
}

out.push("\n[그림으로 그린다]");
check("★ 글자가 아니라 네모를 채운다", /ctx\.fillRect\(x, top, s, s\)/.test(escpos), "");
check("흰 글씨를 가운데 찍는다", /ctx\.fillStyle = "#fff";[\s\S]{0,200}textAlign = "center"/.test(escpos), "");
check("★ 좌표를 점 경계에 맞춘다", /const top = Math\.round\(op\.y\);/.test(escpos), "반 점에 걸치면 자를 때 가장자리가 들쭉날쭉해진다");
check("빌지가 그림을 넘긴다", /badge: labelInfo\.takeoutBox \|\| null/.test(escpos), "");
check("네모 자리만큼 글자를 민다", /leftX = x \+ s \+ op\.badgeGap/.test(escpos), "네모가 이름을 덮는다");

out.push("\n[자리 이동 전표는 안 건드린다]");
// row 렌더러가 두 벌 있다(빌지 · 자리이동 전표). 전표에는 포장이라는 개념이
// 없으므로 그쪽은 그대로여야 한다.
{
  const rowRenderers = (escpos.match(/if \(op\.type === "row"\) \{/g) || []).length;
  check("렌더러가 둘이다", rowRenderers === 2, `${rowRenderers}개`);
  const withBadge = (escpos.match(/if \(op\.badge\) \{/g) || []).length;
  check("★ 그중 빌지 쪽 하나만 네모를 그린다", withBadge === 1, `${withBadge}곳`);
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
