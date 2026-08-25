const express = require("express");
const { store, save, nextId } = require("../db");
const { requireAdmin, requirePermission } = require("../auth");
const canManageReservations = requirePermission("reservationManage");

const router = express.Router();

// Admin-side reservation log (phone/walk-in bookings the owner or staff
// jot down manually) — not a customer self-service booking flow. Viewing
// is available to any logged-in staff (like the table list); adding,
// editing, or cancelling a reservation is gated behind the owner's
// "예약 추가/수정/삭제" toggle, same pattern as tableEdit/menuEdit.
router.get("/", requireAdmin, (req, res) => {
  let list = [...store.reservations];
  if (req.query.date) list = list.filter((r) => r.date === req.query.date);
  list.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  res.json(list);
});

router.post("/", canManageReservations, async (req, res) => {
  const b = req.body || {};
  if (!b.customer_name || !b.date || !b.time || !b.party_size) {
    return res.status(400).json({ error: "missing_fields" });
  }
  const reservation = {
    id: nextId("reservations"),
    customer_name: String(b.customer_name).slice(0, 60),
    phone: String(b.phone || "").slice(0, 30),
    party_size: Math.max(1, Math.min(50, parseInt(b.party_size, 10) || 1)),
    date: String(b.date), // "YYYY-MM-DD"
    time: String(b.time), // "HH:MM"
    table_number: b.table_number ? String(b.table_number) : null,
    note: String(b.note || "").slice(0, 300),
    status: "confirmed", // "confirmed" | "cancelled"
    created_at: new Date().toISOString(),
  };
  store.reservations.push(reservation);
  await save();
  res.status(201).json(reservation);
});

router.patch("/:id", canManageReservations, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const reservation = store.reservations.find((r) => r.id === id);
  if (!reservation) return res.status(404).json({ error: "not_found" });
  const b = req.body || {};
  if (b.customer_name != null) reservation.customer_name = String(b.customer_name).slice(0, 60);
  if (b.phone != null) reservation.phone = String(b.phone).slice(0, 30);
  if (b.party_size != null) reservation.party_size = Math.max(1, Math.min(50, parseInt(b.party_size, 10) || 1));
  if (b.date != null) reservation.date = String(b.date);
  if (b.time != null) reservation.time = String(b.time);
  if (b.table_number !== undefined) reservation.table_number = b.table_number ? String(b.table_number) : null;
  if (b.note != null) reservation.note = String(b.note).slice(0, 300);
  if (b.status != null && ["confirmed", "cancelled"].includes(b.status)) reservation.status = b.status;
  await save();
  res.json(reservation);
});

router.delete("/:id", canManageReservations, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  store.reservations = store.reservations.filter((r) => r.id !== id);
  await save();
  res.json({ ok: true });
});

module.exports = router;
