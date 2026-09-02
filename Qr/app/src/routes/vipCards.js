const express = require("express");
const { store, refreshAndSave, patchArrayItem, nextId } = require("../db");
const { requireAdmin, requirePermission } = require("../auth");
const { expiryDate, isExpired, isActive } = require("../vip");
// Gated the same as other money-affecting configuration (payment settings,
// staff permissions) — a discount rate is a financial setting, not
// day-to-day order handling any staff member should be able to touch.
const canManageVip = requirePermission("settingsEdit");

const router = express.Router();

function serialize(card) {
  return {
    ...card,
    expiry_date: expiryDate(card.issue_date),
    expired: isExpired(card),
    active: isActive(card),
  };
}

router.get("/", requireAdmin, (req, res) => {
  res.json([...store.vipCards].sort((a, b) => b.id - a.id).map(serialize));
});

// Registers a physical card that's already been printed/handed out — this
// does NOT sign anyone up. It just makes the card_number claimable, so a
// customer who already holds that physical card can later link it to their
// Google account from public/js/order.js's 회원 modal (see
// src/routes/members.js's POST /register-card).
router.post("/", canManageVip, async (req, res) => {
  const { cardNumber, discountPercent, issueDate, note } = req.body || {};
  const number = String(cardNumber || "").trim();
  const discount = parseFloat(discountPercent);
  if (!number) return res.status(400).json({ error: "card_number_required" });
  if (!issueDate || Number.isNaN(new Date(`${issueDate}T00:00:00`).getTime())) {
    return res.status(400).json({ error: "invalid_issue_date" });
  }
  if (!(discount > 0 && discount <= 100)) return res.status(400).json({ error: "invalid_discount" });

  // refreshAndSave (not save()) so the duplicate-card-number check can't
  // race with a second admin tab adding the same physical card at nearly
  // the same moment — same reasoning as POST /api/tables.
  let card = null;
  let dupe = false;
  await refreshAndSave((s) => {
    if (s.vipCards.some((c) => c.card_number === number)) {
      dupe = true;
      return;
    }
    card = {
      id: nextId("vip_cards"),
      card_number: number,
      discount_percent: discount,
      issue_date: issueDate,
      note: (note || "").toString().slice(0, 200) || null,
      // Filled in only by a customer's own POST /register-card — never set
      // directly by admin, so "who claimed this card" always reflects a
      // real Google sign-in, not something typed into this form.
      google_uid: null,
      customer_name: null,
      customer_email: null,
      registered_at: null,
      created_at: new Date().toISOString(),
    };
    s.vipCards.push(card);
  });
  if (dupe) return res.status(400).json({ error: "card_exists" });
  res.status(201).json(serialize(card));
});

// Edits a card's discount rate, issue date, or admin note. Deliberately
// cannot touch google_uid/customer_name/customer_email/registered_at here —
// see /:id/unlink below for the one supported way to clear a claim.
router.patch("/:id", canManageVip, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const card = store.vipCards.find((c) => c.id === id);
  if (!card) return res.status(404).json({ error: "not_found" });
  const { discountPercent, issueDate, note } = req.body || {};
  const updates = {};
  if (discountPercent != null) {
    const discount = parseFloat(discountPercent);
    if (!(discount > 0 && discount <= 100)) return res.status(400).json({ error: "invalid_discount" });
    updates.discount_percent = discount;
  }
  if (issueDate != null) {
    if (Number.isNaN(new Date(`${issueDate}T00:00:00`).getTime())) return res.status(400).json({ error: "invalid_issue_date" });
    updates.issue_date = issueDate;
  }
  if (note != null) {
    updates.note = String(note).slice(0, 200) || null;
  }
  if (Object.keys(updates).length) await patchArrayItem("vipCards", id, updates);
  res.json(serialize(card));
});

// Clears a claim (lost phone, wrong person registered it, customer asked to
// re-link to a different Google account, etc.) without deleting the
// physical card record itself — it goes back to "issued, not yet claimed"
// and can be registered again.
router.post("/:id/unlink", canManageVip, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const card = store.vipCards.find((c) => c.id === id);
  if (!card) return res.status(404).json({ error: "not_found" });
  const updates = { google_uid: null, customer_name: null, customer_email: null, registered_at: null };
  await patchArrayItem("vipCards", id, updates);
  res.json(serialize(card));
});

// Only lets an unclaimed card be deleted outright — once a real customer
// has linked their account to it, removing the row would silently take
// away a membership someone is actively relying on; use /unlink first if
// that's really the intent (e.g. re-issuing a lost card under a fresh
// number), then delete the now-unclaimed row if it's no longer needed.
router.delete("/:id", canManageVip, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const card = store.vipCards.find((c) => c.id === id);
  if (!card) return res.status(404).json({ error: "not_found" });
  if (card.google_uid) return res.status(400).json({ error: "cannot_delete_claimed_card" });
  await refreshAndSave((s) => {
    s.vipCards = s.vipCards.filter((c) => c.id !== id);
  });
  res.json({ ok: true });
});

module.exports = router;
