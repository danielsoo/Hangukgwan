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
    nextId: { categories: 1, menuItems: 1, tables: 1, orders: 1 },
    categories: [],
    menuItems: [],
    tables: [],
    orders: [],
    settings: {},
  };
}

// Stable object reference — every route file destructures `{ store }` once
// at require-time, so we mutate this object's contents rather than ever
// reassigning the `store` variable itself.
const store = defaultStore();

let db = null;
let clientPromise = null;
let readyPromise = null;

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

// Call this before touching `store` or the database. Safe to call many
// times — the actual connect + load only happens once per running process.
async function connectDB() {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    const client = await getClient();
    db = client.db(process.env.MONGODB_DB || "hangukgwan");

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
  })();
  return readyPromise;
}

async function save() {
  await connectDB();
  await db.collection("store").replaceOne({ _id: "main" }, store, { upsert: true });
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

module.exports = { connectDB, store, save, nextId, savePhoto, getPhoto, deletePhoto };
