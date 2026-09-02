const express = require("express");
const { store, refreshAndSave } = require("../db");
const { verifyIdToken } = require("../firebaseAdmin");
const { expiryDate, isActive } = require("../vip");
const { nowLocal } = require("../time");

const router = express.Router();

function serializeMembership(card) {
  if (!card) return null;
  return {
    card_number: card.card_number,
    discount_percent: card.discount_percent,
    issue_date: card.issue_date,
    expiry_date: expiryDate(card.issue_date),
    active: isActive(card),
  };
}

// Every route below is about "my own" membership, so it requires a real,
// currently-valid Firebase ID token (see the Google sign-in button in
// public/js/order.js's 회원 modal) — there's nothing to answer for an
// anonymous request. A missing/expired/tampered token and "Firebase isn't
// configured yet" both collapse to the same 401, matching
// firebaseAdmin.verifyIdToken()'s null-on-any-failure contract.
async function requireFirebaseUser(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const user = await verifyIdToken(token);
  if (!user) return res.status(401).json({ error: "not_authenticated" });
  req.firebaseUser = user;
  next();
}

router.get("/me", requireFirebaseUser, (req, res) => {
  const card = store.vipCards.find((c) => c.google_uid === req.firebaseUser.uid);
  res.json({ email: req.firebaseUser.email, name: req.firebaseUser.name, membership: serializeMembership(card) });
});

// Links the signed-in Google account to a physical VIP card by its printed
// card_number — the card must already exist (created from Admin >
// 회원(VIP), see src/routes/vipCards.js) and not already be claimed by
// someone else. One Google account can hold at most one card.
router.post("/register-card", requireFirebaseUser, async (req, res) => {
  const number = String((req.body || {}).cardNumber || "").trim();
  if (!number) return res.status(400).json({ error: "card_number_required" });

  // refreshAndSave (not save()) so both checks below run against the
  // latest data immediately before claiming it — narrows the window for
  // two requests racing to claim the same card, or the same account
  // double-submitting, into a "lost update" the way the tables/vipCards
  // create routes already guard against.
  let result = null;
  await refreshAndSave((s) => {
    if (s.vipCards.some((c) => c.google_uid === req.firebaseUser.uid)) {
      result = { error: "already_registered" };
      return;
    }
    const card = s.vipCards.find((c) => c.card_number === number);
    if (!card) {
      result = { error: "card_not_found" };
      return;
    }
    if (card.google_uid) {
      result = { error: "card_already_claimed" };
      return;
    }
    card.google_uid = req.firebaseUser.uid;
    card.customer_name = req.firebaseUser.name;
    card.customer_email = req.firebaseUser.email;
    card.registered_at = nowLocal();
    result = { card };
  });

  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ membership: serializeMembership(result.card) });
});

module.exports = router;
