// 한 테이블을 여러 라운드로 나눠 주문했어도, 재량 할인은 **계산서 한 장**에
// 한 번만 걸리는가.
//
// 2026-09-16 사장님, 세 번에 걸쳐:
//   "한 테이블 전체 결제할 때 예를 들어 직접 입력으로 10달러를 할인 했어.
//    그럼 한 테이블에서 총 3번을 주문했어 그럼 그게 3개로 나뉘어서 들어가
//    아니면 그냥 전체 액수에서 까여?"
//   → "직접 입력은 무조건 총 금액에서 빼줘. 퍼센트인던 금액이던. 주문별로
//      나눠서 빼지말고."
//   → "아니 한 손님이라면 그냥 전체 가격에서 까면 된다니까? 이해가 안돼?"
//
// ── 세 번 틀렸고, 세 번 다 같은 뿌리였다 ──────────────────────────────
//
// 문제는 산수가 아니라 이 결제가 서버에 도착하는 **모양**이었다. 테이블
// 결제 버튼 하나가 라운드 수만큼의 요청으로 쪼개져 나갔고, 서버는 매번
// 주문 한 건만 봤다. 「이 테이블의 전체 금액」이라는 것을 볼 기회가 아예
// 없었다. 그래서 화면이 그 자리를 대신 메우려고 했다 —
//
//   1) 정액을 **퍼센트로 환산**해서 보냈다. 반올림이던 때는 맞았는데 같은
//      날 소수점을 전부 내림으로 바꾸면서 깨졌다. 내림은 라운드마다
//      올라가는 쪽으로만 어긋난다.
//        690 + 500 + 310 = 1,500 에 정액 10원
//          반올림이던 때    5 + 3 + 2 = 10   (맞음)
//          내림으로 바꾼 뒤  5 + 4 + 3 = 12   (2원 더 깎임)
//   2) 그래서 **라운드에 비례해 쪼갰다.** 합은 맞았지만 사장님이 10원을 한
//      번 넣고 「직접 입력 -5 / -3 / -2」 세 줄을 보게 됐다.
//   3) 그래서 **한 라운드에 통째로** 적었다. 이번에는 할인이 그 라운드
//      금액보다 크면 다음 라운드로 넘어가 또 쪼개졌다.
//
// 편법을 또 고치는 대신 편법이 필요했던 이유를 없앴다. 결제는 이제 요청
// 하나고(POST /api/orders/pay-table), 재량 할인은 테이블 총액을 기준으로
// 딱 한 번 계산된다(computeTableDiscount). 이 파일이 재는 것이 그것이다.
const fs = require("fs");
const path = require("path");
const { computeTableDiscount, computeDiscountAmount } = require("../src/discounts");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const noDrink = () => false;
/** 라운드 금액 목록 → computeTableDiscount 가 받는 모양. */
const lots = (amounts) => amounts.map((p) => ({ items: [{ unit_price: p, qty: 1 }], indexes: null }));
const amount = (v) => ({ mode: "amount", value: v });
const percent = (v) => ({ mode: "percent", value: v });

out.push("[기준은 계산서 한 장 — 라운드가 몇 개든 상관없다]");
{
  const three = computeTableDiscount(null, amount(10), lots([690, 500, 310]), noDrink);
  const one = computeTableDiscount(null, amount(10), lots([1500]), noDrink);
  check("★ 10원을 넣으면 10원이 깎인다", three.manualAmount === 10, `${three.manualAmount}`);
  check("★ 라운드로 나눠 주문했어도 같다", three.manualAmount === one.manualAmount, `${three.manualAmount} vs ${one.manualAmount}`);
  check("★ 내림이 라운드마다 누적되지 않는다 (옛 버그: 5+4+3=12)", three.manualAmount !== 12, `${three.manualAmount}`);
  check("깎을 수 있는 돈은 테이블 전체다", three.afterVip === 1500, `${three.afterVip}`);
}

out.push("\n[쪼개지지 않는다]");
{
  const r = computeTableDiscount(null, amount(10), lots([690, 500, 310]), noDrink);
  const nonZero = r.manualParts.filter((x) => x > 0);
  check("★ 적히는 자리는 한 곳뿐", nonZero.length === 1, JSON.stringify(r.manualParts));
  check("★ 그 한 곳에 통째로", nonZero[0] === 10, JSON.stringify(r.manualParts));
  check("가장 큰 라운드에 적는다", r.carrier === 0, `${r.carrier}`);
  check("합은 언제나 맞는다", r.manualParts.reduce((a, b) => a + b, 0) === r.manualAmount, "");
}
{
  // 옛 방식이 쪼개지던 바로 그 경우 — 할인이 어느 라운드보다도 크다.
  const r = computeTableDiscount(null, amount(400), lots([300, 200, 100]), noDrink);
  const nonZero = r.manualParts.filter((x) => x > 0);
  check("★ 할인이 라운드보다 커도 쪼개지지 않는다", nonZero.length === 1, JSON.stringify(r.manualParts));
  check("★ 깎이는 금액은 그대로 400", r.manualAmount === 400, `${r.manualAmount}`);
  check("자르지 않는다 (옛 방식은 300 으로 잘렸다)", r.manualParts[0] === 400, JSON.stringify(r.manualParts));
}

out.push("\n[계산서 한 장보다 많이는 못 깎는다]");
{
  const r = computeTableDiscount(null, amount(9999), lots([300, 200, 100]), noDrink);
  check("★ 테이블 총액에서 자른다", r.manualAmount === 600, `${r.manualAmount}`);
  check("손님이 낼 돈이 음수가 되지 않는다", r.afterVip - r.manualAmount === 0, "");
}

out.push("\n[퍼센트도 계산서 한 장 기준으로 한 번만]");
{
  const r = computeTableDiscount(null, percent(7), lots([690, 500, 310]), noDrink);
  // 1500 의 93% = 1395 (내림) → 깎이는 돈 105. 라운드마다 돌리면 107 이었다.
  check("★ 7% 는 105 다", r.manualAmount === 105, `${r.manualAmount}`);
  check("★ 라운드마다 돌린 옛 값(107)이 아니다", r.manualAmount !== 107, `${r.manualAmount}`);
  const one = computeTableDiscount(null, percent(7), lots([1500]), noDrink);
  check("라운드로 나눠도 같다", r.manualAmount === one.manualAmount, "");
  check("퍼센트도 한 곳에만 적힌다", r.manualParts.filter((x) => x > 0).length === 1, JSON.stringify(r.manualParts));
}

out.push("\n[特約95折/VIP9折 는 손대지 않았다]");
// 사장님(2026-09-16): "직접 입력으로 할인 해주는 거 제외하고 할인들은 냅둬."
{
  const amounts = [690, 500, 310];
  const r = computeTableDiscount("te95", null, lots(amounts), noDrink);
  const perRound = amounts
    .map((p) => computeDiscountAmount("te95", null, [{ unit_price: p, qty: 1 }], null, noDrink).vipAmount)
    .reduce((a, b) => a + b, 0);
  check("★ 라운드별로 계산해 더한 값과 같다", r.vipAmount === perRound, `${r.vipAmount} vs ${perRound}`);
  check("라운드마다 제 몫이 적힌다", r.vipParts.length === 3 && r.vipParts.every((x) => x > 0), JSON.stringify(r.vipParts));
}
{
  // 둘을 같이 걸면 재량 할인의 기준은 「VIP 를 뺀 뒤 남은 돈」이다.
  const r = computeTableDiscount("te95", amount(10), lots([690, 500, 310]), noDrink);
  check("★ 재량 할인의 기준이 VIP 를 뺀 뒤다", r.afterVip === 1500 - r.vipAmount, `${r.afterVip}`);
  check("재량 할인은 여전히 한 덩어리", r.manualParts.filter((x) => x > 0).length === 1, JSON.stringify(r.manualParts));
  check("총 할인은 둘을 더한 값", r.total === r.vipAmount + r.manualAmount, "");
}

out.push("\n[매번 같은 답이 나온다]");
{
  const a = computeTableDiscount(null, amount(50), lots([300, 300, 300]), noDrink);
  const b = computeTableDiscount(null, amount(50), lots([300, 300, 300]), noDrink);
  check("★ 같은 입력에 같은 답", JSON.stringify(a.manualParts) === JSON.stringify(b.manualParts), "");
  check("금액이 같으면 앞선 라운드에", a.carrier === 0, `${a.carrier}`);
}

out.push("\n[할인을 안 걸면 아무 일도 없다]");
{
  const r = computeTableDiscount(null, null, lots([690, 500, 310]), noDrink);
  check("깎이는 돈이 0", r.total === 0 && r.manualAmount === 0, "");
  check("적히는 자리도 없다", r.manualParts.every((x) => x === 0), JSON.stringify(r.manualParts));
}

out.push("\n[서버가 테이블 전체를 한 번에 받는다]");
{
  const orders = fs.readFileSync(path.join(__dirname, "../src/routes/orders.js"), "utf8");
  check("★ 라우트가 있다", /router\.post\("\/pay-table"/.test(orders), "");
  check("★ 테이블 전체로 계산한다", /computeTableDiscount\(/.test(orders), "");
  check(
    "★ 결제 한 번에 이름표 하나",
    /reserveId\("table_payments"\)/.test(orders) && /order\.payment_ids = \[/.test(orders),
    "라운드를 다시 묶을 수 있는 유일한 근거다"
  );
  check(
    "★ 하나라도 결제할 수 없으면 아무것도 건드리지 않는다",
    orders.indexOf("picked.push({ order, selectedIdx })") < orders.indexOf("const paymentId = await reserveId"),
    "반만 결제된 테이블이 남는 것이 제일 나쁘다"
  );
  check("★ 섞인 테이블은 거절한다", /mixed_tables/.test(orders), "「전체 금액」이 무엇인지부터 말이 안 된다");
}

out.push("\n[화면은 더 이상 아무것도 나누지 않는다]");
{
  const admin = fs.readFileSync(path.join(__dirname, "../public/js/admin.js"), "utf8");
  check("★ 요청 하나로 보낸다", /payTableOrders\(selections, method, discountType, manualValue\)/.test(admin), "");
  check("★ 라운드에 배분하던 함수가 사라졌다", !/assignManualAmountToRounds/.test(admin), "사장님: 주문별로 나눠서 빼지말고");
  check("★ 비례로 쪼개던 것도 없다", !/splitManualAmountAcross/.test(admin), "");
  check(
    "★ 퍼센트 환산이 없다",
    !/mode: "percent", value: Math\.min\(100, \(breakdown\.manualAmount/.test(admin),
    "내림으로 바뀐 뒤 그 환산은 라운드마다 올라가는 쪽으로 어긋난다"
  );
  check("★ 사장님이 입력한 값을 그대로 넘긴다", /reqBody\.manualDiscountValue = manualDiscountValue\.value;/.test(admin), "");
  check("실패하면 전부 실패다", /results: selections\.map\(\(\) => \(\{ ok: false, updatedOrder: null \}\)\)/.test(admin), "");
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
