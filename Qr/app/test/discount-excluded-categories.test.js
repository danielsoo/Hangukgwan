// 할인에서 빠지는 분류가 음료뿐이 아니다.
//
// 2026-09-14 사장님: "지금은 음료 주류만 빠지는데 기타 항목도 모두 할인
// 안하게 해줘."
//
// 이 매장은 주류를 따로 안 나누고 음료(drink) 안에 같이 둔다. 기타는
// key "other" 다 — 2026-09-10 에 남는 항목이 없으면 지우도록 돼 있지만
// (src/migrations/2026-09-10-traditional-category.js), 그 사이 새 메뉴가
// 들어가 있었으면 살아 있다.
//
// 목록은 src/discounts.js 한 곳에만 둔다. 서버도 화면도 그것을 받아 쓴다 —
// 두 군데서 따로 적으면 **화면에 뜬 금액과 실제로 받는 금액이 갈린다.**
// 오늘 결제 버튼에서 정확히 그 일이 있었다(240 vs 216).
const { DISCOUNT_EXCLUDED_CATEGORY_KEYS, computeDiscountAmount } = require("../src/discounts");
const fs = require("fs");
const path = require("path");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

// 분류별 품목. isDrink 자리에 들어가는 판정을 라우트와 같은 모양으로 만든다.
const CAT_OF = { 1: "rice", 2: "drink", 3: "other", 4: "bbq" };
const excluded = new Set(DISCOUNT_EXCLUDED_CATEGORY_KEYS);
const isExcluded = (it) => excluded.has(CAT_OF[it.item_id]);
const ITEM = (id, price, qty = 1) => ({ item_id: id, unit_price: price, qty, selected_addons: [] });

out.push("[빠지는 분류]");
check("음료가 들어 있다", DISCOUNT_EXCLUDED_CATEGORY_KEYS.includes("drink"), JSON.stringify(DISCOUNT_EXCLUDED_CATEGORY_KEYS));
check("★ 기타가 들어 있다", DISCOUNT_EXCLUDED_CATEGORY_KEYS.includes("other"), JSON.stringify(DISCOUNT_EXCLUDED_CATEGORY_KEYS));
check("밥류는 안 빠진다", !DISCOUNT_EXCLUDED_CATEGORY_KEYS.includes("rice"), "");
check("구이류도 안 빠진다", !DISCOUNT_EXCLUDED_CATEGORY_KEYS.includes("bbq"), "");

out.push("\n[VIP9折 — 10%]");
{
  // 밥 200 + 음료 100 + 기타 100 + 구이 200 = 600
  const items = [ITEM(1, 200), ITEM(2, 100), ITEM(3, 100), ITEM(4, 200)];
  const idx = items.map((_, i) => i);
  const d = computeDiscountAmount("vip9", null, items, idx, isExcluded);
  // 깎이는 것은 밥 200 + 구이 200 = 400 의 10% = 40
  check("★ 음료와 기타를 뺀 400 에만 걸린다", d.vipAmount === 40, `${d.vipAmount} (전체에 걸리면 60)`);
  check("남은 금액이 600 - 40", d.afterVip === 560, `${d.afterVip}`);
}

out.push("\n[기타만 있는 주문]");
{
  const items = [ITEM(3, 300)];
  const d = computeDiscountAmount("vip9", null, items, [0], isExcluded);
  check("★ 하나도 안 깎인다", d.vipAmount === 0, `${d.vipAmount}`);
}

out.push("\n[재량(직접 입력) 할인은 그대로 전체에 걸린다]");
{
  // 음료·기타를 빼는 것은 VIP 카드 규칙이다. 재량 할인은 직원이 그 자리에서
  // 깎아주는 것이라 예전부터 전체 금액 기준이었다(payment-discount-rules.md).
  const items = [ITEM(2, 100), ITEM(3, 100)];
  const d = computeDiscountAmount(null, { mode: "amount", value: 50 }, items, [0, 1], isExcluded);
  check("★ 음료·기타뿐이어도 재량은 깎인다", d.manualAmount === 50, `${d.manualAmount}`);
}

out.push("\n[서버와 화면이 같은 판단을 본다]");
{
  // 2026-09-16: 키 목록을 화면에 내려주고 화면이 다시 판단하던 것을
  // 그만뒀다. 이제 **서버가 답을 내서** 분류마다 true/false 로 보낸다.
  // 같은 규칙을 두 군데서 적으면 화면에 뜬 금액과 실제로 받는 금액이 갈린다.
  const admin = fs.readFileSync(path.join(__dirname, "../public/js/admin.js"), "utf8");
  const orders = fs.readFileSync(path.join(__dirname, "../src/routes/orders.js"), "utf8");
  const menu = fs.readFileSync(path.join(__dirname, "../src/routes/menu.js"), "utf8");
  // 손님 화면·메뉴 관리 목록을 만드는 그 함수를 콕 집어 본다. 파일
  // 어딘가에 같은 글자가 있다고 통과시키면 안 된다 — 실제로 한 번 그랬다.
  const cwiFrom = menu.indexOf("function categoriesWithItems(");
  const cwiTo = menu.indexOf("\n}\n", cwiFrom);
  const cwi = cwiFrom >= 0 && cwiTo > cwiFrom ? menu.slice(cwiFrom, cwiTo) : "";
  check(
    "★ 목록을 만들 때 분류마다 답을 내서 보낸다",
    /discount_excluded: catExcluded/.test(cwi) && /const catExcluded = isDiscountExcludedCategory\(c\);/.test(cwi),
    `categoriesWithItems 안에 없다 (${cwi.length}자)`
  );
  // 2026-09-16 오후: 메뉴 한 줄도 자기 표를 들 수 있게 되면서
  // (isDiscountExcludedMenuItem — "모든 주문마다 할인 적용 온 오프 할 수 있게
  // 메뉴 관리에서"), 서버가 **메뉴마다** 답을 내서 보낸다.
  check(
    "★ 메뉴 한 줄마다도 답을 내서 보낸다",
    /discount_excluded: isDiscountExcludedMenuItem\(i, c\)/.test(cwi),
    `categoriesWithItems 안에 없다 (${cwi.length}자)`
  );
  // 분류 판단은 여전히 서버 답을 그대로 쓴다 — 화면이 키 목록을 보고 다시
  // 정하지 않는다는 것이 이 검사의 뜻이다. 이제 그 답은 메뉴 줄에 실려 온다.
  check(
    "★ 화면은 할인 제외 판단을 서버 답 그대로 쓴다",
    /it\.discount_excluded === undefined \? !!c\.discount_excluded : !!it\.discount_excluded/.test(admin),
    "화면이 다시 판단하고 있다"
  );
  check(
    "화면에 음료가 박혀 있지 않다",
    !/c\.key === "drink"/.test(admin),
    'admin.js 에 c.key === "drink" 가 남아 있다'
  );
  check(
    "화면이 키 목록을 다시 안 본다",
    !/storeSettings\.vip_discount_excluded_categories/.test(admin),
    "키 목록으로 되돌아갔다"
  );
  check(
    "주문 라우트도 같은 판단을 쓴다",
    /isDiscountExcludedMenuItem\(menuItemOfOrderItem\(it\), categoryOfKey\(categoryKeyOf\(it\)\)\)/.test(orders),
    ""
  );
  // 품목별 취소선도 같은 목록이어야 한다 — 줄 그어진 품목과 실제로 깎이는
  // 품목이 다르면 사장님이 그 차이를 손으로 찾아내야 한다.
  check(
    "★ 품목별 취소선도 같은 목록을 본다",
    /vipExcludedIds = vipDiscountActive[^;]*discountExcludedItemIdSet\(\)/.test(admin),
    ""
  );
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
