const express = require("express");
const { store, save, nextId } = require("../db");
const { requireAdmin } = require("../auth");
const { nowLocal, taipeiDateString } = require("../time");
const { verifyIdToken } = require("../firebaseAdmin");
const { isActive: isVipActive } = require("../vip");
const { parseAddons } = require("../addons");

// Re-prices whatever addon names the client sent against the menu item's own
// `addons` definition (see src/addons.js) — never trusts a price the client
// might send, same principle as every other field validated in this file.
// Unknown/removed addon names are silently dropped rather than erroring, so
// an item edited after being added to someone's order doesn't 400 them.
function resolveSelectedAddons(mi, requestedNames) {
  if (!Array.isArray(requestedNames) || requestedNames.length === 0) return [];
  const available = parseAddons(mi.addons);
  const chosen = [];
  for (const name of requestedNames) {
    const match = available.find((a) => a.name === name);
    if (match && !chosen.some((c) => c.name === match.name)) chosen.push(match);
  }
  return chosen;
}

const router = express.Router();

// 사장님 요청(2026-09-06): "vip 카드를 소지중이면 세일을 해주거든. 1. 特約
// 95折 2. VIP 9折... 이 할인은 음료와 주류는 빼고 적용돼. 또 현금만 돼." —
// 결제 시점에 직원이 손님이 보여준 물리적 카드를 보고 눌러주는 할인이다.
// 주문 시 자동 적용되는 위쪽 Firebase 회원 시스템의 vip_discount_percent와는
// 완전히 별개(다른 대상 — 앱으로 미리 가입한 회원 vs 현장에서 카드를 보여준
// 손님, 다른 트리거 — 주문 생성 시 vs 결제 시)다. order.total(품목 전체
// 합, PATCH /:id/items 주석대로 절대 바뀌지 않는 고정값)은 그대로 두고,
// 실제로 받는 금액만 이 할인만큼 줄인다 — 아래 PATCH /:id, PATCH
// /:id/split-pay 참고.
const VIP_DISCOUNT_RATES = { te95: 0.95, vip9: 0.9 };
const PAYMENT_METHODS = ["cash", "linepay", "card"];

// 품목 하나의 카테고리 key — POST /, PATCH /:id/items에서 채워두는
// category_key 스냅샷을 우선 쓴다(메뉴가 나중에 바뀌거나 삭제돼도 이미
// 확정된 주문의 계산이 흔들리지 않도록, 다른 스냅샷 필드(name_zh 등)와 같은
// 원칙). 이 필드가 생기기 전에 이미 저장돼 있던 주문(배포 시점에 진행 중이던
// 주문)은 스냅샷이 없으므로 현재 메뉴 기준으로 한 번 더 찾아본다 — 완벽하진
// 않지만("전부 무조건 할인 대상"으로 잘못 처리하는 것보다는 낫다).
function categoryKeyOf(it) {
  if (it.category_key !== undefined) return it.category_key;
  const mi = store.menuItems.find((m) => m.id === it.item_id);
  if (!mi) return null;
  const cat = store.categories.find((c) => c.id === mi.category_id);
  return cat ? cat.key : null;
}

// 음료·주류(카테고리 key "drink" — src/seed.js 참고, 이 매장은 주류를 따로
// 분리하지 않고 drink 안에 함께 둔다) 품목은 할인 대상에서 제외하고 나머지
// 품목의 금액만 더한다. indexes를 주면 그 인덱스들만(부분 결제로 이번에
// 실제 결제되는 품목만), 생략하면 order.items 전체를 대상으로 한다.
function discountEligibleTotal(items, indexes) {
  const idxs = indexes || items.map((_, i) => i);
  return idxs.reduce((s, i) => {
    const it = items[i];
    if (!it || categoryKeyOf(it) === "drink") return s;
    const addonsTotal = (it.selected_addons || []).reduce((a, x) => a + x.price, 0);
    return s + (it.unit_price + addonsTotal) * it.qty;
  }, 0);
}

function computeVipDiscount(vipDiscountType, eligibleTotal) {
  const rate = VIP_DISCOUNT_RATES[vipDiscountType];
  if (!rate) return 0;
  return eligibleTotal - Math.round(eligibleTotal * rate);
}

// paymentMethod/vipDiscountType 둘 다 body에서 그대로 신뢰하지 않고 여기서
// 검증한다 — 특히 "할인은 현금만"이라는 규칙은 클라이언트가 버튼을
// disabled 처리해주는 것과는 별개로 서버가 실제로 막아야 하는 지점이다.
// 유효하지 않은 값은 조용히 무시(null)한다 — 결제 자체(품목 완료 처리)는
// 이 둘과 무관하게 항상 진행돼야 하므로, 잘못된 결제 방식/할인 값 때문에
// 결제 자체가 막히면 안 된다. 단, "할인은 현금만"은 유일하게 진짜 에러로
// 취급한다(호출부에서 400을 돌려줌).
function resolvePaymentFields(body) {
  const paymentMethod = PAYMENT_METHODS.includes(body.paymentMethod) ? body.paymentMethod : null;
  const vipDiscountType = Object.keys(VIP_DISCOUNT_RATES).includes(body.vipDiscountType) ? body.vipDiscountType : null;
  const discountRequiresCash = !!vipDiscountType && paymentMethod !== "cash";
  return { paymentMethod, vipDiscountType, discountRequiresCash };
}

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
  // The 포장 카운터 (is_counter, see src/routes/tables.js) is the one
  // exception: there's no headcount to ask a takeout customer for, and
  // public/js/order.js's initPartySize() already skips that modal for it.
  const orderingTable = store.tables.find((t) => t.number === String(tableNumber));
  if (!orderingTable || (!orderingTable.is_counter && !orderingTable.party_size)) {
    return res.status(400).json({ error: "party_size_required" });
  }

  // 포장 카운터 orders have no table to identify them by, so a pickup name
  // is required instead — this is what staff call out, alongside the
  // auto-assigned pickup_number computed below. Enforced here too, not just
  // in the customer page's counter-name modal (public/js/order.js), same as
  // every other check on this route.
  // Phone number requested alongside the name (2026-09 피드백) so staff can
  // reach a takeout customer about their order — same required-for-counter,
  // trusted-only-from-here pattern as customerName above.
  let customerName = null;
  let customerPhone = null;
  if (orderingTable.is_counter) {
    customerName = String((req.body || {}).customerName || "").trim().slice(0, 20);
    if (!customerName) return res.status(400).json({ error: "customer_name_required" });
    customerPhone = String((req.body || {}).customerPhone || "").trim().slice(0, 20);
    if (!customerPhone) return res.status(400).json({ error: "customer_phone_required" });
  }

  const locationError = checkLocation(lat, lng);
  if (locationError) return res.status(403).json({ error: locationError });

  // VIP membership discount — a customer signed in with Google (see the
  // 회원 modal in public/js/order.js) who has an active linked card gets
  // their card's own discount_percent applied automatically, computed here
  // rather than trusted from the client (which has every incentive to just
  // claim a discount). An expired/unclaimed card or no token at all is
  // identical to "not a member" — never an error, since ordering without
  // being a member is the normal case for most customers.
  let vipCard = null;
  const authHeader = req.headers.authorization || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (idToken) {
    const firebaseUser = await verifyIdToken(idToken);
    if (firebaseUser) {
      const candidate = store.vipCards.find((c) => c.google_uid === firebaseUser.uid);
      if (candidate && isVipActive(candidate)) vipCard = candidate;
    }
  }

  const validated = [];
  let total = 0;
  for (const it of items) {
    const mi = store.menuItems.find((m) => m.id === parseInt(it.itemId, 10) && m.available);
    if (!mi) continue;
    const qty = Math.max(1, Math.min(20, parseInt(it.qty, 10) || 1));
    const selectedAddons = resolveSelectedAddons(mi, it.addons);
    const addonsPricePerUnit = selectedAddons.reduce((s, a) => s + a.price, 0);
    total += (mi.price + addonsPricePerUnit) * qty;
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
      // Selected multi-select extras (사리면 추가, 밥→당면 교체, etc. — see
      // src/addons.js) — a list of { name, price } re-priced from the menu
      // item's own definition above, never trusted from the client.
      selected_addons: selectedAddons,
      // 매장(dine-in) vs 포장(takeout) — chosen per dish in the item sheet
      // (see .order-type-tabs in order.html/order.js), not once for the
      // whole order, so a single order can mix both. Anything else
      // (missing, tampered, unrecognized) safely falls back to dine-in.
      order_type: it.orderType === "takeout" ? "takeout" : "dine_in",
      // 이 품목이 주문될 당시 속해 있던 카테고리 key(예: "drink") 스냅샷 —
      // 다른 스냅샷 필드(name_zh, unit_price 등)와 같은 이유로, 나중에 메뉴
      // 카테고리가 바뀌거나 품목이 삭제돼도 흔들리지 않게 한다. VIP 카드
      // 할인(特約95折/VIP9折, 위 discountEligibleTotal)이 음료·주류를 뺄 때
      // 이 값을 쓴다.
      category_key: (store.categories.find((c) => c.id === mi.category_id) || {}).key || null,
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

  // 포장 카운터 orders get a short daily pickup number (resets to 1 each
  // business day, Taipei time) instead of a table number — shown alongside
  // customerName in the kitchen queue/ticket so staff have something short
  // to call out ("3번 홍길동님") without reading a full name off every card.
  const pickupNumber = orderingTable.is_counter
    ? store.orders.filter((o) => o.table_number === orderingTable.number && o.created_at.slice(0, 10) === taipeiDateString()).length + 1
    : null;

  // `total` above (from the items loop) is the pre-discount sum — kept as
  // `subtotal` so the kitchen ticket/admin views can show "소계 → VIP 할인 →
  // 합계" instead of a single number that silently doesn't match what the
  // line items add up to. `total` becomes the actual payable amount.
  const subtotal = total;
  const finalTotal = vipCard ? Math.round((subtotal * (100 - vipCard.discount_percent)) / 100) : subtotal;

  const order = {
    id: nextId("orders"),
    table_number: String(tableNumber),
    status: "new",
    order_type: orderTypeSummary,
    subtotal,
    total: finalTotal,
    vip_card_number: vipCard ? vipCard.card_number : null,
    vip_discount_percent: vipCard ? vipCard.discount_percent : null,
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
    // Only set for 포장 카운터 orders (null for every real table) — see the
    // customerName/pickupNumber derivation above.
    customer_name: customerName,
    customer_phone: customerPhone,
    pickup_number: pickupNumber,
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

  // 사장님 요청(2026-09-06): 이 라우트로 결제 완료(status: "paid")를 찍을 때
  // 결제 방식/VIP 카드 할인도 같이 받는다 — 포장 카운터 라운드의 "결제
  // 완료로 변경" 버튼(public/js/admin.js의 data-advance-id)이 여기로 온다.
  // 다른 상태 전환(조리 시작/서빙 완료 등)은 이 두 값을 아예 안 보내므로
  // 전혀 영향이 없다. discountRequiresCash는 클라이언트가 이미 LinePay/
  // 신용카드 버튼을 잠가주지만, 그건 UI일 뿐이라 여기서 다시 막는다.
  if (status === "paid") {
    const { paymentMethod, vipDiscountType, discountRequiresCash } = resolvePaymentFields(req.body || {});
    if (discountRequiresCash) return res.status(400).json({ error: "discount_requires_cash" });
    if (paymentMethod) order.payment_method = paymentMethod;
    if (vipDiscountType) {
      const eligible = discountEligibleTotal(order.items);
      const discountAmount = computeVipDiscount(vipDiscountType, eligible);
      order.discount_type = vipDiscountType;
      order.discount_amount = (order.discount_amount || 0) + discountAmount;
    }
  }

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
    const selectedAddons = resolveSelectedAddons(mi, it.addons);
    const addonsPricePerUnit = selectedAddons.reduce((s, a) => s + a.price, 0);
    total += (mi.price + addonsPricePerUnit) * qty;
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
      selected_addons: selectedAddons,
      order_type: it.orderType === "takeout" ? "takeout" : "dine_in",
      // POST /의 같은 필드와 동일 — 위 discountEligibleTotal 참고.
      category_key: (store.categories.find((c) => c.id === mi.category_id) || {}).key || null,
      note: (it.note || "").slice(0, 200),
    });
  }
  if (validated.length === 0) return res.status(400).json({ error: "no_valid_items" });

  const takeoutCount = validated.filter((v) => v.order_type === "takeout").length;
  order.order_type = takeoutCount === 0 ? "dine_in" : takeoutCount === validated.length ? "takeout" : "mixed";
  order.items = validated;
  // Re-apply whatever VIP discount this order was originally placed with
  // (order.vip_discount_percent, set once at POST / time and never changed
  // here) so editing the item list — adding/removing a dish — doesn't
  // silently drop or re-grant a member's discount depending on who happens
  // to be signed in on the admin's browser while editing.
  order.subtotal = total;
  order.total = order.vip_discount_percent ? Math.round((total * (100 - order.vip_discount_percent)) / 100) : total;
  order.updated_at = nowLocal();

  await save();
  res.json(order);
});

// Admin: 부분 결제 — 사장님 피드백(2026-09-05): "外帶 에 있는 거 제외하고
// 다른 테이블 전체들은 부분 결제를 허용해줘. 체크체크 해서 그것만
// 결제완료 할 수 있게. 나눠서 계산할 수도 있고" → 곧이어 "선택이 주문별이
// 아니라 메뉴별이야" — 한 주문(라운드) 안에서도 일부 메뉴 품목만 체크해서
// 그것만 결제 완료 처리할 수 있어야 한다. 결제 상태(status)는 주문
// 단위로만 존재하므로, 체크된 품목이 이 주문의 전부가 아니라면 그
// 품목들만 떼어 새 주문(바로 결제완료 상태)으로 만들고, 남은 품목은 이
// 주문에 그대로 남겨 계속 미결제로 둔다. 체크된 품목이 전부라면 그냥 이
// 주문 전체를 결제완료로 바꾸면 되므로 나눌 필요가 없다 — 클라이언트가
// 매번 구분하지 않고 이 엔드포인트 하나만 부르면 되도록 여기서 판단한다.
// 카운터(포장) 주문은 애초에 클라이언트가 체크박스를 보여주지 않지만,
// 혹시 모를 직접 호출에 대비해 여기서 막지는 않는다 — status 가드만
// 동일하게 적용한다.
router.patch("/:id/split-pay", requireAdmin, async (req, res) => {
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

  const { itemIndexes } = req.body || {};
  if (!Array.isArray(itemIndexes) || itemIndexes.length === 0) {
    return res.status(400).json({ error: "invalid_selection" });
  }
  // 사장님 요청(2026-09-06): 진짜 테이블의 결제는 항상 이 라우트(footer의
  // "선택/전체 결제 완료")로 이뤄지므로 特約95折/VIP9折 할인·결제 방식도
  // 여기서 받는다. 이번에 실제로 결제되는 품목(selectedIdx, 아래에서 확정)
  // 중 음료·주류를 뺀 금액에만 할인율을 적용한다 — PATCH /:id와 동일 규칙.
  const { paymentMethod, vipDiscountType, discountRequiresCash } = resolvePaymentFields(req.body || {});
  if (discountRequiresCash) return res.status(400).json({ error: "discount_requires_cash" });
  // 사장님 피드백(2026-09-05): "결제 완료했다고 사라지진 않았으면 좋겠어"
  // (체크한 품목 기준) — 처음엔 체크한 품목을 새 주문으로 떼어내는 방식으로
  // 만들었는데, 그러면 원래 주문(라운드) 목록에서 그 품목이 통째로
  // 사라져버린다. 대신 품목을 옮기지 않고 원래 주문 안에 그대로 둔 채
  // item.paid만 표시한다 — 화면에는 "결제완료" 표시로 계속 보이고, 체크는
  // 다시 못 하게 된다. 단, 이 방식은 그 주문(라운드)이 전부 결제완료로
  // 바뀌기 전까지는 주문 상태가 계속 active로 남아있어서, 정산/매출
  // 집계(status === "paid" 기준, settlement.js)에는 그 라운드가 통째로
  // 끝나야 잡힌다 — 사장님도 이 트레이드오프를 알고 "간단한 쪽"을 선택함.
  const selectedIdx = [...new Set(itemIndexes.map((i) => parseInt(i, 10)))].filter(
    (i) => Number.isInteger(i) && i >= 0 && i < order.items.length && !order.items[i].paid
  );
  if (selectedIdx.length === 0) return res.status(400).json({ error: "invalid_selection" });

  const paidAt = nowLocal();
  selectedIdx.forEach((i) => {
    order.items[i].paid = true;
    order.items[i].paid_at = paidAt;
  });
  if (paymentMethod) order.payment_method = paymentMethod;
  if (vipDiscountType) {
    const eligible = discountEligibleTotal(order.items, selectedIdx);
    const discountAmount = computeVipDiscount(vipDiscountType, eligible);
    order.discount_type = vipDiscountType;
    order.discount_amount = (order.discount_amount || 0) + discountAmount;
  }
  order.updated_at = paidAt;

  // 이번에 남김없이 전부 결제완료로 표시됐으면(이전에 이미 일부가
  // paid였던 경우 포함) 이 주문 전체를 paid로 넘긴다 — PATCH /:id와 같은
  // party_size 정리 규칙도 그대로 적용한다.
  const allPaid = order.items.every((it) => it.paid);
  if (allPaid) {
    order.status = "paid";
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
  }

  await save();
  res.json({ updatedOrder: order });
});

module.exports = router;
