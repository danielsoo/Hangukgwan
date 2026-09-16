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

out.push("\n[이미 깎아 파는 세트에는 할인이 안 걸린다]");
  //
  // 2026-09-16 사장님: "김밥 + 라면 세트 메뉴 그거 이미 할인이 들어간 거라
  // 추가 vip 할인이나 퍼센트 할인에는 적용이 안되도록 해줘 할인 제외 애들처럼."
  //
  // 세트는 정가(따로 시켰을 때의 값)가 판매가보다 높게 적혀 있다. 그 차이가
  // 곧 이미 깎아준 금액이라, 또 9折 을 걸면 두 번 깎인다.
  const { isSetDiscountItem } = require("../src/discounts");
  check("★ 정가가 더 높으면 세트로 본다", isSetDiscountItem({ unit_price: 280, original_price: 330 }) === true, "");
  check("정가가 없으면 아니다", isSetDiscountItem({ unit_price: 280 }) === false, "");
  check("정가가 더 낮으면 아니다 — 잘못 적은 값에 휘둘리지 않는다", isSetDiscountItem({ unit_price: 280, original_price: 200 }) === false, "");
  check("메뉴 쪽 모양(price)도 읽는다", isSetDiscountItem({ price: 280, original_price: 330 }) === true, "");

  r = await staff.post("/api/menu/admin/items").send({
    category_id: cat.id, name_zh: "세트시험", name_ko: "세트시험",
    price: 280, original_price: 330, force_new: true,
  });
  check("세트 메뉴가 만들어진다", r.status === 201, `${r.status} ${JSON.stringify(r.body)}`);
  const setId = r.body.id;

  async function orderSet(table) {
    const g = request.agent(app);
    await g.put(`/api/tables/${table}/party-size`).send({ adults: 2, children: 0 });
    const res = await g.post("/api/orders").send({
      tableNumber: String(table),
      items: [{ itemId: setId, qty: 2, orderType: "dine_in", addons: [] }],
    });
    if (res.status !== 201) throw new Error(`주문 실패 ${res.status} ${JSON.stringify(res.body)}`);
    return store.orders.find((x) => x.id === res.body.id);
  }

  let so = await orderSet(9);
  check("★ 정가가 주문에 찍힌다 — 나중에 메뉴를 고쳐도 판단이 안 흔들린다", so.items[0].original_price === 330, `${so.items[0].original_price}`);
  r = await staff.patch(`/api/orders/${so.id}`).send({ status: "paid", paymentMethod: "cash", vipDiscountType: "vip9" });
  check("결제된다", r.status === 200, `${r.status}`);
  let sAfter = store.orders.find((x) => x.id === so.id);
  check("★ VIP9折이 하나도 안 걸린다", (sAfter.discount_amount || 0) === 0, `${sAfter.discount_amount} (560 의 10% 면 56)`);

  so = await orderSet(10);
  r = await staff.patch(`/api/orders/${so.id}`).send({
    status: "paid", paymentMethod: "cash", manualDiscountMode: "percent", manualDiscountValue: 10,
  });
  sAfter = store.orders.find((x) => x.id === so.id);
  check("★ 재량 퍼센트 할인도 안 걸린다 — 「vip 할인이나 퍼센트 할인」 둘 다다", (sAfter.discount_amount || 0) === 0, `${sAfter.discount_amount}`);

  // 세트와 보통 메뉴가 같이 있으면 보통 메뉴에만 걸린다.
  const g = request.agent(app);
  await g.put("/api/tables/11/party-size").send({ adults: 2, children: 0 });
  r = await g.post("/api/orders").send({
    tableNumber: "11",
    items: [
      { itemId: setId, qty: 1, orderType: "dine_in", addons: [] },   // 280, 세트
      { itemId: dak, qty: 2, orderType: "dine_in", addons: [] },     // 600, 보통
    ],
  });
  const mixed = store.orders.find((x) => x.id === r.body.id);
  await staff.patch(`/api/orders/${mixed.id}`).send({ status: "paid", paymentMethod: "cash", vipDiscountType: "vip9" });
  const mAfter = store.orders.find((x) => x.id === mixed.id);
  check("★ 섞여 있으면 세트만 빠진다 — 600 의 10%", (mAfter.discount_amount || 0) === 60, `${mAfter.discount_amount} (880 기준이면 88)`);

  out.push("\n[화면도 같은 규칙을 쓴다]");
  check("★ 관리자 화면이 세트를 뺀다", /isSetDiscountItem\(it\)/.test(files["관리자 화면"]), "화면만 깎아 보여주면 직원이 틀린 숫자를 부른다");
  // 함수가 **정의만** 돼 있고 안 쓰이면 소용이 없다. 두 함수의 몸통을 직접
  // 잘라서 그 안에서 무엇을 더하는지 본다.
  const bodyOf = (src, header) => {
    const i = src.indexOf(header);
    return i < 0 ? "" : src.slice(i, src.indexOf("\n  }\n", i));
  };
  const eligible = bodyOf(files["관리자 화면"], "  function discountEligibleClientTotal(");
  const full = bodyOf(files["관리자 화면"], "  function fullEligibleClientTotal(");
  check("두 함수를 찾았다", eligible.length > 50 && full.length > 50, `${eligible.length}/${full.length}`);
  check(
    "★ 화면의 할인 기준도 추가 옵션을 뺀다",
    /discountBaseOfClient\(it\)/.test(eligible) && !/lineTotalOf\(it\)/.test(eligible),
    "서버는 안 깎는데 화면만 깎아 보여주면 부르는 숫자가 틀어진다"
  );
  check(
    "★ 재량 할인 기준도 같다",
    /discountBaseOfClient\(it\)/.test(full) && !/lineTotalOf\(it\)/.test(full),
    ""
  );
  check("★ 두 함수 다 세트를 뺀다", /isSetDiscountItem\(it\)/.test(eligible) && /isSetDiscountItem\(it\)/.test(full), "");

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
