// 한 번의 결제를 여러 결제수단으로 나눠 낸다 (2026-10-18, src/splitTender.js).
//
// 사장님: "결제 할 때 고객들이 현금 특정 가격과 남은 건 카드로 결제하려고 할 때가 있대" →
// "현금만 그런 거 말고 여러개를 따로 해서 할 수 있게 해줄래?"
//
// 재는 것은 **서랍이 맞는가**다. 손님이 현금 1,000 · 카드 340 을 냈으면 결산의 현금 칸이 1,000,
// 카드 칸이 340 이어야 한다 — 라운드가 몇 개든, 할인이 있든, 나중에 돌려줬든.
const T = require("../src/splitTender");
const { computeSettlement } = require("../src/settlement");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}
const J = JSON.stringify;
const D = "2026-10-18";
const at = (t) => `${D} ${t}`;

out.push("[1] 화면이 보낸 값을 다듬는다");
{
  check("같은 수단은 합치고 0 원은 뺀다",
    J(T.normalizeTenders([{ method: "card", amount: 100 }, { method: "cash", amount: 0 }, { method: "card", amount: 40 }])) === J([{ method: "card", amount: 140 }]));
  check("화면 차례(현금 → LinePay → 카드)로 놓는다",
    J(T.normalizeTenders([{ method: "card", amount: 1 }, { method: "cash", amount: 2 }]).map((t) => t.method)) === J(["cash", "card"]));
  check("★ 모르는 수단은 통째로 거절", T.normalizeTenders([{ method: "bitcoin", amount: 5 }, { method: "cash", amount: 5 }]) === null);
  check("★ 음수·소수는 거절", T.normalizeTenders([{ method: "cash", amount: -5 }]) === null && T.normalizeTenders([{ method: "cash", amount: 1.5 }]) === null);
  check("다 0 이면 거절", T.normalizeTenders([{ method: "cash", amount: 0 }]) === null);
}

out.push("\n[2] 라운드마다 나눈다 — 앞 라운드부터 채운다");
{
  const a = T.allocate([{ method: "cash", amount: 1000 }, { method: "card", amount: 340 }], [800, 540]);
  check("★★ 800 · 540 → [현금 800] · [현금 200 + 카드 340]",
    J(a) === J([[{ method: "cash", amount: 800 }], [{ method: "cash", amount: 200 }, { method: "card", amount: 340 }]]), J(a));
  const neg = T.allocate([{ method: "cash", amount: 300 }, { method: "card", amount: 150 }], [-50, 500]);
  const sum = (m) => neg.flat().filter((t) => t.method === m).reduce((x, t) => x + t.amount, 0);
  check("★ 재량 할인으로 음수가 된 라운드가 있어도 수단마다의 합이 낸 돈 그대로", sum("cash") === 300 && sum("card") === 150, J(neg));
}

// 테이블 7 의 두 라운드를 한 번에, 현금 1,000 · 카드 340 으로 냈다.
const item = (name, price, qty, extra) => ({ item_id: 1, name_ko: name, unit_price: price, qty, category_key: "rice", paid: true, paid_at: at("13:00:00"), ...extra });
function paidPair(extra = {}) {
  const shares = T.allocate([{ method: "cash", amount: 1000 }, { method: "card", amount: 340 }], [800, 540]);
  return [
    { id: 1, table_number: "7", status: "paid", created_at: at("12:00:00"), updated_at: at("13:00:00"), total: 800, payment_method: "split",
      payment_ids: [9], split_tenders: [{ payment_id: 9, tenders: shares[0] }],
      items: [item("비빔밥", 400, 2, { payment_method: "split", split_id: 9 })], ...extra },
    { id: 2, table_number: "7", status: "paid", created_at: at("12:30:00"), updated_at: at("13:00:00"), total: 540, payment_method: "split",
      payment_ids: [9], split_tenders: [{ payment_id: 9, tenders: shares[1] }],
      items: [item("파전", 540, 1, { payment_method: "split", split_id: 9 })] },
  ];
}
const byMethod = (s) => Object.fromEntries((s.payment_method_breakdown || []).map((e) => [e.method, e.revenue]));

out.push("\n[3] 결산 — 서랍이 맞는다");
{
  const s = computeSettlement(paidPair(), D);
  const m = byMethod(s);
  check("★★ 현금 칸은 1,000", m.cash === 1000, J(m));
  check("★★ 카드 칸은 340", m.card === 340, J(m));
  check("★ 「split」이라는 칸은 안 생긴다", !Object.keys(m).some((k) => k.startsWith("split")) && !("unspecified" in m), J(m));
  check("결제수단 총합 = 매출", s.payment_method_total === s.total_revenue && s.total_revenue === 1340, `${s.payment_method_total} / ${s.total_revenue}`);
}

out.push("\n[4] 할인이 있으면 — 손님이 낸 금액이 할인 뒤 금액이다");
{
  // 재량 할인 100 이 첫 라운드에 적혔다 → 낼 돈 1,240 = 현금 1,000 + 카드 240
  const shares = T.allocate([{ method: "cash", amount: 1000 }, { method: "card", amount: 240 }], [700, 540]);
  const [a, b] = paidPair();
  a.discount_amount = 100;
  a.split_tenders = [{ payment_id: 9, tenders: shares[0] }];
  b.split_tenders = [{ payment_id: 9, tenders: shares[1] }];
  const m = byMethod(computeSettlement([a, b], D));
  check("★★ 현금 1,000 · 카드 240", m.cash === 1000 && m.card === 240, J(m));
}

out.push("\n[5] 나중에 돌려주면 돌려준 수단에서 뺀다");
{
  const [a, b] = paidPair();
  b.refunds = [{ method: "cash", amount: 200, lines: [] }];
  b.refund_total = 200;
  const m = byMethod(computeSettlement([a, b], D));
  check("★ 현금 800 · 카드 340", m.cash === 800 && m.card === 340, J(m));
}

out.push("\n[6] 품목 일부는 따로(현금) 내고 나머지를 나눠 냈다");
{
  const shares = T.allocate([{ method: "linepay", amount: 300 }, { method: "card", amount: 240 }], [540]);
  const o = { id: 3, table_number: "8", status: "paid", created_at: at("12:00:00"), updated_at: at("13:00:00"), total: 940, payment_method: "split",
    split_tenders: [{ payment_id: 11, tenders: shares[0] }],
    items: [item("비빔밥", 400, 1, { payment_method: "cash" }), item("파전", 540, 1, { payment_method: "split", split_id: 11 })] };
  const m = byMethod(computeSettlement([o], D));
  check("★ 현금 400 · LinePay 300 · 카드 240", m.cash === 400 && m.linepay === 300 && m.card === 240, J(m));
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
