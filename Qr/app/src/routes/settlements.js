const express = require("express");
const { store, save, nextId } = require("../db");
const { requireOwner } = require("../auth");
const { computeSettlement, taipeiDateString } = require("../settlement");

const router = express.Router();

// Settlement shows real revenue numbers, so — like 주문 취소 — it's treated
// as sensitive business data and kept owner-only rather than gated behind a
// staff-permission toggle.

// Live view for a single date or a date range (defaults to today, Taipei
// time). Always computed fresh from current orders — this is what the 결산
// tab shows when opened, so the owner never has to press a button to "do"
// the settlement. Accepts either ?date=YYYY-MM-DD (single day) or
// ?start=YYYY-MM-DD&end=YYYY-MM-DD (inclusive range, e.g. "이번 주").
router.get("/", requireOwner, (req, res) => {
  const today = taipeiDateString();
  const start = req.query.start || req.query.date || today;
  const end = req.query.end || req.query.date || start;
  res.json(computeSettlement(store, start, end));
});

// Permanent nightly snapshots (written by the cron job below, or manually
// via POST /close) — kept in case orders are later edited/pruned and the
// live numbers for an old date would otherwise drift from what actually
// closed that night.
router.get("/history", requireOwner, (req, res) => {
  const list = [...store.daily_settlements].sort((a, b) => b.date.localeCompare(a.date));
  res.json(list.slice(0, 90));
});

// Manually snapshot a given date (defaults to today) into permanent history.
// Safe to call more than once for the same date — replaces any existing
// snapshot for that date rather than duplicating it.
router.post("/close", requireOwner, async (req, res) => {
  const date = (req.body && req.body.date) || taipeiDateString();
  const snapshot = computeSettlement(store, date);
  const existing = store.daily_settlements.find((s) => s.date === date);
  if (existing) {
    Object.assign(existing, snapshot);
  } else {
    store.daily_settlements.push({ id: nextId("daily_settlements"), ...snapshot });
  }
  await save();
  res.json(snapshot);
});

// Hit once a day by Vercel Cron (see vercel.json) shortly after closing time
// to snapshot *today's* business day automatically — this is the "영업
// 시간이 끝나면 자동으로 결산" part. Vercel signs cron requests with an
// `Authorization: Bearer $CRON_SECRET` header when CRON_SECRET is set as an
// env var; there's no browser session on a cron request, so this can't use
// requireOwner/requireAdmin like the routes above.
router.get("/cron-close", async (req, res) => {
  if (process.env.CRON_SECRET) {
    const header = req.get("authorization") || "";
    if (header !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: "unauthorized" });
    }
  }
  const date = taipeiDateString();
  const snapshot = computeSettlement(store, date);
  const existing = store.daily_settlements.find((s) => s.date === date);
  if (existing) {
    Object.assign(existing, snapshot);
  } else {
    store.daily_settlements.push({ id: nextId("daily_settlements"), ...snapshot });
  }
  await save();
  res.json({ ok: true, date, problem_order_count: snapshot.problem_order_count });
});

module.exports = router;
