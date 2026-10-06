// 읽은 영수증을 **사장님 장부 파일에 그대로 덧붙인다.**
//
// 2026-10-05 사장님: "전에 줬던 엑셀 규정과 양식 모든 걸 그대로 유지한채로
// 채워줄 수 있어?"
//
// `rows-to-xlsx.js` 는 새 파일을 만든다(가져오기용). 이것은 다르다 —
// **사장님이 쓰시는 그 파일**을 열어 맨 아래에 줄만 더한다. 서식·수식·
// 메모·그림·인쇄 설정이 전부 그대로 남는다.
//
// ── 사장님 양식 (한국관 식자재 자료 - 2025부터.xlsx)
//
//   시트: 韓國館總店 / 韓國館台元三店
//   11줄: 머리글   「날짜 · 내  용 · 수량 · 단위 · 단가 · 금액 · 업체명 · 비  고 · 월」
//   12줄부터 자료. A열은 비우고 B열부터 쓴다.
//
//     B 날짜   **엑셀 일련번호**(45658 = 2025-01-01). 글자가 아니다.
//     C 내용   중국어 품명
//     D 수량   숫자
//     E 단위   斤·包·把…
//     F 단가   숫자
//     G 금액   **수식 `=D*F`** — 손으로 넣는 칸이 아니다
//     H 업체명
//     I 비  고 **한국어 이름**(당근·파·목이버섯…)
//     J 월     숫자
//
// 금액이 수식이라는 것이 중요하다. 종이의 금액이 수량 × 단가와 안 맞으면
// 사장님은 **수량을 소수로** 적으신다(3.3333 × 18 = 60). 우리도 그렇게 한다 —
// 수량 = 금액 ÷ 단가. 그래야 종이에 적힌 금액이 그대로 보인다.
//
// 비고의 한국어 이름은 **장부에서 찾아 넣는다.** 그 품목을 전에 사신 적이
// 있으면 그때 쓰신 말을 그대로 쓴다(紅蘿蔔 → 당근). 처음 보는 품목이면
// 비워 두고 몇 줄인지 말해 준다 — 지어내지 않는다.
//
// ── 쓰는 법
//
//   node tools/append-to-ledger.js 장부.xlsx 읽은것.json [새장부.xlsx]
//
// 원본은 **건드리지 않는다.** 새 파일로 쓴다.
const fs = require("fs");
const path = require("path");

// ───────── zip 읽고 쓰기 (꾸러미를 안 늘린다) ─────────

function readZip(buf) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= 0 && i > u8.length - 66000; i--) {
    if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("xlsx 파일이 아닙니다 (zip 꼬리를 못 찾음)");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const nameLen = dv.getUint16(p + 28, true);
    const extra = dv.getUint16(p + 30, true);
    const cmt = dv.getUint16(p + 32, true);
    const e = {
      name: Buffer.from(u8.slice(p + 46, p + 46 + nameLen)).toString("utf8"),
      flags: dv.getUint16(p + 8, true),
      method: dv.getUint16(p + 10, true),
      time: dv.getUint16(p + 12, true),
      date: dv.getUint16(p + 14, true),
      crc: dv.getUint32(p + 16, true),
      csize: dv.getUint32(p + 20, true),
      usize: dv.getUint32(p + 24, true),
      lho: dv.getUint32(p + 42, true),
    };
    const lhNameLen = dv.getUint16(e.lho + 26, true);
    const lhExtra = dv.getUint16(e.lho + 28, true);
    const start = e.lho + 30 + lhNameLen + lhExtra;
    e.raw = u8.slice(start, start + e.csize);   // 눌린 그대로. 안 건드릴 것은 이대로 다시 쓴다.
    entries.push(e);
    p += 46 + nameLen + extra + cmt;
  }
  return entries;
}

async function inflate(e) {
  if (e.method === 0) return Buffer.from(e.raw).toString("utf8");
  const ds = new DecompressionStream("deflate-raw");
  const out = new Response(new Blob([e.raw]).stream().pipeThrough(ds));
  return Buffer.from(await out.arrayBuffer()).toString("utf8");
}

async function deflate(text) {
  const cs = new CompressionStream("deflate-raw");
  const out = new Response(new Blob([Buffer.from(text, "utf8")]).stream().pipeThrough(cs));
  return Buffer.from(await out.arrayBuffer());
}

// CRC-32. 엑셀은 이것이 틀리면 파일을 안 연다.
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function writeZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(e.flags & ~0x08, 6);   // 자료 기술자는 안 쓴다
    lh.writeUInt16LE(e.method, 8);
    lh.writeUInt16LE(e.time, 10);
    lh.writeUInt16LE(e.date, 12);
    lh.writeUInt32LE(e.crc, 14);
    lh.writeUInt32LE(e.csize, 18);
    lh.writeUInt32LE(e.usize, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    parts.push(lh, name, Buffer.from(e.raw));
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(e.flags & ~0x08, 8);
    ch.writeUInt16LE(e.method, 10);
    ch.writeUInt16LE(e.time, 12);
    ch.writeUInt16LE(e.date, 14);
    ch.writeUInt32LE(e.crc, 16);
    ch.writeUInt32LE(e.csize, 20);
    ch.writeUInt32LE(e.usize, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += lh.length + name.length + e.raw.length;
  }
  const cdStart = offset;
  let cdLen = 0;
  for (const b of central) cdLen += b.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdLen, 12);
  eocd.writeUInt32LE(cdStart, 16);
  return Buffer.concat([...parts, ...central, eocd]);
}

// ───────── 날짜 ─────────

/** 2025-01-01 → 45658. 엑셀은 1899-12-30 을 0 으로 센다. */
function toSerial(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
  if (!m) throw new Error(`날짜가 이상합니다: ${ymd}`);
  const d = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return Math.round((d - Date.UTC(1899, 11, 30)) / 86400000);
}

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ───────── 장부에 더하기 ─────────

/**
 * 그 시트의 마지막 줄 번호와, **베낄 본보기 줄**의 생김새를 찾는다.
 *
 * 줄마다 s·ht 같은 것이 붙어 있어서, 새 줄도 같은 것을 달아야 보기가 같다.
 */
function lastRowInfo(xml) {
  const rows = [...xml.matchAll(/<row r="(\d+)"([^>]*)>/g)];
  if (!rows.length) throw new Error("자료 줄이 없습니다");
  const last = rows[rows.length - 1];
  // 본보기는 **자료가 든** 마지막 줄 — 맨 끝 빈 줄이 아니라.
  let sample = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const start = rows[i].index;
    const end = xml.indexOf("</row>", start);
    const body = xml.slice(start, end);
    if (/<c r="B\d+"[^>]*><v>\d+<\/v>/.test(body)) { sample = { n: +rows[i][1], attrs: rows[i][2], body }; break; }
  }
  if (!sample) throw new Error("본보기로 쓸 자료 줄을 못 찾았습니다");
  return { lastRow: +last[1], sample };
}

/** 본보기 줄에서 칸마다 style 번호를 뽑는다. */
function stylesOf(body) {
  const out = {};
  for (const m of body.matchAll(/<c r="([A-L])\d+"(?:\s+s="(\d+)")?/g)) out[m[1]] = m[2] == null ? null : m[2];
  return out;
}

function cell(ref, style, inner) {
  const s = style == null ? "" : ` s="${style}"`;
  return inner == null ? `<c r="${ref}"${s}/>` : `<c r="${ref}"${s}${inner}`;
}

function makeRow(n, attrs, st, line) {
  const num = (v) => `><v>${v}</v></c>`;
  const str = (v) => ` t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  const parts = [`<row r="${n}"${attrs}>`];
  parts.push(cell(`A${n}`, st.A, null));
  parts.push(cell(`B${n}`, st.B, num(line.serial)));
  parts.push(cell(`C${n}`, st.C, str(line.name)));
  parts.push(cell(`D${n}`, st.D, num(line.qty)));
  parts.push(cell(`E${n}`, st.E, str(line.unit)));
  parts.push(cell(`F${n}`, st.F, num(line.price)));
  // 금액은 **수식**이다 — 사장님 장부가 그렇게 돼 있다
  parts.push(cell(`G${n}`, st.G, `><f>D${n}*F${n}</f><v>${line.amount}</v></c>`));
  parts.push(cell(`H${n}`, st.H, str(line.vendor)));
  parts.push(cell(`I${n}`, st.I, str(line.note)));
  parts.push(cell(`J${n}`, st.J, num(line.month)));
  if (st.K !== undefined) parts.push(cell(`K${n}`, st.K, null));
  if (st.L !== undefined) parts.push(cell(`L${n}`, st.L, null));
  parts.push("</row>");
  return parts.join("");
}

/** 장부에서 「중국어 품명 → 사장님이 쓰시는 한국어 말」을 모은다. */
function koreanNames(sheetRows) {
  const by = new Map();
  for (const r of sheetRows) {
    const zh = String(r[2] || "").normalize("NFC").trim();
    const ko = String(r[8] || "").normalize("NFC").trim();
    if (!zh || !ko) continue;
    const m = by.get(zh) || new Map();
    m.set(ko, (m.get(ko) || 0) + 1);
    by.set(zh, m);
  }
  const out = new Map();
  for (const [zh, m] of by) {
    let best = "", n = 0;
    for (const [ko, c] of m) if (c > n) { n = c; best = ko; }
    out.set(zh, best);
  }
  return out;
}

const SHEET_OF = (name) => {
  const s = String(name || "").normalize("NFC");
  if (s.includes("總店") || s.includes("본점")) return "main";
  if (s.includes("台元") || s.includes("2호점")) return "branch3";
  return null;
};

async function append(ledgerPath, receipts, opts) {
  const o = Object.assign({ fillKorean: true }, opts || {});
  const buf = fs.readFileSync(ledgerPath);
  const entries = readZip(buf);

  // 어느 시트가 어느 지점인지 — workbook.xml 의 차례가 sheet1·sheet2 다
  const wb = await inflate(entries.find((e) => e.name === "xl/workbook.xml"));
  const names = [...wb.matchAll(/<sheet[^>]*name="([^"]+)"/g)].map((m) => m[1]);
  const sheetFile = {};
  names.forEach((nm, i) => {
    const store = SHEET_OF(nm);
    if (store) sheetFile[store] = { name: nm, file: `xl/worksheets/sheet${i + 1}.xml` };
  });

  // 한국어 이름을 장부에서 찾으려고 한 번 읽어 둔다
  let koMap = new Map();
  if (o.fillKorean) {
    global.window = global.window || {};
    require(path.join(__dirname, "..", "public", "js", "xlsx-lite.js"));
    const { readXlsx } = global.window.HG_XLSX;
    const { sheets } = await readXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    for (const s of sheets) {
      if (!SHEET_OF(s.name)) continue;
      const m = koreanNames(s.rows);
      for (const [k, v] of m) if (!koMap.has(k)) koMap.set(k, v);
    }
  }

  const byStore = { main: [], branch3: [] };
  for (const r of receipts) {
    const store = r.store === "branch3" ? "branch3" : "main";
    const serial = toSerial(r.date);
    const month = Number(String(r.date).slice(5, 7));
    const vendor = String(r.vendor || "").normalize("NFC").trim();
    for (const line of r.rows || []) {
      const name = String(line.name || "").normalize("NFC").trim();
      if (!name) continue;
      const price = Number(line.price);
      const amount = Number(line.amount);
      if (!(price > 0) || !(amount > 0)) continue;
      // **수량 = 금액 ÷ 단가.** 금액 칸이 수식이라 이렇게 해야 종이의 금액이
      // 그대로 보인다 — 사장님도 그렇게 적으신다(3.3333 × 18 = 60).
      const qty = line.qty != null && Math.abs(Number(line.qty) * price - amount) < 0.005
        ? Number(line.qty)
        : amount / price;
      byStore[store].push({
        serial, month, vendor, name,
        qty: Math.round(qty * 1e10) / 1e10,
        unit: String(line.unit || ""),
        price, amount,
        note: String(line.name_ko || koMap.get(name) || ""),
      });
    }
  }

  const report = [];
  let noKorean = 0;
  for (const store of ["main", "branch3"]) {
    const lines = byStore[store];
    if (!lines.length) continue;
    const target = sheetFile[store];
    if (!target) throw new Error(`${store} 시트를 못 찾았습니다`);
    const entry = entries.find((e) => e.name === target.file);
    if (!entry) throw new Error(`${target.file} 이 없습니다`);
    let xml = await inflate(entry);
    const { lastRow, sample } = lastRowInfo(xml);
    const st = stylesOf(sample.body);
    // 날짜 → 업체 차례로. 사장님 장부가 그 차례다.
    lines.sort((a, b) => a.serial - b.serial || a.vendor.localeCompare(b.vendor));
    const made = lines.map((l, i) => {
      if (!l.note) noKorean++;
      return makeRow(lastRow + 1 + i, sample.attrs, st, l);
    }).join("");
    const at = xml.lastIndexOf("</sheetData>");
    if (at < 0) throw new Error("sheetData 끝을 못 찾았습니다");
    xml = xml.slice(0, at) + made + xml.slice(at);
    // 쓰는 범위를 늘려 준다 — 안 하면 엑셀이 아래 줄을 못 본다
    xml = xml.replace(/<dimension ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/,
      (m0, c1, r1, c2) => `<dimension ref="${c1}${r1}:${c2}${lastRow + lines.length}"`);
    const body = Buffer.from(xml, "utf8");
    entry.raw = await deflate(xml);
    entry.method = 8;
    entry.crc = crc32(body);
    entry.usize = body.length;
    entry.csize = entry.raw.length;
    report.push(`${target.name}: ${lastRow} 줄 뒤에 ${lines.length}줄 더함`);
  }

  // calcChain 은 **지운다.** 수식 칸을 새로 넣었는데 그 목록이 옛날 것이면
  // 엑셀이 「문제가 있습니다」를 띄운다. 없으면 엑셀이 알아서 다시 만든다.
  const calc = entries.findIndex((e) => e.name === "xl/calcChain.xml");
  if (calc >= 0) {
    entries.splice(calc, 1);
    for (const name of ["[Content_Types].xml", "xl/_rels/workbook.xml.rels"]) {
      const e = entries.find((x) => x.name === name);
      if (!e) continue;
      let t = await inflate(e);
      t = t.replace(/<Override[^>]*calcChain[^>]*\/>/g, "").replace(/<Relationship[^>]*calcChain[^>]*\/>/g, "");
      const b2 = Buffer.from(t, "utf8");
      e.raw = await deflate(t);
      e.method = 8;
      e.crc = crc32(b2);
      e.usize = b2.length;
      e.csize = e.raw.length;
    }
  }

  return { bytes: writeZip(entries), report, noKorean, added: byStore.main.length + byStore.branch3.length };
}

if (require.main === module) {
  (async () => {
    const [ledger, jsonFile, outFile] = process.argv.slice(2);
    if (!ledger || !jsonFile) {
      console.log("쓰는 법: node tools/append-to-ledger.js 장부.xlsx 읽은것.json [새장부.xlsx]");
      process.exit(1);
    }
    const receipts = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
    const got = await append(ledger, Array.isArray(receipts) ? receipts : [receipts]);
    const out = outFile || ledger.replace(/\.xlsx$/i, "") + " (채움).xlsx";
    fs.writeFileSync(out, got.bytes);
    got.report.forEach((r) => console.log(`  ${r}`));
    console.log(`모두 ${got.added}줄`);
    if (got.noKorean) console.log(`  ※ 한국어 이름을 못 찾은 줄 ${got.noKorean}개 — 비고를 비워 뒀습니다`);
    console.log(`\n${out}`);
    console.log("원본은 그대로 두고 새 파일로 썼습니다.");
  })().catch((e) => { console.error("실패:", e.message); process.exit(1); });
}

module.exports = { append, toSerial, readZip, writeZip, koreanNames, SHEET_OF };
