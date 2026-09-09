const express = require("express");
const { store, save, nextId, findOrders } = require("../db");
const { requireOwner } = require("../auth");
const { computeSettlement, taipeiDateString } = require("../settlement");
const { sendLineMessage, formatSettlementSummary } = require("../line");

const router = express.Router();

function saveSettlementSnapshot(snapshot) {
  const existing = store.daily_settlements.find((s) => s.date === snapshot.date);
  if (existing) {
    Object.assign(existing, snapshot);
  } else {
    store.daily_settlements.push({ id: nextId("daily_settlements"), ...snapshot });
  }
}

// Settlement shows real revenue numbers, so — like 주문 취소 — it's treated
// as sensitive business data and kept owner-only rather than gated behind a
// staff-permission toggle.

// Live view for a single date or a date range (defaults to today, Taipei
// time). Always computed fresh from current orders — this is what the 결산
// tab shows when opened, so the owner never has to press a button to "do"
// the settlement. Accepts either ?date=YYYY-MM-DD (single day) or
// ?start=YYYY-MM-DD&end=YYYY-MM-DD (inclusive range, e.g. "이번 주").
router.get("/", requireOwner, async (req, res) => {
  const today = taipeiDateString();
  const start = req.query.start || req.query.date || today;
  const end = req.query.end || req.query.date || start;
  // 메모리의 store.orders 는 최근 며칠치뿐이다(src/db.js) — 지난 달 결산을
  // 뽑으려면 그 날짜 범위를 직접 질의해야 한다. created_at 이 "YYYY-MM-DD
  // HH:MM:SS" 라 문자열 범위로 그대로 걸린다(끝날짜는 그 날 23:59:59까지).
  const orders = await ordersInRange(start, end);
  res.json(computeSettlement(orders, start, end));
});

// 결산이 볼 주문을 날짜 범위로 가져온다. 인덱스는 created_at 에 걸려 있다
// (src/migrations/2026-09-10-orders-collection.js).
function ordersInRange(start, end) {
  return findOrders({ created_at: { $gte: `${start} 00:00:00`, $lte: `${end} 23:59:59` } });
}

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
  const snapshot = computeSettlement(await ordersInRange(date, date), date);
  saveSettlementSnapshot(snapshot);
  await save();
  res.json(snapshot);
});

// Sends a one-off test message using whatever LINE settings are currently
// saved, so the owner can confirm the channel access token actually works
// right after entering it, instead of waiting until the next cron run.
router.post("/line-test", requireOwner, async (req, res) => {
  const result = await sendLineMessage(store, "✅ 한국관 어드민 LINE 알림 테스트입니다. 이 메시지가 보이면 마감 자동 알림이 정상적으로 연결된 거예요!");
  if (!result.ok) return res.status(400).json(result);
  res.json({ ok: true });
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
  const snapshot = computeSettlement(await ordersInRange(date, date), date);
  saveSettlementSnapshot(snapshot);
  await save();

  if (store.settings.line_notify_enabled) {
    await sendLineMessage(store, formatSettlementSummary(snapshot));
  }

  res.json({ ok: true, date, problem_order_count: snapshot.problem_order_count });
});

module.exports = router;
