// 직원 급여 — 출근 카드로 한 달 (src/payroll.js).
//
// 2026-10-03 사장님이 보내주신 劉芷芸 115년 6월 카드 두 장(별 없는 카드 + ★ 카드)을
// 그대로 옮겨 잰다. 사장님이 카드에 적은 답: 출근 「21 + 4」, 초과 0.5·0.5(7일),
// 0.5(16일), 0.5(21일), 0.5(23일), 0.5·1(28일).
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};
process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "payroll";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.STAFF_PASSWORD = "staffpass123";

const P = require("../src/payroll");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

// [일, 오전 출근, 오전 퇴근, 오후 출근, 오후 퇴근]
const NORMAL = [
  [2, "09:11", "14:00", "16:04", "21:00"], [3, "09:19", "14:05", "16:08", "21:00"], [4, "09:06", "14:00", "16:05", "21:01"],
  [5, "09:08", "13:57", "16:05", "21:06"], [7, "09:02", "14:26", "16:14", "21:23"], [9, "09:00", "14:16", "16:15", "21:09"],
  [10, "09:03", "14:00", "16:14", "21:01"], [11, "09:00", "14:02", "16:12", "21:00"], [13, "08:58", "14:07", "16:10", "21:14"],
  [14, "09:06", "14:04", "16:11", "21:11"], [16, "09:01", "13:58", "16:12", "21:32"], [17, "09:08", "14:09", "16:00", "21:00"],
  [18, "09:05", "14:00", "16:12", "21:11"], [20, "09:13", "14:01", "16:04", "21:11"], [21, "09:02", "14:07", "16:12", "21:30"],
  [23, "09:06", "14:01", "16:13", "21:25"], [24, "09:13", "14:00", "16:11", "21:00"], [26, "09:04", "14:00", "16:08", "20:55"],
  [27, "09:00", "14:14", "16:12", "21:03"], [28, "09:02", "14:38", "16:07", "23:12"], [30, "09:06", "14:00", "16:05", "21:00"],
];
const STAR = [
  [6, "09:11", "14:02", "16:10", "21:00"], [12, "09:04", "14:00", "16:11", "21:08"],
  [19, "09:00", "14:07", "16:07", "21:06"], [25, "09:11", "14:00", "16:14", "20:58"],
];
const days = {};
for (const [d, a, b, c, e] of NORMAL) days[d] = { am_in: a, am_out: b, pm_in: c, pm_out: e };
for (const [d, a, b, c, e] of STAR) days[d] = { am_in: a, am_out: b, pm_in: c, pm_out: e, star: true };
const card = { month: "2026-06", days: P.cleanDays(days, "2026-06") };

out.push("[초과 시간 제안 — 25분 넘기면 0.5]");
check("24분 → 0", P.overtimeFor(24) === 0, "");
check("25분 → 0.5", P.overtimeFor(25) === 0.5, "");
check("54분 → 0.5", P.overtimeFor(54) === 0.5, "");
check("55분 → 1", P.overtimeFor(55) === 1, "");
check("기준을 바꿀 수 있다(20분)", P.overtimeFor(23, P.rulesOf({ ot_threshold_min: 20 })) === 0.5, "");

out.push("\n[劉芷芸 6월 — 두 장을 합친다]");
const staff = { name: "劉芷芸", pay_type: "hourly", hourly_rate: 200 };
const r = P.computeMonth(card, staff);
check("★★ 출근 21 + 4 (별 없는 카드 21일 · 별 카드 4일)", r.normal_days === 21 && r.star_days === 4, `${r.normal_days} + ${r.star_days}`);
// 근무 시간 09:00–14:00 · 16:30–21:00(2026-10-03 사장님) → 하루 5 + 4.5 = 9.5시간.
check("하루 9.5시간(오전 09–14 5h + 오후 16:30–21 4.5h) — 13:57·20:55 퇴근도 블록은 하루", r.normal_hours === 199.5 && r.star_hours === 38, `${r.normal_hours} / ${r.star_hours}`);
// 이 카드의 조퇴: 5일 13:57(3분) · 16일 13:58(2분) · 26일 20:55(5분) · ★25일 20:58(2분) = 12분.
// 지각: 오전 출근이 다 09:19 안, 오후 출근이 다 16:30 전 → 30분 넘게 늦은 날 없음.
check("★★ 劉芷芸 6월 조퇴 4번 12분, 지각 차감 0", r.early_count === 4 && r.early_min === 12 && r.late_hours === 0, JSON.stringify([r.early_count, r.early_min, r.late_hours]));
const row = (d) => r.rows.find((x) => x.day === d);
check("★ 7일 14:26 → 0.5 제안", row(7).notes.find((n) => n.slot === "am").hours === 0.5, JSON.stringify(row(7).notes));
check("★★ 7일 21:23(23분) → 제안 0 이지만 「확인 필요」 — 사장님은 0.5 로 적으셨다", row(7).notes.find((n) => n.slot === "pm").hours === 0 && row(7).borderline, JSON.stringify(row(7)));
check("16일 21:32 → 0.5", row(16).suggested_ot === 0.5, "");
check("21일 21:30 → 0.5", row(21).suggested_ot === 0.5, "");
check("23일 21:25 → 0.5 (경계라 확인 필요)", row(23).suggested_ot === 0.5 && row(23).borderline, "");
check("★ 28일 14:38 · 23:12 → 0.5 + 2 제안(사장님은 1 로 적으셨다 — 고쳐서 확정)", row(28).suggested_ot === 2.5, String(row(28).suggested_ot));
check("9일 14:16 · 21:09 → 0 (16분은 경계라 확인 표시만)", row(9).suggested_ot === 0 && row(9).borderline, JSON.stringify(row(9)));
check("13일 21:14 → 0 이지만 경계(14분, 기준 ±10 밖) 아님", row(13).suggested_ot === 0 && !row(13).borderline, "");
check("★★ 확인 전인 날이 남아 있다고 알린다", r.unconfirmed_days >= 6, String(r.unconfirmed_days));

out.push("\n[사장님이 확인·고침 → 카드에 적은 대로]");
const fixed = JSON.parse(JSON.stringify(card.days));
for (const [d, h] of [[7, 1], [16, 0.5], [21, 0.5], [23, 0.5], [28, 1.5]]) Object.assign(fixed[d], { ot_hours: h, ot_confirmed: true });
for (const d of Object.keys(fixed)) fixed[d].ot_confirmed = true;
const r2 = P.computeMonth({ month: "2026-06", days: P.cleanDays(fixed, "2026-06") }, staff);
check("★★ 초과 합계 4시간", r2.ot_hours === 4, String(r2.ot_hours));
check("확인 안 한 날 0", r2.unconfirmed_days === 0, String(r2.unconfirmed_days));
check("★★ 시급제: (237.5 + 4) × 200 − 조퇴 12분(12/60 × 200 = 40) = 48,260", r2.total === 48260, String(r2.total));

out.push("\n[월급제]");
const m = P.computeMonth({ month: "2026-06", days: P.cleanDays(fixed, "2026-06") }, { pay_type: "monthly", monthly_salary: 36000, hourly_rate: 150 });
check("★★ 월급 + 별 카드 날(38시간) + 초과(4시간) − 조퇴 12분 — 1배", m.total === 36000 + 42 * 150 - 30, String(m.total));
check("★ 시급 150 은 최저(196) 밑이지만 월급제는 월급으로만 경고", !m.warnings.some((w) => w.key === "below_min_hourly"), JSON.stringify(m.warnings));
const m2 = P.computeMonth({ month: "2026-06", days: {} }, { pay_type: "monthly", monthly_salary: 24000 });
check("★ 월급이 최저임금(29,500) 밑이면 경고", m2.warnings.some((w) => w.key === "below_min_monthly"), "");
const m3 = P.computeMonth({ month: "2026-06", days: P.cleanDays(fixed, "2026-06") }, { pay_type: "monthly", monthly_salary: 36000 });
check("시급을 안 적으면 월급 ÷ 240", m3.hourly_rate === 150, String(m3.hourly_rate));
const h2 = P.computeMonth(card, { pay_type: "hourly", hourly_rate: 180 });
check("★ 시급이 최저(196) 밑이면 경고 — 올리지는 않는다", h2.warnings.some((w) => w.key === "below_min_hourly") && h2.hourly_rate === 180, "");

out.push("\n[연장(加班) 칸]");
check("연장 칸은 0.5 단위 내림", P.extraBlockHours("21:30", "23:10") === 1.5, "");
check("자정을 넘겨도", P.extraBlockHours("23:00", "00:40") === 1.5, "");
const ex = P.dayOf({ pm_in: "16:00", pm_out: "21:00", ot_in: "21:30", ot_out: "23:00" });
check("연장 칸 시간이 제안에 들어간다", ex.suggested_ot === 1.5 && ex.extra_hours === 1.5, JSON.stringify(ex));

out.push("\n[입력 정리]");
const c = P.cleanDays({ 1: { am_in: "9:5" }, 2: { am_in: "9:05", am_out: "25:00" }, 31: { am_in: "09:00" }, x: {} }, "2026-06");
check("이상한 시각은 버린다, 9:05 → 09:05", !c["1"] && c["2"].am_in === "09:05" && !c["2"].am_out, JSON.stringify(c));
check("6월 31일은 없다", !c["31"], "");
check("이름 없는 직원은 안 받는다", P.cleanStaff({ name: " " }) === null, "");

out.push("\n[직원마다 시급·초과 시급·★ 날 시급, 그 달 보너스 — 2026-10-03]");
// 사장님: "해당 직원의 급여가 시급제인지 월급제인지 나눠주고 둘 다 시급 얼마 줄 거고 초과 근무
// 시간 얼마 줄거고 이런 걸 다 개개별로 정할 수 있게 해줘 그리고 보너스 칸도 만들어주고"
{
  const fd = P.cleanDays(fixed, "2026-06"); // 별 없는 날 199.5h · ★ 날 38h · 초과 4h · 조퇴 10분 + ★ 날 2분
  const h = P.computeMonth({ month: "2026-06", days: fd, bonus: 2000, bonus_note: "명절" }, { pay_type: "hourly", hourly_rate: 200, ot_rate: 300, star_rate: 250 });
  const line = (r, k) => r.lines.find((l) => l.key === k) || {};
  check("★★ 시급제: 기본 199.5h × 200", line(h, "regular").amount === 39900 && line(h, "regular").hours === 199.5, JSON.stringify(line(h, "regular")));
  check("★★ ★ 날은 ★ 날 시급 — 38h × 250", line(h, "star").amount === 9500 && line(h, "star").rate === 250, JSON.stringify(line(h, "star")));
  check("★★ 조퇴 차감은 그 날 시급으로 — 10분 × 200 + ★ 날 2분 × 250 = 42", line(h, "deduct").amount === -42, JSON.stringify(line(h, "deduct")));
  check("★★ 초과는 초과 시급 — 4h × 300", line(h, "overtime").amount === 1200 && line(h, "overtime").rate === 300, JSON.stringify(line(h, "overtime")));
  check("★★ 보너스 2,000 (메모 「명절」)", line(h, "bonus").amount === 2000 && line(h, "bonus").note === "명절", JSON.stringify(line(h, "bonus")));
  check("합계 = 39,900 + 9,500 + 1,200 + 2,000 − 42", h.total === 52558, String(h.total));
  const m = P.computeMonth({ month: "2026-06", days: fd, bonus: 3000 }, { pay_type: "monthly", monthly_salary: 36000, hourly_rate: 150, ot_rate: 220 });
  check("★★ 월급제: 월급 + ★ 날(시급 비움 → 기본 150) + 초과(220) + 보너스", m.total === 36000 + 38 * 150 + 4 * 220 + 3000 - 30 && line(m, "star").rate === 150 && line(m, "overtime").rate === 220, JSON.stringify(m.lines));
  const plain = P.computeMonth({ month: "2026-06", days: fd }, { pay_type: "hourly", hourly_rate: 200 });
  check("초과·★ 시급을 비우면 기본 시급과 같다", plain.ot_rate === 200 && plain.star_rate === 200 && !line(plain, "bonus").amount, "");
  check("보너스 정리 — 음수·글자는 0, 메모는 60자", P.cleanBonus({ bonus: -5 }).bonus === 0 && P.cleanBonus({ bonus: "abc" }).bonus === 0 && P.cleanBonus({ bonus: 1500.4, bonus_note: "x".repeat(80) }).bonus_note.length === 60, "");
  const st = P.cleanStaff({ name: "A", pay_type: "monthly", monthly_salary: 30000, hourly_rate: 160, ot_rate: 240, star_rate: "" });
  check("직원 정보에 초과 시급·★ 시급", st.ot_rate === 240 && st.star_rate === null, JSON.stringify(st));
}

out.push("\n[근무 시간을 다르게 적으면 그대로 따른다 — 11–14 · 17–21]");
{
  const BH = [{ start: "11:00", end: "14:00" }, { start: "17:00", end: "21:00" }];
  const fixedDays = P.cleanDays(fixed, "2026-06");
  const b = P.computeMonth({ month: "2026-06", days: fixedDays }, staff, null, () => BH, BH);
  check("★★ 하루 = 오전 3시간 + 오후 4시간 = 7시간", b.rows.find((x) => x.day === 2).regular_hours === 7, String(b.rows.find((x) => x.day === 2).regular_hours));
  check("★ 25일 × 7 = 175시간", b.normal_hours + b.star_hours === 175, String(b.normal_hours + b.star_hours));
  check("★★ 초과 기준은 영업시간 끝(14:00·21:00) — 카드와 같은 날이 뜬다", b.rows.find((x) => x.day === 16).suggested_ot === 0.5 && b.rows.find((x) => x.day === 7).notes.some((n) => n.slot === "am" && n.over_min === 26), "");
  check("(175 + 4) × 200 − 조퇴 12분(40) = 35,760", b.total === 35760, String(b.total));
  const closedDay = P.computeMonth({ month: "2026-06", days: { 6: { am_in: "11:00", am_out: "14:00" } } }, staff, null, () => [], BH);
  check("휴무일에 일했으면 기본 영업시간으로 센다", closedDay.rows.find((x) => x.day === 6).regular_hours === 3, "");
  const one = P.dayOf({ am_in: "11:00", am_out: "15:00", pm_in: "15:30", pm_out: "21:40" }, P.DEFAULT_RULES, [{ start: "11:00", end: "21:00" }]);
  check("영업시간이 한 구간이면 하루 그 길이, 마지막 퇴근만 견준다", one.regular_hours === 10 && one.suggested_ot === 0.5 && one.notes.length === 1, JSON.stringify(one));
}

out.push("\n[출근 일수 — 오전 0.5 · 오후 0.5, 반올림 없음 / 지각·조퇴 — 2026-10-03]");
// 사장님: "하루에 오전 오후 있으니까 하나에 0.5 씩 해서 일수 채워줘. 반 올림하지 말고
// / 그리고 지각 조퇴도 넣어줘." 黃美華 9월 카드(파란 면 5·6·12일, 주황 면 19·25·26·27일) —
// 12일은 오전만 찍었다. 화면에 「출근 7일」로 떴던 것.
{
  const BH = [{ start: "11:00", end: "14:00" }, { start: "17:00", end: "21:00" }];
  const sep = P.cleanDays({
    5: { am_in: "09:01", am_out: "14:05", pm_in: "16:19", pm_out: "21:16" },
    6: { am_in: "09:08", am_out: "14:07", pm_in: "16:15", pm_out: "21:16" },
    12: { am_in: "09:15", am_out: "14:05" },
    19: { am_in: "09:19", am_out: "14:01", pm_in: "16:23", pm_out: "21:02" },
    25: { am_in: "09:10", am_out: "14:02", pm_in: "16:23", pm_out: "21:10" },
    26: { am_in: "09:16", am_out: "14:05", pm_in: "16:22", pm_out: "21:05" },
    27: { am_in: "09:20", am_out: "14:14", pm_in: "16:18", pm_out: "21:13" },
  }, "2026-09");
  const h = P.computeMonth({ month: "2026-09", days: sep }, staff, null, () => BH, BH);
  check("★★ 黃美華 9월 출근 6.5일(12일은 오전만 = 0.5) — 7 로 올리지 않는다", h.normal_days === 6.5, String(h.normal_days));
  check("오후만 찍은 날도 0.5", P.dayOf({ pm_in: "16:30", pm_out: "21:00" }, P.DEFAULT_RULES, BH).day_units === 0.5, "");
  check("연장 칸만 있는 날은 0일(시간은 초과로 들어간다)", P.dayOf({ ot_in: "22:00", ot_out: "23:00" }, P.DEFAULT_RULES, BH).day_units === 0, "");
  check("★ 날 반나절도 0.5", P.computeMonth({ month: "2026-09", days: { 3: { am_in: "10:50", am_out: "14:00", star: true } } }, staff, null, () => BH, BH).star_days === 0.5, "");
  check("★★ 黃美華 9월 — 영업시간 전에 왔고 끝난 뒤에 갔다: 지각·조퇴 0", h.late_count === 0 && h.early_count === 0, `${h.late_count}/${h.early_count}`);
  const le = P.computeMonth({ month: "2026-09", days: { 8: { am_in: "11:07", am_out: "13:50", pm_in: "17:02", pm_out: "20:40" } } }, staff, null, () => BH, BH);
  const d8 = le.rows.find((x) => x.day === 8);
  check("★★ 11:07 · 17:02 출근은 30분 안 — 지각으로 세지 않는다", d8.late.length === 0, JSON.stringify(d8.late));
  check("★★ 조퇴 13:50 → 오전 10분, 20:40 → 오후 20분", d8.early.map((x) => `${x.slot}${x.min}`).join() === "am10,pm20", JSON.stringify(d8.early));
  check("★ 달 합계 — 지각 0번 · 조퇴 2번 30분", le.late_count === 0 && le.early_count === 2 && le.early_min === 30, JSON.stringify([le.late_count, le.late_min, le.early_count, le.early_min]));
  check("★★ 조퇴는 비운 시간 그대로 차감 — 7h × 200 − 30분(100) = 1,300", le.normal_hours === 7 && le.total === 1300, String(le.total));
  check("정각 11:00 출근 · 14:00 퇴근은 지각·조퇴 아님", P.dayOf({ am_in: "11:00", am_out: "14:00" }, P.DEFAULT_RULES, BH).late.length === 0 && P.dayOf({ am_in: "11:00", am_out: "14:00" }, P.DEFAULT_RULES, BH).early.length === 0, "");
  // 2026-10-03 사장님: "지각은 30분 단위로 카운트 시작해서 0.5 단위로 … 시급 220 … 차감".
  const W = P.FALLBACK_RANGES; // 09:00–14:00 · 16:30–21:00
  const lateH = (t) => P.dayOf({ am_in: t, am_out: "14:00" }, P.DEFAULT_RULES, W).late.reduce((a, x) => a + x.hours, 0);
  check("★★ 지각 29분(09:29) → 0, 30분 → 0.5, 59분 → 0.5, 60분 → 1, 95분 → 1.5", [lateH("09:29"), lateH("09:30"), lateH("09:59"), lateH("10:00"), lateH("10:35")].join() === "0,0.5,0.5,1,1.5", [lateH("09:29"), lateH("09:30"), lateH("09:59"), lateH("10:00"), lateH("10:35")].join());
  check("오후는 16:30 부터 — 16:59 출근은 지각 29분(0), 17:00 은 0.5", P.dayOf({ pm_in: "16:59", pm_out: "21:00" }, P.DEFAULT_RULES, W).deduct_hours === 0 && P.dayOf({ pm_in: "17:00", pm_out: "21:00" }, P.DEFAULT_RULES, W).deduct_hours === 0.5, "");
  const dflt = P.computeMonth({ month: "2026-09", days: { 1: { am_in: "09:40", am_out: "13:30" } } }, { name: "A", pay_type: "hourly", hourly_rate: null });
  check("★★ 시급을 비우면 가게 기본 시급 220", dflt.hourly_rate === 220, String(dflt.hourly_rate));
  check("★★ 지각 40분(0.5h) + 조퇴 30분(0.5h) → 5h × 220 − 1h × 220 = 880", dflt.total === 880 && dflt.lines.find((l) => l.key === "deduct").amount === -220, JSON.stringify(dflt.lines));
  check("기본 시급은 근무 규칙에서 바꾼다", P.computeMonth({ month: "2026-09", days: {} }, { pay_type: "hourly" }, { default_hourly: 230 }).hourly_rate === 230, "");
  check("퇴근만 없으면 조퇴로 세지 않는다", P.dayOf({ am_in: "10:55" }, P.DEFAULT_RULES, BH).early.length === 0, "");
}

out.push("\n[근무 시간 = 영업시간 + 준비 시간]");
{
  const BH = [{ start: "11:00", end: "14:00" }, { start: "17:00", end: "21:00" }];
  check("★★ 영업시간 11–14 · 17–21 → 근무 09:00–14:00 · 16:30–21:00 (사장님이 주신 그대로)", JSON.stringify(P.workRanges(BH)) === JSON.stringify([{ start: "09:00", end: "14:00" }, { start: "16:30", end: "21:00" }]), JSON.stringify(P.workRanges(BH)));
  check("마감 정리 30분이면 퇴근 14:30 · 21:30", P.workRanges(BH, { close_min: 30 }).map((r) => r.end).join() === "14:30,21:30", "");
  check("영업시간이 없으면 09–14 · 16:30–21", JSON.stringify(P.workRanges([])) === JSON.stringify(P.FALLBACK_RANGES), "");
}

out.push("\n[서버 — 사장님만]");
(async () => {
  const request = require("supertest");
  const app = require("../server");
  await request(app).get("/api/menu");
  let res = await request(app).get("/api/payroll/staff");
  check("로그인 안 하면 못 본다", res.status === 401 || res.status === 403, String(res.status));
  const staffAgent = request.agent(app);
  await staffAgent.post("/api/auth/login").send({ password: "staffpass123" });
  res = await staffAgent.get("/api/payroll/staff");
  check("★★ 직원 계정은 못 본다(급여는 사장님만)", res.status === 401 || res.status === 403, String(res.status));
  const boss = request.agent(app);
  await boss.post("/api/auth/login").send({ password: "ownerpass123" });
  res = await boss.post("/api/payroll/staff").send({ name: "劉芷芸", pay_type: "hourly", hourly_rate: 200 });
  check("직원 추가", res.status === 200 && res.body.staff.id, JSON.stringify(res.body));
  const id = res.body.staff.id;
  res = await boss.post("/api/payroll/preview").send({ staff_id: id, month: "2026-06", days: fixed });
  // 근무 시간(09:00–14:00, 16:30–21:00) 기준 — 하루 9.5시간. 가게 영업시간(11–14 · 17–21)이 아니다.
  check("★★ 저장 없이 계산 — 근무 시간 기준 48,260", res.status === 200 && res.body.result.total === 48260 && JSON.stringify(res.body.result.work_hours) === JSON.stringify([{ start: "09:00", end: "14:00" }, { start: "16:30", end: "21:00" }]), JSON.stringify(res.body.result && res.body.result.total));
  res = await boss.get(`/api/payroll/card?staff=${id}&month=2026-06`);
  check("미리 계산은 저장하지 않는다", res.status === 200 && Object.keys(res.body.card.days).length === 0, "");
  res = await boss.put("/api/payroll/card").send({ staff_id: id, month: "2026-06", days: fixed });
  check("★ 저장", res.status === 200 && res.body.result.total === 48260, "");
  res = await boss.put(`/api/payroll/staff/${id}`).send({ ot_rate: 300, star_rate: 250 });
  check("★ 직원별 초과 시급·★ 날 시급 저장", res.body.staff.ot_rate === 300 && res.body.staff.star_rate === 250 && res.body.staff.hourly_rate === 200, JSON.stringify(res.body));
  res = await boss.put("/api/payroll/card").send({ staff_id: id, month: "2026-06", days: fixed, bonus: 2000, bonus_note: "명절" });
  check("★ 보너스를 카드와 같이 저장", res.body.card.bonus === 2000 && res.body.card.bonus_note === "명절", JSON.stringify(res.body.card && res.body.card.bonus));
  res = await boss.get(`/api/payroll/card?staff=${id}&month=2026-06`);
  // 별 없는 날 199.5h×200 + ★ 날 38h×250 + 초과 4h×300 + 보너스 2,000 − 조퇴(10분×200 + 2분×250 = 42)
  check("★★ 다시 열면 보너스·시급이 그대로 들어간 합계", res.body.card.bonus === 2000 && res.body.result.total === 199.5 * 200 + 38 * 250 + 4 * 300 + 2000 - 42, String(res.body.result.total));
  await boss.put(`/api/payroll/staff/${id}`).send({ ot_rate: null, star_rate: null });
  await boss.put("/api/payroll/card").send({ staff_id: id, month: "2026-06", days: fixed });
  res = await boss.get(`/api/payroll/card?staff=${id}&month=2026-06`);
  check("★ 다시 열면 그대로", res.body.result.normal_days === 21 && res.body.result.star_days === 4 && res.body.result.ot_hours === 4, JSON.stringify(res.body.result.normal_days));
  res = await boss.get("/api/payroll/summary?month=2026-06");
  check("★ 이 달 전체 합계", res.status === 200 && res.body.total === 48260 && res.body.rows.length === 1, JSON.stringify(res.body));
  // ★★ 근무 시간은 영업시간(설정 > 영업시간)을 따라 움직인다 — 2026-10-03 사장님: "시간을
  // 고정하는 게 아니라 우리가 운영시간 정하는 곳이 있잖아? 그거에 따라 움직일 수 있게".
  const { store } = require("../src/db");
  const before = store.settings.store_hours;
  store.settings.store_hours = "10:00-14:00, 17:00-21:00";
  res = await boss.get(`/api/payroll/card?staff=${id}&month=2026-06`);
  // 오전 08:00–14:00(6h) + 오후 16:30–21:00(4.5h) = 10.5h → (25 × 10.5 + 4) × 200 = 53,300.
  // 그런데 카드는 09시대 출근 — 08:00 기준이면 매일 지각: 60분 넘으면 1h(24일), 13일 08:58 은 0.5h
  // → 24.5h × 200 = 4,900 차감, 조퇴 40 → 48,360.
  check("★★ 영업시간을 10시로 당기면 출근도 08:00 — 하루 10.5시간, 09시 출근은 지각", res.body.result.total === 48360 && res.body.result.work_hours[0].start === "08:00" && res.body.result.late_hours === 24.5, JSON.stringify([res.body.result.total, res.body.result.late_hours]));
  store.settings.store_hours = "영업시간 문의";
  res = await boss.get(`/api/payroll/card?staff=${id}&month=2026-06`);
  check("영업시간을 못 읽으면 09–14 · 16:30–21 로 세고 그렇다고 알린다(business_hours null)", res.body.result.business_hours === null && res.body.result.total === 48260, JSON.stringify(res.body.result.business_hours));
  store.settings.store_hours = before;
  res = await boss.put("/api/payroll/rules").send({ prep_am_min: 60 });
  res = await boss.get(`/api/payroll/card?staff=${id}&month=2026-06`);
  check("★ 준비 시간(오전 60분)을 바꾸면 10:00 출근 — 하루 8.5시간", res.body.result.work_hours[0].start === "10:00" && res.body.result.rows.find((x) => x.day === 2).regular_hours === 8.5, JSON.stringify(res.body.result.work_hours));
  res = await boss.put("/api/payroll/rules").send({ prep_am_min: 120, default_hourly: 225 });
  check("규칙을 고쳐도 보낸 칸만 — 초과 기준은 그대로", res.body.rules.ot_threshold_min === 25 && res.body.rules.default_hourly === 225 && res.body.rules.prep_pm_min === 30, JSON.stringify(res.body.rules));
  await boss.put("/api/payroll/rules").send({ default_hourly: 220 });
  res = await boss.get("/api/payroll/status");
  check("상태에 영업시간과 근무 시간", res.body.work_hours.readable && JSON.stringify(res.body.work_hours.ranges) === JSON.stringify([{ start: "09:00", end: "14:00" }, { start: "16:30", end: "21:00" }]), JSON.stringify(res.body.work_hours));
  res = await boss.put(`/api/payroll/staff/${id}`).send({ hourly_rate: 210 });
  check("시급 고치기", res.body.staff.hourly_rate === 210 && res.body.staff.name === "劉芷芸", JSON.stringify(res.body));
  res = await boss.put("/api/payroll/rules").send({ ot_threshold_min: 20 });
  check("초과 기준 바꾸기", res.body.rules.ot_threshold_min === 20 && !("am_end" in res.body.rules), JSON.stringify(res.body));
  res = await boss.get("/api/payroll/card?staff=nope&month=2026-06");
  check("없는 직원 404", res.status === 404, "");
  res = await boss.get(`/api/payroll/card?staff=${id}&month=2026-13`);
  check("이상한 달 400", res.status === 400, "");
  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
