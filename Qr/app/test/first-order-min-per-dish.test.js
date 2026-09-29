// 불판 「첫 주문 2인분」은 **그 메뉴를 이 자리에서 처음 시킬 때** 걸린다.
//
// 사장님(2026-09-29): "9/28 19:22 A16. 첫 주문 후 동판 1인분만 주문했는데,
// 기본 2인분부터 주문인데 이게 정상적으로 주문 접수 됨. 확인 요망. 고객에게
// 설명 후 1인분 추가 주문 유도."
//
// 원인: 서버도 손님 화면도 「이 자리의 첫 주문」만 봤다. A16 은 다른 메뉴를
// 먼저 시켰으므로 동판을 시킬 때는 검사를 통째로 건너뛰었다.
//
// 이 시험은 A16 을 그대로 다시 만든다 — 다른 메뉴 먼저, 그다음 동판 1인분.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "first-order-min-per-dish";
process.env.ADMIN_PASSWORD = "ownerpass123";

const fs = require("fs");
const path = require("path");
const request = require("supertest");
const app = require("../server");
const { store } = require("../src/db");
const { orderedItemIdsOf, firstOrderMinViolation } = require("../src/firstOrderMin");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

(async () => {
  out.push("[규칙 — 순수 함수]");
  const menu = [{ id: 10, min_first_order_qty: 2 }, { id: 20 }];
  check("★ 처음이면 1인분은 막는다", !!firstOrderMinViolation(menu, [{ item_id: 10, qty: 1 }], new Set()), "");
  check("처음이어도 2인분은 된다", !firstOrderMinViolation(menu, [{ item_id: 10, qty: 2 }], new Set()), "");
  check("牛1+豬1 처럼 두 줄이면 더해서 본다", !firstOrderMinViolation(menu, [{ item_id: 10, qty: 1 }, { item_id: 10, qty: 1 }], new Set()), "");
  check("★ 이미 시킨 메뉴면 1인분 추가도 된다", !firstOrderMinViolation(menu, [{ item_id: 10, qty: 1 }], new Set(["10"])), "");
  check("★★ 다른 메뉴를 시켰던 것은 상관없다 (A16)", !!firstOrderMinViolation(menu, [{ item_id: 10, qty: 1 }], new Set(["20"])), "");
  const ids = orderedItemIdsOf([
    { status: "paid", items: [{ item_id: 10, qty: 2 }] },
    { status: "cancelled", items: [{ item_id: 30, qty: 2 }] },
    { status: "new", items: [{ item_id: 20, qty: 1 }] },
  ]);
  check("결제한 라운드도 같은 손님 것이라 센다", ids.has("10"), "");
  check("★ 취소된 주문은 안 센다 — 불판이 안 올라갔다", !ids.has("30"), "");

  out.push("\n[A16 — 다른 메뉴 먼저, 그다음 동판 1인분]");
  // 서버가 첫 요청에서 메뉴·자리를 채운다 — 그 전에 읽으면 비어 있다.
  await request(app).get("/api/menu");
  await require("../src/db").connectDB();
  await require("./disable-order-hours")();
  const live = store.menuItems.filter((m) => !m.deleted_at);
  const grill = live.find((m) => m.mix_options && m.min_first_order_qty) || live.find((m) => m.min_first_order_qty);
  const other = live.find((m) => !m.min_first_order_qty && !m.mix_options && m.available !== 0);
  check("불판 메뉴가 있다", !!grill, "");
  const opt = grill.options ? String(grill.options).split(",")[0].split(":")[0].trim() : undefined;
  const T = store.tables.find((t) => !t.is_counter && t.number !== "T").number;

  const guest = request.agent(app);
  let r = await guest.put(`/api/tables/${T}/party-size`).send({ adults: 2, children: 0 });
  check("인원을 답했다", r.status === 200, `${r.status}`);
  r = await guest.post("/api/orders").send({ tableNumber: T, items: [{ itemId: other.id, qty: 1, orderType: "dine_in" }] });
  check("다른 메뉴 먼저 주문", r.status === 201, `${r.status} ${JSON.stringify(r.body)}`);

  r = await guest.get(`/api/tables/${T}/party-size`);
  check("★ 손님 화면이 이미 시킨 메뉴 목록을 받는다", Array.isArray(r.body.ordered_item_ids) && r.body.ordered_item_ids.includes(String(other.id)), JSON.stringify(r.body.ordered_item_ids));
  check("★ 동판은 아직 그 목록에 없다", !(r.body.ordered_item_ids || []).includes(String(grill.id)), "");

  r = await guest.post("/api/orders").send({ tableNumber: T, items: [{ itemId: grill.id, qty: 1, option: opt, orderType: "dine_in" }] });
  check("★★ 동판 1인분은 거절한다 — A16 에서는 들어갔다", r.status === 400 && r.body.error === "grill_min_qty", `${r.status} ${JSON.stringify(r.body)}`);
  check("얼마가 최소인지 같이 알려준다", r.body.min === grill.min_first_order_qty, JSON.stringify(r.body));

  r = await guest.post("/api/orders").send({ tableNumber: T, items: [{ itemId: grill.id, qty: 2, option: opt, orderType: "dine_in" }] });
  check("동판 2인분은 된다", r.status === 201, `${r.status} ${JSON.stringify(r.body)}`);
  r = await guest.post("/api/orders").send({ tableNumber: T, items: [{ itemId: grill.id, qty: 1, option: opt, orderType: "dine_in" }] });
  check("★ 이미 올라간 뒤의 1인분 추가는 된다", r.status === 201, `${r.status} ${JSON.stringify(r.body)}`);

  out.push("\n[직원 수기 주문도 같은 규칙]");
  const staff = request.agent(app);
  await staff.post("/api/auth/login").send({ password: "ownerpass123" });
  const T2 = store.tables.find((t) => !t.is_counter && t.number !== "T" && t.number !== T).number;
  await staff.put(`/api/tables/${T2}/party-size`).send({ adults: 3, children: 0 });
  r = await staff.post("/api/orders").send({ tableNumber: T2, items: [{ itemId: other.id, qty: 1, orderType: "dine_in" }] });
  check("다른 메뉴 먼저", r.status === 201, `${r.status}`);
  r = await staff.post("/api/orders").send({ tableNumber: T2, items: [{ itemId: grill.id, qty: 1, option: opt, orderType: "dine_in" }] });
  check("★ 직원이 넣어도 동판 1인분은 거절", r.status === 400 && r.body.error === "grill_min_qty", `${r.status}`);

  out.push("\n[손님 화면]");
  const orderJs = fs.readFileSync(path.join(__dirname, "../public/js/order.js"), "utf8");
  check("★ 메뉴마다 판단하는 함수가 있다", /function firstOrderMinFor\(item\)/.test(orderJs), "");
  check("★ 이미 시킨 메뉴 목록을 받아 쓴다", /data\.ordered_item_ids/.test(orderJs), "");
  check(
    "★ 자리 전체의 「첫 주문」 한 가지로 최소 수량을 정하지 않는다",
    !/min_first_order_qty && !hasPriorOrder/.test(orderJs) && !/minQty > 1 && !hasPriorOrder/.test(orderJs),
    "A16 이 그대로 다시 생긴다"
  );

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
