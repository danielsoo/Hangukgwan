// 주문이 store 문서 밖으로 나갔는지 — 그리고 그게 실제로 "덜 읽고 덜 쓴다"로
// 이어지는지.
//
// 2026-09-10 사장님: "전반적으로 로그인이나 모든 액션들이 너무 오래 걸려. /
// 주문 → 조리중 → 서빙완료 넘어가는 버튼 누르면 최소 5~20초 이상 걸림. /
// 결제 완료 누르면 최소 5초 이상."
//
// 원인은 store 문서 하나에 주문이 전부 쌓이고, 요청마다 그 전체를 읽고
// 무언가 바꾸면 전체를 다시 쓰던 것이었다(주문 한 건 약 1.19KB, 하루
// 100건이면 한 달에 3.5MB). 게다가 MongoDB 문서 한도가 16MB라 넉 달쯤 뒤엔
// 저장 자체가 실패한다.
//
// 이 테스트는 "빨라졌다"를 시간으로 재지 않는다 — 시간은 기계 사정에 따라
// 흔들린다. 대신 원인을 직접 잰다: 어떤 컬렉션에 무엇이 오가는지, 그리고
// 주문을 아무리 쌓아도 store 문서가 커지지 않는지.
const fake = require("./fake-mongo");

// 모든 DB 호출을 기록한다.
const io = [];
const origDb = fake.MongoClient.prototype.db;
fake.MongoClient.prototype.db = function (...a) {
  const db = origDb.apply(this, a);
  if (db.__wrapped) return db;
  const orig = db.collection.bind(db);
  db.collection = (name) => {
    const col = orig(name);
    if (col.__wrapped) return col;
    for (const m of ["findOne", "find", "insertOne", "updateOne", "replaceOne", "bulkWrite", "deleteOne", "countDocuments"]) {
      if (typeof col[m] !== "function") continue;
      const f = col[m].bind(col);
      col[m] = (...args) => {
        io.push({ col: name, op: m, args });
        return f(...args);
      };
    }
    col.__wrapped = true;
    return col;
  };
  db.__wrapped = true;
  return db;
};

require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"),
  filename: require.resolve("mongodb"),
  loaded: true,
  exports: fake,
  paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "orders-collection";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const http = require("http");
const app = require("../server");
const { store, getDb, connectDB, findOrders, RECENT_DAYS } = require("../src/db");
const { taipeiDateString } = require("../src/time");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

let PORT;
function req(method, path, body, cookie) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(
      { host: "127.0.0.1", port: PORT, path, method,
        headers: Object.assign({ "Content-Type": "application/json" },
          data ? { "Content-Length": Buffer.byteLength(data) } : {},
          cookie ? { Cookie: cookie } : {}) },
      (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve({
        status: res.statusCode,
        cookie: (res.headers["set-cookie"] || []).map((c) => c.split(";")[0]).join("; "),
        body: b ? JSON.parse(b) : null,
      })); }
    );
    if (data) r.write(data);
    r.end();
  });
}

const daysAgo = (n) => taipeiDateString(new Date(Date.now() - n * 24 * 60 * 60 * 1000));

(async () => {
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  PORT = server.address().port;
  await req("GET", "/api/menu"); // 워밍업 (시드 + 마이그레이션)

  // 이 파일이 재는 건 "주문이 store 문서 밖으로 나갔는가"이지 영업 시작
  // 경계가 아니다. 마이그레이션이 기본으로 잡아둔 영업 시작(2026-09-08)이
  // 있으면 여기서 만드는 옛 주문들이 그 규칙에 걸려 빠지므로, 이 테스트
  // 안에서만 비워둔다(그 규칙 자체는 test/e2e-service-start.js 가 잰다).
  {
    const { save } = require("../src/db");
    const { SETTING_KEY } = require("../src/serviceStart");
    delete store.settings[SETTING_KEY];
    await save();
  }

  const login = await req("POST", "/api/auth/login", { password: "ownerpass123" });
  const ck = login.cookie;
  await req("PUT", "/api/tables/7/party-size", { partySize: 2 });
  const menu = (await req("GET", "/api/menu")).body;
  const item = menu.flatMap((c) => c.items)[0];

  out.push("[주문은 자기 컬렉션에 산다]");
  io.length = 0;
  const created = await req("POST", "/api/orders", { tableNumber: "7", items: [{ itemId: item.id, qty: 1 }] });
  check("주문이 만들어진다", created.status === 201, `${created.status}`);
  check("주문 한 건이 orders 컬렉션에 쓰인다",
    io.some((c) => c.col === "orders" && c.op === "replaceOne"), JSON.stringify(io.map((c) => `${c.col}.${c.op}`)));

  await connectDB();
  const raw = await getDb().collection("store").findOne({ _id: "main" });
  check("store 문서 안에는 주문이 없다", !raw.orders, JSON.stringify(Object.keys(raw)));
  const inCollection = await getDb().collection("orders").find({}).toArray();
  check("orders 컬렉션에 그 주문이 있다", inCollection.some((o) => o.id === created.body.id));

  out.push("\n[상태 바꾸기 — 사장님이 5~20초 기다리던 자리]");
  io.length = 0;
  const adv = await req("PATCH", `/api/orders/${created.body.id}`, { status: "preparing" }, ck);
  check("조리중으로 넘어간다", adv.status === 200, `${adv.status}`);
  const writes = io.filter((c) => ["replaceOne", "updateOne", "insertOne", "bulkWrite"].includes(c.op));
  const storeWrites = writes.filter((c) => c.col === "store");
  check("store 문서를 다시 쓰지 않는다", storeWrites.length === 0,
    JSON.stringify(writes.map((w) => `${w.col}.${w.op}`)));
  check("주문 한 건만 쓴다",
    writes.filter((w) => w.col === "orders").length === 1, JSON.stringify(writes.map((w) => `${w.col}.${w.op}`)));
  // 세션 만료 갱신도 매 요청마다 나가면 안 된다(server.js 의 touchAfter).
  check("세션도 매번 다시 쓰지 않는다", writes.filter((w) => w.col === "sessions").length === 0,
    JSON.stringify(writes.map((w) => `${w.col}.${w.op}`)));

  out.push("\n[요청마다 주문 뭉치를 읽지 않는다]");
  io.length = 0;
  await req("GET", "/api/menu");
  const storeReads = io.filter((c) => c.col === "store" && c.op === "findOne");
  check("store 문서를 읽을 때 주문을 빼고 읽는다",
    storeReads.length > 0 && storeReads.every((c) => c.args[1] && c.args[1].projection && c.args[1].projection.orders === 0),
    JSON.stringify(storeReads.map((c) => c.args[1])));

  out.push("\n[주문이 쌓여도 store 문서는 커지지 않는다]");
  const sizeBefore = Buffer.byteLength(JSON.stringify(await getDb().collection("store").findOne({ _id: "main" })));
  for (let i = 0; i < 60; i++) {
    await req("POST", "/api/orders", { tableNumber: "7", items: [{ itemId: item.id, qty: 2 }] });
  }
  const sizeAfter = Buffer.byteLength(JSON.stringify(await getDb().collection("store").findOne({ _id: "main" })));
  check("주문 60건을 더 넣어도 store 문서가 거의 그대로다",
    sizeAfter - sizeBefore < 2048, `${sizeBefore} → ${sizeAfter} 바이트`);
  const orderCount = await getDb().collection("orders").countDocuments({});
  check("주문은 컬렉션에 다 들어가 있다", orderCount >= 61, `${orderCount}건`);

  out.push("\n[메모리에는 지금 필요한 주문만]");
  // 오래된 결제완료 주문은 메모리에서 빠지되, 컬렉션에는 남아 있어야 한다.
  await getDb().collection("orders").insertOne({
    _id: 999001, id: 999001, table_number: "9", status: "paid", items: [], total: 500,
    created_at: `${daysAgo(RECENT_DAYS + 30)} 12:00:00`, account_id: null,
  });
  // 오래된 "안 끝난" 주문은 아무리 지나도 들고 있어야 한다 — 받을 돈이다.
  await getDb().collection("orders").insertOne({
    _id: 999002, id: 999002, table_number: "9", status: "served", items: [], total: 700,
    created_at: `${daysAgo(RECENT_DAYS + 30)} 12:00:00`, account_id: null,
  });
  await req("GET", "/api/menu"); // refreshStore 한 번 더
  check("오래된 결제완료 주문은 메모리에서 빠진다", !store.orders.some((o) => o.id === 999001));
  check("오래된 미결제 주문은 메모리에 남는다", store.orders.some((o) => o.id === 999002),
    store.orders.map((o) => o.id).join(","));
  const still = await findOrders({ id: 999001 });
  check("빠진 주문도 컬렉션에는 그대로 있다", still.length === 1);

  out.push("\n[결산은 지난 날짜까지 제대로 센다]");
  // 메모리에 없는 옛 주문이 결산 합계에 들어가야 한다 — 여기서 조용히
  // 빠지면 돈 숫자가 틀린다.
  const oldDate = daysAgo(RECENT_DAYS + 30);
  const settle = await req("GET", `/api/settlements/?date=${oldDate}`, null, ck);
  check("옛 날짜 결산이 열린다", settle.status === 200, `${settle.status}`);
  check("메모리에 없는 옛 주문의 매출이 잡힌다", settle.body.total_revenue === 500,
    `total_revenue=${settle.body.total_revenue}`);

  out.push("\n[이관 — 예전 데이터가 하나도 없어지지 않는다]");
  // 예전 store 문서처럼 주문이 문서 안에 들어 있는 상태를 만들고, 이관을
  // 다시 돌려서 전부 컬렉션으로 옮겨졌는지 본다.
  const { applyOrdersCollection20260910, MIGRATION_FLAG } = require("../src/migrations/2026-09-10-orders-collection");
  const legacy = Array.from({ length: 120 }, (_, i) => ({
    id: 500000 + i, table_number: "3", status: "paid", items: [], total: 100,
    created_at: `${daysAgo(90)} 12:00:00`, account_id: null,
  }));
  await getDb().collection("store").updateOne({ _id: "main" }, { $set: { orders: legacy } });
  delete store.settings[MIGRATION_FLAG];
  const { save } = require("../src/db");
  await applyOrdersCollection20260910(store, { save, getDb, connectDB });
  const movedCount = await getDb().collection("orders").countDocuments({ id: { $gte: 500000, $lte: 500119 } });
  check("옛 주문 120건이 전부 옮겨졌다", movedCount === 120, `${movedCount}건`);
  const afterDoc = await getDb().collection("store").findOne({ _id: "main" });
  check("옮긴 뒤 store 문서에서 주문이 사라진다", !afterDoc.orders);
  check("이관 표시가 남는다", !!store.settings[MIGRATION_FLAG]);
  // 두 번 돌려도 안전해야 한다(배포가 여러 번 뜨거나 중간에 끊길 수 있다).
  await applyOrdersCollection20260910(store, { save, getDb, connectDB });
  const again = await getDb().collection("orders").countDocuments({ id: { $gte: 500000, $lte: 500119 } });
  check("다시 돌려도 늘거나 줄지 않는다", again === 120, `${again}건`);

  out.push("\n[save() 가 주문을 도로 집어넣지 않는다]");
  // 이게 무너지면 메모리에 있는 최근 며칠치만 남고 지난 주문이 통째로
  // 사라진다 — 이 변경에서 가장 위험한 실수다.
  await save();
  const afterSave = await getDb().collection("store").findOne({ _id: "main" });
  check("save() 뒤에도 store 문서에 주문이 없다", !afterSave.orders, JSON.stringify(Object.keys(afterSave)));
  const survived = await getDb().collection("orders").countDocuments({ id: { $gte: 500000, $lte: 500119 } });
  check("save() 뒤에도 옛 주문이 살아 있다", survived === 120, `${survived}건`);

  out.push("\n[결제기록·정산·예약도 밖으로 나갔다]");
  // 사장님(2026-09-10): "지금 미리 준비하면 안되는거야?" — 셋을 다 합쳐
  // 연 3~4MB 늘어난다. 지금 옮기면 몇 줄, 3년 뒤에 옮기면 수만 건이다.
  // vipCards 는 일부러 남겨뒀다(물리 카드 수만큼만 늘어나고, 주문마다
  // VIP 할인을 보느라 매번 읽어야 한다).
  {
    const { OUT_OF_DOCUMENT } = require("../src/db");
    check("문서 밖으로 뺀 목록에 셋이 다 있다",
      ["orders", "payments", "daily_settlements", "reservations"].every((k) => OUT_OF_DOCUMENT.includes(k)),
      OUT_OF_DOCUMENT.join(","));
    check("vipCards 는 일부러 남긴다", !OUT_OF_DOCUMENT.includes("vipCards"));
  }

  // 예약 — 만들고, 고치고, 지운다. 전부 컬렉션에서만 벌어져야 한다.
  io.length = 0;
  const madeRes = await req("POST", "/api/reservations", {
    customer_name: "박윤수", phone: "0912345678", date: "2026-09-20", time: "18:30", party_size: 6,
  }, ck);
  check("예약이 만들어진다", madeRes.status === 201, `${madeRes.status} ${JSON.stringify(madeRes.body)}`);
  check("예약이 자기 컬렉션에 쓰인다",
    io.some((c) => c.col === "reservations" && c.op === "replaceOne"),
    io.map((c) => `${c.col}.${c.op}`).join(","));
  const listRes = await req("GET", "/api/reservations", null, ck);
  check("목록에 나온다", listRes.body.some((r) => r.id === madeRes.body.id), JSON.stringify(listRes.body));
  const patched = await req("PATCH", `/api/reservations/${madeRes.body.id}`, { party_size: 8 }, ck);
  check("고칠 수 있다", patched.status === 200 && patched.body.party_size === 8, JSON.stringify(patched.body));
  const delRes = await req("DELETE", `/api/reservations/${madeRes.body.id}`, null, ck);
  check("지울 수 있다", delRes.status === 200);
  const afterDel = await req("GET", "/api/reservations", null, ck);
  check("지운 예약은 목록에서 사라진다", !afterDel.body.some((r) => r.id === madeRes.body.id));

  // 마감 스냅샷 — 같은 날짜를 두 번 닫아도 한 줄이어야 한다.
  const closeDate = "2026-09-09";
  await req("POST", "/api/settlements/close", { date: closeDate }, ck);
  await req("POST", "/api/settlements/close", { date: closeDate }, ck);
  const history = await req("GET", "/api/settlements/history", null, ck);
  check("마감 기록이 남는다", history.body.some((r) => r.date === closeDate), JSON.stringify(history.body.map((r) => r.date)));
  check("같은 날을 두 번 닫아도 한 줄이다",
    history.body.filter((r) => r.date === closeDate).length === 1,
    JSON.stringify(history.body.map((r) => r.date)));

  // 셋 다 store 문서에는 없어야 한다.
  const docNow = await getDb().collection("store").findOne({ _id: "main" });
  check("store 문서에 결제기록·정산·예약이 없다",
    !docNow.payments && !docNow.daily_settlements && !docNow.reservations,
    JSON.stringify(Object.keys(docNow)));
  check("vipCards 는 문서에 그대로 있다", Array.isArray(docNow.vipCards), JSON.stringify(Object.keys(docNow)));

  out.push("\n[2차 이관도 아무것도 잃지 않는다]");
  {
    const { applySplitCollections20260910, MIGRATION_FLAG: FLAG2 } = require("../src/migrations/2026-09-10-split-collections");
    const { save } = require("../src/db");
    const legacyPayments = Array.from({ length: 40 }, (_, i) => ({
      id: 800000 + i, merchant_trade_no: `HG${800000 + i}`, table_number: "3",
      order_ids: [1], amount: 500, status: "paid", created_at: "2026-06-01 12:00:00",
    }));
    const legacyRes = Array.from({ length: 15 }, (_, i) => ({
      id: 810000 + i, customer_name: "손님", phone: "09", date: "2026-06-01", time: "18:00",
      party_size: 2, status: "confirmed", created_at: "2026-06-01T00:00:00Z",
    }));
    await getDb().collection("store").updateOne({ _id: "main" },
      { $set: { payments: legacyPayments, reservations: legacyRes, daily_settlements: [] } });
    delete store.settings[FLAG2];
    await applySplitCollections20260910(store, { save, getDb, connectDB });

    const pc = await getDb().collection("payments").countDocuments({ id: { $gte: 800000, $lte: 800039 } });
    const rc = await getDb().collection("reservations").countDocuments({ id: { $gte: 810000, $lte: 810014 } });
    check("옛 결제기록 40건이 옮겨졌다", pc === 40, `${pc}건`);
    check("옛 예약 15건이 옮겨졌다", rc === 15, `${rc}건`);
    const cleaned = await getDb().collection("store").findOne({ _id: "main" });
    check("옮긴 뒤 문서에서 사라진다", !cleaned.payments && !cleaned.reservations);
    // 두 번 돌려도 늘거나 줄지 않아야 한다.
    await applySplitCollections20260910(store, { save, getDb, connectDB });
    const pc2 = await getDb().collection("payments").countDocuments({ id: { $gte: 800000, $lte: 800039 } });
    check("다시 돌려도 그대로다", pc2 === 40, `${pc2}건`);
    // save() 가 도로 집어넣지 않는지 — 1차 이관에서와 같은 위험이다.
    await save();
    const afterSave2 = await getDb().collection("store").findOne({ _id: "main" });
    check("save() 뒤에도 문서에 안 들어간다", !afterSave2.payments && !afterSave2.reservations);
    const survived2 = await getDb().collection("payments").countDocuments({ id: { $gte: 800000, $lte: 800039 } });
    check("save() 뒤에도 옛 결제기록이 살아 있다", survived2 === 40, `${survived2}건`);
  }

  server.close();
  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.log(out.join("\n"));
  console.error("HARNESS ERROR:", e.message, e.stack);
  process.exit(1);
});
