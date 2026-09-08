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
//
// "누가 등록했는가"를 나타내는 필드가 둘이다. google_uid 는 처음 만들 때
// 쓰던 것(구글 로그인 전용)이고, account_id 는 2026-09-08 통합 계정이
// 생기면서 추가된 것이다. 이메일로만 가입한 손님은 google_uid 가 없으므로
// account_id 도 "등록됨"으로 인정해야 한다 — 안 그러면 이메일 가입자가
// 카드를 등록해도 할인이 영원히 안 걸린다.
function isClaimed(card) {
  return !!(card && (card.google_uid || card.account_id));
}

function isActive(card) {
  return !!(card && isClaimed(card) && !isExpired(card));
}

// 이 카드가 이 손님의 것인가. 통합 계정으로 등록했으면 account_id 로,
// 예전에 구글 로그인만으로 등록했으면 google_uid 로 알아본다 — 같은 사람이
// 나중에 계정을 만들어 구글을 연결해도 예전에 등록한 카드를 그대로 쓸 수
// 있어야 하므로 둘 다 본다(src/customer.js resolveCustomer 참고).
function cardBelongsTo(card, customer) {
  if (!card || !customer) return false;
  if (customer.accountId && card.account_id && String(card.account_id) === String(customer.accountId)) return true;
  if (customer.googleUid && card.google_uid && card.google_uid === customer.googleUid) return true;
  return false;
}

module.exports = { expiryDate, isExpired, isActive, isClaimed, cardBelongsTo };
