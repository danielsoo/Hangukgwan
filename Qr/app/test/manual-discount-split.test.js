// 한 테이블을 여러 라운드로 나눠 결제할 때, 재량 할인이 정확히 그 금액만
// 깎이는가.
//
// 2026-09-16 사장님: "한 테이블 전체 결제할 때 예를 들어 직접 입력으로
// 10달러를 할인 했어. 그럼 한 테이블에서 총 3번을 주문했어 그럼 그게 3개로
// 나뉘어서 들어가 아니면 그냥 전체 액수에서 까여?"
//
// **나뉘어 들어간다.** 서버는 라운드마다 따로 계산하므로
// (splitPayOrderItems 가 라운드 수만큼 호출된다), 10원을 그대로 세 번 보내면
// 30원이 깎인다. 그래서 라운드 크기에 비례해 쪼개서 보낸다.
//
// ── 오늘 실제로 깨져 있었다 ────────────────────────────────────────────
//
// 예전 방법은 정액을 **퍼센트로 환산**해서 보내는 것이었다. 같은 날 소수점을
// 전부 내림으로 바꾸면서(사장님: "소숫점은 그냥 다 내림으로 하려고 해") 그
// 환산이 깨졌다 — 내림은 라운드마다 올라가는 쪽으로 어긋난다.
//
//   690 + 500 + 310 = 1,500 에 정액 10원
//     반올림이던 때   5 + 3 + 2 = 10   (맞음)
//     내림으로 바꾼 뒤  5 + 4 + 3 = 12   (2원 더 깎임)
//
// 퍼센트를 직접 입력해도 같다 — 7% 면 화면은 105 인데 실제로는 107 이 깎였다.
//
// 이제 환산하지 않는다. 화면에 보여준 총 할인액을 **정수로 쪼개서** 각
// 라운드에 그 금액을 그대로 보낸다. 쪼갠 것들의 합은 언제나 원래 금액과 같다.
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

// 쪼개는 함수를 파일에서 꺼내 실제로 돌린다.
const fnSrc = slice(admin, "  function splitManualAmountAcross(totalAmount, selections, discountType) {", "\n  }\n") + "\n  }";
check("쪼개는 함수를 찾았다", fnSrc.length > 300, `${fnSrc.length}`);
const splitWith = (bases) =>
  new Function(
    "fullEligibleClientTotal", "vipDiscountClientTotal",
    `${fnSrc}\n return splitManualAmountAcross;`
  )(
    (order) => bases[order.i],
    () => 0
  );
const split = (total, bases) => splitWith(bases)(total, bases.map((_, i) => ({ order: { i }, indexes: null })), null);

const noDrink = () => false;
const roundsOf = (bases) => bases.map((p) => [{ unit_price: p, qty: 1 }]);
/** 쪼갠 금액을 서버가 라운드마다 따로 계산했을 때 실제로 깎이는 총액. */
const chargedOff = (bases, shares) =>
  roundsOf(bases).reduce(
    (sum, items, i) =>
      sum +
      (shares[i] > 0
        ? computeDiscountAmount(null, { mode: "amount", value: shares[i] }, items, null, noDrink).manualAmount
        : 0),
    0
  );

out.push("[사장님 예: 라운드 3개, 정액 10원]");
{
  const bases = [690, 500, 310];
  const shares = split(10, bases);
  check("★ 세 라운드로 나뉜다", shares.length === 3, JSON.stringify(shares));
  check("★ 쪼갠 합이 정확히 10", shares.reduce((a, b) => a + b, 0) === 10, JSON.stringify(shares));
  check(
    "★ 서버가 따로 계산해도 딱 10원 깎인다",
    chargedOff(bases, shares) === 10,
    `${chargedOff(bases, shares)} — 예전 방법은 12원이었다`
  );
  check("큰 라운드가 더 많이 낸다", shares[0] >= shares[1] && shares[1] >= shares[2], JSON.stringify(shares));
}

out.push("\n[여러 모양으로 — 합이 언제나 맞는가]");
{
  const CASES = [
    { bases: [690, 500, 310], want: 10 },
    { bases: [690, 500, 310], want: 105 },  // 7% 자리 — 예전에 107 이 깎였다
    { bases: [690, 500, 310], want: 75 },   // 5% 자리
    { bases: [1000, 1, 1], want: 3 },       // 아주 작은 라운드가 섞였을 때
    { bases: [333, 333, 334], want: 100 },  // 딱 안 나눠떨어지는
    { bases: [100, 200], want: 1 },         // 1원을 둘로
    { bases: [100, 200, 300, 400, 500], want: 37 },
    { bases: [50, 50], want: 200 },         // 금액보다 큰 할인 — 전부 깎이고 멈춘다
    { bases: [0, 500], want: 20 },          // 한 라운드가 0원
  ];
  for (const c of CASES) {
    const shares = split(c.want, c.bases);
    const sum = shares.reduce((a, b) => a + b, 0);
    const cap = Math.min(c.want, c.bases.reduce((a, b) => a + b, 0));
    check(
      `★ [${c.bases.join("+")}] 에 ${c.want} → ${shares.join("+")} = ${sum}`,
      sum === cap,
      `합이 ${sum}, 기대 ${cap}`
    );
    check(
      `   서버가 따로 계산해도 같다`,
      chargedOff(c.bases, shares) === cap,
      `${chargedOff(c.bases, shares)} vs ${cap}`
    );
    check(`   어느 라운드도 자기 금액보다 많이 안 깎인다`, shares.every((v, i) => v <= c.bases[i]), JSON.stringify(shares));
    check(`   음수가 없다`, shares.every((v) => v >= 0), JSON.stringify(shares));
  }
}

out.push("\n[퍼센트로 환산하던 옛 방법은 사라졌다]");
check(
  "★ 퍼센트 환산이 코드에서 없다",
  !/mode: "percent", value: Math\.min\(100, \(breakdown\.manualAmount/.test(admin),
  "내림으로 바뀐 뒤 그 환산은 라운드마다 올라가는 쪽으로 어긋난다"
);
const payBlock = slice(admin, "          const manualShares =", "\n          if (results.some");
check("쪼갠 금액을 보낸다", /splitManualAmountAcross\(breakdown\.manualAmount, selections, discountType\)/.test(payBlock), payBlock.slice(0, 120));
check(
  "★ 화면에 보여준 총액을 쪼갠다",
  /breakdown\.manualAmount/.test(payBlock),
  "사장님이 손님에게 부른 숫자가 그것이다 — 다시 계산하면 또 갈린다"
);
check("라운드가 하나면 예전 그대로 보낸다", /: manualValue$/m.test(payBlock), payBlock.slice(-160));
check(
  "몫이 0인 라운드에는 할인을 안 보낸다",
  /manualShares\[i\] > 0 \? \{ mode: "amount", value: manualShares\[i\] \} : null/.test(payBlock),
  ""
);

out.push("\n[VIP 할인과 같이 걸었을 때도]");
{
  // 재량 할인의 기준은 VIP 를 뺀 뒤 남은 금액이다(computeDiscountAmount 의
  // afterVip). 쪼갤 때도 그 기준을 써야 한다.
  const body = fnSrc;
  check(
    "★ VIP 를 뺀 금액에 비례해 쪼갠다",
    /fullEligibleClientTotal\(x\.order, x\.indexes\) - vipDiscountClientTotal\(x\.order, x\.indexes, discountType\)/.test(body),
    "전체 금액으로 쪼개면 VIP 가 많이 걸린 라운드가 자기 몫보다 많이 낸다"
  );
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
