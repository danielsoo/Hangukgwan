// 직원 급여 — 사장님만(src/payroll.js 머리말).
const express = require("express");
const { getDb, connectDB } = require("../db");
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
function compute(card, staff, rules) {
  const wh = workHours(rules);
  return {
    ...P.computeMonth(card, staff, rules, () => wh.ranges, wh.ranges),
    work_hours: wh.readable ? wh.ranges : null,
  };
}
const staffOut = (s) => ({
  id: String(s._id), name: s.name, pay_type: s.pay_type, hourly_rate: s.hourly_rate, monthly_salary: s.monthly_salary,
  ot_rate: s.ot_rate ?? null, star_rate: s.star_rate ?? null, active: s.active !== false,
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
  res.json({ staff: staffOut(staff), card: { month, days: card.days || {}, ...bonus, updated_at: card.updated_at || null }, result: compute({ month, days: card.days || {}, ...bonus }, staff, await loadRules()) });
});

// 저장하지 않고 계산만 — 표를 고치는 동안 아래 합계가 따라온다.
router.post("/preview", async (req, res) => {
  const b = req.body || {};
  if (!monthOk(b.month)) return res.status(400).json({ error: "bad_month" });
  const staff = await loadStaff(b.staff_id);
  if (!staff) return res.status(404).json({ error: "not_found" });
  const days = P.cleanDays(b.days, b.month);
  res.json({ result: compute({ month: b.month, days, ...P.cleanBonus(b) }, staff, await loadRules()) });
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
  res.json({ ok: true, card: doc, result: compute(doc, staff, await loadRules()) });
});

// 이 달 직원 전체 — 누구에게 얼마, 확인 안 한 날이 몇 날.
router.get("/summary", async (req, res) => {
  const { month } = req.query;
  if (!monthOk(month)) return res.status(400).json({ error: "bad_month" });
  const rules = await loadRules();
  const staff = await (await col(P.STAFF_COLLECTION)).find({}).toArray();
  const cards = await (await col(P.CARDS_COLLECTION)).find({ month }).toArray();
  const byStaff = new Map(cards.map((c) => [c.staff_id, c]));
  const rows = staff
    .filter((s) => s.active !== false || byStaff.has(String(s._id)))
    .map((s) => {
      const c = byStaff.get(String(s._id));
      const r = compute({ month, days: (c && c.days) || {}, ...P.cleanBonus(c) }, s, rules);
      return { staff: staffOut(s), has_card: !!c, normal_days: r.normal_days, star_days: r.star_days, ot_hours: r.ot_hours, late_count: r.late_count, early_count: r.early_count, total: r.total, unconfirmed_days: r.unconfirmed_days, warnings: r.warnings };
    });
  res.json({ month, rows, total: rows.reduce((a, r) => a + r.total, 0) });
});

module.exports = router;
