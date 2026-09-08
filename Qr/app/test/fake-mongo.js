// Minimal in-memory stand-in for the small slice of the `mongodb` driver
// this app actually uses, so the account/auth routes can be tested without
// a real mongod (the sandbox can't download one). Injected into
// require.cache before src/db.js loads.
let counter = 0;

class ObjectId {
  constructor(id) {
    this._id = id ? String(id) : `oid${(++counter).toString().padStart(20, "0")}`;
  }
  toString() {
    return this._id;
  }
  toHexString() {
    return this._id;
  }
  equals(other) {
    return String(other) === this._id;
  }
  static isValid(id) {
    return typeof id === "string" ? /^[a-zA-Z0-9]{1,32}$/.test(id) : id instanceof ObjectId;
  }
}

function matches(doc, filter) {
  for (const [key, cond] of Object.entries(filter || {})) {
    const val = key === "_id" ? String(doc._id) : doc[key];
    if (cond && typeof cond === "object" && !(cond instanceof ObjectId)) {
      if ("$in" in cond) {
        if (!cond.$in.includes(val)) return false;
        continue;
      }
      return false;
    }
    const want = cond instanceof ObjectId ? String(cond) : cond;
    if (key === "_id" ? String(val) !== String(want) : val !== want) return false;
  }
  return true;
}

class Collection {
  constructor(name) {
    this.name = name;
    this.docs = [];
    this.indexes = [];
  }
  async createIndex(spec, opts = {}) {
    this.indexes.push({ spec, opts });
    return "ok";
  }
  _checkUnique(doc, ignoreId) {
    for (const { spec, opts } of this.indexes) {
      if (!opts.unique) continue;
      const field = Object.keys(spec)[0];
      const val = doc[field];
      if (val == null && opts.sparse) continue;
      if (val == null) continue;
      const clash = this.docs.find((d) => d[field] === val && String(d._id) !== String(ignoreId));
      if (clash) {
        const err = new Error(`E11000 duplicate key error: ${field}`);
        err.code = 11000;
        throw err;
      }
    }
  }
  async findOne(filter) {
    return this.docs.find((d) => matches(d, filter)) || null;
  }
  async insertOne(doc) {
    const _id = doc._id || new ObjectId();
    const full = { ...doc, _id };
    this._checkUnique(full, _id);
    this.docs.push(full);
    return { insertedId: _id };
  }
  async updateOne(filter, update, opts = {}) {
    const doc = this.docs.find((d) => matches(d, filter));
    if (!doc) {
      if (opts.upsert) {
        await this.insertOne({ ...filter, ...(update.$set || {}) });
        return { upsertedCount: 1 };
      }
      return { matchedCount: 0 };
    }
    if (update.$set) {
      const candidate = { ...doc, ...update.$set };
      this._checkUnique(candidate, doc._id);
      Object.assign(doc, update.$set);
    }
    return { matchedCount: 1 };
  }
  async replaceOne(filter, doc, opts = {}) {
    const idx = this.docs.findIndex((d) => matches(d, filter));
    if (idx >= 0) this.docs[idx] = { ...doc };
    else if (opts.upsert) this.docs.push({ ...doc });
    return { matchedCount: idx >= 0 ? 1 : 0 };
  }
  async deleteOne(filter) {
    const idx = this.docs.findIndex((d) => matches(d, filter));
    if (idx >= 0) this.docs.splice(idx, 1);
    return { deletedCount: idx >= 0 ? 1 : 0 };
  }
  async countDocuments(filter = {}) {
    return this.docs.filter((d) => matches(d, filter)).length;
  }
  find(filter = {}) {
    let rows = this.docs.filter((d) => matches(d, filter));
    const chain = {
      sort(spec) {
        const [field, dir] = Object.entries(spec)[0];
        rows = [...rows].sort((a, b) => ((a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0) * dir));
        return chain;
      },
      limit(n) {
        rows = rows.slice(0, n);
        return chain;
      },
      async toArray() {
        return rows;
      },
    };
    return chain;
  }
}

class Db {
  constructor() {
    this.cols = new Map();
  }
  collection(name) {
    if (!this.cols.has(name)) this.cols.set(name, new Collection(name));
    return this.cols.get(name);
  }
}

const theDb = new Db();

class MongoClient {
  constructor() {}
  async connect() {
    return this;
  }
  db() {
    return theDb;
  }
}

module.exports = { MongoClient, ObjectId, __db: theDb };
