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
const fnAt = src.indexOf("  function tableDiscountFor(selections) {");
const fnEnd = src.indexOf("\n  /** 아직 안 받은 품목 전부", fnAt);
check("화면 쪽 할인율표를 찾는다", ratesAt > 0, String(ratesAt));
check("tableDiscountFor 를 찾는다", fnAt > 0 && fnEnd > fnAt, `${fnAt}, ${fnEnd}`);

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
    { vip_discount_excluded_categories: ["drink", "other"] },
    [
      { key: "drink", items: drinkIds.map((id) => ({ id })) },
      { key: "other", items: [] },
      { key: "rice", items: [] },
    ],
    (it) => ((it.unit_price || 0) + (it.selected_addons || []).reduce((s, a) => s + (a.price || 0), 0)) * (it.qty || 0)
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
    // 230 - round(230*0.95) = 230 - 219 = 11. 프로젝트 문서의 예와 같다.
    expectPayable: 260 - 11,
  },
  {
    name: "VIP 먼저, 남은 금액에서 재량 — 음식 230 + 음료 30, 特約95折 + 2원",
    items: [ITEM(1, 230, 1), ITEM(90, 30, 1)],
    drinks: [90],
    vip: "te95",
    manual: { mode: "amount", value: 2 },
    // 문서의 worked example 그대로 — 총 할인 13, 실수령 247.
    expectPayable: 260 - 11 - 2,
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
];

out.push("\n[화면 산수 == 서버 산수]");
for (const c of CASES) {
  const indexes = c.items.map((_, i) => i);
  const client = makeClient(c.vip, c.manual, c.drinks);
  const got = client.tableDiscountFor([{ order: { items: c.items }, indexes }]);

  const isDrink = (it) => c.drinks.includes(it.item_id);
  const srv = server.computeDiscountAmount(c.vip, c.manual, c.items, indexes, isDrink);
  const srvPayable = server.fullEligibleTotal(c.items, indexes) - srv.total;

  check(`${c.name} — 서버와 같은 답`, got.payable === srvPayable, `화면 ${got.payable} vs 서버 ${srvPayable}`);
  check(`${c.name} — 받을 돈 NT$${c.expectPayable}`, got.payable === c.expectPayable, `${got.payable}`);
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
