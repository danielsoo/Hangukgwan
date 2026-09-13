// MongoDB-backed datastore.
//
// Vercel (and serverless hosts in general) don't give you a writable local
// disk that survives between requests, so the old JSON-file store had to be
// replaced. To keep the rest of the codebase (routes, seed.js) working with
// minimal changes, we still keep one big in-memory `store` object with the
// exact same shape as before (categories/menuItems/tables/orders/settings/
// nextId) — it's just persisted as a single document in MongoDB instead of
// a local file. Photos are kept in a separate `photos` collection (each
// photo is its own document) so a busy menu with lots of photos never runs
// into MongoDB's 16MB single-document size limit.
require("dotenv").config();
const { MongoClient, ObjectId } = require("mongodb");

const uri = process.env.MONGODB_URI;

function defaultStore() {
  return {
    _id: "main",
    nextId: { categories: 1, menuItems: 1, tables: 1, orders: 1, zones: 1, daily_settlements: 1, reservations: 1, payments: 1, vip_cards: 1 },
    categories: [],
    menuItems: [],
    tables: [],
    orders: [],
    zones: [],
    // Online-payment attempts via ECPay (see src/routes/payments.js) — one
    // row per checkout the customer started, tracking which orders it
    // covers so the payment-result callback knows what to mark paid.
    payments: [],
    // One snapshot per business day, written by the nightly cron (see
    // src/routes/settlements.js) so a permanent record survives even if
    // orders are later edited/pruned. The 결산 admin tab also computes a
    // live (non-stored) view for "today" on demand.
    daily_settlements: [],
    // Manually-logged phone/walk-in reservations (name/phone/date/time/party
    // size), managed from the admin 예약 tab — see src/routes/reservations.js.
    reservations: [],
    // VIP membership cards — each row starts as a physical card the owner
    // has already printed/issued (card_number + discount_percent + the date
    // printed on the card), created from Admin > 회원(VIP) with no customer
    // attached yet. A customer later "claims" one by signing in with Google
    // (Firebase Authentication, see src/firebaseAdmin.js) and entering the
    // card_number from public/js/order.js's 회원 modal — see
    // src/routes/members.js's POST /register-card, which is the only thing
    // that ever fills in google_uid/customer_name/customer_email below.
    // 1-year validity is computed from issue_date (not from when it was
    // claimed online), per the owner's existing physical-card program.
    vipCards: [],
    settings: {},
  };
}

// Stable object reference — every route file destructures `{ store }` once
// at require-time, so we mutate this object's contents rather than ever
// reassigning the `store` variable itself.
const store = defaultStore();

let db = null;
let clientPromise = null;
let clientReadyPromise = null;

function getClient() {
  if (!uri) {
    throw new Error(
      "MONGODB_URI is not set. Add it to your .env file (local dev) or your host's environment variables (Vercel/Railway)."
    );
  }
  if (!clientPromise) {
    // 서버리스에서는 요청이 느려질수록 Vercel 이 인스턴스를 더 띄운다.
    // 인스턴스마다 연결 10개를 가질 수 있게 두었더니 M0 의 500개 한도
    // 직전(약 480개)까지 치솟았고, 연결을 기다리는 모든 API 가 다시 느려져
    // 인스턴스와 연결이 더 늘어나는 악순환이 생겼다.
    //
    // 첫 조치로 3개까지 낮췄지만, 이미 포화된 운영 M0 에 새 배포가 붙자
    // 새 함수도 연결 자리를 기다리며 8~30초 이상 멈췄다. 이 앱의 쿼리는
    // 하나하나 수 ms이고 한 함수가 큰 병렬 작업을 하지 않으므로, 연결 하나로
    // 짧은 쿼리 세 개를 차례로 처리하는 편이 훨씬 안전하다. 유휴 연결은 다음
    // 서버리스 호출까지 계속 점유하지 않게 닫고, 새 연결도 한 번에 하나씩만
    // 열어 배포/콜드 스타트 때의 연결 폭주를 누른다.
    const client = new MongoClient(uri, {
      maxPoolSize: 1,
      minPoolSize: 0,
      maxConnecting: 1,
      maxIdleTimeMS: 30000,
    });
    clientPromise = client.connect();
  }
  return clientPromise;
}

// Ensures the Mongo client + db handle are ready. Cheap to call repeatedly
// (memoized for the life of this process) — this does NOT load `store`'s
// contents; call refreshStore() for that.
// 이 인스턴스가 몽고에 처음 붙는 데 걸린 시간. 콜드 스타트의 값이다.
//
// 2026-09-12 사장님: "근데 버셀이나 몽고 둘 다 서버가 서울인데?"
// 맞다. 왕복은 3ms 다(2026-09-10 리전 이동). 그러면 **따뜻한 인스턴스에서는
// 몽고가 느릴 수가 없다.** 그런데도 느리다면 남은 후보는 「따뜻하지 않은
// 인스턴스」다. 새로 뜬 인스턴스는 Atlas 로 TLS 를 새로 맺어야 하고 그건
// 왕복 3ms 짜리가 아니다. 그 값을 여기서 한 번만 재 둔다.
let connectMs = null;

async function connectDB() {
  if (clientReadyPromise) return clientReadyPromise;
  const t0 = Date.now();
  clientReadyPromise = (async () => {
    const client = await getClient();
    db = client.db(process.env.MONGODB_DB || "hangukgwan");
    // 요청마다 「몽고에서 보낸 시간」을 따로 세기 위해 한 번 감싼다
    // (src/dbTiming.js). 아침엔 빠르고 저녁엔 느린 이유가 몽고인지
    // 아닌지를 가르는 값이다.
    require("./dbTiming").wrapDb(db);
    connectMs = Date.now() - t0;
  })();
  return clientReadyPromise;
}

function firstConnectMs() {
  return connectMs;
}

// Re-fetches the latest store document from Mongo into the in-memory
// `store` object. Vercel can keep several separate warm server instances
// alive at once, each with its own copy of `store` in memory — if an
// instance only loaded it once at cold-start and never refreshed, a save()
// from that instance would overwrite newer changes another instance wrote
// in the meantime with its own stale snapshot (this was the cause of data
// randomly "resetting"). Call this once at the start of every request (see
// server.js) so every request always works from the current data before
// mutating and saving it.
// ---- 주문은 store 문서 밖에 산다 (2026-09-10) ----
//
// 사장님: "전반적으로 로그인이나 모든 액션들이 너무 오래 걸려. / 주문 →
// 조리중 → 서빙완료 넘어가는 버튼 누르면 최소 5~20초 이상 걸림. / 결제
// 완료 누르면 최소 5초 이상."
//
// 재보니 주문 한 건이 약 1.19KB이고, 그게 전부 store 문서 하나에 쌓이고
// 있었다. 하루 100건이면 한 달에 3.5MB. 그런데 이 앱은 요청마다 그 문서
// 전체를 읽고(refreshStore), 무언가 바꾸면 전체를 다시 쓴다(save). 그래서
// "조리 시작" 버튼 하나가 몇 MB를 읽고 몇 MB를 다시 쓰는 일이 됐다.
// 관리자 화면은 4초마다 폴링하므로 그 크기를 쉬지 않고 끌어온다.
//
// 게다가 이건 느림에서 끝나지 않는다 — MongoDB 문서 하나는 16MB가 한도라,
// 주문 약 13,700건(넉 달쯤)에서 저장 자체가 실패한다.
//
// 그래서 주문만 자기 컬렉션으로 옮긴다. 사진과 계정이 이미 같은 이유로
// 밖에 나가 있다(위 getDb 주석). store 문서는 메뉴·테이블·설정처럼 크기가
// 늘지 않는 것만 남아 30KB 근처에 머문다.
//
// 다만 코드 전체가 store.orders 를 그냥 배열처럼 쓰고 있다(filter/find/
// push, 15군데). 그걸 전부 비동기 질의로 바꾸면 손댈 곳이 너무 많고 그만큼
// 틀릴 곳도 많아진다. 그래서 store.orders 는 배열 그대로 두되, "지금 가게가
// 신경 쓰는 주문"만 담는다 —
//   · 아직 결제/취소되지 않은 주문 (며칠이 지났어도 받을 돈이다)
//   · 최근 며칠 안에 들어온 주문 (결산·재인쇄·수정이 닿는 범위)
// 지난 기록은 필요한 곳에서만 질의한다(findOrders 아래).
const ORDERS_COLLECTION = "orders";
// 며칠치를 메모리에 들고 있을지. 결산은 하루 단위로 닫히고, 재인쇄나 주문
// 수정이 며칠 전 것까지 거슬러 갈 일은 없다. 넉넉히 잡아도 며칠치는 수백
// 건이라 문서 하나로 다뤄도 가볍다.
const RECENT_DAYS = 3;

function recentCutoff(now = new Date()) {
  const { taipeiDateString } = require("./time");
  const d = new Date(now.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000);
  return taipeiDateString(d);
}

async function loadRecentOrders() {
  // 2026-09-13 — 이 함수가 4초였다.
  //
  // 사장님: "결제 탭, 결산 탭 ... 이런 게 너무 오래 걸려."
  // /api/_diag 로 재니 `orders_read_ms: 3979`. 요청 하나가 4.25초였는데 그중
  // 3.98초가 여기였다. 몽고 왕복 자체는 5ms 였다(`mongo_ping_ms`). 멀어서도,
  // 연결이 모자라서도, 콜드 스타트도 아니었다. **이 한 줄이었다.**
  //
  // 왜 느렸나 — 예전 질의는 이랬다.
  //
  //     { $or: [ { status: { $nin: ["paid","cancelled"] } },
  //              { created_at: { $gte: 사흘전 } } ] }
  //
  // `$nin` 은 **인덱스를 못 탄다.** 「이것만 빼고 전부」는 색인을 뒤져서 좁힐
  // 수가 없으니 하나하나 봐야 한다. 게다가 `$or` 의 한쪽이 그러면 전체가
  // 훑기가 된다. 그래서 안 끝난 주문 몇 건을 찾으려고 **영업 시작 이후의
  // 모든 주문**을 훑었다. 장사를 하루 더 할수록 훑을 것이 하루치 늘어난다 —
  // 아침에 빠르고 저녁에 느린 것이 이 모양이다.
  //
  // 어떻게 고치나 — 「끝나지 않은 것」을 「이 셋 중 하나」로 뒤집는다.
  // `$in` 은 인덱스를 탄다(`{status:1, created_at:1}`). 그리고 「최근 사흘」은
  // 원래부터 `{created_at:1}` 로 탈 수 있었다. 둘을 **따로, 나란히** 묻고
  // 합친다. `$or` 하나로 묶어 두면 계획을 짜는 쪽 마음이라 둘 다 훑을 수 있다.
  //
  // 뒤집으면서 위험해지는 자리가 하나 있다. 목록에서 빠진 상태가 있으면 그
  // 주문은 화면에서 **사라진다.** 이 가게에서 그건 받을 돈이 사라지는 것이다.
  // 그래서 상태 목록을 한 곳(src/orderStatus.js)에 두고, 주문을 저장하는
  // 라우트의 입력 검사도 같은 목록을 쓰게 했다. 모르는 상태는 애초에 못
  // 들어온다.
  const { serviceStartedAt } = require("./serviceStart");
  const { OPEN } = require("./orderStatus");
  const started = serviceStartedAt(store); // "YYYY-MM-DD HH:MM:SS" 또는 null
  const cutoff = recentCutoff(); // "YYYY-MM-DD"
  // 영업 시작 전(=테스트) 주문은 어느 쪽에도 안 들어가야 한다. 날짜가 앞에
  // 오는 형식이라 문자열 비교가 그대로 시간 비교가 된다.
  const from = started && started > cutoff ? started : cutoff;

  // (가) 안 끝난 주문 — 아무리 오래돼도 들고 있어야 한다. 화면에서 사라지면
  //      받을 돈이 사라진다. {status:1, created_at:1} 인덱스를 탄다.
  const openFilter = { status: { $in: OPEN } };
  if (started) openFilter.created_at = { $gte: started };

  // (나) 최근 며칠 — 상태와 무관하게. {created_at:1} 인덱스를 탄다.
  const recentFilter = { created_at: { $gte: from } };

  const col = db.collection(ORDERS_COLLECTION);
  const [openRows, recentRows] = await Promise.all([
    col.find(openFilter).toArray(),
    col.find(recentFilter).toArray(),
  ]);

  // 둘에 다 걸린 주문은 한 번만. _id 는 주문 번호 그대로다(saveOrder).
  const byId = new Map();
  for (const r of openRows) byId.set(r._id, r);
  for (const r of recentRows) byId.set(r._id, r);
  return [...byId.values()].map(stripMongoId).sort((a, b) => a.id - b.id);
}

function stripMongoId(row) {
  if (!row) return row;
  const { _id, ...rest } = row;
  return rest;
}

/**
 * 지난 주문까지 포함해 질의한다. 결산(기간 합계)과 손님 주문 내역처럼
 * 메모리에 안 들고 있는 범위를 봐야 하는 곳만 쓴다.
 */
async function findOrders(filter, opts = {}) {
  await connectDB();
  let cur = db.collection(ORDERS_COLLECTION).find(filter);
  if (opts.sort) cur = cur.sort(opts.sort);
  if (opts.limit) cur = cur.limit(opts.limit);
  const rows = await cur.toArray();
  return rows.map(stripMongoId);
}

/** 주문 한 건만 저장한다. store 문서 전체를 다시 쓰지 않는다. */
async function saveOrder(order) {
  await connectDB();
  await db
    .collection(ORDERS_COLLECTION)
    .replaceOne({ _id: order.id }, { ...order, _id: order.id }, { upsert: true });
  return order;
}

/** 여러 건을 한 번에. 결제처럼 여러 주문이 같이 바뀌는 경우. */
async function saveOrders(orders) {
  await connectDB();
  if (!orders.length) return;
  await db.collection(ORDERS_COLLECTION).bulkWrite(
    orders.map((o) => ({
      replaceOne: { filter: { _id: o.id }, replacement: { ...o, _id: o.id }, upsert: true },
    }))
  );
}

// store 문서에 더 이상 넣지 않는 키. 예전 데이터에는 남아 있을 수 있어서
// 읽을 때도 쓸 때도 여기서 걸러낸다.
// 2026-09-10 (2차): 사장님 — "지금 미리 준비하면 안되는거야?"
//
// 맞는 말이다. 주문만큼 급하지는 않지만(결제기록·정산·예약을 다 합쳐 연
// 3~4MB), 옮기는 비용은 지금이 가장 싸다. 실제 영업은 9월 8일 저녁에
// 시작했으니 옮길 기록이 아직 몇 줄뿐이고, 3년 뒤에 하면 수만 건의 돈
// 기록을 옮겨야 한다. 위험은 데이터가 쌓일수록 커지지 줄지 않는다.
//
// 이 셋은 주문과 달리 요청마다 필요하지 않다 — 결제 콜백, 결산 화면,
// 예약 탭에서만 쓴다. 그래서 메모리에 들고 있지 않고 쓸 때 질의한다.
// vipCards 는 남긴다: 물리 카드 수만큼만 늘어나 사실상 고정이고(200장에
// 0.03MB), 주문마다 VIP 할인을 보느라 매번 읽어야 해서 메모리에 있는
// 편이 맞다.
const OUT_OF_DOCUMENT = ["orders", "payments", "daily_settlements", "reservations"];

// 이름 그대로의 컬렉션에 한 건씩 저장한다. 셋 다 id 로 찾고, id 로 지운다.
const DOC_COLLECTIONS = {
  payments: "payments",
  daily_settlements: "daily_settlements",
  reservations: "reservations",
};

/** 컬렉션 전체(또는 조건에 맞는 것)를 배열로. 셋 다 크기가 작아 통째로 읽어도 된다. */
async function findDocs(kind, filter = {}, opts = {}) {
  await connectDB();
  const name = DOC_COLLECTIONS[kind];
  if (!name) throw new Error(`findDocs: 모르는 종류 ${kind}`);
  let cur = db.collection(name).find(filter);
  if (opts.sort) cur = cur.sort(opts.sort);
  if (opts.limit) cur = cur.limit(opts.limit);
  return (await cur.toArray()).map(stripMongoId);
}

/** 한 건 저장(있으면 덮어쓰기). */
async function saveDoc(kind, doc) {
  await connectDB();
  const name = DOC_COLLECTIONS[kind];
  if (!name) throw new Error(`saveDoc: 모르는 종류 ${kind}`);
  await db.collection(name).replaceOne({ _id: doc.id }, { ...doc, _id: doc.id }, { upsert: true });
  return doc;
}

/** 한 건 지우기. */
async function deleteDoc(kind, id) {
  await connectDB();
  const name = DOC_COLLECTIONS[kind];
  if (!name) throw new Error(`deleteDoc: 모르는 종류 ${kind}`);
  const r = await db.collection(name).deleteOne({ _id: id });
  return r.deletedCount > 0;
}

async function refreshStore({ includeOrders = true } = {}) {
  await connectDB();
  // store 문서는 모든 API가 읽지만, 최근 주문은 실제로 주문/테이블/결제를
  // 다루는 API만 읽는다(server.js 의 needsRecentOrders).
  //
  // 2026-09-12 사장님: "로그인도 그렇고 버튼 누르는 것도 그렇고 다" 느리다.
  // 예전에는 설정 한 칸, 메뉴 한 번, 로그인 한 번도 주문 컬렉션 질의 두 개를
  // 함께 치렀다. 주문 질의가 느려지면 주문과 아무 상관없는 화면까지 똑같이
  // 5~15초씩 멈춘 이유다. includeOrders=false 면 store 문서만 읽고, 이
  // 인스턴스가 이미 들고 있던 store.orders 는 건드리지 않는다.
  //
  // 주문이 필요한 경우에는 두 번 읽는다 — store 문서 하나, 최근 주문. 둘은
  // **동시에** 보낸다. 순서대로 해야 할 이유가 하나 있긴 했다. 주문 조건에 영업 시작
  // 시각(store.settings.service_started_at)이 들어가는데, 그 값은 방금
  // 읽어온 store 안에 있다. 그래서 「먼저 store, 그 다음 주문」이었다.
  //
  // 그 값은 하루에 한 번 바뀐다. 그래서 지금 들고 있는 값으로 먼저 같이
  // 쏘고, store 가 도착한 뒤에 **값이 정말 바뀌었는지 확인해서** 바뀌었을
  // 때만 주문을 다시 읽는다. 평소에는 왕복 하나가 사라지고, 바뀐 그 한
  // 번만 예전과 같아진다. 틀린 목록이 나갈 일은 없다.
  const { serviceStartedAt } = require("./serviceStart");
  const startBefore = serviceStartedAt(store);
  let existing;
  let ordersFirstTry;
  if (includeOrders) {
    [existing, ordersFirstTry] = await Promise.all([
      db.collection("store").findOne({ _id: "main" }, { projection: { orders: 0 } }),
      loadRecentOrders(),
    ]);
  } else {
    existing = await db.collection("store").findOne({ _id: "main" }, { projection: { orders: 0 } });
  }
  if (existing) {
    Object.assign(store, existing);
    // Backfill any keys missing (lets us evolve the schema safely later)
    const defaults = defaultStore();
    for (const k of Object.keys(defaults)) if (!(k in store)) store[k] = defaults[k];
    for (const k of Object.keys(defaults.nextId)) if (!(k in store.nextId)) store.nextId[k] = 1;
  } else {
    await db.collection("store").insertOne(withoutOutOfDocument(store));
  }
  if (includeOrders) {
    const startAfter = serviceStartedAt(store);
    const sameStart = String(startBefore || "") === String(startAfter || "");
    store.orders = sameStart ? ordersFirstTry : await loadRecentOrders();
  }
  lastRefreshAt = Date.now(); // refreshAndSave 가 "방금 읽었나"를 보는 값
}

function withoutOutOfDocument(obj) {
  const copy = { ...obj };
  for (const k of OUT_OF_DOCUMENT) delete copy[k];
  return copy;
}

async function save() {
  await connectDB();
  // 주문은 빼고 쓴다. 안 그러면 방금 밖으로 꺼낸 것을 매번 도로 집어넣는 셈이
  // 되고, 메모리에는 최근 며칠치만 있으므로 지난 주문을 통째로 날린다.
  await db.collection("store").replaceOne({ _id: "main" }, withoutOutOfDocument(store), { upsert: true });
}

// The per-request refreshStore() call in server.js only guards against
// staleness at the *start* of a request. For a slow request — the photo
// upload endpoint is the clear case, since savePhoto()'s Mongo round-trip
// can take a real stretch of wall-clock time — the in-memory `store` can go
// stale again before this request's own save() at the end, so a concurrent
// request elsewhere (an order coming in, a different admin edit) can commit
// its save() in between and then get silently overwritten by this one's
// now-outdated full-document replace, or vice versa (exactly the
// "data randomly resets" failure mode refreshStore()'s comment above
// describes, just triggered mid-request instead of only between requests).
//
// refreshAndSave() re-fetches immediately before mutating, narrowing that
// window to essentially just the mutate+save step. It's not a true atomic
// transaction (another save() could still land in the gap between this
// refresh and this save), but it shrinks the risk from "the whole request
// duration" to "a few milliseconds", which is what matters for something
// like a multi-second file upload.
//
// `mutate` must look up whatever it needs fresh off the `store` argument —
// refreshStore() replaces store.menuItems/etc. with new arrays, so
// any item/order reference captured before this call no longer lives in
// those arrays.
// 방금 읽었으면 또 읽지 않는다.
//
// 2026-09-12 사장님: "메뉴 수정하는 거 ... 이런 게 너무 오래 걸려."
// 재 보니 메뉴 항목 하나 고치는 데 몽고를 다섯 번 왕복했다. 그중 두 번이
// 같은 store 문서를 읽는 것이었다 — 요청이 들어올 때 server.js 미들웨어가
// 한 번(refreshStore), 그리고 저장 직전에 여기서 또 한 번.
//
// 저장 직전에 다시 읽는 이유는 "쓰는 순간과 읽은 순간 사이의 틈을 좁힌다"
// 였다. 그런데 그 미들웨어는 **같은 요청의 몇 밀리초 전**에 이미 읽었다.
// 그 사이에 좁힐 틈이 거의 없다. 틈이 정말 벌어지는 경우(요청 안에서 오래
// 걸리는 일을 하고 나서 저장하는 경우)만 다시 읽으면 된다.
//
// 그래서 시각을 재 두고, 방금 읽었으면 건너뛴다. 오래됐으면 예전처럼 읽는다.
// 이건 겹쳐쓰기(clobber) 대책이 아니다 — 그건 store 문서를 통째로 쓰지 않는
// 것으로만 풀린다(CLAUDE.md, patchArrayItem/saveFields). 여기서는 공짜로
// 사라지는 왕복 하나를 없앨 뿐이다.
const REFRESH_FRESH_MS = 2000;
let lastRefreshAt = 0;

async function refreshAndSave(mutate) {
  // refreshAndSave 의 모든 호출은 menuItems/tables/zones/vipCards 같은
  // store 문서 안의 값만 바꾼다. 주문은 별도 컬렉션에 있고 save()도 주문을
  // 쓰지 않으므로, 저장 직전 안전 확인 때문에 주문 두 질의를 다시 할 이유가
  // 없다. 주문이 필요한 라우트는 요청 시작 때 따로 읽는다(server.js).
  if (Date.now() - lastRefreshAt > REFRESH_FRESH_MS) await refreshStore({ includeOrders: false });
  await mutate(store);
  await save();
}

// Updates a handful of fields on ONE item inside a top-level array field of
// the main store document (e.g. store.tables, store.zones) via MongoDB's
// positional $ operator, instead of overwriting the entire store document
// the way save() does. This matters specifically for the 배치도 floor-plan
// editor: dragging/resizing a table or zone fires a PATCH per drop, and a
// person rearranging several tables fires several of these in quick
// succession. Two overlapping full-document save() calls can race — the
// second request reads the store (via the per-request refreshStore()) before
// the first request's save() has landed, then writes its own now-stale
// snapshot back over the top, silently discarding the first request's
// change. That's the "자꾸 바꿨는데 다시 되돌아간다" symptom: nothing errors,
// a change just quietly vanishes a moment after it was made. A positional
// update only ever touches the one array entry being edited, so two
// concurrent edits to two different tables/zones can no longer clobber each
// other this way (editing the exact same item from two places at once can
// still race, but that's not the reported scenario and is inherent to any
// last-write-wins store).
// Also updates the in-memory `store` copy so the rest of this request
// (the res.json(...) the caller sends back) reflects the change immediately
// without needing another round-trip to Mongo.
async function patchArrayItem(arrayField, id, updates) {
  await connectDB();
  const setDoc = {};
  for (const [key, val] of Object.entries(updates)) {
    setDoc[`${arrayField}.$.${key}`] = val;
  }
  await db.collection("store").updateOne({ _id: "main", [`${arrayField}.id`]: id }, { $set: setDoc });
  const item = (store[arrayField] || []).find((it) => it.id === id);
  if (item) Object.assign(item, updates);
  return item;
}

function nextId(collection) {
  return store.nextId[collection]++;
}

/**
 * store 문서에서 딱 그 필드들만 바꾼다. 통째로 덮어쓰지 않는다.
 *
 * 2026-09-10 사장님(장사 중, 스크린샷과 함께): "보면 7이랑 9는 결제완료를
 * 했는데 인원이 안 사라져있어."
 *
 * 인원수를 지우는 코드는 멀쩡했다(test/party-size.test.js, 그리고 실제로
 * 다시 재봐도 전부 지워진다). 지워진 뒤에 되살아난 것이었다.
 *
 * save() 는 store 문서 「전체」를 그 순간 이 인스턴스가 들고 있는 값으로
 * 갈아끼운다. 그런데 점심 장사에는 주문이 계속 들어오고, 주문 하나가
 * 들어올 때마다 그 요청도 save() 를 부른다(주문 번호 카운터 때문에).
 * 그 요청이 「결제로 인원수를 지우기 직전」의 사본을 들고 있었다면, 저장이
 * 끝나는 순간 지운 인원수가 문서에 되돌아온다. 화면에는 아무 오류도 없고,
 * 인원수만 조용히 살아난다.
 *
 * patchArrayItem 의 주석에 이미 같은 이야기가 적혀 있다 — 배치도에서
 * "자꾸 바꿨는데 다시 되돌아간다" 던 그 일이다. 그때는 tables 배열의 한
 * 칸이었고, 이번엔 같은 문서의 다른 칸일 뿐이다.
 *
 * 그래서 자주 오가는 길에서는 문서를 통째로 쓰지 않는다. 이 함수는 준
 * 필드만 $set 한다 — 다른 요청이 같은 문서의 다른 곳을 동시에 고쳐도
 * 서로를 지우지 않는다.
 */
async function saveFields(fields) {
  await connectDB();
  const setDoc = {};
  for (const [k, v] of Object.entries(fields)) setDoc[k] = v;
  if (!Object.keys(setDoc).length) return;
  await db.collection("store").updateOne({ _id: "main" }, { $set: setDoc }, { upsert: true });
}

/**
 * 겹치지 않는 번호를 하나 받아온다.
 *
 * 2026-09-10 사장님(장사 중): "9번 테이블은 주문해도 프린트 자체가 안되고
 * 있음. 근데 또 웃긴건 7번 테이블은 자동으로 나왔대."
 *
 * 한 테이블만 안 찍히는 건 인쇄 문제가 아니었다. 주문 번호가 겹치고 있었다.
 *
 * 번호는 store 문서의 nextId.orders 에서 나오는데, 그 문서를 통째로
 * 덮어쓰는 save() 가 여기저기서 불린다(주문이 들어올 때마다도 불렸다).
 * 조금 오래된 사본을 들고 있던 요청이 save() 를 하면 카운터가 뒤로 간다.
 * 그러면 다음 손님의 주문이 「이미 있는 번호」로 만들어지고,
 *   - saveOrder 는 그 번호로 upsert 하므로 앞 주문을 덮어쓰고,
 *   - 관리자 화면은 그 번호를 이미 본 것으로 알고 있어서 빌지를 안 찍는다.
 * 9번 테이블에서 일어난 일이 정확히 이것이다.
 *
 * 그래서 번호는 메모리가 아니라 데이터베이스에서 원자적으로 받아온다.
 * $inc 는 서버 한 곳에서 일어나므로 두 요청이 같은 번호를 받을 수 없다.
 * floor 는 안전판이다 — 이미 카운터가 뒤로 가 있는 상태로 배포되더라도,
 * 지금 알고 있는 가장 큰 번호보다는 반드시 위에서 시작한다.
 */
async function reserveId(collection, floor) {
  await connectDB();
  const key = `nextId.${collection}`;
  if (floor && Number.isFinite(floor)) {
    await db.collection("store").updateOne({ _id: "main" }, { $max: { [key]: floor } });
  }
  const res = await db
    .collection("store")
    .findOneAndUpdate({ _id: "main" }, { $inc: { [key]: 1 } }, { returnDocument: "after", upsert: true });
  // 드라이버 판마다 모양이 다르다(v4~v5 는 {value}, v6 는 문서 그대로).
  const doc = res && res.value !== undefined ? res.value : res;
  const after = doc && doc.nextId ? doc.nextId[collection] : null;
  if (typeof after === "number" && after > 1) {
    store.nextId[collection] = after;
    return after - 1;
  }
  // 데이터베이스가 답을 못 준 아주 예외적인 경우에만 메모리로 돌아간다 —
  // 번호가 없어서 주문을 못 받는 것보다는 낫다.
  return nextId(collection);
}

/**
 * 프로세스가 뜰 때 한 번 — 주문 번호 카운터를 실제 최대 번호 위로 올린다.
 *
 * 위(reserveId)에서 설명한 덮어쓰기로 카운터가 이미 뒤로 가 있을 수 있다.
 * 그 상태로 새 배포가 올라가면, 원자적으로 번호를 받아와도 여전히 이미
 * 쓰인 번호부터 세기 시작한다 — 겹침이 그대로 이어진다.
 *
 * 주문 컬렉션에서 가장 큰 번호를 한 번만 읽어 그 위로 올린다. 요청마다
 * 하지 않는다(주문 하나에 왕복 하나가 더 붙는다).
 */
let orderIdFloorEnsured = false;
async function ensureOrderIdFloor() {
  if (orderIdFloorEnsured) return;
  await connectDB();
  const rows = await db
    .collection(ORDERS_COLLECTION)
    .find({}, { projection: { id: 1 } })
    .sort({ id: -1 })
    .limit(1)
    .toArray();
  const top = rows && rows[0];
  if (top && typeof top.id === "number") {
    await db.collection("store").updateOne({ _id: "main" }, { $max: { "nextId.orders": top.id + 1 } });
    if (!(store.nextId.orders > top.id)) store.nextId.orders = top.id + 1;
  }
  orderIdFloorEnsured = true;
}

// 주문 번호 카운터 하나만 올린다. 예전에는 이것 때문에 주문이 들어올
// 때마다 store 문서 전체가 다시 쓰였다 — 그게 위에서 말한 「덮어쓰는 쪽」의
// 정체다. 카운터는 자기 칸만 올리면 된다.
async function saveNextId(collection) {
  await saveFields({ [`nextId.${collection}`]: store.nextId[collection] });
}

// ---- Photo storage (separate collection, one document per photo) ----

async function savePhoto(buffer, contentType) {
  await connectDB();
  const result = await db.collection("photos").insertOne({
    data: buffer,
    contentType,
    created_at: new Date(),
  });
  return result.insertedId.toString();
}

async function getPhoto(id) {
  await connectDB();
  if (!ObjectId.isValid(id)) return null;
  return db.collection("photos").findOne({ _id: new ObjectId(id) });
}

async function deletePhoto(id) {
  await connectDB();
  if (!id || !ObjectId.isValid(id)) return;
  await db.collection("photos").deleteOne({ _id: new ObjectId(id) });
}

// The raw Mongo db handle, for data that deliberately does NOT live inside
// the single `store` document. `store` is re-read in full on every request
// (refreshStore above) and re-written in full on every save, which is fine
// for a restaurant's menu/tables/settings but wrong for anything that grows
// without bound and is looked up by key — photos already live in their own
// collection for exactly this reason, and so do user accounts
// (src/accounts.js). Callers must await connectDB() first (or call this
// after any other db.js call that already did).
function getDb() {
  if (!db) throw new Error("getDb() called before connectDB() — await connectDB() first.");
  return db;
}

module.exports = {
  connectDB, getDb, getClient, refreshStore, store, save, refreshAndSave, patchArrayItem, nextId,
  saveFields, saveNextId, reserveId, ensureOrderIdFloor,
  savePhoto, getPhoto, deletePhoto,
  firstConnectMs,
  loadRecentOrders,
  findOrders, saveOrder, saveOrders, ORDERS_COLLECTION, RECENT_DAYS, recentCutoff,
  findDocs, saveDoc, deleteDoc, DOC_COLLECTIONS, OUT_OF_DOCUMENT,
};
