// 직원 급여 — 출근 카드(考勤卡)로 한 달 급여를 계산한다 (2026-10-03).
//
// 사장님: "직원들 월급 계산을 하고 싶은데 시급제, 월급제 이런 게 있고
// 초과수당이면 그걸 계산해서 … 카드를 직접 찍어서 종이에 출력되는 방식으로
// 대만은 진행을 해 / 별이 없는 건 주5일까지만 찍고 별부터는 주5일이 지난 것만
// 넣어. 한마디로 둘이 합쳐야 한 직원이 일한 모든 게 들어간다는거야 / 각 오전
// 오후가 가로열이고 날짜가 세로행이야."
//
// ── 카드 한 장 = 한 달, 한 직원
//   · 파란 면 1~15일, 주황 면 16~31일.
//   · 별(★) 없는 카드 = 주 5일까지. 별 카드 = 주 5일을 넘겨 일한 날만.
//     둘을 합쳐야 그 직원의 한 달이다. 날짜는 겹치지 않으므로 하루에 ★ 표시
//     하나로 합친다.
//   · 칸: 오전 출근·퇴근, 오후 출근·퇴근, 연장(加班) 출근·퇴근.
//
// ── 정한 것 (사장님 답, 2026-10-03)
//   · 초과 시간: 정해진 퇴근(오전 14:00 · 오후 21:00)을 25분 넘기면 0.5시간,
//     그 뒤 30분마다 0.5. **확정이 아니다** — "사장이 한 번 더 확인하는 걸로".
//     그래서 날마다 「제안」만 하고, 사장님이 확인(또는 고침)해야 확정이다.
//   · 초과수당과 별 카드 날: 시급 그대로(1배).
//   · 금액은 직원마다 적는다(시급제는 시급, 월급제는 월급 + 시급).
//     최저임금은 자동으로 올리지 않고 밑이면 경고만 한다.
//
// 저장은 store 문서가 아니라 따로 둔 컬렉션이다(CLAUDE.md 「store 문서를 통째로
// 쓰지 않는다」). 카드 문서의 번호는 「직원|YYYY-MM」 자연 키다.

const STAFF_COLLECTION = "payroll_staff";
const CARDS_COLLECTION = "payroll_cards";

// 2026년(민국 115년) 대만 최저임금. 경고에만 쓴다.
const MIN_WAGE = { monthly: 29500, hourly: 196 };

const DEFAULT_RULES = {
  am_start: "09:00",
  am_end: "14:00",
  pm_start: "16:00",
  pm_end: "21:00",
  ot_threshold_min: 25, // 이만큼 넘기면 0.5시간
  ot_step_min: 30, // 그 뒤 이만큼마다 0.5시간 더
  borderline_min: 10, // 기준 ±10분이면 「확인 필요」로 칠한다
};

const SLOTS = ["am_in", "am_out", "pm_in", "pm_out", "ot_in", "ot_out"];
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function toMin(t) {
  const m = TIME_RE.exec(String(t || "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function cleanTime(t) {
  const m = TIME_RE.exec(String(t == null ? "" : t).trim());
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}
const r2 = (v) => Math.round(v * 100) / 100;

function rulesOf(raw) {
  const r = { ...DEFAULT_RULES };
  for (const k of ["am_start", "am_end", "pm_start", "pm_end"]) if (raw && cleanTime(raw[k])) r[k] = cleanTime(raw[k]);
  for (const k of ["ot_threshold_min", "ot_step_min", "borderline_min"]) {
    const n = Number(raw && raw[k]);
    if (Number.isFinite(n) && n > 0 && n <= 120) r[k] = Math.round(n);
  }
  return r;
}

/** 정해진 퇴근을 over 분 넘겼을 때 제안하는 초과 시간(0.5 단위). */
function overtimeFor(overMin, rules = DEFAULT_RULES) {
  if (!(overMin >= rules.ot_threshold_min)) return 0;
  return 0.5 * (1 + Math.floor((overMin - rules.ot_threshold_min) / rules.ot_step_min));
}

/** 연장(加班) 칸 — 출근부터 퇴근까지를 0.5시간 단위로 내림. */
function extraBlockHours(inT, outT) {
  const a = toMin(inT);
  let b = toMin(outT);
  if (a == null || b == null) return 0;
  if (b < a) b += 24 * 60; // 자정을 넘김
  return Math.floor((b - a) / 30) * 0.5;
}

/**
 * 하루 — 기본 시간(찍힌 블록만큼), 제안 초과 시간, 「확인 필요」.
 * 기본 시간은 찍힌 시각이 아니라 **블록**으로 센다: 오전을 찍었으면 오전 블록
 * (09:00~14:00 = 5시간), 오후를 찍었으면 오후 블록. 몇 분 일찍 나온 것을 깎지
 * 않는다(카드에도 그렇게 계산해 오셨다 — 13:57·20:55 퇴근도 하루로 셌다).
 */
function dayOf(day, rules = DEFAULT_RULES) {
  const d = day || {};
  const has = (a, b) => !!(cleanTime(d[a]) || cleanTime(d[b]));
  const am = has("am_in", "am_out");
  const pm = has("pm_in", "pm_out");
  const ot = has("ot_in", "ot_out");
  const block = (s, e) => Math.max(0, (toMin(rules[e]) - toMin(rules[s])) / 60);
  const regular = (am ? block("am_start", "am_end") : 0) + (pm ? block("pm_start", "pm_end") : 0);
  const notes = [];
  let suggested = 0;
  let borderline = false;
  const over = (outKey, endKey, label) => {
    const out = toMin(d[outKey]);
    if (out == null) return;
    let o = out - toMin(rules[endKey]);
    if (o < -12 * 60) o += 24 * 60;
    if (o <= 0) return;
    const h = overtimeFor(o, rules);
    if (Math.abs(o - rules.ot_threshold_min) <= rules.borderline_min) borderline = true;
    if (h > 0 || o >= rules.ot_threshold_min - rules.borderline_min) notes.push({ slot: label, over_min: o, hours: h });
    suggested += h;
  };
  over("am_out", "am_end", "am");
  over("pm_out", "pm_end", "pm");
  const extra = extraBlockHours(d.ot_in, d.ot_out);
  suggested += extra;
  const set = d.ot_hours != null && Number.isFinite(Number(d.ot_hours));
  return {
    worked: am || pm || ot,
    star: !!d.star,
    regular_hours: regular,
    suggested_ot: suggested,
    extra_hours: extra,
    ot_hours: set ? Number(d.ot_hours) : suggested,
    ot_confirmed: !!d.ot_confirmed,
    borderline,
    notes,
  };
}

function daysInMonth(month) {
  const [y, m] = String(month).split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * 한 달 계산.
 *  · 시급제: (기본 시간 + 초과 시간) × 시급. 별 카드 날도 같은 시급.
 *  · 월급제: 월급 + (별 카드 날 기본 시간 + 초과 시간) × 시급. 별 없는 날은
 *    월급에 들어 있다. 시급을 안 적었으면 월급 ÷ 240(30일 × 8시간).
 */
function computeMonth(card, staff, rawRules) {
  const rules = rulesOf(rawRules);
  const month = card && card.month;
  const n = month ? daysInMonth(month) : 31;
  const days = (card && card.days) || {};
  const rows = [];
  let normalDays = 0, starDays = 0, normalHours = 0, starHours = 0, otHours = 0, unconfirmed = 0, borderlines = 0;
  for (let i = 1; i <= n; i++) {
    const d = dayOf(days[i] || days[String(i)], rules);
    rows.push({ day: i, ...d });
    if (!d.worked) continue;
    if (d.star) { starDays++; starHours += d.regular_hours; } else { normalDays++; normalHours += d.regular_hours; }
    otHours += d.ot_hours;
    if ((d.suggested_ot > 0 || d.ot_hours > 0 || d.borderline) && !d.ot_confirmed) unconfirmed++;
    if (d.borderline && !d.ot_confirmed) borderlines++;
  }
  const s = staff || {};
  const type = s.pay_type === "monthly" ? "monthly" : "hourly";
  const salary = Math.max(0, Number(s.monthly_salary) || 0);
  const hourly = Number(s.hourly_rate) > 0 ? Number(s.hourly_rate) : type === "monthly" && salary ? r2(salary / 240) : 0;
  const lines = [];
  if (type === "hourly") {
    lines.push({ key: "regular", hours: normalHours + starHours, rate: hourly, amount: (normalHours + starHours) * hourly });
  } else {
    lines.push({ key: "salary", amount: salary });
    if (starHours) lines.push({ key: "star", hours: starHours, rate: hourly, amount: starHours * hourly });
  }
  if (otHours) lines.push({ key: "overtime", hours: otHours, rate: hourly, amount: otHours * hourly });
  for (const l of lines) l.amount = Math.round(l.amount);
  const total = lines.reduce((a, l) => a + l.amount, 0);
  const warnings = [];
  if (type === "hourly" && hourly > 0 && hourly < MIN_WAGE.hourly) warnings.push({ key: "below_min_hourly", min: MIN_WAGE.hourly });
  if (type === "monthly" && salary > 0 && salary < MIN_WAGE.monthly) warnings.push({ key: "below_min_monthly", min: MIN_WAGE.monthly });
  if (!hourly && (type === "hourly" || otHours || starHours)) warnings.push({ key: "no_rate" });
  return {
    month,
    rules,
    rows,
    pay_type: type,
    hourly_rate: hourly,
    normal_days: normalDays,
    star_days: starDays,
    normal_hours: normalHours,
    star_hours: starHours,
    ot_hours: otHours,
    unconfirmed_days: unconfirmed,
    borderline_days: borderlines,
    lines,
    total,
    warnings,
  };
}

/** 화면·사진에서 들어온 하루들을 깨끗하게. 모르는 칸은 버린다. */
function cleanDays(raw, month) {
  const n = month ? daysInMonth(month) : 31;
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw)) {
    const day = parseInt(k, 10);
    if (!(day >= 1 && day <= n) || !v || typeof v !== "object") continue;
    const d = {};
    for (const s of SLOTS) {
      const t = cleanTime(v[s]);
      if (t) d[s] = t;
    }
    if (v.star) d.star = true;
    if (v.ot_hours != null && v.ot_hours !== "") {
      const h = Number(v.ot_hours);
      if (Number.isFinite(h) && h >= 0 && h <= 24) d.ot_hours = Math.round(h * 2) / 2;
    }
    if (v.ot_confirmed) d.ot_confirmed = true;
    if (Object.keys(d).length) out[String(day)] = d;
  }
  return out;
}

function cleanStaff(b) {
  const name = String((b && b.name) || "").trim().slice(0, 30);
  if (!name) return null;
  const num = (v) => {
    const x = Number(v);
    return Number.isFinite(x) && x >= 0 && x < 10000000 ? Math.round(x * 100) / 100 : null;
  };
  return {
    name,
    pay_type: b.pay_type === "monthly" ? "monthly" : "hourly",
    hourly_rate: num(b.hourly_rate),
    monthly_salary: num(b.monthly_salary),
    active: b.active !== false,
  };
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

module.exports = {
  STAFF_COLLECTION, CARDS_COLLECTION, MIN_WAGE, DEFAULT_RULES, SLOTS, MONTH_RE,
  toMin, cleanTime, rulesOf, overtimeFor, extraBlockHours, dayOf, daysInMonth, computeMonth, cleanDays, cleanStaff,
};
