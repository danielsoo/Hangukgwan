// 오전 칸을 누르면 그 아래가 전부 오전 것이 된다.
//
// 사장님(2026-09-10): "오전, 오후 정산을 클릭해서 해당 내용을 볼 수 있으면
// 좋겠어. 현재는 Total 내용만 보여지는데, Shift 별로 클릭하면 해당 Shift만
// 볼 수 있으면 더 디테일할거야."
//
// ── 이 파일이 지키는 두 가지 ────────────────────────────────────────
//
//   1. **거른 화면은 그 시간대 것만 담는다.** 매출만이 아니라 결제수단,
//      분류별, 시간대, 테이블별까지 전부. 하나라도 안 걸리면 그 칸만 조용히
//      하루치를 보여주고, 사장님은 그걸 오전 것으로 읽는다.
//   2. **거른 화면에서도 오전·오후 두 칸은 둘 다 산다.** 거기서 반대편으로
//      건너가야 하니까. 반대편이 0 으로 보이면 그날 매출이 정말 0 인 줄 안다.
const { computeSettlement, halfOf } = require("../src/settlement");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const D = "2026-09-10";
let seq = 0;
const order = (table, half, at, total, opts = {}) => ({
  id: ++seq,
  table_number: table,
  status: "paid",
  created_at: `${D} ${at}`,
  updated_at: `${D} ${at}`,
  total,
  party_size: opts.size || 2,
  party_adults: opts.size || 2,
  party_children: 0,
  order_type: opts.orderType || "dine_in",
  ...(half ? { service_period: half } : {}),
  items: [
    {
      name_ko: opts.item || "김치찌개",
      name_zh: opts.item || "泡菜鍋",
      qty: 1,
      price: total,
      category_key: opts.category || "stew",
      payment_method: opts.pay || "cash",
      paid_at: `${D} ${at}`,
    },
  ],
});

const ORDERS = [
  order("7", "am", "12:00:00", 1000, { pay: "cash", category: "stew", item: "김치찌개" }),
  order("8", "am", "12:30:00", 500, { pay: "cash", category: "stew", item: "김치찌개" }),
  order("9", "pm", "18:00:00", 2000, { pay: "linepay", category: "grill", item: "삼겹살" }),
];
const S = (opts = {}) => computeSettlement(ORDERS, D, D, opts);

out.push("[1] 합산은 지금까지와 같다");
{
  const s = S();
  check("매출 3500", s.total_revenue === 3500, String(s.total_revenue));
  check("shift 는 비어 있다", s.shift === null, JSON.stringify(s.shift));
  check("결제수단 두 가지", (s.payment_method_breakdown || []).length === 2, JSON.stringify(s.payment_method_breakdown));
}

out.push("\n[2] ★★ 오전만 보기 — 아래가 전부 따라온다");
{
  const s = S({ shift: "am" });
  check("★ 매출은 오전 것만", s.total_revenue === 1500, String(s.total_revenue));
  check("shift 를 알려준다", s.shift === "am", JSON.stringify(s.shift));
  check("결제 건수도 오전 것만", s.paid_order_count === 2, String(s.paid_order_count));
  check("손님 수도 오전 것만", s.guest_count === 4, String(s.guest_count));
  // 아래는 「하나라도 안 걸리면 그 칸만 하루치」를 막는 자물쇠들이다.
  const pm = s.payment_method_breakdown || [];
  check("★ 결제수단에 오후의 LINE 이 없다", pm.every((e) => e.method !== "linepay"), JSON.stringify(pm));
  check("결제수단 합이 매출과 같다", s.payment_method_total === 1500, String(s.payment_method_total));
  const cats = (s.category_breakdown || []).map((c) => c.category_key);
  check("★ 분류에 오후의 grill 이 없다", !cats.includes("grill"), JSON.stringify(cats));
  const tables = (s.table_breakdown || []).map((t) => String(t.table_number));
  check("★ 테이블별에 9번(오후)이 없다", !tables.includes("9"), JSON.stringify(tables));
  const hours = (s.hourly_breakdown || []).map((h) => h.hour);
  check("★ 시간대에 18시가 없다", !hours.includes(18), JSON.stringify(hours));
  const items = (s.item_breakdown || []).map((i) => i.name_ko);
  check("★ 품목에 삼겹살이 없다", !items.includes("삼겹살"), JSON.stringify(items));
}

out.push("\n[3] 오후만 보기");
{
  const s = S({ shift: "pm" });
  check("매출은 오후 것만", s.total_revenue === 2000, String(s.total_revenue));
  check("결제수단은 LINE 하나", (s.payment_method_breakdown || []).length === 1, JSON.stringify(s.payment_method_breakdown));
  check("★ 오전+오후 = 합산", S({ shift: "am" }).total_revenue + s.total_revenue === S().total_revenue, "");
}

out.push("\n[4] ★★ 거른 화면에서도 오전·오후 두 칸은 둘 다 산다");
{
  // 여기서 반대편으로 건너간다. 거른 것으로 세면 반대편이 0 이 되고,
  // 사장님은 그날 오후 매출이 정말 0 인 줄 안다.
  const s = S({ shift: "am" });
  check("★ 오전 칸이 있다", s.half_split.am.revenue === 1500, String(s.half_split.am.revenue));
  check("★ 오후 칸도 살아 있다", s.half_split.pm.revenue === 2000, String(s.half_split.pm.revenue));
  check("오후 손님 수도 남아 있다", s.half_split.pm.guest_count === 2, String(s.half_split.pm.guest_count));
}

out.push("\n[5] 거른 화면의 숫자는 그 칸의 숫자와 정확히 같다");
{
  const all = S();
  for (const which of ["am", "pm"]) {
    const s = S({ shift: which });
    const part = all.half_split[which];
    check(`★ ${which}: 매출이 같다`, s.total_revenue === part.revenue, `${s.total_revenue} vs ${part.revenue}`);
    check(`${which}: 결제 건수가 같다`, s.paid_order_count === part.paid_order_count, "");
    check(`${which}: 손님 수가 같다`, s.guest_count === part.guest_count, `${s.guest_count} vs ${part.guest_count}`);
    check(`${which}: 1인당 평균이 같다`, s.avg_per_guest === part.avg_per_guest, `${s.avg_per_guest} vs ${part.avg_per_guest}`);
  }
}

out.push("\n[6] 이상한 shift 값은 합산으로 본다");
{
  // 주소창에 아무거나 쳐 넣어도 빈 화면이 뜨면 안 된다.
  for (const bad of ["morning", "", null, undefined, "AM", 1]) {
    const s = computeSettlement(ORDERS, D, D, { shift: bad });
    check(`${JSON.stringify(bad)} → 합산`, s.total_revenue === 3500 && s.shift === null, String(s.total_revenue));
  }
}

out.push("\n[7] halfOf — 가르는 규칙은 여기 한 곳뿐이다");
{
  const tagged = { created_at: `${D} 12:00:00`, service_period: "pm", items: [] };
  check("★ 박혀 있는 표를 먼저 믿는다", halfOf(tagged, { eveningStartsAt: "16:25" }) === "pm", "");
  const old = { created_at: `${D} 12:00:00`, updated_at: `${D} 12:30:00`, items: [] };
  check("표가 없으면 시각으로", halfOf(old, { eveningStartsAt: "16:25" }) === "am", "");
  const late = { created_at: `${D} 18:00:00`, updated_at: `${D} 18:30:00`, items: [] };
  check("저녁은 오후", halfOf(late, { eveningStartsAt: "16:25" }) === "pm", "");
  check("★ 경계가 없으면 null (지어내지 않는다)", halfOf(old, {}) === null, String(halfOf(old, {})));
  check("주문이 없으면 null", halfOf(null, {}) === null, "");
}

out.push("\n[8] 못 가르는 주문은 어느 쪽에도 안 들어간다");
{
  // 표도 없고 경계도 없는 날. 오전만 보기를 눌러도 이 주문은 안 나온다.
  const noTag = [
    { id: 900, table_number: "7", status: "paid", created_at: `${D} 12:00:00`, updated_at: `${D} 12:30:00`, total: 700, party_size: 2, items: [] },
  ];
  const all = computeSettlement(noTag, D, D, {});
  const am = computeSettlement(noTag, D, D, { shift: "am" });
  check("합산에는 있다", all.total_revenue === 700, String(all.total_revenue));
  check("★ 오전만 보기에는 없다", am.total_revenue === 0, String(am.total_revenue));
  check("★ 못 갈랐다고 말한다", all.half_split.unsplit_dates.includes(D), JSON.stringify(all.half_split.unsplit_dates));
  check("★ 그 금액도 말한다", all.half_split.unsplit_revenue === 700, String(all.half_split.unsplit_revenue));
}

out.push("\n[9] 화면 배선");
{
  const fs = require("fs");
  const js = fs.readFileSync(require("path").join(__dirname, "../public/js/admin.js"), "utf8");
  const html = fs.readFileSync(require("path").join(__dirname, "../public/admin.html"), "utf8");
  const css = fs.readFileSync(require("path").join(__dirname, "../public/css/admin.css"), "utf8");

  check("오전 칸을 누를 수 있다", /id="settlementAmBox"[^>]*role="button"/.test(html), "");
  check("오후 칸을 누를 수 있다", /id="settlementPmBox"[^>]*role="button"/.test(html), "");
  check("키보드로도 된다", /el\.onkeydown/.test(js) && /toggleSettlementShift/.test(js), "");
  check("★ 서버에 shift 를 보낸다", /params\.set\("shift", settlementShift\)/.test(js), "");
  check("★ 주문 목록에도 같이 보낸다", (js.match(/params\.set\("shift", settlementShift\)/g) || []).length >= 2, "");
  check("합산으로 돌아가는 버튼이 있다", /id="settlementShiftReset"/.test(html) && /#settlementShiftReset/.test(js), "");
  check("★ 무엇을 보고 있는지 표가 뜬다", /id="settlementShiftBadge"/.test(html) && /renderSettlementShiftBadge/.test(js), "");
  check("날짜를 바꾸면 합산으로 돌아간다", /settlementShift = null;\s*\n\s*loadSettlement\(start, end\)/.test(js), "");
  check("고른 칸이 눈에 남는다", /\.stl-half\.is-active/.test(css), "");
  check("반대편 칸은 물러난다", /has-shift .stl-half:not\(\.is-active\)/.test(css), "");
  check("두 언어 모두 있다", (js.match(/settlementViewingAm:/g) || []).length === 2, "");
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
