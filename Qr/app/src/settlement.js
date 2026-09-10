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
function computeSettlement(orders, startDate, endDate = startDate) {
  const rangeOrders = (orders || []).filter((o) => {
    const d = o.created_at.slice(0, 10);
    return d >= startDate && d <= endDate;
  });

  const paidOrders = rangeOrders.filter((o) => o.status === "paid");
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

  // 손님 수와 객단가. party_size 는 테이블에서 손님이 직접 답한 인원수이고,
  // 주문할 때 그 주문에 함께 찍힌다. 같은 테이블이 여러 번 주문하면 같은
  // 인원이 여러 번 세어지므로, (테이블, 날짜)마다 한 번만 센다 — 아래
  // 회전 시간 계산이 쓰는 것과 같은 묶음 기준이다.
  const partyByTableDay = new Map();
  for (const o of paidOrders) {
    if (!o.party_size) continue;
    const key = `${o.table_number}|${o.created_at.slice(0, 10)}`;
    // 한 자리에서 인원이 달라졌다면 큰 쪽을 쓴다(중간에 일행이 합류한 경우).
    partyByTableDay.set(key, Math.max(partyByTableDay.get(key) || 0, o.party_size));
  }
  const guestCount = [...partyByTableDay.values()].reduce((a, b) => a + b, 0);
  const avgPerOrder = paidOrders.length ? Math.round(totalRevenue / paidOrders.length) : 0;
  const avgPerGuest = guestCount ? Math.round(totalRevenue / guestCount) : 0;

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

  // Rough table-turnover estimate: for each (table, calendar day) that had
  // at least one paid order in range, minutes from its first order to its
  // last order being marked paid. This is an approximation — the data model
  // has no explicit "party seated/left" event, so a table that gets a second
  // unrelated party later the same day would still be treated as one block.
  // Good enough for a general "how long do tables usually take" read, not
  // meant to be exact to the second.
  const tableDayMap = new Map();
  for (const o of rangeOrders) {
    const day = o.created_at.slice(0, 10);
    const key = `${o.table_number}|${day}`;
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
    avg_per_order: avgPerOrder,
    avg_per_guest: avgPerGuest,
    cancelled_amount: cancelledAmount,
    problem_amount: problemAmount,
    table_breakdown: tableBreakdown,
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

module.exports = { computeSettlement, taipeiDateString };
