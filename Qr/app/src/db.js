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
    const client = new MongoClient(uri);
    clientPromise = client.connect();
  }
  return clientPromise;
}

// Ensures the Mongo client + db handle are ready. Cheap to call repeatedly
// (memoized for the life of this process) — this does NOT load `store`'s
// contents; call refreshStore() for that.
async function connectDB() {
  if (clientReadyPromise) return clientReadyPromise;
  clientReadyPromise = (async () => {
    const client = await getClient();
    db = client.db(process.env.MONGODB_DB || "hangukgwan");
  })();
  return clientReadyPromise;
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
  const cutoff = recentCutoff();
  // 안 끝난 주문은 아무리 오래돼도 들고 있어야 한다 — 화면에서 사라지면
  // 받을 돈이 사라진다.
  const rows = await db
    .collection(ORDERS_COLLECTION)
    .find({ $or: [{ status: { $nin: ["paid", "cancelled"] } }, { created_at: { $gte: cutoff } }] })
    .toArray();
  return rows.map(stripMongoId).sort((a, b) => a.id - b.id);
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
const OUT_OF_DOCUMENT = ["orders"];

async function refreshStore() {
  await connectDB();
  // orders 는 이제 이 문서에 없다. 옛 문서에 남아 있더라도 끌어오지 않는다
  // — 그 몇 MB를 안 읽는 것이 이 변경의 전부다.
  const existing = await db
    .collection("store")
    .findOne({ _id: "main" }, { projection: { orders: 0 } });
  if (existing) {
    Object.assign(store, existing);
    // Backfill any keys missing (lets us evolve the schema safely later)
    const defaults = defaultStore();
    for (const k of Object.keys(defaults)) if (!(k in store)) store[k] = defaults[k];
    for (const k of Object.keys(defaults.nextId)) if (!(k in store.nextId)) store.nextId[k] = 1;
  } else {
    await db.collection("store").insertOne(withoutOutOfDocument(store));
  }
  store.orders = await loadRecentOrders();
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
// refreshStore() replaces store.menuItems/orders/etc. with new arrays, so
// any item/order reference captured before this call no longer lives in
// those arrays.
async function refreshAndSave(mutate) {
  await refreshStore();
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
  connectDB, getDb, refreshStore, store, save, refreshAndSave, patchArrayItem, nextId,
  savePhoto, getPhoto, deletePhoto,
  findOrders, saveOrder, saveOrders, ORDERS_COLLECTION, RECENT_DAYS, recentCutoff,
};
