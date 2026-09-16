// 한 테이블을 여러 번 나눠 주문했어도, 재량 할인은 **한 장의 계산서에 한 번**
// 걸리고 기록도 한 줄로 남는가 — 실제 서버를 세워서 끝까지 돌려본다.
//
// 2026-09-16 사장님: "아니 한 손님이라면 그냥 전체 가격에서 까면 된다니까?
// 이해가 안돼?"
//
// src/discounts.js 의 산수는 test/manual-discount-split.test.js 가 따로
// 잰다. 여기서 재는 것은 **배선**이다 — 화면이 보낸 요청 하나가 서버를 지나
// 주문 문서에 어떻게 적히는가, 그리고 그 결과를 결산이 어떻게 더하는가.
// 산수가 맞아도 배선이 틀리면 사장님 눈에는 똑같이 틀려 보인다.
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
process.env.SESSION_SECRET = "pay-table-one-discount";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const request = require("supertest");
const app = require("../server");
const { store } = require("../src/db");
const { computeSettlement } = require("../src/settlement");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

(async () => {
  const staff = request.agent(app);
  let r = await staff.post("/api/auth/login").send({ password: "ownerpass123" });
  check("로그인된다", r.status === 200, `${r.status}`);
  await require("./disable-order-hours")();

  const item = store.menuItems.find((m) => m.available && m.price > 0 && m.category_id === store.categories[0].id);
  const guest = request.agent(app);

  /** 한 테이블에 라운드를 세 번 넣는다 — 손님 한 분이 나눠서 시킨 것이다. */
  async function seatAndOrder(table, qtys) {
    await guest.put(`/api/tables/${table}/party-size`).send({ adults: 2, children: 0 });
    const ids = [];
    for (const qty of qtys) {
      const res = await guest.post("/api/orders").send({
        tableNumber: String(table),
        items: [{ itemId: item.id, qty, orderType: "dine_in", addons: [] }],
      });
      if (res.status !== 201) throw new Error(`주문 실패 ${res.status} ${JSON.stringify(res.body)}`);
      ids.push(res.body.id);
    }
    return ids;
  }
  const selectionsOf = (ids) =>
    ids.map((id) => {
      const o = store.orders.find((x) => x.id === id);
      return { orderId: id, itemIndexes: o.items.map((_, i) => i) };
    });
  const grossOf = (ids) => ids.reduce((s, id) => s + store.orders.find((o) => o.id === id).total, 0);
  const ordersOf = (ids) => ids.map((id) => store.orders.find((o) => o.id === id));

  out.push("[한 번의 결제, 한 줄의 할인]");
  {
    const ids = await seatAndOrder(9, [3, 2, 1]);
    check("라운드 셋이 들어갔다", ids.length === 3, JSON.stringify(ids));
    const gross = grossOf(ids);
    r = await staff.post("/api/orders/pay-table").send({
      selections: selectionsOf(ids),
      paymentMethod: "cash",
      manualDiscountMode: "amount",
      manualDiscountValue: 10,
    });
    check("★ 요청 하나로 결제된다", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
    const paid = ordersOf(ids);
    check("★ 라운드가 전부 결제됐다", paid.every((o) => o.status === "paid"), JSON.stringify(paid.map((o) => o.status)));

    const manuals = paid.map((o) => Number(o.discount_manual_amount || 0));
    check("★ 할인이 적힌 자리는 한 곳뿐", manuals.filter((x) => x > 0).length === 1, JSON.stringify(manuals));
    check("★ 그 한 곳에 10원 통째로", manuals.filter((x) => x > 0)[0] === 10, JSON.stringify(manuals));
    check("★ 다 더해도 10원", manuals.reduce((a, b) => a + b, 0) === 10, JSON.stringify(manuals));
    check(
      "★ 「직접 입력」 이름표도 한 줄에만",
      paid.filter((o) => String(o.discount_type || "").includes("manual")).length === 1,
      JSON.stringify(paid.map((o) => o.discount_type))
    );
    check(
      "실제로 받은 돈은 할인만큼만 줄었다",
      paid.reduce((s, o) => s + (o.total - (o.discount_amount || 0)), 0) === gross - 10,
      `${paid.reduce((s, o) => s + (o.total - (o.discount_amount || 0)), 0)} vs ${gross - 10}`
    );

    const ids2 = new Set(paid.map((o) => (o.payment_ids || []).join(",")));
    check("★ 결제 한 번 = 이름표 하나", ids2.size === 1 && [...ids2][0] !== "", JSON.stringify([...ids2]));
    check("이름표가 응답에도 있다", Number(r.body.paymentId) > 0, JSON.stringify(r.body.paymentId));
  }

  out.push("\n[할인이 라운드 하나보다 커도 쪼개지지 않는다]");
  // 옛 방식이 두 라운드로 흘려보내던 바로 그 경우다.
  {
    const ids = await seatAndOrder(11, [3, 2, 1]);
    const gross = grossOf(ids);
    const biggest = Math.max(...ordersOf(ids).map((o) => o.total));
    const off = biggest + 50; // 제일 큰 라운드에도 안 들어가는 금액
    check("제일 큰 라운드보다 큰 할인이다", off > biggest && off < gross, `${off} / ${biggest} / ${gross}`);
    r = await staff.post("/api/orders/pay-table").send({
      selections: selectionsOf(ids),
      paymentMethod: "cash",
      manualDiscountMode: "amount",
      manualDiscountValue: off,
    });
    check("결제된다", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
    const paid = ordersOf(ids);
    const manuals = paid.map((o) => Number(o.discount_manual_amount || 0));
    check("★ 여전히 한 곳에만 적힌다", manuals.filter((x) => x > 0).length === 1, JSON.stringify(manuals));
    check("★ 금액도 자르지 않는다", manuals.filter((x) => x > 0)[0] === off, `${JSON.stringify(manuals)} / ${off}`);
    check(
      "★ 받은 돈이 정확하다 — 넘친 만큼이 매출에 남지 않는다",
      paid.reduce((s, o) => s + (o.total - (o.discount_amount || 0)), 0) === gross - off,
      `${paid.reduce((s, o) => s + (o.total - (o.discount_amount || 0)), 0)} vs ${gross - off}`
    );
  }

  out.push("\n[결산이 더한 값도 맞는다]");
  {
    const today = store.orders.find((o) => o.status === "paid").created_at.slice(0, 10);
    const paidToday = store.orders.filter((o) => o.status === "paid" && o.created_at.slice(0, 10) === today);
    const expectRevenue = paidToday.reduce((s, o) => s + (o.total - (o.discount_amount || 0)), 0);
    const snap = computeSettlement(store.orders, today);
    check("★ 매출이 실제로 받은 돈과 같다", snap.total_revenue === expectRevenue, `${snap.total_revenue} vs ${expectRevenue}`);
    const manualRow = (snap.discount_breakdown || []).find((e) => e.discount_type === "manual");
    check("★ 「직접 입력」 줄이 있다", !!manualRow, JSON.stringify(snap.discount_breakdown));
    if (manualRow) {
      check(
        "★ 결제 두 번이면 2건 — 라운드 수만큼 부풀지 않는다",
        manualRow.order_count === 2,
        `${manualRow.order_count}건 (라운드로 세면 6건이 됐다)`
      );
    }
  }

  out.push("\n[안 되는 것은 막는다]");
  {
    const a = await seatAndOrder(12, [2]);
    const b = await seatAndOrder(13, [2]);
    r = await staff.post("/api/orders/pay-table").send({
      selections: [...selectionsOf(a), ...selectionsOf(b)],
      paymentMethod: "cash",
    });
    check("★ 다른 테이블이 섞이면 거절한다", r.status === 400 && r.body.error === "mixed_tables", `${r.status} ${JSON.stringify(r.body)}`);
    check("★ 거절당한 주문은 손대지 않았다", ordersOf(a).every((o) => o.status !== "paid"), "");

    r = await staff.post("/api/orders/pay-table").send({ selections: [], paymentMethod: "cash" });
    check("빈 요청은 거절한다", r.status === 400, `${r.status}`);

    r = await staff.post("/api/orders/pay-table").send({
      selections: [...selectionsOf(a), { orderId: 999999, itemIndexes: [0] }],
      paymentMethod: "cash",
    });
    check("없는 주문이 섞이면 거절한다", r.status === 404, `${r.status}`);
    check("★ 그때도 나머지는 그대로다 — 반만 결제된 테이블이 안 남는다", ordersOf(a).every((o) => o.status !== "paid"), "");
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log(out.join("\n"));
  console.error(e);
  process.exit(1);
});
