// Shared VIP-membership-card rules — the one place "is this card currently
// valid" gets decided, so src/routes/vipCards.js (admin CRUD),
// src/routes/members.js (customer registration/status) and
// src/routes/orders.js (actually applying the discount) can never disagree
// with each other about it. Given this is a discount people have a real
// financial incentive to fake or stretch, keeping the rule in exactly one
// place matters more than usual.
const { taipeiDateString } = require("./time");

// Cards are valid for exactly 1 year from the date printed on the physical
// card (issue_date, "YYYY-MM-DD") — not from whenever a customer happens to
// register it online (per the owner's existing physical-card program).
function expiryDate(issueDate) {
  if (!issueDate) return null;
  const d = new Date(`${issueDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setFullYear(d.getFullYear() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isExpired(card) {
  const exp = expiryDate(card.issue_date);
  if (!exp) return true; // no/invalid issue_date can never be "active"
  return taipeiDateString() > exp;
}

// A card only ever grants a discount once BOTH a physical card exists with
// a valid issue_date AND a customer has actually claimed it online (see
// POST /api/members/register-card) — an unclaimed card sitting in the
// admin's list isn't, by itself, anyone's discount to use.
function isActive(card) {
  return !!(card && card.google_uid && !isExpired(card));
}

module.exports = { expiryDate, isExpired, isActive };
