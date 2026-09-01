const express = require("express");
const { store, save, nextId } = require("../db");
const { requireAdmin } = require("../auth");
const { nowLocal } = require("../time");

const router = express.Router();

// Straight-line distance between two lat/lng points, in meters.
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// If the owner has set a store location (Admin > Settings), only accept
// orders placed from within `order_radius_m` meters of it. This is the real
// enforcement point — it doesn't matter whether the QR code was scanned in
// person or from an old photo, since a request from far away is rejected
// regardless. Returns null if OK, or an error code string if it should be
// rejected.
function checkLocation(lat, lng) {
  const storeLat = parseFloat(store.settings.store_lat);
  const storeLng = parseFloat(store.settings.store_lng);
  if (Number.isNaN(storeLat) || Number.isNaN(storeLng)) return null; // feature not configured yet

  if (typeof lat !== "number" || typeof lng !== "number" || Number.isNaN(lat) || Number.isNaN(lng)) {
    return "location_required";
  }
  const radius = parseFloat(store.settings.order_radius_m) || 200;
  const dist = haversineMeters(storeLat, storeLng, lat, lng);
  return dist > radius ? "out_of_range" : null;
}

// Customer: place a new order
router.post("/", async (req, res) => {
  const { tableNumber, items, note, lat, lng } = req.body || {};
  if (!tableNumber || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "invalid_order" });
  }

  // Party size is required before a table can order at all (see the
  // party-size modal in public/js/order.js) — enforced here too so it can
  // never be bypassed by a direct API call, not just hidden in the UI.
  const orderingTable = store.tables.find((t) => t.number === String(tableNumber));
  if (!orderingTable || !orderingTable.party_size) {
    return res.status(400).json({ error: "party_size_required" });
  }

  const locationError = checkLocation(lat, lng);
  if (locationError) return res.status(403).json({ error: locationError });

  const validated = [];
  let total = 0;
  for (const it of items) {
    const mi = store.menuItems.find((m) => m.id === parseInt(it.itemId, 10) && m.available);
    if (!mi) continue;
    const qty = Math.max(1, Math.min(20, parseInt(it.qty, 10) || 1));
    total += mi.price * qty;
    validated.push({
      item_id: mi.id,
      code: mi.code || null,
      name_zh: mi.name_zh,
      name_ko: mi.name_ko,
      name_en: mi.name_en,
      qty,
      unit_price: mi.price,
      option_choice: it.option || null,
      spice_choice: it.spice || null,
      // 매장(dine-in) vs 포장(takeout) — chosen per dish in the item sheet
      // (see .order-type-tabs in order.html/order.js), not once for the
      // whole order, so a single order can mix both. Anything else
      // (missing, tampered, unrecognized) safely falls back to dine-in.
      order_type: it.orderType === "takeout" ? "takeout" : "dine_in",
      note: (it.note || "").slice(0, 200),
    });
  }
  if (validated.length === 0) return res.status(400).json({ error: "no_valid_items" });

  // Griddle (불판) items like 동판불고기/닭갈비/삼겹살 carry a min_first_order_qty
  // (see src/seed.js) — the table's very first order needs to total at least
  // that many servings of the item (summed across option lines, e.g. 牛+豬
  // together for the mix-options bulgogi). Re-checked here so it can't be
  // bypassed by calling this API directly, same as the party-size/location
  // checks above — the client (public/js/order.js) already nudges toward
  // this, this is just the real enforcement point.
  const priorOrders = store.orders.filter(
    (o) => o.table_number === String(tableNumber) && o.status !== "paid" && o.status !== "cancelled"
  );
  if (priorOrders.length === 0) {
    const qtyByItem = {};
    for (const v of validated) qtyByItem[v.item_id] = (qtyByItem[v.item_id] || 0) + v.qty;
    for (const mi of store.menuItems) {
      if (!mi.min_first_order_qty) continue;
      const orderedQty = qtyByItem[mi.id] || 0;
      if (orderedQty > 0 && orderedQty < mi.min_first_order_qty) {
        return res.status(400).json({ error: "grill_min_qty", itemId: mi.id, min: mi.min_first_order_qty });
      }
    }
  }

  // Order-level summary derived from each line's own order_type (see the
  // validated.push above) — used for the quick badge in the admin queue and
  // the header line on the printed ticket. "mixed" covers an order that
  // combines dine-in and takeout dishes; the per-item detail (└ 外帶 on the
  // ticket, a small tag on the admin card) is what actually tells the
  // kitchen which specific dish needs packaging. A true delivery flow (a
  // courier picking up from outside the restaurant) is still a possible
  // future order_type value but has no per-item UI yet, so it never appears
  // here — only dine_in/takeout/mixed can come out of this derivation.
  const takeoutCount = validated.filter((v) => v.order_type === "takeout").length;
  const orderTypeSummary =
    takeoutCount === 0 ? "dine_in" : takeoutCount === validated.length ? "takeout" : "mixed";

  const order = {
    id: nextId("orders"),
    table_number: String(tableNumber),
    status: "new",
    order_type: orderTypeSummary,
    total,
    note: (note || "").slice(0, 300),
    created_at: nowLocal(),
    updated_at: nowLocal(),
    items: validated,
    // Snapshot of the table's headcount at the moment this order was
    // placed. table.party_size itself is transient (cleared once the table
    // is settled — see the PATCH /:id handler below), so this is the only
    // place a guest count survives long-term for reporting (결산). It's on
    // every order rather than only stored once per visit because that's
    // the unit 결산 already aggregates by; when it later needs a per-visit
    // guest count instead of a per-order one, group by (table_number, day)
    // the same way computeSettlement()'s turnover estimate does, and take
    // one order's party_size per group rather than summing every order.
    party_size: orderingTable.party_size,
  };
  store.orders.push(order);
  await save();

  res.status(201).json(order);
});

// Customer: this table's running order history (every item ordered so far,
// across however many separate tickets were sent in). Excludes paid/
// cancelled orders, so it naturally empties out the moment the table is
// settled via the admin "전체 결제 완료" bulk-pay action.
router.get("/table/:tableNumber", (req, res) => {
  const list = store.orders
    .filter((o) => String(o.table_number) === String(req.params.tableNumber) && o.status !== "paid" && o.status !== "cancelled")
    .sort((a, b) => a.id - b.id);
  res.json(list);
});

// Customer: check status of their own order (also used for polling in
// place of the real-time push we used to do over Socket.IO)
router.get("/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  const order = store.orders.find((o) => o.id === id);
  if (!order) return res.status(404).json({ error: "not_found" });
  res.json(order);
});

// Admin: list orders, optional ?status= and ?date=YYYY-MM-DD
router.get("/", requireAdmin, (req, res) => {
  let list = [...store.orders];
  if (req.query.status) list = list.filter((o) => o.status === req.query.status);
  if (req.query.date) list = list.filter((o) => o.created_at.slice(0, 10) === req.query.date);
  // Within any one status (the admin board groups by status client-side,
  // so only same-status relative order actually matters), an order that's
  // been drag-reordered (see PATCH /reorder above) sorts by its queue_order
  // ascending, ahead of anything never touched -- which keeps the original
  // newest-first default among themselves, so a restaurant that never
  // drags anything sees no change at all.
  list.sort((a, b) => {
    if (a.status !== b.status) return b.id - a.id;
    const aHas = a.queue_order != null;
    const bHas = b.queue_order != null;
    if (aHas && bHas) return a.queue_order - b.queue_order;
    if (aHas !== bHas) return aHas ? -1 : 1;
    return b.id - a.id;
  });
  res.json(list.slice(0, 500));
});

// Admin: persist a manual drag-to-reorder within one status column (kitchen
// wants to bump a particular order up/down the queue). Registered before
// PATCH /:id on purpose -- Express would otherwise match "reorder" itself
// as the :id param and this route would never be reached. Takes the full
// list of order ids for that column in their new on-screen order and just
// assigns each one's queue_order to its index, so the next GET / (sorted
// below) reflects the drag from then on, not just until the next refresh.
// Orders that have never been dragged keep queue_order unset and keep
// sorting by the existing newest-first default -- see the sort below.
router.patch("/reorder", requireAdmin, async (req, res) => {
  const { orderIds } = req.body || {};
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return res.status(400).json({ error: "invalid_order_ids" });
  }
  orderIds.forEach((id, index) => {
    const order = store.orders.find((o) => o.id === parseInt(id, 10));
    if (order) order.queue_order = index;
  });
  await save();
  res.json({ ok: true });
});

// Admin: update order status. Advancing an order forward (조리 시작 /
// 서빙 완료 / 결제 완료) is core day-to-day staff work and always allowed for
// any logged-in staff member; cancelling an order is gated behind the
// owner's "주문 취소" toggle, since it can hide mistakes or make food/money
// disappear from the books without a trace.
router.patch("/:id", requireAdmin, async (req, res) => {
  const { status } = req.body || {};
  const valid = ["new", "preparing", "served", "paid", "cancelled"];
  if (!valid.includes(status)) return res.status(400).json({ error: "invalid_status" });
  if (status === "cancelled" && req.session.role !== "owner") {
    const allowed = !!(store.settings.staff_permissions && store.settings.staff_permissions.orderCancel);
    if (!allowed) return res.status(403).json({ error: "permission_denied" });
  }
  const id = parseInt(req.params.id, 10);
  const order = store.orders.find((o) => o.id === id);
  if (!order) return res.status(404).json({ error: "not_found" });
  order.status = status;
  order.updated_at = nowLocal();

  // Once this table has no order left in flight (every order is now either
  // paid or cancelled), clear its registered party size — same cleanup the
  // admin's bulk "전체 결제 완료" already does explicitly, but this covers
  // every other way a table can empty out too: a single order paid off one
  // at a time through the normal new->preparing->served->paid flow, or an
  // order cancelled outright with none left behind. Without this, a table
  // could sit at "비어있음" (empty) in the admin table list while still
  // showing a stale headcount from whoever ordered last — and worse, the
  // next customer who scans that table's QR code would silently inherit
  // that stale party size instead of being asked fresh (see initPartySize()
  // in public/js/order.js), even though they're a different party entirely.
  const stillActive = store.orders.some(
    (o) => o.table_number === order.table_number && o.status !== "paid" && o.status !== "cancelled"
  );
  if (!stillActive) {
    const table = store.tables.find((t) => t.number === order.table_number);
    if (table && table.party_size) {
      table.party_size = null;
      table.party_size_updated_at = null;
    }
  }

  await save();
  res.json(order);
});

// Admin: edit an already-placed order's items (staff noticed a mistake, or
// the guest changed their mind before the food came out) — quantity,
// removal, and each line's option/spice choice, plus adding more items.
// Gated behind the owner's "주문 내용 수정" toggle, same pattern as
// orderCancel above, since silently changing what a table is charged for
// deserves the same guardrail as cancelling it outright. Only allowed while
// the order is still open (not yet paid or cancelled) — a settled order's
// items are the receipt of record and shouldn't move after the fact.
router.patch("/:id/items", requireAdmin, async (req, res) => {
  if (req.session.role !== "owner") {
    const allowed = !!(store.settings.staff_permissions && store.settings.staff_permissions.orderEdit);
    if (!allowed) return res.status(403).json({ error: "permission_denied" });
  }
  const id = parseInt(req.params.id, 10);
  const order = store.orders.find((o) => o.id === id);
  if (!order) return res.status(404).json({ error: "not_found" });
  if (order.status === "paid" || order.status === "cancelled") {
    return res.status(400).json({ error: "order_not_editable" });
  }

  const { items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "invalid_order" });
  }

  // Same validation as placing a new order (POST / above) — re-look-up
  // each item server-side rather than trusting the client's price/name, so
  // this can't be used to sneak in an unavailable item or a tampered price.
  // Unlike a fresh order, the griddle min-first-order-qty check isn't
  // re-applied here: that rule only governs a table's very first order, and
  // this is editing an order that (by definition) already exists.
  const validated = [];
  let total = 0;
  for (const it of items) {
    const mi = store.menuItems.find((m) => m.id === parseInt(it.itemId, 10) && m.available);
    if (!mi) continue;
    const qty = Math.max(1, Math.min(20, parseInt(it.qty, 10) || 1));
    total += mi.price * qty;
    validated.push({
      item_id: mi.id,
      code: mi.code || null,
      name_zh: mi.name_zh,
      name_ko: mi.name_ko,
      name_en: mi.name_en,
      qty,
      unit_price: mi.price,
      option_choice: it.option || null,
      spice_choice: it.spice || null,
      order_type: it.orderType === "takeout" ? "takeout" : "dine_in",
      note: (it.note || "").slice(0, 200),
    });
  }
  if (validated.length === 0) return res.status(400).json({ error: "no_valid_items" });

  const takeoutCount = validated.filter((v) => v.order_type === "takeout").length;
  order.order_type = takeoutCount === 0 ? "dine_in" : takeoutCount === validated.length ? "takeout" : "mixed";
  order.items = validated;
  order.total = total;
  order.updated_at = nowLocal();

  await save();
  res.json(order);
});

module.exports = router;
