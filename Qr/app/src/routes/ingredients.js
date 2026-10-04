// 식자재 매입 — 사장님만(src/ingredients.js 머리말).
//
// 2026-10-04 사장님: "gitignore 추가하고 가져오기부터 해줘, 사장님만 보이게."
//
// 급여·결산과 같은 자리에 둔다 — 지출 금액은 직원에게 보이면 안 되는 것이고,
// 탭에 들어갈 때마다 비밀번호를 한 번 더 묻는다(src/sensitiveLock.js).
const express = require("express");
const { getDb, connectDB } = require("../db");
const { requireOwner } = require("../auth");
const G = require("../ingredients");

const router = express.Router();
router.use(requireOwner);
router.use(require("../sensitiveLock").requireUnlocked("ingredients"));

// 인덱스는 한 번만 만든다. 서버리스 인스턴스마다 매 요청에 createIndex 를
// 부르면 작은 DB 에서도 첫 요청이 그만큼 늦어진다
// (src/migrations/2026-09-13-runtime-indexes.js 와 같은 이유).
let indexedOnce = false;
async function col() {
  await connectDB();
  const c = getDb().collection(G.PURCHASES);
  if (!indexedOnce) {
    indexedOnce = true;
    try {
      await c.createIndex({ store: 1, date: -1 });
      await c.createIndex({ date: -1 });
      await c.createIndex({ name: 1, date: 1 });
      await c.createIndex({ vendor: 1, date: -1 });
    } catch (e) {
      // 인덱스가 없어도 읽기는 된다 — 느릴 뿐이다. 막지 않는다.
      console.warn("[ingredients] 인덱스 생성 실패:", e && e.message);
      indexedOnce = false;
    }
  }
  return c;
}

/** 조회 범위. 날짜가 없으면 전체 기간. */
function rangeQuery(q) {
  const where = {};
  const store = String(q.store || "").trim();
  if (store && store !== "all") where.store = store;
  const start = G.anyDate(q.start);
  const end = G.anyDate(q.end);
  if (start || end) {
    where.date = {};
    if (start) where.date.$gte = start;
    if (end) where.date.$lte = end;
  }
  return where;
}

/**
 * 엑셀에서 읽은 줄을 받는다. 화면이 날짜 단위로 잘라 여러 번 보낸다.
 *
 * **그 날짜를 통째로 지우고 다시 넣는다.** 그래야 엑셀에서 줄을 고치거나
 * 지운 뒤 다시 가져와도 옛 줄이 남지 않는다. 한 날짜가 두 덩이로 쪼개져
 * 오면 뒤 덩이가 앞 덩이를 지워버리므로, 화면은 **한 날짜를 쪼개지 않는다**
 * (public/js/ingredients-import.js). 그 약속을 서버도 확인한다.
 */
router.post("/import", async (req, res) => {
  const body = req.body || {};
  const store = String(body.store || "").trim();
  if (!G.storeByKey(store)) return res.status(400).json({ error: "unknown_store" });
  const raw = Array.isArray(body.rows) ? body.rows : null;
  if (!raw) return res.status(400).json({ error: "no_rows" });
  if (raw.length > 5000) return res.status(400).json({ error: "too_many_rows" });

  const rows = raw.map((r) => G.normalizeRow(r, store)).filter(Boolean);
  const skipped = raw.length - rows.length;
  if (!rows.length) return res.json({ ok: true, inserted: 0, skipped, dates: 0 });

  const c = await col();
  const covered = G.datesCovered(rows);
  let removed = 0;
  for (const { store: s, dates } of covered) {
    const r = await c.deleteMany({ store: s, date: { $in: dates } });
    removed += (r && r.deletedCount) || 0;
  }
  const docs = G.withIds(rows);
  // 같은 열쇠가 덩이 안에서 겹치면(있을 수 없지만) 마지막 것이 남게 한다.
  await c.bulkWrite(docs.map((d) => ({ replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } })));
  res.json({ ok: true, inserted: docs.length, skipped, removed, dates: covered.reduce((n, x) => n + x.dates.length, 0) });
});

/** 지금 들어 있는 것 — 기간·줄 수·지점. 가져오기 전에 무엇이 있는지 본다. */
router.get("/meta", async (req, res) => {
  const c = await col();
  const total = await c.countDocuments({});
  const first = await c.find({}).sort({ date: 1 }).limit(1).toArray();
  const last = await c.find({}).sort({ date: -1 }).limit(1).toArray();
  const perStore = [];
  for (const s of G.STORES) {
    perStore.push({ ...s, lines: await c.countDocuments({ store: s.key }) });
  }
  res.json({
    total,
    first: (first[0] && first[0].date) || null,
    last: (last[0] && last[0].date) || null,
    stores: perStore,
    vendor_aliases: G.VENDOR_ALIASES,
  });
});

/** 업체별·품목별·달별 집계. */
router.get("/summary", async (req, res) => {
  const c = await col();
  const rows = await c.find(rangeQuery(req.query), { projection: { _id: 0 } }).toArray();
  res.json(G.summarize(rows));
});

/** 한 품목의 단가가 언제 얼마였나. */
router.get("/prices", async (req, res) => {
  const name = String((req.query || {}).name || "").trim();
  if (!name) return res.status(400).json({ error: "no_name" });
  const c = await col();
  const rows = await c.find({ ...rangeQuery(req.query), name }, { projection: { _id: 0 } }).toArray();
  res.json({ name, points: G.priceHistory(rows) });
});

/** 줄 목록. 많으면 잘라서 주고, 잘렸다고 말한다. */
router.get("/rows", async (req, res) => {
  const q = req.query || {};
  const where = rangeQuery(q);
  const vendor = String(q.vendor || "").trim();
  if (vendor) where.vendor = G.canonicalVendor(vendor);
  const name = String(q.name || "").trim();
  if (name) where.name = name;
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 300, 1), 2000);
  const c = await col();
  const rows = await c.find(where, { projection: { _id: 0 } }).sort({ date: -1 }).limit(limit + 1).toArray();
  res.json({ rows: rows.slice(0, limit), truncated: rows.length > limit });
});

/**
 * 전부 지운다. 가져오기를 처음부터 다시 할 때만.
 *
 * 2만 줄을 되돌릴 방법이 없으므로 화면이 한 번 더 묻고, 여기서도 지점을
 * 반드시 받는다 — 실수로 양쪽을 한꺼번에 날리지 않게.
 */
router.delete("/all", async (req, res) => {
  const store = String((req.query || {}).store || "").trim();
  if (!G.storeByKey(store)) return res.status(400).json({ error: "unknown_store" });
  const c = await col();
  const r = await c.deleteMany({ store });
  res.json({ ok: true, removed: (r && r.deletedCount) || 0 });
});

module.exports = router;
