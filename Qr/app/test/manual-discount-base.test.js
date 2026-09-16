// 직접 입력(재량 할인)의 **기준 금액**은 손님이 내는 돈 전부인가.
//
// 2026-09-16 사장님: "직접 입력은 무조건 총 금액에서 빼줘. 퍼센트인던
// 금액이던." 이어서 "내가 말하는 기준은 직접입력이야."
//
// 같은 날 아침에 세트와 옵션을 **모든** 할인에서 뺐는데("김밥 + 라면 세트
// 그거 이미 할인이 들어간 거라 추가 vip 할인이나 퍼센트 할인에는 적용이
// 안되도록", "옵션들은 할인이 적용 안되어야 해"), 그 제한이 직접 입력까지
// 물려받아서 이런 일이 생겼다 —
//
//   화면에 뜬 합계          NT$2,910
//   직접 입력 10% 를 넣으면   NT$250 이 빠짐  (2,500 의 10%)
//
// 사장님은 2,910 의 10% 인 291 을 기대한다. 화면에 안 보이는 숫자의 10% 가
// 빠지면 직원이 손님에게 부를 숫자를 예측할 수가 없다.
//
// 그래서 갈랐다.
//   · 特約95折/VIP9折 — 그 물리 카드 프로그램의 제한 그대로(음료·기타·
//     세트·옵션 제외)
//   · 직접 입력 — **아무것도 안 뺀다.** VIP 카드 판매값만 예외.
const fs = require("fs");
const path = require("path");
const {
  computeDiscountAmount,
  lineTotalOf,
  fullEligibleTotal,
  discountEligibleTotal,
} = require("../src/discounts");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

// 사장님께 보여드린 그 예 그대로.
const ITEMS = [
  { unit_price: 1000, qty: 1, category_key: "rice" },                       // 밥 1,000
  { unit_price: 280, qty: 1, original_price: 330, category_key: "noodle" }, // 세트 280 (정가 330)
  {
    unit_price: 600, qty: 2, category_key: "meat",                          // 닭갈비 1,200
    selected_addons: [{ name: "泡麵", price: 50 }, { name: "拌飯", price: 80 }], // + 옵션 130
  },
  { unit_price: 300, qty: 1, category_key: "drink" },                       // 소주 300
];
const isDrink = (it) => it.category_key === "drink";
const GROSS = ITEMS.reduce((s, it) => s + lineTotalOf(it), 0);

out.push("[기준 금액]");
check("총액은 2,910", GROSS === 2910, `${GROSS}`);
check(
  "★ 직접 입력 기준 = 총액 그대로",
  fullEligibleTotal(ITEMS) === GROSS,
  `${fullEligibleTotal(ITEMS)} — 세트 280 과 옵션 130 이 빠지면 2,500 이 된다`
);
check(
  "★ VIP 기준은 예전 그대로 — 음료·세트·옵션이 빠진다",
  discountEligibleTotal(ITEMS, null, isDrink) === 2200,
  `${discountEligibleTotal(ITEMS, null, isDrink)} (밥 1,000 + 닭갈비 밥값 1,200)`
);
check("★ 둘은 서로 다른 값이다", fullEligibleTotal(ITEMS) !== discountEligibleTotal(ITEMS, null, isDrink), "");

out.push("\n[퍼센트 — 화면에 뜬 합계의 그 퍼센트]");
{
  const d = computeDiscountAmount(null, { mode: "percent", value: 10 }, ITEMS, null, isDrink);
  check("★ 10% 는 291 (2,910 의 10%)", d.manualAmount === 291, `${d.manualAmount} — 2,500 기준이면 250`);
  check("실수령은 2,619", GROSS - d.total === 2619, `${GROSS - d.total}`);
  const half = computeDiscountAmount(null, { mode: "percent", value: 50 }, ITEMS, null, isDrink);
  check("50% 는 1,455", half.manualAmount === 1455, `${half.manualAmount}`);
  const all = computeDiscountAmount(null, { mode: "percent", value: 100 }, ITEMS, null, isDrink);
  check("100% 면 전부", all.manualAmount === GROSS, `${all.manualAmount}`);
}

out.push("\n[정액 — 세트·옵션만 있는 자리에서도 다 깎인다]");
{
  // 예전에는 기준이 0 이라 한 푼도 안 깎였다.
  const only = [
    { unit_price: 280, qty: 1, original_price: 330 },
    { unit_price: 600, qty: 1, selected_addons: [{ name: "泡麵", price: 50 }] },
  ];
  const grossOnly = only.reduce((s, it) => s + lineTotalOf(it), 0);
  check("이 자리의 총액은 930", grossOnly === 930, `${grossOnly}`);
  const d = computeDiscountAmount(null, { mode: "amount", value: 200 }, only, null, () => false);
  check("★ 정액 200 이 그대로 깎인다", d.manualAmount === 200, `${d.manualAmount} — 예전 기준이면 0`);
  const big = computeDiscountAmount(null, { mode: "amount", value: 9999 }, only, null, () => false);
  check("총액보다 큰 할인은 총액에서 멈춘다", big.manualAmount === grossOnly, `${big.manualAmount}`);
  const pct = computeDiscountAmount(null, { mode: "percent", value: 10 }, only, null, () => false);
  check("★ 퍼센트도 걸린다 — 930 의 10% = 93", pct.manualAmount === 93, `${pct.manualAmount}`);
}

out.push("\n[VIP 할인과 같이 걸었을 때 — 순서는 그대로]");
{
  // VIP 를 먼저 자기 규칙대로 걸고, 직접 입력은 남은 실수령액에서 뺀다.
  const d = computeDiscountAmount("vip9", { mode: "percent", value: 10 }, ITEMS, null, isDrink);
  check("★ VIP9折은 음료 제외 2,200 의 10% = 220", d.vipAmount === 220, `${d.vipAmount}`);
  check("★ 남은 실수령은 2,910 - 220 = 2,690", d.afterVip === 2690, `${d.afterVip}`);
  check("★ 직접 입력 10% 는 그 2,690 의 10% = 269", d.manualAmount === 269, `${d.manualAmount}`);
  check("총 할인 489", d.total === 489, `${d.total}`);
  check("실수령 2,421", GROSS - d.total === 2421, `${GROSS - d.total}`);
}

out.push("\n[VIP 카드 판매값은 여전히 뺀다]");
{
  const withCard = [
    { unit_price: 1000, qty: 1 },
    { unit_price: 300, qty: 1, category_key: "vip_card" },
  ];
  check("★ 카드값은 기준에 안 들어간다", fullEligibleTotal(withCard) === 1000, `${fullEligibleTotal(withCard)}`);
  const d = computeDiscountAmount(null, { mode: "percent", value: 10 }, withCard, null, () => false);
  check("★ 카드값을 깎지 않는다 — 1,000 의 10%", d.manualAmount === 100, `${d.manualAmount} — 1,300 기준이면 130`);
}

out.push("\n[화면과 서버가 같은 답을 낸다]");
{
  const admin = fs.readFileSync(path.join(__dirname, "../public/js/admin.js"), "utf8");
  const slice = (src, header, end) => {
    const i = src.indexOf(header);
    return i < 0 ? "" : src.slice(i, src.indexOf(end, i));
  };
  const fn =
    slice(admin, "  function fullEligibleClientTotal(order, indexes) {", "\n  }\n") +
    "\n  }\n" +
    slice(admin, "  function isCardSaleItemClient(it) {", "\n  }\n") +
    "\n  }";
  check("화면 쪽 함수를 찾았다", fn.length > 200, `${fn.length}`);
  const clientTotal = new Function("lineTotalOf", `${fn}\n return fullEligibleClientTotal;`)(lineTotalOf);
  for (const [name, items] of [
    ["사장님 예", ITEMS],
    ["세트·옵션만", [{ unit_price: 280, qty: 1, original_price: 330 }]],
    ["카드 판매가 섞인 자리", [{ unit_price: 1000, qty: 1 }, { unit_price: 300, qty: 1, category_key: "vip_card" }]],
    ["빈 주문", []],
  ]) {
    const a = clientTotal({ items }, null);
    const b = fullEligibleTotal(items);
    check(`★ ${name} — 화면 ${a} = 서버 ${b}`, a === b, `${a} vs ${b}`);
  }
  check(
    "★ 화면도 아무것도 안 뺀다",
    /s \+ lineTotalOf\(it\)/.test(fn) && !/sumDiscountableClient/.test(fn),
    "할인 기준 리듀서를 쓰면 세트·옵션이 또 빠진다"
  );
  check("카드 판매만 뺀다", /isCardSaleItemClient\(it\)/.test(fn), "");
  check("카드 분류 이름이 서버와 같다", /"vip_card"/.test(fn), "src/vip.js CARD_SALE_CATEGORY");
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
