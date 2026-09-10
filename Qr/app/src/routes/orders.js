const express = require("express");
const { store, save, nextId, saveOrder, saveOrders, findOrders } = require("../db");
const { requireAdmin, requireOwner } = require("../auth");
const { isOpenNow, orderingState } = require("../openHours");
const { nowLocal, taipeiDateString } = require("../time");
const { resolveCustomer } = require("../customer");
const { isActive: isVipActive, cardBelongsTo } = require("../vip");
const { parseAddons } = require("../addons");
const { broadcastOrdersChanged } = require("../realtime");

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

const { clearPartySizeIfSettled, movePartySize, seatingStartOf } = require("../partySize");
const { isAvailableNow } = require("../availability");
const { serviceStartedAt } = require("../serviceStart");

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
// 실제 계산은 src/discounts.js — 돈이 걸린 산수라 라우트 밖으로 빼서
// test/discounts.test.js 가 직접 검증한다.
const {
  VIP_DISCOUNT_RATES,
  computeDiscountAmount: computeDiscountAmountPure,
  parseManualDiscount,
  discountTypeKey,
} = require("../discounts");
// 사장님 요청(2026-09-07): "결제종류 현금, 라인페이, 신용카드, 기타" — "기타"
// 하나 추가. 이 목록은 결제 방식 팝업(직원이 직접 고르는 값)에서 허용되는
// 값만 담는다 — "online"(손님이 직접 결제하는 온라인 결제, src/routes/
// payments.js)은 서버가 직접 붙이는 값이라 여기 포함하지 않는다(직원이
// 고를 수 있는 선택지가 아니므로).
const PAYMENT_METHODS = ["cash", "linepay", "card", "other"];

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

// 特約95折/VIP9折이 빼는 "음료·주류"의 판정 — 카테고리 key "drink"
// (src/seed.js 참고, 이 매장은 주류를 따로 분리하지 않고 drink 안에 함께
// 둔다). 실제 합산은 src/discounts.js가 이 함수를 받아서 한다.
const isDrinkItem = (it) => categoryKeyOf(it) === "drink";

// paymentMethod/vipDiscountType 둘 다 body에서 그대로 신뢰하지 않고 여기서
// 검증한다 — 특히 "할인은 현금만"이라는 규칙은 클라이언트가 버튼을
// disabled 처리해주는 것과는 별개로 서버가 실제로 막아야 하는 지점이다.
// 유효하지 않은 값은 조용히 무시(null)한다 — 결제 자체(품목 완료 처리)는
// 이 둘과 무관하게 항상 진행돼야 하므로, 잘못된 결제 방식/할인 값 때문에
// 결제 자체가 막히면 안 된다. 단, "할인은 현금만"은 유일하게 진짜 에러로
// 취급한다(호출부에서 400을 돌려줌).
//
// 재량 할인(manualDiscountMode/manualDiscountValue)은 特約95折/VIP9折처럼
// 정해진 비율표가 없어서 클라이언트 입력을 받을 수밖에 없지만, 범위는
// 여기서 반드시 검증한다(퍼센트는 0~100, 금액은 양수만 — 실제로 청구액을
// 넘는지는 아래 computeDiscountAmount가 다시 한번 clamp한다).
function resolvePaymentFields(body) {
  const paymentMethod = PAYMENT_METHODS.includes(body.paymentMethod) ? body.paymentMethod : null;
  const rawType = body.vipDiscountType;
  // 特約95折/VIP9折만 여기 들어온다. 예전에는 "직접 입력"도 이 자리에
  // "manual"이라는 값으로 들어와서(둘 중 하나만 고를 수 있었으니까) 두
  // 할인이 같은 칸을 두고 다퉜다 — 사장님 요청(2026-09-10)으로 둘을 같이
  // 걸 수 있게 되면서 칸을 나눴다. 옛 클라이언트가 아직 "manual"을 보내도
  // 아래 manualDiscount 파싱이 그대로 살아 있어 결과는 같다.
  const vipDiscountType = Object.keys(VIP_DISCOUNT_RATES).includes(rawType) ? rawType : null;
  // 재량 할인은 이제 vipDiscountType과 무관하게 따로 온다 — 特約95折과
  // 함께 와도 되고, 혼자 와도 된다.
  const manualDiscount = parseManualDiscount(body);
  // 재량 할인은 결제수단 제한이 없다 — "할인은 현금만"은 特約95折/VIP9折
  // 물리 카드 프로그램 고유 규칙이므로 그 둘일 때만 적용한다. 둘을 같이
  // 걸면 카드 쪽 규칙이 살아 있으므로 현금만 된다.
  const discountRequiresCash = !!vipDiscountType && paymentMethod !== "cash";
  return { paymentMethod, vipDiscountType, manualDiscount, discountRequiresCash };
}

// PATCH /:id, PATCH /:id/split-pay 둘 다 이 함수만 부르면 된다.
// 特約95折/VIP9折 + 재량 할인의 실제 산수는 src/discounts.js 에 있다 —
// 여기서는 "음료·주류가 무엇인가"(메뉴 카테고리를 봐야 알 수 있는, 이
// 라우트만 아는 것)만 넣어주고 총액을 받아온다.
function computeDiscountAmount(vipDiscountType, manualDiscount, items, indexes) {
  return computeDiscountAmountPure(vipDiscountType, manualDiscount, items, indexes, isDrinkItem).total;
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

  // 영업시간 밖에는 손님이 주문할 수 없다 (2026-09-10 사장님: "영업시간이
  // 아닐 때는 직원을 제외하고 qr 코드로 주문 안되게 해줘").
  //
  // 직원은 예외다. 마감 뒤 정리 주문이나 전화 주문을 직원이 대신 넣는 일은
  // 실제로 있고, 그것까지 막으면 직원은 시스템을 우회한다 — 그러면 그 매출이
  // 장부에서 통째로 사라진다. 막는 목적은 "손님이 아무 때나 QR 로 주문을
  // 던져놓는 것" 이지 직원의 손을 묶는 게 아니다.
  //
  // 화면에서도 잠그지만(public/js/order.js) 여기서 한 번 더 막는다. 주소를
  // 아는 사람이 그냥 POST 하면 화면 잠금은 아무 의미가 없고, QR 주소는
  // 테이블마다 종이에 인쇄돼 벽에 붙어 있다.
  if (!(req.session && req.session.isAdmin) && !isOpenNow(store.settings)) {
    return res.status(403).json({ error: "closed_now", ordering: orderingState(store.settings) });
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
  // 2026-09-08: 손님을 알아보는 경로가 홈페이지 로그인 세션과 기존 구글
  // 토큰 두 가지가 됐다. 어느 쪽이든 src/customer.js 한 곳을 거친다.
  // 로그인하지 않은 손님은 null 이고, 그건 오류가 아니라 가장 흔한 경우다.
  const customer = await resolveCustomer(req);
  let vipCard = null;
  if (customer) {
    const candidate = store.vipCards.find((c) => cardBelongsTo(c, customer));
    if (candidate && isVipActive(candidate)) vipCard = candidate;
  }

  const validated = [];
  let total = 0;
  for (const it of items) {
    // 품절 기간까지 따져서 "지금" 팔리는 것만 받는다(src/availability.js) —
    // 화면에서 사라진 메뉴가 주소만 알면 주문되는 일이 없어야 한다.
    const mi = store.menuItems.find(
      (m) => m.id === parseInt(it.itemId, 10) && isAvailableNow(m, store.settings)
    );
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
      // 부대찌개(部隊鍋) 포장 전용 옵션(不煮外帶/煮熟外帶 — 조리 여부) — 매장
      // 식사에는 없고 order.js의 #itemTakeoutOptions에서만 선택된다. 주방이
      // 조리 전에 확인해야 하므로 kitchen ticket에도 그대로 찍힌다.
      takeout_choice: it.takeoutOption || null,
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
      // 할인(特約95折/VIP9折, 위 isDrinkItem)이 음료·주류를 뺄 때
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
    // 어른(大)/아이(小) 구분도 같이 박아둔다 — 2026-09-10. 위와 같은 이유로
    // 테이블 쪽 값은 결제가 끝나면 사라지므로, 나중에 이 주문을 다시 볼 때
    // 남아 있는 건 여기뿐이다. 구분이 생기기 전 주문에는 이 두 칸이 없고,
    // 읽는 쪽은 그때 전체 인원을 어른으로 친다(partyBreakdownOf).
    party_adults: orderingTable.party_adults == null ? null : orderingTable.party_adults,
    party_children: orderingTable.party_children == null ? null : orderingTable.party_children,
    // Only set for 포장 카운터 orders (null for every real table) — see the
    // customerName/pickupNumber derivation above.
    customer_name: customerName,
    customer_phone: customerPhone,
    pickup_number: pickupNumber,
    // 로그인한 손님의 주문이면 계정을 남긴다 — 이게 있어야 기기를 바꾸거나
    // 브라우저 캐시를 지워도 "내 주문 내역"이 남는다(GET /api/account/orders).
    // 로그인 안 한 손님은 null 이고, 그 경우 주문 내역은 예전처럼 그 브라우저
    // 안에만(localStorage) 남는다.
    account_id: customer && customer.accountId ? customer.accountId : null,
  };
  store.orders.push(order);
  // 주문 한 건만 자기 컬렉션에 쓴다. store 문서도 같이 쓰는 건 주문 번호
  // 카운터(nextId)가 거기 살기 때문인데, 이제 그 문서는 30KB 근처라 값이
  // 싸다 — 예전에는 이 한 줄이 몇 MB를 다시 쓰는 일이었다.
  await Promise.all([saveOrder(order), save()]);
  broadcastOrdersChanged();

  res.status(201).json(order);
});

// Customer: this table's running order history (every item ordered so far,
// across however many separate tickets were sent in). Excludes paid/
// cancelled orders, so it naturally empties out the moment the table is
// settled via the admin "전체 결제 완료" bulk-pay action.
// 지난 주문 불러오기.
//
// GET /:id 보다 반드시 위에 둔다 — 아래에 두면 Express 가 "history" 를
// 주문 번호로 읽어서 404 가 난다(위 PATCH /reorder 도 같은 이유로 앞에 있다).
//
// 사장님(2026-09-10): "전에 있던 테이블 그거 불러올 수 있으면 좋겠어. 어느
// 테이블에서 언제 몇시에 뭐를 시켰고 그런 게 다 기록을 하고 있잖아 우리가.
// 그래서 그게 결제완료가 되는 순간 그거 자체로도 저장이 되어서 나중에
// 필요할 때 불러올 수 있게."
//
// 기록은 이미 다 남고 있다(주문 한 건이 자기 문서로 저장된다 — src/db.js).
// 없던 건 "꺼내 보는 길"뿐이다. 위의 GET / 는 주방 화면용이라 메모리에
// 들고 있는 최근 며칠치만 본다. 여기는 컬렉션에 직접 물어보므로 몇 달 전
// 것도 나온다.
//
// 찾는 방법은 세 가지다 — 날짜 범위, 테이블 번호, 그리고 메뉴 이름이나
// 손님 이름으로 훑기. "지난주 금요일 7번 테이블" 이 가장 흔한 물음이라
// 날짜와 테이블을 같이 걸 수 있게 했다.
router.get("/history", requireOwner, async (req, res) => {
  const q = req.query || {};
  const start = /^\d{4}-\d{2}-\d{2}$/.test(q.start || "") ? q.start : null;
  const end = /^\d{4}-\d{2}-\d{2}$/.test(q.end || "") ? q.end : start;
  const filter = {};
  if (start) {
    filter.created_at = { $gte: `${start} 00:00:00`, $lte: `${end} 23:59:59` };
  }
  // 영업 시작 전(=테스트) 주문은 여기서도 뺀다 — 결산에서 안 세는 것을
  // 목록에서만 보여주면 두 화면의 숫자가 달라 보인다(src/serviceStart.js).
  const started = serviceStartedAt(store);
  if (started) {
    const from = filter.created_at && filter.created_at.$gte;
    filter.created_at = Object.assign({}, filter.created_at, {
      $gte: from && from > started ? from : started,
    });
  }
  if (q.table) filter.table_number = String(q.table);
  if (q.status) filter.status = String(q.status);

  // 최근 것부터. 한 번에 200건까지 — 그보다 많이 필요하면 날짜를 좁히는
  // 편이 화면에서도 찾기 쉽다.
  const limit = Math.min(500, Math.max(1, parseInt(q.limit, 10) || 200));
  let list = await findOrders(filter, { sort: { created_at: -1 }, limit });

  // 메뉴 이름·손님 이름·픽업 번호로 훑기. 몇 백 건 안에서 찾는 것이라
  // 여기서 걸러도 충분하고, 이름이 세 언어로 나뉘어 있어 데이터베이스
  // 질의로 만들면 오히려 복잡해진다.
  const needle = String(q.q || "").trim().toLowerCase();
  if (needle) {
    list = list.filter((o) => {
      const hay = [
        o.customer_name, o.pickup_number, o.table_number, o.note,
        ...(o.items || []).flatMap((it) => [it.name_ko, it.name_zh, it.name_en, it.code]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }

  res.json({
    orders: list,
    count: list.length,
    // 200건에서 잘렸는지 화면이 알 수 있어야 "이게 전부"라고 오해하지 않는다.
    truncated: list.length >= limit,
  });
});

// 손님 화면의 「내 주문」 — 지금 이 자리에 앉아 있는 손님이 시킨 것 전부.
//
// 2026-09-10 사장님: "내 폰에서 직원이 수기로 추가한 주문도 qr 코드
// 주문내역에도 안 떠."
//
// 예전에는 결제된 주문을 빼고 줬다. 그래서 한 라운드를 결제하는 순간 아직
// 앉아 계신 손님 화면에서 그 주문이 사라지고, 「아직 주문이 없어요」가 뜬다.
// 손님은 자기가 시킨 게 사라진 줄 안다.
//
// 사장님 규칙은 하나다: "전체 결제를 하지 않는 이상 이 손님은 같은 손님."
// 그러니 앉아 있는 동안에는 이미 결제한 라운드도 자기 주문내역에 남아야
// 한다. 경계는 자리 이동과 똑같이 「이 손님이 앉은 시각」이다 —
// 그래야 낮에 앉았다 간 다른 손님의 주문이 딸려 나오지 않는다.
//
// 앉은 시각을 모르는 자리(인원수가 없는 자리, 포장 카운터)는 예전 그대로
// 안 받은 주문만 준다. 확실하지 않을 때 남의 주문을 보여주는 것보다,
// 덜 보여주는 편이 낫다.
router.get("/table/:tableNumber", (req, res) => {
  const num = String(req.params.tableNumber);
  const table = store.tables.find((t) => String(t.number) === num);
  const seatingStart = seatingStartOf(table);
  const list = store.orders
    .filter((o) => String(o.table_number) === num && o.status !== "cancelled")
    .filter((o) => (seatingStart ? String(o.created_at || "") >= seatingStart : o.status !== "paid"))
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
  const touched = [];
  orderIds.forEach((id, index) => {
    const order = store.orders.find((o) => o.id === parseInt(id, 10));
    if (order) {
      order.queue_order = index;
      touched.push(order);
    }
  });
  // 순서를 바꾼 주문만 쓴다.
  await saveOrders(touched);
  broadcastOrdersChanged();
  res.json({ ok: true });
});

// 자리 이동 — 앉아 있는 손님을 통째로 다른 테이블로 옮긴다.
//
// 2026-09-10 사장님: "손님이 주문하고 난 후에도 좌석 이동을 가능하게 해줘.
// 지금은 합산 결제 기능만 있는데 자리 이동 만들어줘."
//
// 합산 결제와 다른 일이다. 합산 결제는 「결제할 때만 합치기」라 주문이 어느
// 테이블 것인지는 그대로 두는데(그쪽 주석 참고), 자리를 옮기는 건 지금부터
// 그 손님이 저 자리에 있다는 뜻이다 — 다음 주문도, 주방 티켓도, 결산의
// 테이블별 매출도 새 자리로 가야 한다.
//
// 옮기는 건 아직 안 받은 주문뿐이다. 이미 결제된 주문은 그 자리에서 실제로
// 일어난 매출이라 건드리지 않는다 — 옮기면 그날 테이블별 매출이 사실과
// 달라진다.
//
// 이 파일에는 POST /:id 가 없어서 /reorder 가 겪었던 "이름이 id 로 잡히는"
// 문제는 없다. 그래도 나중에 POST /:id 가 생기면 그 위에 있어야 한다.
router.post("/move", requireAdmin, async (req, res) => {
  const from = String((req.body || {}).from || "");
  const to = String((req.body || {}).to || "");
  if (!from || !to || from === to) return res.status(400).json({ error: "invalid_move" });

  const fromTable = store.tables.find((t) => String(t.number) === from);
  const toTable = store.tables.find((t) => String(t.number) === to);
  if (!fromTable || !toTable) return res.status(404).json({ error: "table_not_found" });
  // 포장 카운터는 자리가 아니다. 그 주문들은 서로 무관한 손님들 것이고
  // 픽업번호·이름으로 구분되므로, 테이블로 옮기면 누구 것인지 알 수 없게 된다.
  if (fromTable.is_counter || toTable.is_counter) return res.status(400).json({ error: "counter_not_movable" });

  // 이 손님이 시킨 것은 전부 따라간다 — 이미 결제한 라운드까지.
  //
  // 사장님(2026-09-10, 세 번의 대화 끝에): "결국 같은 손님인 거잖아. 그럼
  // 따라가는 게 맞는 거 같은데."
  //
  // 결제한 것을 그 자리에 남겨두면 한 손님의 기록이 두 자리로 쪼개진다.
  // 결산의 테이블별 매출은 그만큼 새 자리로 옮겨간다 — 하루 합계는 그대로다.
  //
  // 그래도 경계는 있어야 한다. 아무 경계 없이 「이 테이블의 모든 주문」을
  // 옮기면, 오늘 낮에 그 자리에 앉았다 간 다른 손님의 결제까지 함께
  // 옮겨진다. 그건 아무도 눈치채지 못하고 되돌릴 수도 없다.
  //
  // 경계는 「지금 앉아 있는 손님이 앉은 시각」이다(src/partySize.js 의
  // seatingStartOf). 사장님 규칙 그대로다: "몇개만 주문을 하던 자리를
  // 옮기던 시간이 오래 걸리던 전체 결제를 하지 않는 이상 이 손님은 같은
  // 손님." 인원수를 찍은 때가 곧 그 손님이 앉은 때이고, 전체 결제가 끝나면
  // 인원수가 지워지므로 그 값이 있다는 것은 그 손님이 아직 앉아 있다는 뜻이다.
  //
  // 그 시각을 모르면(인원수가 없는 자리) 안 받은 주문만 옮긴다. 확실하지
  // 않을 때 남의 결제 기록까지 옮기는 것보다, 덜 옮기고 직원이 한 번 더
  // 보는 편이 낫다.
  const seatingStart = seatingStartOf(fromTable);
  const tableOrders = store.orders.filter(
    (o) => String(o.table_number) === from && o.status !== "cancelled"
  );
  const moving = seatingStart
    ? tableOrders.filter((o) => String(o.created_at || "") >= seatingStart)
    : tableOrders.filter((o) => o.status !== "paid");
  if (moving.length === 0) return res.status(400).json({ error: "nothing_to_move" });

  const now = nowLocal();
  for (const o of moving) {
    // 어디서 왔는지 남긴다. 주방에는 이미 옛 번호가 찍힌 티켓이 나가 있어서,
    // 직원이 화면에서 그 연결을 볼 수 없으면 "5번 것이 왜 8번에 있지" 가 된다.
    o.moved_from = from;
    o.moved_at = now;
    o.table_number = to;
    o.updated_at = now;
  }

  // 인원수도 따라간다. 규칙 자체는 src/partySize.js 에 있다 — 인원수를
  // 비우는 코드가 이 파일에 흩어지면 "결제했을 때만 비운다" 는 규칙이
  // 조용히 무너진다.
  // movePartySize 가 옛 자리의 「앉은 시각」을 지우므로 그 전에 들고 있는다.
  // 이 값이 아래 moved_to 의 seating 이 된다 — 손님 폰이 "내가 그 손님인가"
  // 를 가리는 기준이다.
  const movedSeating = fromTable.party_size_updated_at || null;
  movePartySize(store, from, to);

  // 옛 자리에 「어디로 갔는지」를 남긴다.
  //
  // 2026-09-10 사장님: "이미 손님이 해당 qr 코드로 되어있잖아. 그럼 qr 코드
  // 이미 들어가있다면 이동을 도와드리겠다고 하고 확인 버튼만 있게 해줘."
  //
  // 손님 폰에는 아직 옛 자리 화면이 떠 있다. 직원이 말로 알려주지 않으면
  // 손님은 그대로 옛 자리에 주문을 넣는다 — 그러면 그 주문만 혼자 떨어져
  // 나가고, 주방은 빈 자리로 음식을 낸다.
  //
  // order_ids 와 seating 을 같이 남기는 이유: 이 안내는 「아까 여기 앉아
  // 있던 그 손님」에게만 보여야 한다. 5분 뒤 그 자리에 새로 앉은 손님에게
  // "자리가 옮겨졌어요" 가 뜨면 그게 더 큰 혼란이다.
  //
  // 두 가지로 가린다.
  //   order_ids — 손님이 자기 폰으로 넣은 주문 번호(localStorage)와 겹치는가
  //   seating   — 그 손님이 앉은 시각. 폰은 이 자리 화면을 열 때마다 지금
  //               앉아 있는 손님의 앉은 시각을 적어둔다.
  //
  // seating 이 필요한 이유: 직원이 대신 넣어준 주문은 손님 폰에 번호가 없다
  // (2026-09-10 사장님이 실제로 그렇게 시험하셨다). 그때도 그 손님은 이
  // 자리 화면을 보고 있으므로, 앉은 시각으로는 알아볼 수 있다.
  fromTable.moved_to = {
    to,
    at: now,
    order_ids: moving.map((o) => o.id),
    seating: movedSeating,
  };
  // 옮겨 간 자리에 예전 안내가 남아 있으면 안 된다 — 5번에서 8번으로 갔다가
  // 8번에서 또 옮기는 경우, 8번의 옛 안내가 되살아난다.
  delete toTable.moved_to;

  await saveOrders(moving);
  await save();
  broadcastOrdersChanged();
  res.json({
    ok: true,
    moved: moving.length,
    moved_paid: moving.filter((o) => o.status === "paid").length,
    moved_ids: moving.map((o) => o.id),
    from,
    to,
    party_size: toTable.party_size || null,
    party_adults: toTable.party_adults == null ? null : toTable.party_adults,
    party_children: toTable.party_children == null ? null : toTable.party_children,
  });
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
    const { paymentMethod, vipDiscountType, manualDiscount, discountRequiresCash } = resolvePaymentFields(req.body || {});
    if (discountRequiresCash) return res.status(400).json({ error: "discount_requires_cash" });
    if (paymentMethod) {
      order.payment_method = paymentMethod;
      // 이 라운드가 이전에 부분결제(PATCH /:id/split-pay)로 일부 품목만
      // 결제수단이 찍혀 있었다면 그건 그대로 두고, 아직 안 찍힌(=여기서
      // 한 번에 전부 결제되는) 품목에만 이번 결제수단을 남긴다 — 정산의
      // 결제수단별 집계(src/settlement.js)가 품목 단위로 정확히 잡을 수
      // 있게 하기 위함(사장님 요청 2026-09-07: "정산에서도 서로 분류해서도
      // 집계해줘").
      order.items.forEach((it) => {
        if (!it.payment_method) it.payment_method = paymentMethod;
      });
    }
    if (vipDiscountType || manualDiscount) {
      const discountAmount = computeDiscountAmount(vipDiscountType, manualDiscount, order.items);
      order.discount_type = discountTypeKey(vipDiscountType, manualDiscount);
      order.discount_amount = (order.discount_amount || 0) + discountAmount;
    }
  }

  order.status = status;
  order.updated_at = nowLocal();

  // 직원이 「결제 완료」를 눌러 이 테이블에 안 받은 돈이 없어졌으면, 그
  // 손님은 나간 것이므로 등록된 인원수를 지운다 — 다음 손님이 앞 손님
  // 인원수를 물려받지 않도록.
  //
  // 결제일 때만 한다. 예전에는 "살아 있는 주문이 하나도 없으면" 지웠는데,
  // 그러면 주방에 재료가 떨어져 마지막 한 접시를 취소하는 순간 앉아 계신
  // 손님이 나간 것으로 처리돼서 인원수를 다시 묻게 됐다.
  // 사장님(2026-09-09): "결제를 완료했다고 직원이 누르지 않는 한 한번이라도
  // 주문한 손님은 계속 같은 손님으로 취급할거야."
  // 주문이 전부 취소돼서 받을 돈이 아예 없는 테이블은 결제할 것이 없으므로
  // 이 길로 들어오지 않는다 — 결제 탭의 「손님 나감」 버튼으로 직원이 직접
  // 비운다(DELETE /api/tables/:n/party-size).
  const partyCleared = status === "paid" && clearPartySizeIfSettled(store, order.table_number);

  // 이 주문 하나만 쓴다. store 문서는 인원수가 실제로 비워졌을 때만 —
  // 사장님이 5~20초를 기다리던 버튼이 바로 이 자리다.
  await saveOrder(order);
  if (partyCleared) await save();
  broadcastOrdersChanged();
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
    // 품절 기간까지 따져서 "지금" 팔리는 것만 받는다(src/availability.js) —
    // 화면에서 사라진 메뉴가 주소만 알면 주문되는 일이 없어야 한다.
    const mi = store.menuItems.find(
      (m) => m.id === parseInt(it.itemId, 10) && isAvailableNow(m, store.settings)
    );
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
      takeout_choice: it.takeoutOption || null,
      selected_addons: selectedAddons,
      order_type: it.orderType === "takeout" ? "takeout" : "dine_in",
      // POST /의 같은 필드와 동일 — 위 isDrinkItem 참고.
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

  await saveOrder(order);
  broadcastOrdersChanged();
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
  const { paymentMethod, vipDiscountType, manualDiscount, discountRequiresCash } = resolvePaymentFields(req.body || {});
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
    // 정산의 결제수단별 집계(src/settlement.js)가 품목 단위로 정확히
    // 집계할 수 있도록, "이번에 결제된 이 품목들"에는 이번 결제수단을
    // 남긴다 — 같은 라운드를 나중에 다른 결제수단으로 또 나눠 내도(예:
    // 일부는 현금, 나머지는 신용카드) 각자 자기 결제수단으로 정확히
    // 잡힌다. 사장님 요청(2026-09-07): "정산에서도 서로 분류해서도
    // 집계해줘".
    if (paymentMethod) order.items[i].payment_method = paymentMethod;
  });
  if (paymentMethod) order.payment_method = paymentMethod;
  if (vipDiscountType || manualDiscount) {
    const discountAmount = computeDiscountAmount(vipDiscountType, manualDiscount, order.items, selectedIdx);
    order.discount_type = discountTypeKey(vipDiscountType, manualDiscount);
    order.discount_amount = (order.discount_amount || 0) + discountAmount;
  }
  order.updated_at = paidAt;

  // 이번에 남김없이 전부 결제완료로 표시됐으면(이전에 이미 일부가
  // paid였던 경우 포함) 이 주문 전체를 paid로 넘긴다 — PATCH /:id와 같은
  // party_size 정리 규칙도 그대로 적용한다.
  const allPaid = order.items.every((it) => it.paid);
  let partyCleared = false;
  if (allPaid) {
    order.status = "paid";
    partyCleared = clearPartySizeIfSettled(store, order.table_number);
  }

  await saveOrder(order);
  if (partyCleared) await save();
  broadcastOrdersChanged();
  res.json({ updatedOrder: order });
});

module.exports = router;
