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
//   · 근무 시간대: 처음엔 가게 영업시간(11–14 · 17–21)을 읽었으나, 같은 날 사장님이
//     직원 근무 시간을 따로 주셨다 — "아침 09:00 - 14:00 / 저녁 16:30 - 21:00". 그래서
//     급여 「근무 규칙」(payroll_settings 의 work_hours)이 근무 시간이다. 손님용
//     영업시간 문구와는 따로 둔다(그건 손님에게 보이는 문장이다).
//   · 초과 시간: 그 날 영업시간의 끝(오전 구간 끝 · 오후 구간 끝)을 25분 넘기면 0.5시간,
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

// 직원 근무 시간 — 가게 영업시간(손님용 11–14 · 17–21)과 다르다. 2026-10-03 사장님:
// "아침 09:00 - 14:00 / 저녁 16:30 - 21:00". 급여 「근무 규칙」에서 고친다.
const DEFAULT_WORK_HOURS = "09:00-14:00, 16:30-21:00";
const FALLBACK_RANGES = [{ start: "09:00", end: "14:00" }, { start: "16:30", end: "21:00" }];

const DEFAULT_RULES = {
  ot_threshold_min: 25, // 이만큼 넘기면 0.5시간
  ot_step_min: 30, // 그 뒤 이만큼마다 0.5시간 더
  borderline_min: 10, // 기준 ±10분이면 「확인 필요」로 칠한다
  late_unit_min: 30, // 지각은 이만큼마다 0.5시간 차감(30분 미만은 세지 않는다)
  // 봐주는 분(2026-10-04 사장님: "출퇴근에 각각 몇 분 정도 봐줄지 근무 규칙에 넣어주고 … 1분인데 차감하면
  // 안되니까"). 이만큼까지 늦거나 일찍 간 것은 지각·조퇴가 아니다.
  late_grace_min: 5,
  early_grace_min: 5,
  default_hourly: 220, // 직원 시급을 비우면 이 시급(2026 사장님: "1시간 시급 220")
  work_hours: DEFAULT_WORK_HOURS,
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
  for (const k of ["ot_threshold_min", "ot_step_min", "borderline_min", "late_unit_min"]) {
    const n = Number(raw && raw[k]);
    if (Number.isFinite(n) && n > 0 && n <= 120) r[k] = Math.round(n);
  }
  for (const k of ["late_grace_min", "early_grace_min"]) {
    const v = raw && raw[k];
    const n = Number(v);
    if (v != null && v !== "" && Number.isFinite(n) && n >= 0 && n <= 120) r[k] = Math.round(n);
  }
  const h = Number(raw && raw.default_hourly);
  if (raw && raw.default_hourly != null && raw.default_hourly !== "" && Number.isFinite(h) && h >= 0 && h < 100000) r.default_hourly = Math.round(h * 100) / 100;
  const w = String((raw && raw.work_hours) || "").trim().slice(0, 100);
  if (w) r.work_hours = w;
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

/** 영업시간 구간들 → 오전 블록·오후 블록. 구간이 하나면 그 하나가 하루 전체. */
function blocksOf(ranges) {
  const rs = (Array.isArray(ranges) ? ranges : []).filter((r) => r && toMin(r.start) != null && toMin(r.end) != null);
  const use = rs.length ? rs : FALLBACK_RANGES;
  return use.length === 1 ? { single: use[0] } : { am: use[0], pm: use[use.length - 1] };
}
function blockHours(r) {
  let m = toMin(r.end) - toMin(r.start);
  if (m <= 0) m += 24 * 60; // 자정을 넘는 구간
  return m / 60;
}

/**
 * 하루 — 기본 시간(찍힌 블록만큼), 제안 초과 시간, 「확인 필요」.
 * 기본 시간은 찍힌 시각이 아니라 **블록**(그날 영업시간 구간)으로 센다: 오전을
 * 찍었으면 오전 구간, 오후를 찍었으면 오후 구간. 몇 분 일찍 나온 것을 깎지 않는다.
 * ranges: 그 날짜의 영업시간 구간. 휴무일(빈 배열)에 일했으면 기본 구간으로 센다.
 */
function dayOf(day, rules = DEFAULT_RULES, ranges = null, info = null) {
  const d = day || {};
  const has = (a, b) => !!(cleanTime(d[a]) || cleanTime(d[b]));
  const am = has("am_in", "am_out");
  const pm = has("pm_in", "pm_out");
  const ot = has("ot_in", "ot_out");
  const b = blocksOf(ranges);
  const regular = b.single ? (am || pm ? blockHours(b.single) : 0) : (am ? blockHours(b.am) : 0) + (pm ? blockHours(b.pm) : 0);
  const notes = [];
  let suggested = 0;
  let borderline = false;
  const over = (outKey, end, label) => {
    const out = toMin(d[outKey]);
    if (out == null || !end) return;
    let o = out - toMin(end);
    if (o < -12 * 60) o += 24 * 60;
    if (o <= 0) return;
    const h = overtimeFor(o, rules);
    if (Math.abs(o - rules.ot_threshold_min) <= rules.borderline_min) borderline = true;
    if (h > 0 || o >= rules.ot_threshold_min - rules.borderline_min) notes.push({ slot: label, over_min: o, hours: h });
    suggested += h;
  };
  if (b.single) {
    // 하루 한 구간 — 마지막으로 나간 시각만 끝과 견준다.
    over(cleanTime(d.pm_out) ? "pm_out" : "am_out", b.single.end, cleanTime(d.pm_out) ? "pm" : "am");
  } else {
    over("am_out", b.am.end, "am");
    over("pm_out", b.pm.end, "pm");
  }
  // 지각·조퇴 — 영업시간 구간 시작보다 늦게 찍은 출근, 끝보다 일찍 찍은 퇴근(2026-10-03
  // 사장님: "지각 조퇴도 넣어줘"). 카드 「遲到早退次數」 칸과 같은 것. 돈은 깎지 않고 센다.
  const late = [];
  const early = [];
  const lateEarly = (inKey, outKey, r, label) => {
    if (!r) return;
    const i = toMin(d[inKey]);
    const o = toMin(d[outKey]);
    // 2026-10-03 사장님: "지각은 30분 단위로 카운트 시작해서 0.5 단위로 / 조퇴는 근무시간
    // 중 자리를 비운 시간 단위로 … 지각, 조퇴시 급여에서 차감".
    //  · 지각: 30분 늦으면 0.5시간, 60분이면 1시간 … (30분 미만은 지각이 아니다)
    //  · 조퇴: 비운 분 그대로(13:50 퇴근 → 10분)
    // 「30분 단위로 카운트 시작」 — 30분이 안 되게 늦은 것은 지각으로 세지 않는다.
    if (i != null && i - toMin(r.start) >= rules.late_unit_min && i - toMin(r.start) > rules.late_grace_min) {
      const min = i - toMin(r.start);
      late.push({ slot: label, min, hours: Math.floor(min / rules.late_unit_min) * 0.5 });
    }
    if (o != null && toMin(r.end) - o > rules.early_grace_min && toMin(r.end) - o < 12 * 60) {
      const min = toMin(r.end) - o;
      early.push({ slot: label, min, hours: min / 60 });
    }
  };
  // 휴무로 지정된 날(설정 > 주문 받는 시간의 요일 휴무·날짜 휴무)은 지각·조퇴를 안 본다 —
  // 2026-10-03 사장님: "휴무라고 지정되면 그건 지각이나 그런 걸로 적용 안되게 해줘".
  const closed = !!(info && info.closed);
  if (closed) {
    // 아무것도 안 센다
  } else if (b.single) {
    lateEarly("am_in", cleanTime(d.pm_out) ? "pm_out" : "am_out", b.single, "am");
  } else {
    lateEarly("am_in", "am_out", b.am, "am");
    lateEarly("pm_in", "pm_out", b.pm, "pm");
  }
  const extra = extraBlockHours(d.ot_in, d.ot_out);
  suggested += extra;
  const set = d.ot_hours != null && Number.isFinite(Number(d.ot_hours));
  // 지각·조퇴 차감도 사장님이 고친다 — 초과처럼(2026-10-04 사장님: "초과 시간처럼 지각 조퇴에도 숫자를 우리가
  // 하게 해줘. 만약에 우리가 납득할 만한 이유거나"). le_hours 가 있으면 규칙이 낸 숫자 대신 그것.
  const suggestedDeduct = late.reduce((a, x) => a + x.hours, 0) + early.reduce((a, x) => a + x.hours, 0);
  const leSet = d.le_hours != null && Number.isFinite(Number(d.le_hours));
  // 출근 일수 — 오전 0.5 · 오후 0.5(2026-10-03 사장님: "하나에 0.5 씩 해서 일수 채워줘.
  // 반올림하지 말고"). 영업시간이 한 구간이면 그 하루가 1.
  const dayUnits = b.single ? (am || pm ? 1 : 0) : (am ? 0.5 : 0) + (pm ? 0.5 : 0);
  return {
    worked: am || pm || ot,
    day_units: dayUnits,
    late,
    early,
    closed,
    holiday: (info && info.holiday) || null,
    suggested_deduct: suggestedDeduct,
    deduct_set: leSet,
    deduct_hours: leSet ? Number(d.le_hours) : suggestedDeduct,
    // 0 으로 봐준 날은 지각·조퇴 횟수에도 안 넣는다(누가 많이 했나에 안 잡힌다).
    excused: leSet && Number(d.le_hours) === 0 && suggestedDeduct > 0,
    star: !!d.star,
    blocks: b.single ? [b.single] : [b.am, b.pm],
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
/**
 * hoursFor(dateStr) → 그날 영업시간 구간들. 휴무로 빈 배열이면 baseRanges(기본
 * 영업시간)로 센다 — 문 닫은 날에 나와 일했으면(정리·행사) 평소 시간으로 본다.
 */
function computeMonth(card, staff, rawRules, hoursFor = null, baseRanges = null, infoFor = null) {
  const rules = rulesOf(rawRules);
  const month = card && card.month;
  const n = month ? daysInMonth(month) : 31;
  const days = (card && card.days) || {};
  const rows = [];
  let normalDays = 0, starDays = 0, normalHours = 0, starHours = 0, otHours = 0, unconfirmed = 0, borderlines = 0;
  const holidayHours = {}; // 배율마다 — 국가 공휴일에 일한 기본 시간
  let deductEdited = 0;
  let lateCount = 0, lateMin = 0, lateHours = 0, earlyCount = 0, earlyMin = 0, deductStar = 0, deductNormal = 0;
  for (let i = 1; i <= n; i++) {
    const date = month ? `${month}-${String(i).padStart(2, "0")}` : null;
    let ranges = hoursFor && date ? hoursFor(date) : null;
    if (ranges && !ranges.length) ranges = baseRanges;
    const d = dayOf(days[i] || days[String(i)], rules, ranges, infoFor && date ? infoFor(date) : null);
    rows.push({ day: i, ...d });
    if (!d.worked) continue;
    if (d.star) { starDays += d.day_units; starHours += d.regular_hours; } else { normalDays += d.day_units; normalHours += d.regular_hours; }
    if (!d.excused) {
      for (const x of d.late) { lateCount++; lateMin += x.min; lateHours += x.hours; }
      for (const x of d.early) { earlyCount++; earlyMin += x.min; }
    }
    if (d.deduct_set) deductEdited++;
    if (d.star) deductStar += d.deduct_hours;
    else deductNormal += d.deduct_hours;
    if (d.holiday) {
      const key = String(d.holiday.mult);
      const h = (holidayHours[key] = holidayHours[key] || { mult: d.holiday.mult, normal: 0, star: 0, days: [] });
      h[d.star ? "star" : "normal"] += d.regular_hours;
      h.days.push(i);
    }
    otHours += d.ot_hours;
    if ((d.suggested_ot > 0 || d.ot_hours > 0 || d.borderline) && !d.ot_confirmed) unconfirmed++;
    if (d.borderline && !d.ot_confirmed) borderlines++;
  }
  const s = staff || {};
  const type = s.pay_type === "monthly" ? "monthly" : "hourly";
  const salary = Math.max(0, Number(s.monthly_salary) || 0);
  // 시급을 비우면: 월급제는 월급 ÷ 240, 시급제는 가게 기본 시급(근무 규칙, 2026: 220).
  const hourly = Number(s.hourly_rate) > 0 ? Number(s.hourly_rate) : type === "monthly" && salary ? r2(salary / 240) : rules.default_hourly || 0;
  // 직원마다 따로 정하는 값(2026-10-03 사장님: "둘 다 시급 얼마 줄 거고 초과 근무 시간
  // 얼마 줄거고 이런 걸 다 개개별로 정할 수 있게"). 비워 두면 기본 시급과 같다.
  const otRate = Number(s.ot_rate) > 0 ? Number(s.ot_rate) : hourly;
  // ★ 날도 같은 시급 — 2026-10-03 사장님: "우린 주5일 넘어도 다른 시급으로 주지 않아 다 똑같은
  // 시급으로 고정으로 줘". 그래서 ★ 날 시급 칸은 없다(예전에 적어 둔 star_rate 도 안 쓴다).
  const lines = [];
  // 국가 공휴일(2026-10-03 사장님: "대만 국가지정 공휴일은 급여가 별도로 책정이 돼. 1.3배 또는
  // 1.7배로 고를 수 있게"). 그 날 일한 기본 시간은 시급 × 배율로 따로 한 줄. 시급제는 평소 줄에서
  // 그 시간을 빼서 옮기고, 월급제는 월급에 공휴일 유급이 들어 있으므로 일한 시간만큼 얹는다.
  const hol = Object.values(holidayHours).sort((a, b) => a.mult - b.mult);
  const holHours = hol.reduce((a, h) => a + h.normal + h.star, 0);
  const holStar = hol.reduce((a, h) => a + h.star, 0);
  if (type === "hourly") {
    // 시급제는 ★ 날도 한 줄 — 시급이 같으니 「근무」에 같이 센다.
    const h = normalHours + starHours - holHours;
    lines.push({ key: "regular", hours: h, rate: hourly, amount: h * hourly });
  } else {
    lines.push({ key: "salary", amount: salary });
    // 월급제: ★ 날(주 5일을 넘긴 날)은 월급에 들어 있지 않다 — 같은 시급으로 얹는다.
    const starPlain = starHours - holStar;
    if (starPlain) lines.push({ key: "star", hours: starPlain, rate: hourly, amount: starPlain * hourly });
  }
  for (const h of hol) lines.push({ key: "holiday", mult: h.mult, hours: h.normal + h.star, rate: hourly, days: h.days, amount: (h.normal + h.star) * hourly * h.mult });
  if (otHours) lines.push({ key: "overtime", hours: otHours, rate: otRate, amount: otHours * otRate });
  // 그 달 보너스 — 카드(그 달 문서)에 적는다.
  const bonus = Math.max(0, Number(card && card.bonus) || 0);
  if (bonus) lines.push({ key: "bonus", amount: bonus, note: (card && card.bonus_note) || "" });
  // 지각·조퇴 차감 — 시급으로.
  const deduct = (deductNormal + deductStar) * hourly;
  if (deduct > 0) lines.push({ key: "deduct", hours: Math.round((deductNormal + deductStar) * 100) / 100, late_hours: lateHours, early_min: earlyMin, edited: deductEdited, rate: hourly, amount: -deduct });
  for (const l of lines) l.amount = Math.round(l.amount);
  const total = Math.max(0, lines.reduce((a, l) => a + l.amount, 0));
  const warnings = [];
  if (type === "hourly" && hourly > 0 && hourly < MIN_WAGE.hourly) warnings.push({ key: "below_min_hourly", min: MIN_WAGE.hourly });
  if (type === "monthly" && salary > 0 && salary < MIN_WAGE.monthly) warnings.push({ key: "below_min_monthly", min: MIN_WAGE.monthly });
  if ((type === "hourly" && !hourly) || (otHours && !otRate)) warnings.push({ key: "no_rate" });
  return {
    month,
    rules,
    rows,
    pay_type: type,
    hourly_rate: hourly,
    ot_rate: otRate,
    bonus,
    normal_days: normalDays,
    star_days: starDays,
    normal_hours: normalHours,
    star_hours: starHours,
    ot_hours: otHours,
    late_count: lateCount,
    late_min: lateMin,
    late_hours: lateHours,
    holiday_days: hol.reduce((a, h) => a + h.days.length, 0),
    early_count: earlyCount,
    early_min: earlyMin,
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
    if (v.le_hours != null && v.le_hours !== "") {
      const h = Number(v.le_hours);
      if (Number.isFinite(h) && h >= 0 && h <= 24) d.le_hours = Math.round(h * 100) / 100;
    }
    if (Object.keys(d).length) out[String(day)] = d;
  }
  return out;
}

function cleanStaff(b) {
  const name = String((b && b.name) || "").trim().slice(0, 30);
  if (!name) return null;
  const num = (v) => {
    if (v == null || v === "") return null; // 빈칸 = 정하지 않음(기본 시급을 따른다)
    const x = Number(v);
    return Number.isFinite(x) && x >= 0 && x < 10000000 ? Math.round(x * 100) / 100 : null;
  };
  return {
    name,
    pay_type: b.pay_type === "monthly" ? "monthly" : "hourly",
    hourly_rate: num(b.hourly_rate),
    monthly_salary: num(b.monthly_salary),
    ot_rate: num(b.ot_rate), // 초과 시급(비우면 기본 시급)
    active: b.active !== false,
  };
}

/** 그 달 보너스 — 금액과 메모. */
function cleanBonus(b) {
  const x = Number(b && b.bonus);
  return {
    bonus: Number.isFinite(x) && x > 0 && x < 10000000 ? Math.round(x) : 0,
    bonus_note: String((b && b.bonus_note) || "").trim().slice(0, 60),
  };
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const HOLIDAY_MULTS = [1.3, 1.7];

/** 국가 공휴일 한 날 — 배율은 1.3 또는 1.7 만. */
function cleanHoliday(b) {
  const m = Number(b && b.mult);
  return { mult: HOLIDAY_MULTS.includes(m) ? m : 1.3, note: String((b && b.note) || "").trim().slice(0, 40) };
}

module.exports = {
  STAFF_COLLECTION, CARDS_COLLECTION, MIN_WAGE, DEFAULT_RULES, DEFAULT_WORK_HOURS, FALLBACK_RANGES, SLOTS, MONTH_RE,
  DATE_RE, HOLIDAY_MULTS, cleanHoliday,
  toMin, cleanTime, rulesOf, blocksOf, overtimeFor, extraBlockHours, dayOf, daysInMonth, computeMonth, cleanDays, cleanStaff, cleanBonus,
};
