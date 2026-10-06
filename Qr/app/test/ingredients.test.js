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
  // 「한눈에 보기」가 쓰는 것들(2026-10-06 사장님: "급여처럼 저런 전체 보기로").
  // 하루 평균을 내려면 **산 날 수**가 있어야 한다 — 줄 수로 나누면 한 영수증에
  // 다섯 줄 적은 날이 다섯 날이 된다.
  check("★★ 산 날 수를 센다 — 같은 날 여러 줄은 하루", s.days === 1, String(s.days));
  check("★ 첫 날과 마지막 날", s.first === "2025-01-01" && s.last === "2025-01-01", s.first + "~" + s.last);
  check("★ 업체 줄에 마지막 매입일", s.vendors.every((v) => v.last_date === "2025-01-01"), JSON.stringify(s.vendors));
  check("★ 지점별로도 모은다", s.stores.length === 1 && s.stores[0].store === "main" && s.stores[0].amount === 450, JSON.stringify(s.stores));
  {
    const two = [
      G.normalizeRow(row({ name: "甲", amount: 100, date: 45658 }), "main"),
      G.normalizeRow(row({ name: "甲", amount: 70, date: 45659 }), "branch3"),
    ];
    const t = G.summarize(two);
    check("★★ 지점이 둘이면 둘 다 — 많은 쪽이 위", t.stores.length === 2 && t.stores[0].store === "main", JSON.stringify(t.stores));
    check("★ 날이 다르면 산 날도 둘", t.days === 2, String(t.days));
  }
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

out.push("\n[시트 이름 → 지점]");
{
  // 사장님 엑셀이 두 벌이고 이름이 다르다. 2025년 줄이 두 파일에서 100%
  // 일치해 2호점 = 台元三店 임을 확인했다(2026-10-05).
  const cases = [
    ["韓國館總店", "main"],
    ["한국관본점 -2025", "main"],
    ["韓國館台元三店", "branch3"],
    ["한국관2호점 -2025", "branch3"],
    ["주문서", null],
    ["", null],
  ];
  for (const [name, want] of cases) {
    check(`「${name || "(빈칸)"}」 → ${want || "모름"}`, G.storeOfSheetName(name) === want, `${G.storeOfSheetName(name)}`);
  }
  // 화면 쪽에도 같은 규칙이 있다. 어긋나면 한쪽은 넣고 한쪽은 못 읽는다.
  const client = require("fs").readFileSync(require("path").join(__dirname, "..", "public/js/ingredients.js"), "utf8");
  const m = /const storeOfSheet = \(name\) => \{[\s\S]*?\n  \};/.exec(client);
  check("화면에도 같은 규칙이 있다", !!m);
  if (m) {
    const fn = new Function(`${m[0]} return storeOfSheet;`)();
    let same = true;
    for (const [name, want] of cases) if (fn(name) !== want) same = false;
    check("★★ 서버와 화면이 같은 답을 낸다", same, cases.map(([n]) => `${n}:${fn(n)}`).join(" "));
  }
}

out.push("\n[2호점이 열리기 전의 줄은 버린다]");
{
  // 2호점 시트는 2019-11 까지 본점 시트의 **복사본**이다 — 줄 수도 금액도
  // 글자 하나까지 같다(69,793줄 · NT$33,864,883). 넣으면 없던 지출이 생기고,
  // 눈으로는 멀쩡한 줄이라 나중에 절대 못 찾는다.
  const b = G.storeByKey("branch3");
  check("2호점에 개점일이 적혀 있다", b.opened === "2019-12-01", `${b.opened}`);
  check("본점에는 없다", G.storeByKey("main").opened === null, "");
  check(
    "★★ 2019-11-30 2호점 줄은 안 들어간다 — 복사본이다",
    G.normalizeRow(row({ date: "2019-11-30" }), "branch3") === null,
    ""
  );
  check("★ 2019-12-01 부터는 들어간다", !!G.normalizeRow(row({ date: "2019-12-01" }), "branch3"), "");
  check(
    "★ 본점은 2007년 것도 들어간다 — 거기는 복사본이 아니다",
    !!G.normalizeRow(row({ date: "2007-10-13" }), "main"),
    ""
  );
}

out.push("\n[그 업체에서 보통 사는 것 — 치는 것을 줄이는 목록]");
{
  const rows = [
    G.normalizeRow(row({ name: "甲", date: "2026-01-01", price: 10, unit: "斤" }), "main"),
    G.normalizeRow(row({ name: "甲", date: "2026-03-01", price: 30, unit: "Kg" }), "main"),
    G.normalizeRow(row({ name: "乙", date: "2026-02-01", price: 20 }), "main"),
    G.normalizeRow(row({ name: "乙", date: "2026-02-02", price: 20 }), "main"),
    G.normalizeRow(row({ name: "乙", date: "2026-02-03", price: 20 }), "main"),
  ];
  const cat = G.buildCatalog(rows, { recentFrom: "2026-03-01" });
  check("★ 최근에 산 것이 위로 — 손이 먼저 가는 자리다", cat[0].name === "甲", JSON.stringify(cat.map((c) => c.name)));
  check("★★ 지난 단가는 **제일 최근 것**", cat[0].last_price === 30, `${cat[0].last_price}`);
  check("★ 단위도 최근 것 (斤 → Kg 로 바뀐 품목이 있다)", cat[0].unit === "Kg", cat[0].unit);
  check("몇 번 샀는지 센다", cat.find((c) => c.name === "乙").count === 3, "");
  const cat2 = G.buildCatalog(rows, { recentFrom: "2099-01-01" });
  check("최근이 없으면 자주 산 순", cat2[0].name === "乙", JSON.stringify(cat2.map((c) => c.name)));
}

out.push("\n[새 품목·바뀐 가격 — 막지 않고 말만 한다]");
{
  // 2026-10-04 사장님: "근데 그러다가 메뉴가 추가되거나 가격이 달라지거나
  // 그러면 안되잖아."
  //
  // 단가가 지난번과 같은 비율이 84.3% 였다 — **여섯 번에 한 번은 바뀐다.**
  // 지난 값을 정답으로 쓰면 여섯 장에 한 장이 틀린 금액이 된다.
  const known = { name: "甲", last_price: 25, last_date: "2026-09-01", unit: "斤" };

  const changed = G.lineWarnings({ qty: 2, price: 30, amount: 60 }, known);
  check(
    "★★ 단가가 지난번과 다르면 **말해준다**",
    changed.some((w) => w.kind === "price_changed" && w.last === 25),
    JSON.stringify(changed)
  );
  check("★★ 그런다고 값을 고치지는 않는다 — 돌려주는 것은 경고뿐", !changed.some((w) => w.fixed || w.price), JSON.stringify(changed));

  const same = G.lineWarnings({ qty: 2, price: 25, amount: 50 }, known);
  check("같으면 조용하다", same.length === 0, JSON.stringify(same));

  const fresh = G.lineWarnings({ qty: 1, price: 99, amount: 99 }, null);
  check("★★ 목록에 없는 품목도 쓸 수 있다 — 「새 품목」이라고만 한다", fresh.some((w) => w.kind === "new_item"), JSON.stringify(fresh));

  const bad = G.lineWarnings({ qty: 3, price: 25, amount: 999 }, known);
  check(
    "★★ 산수가 안 맞으면 잡는다 — 종이 안에서 닫히는 검사다",
    bad.some((w) => w.kind === "math" && w.expected === 75),
    JSON.stringify(bad)
  );
  check("★ 가격이 올랐어도 산수 검사는 그대로 돈다", G.lineWarnings({ qty: 2, price: 30, amount: 60 }, known).every((w) => w.kind !== "math"), "");
  // 아직 다 안 친 줄에 대고 떠들면 안 된다.
  check("덜 친 줄에는 조용하다", G.lineWarnings({ qty: "", price: "", amount: "" }, undefined).length === 0, "");
}

out.push("\n[넣는 길이 막지 않는가]");
{
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "src/routes/ingredients.js"), "utf8");
  check("영수증 한 장을 넣는 길이 있다", /router\.post\("\/rows"/.test(src), "");
  check("고를 목록을 주는 길이 있다", /router\.get\("\/catalog"/.test(src), "");
  check(
    "★★ 한 장 = (지점·날짜·업체) 만 갈아끼운다 — 같은 날 다른 업체를 안 건드린다",
    /deleteMany\(\{ store, date, vendor \}\)/.test(src),
    ""
  );
  // 경고는 **화면이 보여주는 것**이지 저장을 막는 문이 아니다. 그래서 넣는
  // 길은 lineWarnings 를 아예 부르지 않는다 — 부르기 시작하면 언젠가 그걸로
  // 거절하게 되고, 그러면 종이에 적힌 사실을 넣을 수 없게 된다.
  check(
    "★★ 이상한 줄이라고 저장을 거부하지 않는다 — 종이에 그렇게 적혀 있으면 그게 사실이다",
    !/G\.lineWarnings\(/.test(src),
    "넣는 길이 경고를 문으로 쓰고 있다"
  );
  // 거절하는 것은 「어느 영수증인지 모르겠는」 경우뿐이어야 한다.
  const rejects = (src.match(/res\.status\(400\)\.json\(\{ error: "([^"]+)"/g) || []).join(" ");
  check(
    "★ 거절은 지점·날짜·업체가 없을 때만",
    !/amount|price|qty|math/.test(rejects),
    rejects
  );
}

out.push("\n[15만 줄을 보내다 한 번 걸려도 처음부터 다시 하지 않는다]");
{
  const client = require("fs").readFileSync(require("path").join(__dirname, "..", "public/js/ingredients.js"), "utf8");
  check("★ 덩이 보내기를 다시 시도한다", /for \(let attempt = 0; attempt < 3; attempt\+\+\)/.test(client), "");
  check(
    "★★ 다시 보내도 안전한 이유가 적혀 있다 — 날짜를 통째로 갈아끼우므로",
    /갈아끼우기[\s\S]{0,120}두 배가 되지 않는다/.test(client),
    "왜 안전한지 안 적어두면 다음 사람이 이 되풀이를 지운다"
  );
  // 한 날짜가 두 덩이로 쪼개지면 뒤 덩이가 앞 덩이를 지운다.
  check("★★ 한 날짜를 쪼개 보내지 않는다", /chunk\.length \+ rows\.length > \d+\) await send\(\);/.test(client), "");
}

out.push("\n[15만 줄을 통째로 끌어오지 않는다]");
{
  // 2026-10-05: 엑셀 두 벌을 합치니 154,563줄(2007~2026)이 됐다. 집계가 날짜
  // 없이 전부 읽으면 한 번 누를 때마다 수십 MB 가 오간다.
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "src/routes/ingredients.js"), "utf8");
  check("★ 날짜를 안 주면 기본 범위가 걸린다", /MONTHS_DEFAULT/.test(src), "");
  check(
    "★★ 전체는 일부러 부를 때만 (all=1)",
    /q\.all \|\| ""\) === "1"\) return where/.test(src),
    "기본이 전체면 15만 줄을 매번 끌어온다"
  );
  const client = require("fs").readFileSync(require("path").join(__dirname, "..", "public/js/ingredients.js"), "utf8");
  check("★ 화면은 「전체 기간」을 누를 때만 그 깃발을 보낸다", /wantAll = true/.test(client) && /p\.set\("all", "1"\)/.test(client), "");
  // 2026-10-06 사장님: "이것도 전체 데이터를 읽으려고 하지마 각 날짜와 업체마다
  // 고유 아이디를 주면 그것만 찾으면 되잖아 전처럼 서버 터져"
  check("★★ 집계는 DB 가 묶어서 준다 — 줄을 다 받아오지 않는다",
    /summaryPipelines/.test(src) && !/G\.summarize\(rows\)/.test(src),
    "find().toArray() 로 16만 줄을 받으면 인스턴스가 못 버틴다");
  check("★★ 업체 목록도 그 칸만 읽는다 — distinct", /distinct\("vendor"\)/.test(src), "");
  check("★ 「그 날 그 업체」 색인이 있다", /createIndex\(\{ store: 1, date: 1, vendor: 1 \}\)/.test(src), "");
}

out.push("\n[사장님만 보는 자리]");
{
  const lock = require("../src/sensitiveLock");
  check("★ 식자재도 비밀번호 거는 자리에 있다", lock.AREAS.includes("ingredients"), JSON.stringify(lock.AREAS));
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "src/routes/ingredients.js"), "utf8");
  check("★ 사장님만", /router\.use\(requireOwner\)/.test(src), "");
  check("★ 들어갈 때마다 비밀번호", /requireUnlocked\("ingredients"\)/.test(src), "");
}

out.push("\n[집계는 DB 가 한다 — 숫자가 예전과 같아야 한다]");

/**
 * 2026-10-06 사장님: "이것도 전체 데이터를 읽으려고 하지마 각 날짜와 업체마다
 * 고유 아이디를 주면 그것만 찾으면 되잖아 전처럼 서버 터져"
 *
 * 줄을 다 받아 와서 더하던 것(summarize)을 **DB 가 묶게** 바꿨다
 * (summaryPipelines + shapeSummary). 두 길이 **같은 답**을 내야 바꾼 보람이
 * 있으므로 여기서 맞춰 본다. 가짜 몽고의 집계로 돈다(test/fake-mongo.js).
 */
async function aggMatchesJs() {
  const fake = require("./fake-mongo");
  const rows = [];
  const names = ["紅蘿蔔", "洋蔥", "白菜"];
  const vendors = ["房信菓菜行", "泳慶蛋行"];
  for (let i = 0; i < 60; i++) {
    rows.push(G.normalizeRow({
      date: 45658 + (i % 7), name: names[i % names.length],
      qty: (i % 4) + 1, unit: "斤", price: 10 + (i % 5),
      amount: ((i % 4) + 1) * (10 + (i % 5)),
      vendor: vendors[i % vendors.length], note: "비고",
    }, i % 3 === 0 ? "branch3" : "main"));
  }
  const byJs = G.summarize(rows);
  const c = fake.__db.collection("ingredient_agg_test");
  await c.insertMany(G.withIds(rows).map((d) => ({ ...d })));

  const run = async (where) => {
    const parts = {};
    for (const [k, pipe] of Object.entries(G.summaryPipelines(where))) parts[k] = await c.aggregate(pipe).toArray();
    return G.shapeSummary(parts);
  };

  const byDb = await run({});
  check("★★ 합계가 같다", byDb.total === byJs.total, byDb.total + " vs " + byJs.total);
  check("★★ 줄 수가 같다", byDb.lines === byJs.lines, byDb.lines + " vs " + byJs.lines);
  check("★★ 산 날 수가 같다", byDb.days === byJs.days, byDb.days + " vs " + byJs.days);
  check("★ 첫 날·마지막 날이 같다", byDb.first === byJs.first && byDb.last === byJs.last, byDb.first + "~" + byDb.last);
  check("★★ 업체별이 같다 (차례까지)", JSON.stringify(byDb.vendors) === JSON.stringify(byJs.vendors), JSON.stringify(byDb.vendors));
  check("★★ 지점별이 같다", JSON.stringify(byDb.stores) === JSON.stringify(byJs.stores), JSON.stringify(byDb.stores));
  check("★★ 달별이 같다", JSON.stringify(byDb.months) === JSON.stringify(byJs.months), JSON.stringify(byDb.months));
  check("★★ 품목별이 같다",
    JSON.stringify(byDb.items.map((i) => [i.name, i.amount, i.qty, i.lines])) ===
    JSON.stringify(byJs.items.map((i) => [i.name, i.amount, i.qty, i.lines])), JSON.stringify(byDb.items));

  // 막대는 끊어 줘도 **가짓수는 진짜 숫자**여야 한다(2026-10-06: 화면에 978 대신 200 이 떴다)
  check("★★ 품목 가짓수는 막대 개수가 아니라 진짜 가짓수", byDb.items_total === byJs.items_total, byDb.items_total + " vs " + byJs.items_total);
  const cut2 = G.shapeSummary({ items: [], itemCount: await c.aggregate(G.summaryPipelines({}, { items: 1 }).itemCount).toArray() });
  check("★★ 200가지만 받아와도 가짓수는 그대로", cut2.items_total === byJs.items_total, String(cut2.items_total));

  const only = await run({ store: "main" });
  const jsOnly = G.summarize(rows.filter((r) => r.store === "main"));
  check("★★ 지점을 거른 집계도 같다", only.total === jsOnly.total && only.lines === jsOnly.lines, only.total + " vs " + jsOnly.total);

  // 품목은 200가지까지만 돌려준다 — 그보다 많아도 화면이 멎지 않게
  const many = G.summaryPipelines({}, { items: 2 });
  const cut = G.shapeSummary({ items: await c.aggregate(many.items).toArray() });
  check("★ 품목은 많아도 끊어서 준다", cut.items.length === 2, String(cut.items.length));
}

aggMatchesJs().then(() => {
    console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => {
  console.log(out.join("\n"));
  console.error("집계 맞춰보기에서 터졌습니다:", e && e.message);
  process.exit(1);
});

