// 읽은 영수증으로 **사장님 장부의 빈 줄을 채운다.**
//
// 2026-10-05 사장님: "전에 줬던 엑셀 규정과 양식 모든 걸 그대로 유지한채로
// 채워줄 수 있어?"
//
// 맨 아래에 줄을 붙이면 **안 된다.** 사장님 장부에는 규정이 있다:
//
//  · 품목은 **12~15200줄** 안에만 있어야 한다. 그 아래(15207~15579)는
//    **날짜별 합계표**이고 `SUMIF($B$12:$B$15200, …, $G$12:$G$15200)` 로
//    품목 범위를 가리킨다. 범위 밖에 쓰면 합계에 안 잡힌다.
//  · 실제 자료는 11528줄(2026-09-16)까지이고, 그 뒤 3,677줄은 **미리 서식과
//    수식을 넣어 둔 빈 줄**이다. 품명 칸에 `=윗줄` 이 들어 있어 아래로 끌면
//    복사된다.
//  · 금액 칸은 **수식 `=D*F`** 다. 그래서 종이의 금액이 수량 × 단가와 안
//    맞으면 사장님은 **수량을 소수로** 적으신다(3.3333 × 18 = 60).
//
// 그래서 이 도구는 **빈 줄을 차례로 채운다.** 줄마다 원래 붙어 있던 서식
// (`s=` 번호, 줄 높이)을 그대로 두고 값만 넣는다.
//
// ── 공유 수식을 깨뜨리지 않는다
//
// 빈 줄의 품명 칸은 「공유 수식」이다 — 한 줄이 본체(`ref="C11529:C11592"`)고
// 나머지는 그것을 가리킨다(`<f t="shared" si="255"/>`). 본체가 든 줄을 덮어
// 쓰면 나머지가 **주인을 잃고** 엑셀이 파일이 깨졌다고 한다.
//
// 그래서 본체를 덮어쓸 때는 **아직 안 덮은 다음 줄로 본체를 옮긴다.**
//
// ── 쓰는 법
//
//   node tools/fill-ledger.js 장부.xlsx 읽은것.json [새장부.xlsx]
//
// 원본은 건드리지 않는다. 새 파일로 쓴다.
const fs = require("fs");
const path = require("path");
const Z = require("./append-to-ledger.js");   // zip 읽고 쓰기·날짜·한국어 이름

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 줄 하나를 통째로 집는다. 스스로 닫는 줄(`<row .../>`)도 집는다. */
function cutRows(xml) {
  const out = [];
  const re = /<row r="(\d+)"([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(xml))) {
    const start = m.index;
    let end;
    if (m[3] === "/") end = re.lastIndex;
    else {
      const close = xml.indexOf("</row>", re.lastIndex);
      if (close < 0) break;
      end = close + 6;
    }
    out.push({ n: +m[1], attrs: m[2], start, end, text: xml.slice(start, end), selfClose: m[3] === "/" });
  }
  return out;
}

/**
 * 줄 하나의 칸들을 **제대로** 집는다.
 *
 * 스스로 닫는 빈 칸(`<c r="B15200" s="56"/>`)을 그냥 정규식으로 긁으면 그
 * 다음 칸의 `</c>` 까지 삼킨다 — 그래서 빈 칸이 옆 칸 내용을 가진 것으로
 * 보이고, 품목 영역의 **맨 끝 줄(15200)을 자료 줄로 세어** 「빈 줄이 0개」가
 * 됐다.
 */
function cellsOf(text) {
  const out = {};
  const re = /<c r="([A-Z]+)(\d+)"([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(text))) {
    const col = m[1];
    const sm = /\ss="(\d+)"/.exec(m[3]);
    if (m[4] === "/") { out[col] = { style: sm ? sm[1] : null, inner: "" }; continue; }
    const close = text.indexOf("</c>", re.lastIndex);
    out[col] = { style: sm ? sm[1] : null, inner: close < 0 ? "" : text.slice(re.lastIndex, close) };
    if (close >= 0) re.lastIndex = close + 4;
  }
  return out;
}

/** 그 줄의 칸마다 style 번호. 없으면 null. */
function stylesOf(text) {
  const out = {};
  for (const [col, c] of Object.entries(cellsOf(text))) out[col] = c.style;
  return out;
}

/** 그 줄이 **진짜 자료**인가 — 날짜와 품명이 수식이 아니라 값으로 들어 있나. */
function isRealData(text) {
  const cs = cellsOf(text);
  const c = cs.C, b = cs.B;
  if (!c || !b) return false;
  if (/<f[ >\/]/.test(c.inner) || /<f[ >\/]/.test(b.inner)) return false;   // `=윗줄` 같은 틀
  if (!/<v>|<is>/.test(c.inner)) return false;                              // 품명이 비었다
  return /<v>\d+<\/v>/.test(b.inner);                                       // 날짜가 숫자로
}

/** 수식의 상대 참조를 아래로 민다(C11528 → C11563). `$B$12` 같은 것은 둔다. */
function shiftFormula(text, delta) {
  return String(text).replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)/g,
    (all, d1, col, d2, row) => (d2 ? all : `${d1}${col}${+row + delta}`));
}

/**
 * 장부의 빈 줄을 채운다.
 * @returns {{bytes, report, filled, noKorean, lastRow}}
 */
async function fill(ledgerPath, receipts, opts) {
  const o = Object.assign({ fillKorean: true, maxItemRow: null }, opts || {});
  const buf = fs.readFileSync(ledgerPath);
  const entries = Z.readZip(buf);
  const inflate = async (e) => {
    if (e.method === 0) return Buffer.from(e.raw).toString("utf8");
    const ds = new DecompressionStream("deflate-raw");
    return Buffer.from(await new Response(new Blob([e.raw]).stream().pipeThrough(ds)).arrayBuffer()).toString("utf8");
  };
  const deflate = async (t) => {
    const cs = new CompressionStream("deflate-raw");
    return Buffer.from(await new Response(new Blob([Buffer.from(t, "utf8")]).stream().pipeThrough(cs)).arrayBuffer());
  };

  const wb = await inflate(entries.find((e) => e.name === "xl/workbook.xml"));
  const names = [...wb.matchAll(/<sheet[^>]*name="([^"]+)"/g)].map((m) => m[1]);
  const sheetFile = {};
  names.forEach((nm, i) => {
    const store = Z.SHEET_OF(nm);
    if (store) sheetFile[store] = { name: nm, file: `xl/worksheets/sheet${i + 1}.xml` };
  });

  // 한국어 이름은 장부에서 찾는다 — 지어내지 않는다
  let koMap = new Map();
  if (o.fillKorean) {
    global.window = global.window || {};
    require(path.join(__dirname, "..", "public", "js", "xlsx-lite.js"));
    const { sheets } = await global.window.HG_XLSX.readXlsx(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    for (const s of sheets) {
      if (!Z.SHEET_OF(s.name)) continue;
      for (const [k, v] of Z.koreanNames(s.rows)) if (!koMap.has(k)) koMap.set(k, v);
    }
  }

  const byStore = { main: [], branch3: [] };
  for (const r of receipts) {
    const store = r.store === "branch3" ? "branch3" : "main";
    const serial = Z.toSerial(r.date);
    const month = Number(String(r.date).slice(5, 7));
    const vendor = String(r.vendor || "").normalize("NFC").trim();
    for (const line of r.rows || []) {
      const name = String(line.name || "").normalize("NFC").trim();
      const price = Number(line.price), amount = Number(line.amount);
      if (!name || !(price > 0) || !(amount > 0)) continue;
      // 금액 칸이 수식이라 **수량 = 금액 ÷ 단가**로 넣어야 종이의 금액이 나온다
      const qty = line.qty != null && Math.abs(Number(line.qty) * price - amount) < 0.005
        ? Number(line.qty) : amount / price;
      byStore[store].push({
        serial, month, vendor, name, price, amount,
        qty: Math.round(qty * 1e10) / 1e10,
        unit: String(line.unit || ""),
        note: String(line.name_ko || koMap.get(name) || ""),
      });
    }
  }

  const report = [];
  let noKorean = 0, filled = 0;
  for (const store of ["main", "branch3"]) {
    const lines = byStore[store];
    if (!lines.length) continue;
    const target = sheetFile[store];
    if (!target) throw new Error(`${store} 시트를 못 찾았습니다`);
    const entry = entries.find((e) => e.name === target.file);
    let xml = await inflate(entry);

    // 품목이 들어갈 수 있는 끝 줄. 합계 수식이 가리키는 범위에서 읽는다.
    const sum = /SUMIF\(\$B\$(\d+):\$B\$(\d+)/.exec(xml);
    const maxRow = o.maxItemRow || (sum ? +sum[2] : 15200);

    const rows = cutRows(xml);
    const byNum = new Map(rows.map((r) => [r.n, r]));
    // 진짜 자료가 든 마지막 줄
    let lastData = 0;
    for (const r of rows) if (r.n <= maxRow && isRealData(r.text)) lastData = Math.max(lastData, r.n);
    if (!lastData) throw new Error("자료 줄을 못 찾았습니다");

    // 채울 자리: 그 다음 줄부터, 비어 있는 것만
    const slots = [];
    for (let n = lastData + 1; n <= maxRow && slots.length < lines.length; n++) {
      const r = byNum.get(n);
      if (!r || r.selfClose) continue;
      if (isRealData(r.text)) continue;      // 뜻밖에 자료가 있으면 건너뛴다
      slots.push(r);
    }
    if (slots.length < lines.length) {
      throw new Error(`${target.name}: 빈 줄이 ${slots.length}개뿐인데 ${lines.length}줄을 넣어야 합니다`);
    }

    lines.sort((a, b) => a.serial - b.serial || a.vendor.localeCompare(b.vendor));

    // 덮어쓸 줄에 **공유 수식 본체**가 있으면 다음 줄로 옮겨야 한다
    const taken = new Set(slots.map((s) => s.n));
    const masters = [];   // {si, col, text, endRow}
    for (const s of slots) {
      for (const m of s.text.matchAll(/<c r="([A-Z]+)(\d+)"[^>]*><f t="shared" ref="[A-Z]+\d+:([A-Z]+)(\d+)" si="(\d+)">([\s\S]*?)<\/f>/g)) {
        masters.push({ col: m[1], row: +m[2], endRow: +m[4], si: m[5], text: m[6] });
      }
    }

    const edits = new Map();   // 줄 번호 → 새 XML
    slots.forEach((slot, i) => {
      const L = lines[i];
      if (!L.note) noKorean++;
      const st = stylesOf(slot.text);
      const n = slot.n;
      const sAttr = (c) => (st[c] == null ? "" : ` s="${st[c]}"`);
      const str = (c, v) => `<c r="${c}${n}"${sAttr(c)} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
      const num = (c, v) => `<c r="${c}${n}"${sAttr(c)}><v>${v}</v></c>`;
      const cells = [];
      if (st.A !== undefined) cells.push(`<c r="A${n}"${sAttr("A")}/>`);
      cells.push(num("B", L.serial));
      cells.push(str("C", L.name));
      cells.push(num("D", L.qty));
      cells.push(str("E", L.unit));
      cells.push(num("F", L.price));
      // 금액은 사장님 장부대로 **수식**
      cells.push(`<c r="G${n}"${sAttr("G")}><f>D${n}*F${n}</f><v>${L.amount}</v></c>`);
      cells.push(str("H", L.vendor));
      cells.push(str("I", L.note));
      cells.push(num("J", L.month));
      for (const c of ["K", "L"]) if (st[c] !== undefined) cells.push(`<c r="${c}${n}"${sAttr(c)}/>`);
      edits.set(n, `<row r="${n}"${slot.attrs}>${cells.join("")}</row>`);
      filled++;
    });

    // 주인을 잃은 공유 수식에 새 주인을 세운다
    for (const m of masters) {
      let next = 0;
      for (let n = Math.max(...slots.map((s) => s.n)) + 1; n <= m.endRow; n++) {
        if (taken.has(n)) continue;
        const r = byNum.get(n);
        if (r && new RegExp(`<c r="${m.col}${n}"[^>]*><f t="shared" si="${m.si}"\\s*/>`).test(r.text)) { next = n; break; }
      }
      if (!next) continue;   // 따르는 줄이 없으면 그냥 사라져도 된다
      const r = byNum.get(next);
      const moved = `<f t="shared" ref="${m.col}${next}:${m.col}${m.endRow}" si="${m.si}">${esc(shiftFormula(m.text, next - m.row))}</f>`;
      const txt = (edits.get(next) || r.text).replace(
        new RegExp(`(<c r="${m.col}${next}"[^>]*>)<f t="shared" si="${m.si}"\\s*/>`),
        (all, head) => head + moved);
      edits.set(next, txt);
    }

    // 바꾼 줄들을 제자리에 끼운다 (뒤에서부터 — 앞 자리가 안 밀리게)
    const ordered = rows.filter((r) => edits.has(r.n)).sort((a, b) => b.start - a.start);
    for (const r of ordered) xml = xml.slice(0, r.start) + edits.get(r.n) + xml.slice(r.end);

    const body = Buffer.from(xml, "utf8");
    entry.raw = await deflate(xml);
    entry.method = 8;
    entry.crc = (() => { const c = require("crypto"); return null; })() || crc32(body);
    entry.usize = body.length;
    entry.csize = entry.raw.length;
    const firstDate = lines[0].serial, lastDate = lines[lines.length - 1].serial;
    const ymd = (n) => new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
    report.push(`${target.name}: ${lastData + 1}~${slots[slots.length - 1].n}줄에 ${lines.length}줄 (${ymd(firstDate)} ~ ${ymd(lastDate)}) · 빈 줄 ${maxRow - slots[slots.length - 1].n}개 남음`);
  }

  // 수식을 건드렸으니 계산 차례표는 지운다 — 엑셀이 다시 만든다
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
  return { bytes: Z.writeZip(entries), report, filled, noKorean };
}

// append-to-ledger 의 것을 그대로 쓴다 (한 벌만 둔다)
let CRC_TABLE = null;
function crc32(b) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

if (require.main === module) {
  (async () => {
    const [ledger, jsonFile, outFile] = process.argv.slice(2);
    if (!ledger || !jsonFile) {
      console.log("쓰는 법: node tools/fill-ledger.js 장부.xlsx 읽은것.json [새장부.xlsx]");
      process.exit(1);
    }
    const receipts = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
    const got = await fill(ledger, Array.isArray(receipts) ? receipts : [receipts]);
    const out = outFile || ledger.replace(/\.xlsx$/i, "") + " (채움).xlsx";
    fs.writeFileSync(out, got.bytes);
    got.report.forEach((r) => console.log(`  ${r}`));
    console.log(`모두 ${got.filled}줄을 채웠습니다.`);
    if (got.noKorean) console.log(`  ※ 한국어 이름을 못 찾은 줄 ${got.noKorean}개 — 비고를 비워 뒀습니다`);
    console.log(`\n${out}\n원본은 그대로 두고 새 파일로 썼습니다.`);
  })().catch((e) => { console.error("실패:", e.message); process.exit(1); });
}

module.exports = { fill, cutRows, cellsOf, isRealData, shiftFormula, stylesOf };
