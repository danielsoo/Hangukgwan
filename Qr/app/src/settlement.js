// Daily settlement (결산) computation — shared by the live admin view
// (src/routes/settlements.js GET /) and the nightly snapshot the cron job
// writes into store.daily_settlements for permanent record-keeping.
const { taipeiDateString, nowLocal } = require("./time");

// "Problem" = still open (not paid, not cancelled) AND has been sitting
// long enough that it isn't just a table still mid-meal — the owner asked
// specifically to see anything unpaid so it doesn't get missed: when it was
// ordered, which table, and exactly what was in it. For an already-closed
// past day every open order already qualifies (it's had a whole day to be
// paid), but applying that same "any open order = problem" rule to TODAY
// while the restaurant is still running made completely normal in-progress
// orders (just placed, still cooking, or served but the table hasn't asked
// for the bill yet) show up as "미결제" too, which looked alarming and
// wasn't actually wrong — those orders just hadn't reached paid status yet
// (owner: "18개가 미결제라는 거야?" — most of those were simply today's
// still-active tables). So instead of a pure status check, an open order
// only counts once it's been open at least STALE_OPEN_ORDER_MS — long
// enough that it really does look like a missed payment rather than
// ordinary service still in progress (owner picked this over "오늘은 문제
// 표시 자체를 숨기기"/"지금 그대로 두기").
const OPEN_STATUSES = ["new", "preparing", "served"];
const STALE_OPEN_ORDER_MS = 2 * 60 * 60 * 1000; // 2 hours

// startDate/endDate are inclusive "YYYY-MM-DD" strings (Taipei business
// day). Passing just one date computes that single day, same as before —
// the admin 결산 tab now also lets the owner widen this into a date range
// (e.g. "이번 주" or "이번 달") to see totals across multiple days at once.
// 2026-09-10: 주문이 store 문서 밖으로 나가면서(src/db.js), 메모리의
// store.orders 는 "안 끝난 주문 + 최근 며칠"만 담는다. 결산은 지난 달치도
// 봐야 하므로 여기서 store 를 뒤지면 조용히 적게 나온다 — 돈 숫자가 조용히
// 틀리는 건 최악이다. 그래서 이 함수는 계산만 하고, 어떤 주문을 볼지는
// 부르는 쪽이 질의해서 넘긴다(src/routes/settlements.js).
/**
 * 주문 하나에 찍힌 인원을 어른·아이로 가른다.
 *
 * 어른/아이 구분이 생기기 전(2026-09-10 이전)에 앉은 손님은 party_adults 가
 * 아예 없다. 그 손님들은 **전부 어른으로 센다** — 손님 화면도 같은 규칙으로
 * 내려보낸다(src/routes/tables.js). 0 으로 두면 그날 어른 수가 통째로
 * 사라져서, 옛 날짜를 열어본 결산이 텅 빈 것처럼 보인다.
 *
 * 어른+아이가 인원과 안 맞는 값이 저장돼 있으면 **인원 쪽을 믿는다.**
 * 결산의 「손님 N명」과 「어른 A·아이 C」가 어긋나면 어느 쪽도 못 믿게 된다.
 */
function splitParty(o) {
  const size = o.party_size;
  const children = Number.isFinite(o.party_children) ? Math.max(0, Math.min(size, o.party_children)) : 0;
  const adults = Number.isFinite(o.party_adults) && o.party_adults + children === size
    ? o.party_adults
    : size - children;
  return { size, adults, children };
}

/**
 * 한 주문이 실제로 결제된 시각.
 *
 * 부분 결제(품목별)로 나눠 낸 라운드는 마지막 품목이 결제된 때를 그 주문의
 * 결제 시각으로 본다 — 그 전에는 아직 받을 돈이 남아 있었다.
 */
function paidAtOf(order) {
  const stamps = (order.items || []).map((it) => it.paid_at).filter(Boolean);
  if (stamps.length) return stamps.sort().pop();
  return order.updated_at || order.created_at;
}

/**
 * 오전과 오후를 가르는 시각. 날짜별로 다르다.
 *
 * 사장님(2026-09-10): "결산 매출에 오전 매출 오후 매출을 따로 나눴으면 좋겠어."
 *
 * 기준은 두 가지이고, 정확한 쪽을 먼저 쓴다.
 *
 *   1. 그날 **오전 정산을 누른 시각**(am_closed_at). 직원이 실제로 서랍을
 *      맞춘 순간이라, 14시 20분에 눌렀으면 14시 10분 결제는 오전 몫이다.
 *      하루 정산 문자가 이미 이 기준으로 나가고 있다(routes/settlements.js).
 *   2. 안 눌렀으면 **저녁 영업이 시작하는 시각**. 이 가게는 11:00~13:35 와
 *      16:30~20:35 로 두 타임이라, 그 사이 공백이 자연스러운 경계다.
 *      점심 손님이 늦게까지 앉아 계셔도 저녁이 열리기 전이면 오전 몫이다.
 *
 * 둘 다 없으면 가르지 않는다. 없는 경계를 지어내면 그 숫자를 아무도 못 믿는다.
 */
function halfBoundaryFor(dateStr, opts) {
  const closed = opts && opts.amClosedAt && opts.amClosedAt[dateStr];
  if (closed) return closed;
  const hint = opts && opts.eveningStartsAt;
  return hint ? `${dateStr} ${hint}:00` : null;
}

/**
 * 한 팀 — 한 번 앉았다 일어나는 손님 한 무리 — 을 가리키는 열쇠.
 *
 * 인원은 주문마다 찍히므로 같은 팀이 세 번 주문하면 세 번 세어진다. 그래서
 * 팀마다 한 번만 세야 하는데, 그 「팀」을 (테이블, 날짜)로 잡으면 **점심
 * 손님과 저녁 손님이 한 팀으로 뭉친다.** 2026-09-10 사장님: "인원이 오전
 * 오후 합치면 총 72명인데 합계는 51이야" — 오전·오후는 각자 안에서 세니까
 * 맞고, 합계만 자리마다 큰 쪽 하나로 눌려서 21명이 사라진 것이다.
 *
 * 그래서 두 가지를 열쇠에 같이 넣는다.
 *
 *   1. o.seating — 그 손님이 그 자리에 앉은 시각(src/seating.js). 자리를
 *      옮겨도 따라오고 결제하면 지워지니, 같은 자리에 새로 앉은 다음 팀과
 *      절대 겹치지 않는다. 가장 정확한 기준이라 있으면 이걸 쓴다.
 *   2. 오전/오후. 이 표가 열쇠에 들어가야 **오전 몫 + 오후 몫 + 못 가른 몫
 *      = 합계** 가 언제나 성립한다. 합계 쪽이 더 굵게 묶이는 순간 두 숫자가
 *      어긋나고, 사장님은 어느 쪽도 못 믿게 된다.
 *
 * seating 이 없는 옛 주문(2026-09-10 이전)은 날짜+반나절로 묶는다. 예전보다
 * 잘게 갈리므로 옛 날짜의 손님 수가 늘어 보일 수 있는데, 늘어난 쪽이 맞다.
 */
function partyKeyOf(o, half) {
  const h = half || "?";
  const party = o.seating || `${o.created_at.slice(0, 10)}`;
  return `${o.table_number}|${party}|${h}`;
}

/**
 * 주문 하나가 오전 몫인지 오후 몫인지. "am" | "pm" | null.
 *
 * **가르는 규칙은 여기 한 곳뿐이다.** 결산의 오전/오후 칸도, 「오전만 보기」로
 * 걸러낸 화면도, 아래 주문 목록도 전부 이 함수를 부른다. 규칙이 두 군데에
 * 있으면 언젠가 한쪽만 고쳐지고, 그러면 위의 오전 매출과 아래 오전 목록이
 * 서로 다른 이야기를 한다 — 그건 숫자가 틀린 것보다 나쁘다.
 *
 * null 은 "못 가른다"는 뜻이다. 0 이나 오전으로 떠넘기지 않는다 — 없는
 * 경계를 지어내면 그 숫자를 아무도 못 믿는다.
 */
function halfOf(order, opts) {
  if (!order) return null;
  // 주문에 박혀 있는 표를 먼저 믿는다 (src/servicePeriod.js).
  //
  // 사장님(2026-09-10): "주문이 들어온 시간을 몽고디비에 오전인지 오후인지
  // 같이 저장하면 되는 거 아니야?" — 그 표가 있으면 정산을 눌렀는지,
  // 그 뒤에 영업시간이 바뀌었는지와 무관하게 언제나 같은 답이 나온다.
  if (order.service_period === "am" || order.service_period === "pm") return order.service_period;
  // 표가 없는 옛 주문은 경계 시각으로 가른다.
  const boundary = halfBoundaryFor(String(order.created_at || "").slice(0, 10), opts);
  if (!boundary) return null;
  return paidAtOf(order) <= boundary ? "am" : "pm";
}

function summarize(paid, half) {
  const revenue = paid.reduce((sum, o) => sum + (o.total || 0), 0);
  const byTableDay = new Map();
  for (const o of paid) {
    if (!o.party_size) continue;
    const key = partyKeyOf(o, half);
    const prev = byTableDay.get(key);
    if (prev && prev.size >= o.party_size) continue;
    byTableDay.set(key, splitParty(o));
  }
  const parties = [...byTableDay.values()];
  const guests = parties.reduce((a, p) => a + p.size, 0);
  return {
    revenue,
    paid_order_count: paid.length,
    guest_count: guests,
    adult_count: parties.reduce((a, p) => a + p.adults, 0),
    child_count: parties.reduce((a, p) => a + p.children, 0),
    avg_per_order: paid.length ? Math.round(revenue / paid.length) : 0,
    avg_per_guest: guests ? Math.round(revenue / guests) : 0,
  };
}

function computeSettlement(orders, startDate, endDate = startDate, opts = {}) {
  const rangeAll = (orders || []).filter((o) => {
    const d = o.created_at.slice(0, 10);
    return d >= startDate && d <= endDate;
  });

  // 「오전만 보기」 / 「오후만 보기」 (2026-09-10 사장님: "오전, 오후 정산을
  // 클릭해서 해당 내용을 볼 수 있으면 좋겠어... Shift 별로 클릭하면 해당
  // Shift만 볼 수 있으면 더 디테일할거야").
  //
  // 여기서 한 번 걸러내면 아래가 전부 따라온다 — 결제수단도, 분류별 매출도,
  // 시간대 그래프도, 테이블별도. 화면에서 조각조각 거르면 어느 하나를 빠뜨리고,
  // 빠뜨린 그 칸만 조용히 하루치를 보여준다.
  //
  // 못 가르는 주문(halfOf 가 null)은 어느 쪽에도 안 들어간다. 그 몫이
  // 얼마인지는 아래 half_split.unsplit_revenue 로 화면에 그대로 나간다.
  const shift = opts.shift === "am" || opts.shift === "pm" ? opts.shift : null;
  const rangeOrders = shift ? rangeAll.filter((o) => halfOf(o, opts) === shift) : rangeAll;

  const paidOrders = rangeOrders.filter((o) => o.status === "paid");
  // 오전/오후 두 칸은 **거르기 전 것**으로 센다. 「오전만 보기」로 들어가도
  // 두 칸이 다 보여야 거기서 오후로 건너갈 수 있다. 거른 것으로 세면 반대편
  // 칸이 0 이 되어, 그날 오후 매출이 정말 0 인 줄 안다.
  const paidOrdersAll = shift ? rangeAll.filter((o) => o.status === "paid") : paidOrders;
  const cancelledOrders = rangeOrders.filter((o) => o.status === "cancelled");
  // Both timestamps below come from nowLocal() (see src/time.js) — a plain
  // "YYYY-MM-DD HH:MM:SS" Taipei wall-clock string with no timezone
  // designator, which Date() parses using whatever timezone the running
  // process happens to be in (Vercel's default is UTC, per time.js's own
  // comment). Parsing "now" through the exact same nowLocal() + Date()
  // path as every order's created_at means both ends pick up that same
  // misinterpretation, so it cancels out in the subtraction below and the
  // elapsed duration comes out correct regardless of the server's actual
  // process timezone. Mixing this with a real `new Date()` instead would
  // silently be off by Taipei's UTC+8 offset.
  const nowMs = new Date(nowLocal().replace(" ", "T")).getTime();
  const problemOrders = rangeOrders.filter((o) => {
    if (!OPEN_STATUSES.includes(o.status)) return false;
    const placedMs = new Date(o.created_at.replace(" ", "T")).getTime();
    return nowMs - placedMs >= STALE_OPEN_ORDER_MS;
  });

  const totalRevenue = paidOrders.reduce((sum, o) => sum + (o.total || 0), 0);

  // 결제수단별 집계 (2026-09-07 사장님 요청: "결제종류... 정산에서도 서로
  // 분류해서도 집계해줘 총합도 있고") — 품목 단위로 나눈다. 한 라운드를
  // 부분결제(PATCH /:id/split-pay)로 서로 다른 결제수단에 나눠 낸 경우에도
  // 각 품목이 실제로 어느 결제수단으로 찍혔는지(it.payment_method)가
  // 반영된다. 그 필드가 없는 옛 데이터는 주문의 order.payment_method 로,
  // 그것도 없으면 "unspecified"(미지정)로 묶인다. 손님이 직접 낸 온라인
  // 결제(src/routes/payments.js)는 "online" 으로 따로 잡힌다.
  //
  // 2026-09-10: 할인을 빼고 세도록 고쳤다.
  //
  // 예전에는 품목 정가 합(unit_price×qty)을 그대로 더해서, 화면에 "매출
  // NT$44,301" 과 "결제수단 총합 NT$44,990" 이 나란히 뜨는 일이 있었다.
  // 차이는 VIP·재량 할인이다. 주석에는 "한계이자 관례"라고 적혀 있었지만,
  // 이 표를 보는 이유가 마감에 서랍의 현금을 맞춰보는 것이라면 관례로
  // 넘길 일이 아니다 — 현금 칸이 실제로 받지 않은 돈까지 세고 있으면
  // 매일 밤 안 맞는다.
  //
  // 그래서 주문마다 할인을 결제수단별 비중대로 나눠서 뺀다. 한 주문을
  // 현금 60% / 카드 40% 로 나눠 냈다면 할인도 그 비율로 나눈다. 반올림
  // 오차는 마지막 결제수단에서 흡수해, 결제수단 총합이 그 주문의 실제
  // 받은 금액(order.total)과 정확히 같아지게 한다. 그래야 표의 총합이
  // 위의 "매출"과 한 원도 어긋나지 않는다.
  const paymentMethodMap = new Map();
  for (const o of paidOrders) {
    const byMethod = new Map();
    for (const it of o.items || []) {
      const method = it.payment_method || o.payment_method || "unspecified";
      byMethod.set(method, (byMethod.get(method) || 0) + (it.unit_price || 0) * (it.qty || 0));
    }
    const gross = [...byMethod.values()].reduce((a, b) => a + b, 0);
    // 실제 받은 금액. 할인이 없으면 gross 와 같다.
    const net = o.total != null ? o.total : gross;
    const methods = [...byMethod.entries()];
    let assigned = 0;
    methods.forEach(([method, amount], idx) => {
      const last = idx === methods.length - 1;
      // 마지막 하나는 남은 전부를 가져간다 — 반올림으로 1원이 새거나
      // 남지 않게 하려는 것이다.
      const share = last ? net - assigned : gross > 0 ? Math.round((amount / gross) * net) : 0;
      assigned += share;
      const entry = paymentMethodMap.get(method) || { method, revenue: 0, gross: 0, order_ids: new Set() };
      entry.revenue += share;
      entry.gross += amount;
      entry.order_ids.add(o.id);
      paymentMethodMap.set(method, entry);
    });
  }
  const paymentMethodBreakdown = [...paymentMethodMap.values()]
    .map((e) => ({ method: e.method, revenue: e.revenue, gross: e.gross, order_count: e.order_ids.size }))
    .sort((a, b) => b.revenue - a.revenue);
  const paymentMethodTotal = paymentMethodBreakdown.reduce((sum, e) => sum + e.revenue, 0);

  // ── 사장님 요청(2026-09-10): "합계 등등 다양하게 그냥 왠만한 모든 걸
  // 기록해서 결산 페이지에서 볼 수 있었으면 좋겠어" ──────────────────
  //
  // 아래는 전부 이미 주문에 들어 있는 값을 모아 세는 것뿐이다 — 새로
  // 기록하기 시작하는 게 아니라, 기록돼 있는데 화면에 안 보이던 것들이다.

  // 매장 / 포장. 주문 단위의 order_type("dine_in" | "takeout" | "mixed")을
  // 쓴다. 섞인 주문(mixed)은 따로 세서, 셋을 더하면 결제 완료 건수와 맞는다.
  const orderTypeMap = new Map();
  for (const o of paidOrders) {
    const key = o.order_type || "dine_in";
    const e = orderTypeMap.get(key) || { order_type: key, revenue: 0, order_count: 0 };
    e.revenue += o.total || 0;
    e.order_count += 1;
    orderTypeMap.set(key, e);
  }
  const orderTypeBreakdown = [...orderTypeMap.values()].sort((a, b) => b.revenue - a.revenue);

  // 분류별 매출 (밥류/면류/음료/주류…). 품목이 주문될 당시의 카테고리를
  // 스냅샷으로 들고 있어서(category_key), 나중에 메뉴 분류를 바꿔도 지난
  // 결산 숫자가 흔들리지 않는다.
  const categoryMap = new Map();
  for (const o of paidOrders) {
    for (const it of o.items || []) {
      const key = it.category_key || "uncategorized";
      const e = categoryMap.get(key) || { category_key: key, qty: 0, subtotal: 0 };
      e.qty += it.qty || 0;
      e.subtotal += (it.unit_price || 0) * (it.qty || 0);
      categoryMap.set(key, e);
    }
  }
  const categoryBreakdown = [...categoryMap.values()].sort((a, b) => b.subtotal - a.subtotal);

  // 할인 — 얼마를 깎아줬는지. 매출에서 이미 빠진 돈이라 따로 안 보면
  // 얼마나 나갔는지 알 길이 없다.
  //
  // 사장님 요청(2026-09-10): "할인한 양이랑 그 중에 vip 카드 중 어떤 거에서
  // 할인, 그냥 직접 할인 등 그것도 결산 페이지랑 보고에 들어갔으면 좋겠어.
  // 그래서 vip 카드가 적자인지 흑자인지도 쉽게 볼 수 있을 것 같아."
  //
  // 그래서 種類를 하나씩 갈라 센다. 두 할인을 같이 건 주문은
  // discount_type 이 "te95+manual" 이라 그것만 봐서는 어느 쪽이 얼마인지
  // 모른다 — 주문에 따로 적어둔 discount_vip_amount / discount_manual_amount
  // 를 쓴다(src/routes/orders.js recordDiscount). 그 필드가 생기기 전에
  // 저장된 주문은 나눌 근거가 없으므로 합계를 discount_type 키 그대로
  // 하나의 종류로 센다 — 없는 숫자를 지어내는 것보다 낫다.
  const discountMap = new Map();
  let discountTotal = 0;
  let vipCardDiscountTotal = 0; // VIP 카드(特約95折/VIP9折)가 깎아준 돈만
  const bump = (key, amount) => {
    if (!amount) return;
    const e = discountMap.get(key) || { discount_type: key, amount: 0, order_count: 0 };
    e.amount += amount;
    e.order_count += 1;
    discountMap.set(key, e);
  };
  for (const o of paidOrders) {
    const amount = o.discount_amount || 0;
    if (!amount) continue;
    discountTotal += amount;
    const vipPart = o.discount_vip_amount;
    const manualPart = o.discount_manual_amount;
    const hasSplit = vipPart != null || manualPart != null;
    if (!hasSplit) {
      bump(o.discount_type || "unspecified", amount);
      // 옛 주문이라도 종류 자체는 알 수 있다 — "te95"/"vip9" 만 걸린
      // 주문이면 그 금액은 전부 VIP 카드 몫이다. 섞인 주문만 가를 수 없다.
      if (o.discount_type === "te95" || o.discount_type === "vip9") vipCardDiscountTotal += amount;
      continue;
    }
    // 어느 카드였는지는 discount_type 앞부분에 남아 있다("te95+manual" → te95).
    const vipKey = String(o.discount_type || "").split("+")[0];
    if (vipPart) {
      bump(vipKey === "te95" || vipKey === "vip9" ? vipKey : "unspecified", vipPart);
      vipCardDiscountTotal += vipPart;
    }
    if (manualPart) bump("manual", manualPart);
  }
  const discountBreakdown = [...discountMap.values()].sort((a, b) => b.amount - a.amount);

  // VIP 카드가 적자인지 흑자인지. 카드를 판 돈에서 그 카드들이 깎아준 돈을
  // 뺀 것이다(src/routes/vipCards.js 의 POST /sell 이 카드 판매를
  // kind:"vip_card_sale" 주문으로 남긴다).
  //
  // 주의: 이 둘은 같은 카드의 것이 아니다. 오늘 판 카드와 오늘 할인을 받은
  // 카드는 서로 다른 손님일 수 있고, 카드는 1년을 쓴다. 그래서 하루치
  // 숫자는 "오늘 들어온 카드값 vs 오늘 나간 카드 할인"이고, 진짜 손익은
  // 결산 탭에서 기간을 넓혀 봐야 보인다 — 화면 쪽에 그 말을 적어둔다.
  const cardSaleOrders = paidOrders.filter((o) => o.kind === "vip_card_sale");
  const vipCardProgram = {
    cards_sold: cardSaleOrders.length,
    card_sales_revenue: cardSaleOrders.reduce((sum, o) => sum + (o.total || 0), 0),
    card_discount_given: vipCardDiscountTotal,
    net: cardSaleOrders.reduce((sum, o) => sum + (o.total || 0), 0) - vipCardDiscountTotal,
  };

  // 오전 / 오후.
  const amPaid = [];
  const pmPaid = [];
  const unsplitDates = new Set();
  const cuts = new Set();
  // 주문 하나하나가 어느 쪽 몫인지. 아래 손님 수 묶음이 이 표를 그대로 써야
  // 오전 몫 + 오후 몫 + 못 가른 몫 = 합계 가 성립한다.
  const halfByOrder = new Map();
  for (const o of paidOrdersAll) {
    const h = halfOf(o, opts);
    if (!h) {
      unsplitDates.add(o.created_at.slice(0, 10));
      continue;
    }
    // 어디서 갈랐는지 화면에 적어주기 위한 것. 표가 박힌 주문은 시각으로
    // 가른 게 아니라서 여기 안 들어간다.
    if (o.service_period !== "am" && o.service_period !== "pm") {
      const boundary = halfBoundaryFor(o.created_at.slice(0, 10), opts);
      if (boundary) cuts.add(String(boundary).slice(11, 16));
    }
    halfByOrder.set(o, h);
    (h === "am" ? amPaid : pmPaid).push(o);
  }
  // 손님 수와 객단가. party_size 는 테이블에서 손님이 직접 답한 인원수이고,
  // 주문할 때 그 주문에 함께 찍힌다. 같은 테이블이 여러 번 주문하면 같은
  // 인원이 여러 번 세어지므로, 한 팀마다 한 번만 센다 — 그 「한 팀」이
  // 무엇인지는 partyKeyOf 주석에 있다.
  //
  // 어른과 아이를 따로 센다 (2026-09-10 사장님: "결산에 들어가는 인원 성인
  // 아이 따로 구분해서 집계해줘").
  //
  // 어른·아이를 각각 최대값으로 따로 뽑으면 안 된다. 「어른 2·아이 0」과
  // 「어른 1·아이 2」가 같은 자리에 있었다면 각각의 최대는 2 와 2 라서
  // 합이 4 가 되는데, 실제로 센 인원(최대 3)과 어긋난다. 그래서 **가장 큰
  // 한 번을 통째로** 고르고 그 안의 어른·아이를 쓴다 — 합이 언제나 인원과
  // 같아진다.
  const partyByTableDay = new Map();
  for (const o of paidOrders) {
    if (!o.party_size) continue;
    const key = partyKeyOf(o, halfByOrder.get(o));
    // 한 자리에서 인원이 달라졌다면 큰 쪽을 쓴다(중간에 일행이 합류한 경우).
    const prev = partyByTableDay.get(key);
    if (prev && prev.size >= o.party_size) continue;
    partyByTableDay.set(key, splitParty(o));
  }
  const parties = [...partyByTableDay.values()];
  const guestCount = parties.reduce((a, p) => a + p.size, 0);
  const adultCount = parties.reduce((a, p) => a + p.adults, 0);
  const childCount = parties.reduce((a, p) => a + p.children, 0);
  const avgPerOrder = paidOrders.length ? Math.round(totalRevenue / paidOrders.length) : 0;
  const avgPerGuest = guestCount ? Math.round(totalRevenue / guestCount) : 0;

  const halfSplit = {
    am: summarize(amPaid, "am"),
    pm: summarize(pmPaid, "pm"),
    // 경계를 못 정해 어느 쪽에도 못 넣은 날들. 비어 있으면 두 몫의 합이
    // 총 매출과 정확히 같다.
    unsplit_dates: [...unsplitDates].sort(),
    // 어디서 갈랐는지. 여러 날을 한 번에 보면 날마다 다를 수 있어서, 하나로
    // 딱 떨어질 때만 적는다 — 「14:20 까지」라고 적어놓고 실제로는 날마다
    // 달랐다면 그 말이 거짓말이 된다.
    boundary_label: cuts.size === 1 ? [...cuts][0] : null,
    unsplit_revenue: paidOrdersAll
      .filter((o) => !halfOf(o, opts) && unsplitDates.has(o.created_at.slice(0, 10)))
      .reduce((sum, o) => sum + (o.total || 0), 0),
  };

  // 취소와 미결제는 지금까지 "몇 건"만 보였다. 금액이 있어야 얼마나 아까운
  // 일인지, 얼마를 놓치고 있는지 알 수 있다.
  const cancelledAmount = cancelledOrders.reduce((sum, o) => sum + (o.total || 0), 0);
  const problemAmount = problemOrders.reduce((sum, o) => sum + (o.total || 0), 0);

  // 테이블별 매출 — 어느 자리가 잘 도는지. 자리 배치를 바꿀 때 쓰는 숫자다.
  const tableMap = new Map();
  for (const o of paidOrders) {
    const key = String(o.table_number);
    const e = tableMap.get(key) || { table_number: key, revenue: 0, order_count: 0 };
    e.revenue += o.total || 0;
    e.order_count += 1;
    tableMap.set(key, e);
  }
  const tableBreakdown = [...tableMap.values()].sort((a, b) => b.revenue - a.revenue);

  // Item breakdown across paid orders only (what actually sold in this range).
  const itemMap = new Map();
  for (const o of paidOrders) {
    for (const it of o.items || []) {
      const key = it.item_id != null ? String(it.item_id) : it.name_ko || it.name_zh;
      const prev = itemMap.get(key) || { name_ko: it.name_ko, name_zh: it.name_zh, name_en: it.name_en, qty: 0, subtotal: 0 };
      prev.qty += it.qty;
      prev.subtotal += it.unit_price * it.qty;
      itemMap.set(key, prev);
    }
  }
  const itemBreakdown = [...itemMap.values()].sort((a, b) => b.subtotal - a.subtotal);

  /**
   * 한 개도 안 팔린 메뉴.
   *
   * 사장님(2026-09-11): "판매항목과 수량 보는 것만큼 판매되지 않은 항목도
   * 보였으면 좋겠어. 전혀 판매되지 않는 항목이 뭔지도 알 수 있도록."
   *
   * 위 itemBreakdown 은 팔린 것만 담는다 — 안 팔린 메뉴는 **목록에서 그냥
   * 사라진다.** 없는 줄은 눈에 안 띄므로, 사장님은 40개짜리 표를 다 읽고
   * 머릿속으로 메뉴판과 맞춰보기 전에는 무엇이 빠졌는지 알 수가 없다.
   * 그래서 빠진 쪽을 따로 세어서 같이 내려보낸다.
   *
   * 팔린 것을 가릴 때 쓰는 열쇠는 **item_id** 다. 이름으로 맞추면 메뉴
   * 이름을 고친 날 그 메뉴가 갑자기 「한 번도 안 팔린」 것이 된다.
   *
   * 메뉴를 안 넘겨주면(마감 스냅샷 등) null 이다 — 「하나도 안 팔렸다」가
   * 아니라 **모른다**는 뜻이고, 화면은 그때 이 칸을 아예 안 그린다.
   * 0 과 「모른다」를 같은 모양으로 보여주면 없는 사실을 지어내는 셈이다.
   */
  const menu = Array.isArray(opts.menu) ? opts.menu : null;
  let unsoldItems = null;
  if (menu) {
    const soldIds = new Set();
    for (const o of paidOrders) {
      for (const it of o.items || []) {
        if (it.item_id != null) soldIds.add(String(it.item_id));
      }
    }
    unsoldItems = menu.filter((m) => !soldIds.has(String(m.id)));
  }

  // Per-day revenue within the selected range, so a multi-day range can
  // still be charted as a trend rather than one flat total.
  const dayMap = new Map();
  for (const o of paidOrders) {
    const d = o.created_at.slice(0, 10);
    dayMap.set(d, (dayMap.get(d) || 0) + (o.total || 0));
  }
  const dailyBreakdown = [...dayMap.entries()]
    .map(([date, revenue]) => ({ date, revenue }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Hour-of-day breakdown (0-23), combined across every day in the range —
  // "몇 시에 손님이 많이 오는지" (order_count counts every order regardless
  // of status — arriving/ordering is arriving, whether or not it's been
  // paid yet) and "그 시간대엔 뭐가 잘 팔리는지" (top_items, paid orders
  // only, same convention as the item breakdown above).
  const hourMap = new Map();
  for (const o of rangeOrders) {
    const hour = parseInt(o.created_at.slice(11, 13), 10);
    const entry = hourMap.get(hour) || { hour, revenue: 0, order_count: 0, itemMap: new Map() };
    entry.order_count += 1;
    if (o.status === "paid") {
      entry.revenue += o.total || 0;
      for (const it of o.items || []) {
        const key = it.item_id != null ? String(it.item_id) : it.name_ko || it.name_zh;
        const prev = entry.itemMap.get(key) || { name_ko: it.name_ko, name_zh: it.name_zh, name_en: it.name_en, qty: 0 };
        prev.qty += it.qty;
        entry.itemMap.set(key, prev);
      }
    }
    hourMap.set(hour, entry);
  }
  const hourlyBreakdown = [...hourMap.values()]
    .map((e) => ({
      hour: e.hour,
      revenue: e.revenue,
      order_count: e.order_count,
      top_items: [...e.itemMap.values()]
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 3)
        .map((it) => ({ name_ko: it.name_ko, name_zh: it.name_zh, name_en: it.name_en, qty: it.qty })),
    }))
    .sort((a, b) => a.hour - b.hour);

  // 회전 시간 — 한 팀이 앉아 있던 시간(첫 주문 ~ 마지막 결제)의 평균.
  //
  // 묶는 기준은 손님 수와 똑같다(partyKeyOf). 예전에는 (테이블, 날짜)로
  // 묶어서 **점심 팀과 저녁 팀이 한 덩어리**가 됐고, 점심 첫 주문부터 저녁
  // 마지막 결제까지를 한 팀이 앉아 있던 시간으로 셌다. 2026-09-10 화면에
  // 뜬 「평균 337분」이 그것이다 — 다섯 시간 반을 앉아 계신 손님은 없다.
  //
  // 여전히 어림값이다. "손님이 앉았다/일어났다"는 사건이 데이터에 없어서,
  // 앉자마자 주문하지 않은 시간은 빠진다. 「대충 얼마나 걸리나」를 보는
  // 숫자이지 분 단위로 맞는 숫자가 아니다.
  const tableDayMap = new Map();
  for (const o of rangeOrders) {
    // 여기서는 halfByOrder 를 쓰지 않는다 — 그 표는 결제된 주문만 담고 있어서,
    // 아직 안 낸 주문이 같은 팀인데도 다른 열쇠로 갈라진다.
    const key = partyKeyOf(o, o.service_period);
    const entry = tableDayMap.get(key) || { minCreated: o.created_at, maxPaidUpdated: null };
    if (o.created_at < entry.minCreated) entry.minCreated = o.created_at;
    if (o.status === "paid" && (!entry.maxPaidUpdated || o.updated_at > entry.maxPaidUpdated)) {
      entry.maxPaidUpdated = o.updated_at;
    }
    tableDayMap.set(key, entry);
  }
  let turnoverSumMinutes = 0;
  let turnoverSamples = 0;
  for (const { minCreated, maxPaidUpdated } of tableDayMap.values()) {
    if (!maxPaidUpdated) continue;
    const minutes = (new Date(maxPaidUpdated.replace(" ", "T")) - new Date(minCreated.replace(" ", "T"))) / 60000;
    if (minutes >= 0) {
      turnoverSumMinutes += minutes;
      turnoverSamples += 1;
    }
  }
  const avgTurnoverMinutes = turnoverSamples > 0 ? Math.round(turnoverSumMinutes / turnoverSamples) : null;

  return {
    // `date` is only meaningful for a single-day query (start === end) —
    // POST /close and the cron job rely on this to key the saved snapshot.
    date: startDate === endDate ? startDate : null,
    start_date: startDate,
    end_date: endDate,
    // 이 보고서가 하루 전체인지, 오전만인지, 오후만인지. 화면이 큰 숫자 옆의
    // 표를 「합산 / 오전 / 오후」로 바꾸는 데 쓴다 — 무엇을 보고 있는지가
    // 화면에 안 적혀 있으면, 걸러놓은 것을 하루치로 읽게 된다.
    shift: shift,
    generated_at: new Date().toISOString(),
    total_revenue: totalRevenue,
    paid_order_count: paidOrders.length,
    cancelled_order_count: cancelledOrders.length,
    problem_order_count: problemOrders.length,
    item_breakdown: itemBreakdown,
    payment_method_breakdown: paymentMethodBreakdown,
    payment_method_total: paymentMethodTotal,
    order_type_breakdown: orderTypeBreakdown,
    category_breakdown: categoryBreakdown,
    discount_breakdown: discountBreakdown,
    discount_total: discountTotal,
    vip_card_program: vipCardProgram,
    // 할인 전 금액 — 매출 + 깎아준 돈. "원래 얼마짜리를 팔았나".
    gross_revenue: totalRevenue + discountTotal,
    guest_count: guestCount,
    // 어른·아이. 둘의 합은 언제나 guest_count 와 같다(splitParty 주석).
    adult_count: adultCount,
    child_count: childCount,
    // 오전/오후 (halfBoundaryFor 주석). 경계를 못 정한 날이 하나라도 있으면
    // 두 몫의 합이 위의 총계와 달라진다 — 화면이 그 말을 해야 한다.
    half_split: halfSplit,
    avg_per_order: avgPerOrder,
    avg_per_guest: avgPerGuest,
    cancelled_amount: cancelledAmount,
    problem_amount: problemAmount,
    table_breakdown: tableBreakdown,
    // 안 팔린 메뉴와, 그것을 세는 데 쓴 전체 메뉴 수 (위 unsoldItems 주석).
    // 둘 다 null 이면 「메뉴를 못 봐서 모른다」는 뜻이다.
    unsold_items: unsoldItems,
    menu_item_count: menu ? menu.length : null,
    daily_breakdown: dailyBreakdown,
    hourly_breakdown: hourlyBreakdown,
    avg_turnover_minutes: avgTurnoverMinutes,
    problem_orders: problemOrders
      .map((o) => ({
        id: o.id,
        table_number: o.table_number,
        status: o.status,
        created_at: o.created_at,
        total: o.total,
        items: (o.items || []).map((it) => ({ name_ko: it.name_ko, name_zh: it.name_zh, name_en: it.name_en, qty: it.qty })),
      }))
      .sort((a, b) => a.created_at.localeCompare(b.created_at)),
  };
}

module.exports = { computeSettlement, taipeiDateString, paidAtOf, halfBoundaryFor, halfOf };
