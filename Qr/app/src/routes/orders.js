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
  list.sort((a, b) => b.id - a.id);
  res.json(list.slice(0, 500));
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
  await save();
  res.json(order);
});

module.exports = router;
