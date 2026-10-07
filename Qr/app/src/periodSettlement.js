// 월 결산·연 결산 — **매출에서 식자재비와 인건비를 뺀 것**.
//
// 2026-10-06 사장님: "결산탭에 월 결산, 연결산도 만들어줄래? 그 결산에는
// 식자재 비용, 급여도 같이 넣어서 계산하면 좋을 것 같은데? 그리고 그것도
// line 으로 한 번 싹 정리해서 보내주면 더 좋을 것 같고."
//
// ── 어디서 가져오는가
//
// 매출은 **하루 마감 기록**(daily_settlements)을 더한다. 주문을 다시 세지
// 않는다 — 한 해면 주문이 1만 8천 건이라 그걸 통째로 끌어오면 인스턴스가
// 못 버틴다(2026-10-06 사장님: "전체 데이터를 읽으려고 하지마 … 전처럼 서버
// 터져"). 마감 기록은 하루 한 줄이라 한 달이면 31줄, 한 해면 365줄이다.
//
// 그래서 **기록이 없는 날은 매출이 0 으로 보인다.** 조용히 넘기지 않고
// 「기록 없는 날 n일」로 돌려준다 — 결산 화면의 「목록 보기」가 지난 날을
// 주문에서 다시 채우므로(backfillMissingSnapshots), 한 번 들어갔다 오면
// 메워진다.
//
// 식자재비는 ingredient_purchases 를, 인건비는 payroll_cards 를 각각 그 달로
// 묶어서 받는다. 셋 다 DB 가 묶어 주고, 여기서는 **빼기만** 한다.
//
// ── 이익이라고 부르지 않는 이유
//
// 임대료·수도광열·세금·카드 수수료는 아직 어디에도 안 들어 있다. 그래서
// 이 숫자는 「이익」이 아니라 **「매출 − 식자재 − 인건비」**다. 문구에도 그렇게
// 적는다 — 「이익 NT$…」로 보이면 사장님이 그 숫자로 판단하신다.

const MONTH_RE = /^\d{4}-\d{2}$/;
const YEAR_RE = /^\d{4}$/;

/** "2026-09" → 그 달의 첫날·끝날, "2026" → 그 해의 첫날·끝날. */
function rangeOf(key) {
  const k = String(key || "").trim();
  if (MONTH_RE.test(k)) {
    const [y, m] = k.split("-").map(Number);
    if (m < 1 || m > 12) return null;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { kind: "month", key: k, start: `${k}-01`, end: `${k}-${String(last).padStart(2, "0")}` };
  }
  if (YEAR_RE.test(k)) return { kind: "year", key: k, start: `${k}-01-01`, end: `${k}-12-31` };
  return null;
}

/** 그 기간에 들어 있는 달들. 한 해면 열두 달, 한 달이면 자기 하나. */
function monthsOf(range) {
  if (!range) return [];
  if (range.kind === "month") return [range.key];
  const out = [];
  for (let m = 1; m <= 12; m++) out.push(`${range.key}-${String(m).padStart(2, "0")}`);
  return out;
}

/** 오늘이 든 달·해는 아직 안 끝났다 — 그렇게 말해 줘야 작년과 나란히 못 본다. */
function isOngoing(range, today) {
  if (!range || !today) return false;
  return range.kind === "month" ? today.slice(0, 7) === range.key : today.slice(0, 4) === range.key;
}

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * 셋을 모아 한 장으로.
 *
 * @param range     rangeOf() 가 준 것
 * @param days      [{date, revenue, orders, guests}] — 하루 마감 기록
 * @param ingredients {total, lines, byMonth: {"2026-09": 금액}, vendors: [{vendor, amount}]}
 * @param payroll   {total, staff, hours, byMonth: {"2026-09": 금액}}
 * @param opts      {today, daysInRange}
 */
function summarize(range, days, ingredients, payroll, opts) {
  const o = Object.assign({ today: "", daysInRange: 0 }, opts || {});
  const list = (days || []).filter((d) => d && d.date);
  const revenue = list.reduce((a, d) => a + (Number(d.revenue) || 0), 0);
  const orders = list.reduce((a, d) => a + (Number(d.orders) || 0), 0);
  const guests = list.reduce((a, d) => a + (Number(d.guests) || 0), 0);
  const ing = Object.assign({ total: 0, lines: 0, byMonth: {}, vendors: [] }, ingredients || {});
  const pay = Object.assign({ total: 0, staff: 0, hours: 0, byMonth: {} }, payroll || {});
  const left = revenue - ing.total - pay.total;

  // 한 해를 볼 때는 달마다도 같은 셈을 해 준다 — 어느 달이 샜는지 보여야 한다.
  const byDayMonth = {};
  for (const d of list) {
    const m = String(d.date).slice(0, 7);
    byDayMonth[m] = (byDayMonth[m] || 0) + (Number(d.revenue) || 0);
  }
  const by_month = monthsOf(range).map((m) => {
    const r = round(byDayMonth[m] || 0);
    const i = round(ing.byMonth[m] || 0);
    const p = round(pay.byMonth[m] || 0);
    return { month: m, revenue: r, ingredients: i, payroll: p, left: round(r - i - p) };
  });

  return {
    kind: range.kind,
    key: range.key,
    start: range.start,
    end: range.end,
    ongoing: isOngoing(range, o.today),
    revenue: { total: round(revenue), orders, guests, days: list.length },
    // 마감 기록이 없는 날 — 그만큼 매출이 덜 잡힌다. 숨기지 않는다.
    missing_days: Math.max(0, (o.daysInRange || 0) - list.length),
    ingredients: { total: round(ing.total), lines: ing.lines || 0, vendors: (ing.vendors || []).slice(0, 8) },
    payroll: { total: round(pay.total), staff: pay.staff || 0, hours: round(pay.hours || 0) },
    left: round(left),
    // 매출 대비 몇 %가 남았나. 매출이 0 이면 비율이 없다(0 으로 나누지 않는다).
    left_pct: revenue > 0 ? Math.round((left / revenue) * 1000) / 10 : null,
    cost_pct: {
      ingredients: revenue > 0 ? Math.round((ing.total / revenue) * 1000) / 10 : null,
      payroll: revenue > 0 ? Math.round((pay.total / revenue) * 1000) / 10 : null,
    },
    by_month: range.kind === "year" ? by_month : null,
  };
}

const nt = (n) => `NT$${Math.round(Number(n) || 0).toLocaleString()}`;
const pct = (p) => (p == null ? "—" : `${p}%`);

/**
 * LINE 으로 나가는 글.
 *
 * 사장님: "line 으로 한 번 싹 정리해서 보내주면 더 좋을 것 같고. 그리고 더
 * 확실하게 알고 싶다면 링크 첨부하면서 메세지에 여기서 더 볼 수 있다고 하는
 * 것도 좋을 것 같아."
 *
 * 하루 마감 문자(src/line.js)와 같은 모양을 쓴다 — 같은 가게에서 나가는
 * 문자인데 모양이 다르면 두 가지 장부처럼 읽힌다.
 */
function lineText(sum, opts) {
  const o = Object.assign({ link: "", prevLeft: null }, opts || {});
  const head = sum.kind === "month"
    ? `📅 ${Number(sum.key.slice(5, 7))}월 결산 (${sum.key.slice(0, 4)}년)`
    : `📅 ${sum.key}년 결산`;
  const lines = [sum.ongoing ? `${head} — 아직 진행 중` : head, ""];

  lines.push(`매출 ${nt(sum.revenue.total)}`);
  lines.push(`− 식자재 ${nt(sum.ingredients.total)} (${pct(sum.cost_pct.ingredients)})`);
  lines.push(`− 인건비 ${nt(sum.payroll.total)} (${pct(sum.cost_pct.payroll)})`);
  lines.push(`= 남은 것 ${nt(sum.left)}${sum.left_pct == null ? "" : ` (${pct(sum.left_pct)})`}`);
  lines.push("");
  lines.push(`주문 ${Number(sum.revenue.orders || 0).toLocaleString()}건 · 손님 ${Number(sum.revenue.guests || 0).toLocaleString()}명 · 장사한 날 ${sum.revenue.days}일`);
  if (sum.payroll.staff) lines.push(`직원 ${sum.payroll.staff}명 · ${sum.payroll.hours}시간`);

  if ((sum.ingredients.vendors || []).length) {
    lines.push("");
    lines.push("▸ 식자재 많이 쓴 곳");
    for (const v of sum.ingredients.vendors.slice(0, 3)) lines.push(`   ${v.vendor} ${nt(v.amount)}`);
  }

  if (sum.kind === "year" && (sum.by_month || []).length) {
    const best = [...sum.by_month].filter((m) => m.revenue > 0).sort((a, b) => b.revenue - a.revenue)[0];
    if (best) {
      lines.push("");
      lines.push(`가장 많이 판 달: ${Number(best.month.slice(5, 7))}월 ${nt(best.revenue)}`);
    }
  }

  if (sum.missing_days > 0) {
    lines.push("");
    lines.push(`⚠️ 마감 기록이 없는 날 ${sum.missing_days}일 — 그만큼 매출이 덜 잡혔어요.`);
  }

  // 임대료·세금이 안 들어갔다는 말을 **반드시** 붙인다. 「남은 것」을 이익으로
  // 읽으면 그 숫자로 판단하시게 된다.
  lines.push("");
  lines.push("※ 임대료·수도광열·세금은 아직 안 들어갔어요.");

  if (o.link) {
    lines.push("");
    lines.push("더 자세히 보시려면 👇");
    lines.push(o.link);
  }
  return lines.join("\n");
}

/** 관리자 화면에서 그 기간을 바로 여는 주소. */
function linkFor(origin, key) {
  const base = String(origin || "").replace(/\/+$/, "");
  if (!base) return "";
  return `${base}/admin?period=${encodeURIComponent(key)}#settlement`;
}

module.exports = { rangeOf, monthsOf, isOngoing, summarize, lineText, linkFor, MONTH_RE, YEAR_RE };
