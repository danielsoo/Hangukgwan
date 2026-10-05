// 엑셀(.xlsx)을 브라우저 안에서 **만든다**. 라이브러리 없이.
//
// 2026-10-05 사장님: "사진들을 급여처럼 올리면 인식해서 **엑셀에 기입하고**
// 우리 시스템에도 기입해서 급여처럼 볼 수 있게."
//
// 시스템에 쌓는 것만으로는 사장님의 엑셀이 멈춘다. 18년을 그 파일로
// 해 오셨고, 세무·거래처에 보낼 일도 그 모양이다. 그래서 **같은 모양의
// 엑셀을 언제든 다시 받을 수 있게** 한다.
//
// 읽는 쪽(xlsx-lite.js)과 짝이다. 받은 파일을 다시 넣어도 같은 자료가 되는지
// test/xlsx-write.test.js 가 왕복으로 잰다.
//
// ── xlsx 는 zip 이고 그 안은 XML 이다
//
//   [Content_Types].xml        무슨 부품이 들었나
//   _rels/.rels                workbook 이 어디 있나
//   xl/workbook.xml            시트 이름
//   xl/_rels/workbook.xml.rels 시트 파일 이름
//   xl/worksheets/sheetN.xml   칸 값
//
// 글자는 공유표(sharedStrings) 없이 칸 안에 바로 넣는다(inlineStr) — 부품이
// 하나 줄고, 엑셀·넘버스·구글시트 모두 그대로 읽는다.
(function () {
  "use strict";

  const enc = new TextEncoder();

  const esc = (s) =>
    String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      // 엑셀이 못 읽는 제어문자는 뺀다 — 손으로 적은 비고에 섞여 들어온다.
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

  /** 0 → "A", 26 → "AA" */
  function colName(n) {
    let s = "";
    n += 1;
    while (n > 0) {
      const r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function cellXml(ref, v) {
    if (v == null || v === "") return "";
    if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  }

  function sheetXml(rows) {
    const body = rows
      .map((cells, r) => {
        const inner = (cells || []).map((v, c) => cellXml(`${colName(c)}${r + 1}`, v)).join("");
        return inner ? `<row r="${r + 1}">${inner}</row>` : "";
      })
      .join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
  }

  // ── zip 쓰기 ─────────────────────────────────────────────────────────
  // CRC-32 는 zip 이 요구한다. 엑셀은 이걸 실제로 검사하므로 제대로 넣는다.
  let CRC_TABLE = null;
  function crc32(buf) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        CRC_TABLE[i] = c >>> 0;
      }
    }
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  async function deflate(raw) {
    if (typeof CompressionStream !== "function") return null;
    const s = new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }

  async function makeZip(entries) {
    const parts = [];
    const central = [];
    let offset = 0;
    for (const e of entries) {
      const raw = enc.encode(e.text);
      const crc = crc32(raw);
      let data = await deflate(raw);
      let method = 8;
      // 압축이 안 되는 환경이거나 오히려 커지면 그냥 담는다.
      if (!data || data.length >= raw.length) {
        data = raw;
        method = 0;
      }
      const name = enc.encode(e.name);
      const local = new Uint8Array(30 + name.length);
      const dv = new DataView(local.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(8, method, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, data.length, true);
      dv.setUint32(22, raw.length, true);
      dv.setUint16(26, name.length, true);
      local.set(name, 30);
      parts.push(local, data);

      const cen = new Uint8Array(46 + name.length);
      const cdv = new DataView(cen.buffer);
      cdv.setUint32(0, 0x02014b50, true);
      cdv.setUint16(4, 20, true);
      cdv.setUint16(6, 20, true);
      cdv.setUint16(10, method, true);
      cdv.setUint32(16, crc, true);
      cdv.setUint32(20, data.length, true);
      cdv.setUint32(24, raw.length, true);
      cdv.setUint16(28, name.length, true);
      cdv.setUint32(42, offset, true);
      cen.set(name, 46);
      central.push(cen);
      offset += local.length + data.length;
    }
    const cenSize = central.reduce((n, c) => n + c.length, 0);
    const eocd = new Uint8Array(22);
    const edv = new DataView(eocd.buffer);
    edv.setUint32(0, 0x06054b50, true);
    edv.setUint16(8, entries.length, true);
    edv.setUint16(10, entries.length, true);
    edv.setUint32(12, cenSize, true);
    edv.setUint32(16, offset, true);
    const all = [...parts, ...central, eocd];
    const total = all.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let p = 0;
    for (const chunk of all) {
      out.set(chunk, p);
      p += chunk.length;
    }
    return out;
  }

  /**
   * 시트 여럿을 한 통으로.
   * @param sheets [{name, rows: (string|number)[][]}]
   * @returns {Promise<Uint8Array>}
   */
  async function writeXlsx(sheets) {
    if (!sheets || !sheets.length) throw new Error("시트가 없습니다");
    const files = [];
    const sheetTags = [];
    const relTags = [];
    const overrides = [];
    sheets.forEach((s, i) => {
      const n = i + 1;
      files.push({ name: `xl/worksheets/sheet${n}.xml`, text: sheetXml(s.rows || []) });
      // 시트 이름에 못 쓰는 글자(: \ / ? * [ ])는 엑셀이 파일을 거부한다.
      const safe = String(s.name || `Sheet${n}`).replace(/[:\\/?*[\]]/g, " ").slice(0, 31);
      sheetTags.push(`<sheet name="${esc(safe)}" sheetId="${n}" r:id="rId${n}"/>`);
      relTags.push(
        `<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/>`
      );
      overrides.push(
        `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
      );
    });

    files.unshift({
      name: "xl/_rels/workbook.xml.rels",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relTags.join("")}</Relationships>`,
    });
    files.unshift({
      name: "xl/workbook.xml",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetTags.join("")}</sheets></workbook>`,
    });
    files.unshift({
      name: "_rels/.rels",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    });
    files.unshift({
      name: "[Content_Types].xml",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides.join("")}</Types>`,
    });

    return makeZip(files);
  }

  window.HG_XLSX_WRITE = { writeXlsx, sheetXml, colName, crc32 };
})();
