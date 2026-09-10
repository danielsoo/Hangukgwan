// 좌석번호 옆 인원 표기 — 「(3-2)」 는 어른 3, 아이 2.
//
// 2026-09-10 사장님: "주문서 및 화면의 좌석번호 옆에 괄호넣고 인원수 나오게;
// 좌석번호 (3-2) 3명어른2명아이 뜻임".
//
// 종이(escpos.js)와 화면(admin.js)이 각자 계산한다 — escpos.js 는 브라우저용
// 순수 함수라 admin.js 를 못 부른다. 그래서 두 규칙이 글자 하나까지 같은지
// 여기서 잰다. 어긋나면 주방과 홀이 서로 다른 숫자를 부르게 되고, 그건
// 밥 공기 수로 나온다.
const fs = require("fs");
const path = require("path");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

function partyTagOf(file) {
  const src = fs.readFileSync(path.join(__dirname, "..", "public", "js", file), "utf8");
  const start = src.indexOf("function partyTag(o) {");
  if (start < 0) return null;
  const end = src.indexOf("\n  }\n", start);
  const body = src.slice(start, end + 4);
  // eslint-disable-next-line no-new-func
  return new Function(`${body}; return partyTag;`)();
}

out.push("[두 파일이 같은 규칙을 쓴다]");
const fromAdmin = partyTagOf("admin.js");
const fromEscpos = partyTagOf("escpos.js");
check("화면 쪽에 규칙이 있다", typeof fromAdmin === "function");
check("종이 쪽에도 규칙이 있다", typeof fromEscpos === "function");

const cases = [
  { name: "어른 3 아이 2", o: { party_size: 5, party_adults: 3, party_children: 2 }, want: " (3-2)" },
  // 아이가 0명이어도 두 칸을 지킨다. 어떤 표는 (3), 어떤 표는 (3-2) 이면
  // 3이 총원인지 어른인지 볼 때마다 헷갈린다.
  { name: "아이가 없어도 두 칸", o: { party_size: 3, party_adults: 3, party_children: 0 }, want: " (3-0)" },
  { name: "아이 수가 아예 없는 값", o: { party_size: 3, party_adults: 3 }, want: " (3-0)" },
  // 어른/아이를 물어본 적이 없는 손님에게 (4-0) 이라고 적으면 아이가 없다고
  // 말하는 셈인데, 우리는 물어본 적이 없다.
  { name: "구분 전 손님은 총원만", o: { party_size: 4, party_adults: null }, want: " (4)" },
  { name: "인원수가 없으면 아무것도 안 붙는다", o: { party_size: null }, want: "" },
  { name: "주문 객체가 없어도 안 터진다", o: null, want: "" },
];

out.push("\n[표기 규칙]");
for (const c of cases) {
  const a = fromAdmin(c.o);
  const b = fromEscpos(c.o);
  check(`${c.name} → "${c.want}"`, a === c.want, `화면: "${a}"`);
  check(`${c.name} — 종이도 같다`, b === a, `종이: "${b}" / 화면: "${a}"`);
}

out.push("\n[실제로 좌석번호 옆에 붙어 있다]");
// 붙이는 자리를 하나라도 빠뜨리면 그 화면만 인원수가 없다.
const admin = fs.readFileSync(path.join(__dirname, "..", "public", "js", "admin.js"), "utf8");
const escpos = fs.readFileSync(path.join(__dirname, "..", "public", "js", "escpos.js"), "utf8");
const sites = [
  ["실시간 주문 카드", /const tableTag = .*\$\{o\.table_number\}\$\{partyTag\(o\)\}/],
  ["주문 상세", /const detailTableTag = .*\$\{o\.table_number\}\$\{partyTag\(o\)\}/],
  ["주문 수정", /const editTableTag = .*\$\{order\.table_number\}\$\{partyTag\(order\)\}/],
  ["브라우저 인쇄 주문서", /桌號 \$\{o\.table_number\}\$\{partyTag\(o\)\}[\s\S]{0,80}order-type-badge/],
  ["래스터 주문서 라벨", /桌號 \$\{o\.table_number\}\$\{partyTag\(o\)\}`;/],
];
for (const [name, re] of sites) check(name, re.test(admin), "안 붙어 있다");
check("ESC/POS 텍스트 주문서", /padLine\(`桌號 \$\{o\.table_number\}\$\{partyTag\(o\)\}`/.test(escpos), "안 붙어 있다");

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
