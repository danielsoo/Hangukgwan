// 이미 결제한 주문의 할인 내역이 보이는가.
//
// 2026-09-16 사장님(테이블 9 「이전 주문」 탭 스크린샷과 함께): "이전 주문
// 탭에서도 할인 내역이 보여야 해 결산에서 그 전 주문들을 볼 때도 보여야
// 하고."
//
// 그 화면에는 라운드마다 「소계 NT$530」처럼 **할인 전 금액만** 떠 있었다.
// 깎아준 돈은 결제하는 순간 주문에 적히는데(src/routes/orders.js
// recordDiscount: discount_amount / discount_type), 화면은 결제 **전**의
// 미리보기만 그리고 있었다. 결제가 끝나는 순간 그 값이 사라져 버린 셈이다.
//
// 손님이 "아까 깎아준 거 맞죠?" 하고 물으면 확인할 자리가 없었고, 결산
// 합계(netTotalOf 를 쓴다)와 목록의 숫자가 안 맞아 보였다.
//
// 재는 것 셋.
//  1) 서버가 그 값을 실제로 실어 보내는가 — 두 화면 모두에게
//  2) 「이전 주문」 탭이 그 값을 쓰는가, 그리고 **미결제 라운드에는 안
//     쓰는가** (2026-09-07 에 정액 할인이 라운드 수만큼 곱해져 보이던 자리)
//  3) 결산의 지난 주문 줄이 실수령액과 할인 종류를 같이 보여주는가
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"),
  filename: require.resolve("mongodb"),
  loaded: true,
  exports: fake,
  paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "past-order-discount";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const fs = require("fs");
const path = require("path");
const request = require("supertest");
const app = require("../server");
const { store } = require("../src/db");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const admin = fs.readFileSync(path.join(__dirname, "../public/js/admin.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "../public/css/admin.css"), "utf8");
const slice = (src, header, end) => {
  const i = src.indexOf(header);
  return i < 0 ? "" : src.slice(i, src.indexOf(end, i));
};

(async () => {
  const staff = request.agent(app);
  let r = await staff.post("/api/auth/login").send({ password: "ownerpass123" });
  check("로그인된다", r.status === 200, `${r.status}`);
  await require("./disable-order-hours")();

  const item = store.menuItems.find((m) => m.available && m.price > 0 && m.category_id === store.categories[0].id);
  const guest = request.agent(app);
  await guest.put("/api/tables/9/party-size").send({ adults: 2, children: 0 });
  r = await guest.post("/api/orders").send({
    tableNumber: "9",
    items: [{ itemId: item.id, qty: 2, orderType: "dine_in", addons: [] }],
  });
  check("주문이 들어간다", r.status === 201, `${r.status} ${JSON.stringify(r.body)}`);
  const orderId = r.body.id;
  const gross = store.orders.find((o) => o.id === orderId).total;

  // 「이전 주문」 탭은 **손님이 아직 앉아 계실 때** 보는 자리다. 전부
  // 결제하고 나가면 인원이 지워지고(src/partySize.js) 그 자리는 다음 손님
  // 것이 된다 — 그때는 지난 라운드를 안 보여주는 게 맞다. 사장님 화면도
  // 「현재 주문 (1)」이 같이 떠 있었다. 그래서 결제 **전에** 라운드를 하나
  // 더 넣어 착석을 살려 둔다.
  r = await guest.post("/api/orders").send({
    tableNumber: "9",
    items: [{ itemId: item.id, qty: 1, orderType: "dine_in", addons: [] }],
  });
  check("추가 주문이 들어간다 — 손님이 아직 앉아 계신 상태", r.status === 201, `${r.status} ${JSON.stringify(r.body)}`);

  r = await staff.patch(`/api/orders/${orderId}`).send({
    status: "paid", paymentMethod: "cash", vipDiscountType: "te95",
  });
  check("결제된다", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
  const paid = store.orders.find((o) => o.id === orderId);

  out.push("[1. 서버가 그 값을 실어 보낸다]");
  check("★ 깎아준 금액이 주문에 남는다", Number(paid.discount_amount) > 0, `${paid.discount_amount}`);
  check("★ 무슨 할인이었는지도 남는다", paid.discount_type === "te95", `${paid.discount_type}`);
  check("할인 전 금액은 그대로다", paid.total === gross, `${paid.total} vs ${gross}`);

  r = await staff.get("/api/orders/table/9");
  const fromTable = (Array.isArray(r.body) ? r.body : r.body.orders || []).find((o) => o.id === orderId);
  check("★ 「이전 주문」 탭이 받는 목록에 실려 온다", !!fromTable, `${r.status}`);
  check(
    "★ 할인 금액·종류가 둘 다 실려 온다",
    fromTable && Number(fromTable.discount_amount) === Number(paid.discount_amount) && fromTable.discount_type === "te95",
    JSON.stringify(fromTable && [fromTable.discount_amount, fromTable.discount_type])
  );

  const today = String(paid.created_at).slice(0, 10);
  r = await staff.get(`/api/orders/history?start=${today}&end=${today}`);
  const fromHistory = (Array.isArray(r.body) ? r.body : r.body.orders || []).find((o) => o.id === orderId);
  check("★ 결산의 지난 주문 목록에도 실려 온다", !!fromHistory, `${r.status}`);
  check(
    "★ 거기도 할인 금액·종류가 같이 온다",
    fromHistory && Number(fromHistory.discount_amount) === Number(paid.discount_amount) && fromHistory.discount_type === "te95",
    JSON.stringify(fromHistory && [fromHistory.discount_amount, fromHistory.discount_type])
  );

  out.push("\n[2. 「이전 주문」 탭이 그 값을 쓴다]");
  const parts = slice(admin, "  function buildOrderRoundParts(o, withDismiss) {", "\n  }\n");
  check("라운드 조립 함수를 찾았다", parts.length > 500, `${parts.length}`);
  check(
    "★ 결제 뒤에는 주문에 적힌 금액을 쓴다",
    /shownDiscountAmount: vipDiscountActive \? vipDiscountAmount : paidOrderDiscount\(o\)/.test(parts),
    "미리보기만 보면 결제하는 순간 할인이 화면에서 사라진다"
  );
  check("★ 결제가 끝난 라운드의 할인액을 따로 내놓는다", /paidDiscountAmount: paidOrderDiscount\(o\)/.test(parts), "");
  check("★ 무슨 할인이었는지 한 줄도 같이", /discountNoteHtml: vipDiscountActive \? "" : discountNoteHtml\(o\)/.test(parts), "");

  const merged = slice(admin, "  function renderMergedOrderGroup(orders) {", "\n  }\n");
  check("여러 라운드 화면을 찾았다", merged.length > 500, `${merged.length}`);
  check(
    "★ 소계가 할인을 반영한다",
    /vipTotalHtml\(p\.total, p\.paidDiscountAmount\)/.test(merged),
    "여기가 money(p.total) 이면 「이전 주문」은 영원히 할인 전 금액이다"
  );
  check(
    "★ 미결제 라운드에는 **안** 붙인다",
    !/vipTotalHtml\(p\.total, p\.shownDiscountAmount\)/.test(merged) && !/vipTotalHtml\(p\.total, p\.vipDiscountAmount\)/.test(merged),
    "미리보기를 라운드마다 붙이면 정액 할인이 라운드 수만큼 곱해져 보인다(2026-09-07)"
  );
  check("★ 할인 내역 줄도 붙는다", /\$\{p\.discountNoteHtml\}/.test(merged), "");

  const single = slice(admin, "  function renderTableOrderBlock(o, withDismiss) {", "\n  }\n");
  check(
    "★ 카드 하나짜리 화면도 같이 고쳤다",
    /vipTotalHtml\(p\.total, p\.shownDiscountAmount\)/.test(single) && /\$\{p\.discountNoteHtml\}/.test(single),
    "포장 카운터·주문 1건인 테이블이 이쪽이다"
  );

  // 문구가 실제로 무엇을 적는지 — 함수를 꺼내 돌려본다.
  const noteFn = slice(admin, "  function discountNoteHtml(o) {", "\n  }\n") + "\n  }";
  const labelFn =
    slice(admin, "  const discountPartLabelOf = (t) =>", "\n  const discountLabelOf") +
    "\n" +
    slice(admin, "  const discountLabelOf = (t) =>", ";\n") +
    ";";
  const made = new Function(
    "T", "money",
    `${labelFn}\n${noteFn}\n return discountNoteHtml;`
  )(
    (k) => ({ settlementDiscountManual: "직접 입력", paymentMethodUnspecified: "미지정" })[k] || k,
    (v) => Number(v).toLocaleString("en-US")
  );
  check("★ 할인이 없으면 아무것도 안 그린다", made({ discount_amount: 0 }) === "", made({ discount_amount: 0 }));
  check(
    "★ 특약 할인은 이름과 금액을 적는다",
    made({ discount_amount: 69, discount_type: "te95" }).includes("特約95折") &&
      made({ discount_amount: 69, discount_type: "te95" }).includes("−NT$69"),
    made({ discount_amount: 69, discount_type: "te95" })
  );
  check(
    "★ 둘을 같이 건 것도 풀어서 적는다",
    made({ discount_amount: 1234, discount_type: "te95+manual" }).includes("特約95折 + 직접 입력"),
    made({ discount_amount: 1234, discount_type: "te95+manual" })
  );
  check("천 자리 쉼표도 그대로", made({ discount_amount: 1234, discount_type: "manual" }).includes("−NT$1,234"), "");
  check("자리 규칙이 있다", /\.round-discount-note/.test(css), "");

  out.push("\n[3. 결산의 지난 주문]");
  // 2026-09-23: 줄이 주문 하나가 아니라 **한 손님의 묶음**이 됐다
  // (admin.js groupSettlementOrders). 금액도 묶음 단위로 적는다. 다만
  // settlementGroupTotalHtml 은 한 건짜리면 아래 settlementOrderTotalHtml 을
  // 그대로 타므로, 이 시험이 지키던 「실수령액을 보여준다」는 그대로다.
  check(
    "★ 줄 금액이 실수령액을 보여준다",
    /class="stl-order-total">\$\{settlementGroupTotalHtml\(group\)\}/.test(admin),
    "total 만 적으면 결산 합계와 안 맞아 보인다"
  );
  check(
    "★ 묶음 금액도 결국 같은 함수를 탄다 — 둘로 갈라지면 안 된다",
    /function settlementGroupTotalHtml[\s\S]{0,400}return settlementOrderTotalHtml\(group\[0\]\)/.test(admin),
    ""
  );
  const totalFn = slice(admin, "  function settlementOrderTotalHtml(o) {", "\n  }\n") + "\n  }";
  const totalHtml = new Function("money", `${totalFn}\n return settlementOrderTotalHtml;`)((v) =>
    Number(v).toLocaleString("en-US")
  );
  check("할인이 없으면 예전 그대로", totalHtml({ total: 530 }) === "NT$530", totalHtml({ total: 530 }));
  check(
    "★ 할인이 있으면 원래 금액에 줄을 긋고 실수령액을 옆에",
    totalHtml({ total: 530, discount_amount: 27 }).includes("NT$530") &&
      totalHtml({ total: 530, discount_amount: 27 }).includes("NT$503") &&
      totalHtml({ total: 530, discount_amount: 27 }).includes("stl-order-total-was"),
    totalHtml({ total: 530, discount_amount: 27 })
  );
  // 2026-09-16: 0 에서 자르지 않는다. 재량 할인은 라운드 하나에 통째로
  // 적히므로 그 줄만 음수로 보일 수 있고, 그게 실제로 일어난 일이다.
  // 잘라버리면 줄들을 더한 값이 결산 합계와 안 맞는다.
  check(
    "라운드 하나로는 음수가 보인다 — 자르면 결산 합계와 안 맞는다",
    totalHtml({ total: 100, discount_amount: 999 }).includes("NT$-899"),
    totalHtml({ total: 100, discount_amount: 999 })
  );
  check("자리 규칙이 있다", /\.stl-order-total-was/.test(css), "");

  const body = slice(admin, "  function renderSettlementOrderBody(o) {", "\n  }\n");
  check("결산 상세를 찾았다", body.length > 300, `${body.length}`);
  check(
    "★ 상세에 **무슨** 할인이었는지 적는다",
    /discountLabelOf\(o\.discount_type\)/.test(body),
    "얼마인지만 알면 사장님이 되짚는 이유의 절반만 답한 것이다"
  );
  check(
    "★ 품목 줄이 옵션 값까지 센다",
    /money\(lineTotalOf\(it\)\)/.test(body) && !/it\.unit_price \|\| 0\) \* \(it\.qty \|\| 0\)/.test(body),
    "줄들을 더해도 주문 합계가 안 나오면 사장님이 그 차이를 손으로 찾아야 한다"
  );

  out.push("\n[할인 이름표는 한 곳에서만]");
  // 결산 렌더러 안에 적혀 있던 표를 위로 올렸다. VIP_DISCOUNT_LABELS 는
  // 결제 **전** 토글 버튼에 적는 이름이라 다른 물건이다(할인 종류 키가
  // 아니라 버튼 두 개).
  check(
    "★ 결산 렌더러가 표를 따로 들고 있지 않다",
    !/const discountPartLabel = \(t\) =>/.test(admin),
    "두 군데 적으면 언젠가 한쪽만 고쳐진다"
  );
  check("결산도 그 한 곳을 쓴다", /const discountLabel = discountLabelOf;/.test(admin), "");

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
