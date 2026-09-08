const express = require("express");
const { store, refreshAndSave, patchArrayItem, nextId } = require("../db");
const { requireAdmin, requirePermission, requireOwner } = require("../auth");
const { expiryDate, isExpired, isActive, isClaimed } = require("../vip");
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

// 카드 등록 해제 — 사장 전용.
//
// 손님에게는 "한 번 등록한 카드는 다른 계정으로 옮길 수 없습니다"라고
// 안내한다(주문 화면·홈페이지의 회원 등록 화면). 그래야 카드를 돌려쓰거나
// 남의 카드를 가로채는 시도가 애초에 줄어든다. 다만 현실에서는 폰을
// 잃어버렸다거나, 가족이 대신 등록해버렸다거나, 엉뚱한 계정으로 눌렀다거나
// 하는 일이 생기므로 사장님이 직접 풀어줄 수 있는 길은 남겨둔다
// (사장님: "우리는 뭐 바꿀 수 있도록 해주자 혹시 모르니까. 근데 그건 사장 권한만").
//
// requireOwner 인 이유: 이건 사실상 "이 손님의 할인 권리를 회수해서 다른
// 사람에게 넘길 수 있다"는 뜻이라, 직원 권한 토글(settingsEdit)로 열어둘
// 성질이 아니다.
router.post("/:id/unlink", requireOwner, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const card = store.vipCards.find((c) => c.id === id);
  if (!card) return res.status(404).json({ error: "not_found" });
  // account_id 를 같이 비우지 않으면 통합 계정으로 등록한 카드는 "등록해제"를
  // 눌러도 그 계정에 그대로 붙어 있게 된다(vip.js cardBelongsTo 가 두 필드를
  // 모두 보기 때문). google_uid 만 지우던 예전 코드 그대로 뒀다면 조용히
  // 동작하지 않는 버튼이 됐을 것이다.
  const updates = {
    google_uid: null,
    account_id: null,
    customer_name: null,
    customer_email: null,
    registered_at: null,
  };
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
  // isClaimed() 로 봐야 한다 — 통합 계정으로 등록한 카드는 google_uid 가
  // 비어 있어서, 예전처럼 그 필드만 보면 손님이 쓰고 있는 카드가 그대로
  // 삭제돼 할인이 조용히 사라진다.
  if (isClaimed(card)) return res.status(400).json({ error: "cannot_delete_claimed_card" });
  await refreshAndSave((s) => {
    s.vipCards = s.vipCards.filter((c) => c.id !== id);
  });
  res.json({ ok: true });
});

module.exports = router;
