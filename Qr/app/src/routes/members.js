// 손님 본인의 VIP 회원 상태 — 카드 조회와 등록.
//
// 2026-09-08 통합 계정이 생기기 전에는 이 라우터가 Firebase ID 토큰만
// 받았다. 이제는 홈페이지 로그인 세션으로도 들어올 수 있고, 두 경로 모두
// src/customer.js 의 resolveCustomer() 한 곳을 거친다. 예전 방식(주문
// 화면의 구글 로그인)을 그대로 살려둔 이유는 그 화면이 아직 그 방식으로
// 동작하고 있어서다 — 끊으면 이미 카드를 쓰고 계신 손님들의 할인이 그날로
// 멈춘다.
const express = require("express");
const { store, refreshAndSave } = require("../db");
const { resolveCustomer } = require("../customer");
const { expiryDate, isActive, cardBelongsTo } = require("../vip");
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

// 로그인(세션 또는 구글 토큰) 없이는 답할 것이 없는 요청들. 토큰이
// 만료/위조됐거나 Firebase 설정 전이거나 그냥 로그인을 안 했거나 — 전부
// 같은 401 로 묶는다(firebaseAdmin.verifyIdToken 의 null-on-any-failure
// 계약과 같은 취급).
async function requireCustomer(req, res, next) {
  const customer = await resolveCustomer(req);
  if (!customer) return res.status(401).json({ error: "not_authenticated" });
  req.customer = customer;
  next();
}

router.get("/me", requireCustomer, (req, res) => {
  const card = store.vipCards.find((c) => cardBelongsTo(c, req.customer));
  res.json({
    email: req.customer.email,
    name: req.customer.name,
    membership: serializeMembership(card),
  });
});

// 실물 카드에 인쇄된 번호로 내 계정과 카드를 연결한다. 카드는 이미
// 존재해야 하고(Admin > 회원(VIP) 에서 사장님이 등록), 다른 사람이 이미
// 가져간 카드는 안 된다. 한 계정에 카드 하나.
router.post("/register-card", requireCustomer, async (req, res) => {
  const number = String((req.body || {}).cardNumber || "").trim();
  if (!number) return res.status(400).json({ error: "card_number_required" });

  // refreshAndSave (not save()) so both checks below run against the
  // latest data immediately before claiming it — narrows the window for
  // two requests racing to claim the same card, or the same account
  // double-submitting, into a "lost update" the way the tables/vipCards
  // create routes already guard against.
  let result = null;
  await refreshAndSave((s) => {
    if (s.vipCards.some((c) => cardBelongsTo(c, req.customer))) {
      result = { error: "already_registered" };
      return;
    }
    const card = s.vipCards.find((c) => c.card_number === number);
    if (!card) {
      result = { error: "card_not_found" };
      return;
    }
    if (card.google_uid || card.account_id) {
      result = { error: "card_already_claimed" };
      return;
    }
    // 계정으로 들어왔으면 account_id 를, 구글이 연결돼 있으면 google_uid 도
    // 같이 남긴다 — 나중에 손님이 주문 화면의 구글 로그인으로 접근해도
    // 같은 카드를 알아볼 수 있게.
    card.account_id = req.customer.accountId || null;
    card.google_uid = req.customer.googleUid || null;
    card.customer_name = req.customer.name;
    card.customer_email = req.customer.email;
    card.registered_at = nowLocal();
    result = { card };
  });

  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ membership: serializeMembership(result.card) });
});

module.exports = router;
