// 직원이 앉아 계신 손님의 인원수를 고친다 — 그리고 결산 손님 수가 따라온다.
//
// 사장님(2026-09-29): "고객의 인원수 수정항목 추가 요청. 수기로 수정하는
// 항목에 인원수 수정이 아직 없는듯. 메뉴는 추가 취소 등 수정 가능한데,
// 인원수는 없는거같애. ... 일부 고객은 기본 1인으로 설정된 인원수로
// 주문/식사를 함. ... 궁극적으로는 식사 고객수 집계가 적어지게 되고,
// 누적되면 더 커지게 됨."
//
// 정말 없었다 — 비우기(DELETE)만 있었다. 그리고 자리 숫자만 고쳐서는 집계가
// 안 고쳐진다: 결산은 **주문에 찍힌 인원**으로 센다. 이 시험은 그 끝까지 본다.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "party-edit";
process.env.ADMIN_PASSWORD = "ownerpass123";

const fs = require("fs");
const path = require("path");
const request = require("supertest");
const app = require("../server");
const { store, findOrders } = require("../src/db");
const { computeSettlement } = require("../src/settlement");
const { taipeiDateString } = require("../src/time");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

(async () => {
  await request(app).get("/api/menu");
  await require("../src/db").connectDB();
  await require("./disable-order-hours")();
  const food = store.menuItems.find((m) => !m.deleted_at && !m.min_first_order_qty && !m.mix_options && m.available !== 0);
  const T = store.tables.find((t) => !t.is_counter && t.number !== "T").number;

  out.push("[손님이 1명으로 앉아 두 번 시켰다 — 실제로는 넷이 드셨다]");
  const guest = request.agent(app);
  await guest.put(`/api/tables/${T}/party-size`).send({ adults: 1, children: 0 });
  let r = await guest.post("/api/orders").send({ tableNumber: T, items: [{ itemId: food.id, qty: 1, orderType: "dine_in" }] });
  check("첫 주문", r.status === 201, `${r.status}`);
  r = await guest.post("/api/orders").send({ tableNumber: T, items: [{ itemId: food.id, qty: 2, orderType: "dine_in" }] });
  check("두 번째 주문", r.status === 201, `${r.status}`);
  const seatBefore = store.tables.find((t) => t.number === T).party_size_updated_at;

  out.push("\n[손님 폰으로는 못 고친다]");
  r = await guest.patch(`/api/tables/${T}/party-size`).send({ adults: 4, children: 0 });
  check("★ 직원이 아니면 막는다", r.status === 401 || r.status === 403, `${r.status}`);

  out.push("\n[직원이 고친다 — 어른 3 · 아이 1]");
  const staff = request.agent(app);
  await staff.post("/api/auth/login").send({ password: "ownerpass123" });
  r = await staff.patch(`/api/tables/${T}/party-size`).send({ adults: 3, children: 1 });
  check("고쳐진다", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
  check("★ 이미 들어간 주문 둘도 같이 고쳤다고 답한다", r.body.orders_updated === 2, JSON.stringify(r.body));
  const t = store.tables.find((x) => x.number === T);
  check("자리 숫자가 4 (3-1)", t.party_size === 4 && t.party_adults === 3 && t.party_children === 1, JSON.stringify([t.party_size, t.party_adults, t.party_children]));
  check("★ 착석 시각은 그대로 — 새로 앉힌 것이 아니다", t.party_size_updated_at === seatBefore, `${seatBefore} → ${t.party_size_updated_at}`);

  const saved = await findOrders({ table_number: T });
  check("★ 저장된 주문에도 4 가 찍혔다", saved.length === 2 && saved.every((o) => o.party_size === 4 && o.party_children === 1), JSON.stringify(saved.map((o) => o.party_size)));

  out.push("\n[★★ 결산 손님 수가 따라온다 — 사장님이 걱정한 것]");
  // 결산은 결제된 주문으로 센다 — 손님이 다 드시고 낸 뒤를 본다.
  for (const o of saved) {
    const pr = await staff.patch(`/api/orders/${o.id}`).send({ status: "paid", paymentMethod: "cash" });
    if (pr.status !== 200) out.push(`        결제 실패 ${pr.status} ${JSON.stringify(pr.body)}`);
  }
  const today = taipeiDateString();
  const s = computeSettlement(await findOrders({}), today, today, {});
  check("★★ 손님 수 4 (고치기 전이었으면 1)", s.guest_count === 4, `${s.guest_count}`);
  check("어른 3 · 아이 1", s.adult_count === 3 && s.child_count === 1, `${s.adult_count}/${s.child_count}`);

  out.push("\n[고칠 수 없는 자리]");
  const empty = store.tables.find((x) => !x.is_counter && x.number !== T && x.number !== "T" && !x.party_size);
  r = await staff.patch(`/api/tables/${empty.number}/party-size`).send({ adults: 2 });
  check("★ 아무도 안 앉은 자리는 거절 — 새 착석은 손님 QR 이나 수기 주문으로", r.status === 409 && r.body.error === "no_seating", `${r.status} ${JSON.stringify(r.body)}`);
  const counter = store.tables.find((x) => x.is_counter);
  if (counter) {
    r = await staff.patch(`/api/tables/${counter.number}/party-size`).send({ adults: 2 });
    check("★ 포장 카운터는 인원이 없다", r.status === 409 && r.body.error === "counter", `${r.status}`);
  }
  r = await staff.patch(`/api/tables/${T}/party-size`).send({ adults: 0, children: 0 });
  check("0명은 안 된다", r.status === 400, `${r.status}`);

  out.push("\n[화면]");
  const admin = fs.readFileSync(path.join(__dirname, "../public/js/admin.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "../public/admin.html"), "utf8");
  check("★ 결제 탭 테이블 창에 버튼이 있다", /id="editPartyBtn"/.test(admin), "");
  check("메뉴 수정과 같은 권한", /showEditParty = [^;]*canEditOrder\(\)/.test(admin), "");
  check("수정 창이 있다", /id="partyEditBackdrop"/.test(html), "");
  check("★ 실패하면 말한다 — 조용히 닫지 않는다", /editPartyFailed/.test(admin), "");
  for (const k of ["editPartyBtn", "editPartyTitle", "editPartyHint", "editPartyTotal", "editPartyFailed"]) {
    check(`${k} 가 두 언어에 다 있다`, admin.split(`${k}:`).length - 1 === 2, "");
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
