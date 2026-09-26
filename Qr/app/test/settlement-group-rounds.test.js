// 결산에서 한 손님의 여러 라운드를 한 줄로 묶는다. 포장은 안 묶는다.
//
// 2026-09-23 사장님: "한 테이블에서 여러번 나눠서 주문해서 나중에 한 번에
// 결제할 때는 한 테이블에서 다 주문 한 걸로 잘 나오는데 결산에서는 건별로
// 나뉘어져 있어서 보기 좀 힘들어. 그거 통합해주고. 근데 포장은 냅둬야 돼."
//
// ── 묶는 근거를 새로 만들지 않았다
//
// pay-table 이 결제 한 번에 번호 하나를 붙여 둔다(src/routes/orders.js
// payment_ids). 그 자리 주석에 "이 번호가 같으면 손님이 한 번에 낸 돈이다,
// 나중에 결산에서 라운드를 다시 묶을 수 있는 유일한 근거다" 라고 적혀 있다.
// 근거는 이미 있었고 결산만 안 쓰고 있었다.
//
// ── 이 시험이 지키는 선
//
// 묶는 일은 **남의 밥값을 한 줄로 합칠 수 있는** 일이다. 그래서 「묶이는가」
// 보다 **「엉뚱한 것이 묶이지 않는가」**를 더 많이 잰다:
//
//   · 같은 테이블이라도 결제가 다르면 안 묶인다   ← 다음 손님이 앉은 경우
//   · 포장 카운터는 번호가 같아도 안 묶인다        ← 서로 무관한 손님이다
//   · 번호가 없으면 각자 선다
const fs = require("fs");
const path = require("path");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const APP = path.join(__dirname, "..");
const admin = fs.readFileSync(path.join(APP, "public/js/admin.js"), "utf8");
const css = fs.readFileSync(path.join(APP, "public/css/admin.css"), "utf8");

function fnSource(src, name) {
  const head = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(src);
  if (!head) return null;
  let i = src.indexOf("{", head.index);
  let depth = 0;
  for (let end = i; end < src.length; end++) {
    if (src[end] === "{") depth++;
    else if (src[end] === "}") {
      depth--;
      if (depth === 0) return src.slice(head.index, end + 1);
    }
  }
  return null;
}

// 떼어내서 진짜 돌린다. isCounterOrder 는 화면 상태(tables)를 보므로 대신
// 넣어준다 — 여기서 재는 것은 「카운터냐」의 판정이 아니라 「카운터면 안
// 묶느냐」다.
const src = fnSource(admin, "groupSettlementOrders");
check("groupSettlementOrders 가 있다", !!src);
let group = null;
try {
  group = new Function(
    "isCounterOrder",
    `${src}\n return groupSettlementOrders;`
  )((o) => !!o.is_counter);
} catch (e) {
  check("떼어내서 돌릴 수 있다", false, String(e && e.message));
}

const ord = (id, over = {}) =>
  Object.assign({ id, table_number: "5", created_at: `2026-09-23 18:0${id}:00`, total: 100, items: [] }, over);
const ids = (groups) => groups.map((g) => g.map((o) => o.id));

if (group) {
  check("떼어내서 돌릴 수 있다", true);

  out.push("\n[한 손님이 나눠 시킨 것은 한 줄]");
  {
    const g = group([ord(1, { payment_ids: [7] }), ord(2, { payment_ids: [7] }), ord(3, { payment_ids: [7] })]);
    check("★ 같은 결제 번호는 한 묶음", g.length === 1 && g[0].length === 3, JSON.stringify(ids(g)));
  }

  out.push("\n[엉뚱한 것이 묶이면 안 된다]");
  {
    // 같은 5번 자리지만 결제가 둘 — 점심 손님과 저녁 손님이다.
    const g = group([ord(1, { payment_ids: [7] }), ord(2, { payment_ids: [8] })]);
    check("★★ 같은 테이블이라도 결제가 다르면 안 묶인다", g.length === 2, JSON.stringify(ids(g)));
  }
  {
    const g = group([ord(1), ord(2)]);
    check("★ 결제 번호가 없으면 각자 선다", g.length === 2, JSON.stringify(ids(g)));
  }
  {
    const g = group([ord(1, { payment_ids: [] }), ord(2, { payment_ids: [] })]);
    check("★ 빈 번호 목록도 각자 선다", g.length === 2, JSON.stringify(ids(g)));
  }

  out.push("\n[포장은 냅둔다]");
  {
    // 번호가 같아도 카운터면 안 묶는다. 서로 무관한 손님 것이다.
    const g = group([
      ord(1, { is_counter: true, payment_ids: [9] }),
      ord(2, { is_counter: true, payment_ids: [9] }),
    ]);
    check("★★ 포장 카운터는 번호가 같아도 각자 선다", g.length === 2, JSON.stringify(ids(g)));
  }
  {
    // tables 가 아직 안 실려 isCounterOrder 가 false 를 주는 순간을 흉내낸다.
    // pickup_number 로도 걸러내지 않으면 그때 포장이 통째로 묶인다.
    const g = group([
      ord(1, { pickup_number: 11, customer_name: "왕", payment_ids: [9] }),
      ord(2, { pickup_number: 12, customer_name: "리", payment_ids: [9] }),
    ]);
    check("★★ isCounterOrder 가 못 알아봐도 픽업 번호로 걸러낸다", g.length === 2, JSON.stringify(ids(g)));
  }

  out.push("\n[부분결제로 번호를 여럿 가진 주문]");
  {
    // 2번이 7번 결제와 8번 결제에 걸쳐 있다 — 셋은 한 손님이다.
    const g = group([ord(1, { payment_ids: [7] }), ord(2, { payment_ids: [7, 8] }), ord(3, { payment_ids: [8] })]);
    check("★ 번호를 하나라도 공유하면 한 묶음", g.length === 1 && g[0].length === 3, JSON.stringify(ids(g)));
  }
  {
    // 잇는 주문이 **나중에** 올 때도 합쳐져야 한다 (순서에 안 기댄다).
    const g = group([ord(1, { payment_ids: [7] }), ord(3, { payment_ids: [8] }), ord(2, { payment_ids: [7, 8] })]);
    check("★ 잇는 주문이 뒤에 와도 합친다", g.length === 1 && g[0].length === 3, JSON.stringify(ids(g)));
  }

  out.push("\n[묶음 안은 시킨 순서대로]");
  {
    const g = group([
      ord(3, { payment_ids: [7], created_at: "2026-09-23 19:00:00" }),
      ord(1, { payment_ids: [7], created_at: "2026-09-23 18:00:00" }),
      ord(2, { payment_ids: [7], created_at: "2026-09-23 18:30:00" }),
    ]);
    check("★ 1번째·2번째가 눈에 보이는 순서로", JSON.stringify(ids(g)) === "[[1,2,3]]", JSON.stringify(ids(g)));
  }
}

out.push("\n[화면에 그리는 쪽]");
{
  const render = fnSource(admin, "renderSettlementOrders") || "";
  check("★ 그릴 때 묶은 것을 쓴다", /groupSettlementOrders\(orders\)/.test(render), "");
  check(
    "★ 묶였다는 것을 화면에 보인다 — 안 보이면 금액이 왜 큰지 모른다",
    /settlementOrdersRounds/.test(render),
    ""
  );
  check(
    "★ 줄 수와 원래 건수를 같이 적는다",
    // 2026-09-26: 머리줄은 fmtSettlementOrdersCount 가 적는다 — 「테이블 N · 포장 M ·
    // 주문 K번」. 원래 건수(주문 K번)를 같이 적는 것은 그대로다.
    /fmtSettlementOrdersCount\(groups, orders\)/.test(render) &&
      /settlementRoundsCount/.test(fnSource(admin, "fmtVisitCounts") || ""),
    "「5건」만 적혀 있는데 결제 건수가 8이면 어느 쪽이 맞는지 알 수 없다"
  );
  check(
    "★★ 묶음 전체가 취소일 때만 취소로 칠한다",
    /group\.every\(\(o\) => o\.status === "cancelled"\)/.test(render),
    "한 라운드만 취소된 것을 묶음째 취소로 칠하면 받은 돈이 안 받은 것처럼 보인다"
  );
  check(
    "★ 묶음 머리에는 인쇄 버튼을 안 단다 — 어느 라운드인지 알 수 없다",
    /rounds === 1[\s\S]{0,200}data-stl-print/.test(render),
    ""
  );
  check("★ 펼치면 라운드마다 제 버튼이 있다", /stl-order-round-head[\s\S]{0,300}data-stl-print/.test(render), "");

  const total = fnSource(admin, "settlementGroupTotalHtml") || "";
  check("묶음 금액을 따로 낸다", !!total);
  check("★ 라운드 금액을 더한다", /reduce/.test(total) && /o\.total/.test(total), "");
  check("★ 할인도 더해서 뺀다 — 실제로 받은 돈이어야 한다", /discount_amount/.test(total), "");
}

out.push("\n[문구와 모양]");
for (const key of ["settlementOrdersRounds", "settlementOrdersRoundNo", "settlementOrdersCountRounds"]) {
  const hits = admin.split(`${key}:`).length - 1;
  check(`${key} 가 두 언어에 다 있다`, hits === 2, `${hits}군데`);
}
check("묶음 배지 CSS 가 있다", /\.stl-order-rounds/.test(css));
check("라운드 칸 CSS 가 있다", /\.stl-order-round\b/.test(css));

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
