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

// ── 카드 판매 ────────────────────────────────────────────────────────────
//
// 2026-09-10 사장님: "vip카드 구매도 현금으로만 구매가능. 버튼필요 —
// VIP卡販售 / 300원. 직원이 결제할 때 손님이 vip 사고 싶다면 살 수 있게."
//
// 값을 설정에서 바꿀 수 있게 하되(사장님이 고른 쪽), 읽는 규칙은 여기
// 한 곳에만 둔다. 판매 라우트와 관리자 화면과 테스트가 각자 기본값을
// 들고 있으면, 사장님이 값을 올린 날 어느 한 곳만 300 으로 남는다.
//
// 저장 형태: store.settings.vip_card_sale = { price, discount_percent }
const DEFAULT_CARD_PRICE = 300;
const DEFAULT_CARD_DISCOUNT = 10; // VIP9折
const MAX_CARD_PRICE = 100000;

// 설정이 비었거나 깨져 있어도 절대 던지지 않는다. 여기서 던지면 결제창이
// 안 열린다 — 카드 한 장 못 파는 것보다 훨씬 큰 손해다.
function cardSalePrice(settings) {
  const raw = ((settings || {}).vip_card_sale || {}).price;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_CARD_PRICE;
  return Math.min(n, MAX_CARD_PRICE);
}

// 판매하면서 카드번호까지 같이 등록할 때 붙는 할인율. 사장님이 카드마다
// 다르게 주고 싶으면 VIP 탭에서 그 카드만 고치면 된다.
function cardSaleDiscountPercent(settings) {
  const raw = ((settings || {}).vip_card_sale || {}).discount_percent;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 100) return DEFAULT_CARD_DISCOUNT;
  return Math.round(n * 10) / 10;
}

// 저장할 때 한 번 더 자른다 — 읽는 쪽이 매번 고쳐 읽는 것에 기대지 않게.
function normalizeCardSale(body) {
  return {
    price: cardSalePrice({ vip_card_sale: { price: (body || {}).price } }),
    discount_percent: cardSaleDiscountPercent({ vip_card_sale: { discount_percent: (body || {}).discount_percent } }),
  };
}

// 이 품목이 「카드 한 장」인가. 결산과 화면이 밥값과 갈라 보는 표시이고,
// 할인 계산에서 빼는 기준이기도 하다 — 카드값을 9折 해줄 이유는 없다.
const CARD_SALE_CATEGORY = "vip_card";

function isCardSaleItem(it) {
  return !!(it && it.category_key === CARD_SALE_CATEGORY);
}

module.exports = {
  expiryDate,
  isExpired,
  isActive,
  isClaimed,
  cardBelongsTo,
  cardSalePrice,
  cardSaleDiscountPercent,
  normalizeCardSale,
  isCardSaleItem,
  CARD_SALE_CATEGORY,
  DEFAULT_CARD_PRICE,
  DEFAULT_CARD_DISCOUNT,
};
