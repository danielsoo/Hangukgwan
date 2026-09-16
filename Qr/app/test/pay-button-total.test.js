// 결제 버튼에 적힌 숫자가 화면 합계와 같은가.
//
// 2026-09-14 사장님(스크린샷과 함께): "지금 빨간 결제완료 버튼이 합계를
// 적용 안하는 거 같아. 간단하게 각 모든 소계를 합친 걸 적용해야 하는데 할인이
// 전혀 적용이 안되어있어."
//
// 화면에는 이렇게 떠 있었다.
//
//     소계   NT$240  NT$216
//     합계   NT$240  NT$216
//     미결제 합계: NT$240        ← 할인 없음
//     [ 결제 완료 (NT$240) ]     ← 할인 없음
//
// 받은 돈은 맞았다 — 결제할 때 서버가 다시 계산한다(src/routes/orders.js).
// 틀린 것은 **직원이 손님에게 부르는 숫자**였다. 한 화면에 240 과 216 이 같이
// 떠 있으면 어느 쪽이 받을 돈인지 알 수 없다.
//
// 원인은 같은 값을 세 군데서 따로 더한 것이다. 합계는 할인을 넣어 더하고,
// 미결제 합계와 결제 버튼은 안 넣고 더했다.
//
// ── 이 시험이 재는 것 ──────────────────────────────────────────────────
//
// 1) 화면 쪽 산수(tableDiscountFor)가 서버 쪽 산수(src/discounts.js)와 **같은
//    답**을 내는가. 이 둘이 갈리면 버튼 숫자와 실제 청구액이 달라진다.
// 2) 세 자리가 **같은 함수**를 쓰는가. 따로 더하기 시작하면 또 어긋난다.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const server = require("../src/discounts");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const src = fs.readFileSync(path.join(__dirname, "../public/js/admin.js"), "utf8");

// 화면 쪽 산수를 통째로 꺼낸다 — 할인율표부터 tableDiscountFor 까지.
const ratesAt = src.indexOf("  const VIP_DISCOUNT_RATES_CLIENT");
// grossSelectionTotal 까지 같이 꺼내야 한다 — tableDiscountFor 가 그걸로
// 「받을 돈」을 센다(2026-09-16 핫픽스).
const fnAt = src.indexOf("  function grossSelectionTotal(order, indexes) {");
const fnEnd = src.indexOf("\n  /** 아직 안 받은 품목 전부", fnAt);
check("화면 쪽 할인율표를 찾는다", ratesAt > 0, String(ratesAt));
check("tableDiscountFor 를 찾는다", fnAt > 0 && fnEnd > fnAt, `${fnAt}, ${fnEnd}`);
check("받을 돈 합산도 같이 꺼냈다", src.slice(fnAt, fnEnd).includes("function tableDiscountFor"), "");

// 2026-09-14: 할인에서 빠지는 분류가 음료뿐이 아니게 되면서
// (discountExcludedItemIdSet) 이 묶음의 시작이 앞으로 당겨졌다. 그 함수까지
// 같이 꺼내야 산수가 돈다.
const mathAt = src.indexOf("  function discountExcludedItemIdSet() {");
const mathEnd = src.indexOf("\n  // buildReceiptBodyHtml()", mathAt);
check("화면 쪽 산수 묶음을 찾는다", mathAt > 0 && mathEnd > mathAt, `${mathAt}, ${mathEnd}`);

const code = [
  src.slice(ratesAt, src.indexOf("\n", src.indexOf("};", ratesAt)) + 1),
  src.slice(mathAt, mathEnd),
  src.slice(fnAt, fnEnd),
].join("\n");

// 빠지는 분류는 서버가 알려준다(storeSettings.vip_discount_excluded_categories).
// 여기서는 시험이 그 자리를 채운다 — 음료로 넣은 품목만 빠지게.
function makeClient(vipType, manualValue, drinkIds) {
  return new Function(
    "tableVipDiscountType", "tableManualDiscountValue", "storeSettings", "categories", "lineTotalOf",
    `${code}
     return { tableDiscountFor };`
  )(
    vipType,
    manualValue,
    // 2026-09-16: 화면은 이제 키 목록을 받아 다시 판단하지 않는다. 서버가
    // 분류마다 discount_excluded 로 답을 내서 보낸다
    // (src/routes/menu.js categoriesWithItems). 예시도 그 모양이어야 한다 —
    // 안 그러면 이 시험은 실제로 도는 코드와 다른 것을 재게 된다.
    {},
    [
      { key: "drink", discount_excluded: true, items: drinkIds.map((id) => ({ id })) },
      { key: "other", discount_excluded: true, items: [] },
      { key: "rice", discount_excluded: false, items: [] },
    ],
    // src/discounts.js lineTotalOf 와 **같은 식**이어야 한다 — 옵션 값은
    // 수량을 안 곱한다(2026-09-16). 여기가 다르면 이 시험은 실제로 도는
    // 코드와 다른 것을 재게 된다.
    (it) =>
      (it.unit_price || 0) * (it.qty || 0) +
      (Number(it.option_price) || 0) +
      (it.selected_addons || []).reduce((s, a) => s + (a.price || 0), 0)
  );
}

const ITEM = (id, price, qty) => ({ item_id: id, unit_price: price, qty, selected_addons: [] });

// 서버 쪽 lineTotalOf 와 같은 모양의 품목을 쓴다.
const CASES = [
  {
    name: "사장님 화면 그대로 — 해물파전 240, VIP9折",
    items: [ITEM(77, 240, 1)],
    drinks: [],
    vip: "vip9",
    manual: null,
    expectPayable: 216,
  },
  {
    name: "음료는 VIP 할인에서 빠진다 — 음식 230 + 음료 30, 特約95折",
    items: [ITEM(1, 230, 1), ITEM(90, 30, 1)],
    drinks: [90],
    vip: "te95",
    manual: null,
    // 2026-09-16 사장님: "소숫점은 그냥 다 내림으로 하려고 해." 230 × 0.95 =
    // 218.5 → 손님은 218 을 낸다(할인 12). 반올림이던 때는 11 이었다.
    expectPayable: 260 - 12,
  },
  {
    name: "VIP 먼저, 남은 금액에서 재량 — 음식 230 + 음료 30, 特約95折 + 2원",
    items: [ITEM(1, 230, 1), ITEM(90, 30, 1)],
    drinks: [90],
    vip: "te95",
    manual: { mode: "amount", value: 2 },
    // 내림으로 바뀐 뒤 총 할인 14, 실수령 246(예전 반올림으로는 247).
    expectPayable: 260 - 12 - 2,
  },
  {
    name: "재량만 — 퍼센트",
    items: [ITEM(1, 500, 2)],
    drinks: [],
    vip: null,
    manual: { mode: "percent", value: 10 },
    expectPayable: 900,
  },
  {
    name: "남은 금액보다 많이 깎지 않는다",
    items: [ITEM(1, 100, 1)],
    drinks: [],
    vip: "vip9",
    manual: { mode: "amount", value: 9999 },
    expectPayable: 0,
  },
  {
    name: "할인이 없으면 그대로",
    items: [ITEM(1, 240, 1)],
    drinks: [],
    vip: null,
    manual: null,
    expectPayable: 240,
  },
  // ── 2026-09-16 핫픽스: 할인 기준에서 빠지는 것들이 버튼에서도 사라졌다 ──
  {
    // 사장님 스크린샷 그대로: 김밥세트(280, 정가 330) 하나만 체크.
    // 세트는 이미 깎아 파는 값이라 어떤 할인의 기준에도 안 들어간다.
    // 그래도 **받을 돈은 280 이다.** 버튼은 0 을 적고 있었다.
    name: "★ 세트만 골라도 값을 다 받는다 — 버튼이 NT$0 이던 자리",
    items: [{ item_id: 22, unit_price: 280, original_price: 330, qty: 1, selected_addons: [] }],
    drinks: [],
    vip: "te95",
    manual: null,
    expectPayable: 280,
  },
  {
    name: "★ 세트 + 보통 메뉴 — 세트 값이 안 사라진다",
    items: [
      { item_id: 22, unit_price: 280, original_price: 330, qty: 1, selected_addons: [] },
      ITEM(1, 200, 1),
    ],
    drinks: [],
    vip: "vip9",
    manual: null,
    // 280(그대로) + 200 의 10% 할인 → 180. 세트를 빼먹으면 180 이 나온다.
    expectPayable: 460,
  },
  {
    // 닭갈비 x2 600 + 泡麵 50 + 拌飯 80. 옵션 값은 할인 기준에서 빠지지만
    // 받을 돈에는 그대로 들어간다.
    name: "★ 옵션 값도 안 사라진다",
    items: [
      { item_id: 52, unit_price: 300, qty: 2, selected_addons: [{ name: "泡麵", price: 50 }, { name: "拌飯", price: 80 }] },
    ],
    drinks: [],
    vip: "te95",
    manual: null,
    // 밥값 600 → 570, 옵션 130 은 그대로. 옵션을 빼먹으면 570 이 나온다.
    expectPayable: 700,
  },
  {
    name: "★ 크기 옵션도 마찬가지",
    items: [{ item_id: 5, unit_price: 200, qty: 1, option_price: 50, selected_addons: [] }],
    drinks: [],
    vip: "vip9",
    manual: null,
    expectPayable: 230, // 200 → 180, 옵션 50 그대로
  },
  {
    name: "★ 음료만 골라도 값을 다 받는다",
    items: [ITEM(90, 300, 1)],
    drinks: [90],
    vip: "te95",
    manual: null,
    expectPayable: 300,
  },
];

out.push("\n[화면 산수 == 서버 산수]");
for (const c of CASES) {
  const indexes = c.items.map((_, i) => i);
  const client = makeClient(c.vip, c.manual, c.drinks);
  const got = client.tableDiscountFor([{ order: { items: c.items }, indexes }]);

  const isDrink = (it) => c.drinks.includes(it.item_id);
  const srv = server.computeDiscountAmount(c.vip, c.manual, c.items, indexes, isDrink);
  // ★ 받을 돈은 **줄 금액의 합**에서 할인을 뺀 것이다 — 할인 기준
  // (fullEligibleTotal)에서 빼는 게 아니다.
  //
  // 2026-09-16 사장님(스크린샷과 함께): "지금 보면 클릭했는데 0으로 표시되고
  // 있어." 김밥세트 하나만 체크했는데 버튼이 NT$0 이었다. 세트는 할인
  // 기준에서 통째로 빠지니(이미 깎아 파는 값) 기준이 0 이었고, 버튼이 그
  // 기준을 적고 있었다. 옵션 값도 같은 이유로 사라지고 있었다.
  //
  // 이 시험도 **같은 착각을 하고 있었다** — 그래서 통과했다. 고친다.
  const srvPayable = indexes.reduce((s, i) => s + server.lineTotalOf(c.items[i]), 0) - srv.total;

  check(`${c.name} — 서버와 같은 답`, got.payable === srvPayable, `화면 ${got.payable} vs 서버 ${srvPayable}`);
  check(`${c.name} — 받을 돈 NT$${c.expectPayable}`, got.payable === c.expectPayable, `${got.payable}`);
}

out.push("\n[받을 돈과 할인 기준을 안 헷갈린다]");
{
  const fn = src.slice(fnAt, fnEnd);
  check(
    "★ 받을 돈은 줄 금액의 합이다",
    /const gross = selections\.reduce\(\(sum, x\) => sum \+ grossSelectionTotal\(x\.order, x\.indexes\), 0\);/.test(fn),
    "기준 금액으로 버튼을 적으면 세트·옵션 값이 사라진다"
  );
  check("★ payable 은 gross 에서 뺀다", /payable: gross - breakdown\.total/.test(fn), "");
  check(
    "★ 할인 기준은 따로 센다",
    /const base = selections\.reduce\(\(sum, x\) => sum \+ fullEligibleClientTotal/.test(fn),
    ""
  );
  check(
    "★ 할인이 없을 때도 gross 를 돌려준다",
    /return \{ full: gross, breakdown: \{ vipAmount: 0, manualAmount: 0, afterVip: gross, total: 0 \}, payable: gross \};/.test(fn),
    "할인이 꺼져 있을 때 세트만 고르면 0 이 된다"
  );
  check("grossSelectionTotal 이 lineTotalOf 를 쓴다", /grossSelectionTotal[\s\S]{0,260}?lineTotalOf\(order\.items\[i\]\)/.test(fn), "");
}

out.push("\n[세 자리가 같은 함수를 쓴다]");
// 따로 더하기 시작하면 또 어긋난다. 오늘 그래서 240 과 216 이 같이 떠 있었다.
check(
  "★ 결제 버튼이 할인을 넣은 값을 쓴다",
  /const footerSelectedPayable = tableDiscountFor\(footerSelections\)\.payable;/.test(src) &&
    /const footerPayTotal = footerSelectedPayable \+ pendingCardAmount;/.test(src),
  "결제 버튼이 따로 더하고 있다"
);
check(
  "★ 미결제 합계도 할인을 넣어 보여준다",
  /unpaidTotalLabel2[\s\S]{0,120}vipTotalHtml\(unpaidTotal, unpaidDiscountAmount\)/.test(src),
  "미결제 합계가 할인 전 금액이다"
);
check(
  "★ 결제 팝업도 같은 함수를 쓴다",
  /const breakdown = tableDiscountFor\(selections\)\.breakdown;/.test(src),
  "결제 팝업이 따로 계산한다"
);
check(
  "품목 합을 날것으로 더해 버튼에 쓰지 않는다",
  !/footerSelections\.reduce\(\(s, x\) => s \+ x\.total, 0\)/.test(src),
  "예전 방식이 남아 있다"
);

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
