// 테스터 모드에서 결제한 것이 실시간 주문판의 「결제완료」 칸에 오는가.
// 그리고 종료하면 같이 사라지는가.
//
// 2026-09-16 사장님: "테스터 모드에서는 결제 탭에서 결제 완료 했을 때 실시간
// 주문 탭에서 결제 완료 칸으로 안가는데 가게 해줘. 종료하면 빠지고"
//
// ── 결제 탭에서 결제하는 길은 하나가 아니다 ────────────────────────────
//
// 결제 탭의 배치도에서 자리를 누르면 테이블 상세 창이 열리고, 거기서
// 결제가 이뤄진다(public/js/admin.js renderPaymentFloorPlan →
// openTableDetail). 그 창에서 나가는 길이 셋이다.
//
//   · PATCH /:id            — 합산 결제, 포장 카운터의 「결제 완료로 변경」
//   · PATCH /:id/split-pay  — 품목을 전부 체크하고 결제
//   · PATCH /:id/split-pay  — 일부만 체크하고 결제(나머지는 남는다)
//
// 셋 다 재야 한다. 하나만 재면 나머지 둘이 조용히 어긋나도 모른다.
//
// ── 「결제완료 칸에 온다」가 무슨 뜻인가 ────────────────────────────────
//
// 화면의 그 칸은 GET /api/orders 가 준 것 중 status==="paid" 이고
// settled_at 이 없고 오늘 결제된 것을 모아 그린다(admin.js renderOrders).
// 그래서 여기서는 **테스트 기기가 부른 GET /api/orders 에 그 조건으로
// 들어 있는가**를 잰다.
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
process.env.SESSION_SECRET = "testmode-paid-column";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const request = require("supertest");
const app = require("../server");
const { store, getDb } = require("../src/db");
const { taipeiDateString } = require("../src/settlement");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

// 화면의 「결제완료」 칸과 같은 규칙(admin.js renderOrders).
const today = () => taipeiDateString();
function paidColumn(list) {
  return (list || []).filter(
    (o) => o.status === "paid" && !o.settled_at && String(o.updated_at || "").slice(0, 10) === today()
  );
}

(async () => {
  const staff = request.agent(app);
  let r = await staff.post("/api/auth/login").send({ password: "ownerpass123" });
  check("로그인된다", r.status === 200, `${r.status}`);
  await require("./disable-order-hours")();

  r = await staff.post("/api/test-mode/start").send({});
  check("테스터 모드가 켜진다", r.status === 200 && r.body.active === true, `${r.status} ${JSON.stringify(r.body)}`);
  check("이 기기가 테스트 기기다", r.body.thisDevice === true, "");

  const dish = store.menuItems.find((m) => m.available && m.price > 0);
  async function place(table, qty) {
    await staff.put(`/api/tables/${table}/party-size`).send({ adults: 2, children: 0 });
    const res = await staff.post("/api/orders").send({
      tableNumber: String(table),
      items: [{ itemId: dish.id, qty, orderType: "dine_in", addons: [] }],
    });
    if (res.status !== 201) throw new Error(`주문 실패 ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.id;
  }

  out.push("\n[테스트 주문이 주문판에 뜬다]");
  const a = await place(5, 1);
  const b = await place(6, 1);
  const c = await place(7, 1);
  let list = (await staff.get("/api/orders")).body;
  check("★ 세 건 다 보인다", [a, b, c].every((id) => list.some((o) => o.id === id)), list.map((o) => o.id).join(","));
  check("테스트 표가 붙어 있다 — 화면이 갈라 보여준다", list.filter((o) => o.test_session).length >= 3, "");

  out.push("\n[세 가지 결제 길이 전부 결제완료 칸으로 간다]");
  r = await staff.patch(`/api/orders/${a}`).send({ status: "paid", paymentMethod: "cash" });
  check("합산 결제 / 카운터 길 — 결제된다", r.status === 200, `${r.status}`);
  r = await staff.patch(`/api/orders/${b}/split-pay`).send({ itemIndexes: [0], paymentMethod: "cash" });
  check("품목 전부 체크 — 결제된다", r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  r = await staff.patch(`/api/orders/${c}/split-pay`).send({ itemIndexes: [0], paymentMethod: "linepay" });
  check("일부 체크 — 결제된다", r.status === 200, `${r.status}`);

  list = (await staff.get("/api/orders")).body;
  const col = paidColumn(list);
  for (const [name, id] of [["합산 결제", a], ["전부 체크", b], ["일부 체크", c]]) {
    check(`★ ${name} 한 것이 결제완료 칸에 있다`, col.some((o) => o.id === id), col.map((o) => o.id).join(",") || "칸이 비었다");
  }
  check("★ 정산 전이라 아무것도 안 내려갔다", col.every((o) => !o.settled_at), "");

  out.push("\n[평소 기기에는 안 보인다]");
  // 테스트 주문이 진짜 주문판에 섞이면 직원이 없는 손님의 음식을 만든다.
  const other = request.agent(app);
  await other.post("/api/auth/login").send({ password: "ownerpass123" });
  const otherList = (await other.get("/api/orders")).body;
  check("★ 참여하지 않은 기기에는 테스트 주문이 하나도 안 보인다", !otherList.some((o) => o.test_session), otherList.map((o) => o.id).join(","));
  check("그 기기의 결제완료 칸도 비어 있다", paidColumn(otherList).length === 0, "");

  out.push("\n[정산을 누르면 내려간다 — 진짜와 같은 규칙]");
  r = await staff.post("/api/settlements/shift-close").send({ shift: "day" });
  check("테스트 기기에서도 정산이 된다", r.status === 200, `${r.status}`);
  list = (await staff.get("/api/orders")).body;
  check("★ 정산한 것은 결제완료 칸에서 내려간다", paidColumn(list).length === 0, paidColumn(list).map((o) => o.id).join(","));
  // 주문판에서는 내려가지만 **기록은 남는다.** 정산은 「여기까지 끊는다」는
  // 뜻이지 지운다는 뜻이 아니다 — 결산 탭과 테이블 상세 > 이전 주문에서
  // 그대로 보인다. (주문판 목록 자체에서도 빠지는 것은 맞다. 정산된 것을
  // 매 요청 실어 나를 이유가 없다 — src/db.js loadRecentOrders 의 paidFilter.)
  const settledRows = await getDb().collection("orders").find({ id: a }).toArray();
  check("★ 기록은 남는다 — 정산은 끊는 것이지 지우는 게 아니다", settledRows.length === 1, `${settledRows.length}`);
  check("정산 시각이 찍혀 있다", !!(settledRows[0] && settledRows[0].settled_at), JSON.stringify(settledRows[0] && settledRows[0].settled_at));

  out.push("\n[종료하면 전부 빠진다]");
  const before = (await getDb().collection("orders").find({}).toArray()).length;
  r = await staff.post("/api/test-mode/end").send({});
  check("종료된다", r.status === 200, `${r.status}`);
  list = (await staff.get("/api/orders")).body;
  check("★ 주문판에서 사라진다", !list.some((o) => [a, b, c].includes(o.id)), list.map((o) => o.id).join(","));
  const rows = await getDb().collection("orders").find({}).toArray();
  check("★ 저장된 것도 지워진다 — 되돌린다는 약속", !rows.some((o) => o.test_session), rows.map((o) => `${o.id}/${!!o.test_session}`).join(","));
  check("지운 만큼만 줄었다", rows.length === before - 3, `${before} -> ${rows.length}`);
  const snap = await getDb().collection("daily_settlements").find({}).toArray();
  check("★ 테스트 정산 기록도 같이 빠진다", !snap.some((d) => d.test_session), snap.map((d) => `${d.date}/${!!d.test_session}`).join(","));

  out.push("\n[참여하지 않은 기기에 무엇이 보이는지 말해준다]");
  // 테스트 주문이 그 화면에 안 보인다는 것을 **그 화면이 말해야 한다.**
  // 안 그러면 「결제했는데 결제완료 칸에 안 온다」로 보인다.
  const fs = require("fs");
  const path = require("path");
  const admin = fs.readFileSync(path.join(__dirname, "../public/js/admin.js"), "utf8");
  check(
    "★ 안 보인다는 말이 띠에 적혀 있다",
    /testBannerOther: "[^"]*안 보입니다/.test(admin),
    "「이 기기는 평소 그대로」만으로는 테스트 주문이 왜 안 뜨는지 알 수 없다"
  );
  check("중국어도 같이", /testBannerOther: "[^"]*不會顯示/.test(admin), "");

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
