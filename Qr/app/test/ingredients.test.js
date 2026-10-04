// 식자재 매입 규칙 (src/ingredients.js).
//
// 2026-10-04 사장님: "그냥 뭘 얼마에 몇개 샀다는 걸 바라는거야."
//
// 사장님이 2025-01 부터 엑셀로 적어 오신 20,877줄(NT$1,476만)을 가져오는 것이
// 이 기능의 시작이다. 그래서 이 시험이 지키는 선은 **가져온 숫자가 사장님
// 장부와 같은가**이다 — 한 줄이라도 사라지거나 두 번 들어가면 합계가 틀어지고,
// 그러면 이 화면을 믿을 수 없게 된다.
//
// ── 눈으로는 절대 못 찾는 것 하나
//
// 엑셀의 「龍」은 U+F9C4 이고 보통 쓰는 「龍」은 U+9F8D 다. 화면에 똑같이
// 보이는데 다른 글자다(한국어 입력기로 한자를 치면 이 모양이 나온다).
// 업체 20곳 중 1곳, **품목 477가지 중 47가지**가 그랬다.
//
// 그대로 두면 같은 품목이 둘로 갈라져 지출도 단가 추이도 반씩 나뉜다. 실제로
// 맞춰보다 龍江興南北商行 의 지출이 NT$0 으로 나와서 알았다. 이 시험이 그
// 자리를 지킨다.
const G = require("../src/ingredients");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const row = (over = {}) =>
  Object.assign(
    { date: 45658, name: "紅蘿蔔", qty: 3, unit: "斤", price: 25, amount: 75, vendor: "房信菓菜行", note: "당근" },
    over
  );

out.push("[날짜 — 엑셀 일련번호]");
check("★ 45658 은 2025-01-01", G.excelDate(45658) === "2025-01-01", G.excelDate(45658));
check("이미 YYYY-MM-DD 면 그대로", G.anyDate("2026-09-17") === "2026-09-17", "");
check("머리글은 날짜가 아니다", G.excelDate("날짜") === null, "");
check("빈칸도 아니다", G.anyDate("") === null, "");
check("엉뚱하게 큰 수도 아니다", G.excelDate(999999) === null, "");

out.push("\n[호환 한자 — 눈으로는 똑같이 보이는 다른 글자]");
{
  const compat = "龍江興南北商行"; // 엑셀에 들어 있던 모양
  const plain = "龍江興南北商行"; // 보통 쓰는 모양
  check("★ 두 글자는 원래 다르다 (시험 전제)", compat !== plain, "");
  check("★★ 맞추면 같아진다 — 아니면 지출이 둘로 갈라진다", G.normName(compat) === plain, G.normName(compat));
  const a = G.normalizeRow(row({ vendor: compat }), "main");
  const b = G.normalizeRow(row({ vendor: plain }), "main");
  check("★★ 업체 이름이 한 모양으로 모인다", a.vendor === b.vendor, `${a.vendor} vs ${b.vendor}`);
  const c = G.normalizeRow(row({ name: "老姜" }), "main"); // 老姜
  check("★ 품목 이름도 맞춘다", c.name === "老姜", c.name);
  // NFKC 였으면 규격의 별표·괄호까지 건드린다. 품목 이름에 「21*20」 이 있다.
  const d = G.normalizeRow(row({ name: "復活擦手紙巾 21*20" }), "main");
  check("★ 규격(21*20)은 건드리지 않는다", d.name.includes("21*20"), d.name);
}

out.push("\n[같은 회사, 다른 상호]");
{
  // 2026-10-04 사장님: "龍江興南北商行 / 龍國興業社 이 2 회사는 같은 회사이고,
  // 엑셀 기록파일에는 龍江興南北商行 회사명으로만 식재료를 기록했어요."
  check("★ 별칭이 한 이름으로 모인다", G.canonicalVendor("龍國興業社") === "龍江興南北商行", G.canonicalVendor("龍國興業社"));
  check("원래 이름은 그대로", G.canonicalVendor("房信菓菜行") === "房信菓菜行", "");
}

out.push("\n[한 줄로 쓸 수 있는가]");
{
  check("보통 줄은 통과", !!G.normalizeRow(row(), "main"), "");
  check("★ 날짜가 없으면 버린다 — 머리글·합계 줄이 섞여 있다", G.normalizeRow(row({ date: "" }), "main") === null, "");
  check("★ 품목이 없으면 버린다", G.normalizeRow(row({ name: "  " }), "main") === null, "");
  check("모르는 지점은 안 받는다", G.normalizeRow(row(), "nowhere") === null, "");
  const r = G.normalizeRow(row(), "main");
  check("달을 같이 적어둔다", r.month === "2025-01", r.month);
  check("한국어 이름이 따라온다", r.name_ko === "당근", r.name_ko);
}

out.push("\n[금액 — 사장님 장부와 같아야 한다]");
{
  // 2만 줄 중 금액 ≠ 수량×단가 인 줄이 시트마다 하나씩 있었다(2026-10-04).
  // 고쳐 쓰면 사장님 장부와 합계가 달라진다. 적힌 것을 믿는다.
  const odd = G.normalizeRow(row({ qty: 3, price: 25, amount: 999 }), "main");
  check("★★ 적힌 금액을 고치지 않는다", odd.amount === 999, `${odd.amount}`);
  const blank = G.normalizeRow(row({ qty: 0.5, price: 90, amount: "" }), "main");
  check("★ 금액이 비어 있을 때만 수량×단가로 채운다", blank.amount === 45, `${blank.amount}`);
  const comma = G.normalizeRow(row({ amount: "1,200" }), "main");
  check("쉼표가 든 숫자도 읽는다", comma.amount === 1200, `${comma.amount}`);
}

out.push("\n[되풀이 가져와도 두 번 쌓이지 않는다]");
{
  const rows = [
    G.normalizeRow(row({ name: "A" }), "main"),
    G.normalizeRow(row({ name: "B" }), "main"),
    G.normalizeRow(row({ name: "A" }), "main"), // 같은 날 같은 업체 같은 품목이 두 줄
  ];
  const ids = G.withIds(rows).map((d) => d._id);
  check("★ 같은 품목이 두 줄이어도 열쇠가 안 겹친다", new Set(ids).size === 3, ids.join(" "));
  check("★ 같은 자료면 열쇠도 같다 (다시 가져와도 안전)", G.withIds(rows).map((d) => d._id).join() === ids.join(), "");
  const covered = G.datesCovered(rows);
  check("덮는 날짜를 알려준다", covered.length === 1 && covered[0].store === "main" && covered[0].dates[0] === "2025-01-01", JSON.stringify(covered));
}

out.push("\n[집계]");
{
  const rows = [
    G.normalizeRow(row({ name: "甲", amount: 100, qty: 1 }), "main"),
    G.normalizeRow(row({ name: "甲", amount: 50, qty: 2 }), "main"),
    G.normalizeRow(row({ name: "乙", amount: 300, vendor: "台裕行" }), "main"),
  ];
  const s = G.summarize(rows);
  check("합계", s.total === 450, `${s.total}`);
  check("줄 수", s.lines === 3, `${s.lines}`);
  check("★ 같은 품목은 한 줄로 모인다", s.items.length === 2, JSON.stringify(s.items.map((i) => i.name)));
  check("★ 품목 수량도 더한다", s.items.find((i) => i.name === "甲").qty === 3, "");
  check("★ 금액 많은 순", s.vendors[0].vendor === "台裕行", JSON.stringify(s.vendors));
  check("달별로도 모은다", s.months.length === 1 && s.months[0].month === "2025-01", JSON.stringify(s.months));
  check("빈 목록도 터지지 않는다", G.summarize([]).total === 0 && G.summarize(null).lines === 0, "");
}

out.push("\n[단가 추이]");
{
  const rows = [
    G.normalizeRow(row({ date: 45658, price: 25, qty: 1 }), "main"),
    G.normalizeRow(row({ date: 45658, price: 25, qty: 2 }), "main"), // 같은 날 같은 값
    G.normalizeRow(row({ date: 45659, price: 30 }), "main"),
  ];
  const pts = G.priceHistory(rows);
  check("★ 같은 날 같은 단가는 한 점 — 겹쳐 찍으면 「많이 샀다」로 읽힌다", pts.length === 2, JSON.stringify(pts));
  check("★ 묶인 점의 수량은 더해진다", pts[0].qty === 3, `${pts[0].qty}`);
  check("날짜 순", pts[0].date < pts[1].date, "");
  check("단가가 따라온다", pts[1].price === 30, "");
}

out.push("\n[사장님만 보는 자리]");
{
  const lock = require("../src/sensitiveLock");
  check("★ 식자재도 비밀번호 거는 자리에 있다", lock.AREAS.includes("ingredients"), JSON.stringify(lock.AREAS));
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "src/routes/ingredients.js"), "utf8");
  check("★ 사장님만", /router\.use\(requireOwner\)/.test(src), "");
  check("★ 들어갈 때마다 비밀번호", /requireUnlocked\("ingredients"\)/.test(src), "");
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
