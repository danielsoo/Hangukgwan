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
async function refreshStore() {
  await connectDB();
  const existing = await db.collection("store").findOne({ _id: "main" });
  if (existing) {
    Object.assign(store, existing);
    // Backfill any keys missing (lets us evolve the schema safely later)
    const defaults = defaultStore();
    for (const k of Object.keys(defaults)) if (!(k in store)) store[k] = defaults[k];
    for (const k of Object.keys(defaults.nextId)) if (!(k in store.nextId)) store.nextId[k] = 1;
  } else {
    await db.collection("store").insertOne(store);
  }
}

async function save() {
  await connectDB();
  await db.collection("store").replaceOne({ _id: "main" }, store, { upsert: true });
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

module.exports = { connectDB, refreshStore, store, save, refreshAndSave, patchArrayItem, nextId, savePhoto, getPhoto, deletePhoto };
