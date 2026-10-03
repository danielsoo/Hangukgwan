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
check("하루 기본 10시간(오전 5 + 오후 5) — 일찍 나온 13:57·20:55 도 하루", r.normal_hours === 210 && r.star_hours === 40, `${r.normal_hours} / ${r.star_hours}`);
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
check("★★ 시급제: (250 + 4) × 200 = 50,800", r2.total === 50800, String(r2.total));

out.push("\n[월급제]");
const m = P.computeMonth({ month: "2026-06", days: P.cleanDays(fixed, "2026-06") }, { pay_type: "monthly", monthly_salary: 36000, hourly_rate: 150 });
check("★★ 월급 + 별 카드 날(40시간) + 초과(4시간) — 1배", m.total === 36000 + 44 * 150, String(m.total));
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
  check("★ 저장 없이 계산", res.status === 200 && res.body.result.total === 50800, JSON.stringify(res.body.result && res.body.result.total));
  res = await boss.get(`/api/payroll/card?staff=${id}&month=2026-06`);
  check("미리 계산은 저장하지 않는다", res.status === 200 && Object.keys(res.body.card.days).length === 0, "");
  res = await boss.put("/api/payroll/card").send({ staff_id: id, month: "2026-06", days: fixed });
  check("★ 저장", res.status === 200 && res.body.result.total === 50800, "");
  res = await boss.get(`/api/payroll/card?staff=${id}&month=2026-06`);
  check("★ 다시 열면 그대로", res.body.result.normal_days === 21 && res.body.result.star_days === 4 && res.body.result.ot_hours === 4, JSON.stringify(res.body.result.normal_days));
  res = await boss.get("/api/payroll/summary?month=2026-06");
  check("★ 이 달 전체 합계", res.status === 200 && res.body.total === 50800 && res.body.rows.length === 1, JSON.stringify(res.body));
  res = await boss.put(`/api/payroll/staff/${id}`).send({ hourly_rate: 210 });
  check("시급 고치기", res.body.staff.hourly_rate === 210 && res.body.staff.name === "劉芷芸", JSON.stringify(res.body));
  res = await boss.put("/api/payroll/rules").send({ ot_threshold_min: 20 });
  check("초과 기준 바꾸기", res.body.rules.ot_threshold_min === 20 && res.body.rules.am_end === "14:00", JSON.stringify(res.body));
  res = await boss.get("/api/payroll/card?staff=nope&month=2026-06");
  check("없는 직원 404", res.status === 404, "");
  res = await boss.get(`/api/payroll/card?staff=${id}&month=2026-13`);
  check("이상한 달 400", res.status === 400, "");
  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
