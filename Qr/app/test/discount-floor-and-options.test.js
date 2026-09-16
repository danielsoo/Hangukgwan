// 할인의 1원 단위가 화면·종이·서버에서 전부 같은가.
//
// 2026-09-16 사장님, 결제창 스크린샷 두 장과 함께:
//   (1) "결제창에서 할인적용시 1원단위 불일치 / 소숫점은 그냥 다 내림으로
//       하려고 해."
//   (2) "지금 보면 전체 금액에서 할인이 들어가는 구조야. 결제할 때 차라리
//       추가 옵션들도 하위 항목들로 가격 다 나오게 해줘. 그리고 옵션들은
//       할인이 적용 안되어야 해."
//
// 스크린샷의 두 자리:
//
//  · 韓式紫菜捲 NT$150, 特約95折. 150 × 0.95 = 142.5.
//    품목 줄은 「깎는 금액」을 반올림해 142, 소계는 「받는 금액」을 반올림해
//    143 이 나왔다. 같은 142.5 를 서로 반대로 굴린 것이다.
//
//  · 닭갈비 x4 NT$1,330(밥값 1,200 + 泡麵·拌飯 130), 特約95折.
//    품목 줄은 1,330 전체를 깎아 1,263, 소계는 옵션을 빼고 깎아 1,270.
//    화면에 보이는 줄을 더해도 소계가 안 나왔다.
//
// 그래서 규칙을 둘로 못 박고 여기서 잰다.
//   A. 소수점은 전부 **내림**, 기준은 「손님이 내는 금액」.
//   B. 할인은 **밥값에만** 걸린다. 옵션 값(크기 옵션, 추가 옵션)은 화면에
//      하위 줄로 자기 값이 그대로 나오고 한 푼도 안 깎인다.
//   C. 그래서 **줄마다 따로 내림해서 더한 값이 곧 소계**다 — 합계를 한 번에
//      굴리면 줄들의 합과 또 1원씩 어긋난다.
const fs = require("fs");
const path = require("path");
const {
  payableAfterRate,
  discountByRate,
  discountBaseOf,
  lineTotalOf,
  computeVipDiscount,
  computeVipDiscountItems,
  computeDiscountAmount,
} = require("../src/discounts");

let pass = 0;
let fail = 0;
const out = [];
function check(name, ok, detail) {
  if (ok) {
    pass++;
    out.push(`  ✓ ${name}`);
  } else {
    fail++;
    out.push(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const noDrink = () => false;
const TE95 = 0.95;

out.push("[A. 소수점은 전부 내림 — 기준은 손님이 내는 금액]");
check("142.5 는 142 로 내린다", payableAfterRate(150, TE95) === 142, `${payableAfterRate(150, TE95)}`);
check("그때 할인액은 8", discountByRate(150, TE95) === 8, `${discountByRate(150, TE95)}`);
check("딱 떨어지면 그대로", payableAfterRate(200, TE95) === 190 && discountByRate(200, TE95) === 10, "");
check("VIP9折도 같은 규칙 — 155 → 139", payableAfterRate(155, 0.9) === 139, `${payableAfterRate(155, 0.9)}`);
check("반올림이면 140 이 나왔을 자리다", Math.round(155 * 0.9) === 140, "");
check("0원은 0원", payableAfterRate(0, TE95) === 0 && discountByRate(0, TE95) === 0, "");
check("망가진 값에도 안 터진다", payableAfterRate(undefined, TE95) === 0 && discountByRate(null, TE95) === 0, "");

out.push("\n[스크린샷 ①: 韓式紫菜捲 NT$150, 特約95折]");
const nori = [{ unit_price: 150, qty: 1 }];
const d1 = computeDiscountAmount("te95", null, nori, null, noDrink);
const line1 = payableAfterRate(discountBaseOf(nori[0]), TE95);
check("★ 품목 줄이 142", line1 === 142, `${line1}`);
check("★ 소계도 142 — 143 이 아니다", 150 - d1.total === 142, `${150 - d1.total}`);
check("★ 둘이 같다", line1 === 150 - d1.total, "여기가 갈리면 사장님이 본 그 1원이 다시 생긴다");

out.push("\n[스크린샷 ②: 닭갈비 x4 = 밥값 1,200 + 泡麵 60 + 拌飯 70]");
const dak = [
  {
    unit_price: 300,
    qty: 4,
    selected_addons: [
      { name: "泡麵", price: 60 },
      { name: "拌飯", price: 70 },
    ],
  },
];
const d2 = computeDiscountAmount("te95", null, dak, null, noDrink);
check("줄 전체 금액은 1,330 그대로", lineTotalOf(dak[0]) === 1330, `${lineTotalOf(dak[0])}`);
check("★ 할인 기준은 밥값 1,200 뿐", discountBaseOf(dak[0]) === 1200, `${discountBaseOf(dak[0])}`);
check("★ 할인액은 60 — 1,330 의 5%(67) 가 아니다", d2.total === 60, `${d2.total}`);
check("★ 실수령 1,270", 1330 - d2.total === 1270, `${1330 - d2.total}`);
check(
  "★ 화면 줄을 더하면 소계가 나온다 (1,140 + 60 + 70)",
  payableAfterRate(1200, TE95) + 60 + 70 === 1330 - d2.total,
  `${payableAfterRate(1200, TE95) + 60 + 70}`
);

out.push("\n[B. 하나만 고르는 옵션(크기)도 안 깎인다]");
const sized = [{ unit_price: 200, qty: 1, option_choice: "大", option_price: 50 }];
const d3 = computeDiscountAmount("vip9", null, sized, null, noDrink);
check("줄 전체는 250", lineTotalOf(sized[0]) === 250, `${lineTotalOf(sized[0])}`);
check("★ 기준은 200", discountBaseOf(sized[0]) === 200, `${discountBaseOf(sized[0])}`);
check("★ 할인액 20 — 25 가 아니다", d3.total === 20, `${d3.total}`);

out.push("\n[C. 줄마다 내림해서 더한다 — 합계를 한 번에 굴리지 않는다]");
const two = [
  { unit_price: 150, qty: 1 },
  { unit_price: 150, qty: 1 },
];
const perLine = computeVipDiscountItems("te95", two, null, noDrink);
check("★ 줄 단위 합계는 16 (8+8)", perLine === 16, `${perLine}`);
check("합계를 한 번에 굴리면 15 다", computeVipDiscount("te95", 300) === 15, `${computeVipDiscount("te95", 300)}`);
check(
  "★ 결제에 쓰이는 건 줄 단위 쪽",
  computeDiscountAmount("te95", null, two, null, noDrink).total === 16,
  "이게 15 면 품목 줄 142+142=284 와 소계 285 가 또 어긋난다"
);
const three = [{ unit_price: 150, qty: 1 }, { unit_price: 150, qty: 1 }, { unit_price: 150, qty: 1 }];
check(
  "★ 셋이어도 줄들의 합 = 소계",
  three.reduce((s, it) => s + payableAfterRate(discountBaseOf(it), TE95), 0) ===
    450 - computeDiscountAmount("te95", null, three, null, noDrink).total,
  ""
);

out.push("\n[재량 할인도 내림이다]");
const m1 = computeDiscountAmount(null, { mode: "percent", value: 5 }, nori, null, noDrink);
check("★ 150 의 5% 도 받는 돈을 내림 — 142", 150 - m1.total === 142, `${150 - m1.total}`);
const m2 = computeDiscountAmount(null, { mode: "amount", value: 10.7 }, nori, null, noDrink);
check("★ 정액 10.7 은 10 으로 내린다", m2.total === 10, `${m2.total}`);
const m3 = computeDiscountAmount("te95", { mode: "amount", value: 2 }, nori, null, noDrink);
check("★ 둘을 같이 걸면 8 + 2", m3.total === 10 && 150 - m3.total === 140, `${m3.total}`);

out.push("\n[화면·종이가 같은 식을 쓰는가]");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const admin = read("public/js/admin.js");
const escpos = read("public/js/escpos.js");
const bodyOf = (src, header) => {
  const i = src.indexOf(header);
  return i < 0 ? "" : src.slice(i, src.indexOf("\n    }\n", i));
};
// 「깎는 금액을 반올림」이 어디에도 남아 있으면 안 된다 — 사장님이 본 1원이
// 정확히 그 식에서 나왔다.
for (const [label, src] of [["관리자 화면", admin], ["영수증", escpos]]) {
  check(
    `★ ${label}에 amount - Math.round(...) 가 없다`,
    !/amount - Math.round\(amount \* \(1 -/.test(src),
    "이 식이 142 를, 합계 쪽 식이 143 을 만들었다"
  );
  check(`${label}이 payableAfterRate 를 쓴다`, /payableAfterRate/.test(src), "");
}
const vipHtml = bodyOf(admin, "    function vipPriceHtml(");
check("품목 줄 함수를 찾았다", vipHtml.length > 50, `${vipHtml.length}`);
check("★ 품목 줄도 내림", /payableAfterRateClient\(amount, vipRate\)/.test(vipHtml), "");
check(
  "★ 품목 줄이 받는 금액은 밥값 기준",
  /vipPriceHtml\(discountBaseOfClient\(it\)/.test(admin) && !/vipPriceHtml\(lineTotalOf\(it\)/.test(admin),
  "lineTotalOf 로 넘기면 옵션까지 깎아 보여준다 — 스크린샷 ②의 1,263"
);
check("★ 옵션 값이 하위 줄로 나온다", /payItemSubLinesHtml\(it,/.test(admin) && /class="pay-item-sub"/.test(admin), "");
// 2026-09-16 사장님: "메뉴 가격 밑에 옵션들 가격 해서 밑에 총 가격으로도
// 해야 할 것 같은데?" — 밥값(할인가) + 옵션 값들을 더한 품목 합계 줄.
const subLines = bodyOf(admin, "    function payItemSubLinesHtml(");
check("하위 줄 함수를 찾았다", subLines.length > 50, `${subLines.length}`);
check("★ 품목 합계 줄이 있다", /pay-item-total/.test(subLines) && /itemTotalLabel/.test(subLines), "");
check(
  "★ 품목 합계 = 할인된 밥값 + 옵션 값들",
  /payableAfterRateClient\(discountBaseOfClient\(it\), vipRate\)/.test(subLines) &&
    /optionChargesTotalOfClient\(it\)/.test(subLines),
  ""
);
check("품목 합계 CSS 가 있다", /\.pay-item-sub\.pay-item-total\s*\{/.test(read("public/css/admin.css")), "");
check("한국어/중국어 라벨이 둘 다 있다", /itemTotalLabel: "품목 합계"/.test(admin) && /itemTotalLabel: "品項合計"/.test(admin), "");
check(
  "★ 결제용 영수증도 밥값만 깎는다",
  /const amount = discountBaseOf\(it\);/.test(escpos) && !/const amount = lineTotalOf\(it\);\n        const isDrink/.test(escpos),
  ""
);
check("★ 결제용 영수증에 추가 옵션 값이 찍힌다", /priceCopy && Number\(a\.price \|\| 0\) > 0/.test(escpos), "");
const css = read("public/css/admin.css");
check("하위 줄 CSS 가 있다", /\.pay-item-sub\s*\{/.test(css), "");

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
