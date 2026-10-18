// 한 번의 결제를 여러 결제수단으로 나눠 낸다 (2026-10-18).
//
// 사장님: "결제 할 때 고객들이 현금 특정 가격과 남은 건 카드로 결제하려고 할 때가 있대" →
// "현금만 그런 거 말고 여러개를 따로 해서 할 수 있게 해줄래?"
//
// 결제수단은 원래 **품목마다** 붙는다(2026-09-07). 그래서 「품목을 골라 이건 현금, 저건 카드」는
// 됐지만 「현금 1,000 · 나머지 카드」처럼 **금액으로** 나누는 것은 안 됐다 — 금액이 품목 경계에
// 맞지 않으면 한 품목이 두 수단에 걸친다.
//
// 그래서 나눠 낸 품목은 payment_method 를 "split" 으로, 이번 결제 번호를 split_id 로 적고, 주문에는
// 그 결제에서 **이 주문 몫**이 수단마다 얼마였는지를 남긴다:
//
//   order.split_tenders = [{ payment_id, tenders: [{ method: "cash", amount: 800 }] }, ...]
//
// 결산(src/settlement.js)은 "split" 품목 몫을 이 금액 비율대로 수단마다 나눠 센다 — 그래야 밤에
// 서랍의 현금이 맞는다. 한 결제가 라운드 여러 개를 덮으면 금액을 앞 라운드부터 채워 나눈다
// (allocate). 그러면 수단마다의 합이 손님이 실제로 낸 금액과 한 원도 안 어긋난다.

const METHODS = ["cash", "linepay", "card", "other"];

/**
 * 화면이 보낸 나눠 내기를 고르고 다듬는다. 같은 수단은 합치고, 0 원은 뺀다.
 * 잘못된 것이 하나라도 있으면 null — 돈이 걸린 일이라 「반만 맞는」 것을 받지 않는다.
 */
function normalizeTenders(raw) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 8) return null;
  const sum = new Map();
  for (const t of raw) {
    if (!t || !METHODS.includes(t.method)) return null;
    const amount = Number(t.amount);
    if (!Number.isInteger(amount) || amount < 0) return null;
    if (amount === 0) continue;
    sum.set(t.method, (sum.get(t.method) || 0) + amount);
  }
  // 화면에 보이던 차례(현금 → LinePay → 카드 → 기타)대로 둔다 — 영수증에도 그 차례로 찍힌다.
  const out = METHODS.filter((m) => sum.has(m)).map((m) => ({ method: m, amount: sum.get(m) }));
  return out.length ? out : null;
}

const totalOf = (tenders) => (tenders || []).reduce((a, t) => a + (Number(t.amount) || 0), 0);

/**
 * 결제 한 번의 금액을 라운드마다 나눈다. dues[i] = i 번째 라운드가 이번에 낼 돈.
 * 앞 라운드부터 첫 수단으로 채우고, 모자라면 다음 수단으로 — 나눗셈이 없으니 반올림도 없다.
 * 돌려주는 것은 라운드마다 [{ method, amount }] (0 원은 뺀다).
 *
 * 낼 돈이 **음수**인 라운드가 있을 수 있다 — 재량 할인은 쪼개지 않고 라운드 하나에 통째로 적혀서
 * (src/discounts.js computeTableDiscount) 그 라운드 금액보다 클 때가 있다. 그 라운드에는 첫 수단으로
 * 음수 몫을 적고, 그만큼을 그 수단 쪽에 되돌려 다른 라운드가 쓰게 한다. 음수 라운드를 먼저
 * 처리해야 앞 라운드들이 모자라지 않는다. 그래서 수단마다의 합은 언제나 손님이 낸 금액 그대로다.
 */
function allocate(tenders, dues) {
  const left = tenders.map((t) => ({ method: t.method, amount: t.amount }));
  const out = dues.map(() => []);
  const order = dues.map((d, i) => i).sort((a, b) => (Number(dues[a]) < 0 ? 0 : 1) - (Number(dues[b]) < 0 ? 0 : 1));
  let k = 0;
  for (const i of order) {
    let need = Number(dues[i]) || 0;
    if (need < 0) {
      if (!left.length) continue;
      left[0].amount += -need;
      out[i] = [{ method: left[0].method, amount: need }];
      continue;
    }
    const mine = new Map();
    while (need > 0 && k < left.length) {
      const take = Math.min(need, left[k].amount);
      if (take > 0) mine.set(left[k].method, (mine.get(left[k].method) || 0) + take);
      left[k].amount -= take;
      need -= take;
      if (left[k].amount === 0) k += 1;
    }
    out[i] = [...mine.entries()].map(([method, amount]) => ({ method, amount }));
  }
  return out;
}

/** 이 주문이 결제 paymentId 에서 수단마다 낸 몫. 없으면 null. */
function tendersFor(order, paymentId) {
  const rec = (order && Array.isArray(order.split_tenders) ? order.split_tenders : []).find(
    (r) => String(r.payment_id) === String(paymentId)
  );
  return rec && Array.isArray(rec.tenders) && rec.tenders.length ? rec.tenders : null;
}

/** 주문에 남은 나눠 내기를 수단마다 더한 것 — 영수증·지난 주문 표시용. */
function tendersOfOrder(order) {
  const sum = new Map();
  for (const r of (order && order.split_tenders) || []) {
    for (const t of r.tenders || []) sum.set(t.method, (sum.get(t.method) || 0) + (Number(t.amount) || 0));
  }
  return METHODS.filter((m) => sum.has(m)).map((m) => ({ method: m, amount: sum.get(m) }));
}

module.exports = { METHODS, normalizeTenders, totalOf, allocate, tendersFor, tendersOfOrder };
