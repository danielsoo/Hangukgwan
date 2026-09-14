// 주문 버튼이 두 번 눌려도 주문은 한 건만 들어가는가.
//
// 2026-09-14 사장님: "폰주문시 주문송출버튼 누르면 로딩이라는 화면없이 그냥
// 잠깐 멈추고 있어. 그래서 다시 누르게 되는데 그때 나오는 경우가 2가지 /
// 1. 같은 주문이 두번 됨. 안내메세지도 없이 빌지 나옴." — 그날 52건 중 6건.
//
// 두 겹을 따로 시험한다.
//   1) 서버 — 같은 표(clientRequestId)를 두 번 받으면 두 번째는 새 주문을
//      만들지 않고 처음 것을 돌려준다. 나란히 들어온 경우도 포함한다.
//   2) 화면 — 누른 **그 순간**에 잠근다. 예전에는 위치를 다 잡은 뒤에야
//      잠갔고, 그 최대 8초가 이 사고의 창이었다. 순서가 뒤집히면 실패한다.
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

const fs = require("fs");
const path = require("path");
const express = require("express");
const session = require("express-session");
const request = require("supertest");
const { store, save, findOrders, getDb, connectDB, saveFields } = require("../src/db");
const { syncSessionRole } = require("../src/auth");
const {
  applyOrderRequestIdIndex20260914,
  MIGRATION_FLAG,
} = require("../src/migrations/2026-09-14-order-request-id-index");

function resetStore() {
  store.settings = { staff_permissions: {} };
  store.nextId = { orders: 1, menuItems: 1, tables: 1 };
  store.menuItems = [
    { id: 1, code: "11", name_zh: "石鍋拌飯", name_ko: "돌솥비빔밥", price: 230, available: true, category_key: "rice" },
  ];
  store.tables = [
    { id: 1, number: "7", party_size: 2, party_adults: 2, party_children: 0, party_size_updated_at: new Date().toISOString() },
  ];
  store.orders = [];
  store.zones = [];
  store.payments = [];
  store.reservations = [];
  store.daily_settlements = [];
  store.categories = [];
}
resetStore();

const app = express();
app.use(express.json());
app.use(session({ secret: "t", resave: false, saveUninitialized: false }));
app.use(syncSessionRole);
app.use("/api/orders", require("../src/routes/orders"));

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const CART = [{ itemId: 1, qty: 1, orderType: "dine_in", addons: [] }];
const body = (token) => ({ tableNumber: "7", items: CART, ...(token ? { clientRequestId: token } : {}) });

(async () => {
  await save();
  // 실제 배포와 같은 순서로 인덱스를 만든다 — 이 시험이 지키려는 마지막
  // 한 겹이 바로 그 인덱스다.
  await applyOrderRequestIdIndex20260914(store, { getDb, connectDB, saveFields });

  out.push("\n[인덱스]");
  check("마이그레이션이 표시를 남긴다", !!store.settings[MIGRATION_FLAG], store.settings[MIGRATION_FLAG]);
  const idx = getDb().collection("orders").indexes.find((i) => i.spec.client_request_id === 1);
  check("client_request_id 고유 인덱스가 생긴다", !!idx && idx.opts.unique === true, JSON.stringify(idx));
  check(
    "부분 인덱스다 — 표 없는 주문끼리는 안 겹친다",
    !!idx && !!idx.opts.partialFilterExpression,
    JSON.stringify(idx && idx.opts)
  );

  out.push("\n[두 번 누름 — 시간 차를 두고]");
  const guest = request.agent(app);
  const token = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const first = await guest.post("/api/orders").send(body(token));
  check("첫 번째는 새 주문(201)", first.status === 201, `${first.status} ${JSON.stringify(first.body)}`);

  const second = await guest.post("/api/orders").send(body(token));
  check("두 번째는 새 주문이 아니다(200)", second.status === 200, `${second.status} ${JSON.stringify(second.body)}`);
  check("두 번째가 돌려준 것은 처음 그 주문", second.body.id === first.body.id, `${second.body.id} vs ${first.body.id}`);

  let rows = await findOrders({ table_number: "7" });
  check("주문은 한 건만 남는다", rows.length === 1, `${rows.length}건`);

  out.push("\n[두 번 누름 — 정확히 같은 순간]");
  const token2 = "11112222-3333-4444-5555-666677778888";
  const both = await Promise.all([
    guest.post("/api/orders").send(body(token2)),
    guest.post("/api/orders").send(body(token2)),
  ]);
  const created = both.filter((r) => r.status === 201);
  const deduped = both.filter((r) => r.status === 200);
  check("둘 중 하나만 새 주문", created.length === 1, both.map((r) => r.status).join(","));
  check("나머지 하나는 기존 주문", deduped.length === 1, both.map((r) => r.status).join(","));
  check("두 응답의 주문번호가 같다", both[0].body.id === both[1].body.id, `${both[0].body.id} vs ${both[1].body.id}`);
  rows = await findOrders({ table_number: "7" });
  check("여전히 두 건뿐", rows.length === 2, `${rows.length}건`);

  out.push("\n[막으면 안 되는 것]");
  const token3 = "99998888-7777-6666-5555-444433332222";
  const again = await guest.post("/api/orders").send(body(token3));
  check("표가 다르면 같은 내용도 새 주문", again.status === 201 && again.body.id !== first.body.id, `${again.status}`);

  const noToken1 = await guest.post("/api/orders").send(body(null));
  const noToken2 = await guest.post("/api/orders").send(body(null));
  check(
    "표를 안 보내는 옛 화면도 그대로 주문된다",
    noToken1.status === 201 && noToken2.status === 201 && noToken1.body.id !== noToken2.body.id,
    `${noToken1.status}/${noToken2.status}`
  );

  const junk = await guest.post("/api/orders").send({ tableNumber: "7", items: CART, clientRequestId: "짧음" });
  check("형식에 안 맞는 표는 없는 것으로 친다 — 주문은 들어간다", junk.status === 201, `${junk.status}`);

  out.push("\n[화면 — 누른 그 순간에 잠그는가]");
  const src = fs.readFileSync(path.join(__dirname, "../public/js/order.js"), "utf8");
  const flowAt = src.indexOf("async function submitOrderFlow(");
  const endAt = src.indexOf("\n  function saveOrderToHistory(", flowAt);
  const flow = src.slice(flowAt, endAt);
  check("주문 흐름을 찾는다", flowAt > 0 && endAt > flowAt, `${flowAt}, ${endAt}`);

  const lockAt = flow.indexOf("submitting = true");
  const busyAt = flow.indexOf("setSubmitBusy(true)");
  const geoAt = flow.indexOf("getGeolocation()");
  const minSpendAt = flow.indexOf("refreshMinSpend()");
  const fetchAt = flow.indexOf('fetch("/api/orders"');
  check("다시 누르면 그냥 돌아간다", /if \(submitting\) return;/.test(flow), "재진입 잠금이 없다");
  check("위치를 잡기 **전에** 잠근다", lockAt > 0 && geoAt > lockAt, `lock ${lockAt}, geo ${geoAt}`);
  check("低消를 물어보기 **전에** 잠근다", lockAt > 0 && minSpendAt > lockAt, `lock ${lockAt}, minSpend ${minSpendAt}`);
  check("잠그는 순간 화면에도 표시한다", busyAt > 0 && busyAt < geoAt, `busy ${busyAt}, geo ${geoAt}`);
  check("표를 같이 보낸다", fetchAt > 0 && /clientRequestId: cartToken/.test(flow), "clientRequestId 를 안 보낸다");
  check(
    "담긴 것이 바뀌면 표도 바뀐다",
    /function cartChanged\(\) \{\s*cartToken = newCartToken\(\);/.test(src),
    "cartChanged 가 표를 새로 만들지 않는다"
  );
  // 표가 바뀌면 서버는 두 번째 누름을 못 알아본다. 그러니 담긴 것과 상관없는
  // 일 — VIP 상태, 통화 전환, 첫 그리기 — 로는 절대 바뀌면 안 된다.
  const fabBody = src.slice(
    src.indexOf("  function renderCartFab() {"),
    src.indexOf('  $("#cartFab").onclick')
  );
  check("장바구니 다시 그리는 것만으로는 표가 안 바뀐다", fabBody.length > 50 && !/cartToken/.test(fabBody), "renderCartFab 이 표를 바꾼다");
  const mutations = (src.match(/cartChanged\(\);/g) || []).length;
  check("담기·수량±·빼기·보낸 뒤가 모두 표를 바꾼다", mutations >= 5, `${mutations}군데`);
  check("장바구니를 열 때 위치를 미리 잡는다", /warmGeolocation\(\);/.test(src), "미리 잡지 않는다");

  out.push("\n[화면 — 실제로 두 번 눌러본다]");
  // 이름만 보는 검사로는 「잠그긴 하는데 늦게 잠근다」를 못 잡는다. 그게
  // 정확히 이번 사고였다. 그래서 실제 order.js 의 주문 흐름을 그대로 꺼내
  // 위치가 안 잡히는 폰(가게 안, 실내)을 흉내낸 채로 두 번 누른다.
  // 잡기 시작한 위치 요청을 **전부** 모은다. 하나만 들고 있으면, 잠금이
  // 풀린 채로 두 번 눌렸을 때 뒤엣것이 앞엣것을 덮어써서 앞 흐름이 영영
  // 안 끝난다 — 그러면 시험이 실패가 아니라 조용히 사라진다(실제로 그랬다).
  const geoWaiting = [];
  const releaseGeo = () => { while (geoWaiting.length) geoWaiting.pop()(); };
  let geoStarted = 0;
  let busyAtGeoStart = null;
  let busy = false;
  const posts = [];

  const stub = {
    $: () => ({ hidden: false, disabled: false, classList: { toggle() {} }, textContent: "" }),
    t: (k) => k,
    cart: [{ itemId: 1, qty: 1, orderType: "dine_in", addons: [] }],
    cartTotal: () => 230,
    partySize: 2,
    isCounterTable: false,
    counterCustomerName: null,
    pendingSeatingPrompt: null,
    askSeatingIfOpen() {},
    refreshMinSpend: async () => 0,
    minSpendRequired: 0,
    showPartyWarningModal() {},
    storeLat: 24.83,
    storeLng: 121.0,
    getGeolocation() {
      geoStarted++;
      busyAtGeoStart = busy;
      return new Promise((resolve) => geoWaiting.push(() => resolve({ lat: 24.83, lng: 121.0 })));
    },
    firebaseAuth: null,
    fetch: async (url, opt) => {
      posts.push(JSON.parse(opt.body));
      return { ok: true, status: 201, json: async () => ({ id: 900 + posts.length }) };
    },
    tableNumber: "7",
    setSubmitBusy: (on) => { busy = on; },
    applyOrderingState() {},
    saveOrderToHistory() {},
    renderCartFab() {},
    showConfirmation() {},
    alert() {},
    sessionStorage: { removeItem() {} },
    COUNTER_NAME_KEY: "n",
    COUNTER_PHONE_KEY: "p",
  };
  const names = Object.keys(stub);
  const harness = new Function(
    ...names,
    `let submitting = false;
     let cartToken = "TOKEN-AAA";
     let activeOrderId = null;
     let hasPriorOrder = false;
     let counterCustomerPhone = null;
     ${flow}
     return { submitOrderFlow };`
  )(...names.map((n) => stub[n]));

  const tap1 = harness.submitOrderFlow(false);
  const tap2 = harness.submitOrderFlow(false); // 멈춘 것처럼 보여 한 번 더 누른다
  // 「보내는 중」은 **누른 그 순간**이어야 한다 — 기다려서 되는 게 아니다.
  check("누르자마자 화면이 「보내는 중」이 된다", busy === true, `busy=${busy}`);

  // 低消 조회가 끝나야 위치를 잡기 시작한다. 몇 틱 흘려보낸다.
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  check("위치를 잡기 시작할 때 이미 잠겨 있다", busyAtGeoStart === true, `${busyAtGeoStart}`);
  check("두 번째 누름은 위치를 또 잡지 않는다", geoStarted === 1, `${geoStarted}번 잡았다`);
  check("아직 아무것도 안 보냈다 — 위치를 기다리는 중", posts.length === 0, `${posts.length}`);
  releaseGeo();
  // 안 끝나면 실패로 적는다. 그냥 기다리면 노드가 조용히 0으로 빠져나가서
  // 아무 줄도 안 남는다 — 고장 난 것이 통과처럼 보인다.
  const finished = await Promise.race([
    Promise.all([tap1, tap2]).then(() => true),
    new Promise((r) => setTimeout(() => r(false), 3000)),
  ]);
  releaseGeo();
  check("두 번 누른 흐름이 모두 끝난다", finished === true, "흐름 하나가 안 끝났다");
  check("주문은 한 번만 보낸다", posts.length === 1, `${posts.length}번 보냈다`);
  check("보낸 것에 표가 들어 있다", posts.length === 1 && posts[0].clientRequestId === "TOKEN-AAA", JSON.stringify(posts[0]));
  check("끝나면 다시 누를 수 있다", busy === false, `busy=${busy}`);

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
