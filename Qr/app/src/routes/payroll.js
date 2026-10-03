// 직원 급여 — 사장님만(src/payroll.js 머리말).
const express = require("express");
const { getDb, connectDB, store } = require("../db");
const openHours = require("../openHours");
const { requireOwner } = require("../auth");
const { nowLocal } = require("../time");
const P = require("../payroll");

const router = express.Router();
router.use(requireOwner);


const col = async (name) => {
  await connectDB();
  return getDb().collection(name);
};
const RULES_ID = "rules";
async function loadRules() {
  const doc = await (await col("payroll_settings")).findOne({ _id: RULES_ID });
  return P.rulesOf(doc || {});
}
async function loadStaff(id) {
  return (await col(P.STAFF_COLLECTION)).findOne({ _id: String(id) });
}
// 근무 시간 — 급여 「근무 규칙」의 work_hours(2026-10-03 사장님: "아침 09:00 - 14:00 /
// 저녁 16:30 - 21:00"). 손님에게 보이는 가게 영업시간(store_hours)과는 따로다.
function workHours(rules) {
  const text = rules.work_hours || P.DEFAULT_WORK_HOURS;
  const ranges = openHours.parseHoursText(text);
  return { ranges, text, readable: ranges.length > 0 };
}
// 국가 공휴일 — payroll_settings 의 "holidays" 문서 하나(days: { "2026-10-10": { mult, note } }).
// 태풍·천재지변으로 그날 정해지기도 해서(2026-10-03 사장님) 달력에서 날짜를 직접 찍는다.
const HOLIDAYS_ID = "holidays";
async function loadHolidays() {
  const doc = await (await col("payroll_settings")).findOne({ _id: HOLIDAYS_ID });
  return (doc && doc.days) || {};
}
// 휴무로 지정된 날 — 설정 > 주문 받는 시간의 날짜 휴무(태풍 등) 또는 요일 휴무.
// 그 날은 지각·조퇴를 안 본다(2026-10-03 사장님: "휴무라고 지정되면 그건 지각이나 그런 걸로
// 적용 안되게"). 날짜 규칙이 시간만 바꾼 날(휴무 아님)은 평소대로.
function closedOn(date) {
  const cfg = openHours.orderHours(store.settings || {});
  const rule = openHours.dateRuleFor(cfg, date);
  if (rule) return !!rule.closed;
  return (cfg.closed_days || []).includes(new Date(`${date}T00:00:00Z`).getUTCDay());
}
function compute(card, staff, rules, holidays = {}) {
  const wh = workHours(rules);
  const infoFor = (date) => ({ closed: closedOn(date), holiday: holidays[date] || null });
  return {
    ...P.computeMonth(card, staff, rules, () => wh.ranges, wh.ranges, infoFor),
    work_hours: wh.readable ? wh.ranges : null,
  };
}
const staffOut = (s) => ({
  id: String(s._id), name: s.name, pay_type: s.pay_type, hourly_rate: s.hourly_rate, monthly_salary: s.monthly_salary,
  ot_rate: s.ot_rate ?? null, active: s.active !== false,
});

router.get("/status", async (req, res) => {
  const rules = await loadRules();
  res.json({ min_wage: P.MIN_WAGE, rules, work_hours: workHours(rules) });
});

router.put("/rules", async (req, res) => {
  // 보낸 칸만 바꾼다 — 나머지는 저장돼 있던 값.
  const r = P.rulesOf({ ...(await loadRules()), ...(req.body || {}) });
  if (!openHours.parseHoursText(r.work_hours).length) return res.status(400).json({ error: "bad_work_hours" });
  await (await col("payroll_settings")).updateOne({ _id: RULES_ID }, { $set: r }, { upsert: true });
  res.json({ rules: r });
});

router.get("/staff", async (req, res) => {
  const docs = await (await col(P.STAFF_COLLECTION)).find({}).toArray();
  res.json({ staff: docs.map(staffOut).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)) });
});

router.post("/staff", async (req, res) => {
  const s = P.cleanStaff(req.body);
  if (!s) return res.status(400).json({ error: "name_required" });
  // 번호는 store 카운터(nextId)로 받지 않는다(CLAUDE.md) — 시각 + 무작위.
  const id = `st${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await (await col(P.STAFF_COLLECTION)).updateOne({ _id: id }, { $set: { ...s, created_at: nowLocal() } }, { upsert: true });
  res.json({ staff: staffOut({ _id: id, ...s }) });
});

router.put("/staff/:id", async (req, res) => {
  const cur = await loadStaff(req.params.id);
  if (!cur) return res.status(404).json({ error: "not_found" });
  const s = P.cleanStaff({ ...cur, ...(req.body || {}) });
  if (!s) return res.status(400).json({ error: "name_required" });
  await (await col(P.STAFF_COLLECTION)).updateOne({ _id: cur._id }, { $set: s });
  res.json({ staff: staffOut({ _id: cur._id, ...s }) });
});

function monthOk(m) {
  return P.MONTH_RE.test(String(m || ""));
}

router.get("/card", async (req, res) => {
  const { staff: staffId, month } = req.query;
  if (!monthOk(month)) return res.status(400).json({ error: "bad_month" });
  const staff = await loadStaff(staffId);
  if (!staff) return res.status(404).json({ error: "not_found" });
  const card = (await (await col(P.CARDS_COLLECTION)).findOne({ _id: `${staff._id}|${month}` })) || { month, days: {} };
  const bonus = P.cleanBonus(card);
  res.json({ staff: staffOut(staff), card: { month, days: card.days || {}, ...bonus, updated_at: card.updated_at || null }, result: compute({ month, days: card.days || {}, ...bonus }, staff, await loadRules(), await loadHolidays()) });
});

// 저장하지 않고 계산만 — 표를 고치는 동안 아래 합계가 따라온다.
router.post("/preview", async (req, res) => {
  const b = req.body || {};
  if (!monthOk(b.month)) return res.status(400).json({ error: "bad_month" });
  const staff = await loadStaff(b.staff_id);
  if (!staff) return res.status(404).json({ error: "not_found" });
  const days = P.cleanDays(b.days, b.month);
  res.json({ result: compute({ month: b.month, days, ...P.cleanBonus(b) }, staff, await loadRules(), await loadHolidays()) });
});

router.put("/card", async (req, res) => {
  const b = req.body || {};
  if (!monthOk(b.month)) return res.status(400).json({ error: "bad_month" });
  const staff = await loadStaff(b.staff_id);
  if (!staff) return res.status(404).json({ error: "not_found" });
  const days = P.cleanDays(b.days, b.month);
  const _id = `${staff._id}|${b.month}`;
  const doc = { _id, staff_id: String(staff._id), month: b.month, days, ...P.cleanBonus(b), updated_at: nowLocal() };
  await (await col(P.CARDS_COLLECTION)).replaceOne({ _id }, doc, { upsert: true });
  res.json({ ok: true, card: doc, result: compute(doc, staff, await loadRules(), await loadHolidays()) });
});

// 이 달 직원 전체 — 누구에게 얼마, 확인 안 한 날이 몇 날.
router.get("/summary", async (req, res) => {
  const { month } = req.query;
  if (!monthOk(month)) return res.status(400).json({ error: "bad_month" });
  const rules = await loadRules();
  const holidays = await loadHolidays();
  const staff = await (await col(P.STAFF_COLLECTION)).find({}).toArray();
  const cards = await (await col(P.CARDS_COLLECTION)).find({ month }).toArray();
  const byStaff = new Map(cards.map((c) => [c.staff_id, c]));
  const rows = staff
    .filter((s) => s.active !== false || byStaff.has(String(s._id)))
    .map((s) => {
      const c = byStaff.get(String(s._id));
      const r = compute({ month, days: (c && c.days) || {}, ...P.cleanBonus(c) }, s, rules, holidays);
      return { staff: staffOut(s), has_card: !!c, normal_days: r.normal_days, star_days: r.star_days, ot_hours: r.ot_hours, late_count: r.late_count, early_count: r.early_count, total: r.total, unconfirmed_days: r.unconfirmed_days, warnings: r.warnings };
    });
  res.json({ month, rows, total: rows.reduce((a, r) => a + r.total, 0) });
});

// 국가 공휴일 목록·지정·해제. 월을 주면 그 달 것만.
router.get("/holidays", async (req, res) => {
  const all = await loadHolidays();
  const month = String(req.query.month || "");
  const days = Object.fromEntries(Object.entries(all).filter(([d]) => !month || d.startsWith(`${month}-`)).sort());
  res.json({ days, mults: P.HOLIDAY_MULTS });
});
router.put("/holidays/:date", async (req, res) => {
  const date = String(req.params.date);
  if (!P.DATE_RE.test(date)) return res.status(400).json({ error: "bad_date" });
  const h = P.cleanHoliday(req.body);
  await (await col("payroll_settings")).updateOne({ _id: HOLIDAYS_ID }, { $set: { [`days.${date}`]: h } }, { upsert: true });
  res.json({ date, holiday: h });
});
router.delete("/holidays/:date", async (req, res) => {
  const date = String(req.params.date);
  if (!P.DATE_RE.test(date)) return res.status(400).json({ error: "bad_date" });
  await (await col("payroll_settings")).updateOne({ _id: HOLIDAYS_ID }, { $unset: { [`days.${date}`]: "" } });
  res.json({ ok: true });
});

module.exports = router;
