// 엑셀 정답표를 읽어 「가게|업체|날짜」로 돌려준다.
// 사장님 엑셀 장부가 있는 자리. 저장소에 안 들어가므로 환경변수로 받는다.
//   HG_LEDGER=D:/한국관자료  node tools/harvest.js
const LEDGER = process.env.HG_LEDGER || path.join(__dirname, "..", "..", "..", "transcript");
const fs = require("fs");
const path = require("path");
const G = require("../src/ingredients.js");
global.window = global.window || {};
require("../public/js/xlsx-lite.js");
const { readXlsx } = global.window.HG_XLSX;
const HEAD = { 날짜:"date", 내용:"name", 품명:"name", 수량:"qty", 단위:"unit", 단가:"price", 금액:"amount", 업체명:"vendor", 업체:"vendor", 비고:"note" };
const tidy = (x) => String(x == null ? "" : x).replace(/\s+/g, "").trim();
function parseSheet(sheet, store) {
  let found = null;
  for (let i = 0; i < Math.min(sheet.rows.length, 60); i++) {
    const map = {}; let hits = 0;
    (sheet.rows[i] || []).forEach((cell, c) => { const k = HEAD[tidy(cell)]; if (k && map[k] === undefined) { map[k] = c; hits++; } });
    if (hits >= 5 && map.date !== undefined && map.name !== undefined) { found = { row: i, map }; break; }
  }
  if (!found) return [];
  const { row: hr, map } = found;
  const pick = (r, k) => (map[k] === undefined ? "" : r[map[k]] || "");
  const out = [];
  for (let i = hr + 1; i < sheet.rows.length; i++) {
    const r = sheet.rows[i] || [];
    const n = G.normalizeRow({ date: pick(r,"date"), name: pick(r,"name"), qty: pick(r,"qty"), unit: pick(r,"unit"), price: pick(r,"price"), amount: pick(r,"amount"), vendor: pick(r,"vendor"), note: pick(r,"note") }, store);
    if (n) out.push(n);
  }
  return out;
}
module.exports.load = async function load() {
  const truth = new Map();
  for (const file of ["한국관 식자재 -2025.xlsx", "한국관 식자재 자료 - 2025부터.xlsx"]) {
    const b = fs.readFileSync(path.join(LEDGER, file));
    const { sheets } = await readXlsx(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    for (const s of sheets) {
      const store = G.storeOfSheetName(s.name);
      if (!store) continue;
      const byKey = new Map();
      for (const r of parseSheet(s, store)) {
        const k = `${r.store}|${r.vendor}|${r.date}`;
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k).push(r);
      }
      for (const [k, v] of byKey) truth.set(k, v);
    }
  }
  return truth;
};
module.exports.keyOf = function keyOf(base) {
  const m = /^(.+)-(\d{8})(?:-(.*))?$/.exec(base);
  if (!m) return null;
  return {
    key: `${(m[3] || "").includes("台元") ? "branch3" : "main"}|${G.canonicalVendor(m[1])}|${m[2].slice(0,4)}-${m[2].slice(4,6)}-${m[2].slice(6,8)}`,
    store: (m[3] || "").includes("台元") ? "branch3" : "main",
  };
};
