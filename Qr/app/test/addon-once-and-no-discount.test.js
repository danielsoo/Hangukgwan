// 옵션 값은 **한 번만** 붙고, 추가 옵션에는 **할인이 안 걸린다.**
//
// 2026-09-16 사장님:
//   "닭갈비 같은 경우는 기본 주문이 2인분이여서 그런지 저 옵션이 1개를
//    올렸는데 2개 올라간 가격으로 측정이 돼."
//   "가격에 넣은 그 액수만큼 올라가게 해줘. 최소 주문 관련 없이"
//   "추가 옵션으로 들어가는 모든 주문은 할인을 하면 안돼."
//
// ── 무엇이 틀렸었나 ────────────────────────────────────────────────────
//
// 줄 금액이 `(밥값 + 추가옵션) × 수량` 이었다. 닭갈비는 첫 주문이 2인분이라
// 수량이 2 에서 시작하는데, 손님이 치즈 하나를 얹으면 그 값에도 2 가
// 곱해졌다. 손님이 체크한 것은 하나다.
//
// 이제 `밥값 × 수량 + 옵션 값 + 추가 옵션 값` 이다.
//
// 그리고 할인은 추가 옵션을 빼고 건다. 크기 같은 「하나만 고르는 옵션」의
// 값은 이 음식의 값 자체라 할인 기준에 들어간다 — 따로 시킨 것이 아니다.
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
process.env.SESSION_SECRET = "addon-once";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const fs = require("fs");
const path = require("path");
const request = require("supertest");
const app = require("../server");
const { store } = require("../src/db");
const { lineTotalOf, discountBaseOf, computeDiscountAmount } = require("../src/discounts");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

(async () => {
  out.push("[줄 금액 규칙]");
  const line = { unit_price: 300, qty: 2, option_price: 150, selected_addons: [{ name: "치즈", price: 50 }] };
  check("★ 밥값만 수량을 곱한다", lineTotalOf(line) === 300 * 2 + 150 + 50, `${lineTotalOf(line)}`);
  check("★ 수량이 늘어도 옵션 값은 그대로다", lineTotalOf({ ...line, qty: 5 }) === 300 * 5 + 150 + 50, `${lineTotalOf({ ...line, qty: 5 })}`);
  check("옵션이 없으면 예전과 같다", lineTotalOf({ unit_price: 300, qty: 2 }) === 600, "");
  check("★ 할인 기준은 추가 옵션을 뺀다", discountBaseOf(line) === 300 * 2 + 150, `${discountBaseOf(line)}`);
  check("★ 할인 기준에 크기 값은 들어간다 — 이 음식의 값이다", discountBaseOf(line) - 600 === 150, "");

  out.push("\n[할인 계산]");
  {
    // 밥 600 + 크기 150 + 추가 50 = 800. 할인은 750 에만 걸린다.
    const items = [line];
    const d = computeDiscountAmount("vip9", null, items, [0], () => false);
    check("★ VIP9折은 750 의 10% = 75", d.vipAmount === 75, `${d.vipAmount} (800 기준이면 80)`);
    const m = computeDiscountAmount(null, { mode: "percent", value: 10 }, items, [0], () => false);
    check("★ 재량 할인도 추가 옵션은 안 깎는다", m.manualAmount === 75, `${m.manualAmount}`);
  }

  const staff = request.agent(app);
  let r = await staff.post("/api/auth/login").send({ password: "ownerpass123" });
  check("로그인된다", r.status === 200, `${r.status}`);
  await require("./disable-order-hours")();

  // 닭갈비처럼 첫 주문 2인분 + 추가 옵션이 붙은 메뉴.
  const cat = store.categories[0];
  r = await staff.post("/api/menu/admin/items").send({
    category_id: cat.id,
    name_zh: "닭갈비시험",
    name_ko: "닭갈비시험",
    price: 300,
    min_first_order_qty: 2,
    addons: "치즈 추가:50,사리면:40",
    force_new: true,
  });
  check("메뉴가 만들어진다", r.status === 201, `${r.status} ${JSON.stringify(r.body)}`);
  const dak = r.body.id;

  async function order(table, qty, addons) {
    const guest = request.agent(app);
    await guest.put(`/api/tables/${table}/party-size`).send({ adults: 2, children: 0 });
    const res = await guest.post("/api/orders").send({
      tableNumber: String(table),
      items: [{ itemId: dak, qty, orderType: "dine_in", addons: addons || [] }],
    });
    if (res.status !== 201) throw new Error(`주문 실패 ${res.status} ${JSON.stringify(res.body)}`);
    return store.orders.find((o) => o.id === res.body.id);
  }

  out.push("\n[닭갈비 — 첫 주문 2인분]");
  let o = await order(5, 2, ["치즈 추가"]);
  check("★ 치즈 하나를 얹었으면 50 만 붙는다", o.total === 650, `${o.total} (300 x2 + 50 이어야 한다. 예전에는 700 이었다)`);
  o = await order(6, 2, null);
  check("추가 옵션이 없으면 600", o.total === 600, `${o.total}`);
  o = await order(7, 4, ["치즈 추가", "사리면"]);
  check("★ 4인분에 두 가지를 얹어도 값은 한 번씩", o.total === 300 * 4 + 50 + 40, `${o.total}`);

  out.push("\n[추가 옵션에는 할인이 안 걸린다]");
  const paid = await order(8, 2, ["치즈 추가"]); // 650, 할인 기준은 600
  r = await staff.patch(`/api/orders/${paid.id}`).send({ status: "paid", paymentMethod: "cash", vipDiscountType: "vip9" });
  check("결제된다", r.status === 200, `${r.status}`);
  const after = store.orders.find((x) => x.id === paid.id);
  check("★ 600 의 10% 만 깎인다 — 650 기준이면 65", (after.discount_amount || 0) === 60, `${after.discount_amount}`);
  check("받는 돈은 650 - 60", (after.total || 0) - (after.discount_amount || 0) === 590, `${after.total} - ${after.discount_amount}`);

  out.push("\n[화면·종이가 같은 규칙을 쓴다]");
  const files = {
    "관리자 화면": fs.readFileSync(path.join(__dirname, "../public/js/admin.js"), "utf8"),
    "손님 화면": fs.readFileSync(path.join(__dirname, "../public/js/order.js"), "utf8"),
    종이: fs.readFileSync(path.join(__dirname, "../public/js/escpos.js"), "utf8"),
  };
  for (const [who, src] of Object.entries(files)) {
    check(
      `★ ${who} 도 밥값에만 수량을 곱한다`,
      /\(it\.unit_price \|\| 0\) \* \(it\.qty \|\| 0\) \+ optPrice \+ addons/.test(src),
      "옵션 값에 수량을 곱하면 닭갈비에서 두 배가 된다"
    );
    check(
      `${who} 에 옛 식이 남아 있지 않다`,
      !/\(it\.unit_price \+ \(it\.selected_addons \|\| \[\]\)\.reduce/.test(src),
      "한 군데만 남아도 그 화면만 다른 숫자를 부른다"
    );
  }
  check(
    "★ 손님 화면 담기 버튼도 한 번만 더한다",
    /currentItem\.price \* currentQty \+ optPrice \+ addonsPrice/.test(files["손님 화면"]),
    ""
  );
  check(
    "★ 장바구니 합계도 한 번만 더한다",
    /c\.item\.price \* c\.qty \+[\s\S]{0,120}?addonsPriceFor/.test(files["손님 화면"]),
    ""
  );
  check(
    "★ 관리자 수기 주문도 한 번만 더한다",
    /mi\.price \* qty \+ optPrice \+ addonsPrice/.test(files["관리자 화면"]),
    ""
  );
  const settlement = fs.readFileSync(path.join(__dirname, "../src/settlement.js"), "utf8");
  check(
    "★ 결산도 같은 함수를 쓴다",
    /const lineAmount = \(it\) => lineTotalOf\(it\)/.test(settlement),
    "결산이 따로 더하면 매출과 주문 화면이 갈린다"
  );

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
