// 결제탭 배치도 — **한 자리 = 타일 하나.** 예외 없다.
//
// 2026-09-18 사장님, 두 번에 걸쳐:
//   (겹쳐 그려진 스크린샷과 함께) "식사중에 추가주문으로 포장을 했는데 …
//    테이블이 화면이 이렇게 보이는거 왜 그러는거야"
//   → "새로 나오는 그거 없애줘. 같은 테이블에서 결제하기 전까지 같은
//      손님으로 판단하기로 했잖아. 그거 그대로 이어서 가져가서 같은
//      테이블에 추가하면 되잖아. 그 메뉴들만 포장이라고 표시해주고.
//      원래 그랬듯이."
//
// ── 무슨 일이 있었나 ─────────────────────────────────────────────────
//
// 2026-09-05 에 「완전 포장인 주문은 진짜 테이블에서도 따로 누를 수 있는
// 타일로 떼어 놓는다」를 넣었다. 그 뒤에 규칙이 하나 정해졌다 — **같은
// 자리의 주문은 결제 전까지 한 손님의 것**
// (claude/party-and-orders-are-one-set.md).
//
// 떼어 놓은 타일은 그 규칙과 정면으로 어긋난다. 식사 중인 손님이 포장을
// 하나 추가했을 뿐인데 배치도에 자리가 둘로 보이고 결제도 따로 하게 된다.
// 타일이 옆 자리 위에 겹쳐 그려지는 것으로 드러났지만, 겹침은 증상이었고
// 병은 자리를 쪼갠 것이었다. 처음에는 증상만 고쳤다(빈 자리를 찾아 놓기).
// 사장님이 병을 짚었다.
//
// 포장인 것은 그 자리 카드 안에서 **품목마다 「外帶」 배지**로 표시된다.
const fs = require("fs");
const path = require("path");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const src = fs.readFileSync(path.join(__dirname, "../public/js/admin.js"), "utf8");
const render = src.slice(
  src.indexOf("  function renderPaymentFloorPlan() {"),
  src.indexOf("\n  $(\"#viewListBtn\").onclick")
);
check("결제탭 배치도를 찾았다", render.length > 500, `${render.length}`);

out.push("[자리를 쪼개지 않는다]");
check(
  "★ 포장 주문만 따로 떼는 갈래가 없다",
  !/takeoutOrders/.test(render),
  "사장님: 같은 테이블에 추가하면 되잖아"
);
check("★ 포장 전용 타일을 안 만든다", !/takeout-order-tile/.test(render), "");
check(
  "★ 타일을 미결제 주문 수만큼 만들지 않는다",
  !/\.forEach\(\(o\) => \{[\s\S]{0,400}?createElement\("div"\)[\s\S]{0,400}?table-block/.test(render),
  "주문마다 타일을 만들면 자리가 둘로 보인다"
);
check(
  "★ 자리 하나마다 타일 하나를 만든다",
  (render.match(/document\.createElement\("div"\)/g) || []).length === 3,
  "stage · zone · table 셋뿐이어야 한다"
);
check(
  "★ 타일을 붙이는 곳도 한 군데",
  (render.match(/zoneEl\.appendChild\(/g) || []).length === 1,
  JSON.stringify(render.match(/zoneEl\.appendChild\([^)]*\)/g))
);

out.push("[빈 자리를 찾던 규칙도 같이 사라졌다]");
// 증상을 고치려고 만든 것이었다. 병을 고쳤으니 쓸 데가 없다 — 남겨두면
// 다음 사람이 「이건 왜 있지」 하게 된다.
check("★ findFreeTileSpot 이 없다", !/findFreeTileSpot/.test(src), "쓰지 않는 규칙은 지운다");
check("★ 겹침 방지 코드가 통째로 없다", !/const occupied = plans/.test(src), "");

out.push("[포장은 품목 배지로 표시된다 — 사장님이 말한 「원래 그랬듯이」]");
check(
  "★ 결제탭 품목 줄이 포장을 표시한다",
  /it\.order_type === "takeout" \? ` <span class="order-card-type-badge takeout">\$\{T\("orderCardTakeoutBadge"\)\}<\/span>` : ""/.test(src),
  "그 메뉴들만 포장이라고 표시해주고"
);
check("배지 문구가 있다 (ko)", /orderCardTakeoutBadge: "外帶"/.test(src) || /orderCardTakeoutBadge:/.test(src), "");

out.push("[포장 카운터는 예전 그대로]");
// 카운터는 서로 무관한 손님들의 주문이 쌓이는 자리다. 거기는 원래부터
// 타일 하나이고, 누르면 목록이 펼쳐진다(2026-09-05).
check(
  "★ 카운터도 타일 하나",
  !/t\.is_counter \? \[\]/.test(render),
  "카운터만 다르게 세던 갈래가 남아 있으면 안 된다"
);
check(
  "★ 타일을 누르면 그 자리 결제창이 열린다",
  /tableEl\.onclick = \(\) => openTableDetail\(t\.number, t\.label\);/.test(render),
  "주문 하나로 좁혀 들어가지 않는다"
);
check(
  "★ 주문 하나로 좁혀 여는 호출이 배치도에 없다",
  !/openTableDetail\(t\.number, t\.label, o\.id\)/.test(src),
  "그게 자리를 둘로 보이게 하던 길이었다"
);

out.push("[그 밖의 규칙은 건드리지 않았다]");
check("미결제가 있으면 붉게", /\(unpaid\.length \? " has-order" : ""\)/.test(render), "");
check("시험용 자리 표시", /isTestTable\(t\) \? " test-table" : ""/.test(render), "");
check("인원수 표시", /fmtPartySeat\(t\)/.test(render), "");
check("자리 좌표를 그대로 쓴다", /t\.x != null \? t\.x : 10/.test(render) && /t\.y != null \? t\.y : ZONE_HEADER_HEIGHT/.test(render), "");
check("다 그린 뒤 화면에 맞춘다", /fitPaymentFloorPlan\(\);/.test(render), "");

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
