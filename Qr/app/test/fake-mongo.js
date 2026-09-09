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

function cmp(a, b) {
  if (a instanceof Date || b instanceof Date) {
    return new Date(a).getTime() - new Date(b).getTime();
  }
  if (a === b) return 0;
  return a > b ? 1 : -1;
}

// Supports the operator subset this codebase and connect-mongo actually use.
// connect-mongo is the reason $or/$gt/$exists are here: its session lookup is
// `{_id: sid, $or: [{expires: {$exists: false}}, {expires: {$gt: now}}]}`, and
// without them every session read missed and the browser looked logged out on
// the very next request.
function matchOne(val, cond) {
  if (cond && typeof cond === "object" && !(cond instanceof ObjectId) && !(cond instanceof Date) && !Array.isArray(cond)) {
    const ops = Object.keys(cond);
    if (ops.length && ops.every((k) => k.startsWith("$"))) {
      for (const [op, want] of Object.entries(cond)) {
        switch (op) {
          case "$in":
            if (!want.some((w) => String(w) === String(val) || w === val)) return false;
            break;
          case "$nin":
            if (want.some((w) => String(w) === String(val) || w === val)) return false;
            break;
          case "$ne":
            if (val === want) return false;
            break;
          case "$exists":
            if (want !== (val !== undefined && val !== null)) return false;
            break;
          case "$gt":
            if (!(val !== undefined && cmp(val, want) > 0)) return false;
            break;
          case "$gte":
            if (!(val !== undefined && cmp(val, want) >= 0)) return false;
            break;
          case "$lt":
            if (!(val !== undefined && cmp(val, want) < 0)) return false;
            break;
          case "$lte":
            if (!(val !== undefined && cmp(val, want) <= 0)) return false;
            break;
          default:
            return false;
        }
      }
      return true;
    }
  }
  const want = cond instanceof ObjectId ? String(cond) : cond;
  if (val instanceof ObjectId || want instanceof ObjectId) return String(val) === String(want);
  return val === want;
}

// 필드를 골라 내보낸다. {orders: 0} 처럼 빼는 형태와 {orders: 1} 처럼
// 고르는 형태 둘 다 — src/db.js 의 refreshStore() 가 store 문서에서 주문을
// 빼고 읽는 데 쓴다. 예전에는 두 번째 인자를 통째로 무시해서, "주문을 안
// 읽는다"는 이 변경의 핵심이 테스트에서 확인되지 않았다.
function project(doc, projection) {
  if (!projection || !Object.keys(projection).length) return doc;
  const keys = Object.keys(projection).filter((k) => k !== "_id");
  const including = keys.some((k) => projection[k]);
  const out = {};
  if (including) {
    if (projection._id !== 0) out._id = doc._id;
    for (const k of keys) if (projection[k] && k in doc) out[k] = doc[k];
    return out;
  }
  for (const [k, v] of Object.entries(doc)) {
    if (k === "_id" && projection._id === 0) continue;
    if (keys.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

function matches(doc, filter) {
  for (const [key, cond] of Object.entries(filter || {})) {
    if (key === "$or") {
      if (!cond.some((sub) => matches(doc, sub))) return false;
      continue;
    }
    if (key === "$and") {
      if (!cond.every((sub) => matches(doc, sub))) return false;
      continue;
    }
    // "tables.id": 41 처럼 배열 안을 가리키는 조건 — 배열 원소 중 하나라도
    // 맞으면 참이다. 진짜 MongoDB 가 하는 일이고, src/db.js 의
    // patchArrayItem() 이 이 형태로 필터를 건다.
    if (key.includes(".") && key !== "_id") {
      const [field, sub] = key.split(".");
      if (Array.isArray(doc[field])) {
        if (!doc[field].some((el) => matchOne(el && el[sub], cond))) return false;
        continue;
      }
    }
    const val = key === "_id" ? (doc._id instanceof ObjectId ? String(doc._id) : doc._id) : doc[key];
    const want = key === "_id" && cond instanceof ObjectId ? String(cond) : cond;
    if (!matchOne(val, want)) return false;
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
  async findOne(filter, opts = {}) {
    const doc = this.docs.find((d) => matches(d, filter)) || null;
    return doc ? project(doc, opts.projection) : null;
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
      // "tables.$.zone_id" 같은 위치 지정 갱신 — $ 는 이 문서에서 필터에
      // 맞은 첫 배열 원소를 가리킨다. 예전에는 이걸 몰라서 그런 키를 문서에
      // 통째로 붙여 넣고(그래서 아무 일도 일어나지 않고) 조용히 넘어갔다.
      // src/db.js 의 patchArrayItem() 이 배치도 드래그/크기조절/이름변경에
      // 모두 이 형태를 쓰므로, 그 경로가 테스트에서 전부 무의미해져 있었다.
      const plain = {};
      const positional = new Map(); // field -> { sub: value }
      for (const [k, v] of Object.entries(update.$set)) {
        const m = /^([^.]+)\.\$\.(.+)$/.exec(k);
        if (m) {
          if (!positional.has(m[1])) positional.set(m[1], {});
          positional.get(m[1])[m[2]] = v;
        } else {
          plain[k] = v;
        }
      }
      for (const [field, patch] of positional) {
        const arr = doc[field];
        if (!Array.isArray(arr)) continue;
        // 필터에서 이 배열을 고르는 조건을 찾아 그 원소를 집는다.
        const cond = Object.entries(filter).find(([k]) => k.startsWith(field + "."));
        const el = cond
          ? arr.find((x) => matchOne(x && x[cond[0].slice(field.length + 1)], cond[1]))
          : arr[0];
        if (el) Object.assign(el, patch);
      }
      // "settings.admin_password_hash" 처럼 중첩된 객체 안을 가리키는 키.
      // 진짜 MongoDB 는 그 안쪽 값을 바꾸는데, 예전에는 저 문자열을 통째로
      // 문서의 키로 만들어 버려서 아무 일도 안 일어난 것처럼 보였다 —
      // 위치 지정($) 갱신 때와 같은 함정이다.
      const nested = {};
      for (const k of Object.keys(plain)) {
        if (!k.includes(".")) continue;
        nested[k] = plain[k];
        delete plain[k];
      }
      for (const [k, v] of Object.entries(nested)) {
        const parts = k.split(".");
        let cur = doc;
        for (let i = 0; i < parts.length - 1; i++) {
          if (cur[parts[i]] == null || typeof cur[parts[i]] !== "object") cur[parts[i]] = {};
          cur = cur[parts[i]];
        }
        cur[parts[parts.length - 1]] = v;
      }
      const candidate = { ...doc, ...plain };
      this._checkUnique(candidate, doc._id);
      Object.assign(doc, plain);
    }
    if (update.$unset) {
      for (const k of Object.keys(update.$unset)) {
        if (!k.includes(".")) {
          delete doc[k];
          continue;
        }
        const parts = k.split(".");
        let cur = doc;
        for (let i = 0; i < parts.length - 1 && cur; i++) cur = cur[parts[i]];
        if (cur) delete cur[parts[parts.length - 1]];
      }
    }
    if (update.$inc) {
      for (const [k, v] of Object.entries(update.$inc)) doc[k] = (doc[k] || 0) + v;
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
  // 여러 건을 한 번에 쓴다. src/db.js 의 saveOrders() 와 주문 이관
  // 마이그레이션이 쓴다. 예전에는 이 메서드가 없어서, 그 경로를 지나는
  // 테스트가 있었다면 그냥 터졌을 것이다 — 없어서 안 터졌을 뿐이고,
  // 그건 "통과"가 아니라 "안 지나감"이다.
  async bulkWrite(ops = []) {
    let upserted = 0;
    let modified = 0;
    let deleted = 0;
    for (const op of ops) {
      if (op.replaceOne) {
        const { filter, replacement, upsert } = op.replaceOne;
        const idx = this.docs.findIndex((d) => matches(d, filter));
        if (idx >= 0) { this.docs[idx] = { ...replacement }; modified++; }
        else if (upsert) { this.docs.push({ ...replacement }); upserted++; }
      } else if (op.updateOne) {
        const { filter, update, upsert } = op.updateOne;
        await this.updateOne(filter, update, { upsert });
        modified++;
      } else if (op.deleteOne) {
        const idx = this.docs.findIndex((d) => matches(d, op.deleteOne.filter));
        if (idx >= 0) { this.docs.splice(idx, 1); deleted++; }
      } else if (op.insertOne) {
        await this.insertOne(op.insertOne.document);
        upserted++;
      } else {
        throw new Error(`fake-mongo: bulkWrite 가 모르는 연산 ${Object.keys(op).join(",")}`);
      }
    }
    return { upsertedCount: upserted, modifiedCount: modified, deletedCount: deleted };
  }
  async countDocuments(filter = {}) {
    return this.docs.filter((d) => matches(d, filter)).length;
  }
  find(filter = {}, opts = {}) {
    let rows = this.docs.filter((d) => matches(d, filter)).map((d) => project(d, opts.projection));
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
  // connect-mongo (the express-session store) calls the *static* form.
  static async connect() {
    return new MongoClient();
  }
}

module.exports = { MongoClient, ObjectId, __db: theDb };
