// VIP 카드를 파는 규칙.
//
// 2026-09-10 사장님: "vip카드 구매도 현금으로만 구매가능. 버튼필요 —
// VIP卡販售 / 300원. 직원이 결제할 때 손님이 vip 사고 싶다면 살 수 있게
// 해줘. 직원이 결제창에서 직접 쉽게 추가할 수 있게 버튼으로 추가할 수
// 있게 해줘."
//
// 여기서 재는 것은 돈이 틀어질 수 있는 자리들이다.
//   - 현금으로만 찍히는가 (카드로 밥값을 내도 카드값은 현금이어야 한다)
//   - 카드값에 할인이 걸리지 않는가 (300원을 9折 해줄 이유가 없다)
//   - 설정값이 이상해도 결제창이 살아 있는가
//   - 결산의 손님 수가 부풀지 않는가
const fs = require("fs");
const path = require("path");
const {
  cardSalePrice,
  cardSaleDiscountPercent,
  normalizeCardSale,
  isCardSaleItem,
  CARD_SALE_CATEGORY,
  DEFAULT_CARD_PRICE,
} = require("../src/vip");
const { computeDiscountAmount } = require("../src/discounts");
const { computeSettlement } = require("../src/settlement");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

out.push("[판매가 — 설정이 이상해도 화면은 살아 있어야 한다]");
check("설정이 없으면 300", cardSalePrice({}) === 300, String(cardSalePrice({})));
check("설정 자체가 없어도 300", cardSalePrice(undefined) === DEFAULT_CARD_PRICE);
check("사장님이 정한 값을 쓴다", cardSalePrice({ vip_card_sale: { price: 500 } }) === 500);
check("문자로 들어와도 읽는다", cardSalePrice({ vip_card_sale: { price: "500" } }) === 500);
check("소수는 원 단위로 맞춘다", cardSalePrice({ vip_card_sale: { price: 299.6 } }) === 300);
for (const bad of [0, -1, "", null, "삼백", NaN, Infinity, {}]) {
  check(`이상한 값(${JSON.stringify(bad)})이면 기본값으로 돌아간다`,
    cardSalePrice({ vip_card_sale: { price: bad } }) === 300);
}
check("터무니없이 큰 값은 자른다", cardSalePrice({ vip_card_sale: { price: 1e12 } }) === 100000);

out.push("\n[같이 등록할 때 붙는 할인율]");
check("설정이 없으면 10%(VIP9折)", cardSaleDiscountPercent({}) === 10);
check("사장님이 정한 값을 쓴다", cardSaleDiscountPercent({ vip_card_sale: { discount_percent: 5 } }) === 5);
check("100을 넘으면 기본값", cardSaleDiscountPercent({ vip_card_sale: { discount_percent: 120 } }) === 10);
check("0 이하도 기본값", cardSaleDiscountPercent({ vip_card_sale: { discount_percent: 0 } }) === 10);
{
  const n = normalizeCardSale({ price: "450", discount_percent: "7.5" });
  check("저장할 때도 같은 규칙으로 자른다", n.price === 450 && n.discount_percent === 7.5, JSON.stringify(n));
  const bad = normalizeCardSale({ price: "-5", discount_percent: "999" });
  check("이상한 값은 저장 자체를 기본값으로", bad.price === 300 && bad.discount_percent === 10, JSON.stringify(bad));
}

out.push("\n[카드값에는 할인이 안 걸린다]");
// 밥 1000원 + 카드 300원 한 주문에 VIP9折을 걸면, 깎이는 건 밥값 1000원의
// 10%인 100원이어야 한다. 카드값까지 세면 130원이 깎여서 30원이 샌다.
{
  const items = [
    { unit_price: 1000, qty: 1, selected_addons: [], category_key: "rice" },
    { unit_price: 300, qty: 1, selected_addons: [], category_key: CARD_SALE_CATEGORY },
  ];
  const noDrink = () => false;
  const vip = computeDiscountAmount("vip9", null, items, null, noDrink);
  check("VIP9折은 밥값에만 걸린다", vip.total === 100, JSON.stringify(vip));
  // 재량 할인도 마찬가지다 — 10%를 치면 밥값의 10%여야 한다.
  const man = computeDiscountAmount(null, { mode: "percent", value: 10 }, items, null, noDrink);
  check("재량 퍼센트 할인도 카드값을 안 센다", man.total === 100, JSON.stringify(man));
  // 겹쳐 걸어도 카드값은 끝까지 기준 밖이다.
  const both = computeDiscountAmount("vip9", { mode: "amount", value: 2 }, items, null, noDrink);
  check("둘을 겹쳐도 카드값은 기준 밖", both.total === 102 && both.afterVip === 900, JSON.stringify(both));
  const only = computeDiscountAmount("vip9", null, [items[1]], null, noDrink);
  check("카드만 있는 주문에는 깎을 게 없다", only.total === 0, JSON.stringify(only));
  check("품목 판별은 한 함수로", isCardSaleItem(items[1]) && !isCardSaleItem(items[0]));
}

out.push("\n[결산에서]");
// 카드 판매도 받은 돈이다 — 매출에 들어가고, 현금 칸에 잡히고, 분류는
// 밥·면과 갈라져야 한다. 대신 손님 수는 세지 않는다(인원수를 안 붙인다).
{
  const cardItem = {
    unit_price: 300, qty: 1, selected_addons: [],
    category_key: CARD_SALE_CATEGORY, payment_method: "cash", paid: true,
    name_ko: "VIP 카드 판매", name_zh: "VIP卡販售",
  };
  const orders = [
    { id: 1, status: "paid", created_at: "2026-09-10 12:00:00", total: 1000, payment_method: "card",
      table_number: "5", party_size: 4, order_type: "dine_in",
      items: [{ unit_price: 1000, qty: 1, selected_addons: [], category_key: "rice", payment_method: "card", name_ko: "밥", name_zh: "飯" }] },
    { id: 2, status: "paid", created_at: "2026-09-10 12:05:00", total: 300, payment_method: "cash",
      table_number: "5", party_size: null, order_type: "dine_in", items: [cardItem] },
  ];
  const s = computeSettlement(orders, "2026-09-10");
  check("매출에 들어간다", s.total_revenue === 1300, String(s.total_revenue));
  const cash = (s.payment_method_breakdown || []).find((p) => p.method === "cash");
  check("현금 칸에 300이 잡힌다", cash && cash.revenue === 300, JSON.stringify(cash));
  const cat = (s.category_breakdown || []).find((c) => c.category_key === CARD_SALE_CATEGORY);
  check("분류가 따로 잡힌다", cat && cat.subtotal === 300, JSON.stringify(cat));
  check("손님 수를 부풀리지 않는다", s.guest_count === 4, String(s.guest_count));
  check("결제수단 총합이 매출과 맞는다", s.payment_method_total === s.total_revenue,
    `${s.payment_method_total} vs ${s.total_revenue}`);
}

out.push("\n[판매 라우트]");
const routeSrc = read("src", "routes", "vipCards.js");
check("현금으로 못 박는다", /payment_method: "cash"/.test(routeSrc),
  "결제수단을 고르게 두면 카드로도 팔린다");
check("이미 결제된 상태로 기록한다", /status: "paid"/.test(routeSrc));
check("직원 누구나 팔 수 있다", /router\.post\("\/sell", requireAdmin,/.test(routeSrc),
  "돈 받는 일인데 사장님만 할 수 있으면 손님을 세워둔다");
check("판매가는 src/vip.js 에서 읽는다", /cardSalePrice\(store\.settings\)/.test(routeSrc),
  "라우트가 300을 직접 들고 있으면 설정을 올린 날 어긋난다");
check("인원수를 붙이지 않는다", /party_size: null/.test(routeSrc));
check("이미 있는 카드번호면 판매를 멈춘다", /card_exists/.test(routeSrc),
  "돈만 받고 남의 카드에 덮어쓰면 그 손님 할인이 사라진다");
check("발급일은 오늘로", /issue_date: taipeiDateString\(\)/.test(routeSrc));
check("판매가 설정은 사장님만 고친다", /router\.put\("\/sale-settings", canManageVip,/.test(routeSrc));
check("판매가 읽기는 직원도 된다", /router\.get\("\/sale-settings", requireAdmin,/.test(routeSrc),
  "결제창 버튼에 금액이 안 찍힌다");

out.push("\n[화면]");
const adminSrc = read("public", "js", "admin.js");
const adminHtml = read("public", "admin.html");
check("결제창에 판매 버튼이 있다", /id="vipSellBtn"/.test(adminSrc));
// 주문이 하나도 없어도 나와야 한다 — 다 먹고 결제까지 끝낸 손님이 나가면서
// "카드 하나 주세요" 하는 게 흔한 순간이다.
check("주문이 없어도 버튼이 나온다",
  /const footer = tableDetailView === "active"\s*\n\s*\?/.test(adminSrc),
  "아직 activeOrders.length 조건에 묶여 있다");
check("버튼에 금액이 찍힌다", /vipSalePrice == null \? "" : ` NT\$\$\{vipSalePrice\}`/.test(adminSrc));
check("카드번호 입력칸이 있다", /id="vipSellCardNumber"/.test(adminHtml));
check("현금이라고 적혀 있다", /vipSellCashOnly/.test(adminHtml) && /vipSellCashOnly/.test(adminSrc));
check("두 번 눌러 두 장이 팔리지 않는다", /confirmBtn\.disabled = true;/.test(adminSrc));
check("이미 등록된 번호면 그 자리에서 알려준다", /body\.error === "card_exists"/.test(adminSrc));
check("결산에 날것의 vip_card 가 안 찍힌다", /key === "vip_card"\) return T\("settlementCategoryVipCard"\)/.test(adminSrc));
for (const key of ["vipSellBtn", "vipSellTitle", "vipSellCashOnly", "vipSellConfirmBtn",
                   "vipSaleTitle", "vipSalePriceLabel", "settlementCategoryVipCard"]) {
  const uses = (adminSrc.match(new RegExp(`${key}:`, "g")) || []).length;
  check(`${key} 가 한국어/중국어 둘 다 있다`, uses >= 2, `${uses}개`);
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
