// Daily settlement (결산) computation — shared by the live admin view
// (src/routes/settlements.js GET /) and the nightly snapshot the cron job
// writes into store.daily_settlements for permanent record-keeping.
const { taipeiDateString, nowLocal } = require("./time");

// "Problem" = still open (not paid, not cancelled) AND has been sitting
// long enough that it isn't just a table still mid-meal — the owner asked
// specifically to see anything unpaid so it doesn't get missed: when it was
// ordered, which table, and exactly what was in it. For an already-closed
// past day every open order already qualifies (it's had a whole day to be
// paid), but applying that same "any open order = problem" rule to TODAY
// while the restaurant is still running made completely normal in-progress
// orders (just placed, still cooking, or served but the table hasn't asked
// for the bill yet) show up as "미결제" too, which looked alarming and
// wasn't actually wrong — those orders just hadn't reached paid status yet
// (owner: "18개가 미결제라는 거야?" — most of those were simply today's
// still-active tables). So instead of a pure status check, an open order
// only counts once it's been open at least STALE_OPEN_ORDER_MS — long
// enough that it really does look like a missed payment rather than
// ordinary service still in progress (owner picked this over "오늘은 문제
// 표시 자체를 숨기기"/"지금 그대로 두기").
const OPEN_STATUSES = ["new", "preparing", "served"];
const STALE_OPEN_ORDER_MS = 2 * 60 * 60 * 1000; // 2 hours

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
  // Both timestamps below come from nowLocal() (see src/time.js) — a plain
  // "YYYY-MM-DD HH:MM:SS" Taipei wall-clock string with no timezone
  // designator, which Date() parses using whatever timezone the running
  // process happens to be in (Vercel's default is UTC, per time.js's own
  // comment). Parsing "now" through the exact same nowLocal() + Date()
  // path as every order's created_at means both ends pick up that same
  // misinterpretation, so it cancels out in the subtraction below and the
  // elapsed duration comes out correct regardless of the server's actual
  // process timezone. Mixing this with a real `new Date()` instead would
  // silently be off by Taipei's UTC+8 offset.
  const nowMs = new Date(nowLocal().replace(" ", "T")).getTime();
  const problemOrders = rangeOrders.filter((o) => {
    if (!OPEN_STATUSES.includes(o.status)) return false;
    const placedMs = new Date(o.created_at.replace(" ", "T")).getTime();
    return nowMs - placedMs >= STALE_OPEN_ORDER_MS;
  });

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

  // Hour-of-day breakdown (0-23), combined across every day in the range —
  // "몇 시에 손님이 많이 오는지" (order_count counts every order regardless
  // of status — arriving/ordering is arriving, whether or not it's been
  // paid yet) and "그 시간대엔 뭐가 잘 팔리는지" (top_items, paid orders
  // only, same convention as the item breakdown above).
  const hourMap = new Map();
  for (const o of rangeOrders) {
    const hour = parseInt(o.created_at.slice(11, 13), 10);
    const entry = hourMap.get(hour) || { hour, revenue: 0, order_count: 0, itemMap: new Map() };
    entry.order_count += 1;
    if (o.status === "paid") {
      entry.revenue += o.total || 0;
      for (const it of o.items || []) {
        const key = it.item_id != null ? String(it.item_id) : it.name_ko || it.name_zh;
        const prev = entry.itemMap.get(key) || { name_ko: it.name_ko, name_zh: it.name_zh, name_en: it.name_en, qty: 0 };
        prev.qty += it.qty;
        entry.itemMap.set(key, prev);
      }
    }
    hourMap.set(hour, entry);
  }
  const hourlyBreakdown = [...hourMap.values()]
    .map((e) => ({
      hour: e.hour,
      revenue: e.revenue,
      order_count: e.order_count,
      top_items: [...e.itemMap.values()]
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 3)
        .map((it) => ({ name_ko: it.name_ko, name_zh: it.name_zh, name_en: it.name_en, qty: it.qty })),
    }))
    .sort((a, b) => a.hour - b.hour);

  // Rough table-turnover estimate: for each (table, calendar day) that had
  // at least one paid order in range, minutes from its first order to its
  // last order being marked paid. This is an approximation — the data model
  // has no explicit "party seated/left" event, so a table that gets a second
  // unrelated party later the same day would still be treated as one block.
  // Good enough for a general "how long do tables usually take" read, not
  // meant to be exact to the second.
  const tableDayMap = new Map();
  for (const o of rangeOrders) {
    const day = o.created_at.slice(0, 10);
    const key = `${o.table_number}|${day}`;
    const entry = tableDayMap.get(key) || { minCreated: o.created_at, maxPaidUpdated: null };
    if (o.created_at < entry.minCreated) entry.minCreated = o.created_at;
    if (o.status === "paid" && (!entry.maxPaidUpdated || o.updated_at > entry.maxPaidUpdated)) {
      entry.maxPaidUpdated = o.updated_at;
    }
    tableDayMap.set(key, entry);
  }
  let turnoverSumMinutes = 0;
  let turnoverSamples = 0;
  for (const { minCreated, maxPaidUpdated } of tableDayMap.values()) {
    if (!maxPaidUpdated) continue;
    const minutes = (new Date(maxPaidUpdated.replace(" ", "T")) - new Date(minCreated.replace(" ", "T"))) / 60000;
    if (minutes >= 0) {
      turnoverSumMinutes += minutes;
      turnoverSamples += 1;
    }
  }
  const avgTurnoverMinutes = turnoverSamples > 0 ? Math.round(turnoverSumMinutes / turnoverSamples) : null;

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
    hourly_breakdown: hourlyBreakdown,
    avg_turnover_minutes: avgTurnoverMinutes,
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
