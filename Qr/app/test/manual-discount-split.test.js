// 한 테이블을 여러 라운드로 나눠 결제할 때, 재량 할인이 **한 번만**, 정확히
// 그 금액만 깎이는가.
//
// 2026-09-16 사장님, 두 번에 걸쳐:
//   "한 테이블 전체 결제할 때 예를 들어 직접 입력으로 10달러를 할인 했어.
//    그럼 한 테이블에서 총 3번을 주문했어 그럼 그게 3개로 나뉘어서 들어가
//    아니면 그냥 전체 액수에서 까여?"
//   → "직접 입력은 무조건 총 금액에서 빼줘. 퍼센트인던 금액이던. 주문별로
//      나눠서 빼지말고."
//
// 깎는 금액은 테이블 전체에서 **한 번** 정한다(화면에 뜬 그 숫자). 여기서
// 재는 것은 그 한 덩어리가 어디에 적히는가다.
//
// ── 왜 적어두는 자리가 문제가 되나 ────────────────────────────────────
//
// 서버는 주문마다 할인을 기록하고, 결제도 라운드마다 따로 돈다
// (splitPayOrderItems 가 라운드 수만큼 호출된다). 10원을 그대로 세 번 보내면
// **30원이 깎인다**(2026-09-07 에 실제로 있던 버그).
//
// ── 오늘 두 번 틀렸다 ─────────────────────────────────────────────────
//
// 1) 정액을 **퍼센트로 환산**해서 보내고 있었다. 반올림이던 때는 맞았는데,
//    같은 날 소수점을 전부 내림으로 바꾸면서 깨졌다 — 내림은 라운드마다
//    올라가는 쪽으로만 어긋난다.
//      690 + 500 + 310 = 1,500 에 정액 10원
//        반올림이던 때   5 + 3 + 2 = 10   (맞음)
//        내림으로 바꾼 뒤  5 + 4 + 3 = 12   (2원 더 깎임)
//    퍼센트를 직접 쳐도 같았다 — 7% 면 화면 105, 실제 107.
//
// 2) 그래서 **라운드 금액에 비례해 쪼갰다.** 합은 맞았지만, 사장님이 10원을
//    한 번 넣고 「직접 입력 -5 / -3 / -2」 세 줄을 보게 됐다. 손님에게 부른
//    숫자가 어디에도 그대로 안 적혀 있었다.
//
// 이제 **한 라운드에 통째로** 적는다.
const fs = require("fs");
const path = require("path");
const { computeDiscountAmount } = require("../src/discounts");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const admin = fs.readFileSync(path.join(__dirname, "../public/js/admin.js"), "utf8");
const slice = (src, header, end) => {
  const i = src.indexOf(header);
  return i < 0 ? "" : src.slice(i, src.indexOf(end, i));
};

// 적어둘 자리를 정하는 함수를 파일에서 꺼내 실제로 돌린다.
const fnSrc =
  slice(admin, "  function assignManualAmountToRounds(totalAmount, selections, discountType) {", "\n  }\n") + "\n  }";
check("함수를 찾았다", fnSrc.length > 300, `${fnSrc.length}`);
const assign = (total, bases) =>
  new Function(
    "fullEligibleClientTotal", "vipDiscountClientTotal",
    `${fnSrc}\n return assignManualAmountToRounds;`
  )((order) => bases[order.i], () => 0)(
    total,
    bases.map((_, i) => ({ order: { i }, indexes: null })),
    null
  );

const noDrink = () => false;
const roundsOf = (bases) => bases.map((p) => [{ unit_price: p, qty: 1 }]);
/** 적어둔 금액을 서버가 라운드마다 따로 계산했을 때 실제로 깎이는 총액. */
const chargedOff = (bases, shares) =>
  roundsOf(bases).reduce(
    (sum, items, i) =>
      sum +
      (shares[i] > 0
        ? computeDiscountAmount(null, { mode: "amount", value: shares[i] }, items, null, noDrink).manualAmount
        : 0),
    0
  );
const nonZero = (shares) => shares.filter((v) => v > 0).length;

out.push("[사장님 예: 라운드 3개, 직접 입력 10원]");
{
  const bases = [690, 500, 310];
  const shares = assign(10, bases);
  check("★ 한 라운드에만 적힌다 — 쪼개지 않는다", nonZero(shares) === 1, JSON.stringify(shares));
  check("★ 그 한 자리에 10원이 통째로", Math.max(...shares) === 10, JSON.stringify(shares));
  check("★ 실제로 깎이는 돈도 딱 10원", chargedOff(bases, shares) === 10, `${chargedOff(bases, shares)}`);
  check("가장 큰 라운드에 적힌다", shares[0] === 10, JSON.stringify(shares));
}

out.push("\n[퍼센트로 넣어도 같다 — 화면에 뜬 금액이 통째로]");
{
  // 화면(tableDiscountFor)이 테이블 전체에서 한 번 계산한 금액이 들어온다.
  // 7% 자리(105), 5% 자리(75) — 예전에는 여기서 107, 76 이 깎였다.
  for (const want of [105, 75, 150]) {
    const bases = [690, 500, 310];
    const shares = assign(want, bases);
    check(
      `★ ${want}원이 한 자리에 통째로 (${shares.join("+")})`,
      nonZero(shares) === 1 && Math.max(...shares) === want,
      JSON.stringify(shares)
    );
    check(`   실제로 깎이는 돈도 ${want}`, chargedOff(bases, shares) === want, `${chargedOff(bases, shares)}`);
  }
}

out.push("\n[안 들어갈 때만 다음 라운드로 넘긴다]");
{
  // 한 라운드에 다 못 담으면 넘겨야 한다 — 안 넘기면 서버가 잘라내서
  // 그만큼 조용히 덜 깎인다.
  const CASES = [
    { bases: [100, 200, 300], want: 350, why: "가장 큰 300 에 다 못 담는다" },
    { bases: [50, 50], want: 200, why: "테이블 전체보다 큰 할인 — 전부 깎이고 멈춘다" },
    { bases: [0, 500], want: 20, why: "0원짜리 라운드는 건너뛴다" },
    { bases: [1000, 1, 1], want: 3, why: "아주 작은 라운드가 섞였을 때" },
    { bases: [333, 333, 334], want: 100, why: "딱 안 나눠떨어지는" },
    { bases: [100, 200], want: 1, why: "1원" },
  ];
  for (const c of CASES) {
    const shares = assign(c.want, c.bases);
    const sum = shares.reduce((a, b) => a + b, 0);
    const cap = Math.min(c.want, c.bases.reduce((a, b) => a + b, 0));
    check(`★ [${c.bases.join("+")}] 에 ${c.want} → ${shares.join("+")}  (${c.why})`, sum === cap, `합 ${sum}, 기대 ${cap}`);
    check(`   서버가 따로 계산해도 같다`, chargedOff(c.bases, shares) === cap, `${chargedOff(c.bases, shares)} vs ${cap}`);
    check(`   어느 라운드도 자기 금액보다 많이 안 깎인다`, shares.every((v, i) => v <= c.bases[i]), JSON.stringify(shares));
    check(`   음수가 없다`, shares.every((v) => v >= 0), JSON.stringify(shares));
  }
  check(
    "★ 들어가는 만큼은 한 자리로 끝낸다",
    nonZero(assign(300, [100, 200, 300])) === 1,
    JSON.stringify(assign(300, [100, 200, 300]))
  );
  check(
    "★ 넘길 때도 자리 수를 최소로",
    nonZero(assign(350, [100, 200, 300])) === 2,
    JSON.stringify(assign(350, [100, 200, 300]))
  );
}

out.push("\n[매번 같은 답이 나온다]");
{
  const bases = [300, 300, 300];
  const a = assign(50, bases);
  const b = assign(50, bases);
  check("★ 같은 입력에 같은 답", JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  check("금액이 같으면 앞선 라운드부터", a[0] === 50, JSON.stringify(a));
}

out.push("\n[옛 방법들이 사라졌다]");
check(
  "★ 퍼센트 환산이 없다",
  !/mode: "percent", value: Math\.min\(100, \(breakdown\.manualAmount/.test(admin),
  "내림으로 바뀐 뒤 그 환산은 라운드마다 올라가는 쪽으로 어긋난다"
);
check("★ 비례로 쪼개던 것도 없다", !/splitManualAmountAcross/.test(admin), "사장님: 주문별로 나눠서 빼지말고");
const payBlock = slice(admin, "          const manualShares =", "\n          if (results.some");
check(
  "한 라운드에 통째로 적는 함수를 쓴다",
  /assignManualAmountToRounds\(breakdown\.manualAmount, selections, discountType\)/.test(payBlock),
  payBlock.slice(0, 160)
);
check(
  "★ 화면에 보여준 총액을 그대로 쓴다",
  /breakdown\.manualAmount/.test(payBlock),
  "사장님이 손님에게 부른 숫자가 그것이다 — 다시 계산하면 또 갈린다"
);
check("라운드가 하나면 예전 그대로 보낸다", /: manualValue$/m.test(payBlock), payBlock.slice(-160));
check(
  "몫이 0인 라운드에는 할인을 안 보낸다",
  /manualShares\[i\] > 0 \? \{ mode: "amount", value: manualShares\[i\] \} : null/.test(payBlock),
  ""
);
check(
  "★ VIP 를 뺀 금액을 담을 수 있는 양으로 본다",
  /fullEligibleClientTotal\(x\.order, x\.indexes\) - vipDiscountClientTotal\(x\.order, x\.indexes, discountType\)/.test(fnSrc),
  "전체 금액으로 재면 VIP 가 많이 걸린 라운드에 안 들어갈 금액을 적게 된다"
);

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
