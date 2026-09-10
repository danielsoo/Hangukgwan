// 주문 번호가 겹치지 않는가.
//
// 2026-09-10 사장님(장사 중): "9번 테이블은 주문해도 프린트 자체가 안되고
// 있음. 근데 또 웃긴건 7번 테이블은 자동으로 나왔대." 그리고 그 직전:
// "7이랑 9는 결제완료를 했는데 인원이 안 사라져있어."
//
// 두 증상의 뿌리가 같다. 번호는 store 문서의 nextId.orders 에서 나오는데,
// 그 문서를 통째로 덮어쓰는 save() 가 여기저기서 불렸다 — 주문이 들어올
// 때마다도 불렸다(카운터 하나 올리자고). 조금 오래된 사본을 들고 있던
// 요청이 save() 를 하면 카운터가 뒤로 가고, 그러면
//   - 다음 주문이 이미 있는 번호로 만들어져 앞 주문을 덮어쓰고,
//   - 관리자 화면은 그 번호를 이미 본 것으로 알고 있어서 빌지를 안 찍고,
//   - 같은 덮어쓰기가 결제로 지운 인원수도 되살린다.
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
process.env.SESSION_SECRET = "order-id";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const fs = require("fs");
const path = require("path");
const request = require("supertest");
const app = require("../server");
const { store, getDb, connectDB, reserveId } = require("../src/db");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

(async () => {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ password: "ownerpass123" });
  await require("./disable-order-hours")();
  const itemId = store.menuItems[0].id;
  const tables = store.tables.filter((t) => !t.is_counter);

  out.push("[번호는 데이터베이스가 준다]");
  {
    const a = await reserveId("orders");
    const b = await reserveId("orders");
    check("부를 때마다 다른 번호", a !== b, `${a} / ${b}`);
    check("올라간다", b > a, `${a} → ${b}`);
    // 동시에 불러도 겹치지 않는다 — 이게 핵심이다.
    const many = await Promise.all(Array.from({ length: 20 }, () => reserveId("orders")));
    check("스무 번을 동시에 불러도 전부 다르다", new Set(many).size === 20, JSON.stringify(many));
  }

  out.push("\n[카운터가 뒤로 가 있어도 겹치지 않는다]");
  // 이미 배포된 곳에서 실제로 벌어진 상태를 흉내낸다.
  {
    await agent.put(`/api/tables/${tables[0].number}/party-size`).send({ adults: 2, children: 0 });
    await agent.put(`/api/tables/${tables[1].number}/party-size`).send({ adults: 2, children: 0 });
    const r1 = await agent.post("/api/orders").send({ tableNumber: tables[0].number, items: [{ itemId, qty: 1 }] });
    const first = r1.body.id;
    // 덮어쓰기로 카운터가 되돌아간 상황.
    const db = getDb();
    await db.collection("store").updateOne({ _id: "main" }, { $set: { "nextId.orders": 2 } });
    store.nextId.orders = 2;
    const r2 = await agent.post("/api/orders").send({ tableNumber: tables[1].number, items: [{ itemId, qty: 1 }] });
    check("그래도 새 번호가 나온다", r2.body.id > first, `${first} → ${r2.body.id}`);
    const ids = store.orders.map((o) => o.id);
    check("주문 번호가 하나도 안 겹친다", new Set(ids).size === ids.length,
      `${ids.length}건 중 ${new Set(ids).size}개만 다르다`);
  }

  out.push("\n[주문이 들어와도 남의 일을 되돌리지 않는다]");
  // 예전에는 주문 하나가 들어올 때마다 store 문서를 통째로 다시 썼다.
  // 그 사이 결제로 지운 인원수가 그 저장에 실려 되살아났다.
  {
    const T = tables[5].number;
    const U = tables[6].number;
    await agent.put(`/api/tables/${T}/party-size`).send({ adults: 2, children: 0 });
    await agent.put(`/api/tables/${U}/party-size`).send({ adults: 3, children: 1 });
    const paid = await agent.post("/api/orders").send({ tableNumber: T, items: [{ itemId, qty: 1 }] });
    // T 를 결제하는 것과 U 에 새 주문이 들어오는 것이 겹친다.
    await Promise.all([
      agent.patch(`/api/orders/${paid.body.id}`).send({ status: "paid", paymentMethod: "cash" }),
      agent.post("/api/orders").send({ tableNumber: U, items: [{ itemId, qty: 1 }] }),
    ]);
    const db = getDb();
    const doc = await db.collection("store").findOne({ _id: "main" });
    const tT = doc.tables.find((x) => String(x.number) === String(T));
    const tU = doc.tables.find((x) => String(x.number) === String(U));
    check("결제한 자리의 인원수가 지워져 있다", !tT.party_size, String(tT.party_size));
    check("옆 자리 인원수는 그대로 있다", tU.party_size === 4, String(tU.party_size));
  }

  out.push("\n[규칙이 되돌아오지 않게]");
  const dbSrc = fs.readFileSync(path.join(__dirname, "..", "src", "db.js"), "utf8");
  const ordersSrc = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "orders.js"), "utf8");
  check("주문 만들 때 번호를 데이터베이스에서 받는다", /await reserveId\("orders"/.test(ordersSrc));
  check("주문 만들 때 store 문서를 통째로 쓰지 않는다",
    !/Promise\.all\(\[saveOrder\(order\), save\(\)\]\)/.test(ordersSrc),
    "카운터 하나 때문에 문서 전체를 갈아끼우고 있다");
  check("번호는 $inc 로 원자적으로", /\$inc: \{ \[key\]: 1 \}/.test(dbSrc));
  check("뒤로 간 카운터를 올려주는 안전판이 있다", /ensureOrderIdFloor/.test(dbSrc));
  check("인원수는 그 자리 네 칸만 쓴다", /savePartySize\(store, order\.table_number\)/.test(ordersSrc));

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
