// Daily settlement (결산) computation — shared by the live admin view
// (src/routes/settlements.js GET /) and the nightly snapshot the cron job
// writes into store.daily_settlements for permanent record-keeping.
const { taipeiDateString } = require("./time");

// "Problem" = still open at settlement time (not paid, not cancelled) — the
// owner asked specifically to see anything unpaid so it doesn't get missed:
// when it was ordered, which table, and exactly what was in it.
const OPEN_STATUSES = ["new", "preparing", "served"];

// startDate/endDate are inclusive "YYYY-MM-DD" strings (Taipei business
// day). Passing just one date computes that single day, same as before —
// the admin 결산 tab now also lets the owner widen this into a date range
// (e.g. "이번 주" or "이번 달") to see totals across multiple days at once.
function computeSettlement(store, startDate, endDate = startDate) {
  const rangeOrders = store.orders.filter((o) => {
    const d = o.created_at.slice(0, 10);
    return d >= startDate && d <= endDate;
  });

  const paidOrders = rangeOrders.filter((o) => o.status === "paid");
  const cancelledOrders = rangeOrders.filter((o) => o.status === "cancelled");
  const problemOrders = rangeOrders.filter((o) => OPEN_STATUSES.includes(o.status));

  const totalRevenue = paidOrders.reduce((sum, o) => sum + (o.total || 0), 0);

  // Item breakdown across paid orders only (what actually sold in this range).
  const itemMap = new Map();
  for (const o of paidOrders) {
    for (const it of o.items || []) {
      const key = it.item_id != null ? String(it.item_id) : it.name_ko || it.name_zh;
      const prev = itemMap.get(key) || { name_ko: it.name_ko, name_zh: it.name_zh, name_en: it.name_en, qty: 0, subtotal: 0 };
      prev.qty += it.qty;
      prev.subtotal += it.unit_price * it.qty;
      itemMap.set(key, prev);
    }
  }
  const itemBreakdown = [...itemMap.values()].sort((a, b) => b.subtotal - a.subtotal);

  // Per-day revenue within the selected range, so a multi-day range can
  // still be charted as a trend rather than one flat total.
  const dayMap = new Map();
  for (const o of paidOrders) {
    const d = o.created_at.slice(0, 10);
    dayMap.set(d, (dayMap.get(d) || 0) + (o.total || 0));
  }
  const dailyBreakdown = [...dayMap.entries()]
    .map(([date, revenue]) => ({ date, revenue }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    // `date` is only meaningful for a single-day query (start === end) —
    // POST /close and the cron job rely on this to key the saved snapshot.
    date: startDate === endDate ? startDate : null,
    start_date: startDate,
    end_date: endDate,
    generated_at: new Date().toISOString(),
    total_revenue: totalRevenue,
    paid_order_count: paidOrders.length,
    cancelled_order_count: cancelledOrders.length,
    problem_order_count: problemOrders.length,
    item_breakdown: itemBreakdown,
    daily_breakdown: dailyBreakdown,
    problem_orders: problemOrders
      .map((o) => ({
        id: o.id,
        table_number: o.table_number,
        status: o.status,
        created_at: o.created_at,
        total: o.total,
        items: (o.items || []).map((it) => ({ name_ko: it.name_ko, name_zh: it.name_zh, name_en: it.name_en, qty: it.qty })),
      }))
      .sort((a, b) => a.created_at.localeCompare(b.created_at)),
  };
}

module.exports = { computeSettlement, taipeiDateString };
