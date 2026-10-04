// 엑셀(.xlsx)을 브라우저 안에서 읽는다. 라이브러리 없이.
//
// 2026-10-04: 식자재 기록 엑셀(2만 줄)을 가져오려고 만들었다. 출근 카드
// 사진을 기기 안에서 읽는 것(timecard-ocr.js)과 같은 이유다 — 사장님 장부가
// 통째로 밖으로 나갈 일이 없고, 서버에 엑셀 라이브러리를 들일 일도 없다.
//
// ── xlsx 는 zip 이고 그 안은 XML 이다
//
//   xl/workbook.xml            시트 이름과 r:id
//   xl/_rels/workbook.xml.rels r:id → 실제 파일 이름
//   xl/sharedStrings.xml       글자는 전부 여기 모여 있고 칸은 번호만 든다
//   xl/worksheets/sheetN.xml   칸 값
//
// 압축을 푸는 것은 브라우저의 DecompressionStream("deflate-raw") 가 한다.
// 직접 inflate 를 쓰지 않는다 — 그건 이 파일이 할 일이 아니다.
(function () {
  "use strict";

  const dec = new TextDecoder("utf-8");

  function u16(dv, p) {
    return dv.getUint16(p, true);
  }
  function u32(dv, p) {
    return dv.getUint32(p, true);
  }

  /**
   * zip 의 중앙 목록을 읽어 { 이름 → {offset, method, size} } 로.
   *
   * 끝에서부터 EOCD(0x06054b50)를 찾는다. 주석이 붙어 있을 수 있어서 바로
   * 끝은 아니지만, 주석은 64KB 를 못 넘으므로 그만큼만 거슬러 본다.
   */
  function readDirectory(buf) {
    const dv = new DataView(buf);
    let eocd = -1;
    const from = Math.max(0, buf.byteLength - 66000);
    for (let p = buf.byteLength - 22; p >= from; p--) {
      if (u32(dv, p) === 0x06054b50) {
        eocd = p;
        break;
      }
    }
    if (eocd < 0) throw new Error("엑셀 파일이 아닙니다 (zip 끝을 못 찾았습니다)");
    const count = u16(dv, eocd + 10);
    let p = u32(dv, eocd + 16);
    if (p === 0xffffffff || count === 0xffff) throw new Error("너무 큰 엑셀입니다 (zip64)");
    const out = new Map();
    for (let i = 0; i < count; i++) {
      if (u32(dv, p) !== 0x02014b50) break;
      const method = u16(dv, p + 10);
      const compSize = u32(dv, p + 20);
      const nameLen = u16(dv, p + 28);
      const extraLen = u16(dv, p + 30);
      const commentLen = u16(dv, p + 32);
      const localOff = u32(dv, p + 42);
      const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
      out.set(name, { localOff, method, compSize });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  /** 한 칸의 압축을 풀어 글자로. 없으면 "". */
  async function readEntry(buf, dir, name) {
    const e = dir.get(name);
    if (!e) return "";
    const dv = new DataView(buf);
    let p = e.localOff;
    if (u32(dv, p) !== 0x04034b50) throw new Error(`zip 이 깨졌습니다 (${name})`);
    const nameLen = u16(dv, p + 26);
    const extraLen = u16(dv, p + 28);
    p += 30 + nameLen + extraLen;
    const data = new Uint8Array(buf, p, e.compSize);
    if (e.method === 0) return dec.decode(data);
    if (e.method !== 8) throw new Error(`모르는 압축 방식입니다 (${e.method})`);
    if (typeof DecompressionStream !== "function") {
      throw new Error("이 브라우저로는 엑셀을 못 엽니다. 크롬·엣지·사파리 최신판으로 열어주세요.");
    }
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return dec.decode(await new Response(stream).arrayBuffer());
  }

  /** "A" → 0, "AB" → 27. 칸이 비어 있으면 그 자리는 건너뛰어 오므로 필요하다. */
  function colOf(ref) {
    const m = /^([A-Z]+)/.exec(ref || "");
    if (!m) return 0;
    let n = 0;
    for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  const unescapeXml = (s) =>
    String(s)
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
      .replace(/&amp;/g, "&");

  /** sharedStrings — <si> 하나가 글자 하나. 안에 <t> 가 여럿일 수 있다(서식). */
  function parseShared(xml) {
    const out = [];
    if (!xml) return out;
    for (const si of xml.split("<si>").slice(1)) {
      const body = si.split("</si>")[0];
      let s = "";
      for (const m of body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) s += m[1];
      out.push(unescapeXml(s));
    }
    return out;
  }

  /** 시트 하나 → 줄 배열(각 줄은 글자 배열). */
  function parseSheet(xml, shared) {
    const rows = [];
    for (const chunk of String(xml).split("<row").slice(1)) {
      const body = chunk.split("</row>")[0];
      const cells = [];
      for (const c of body.split("<c ").slice(1)) {
        const ref = (/r="([A-Z]+\d+)"/.exec(c) || [])[1] || "";
        const type = (/t="([^"]+)"/.exec(c) || [])[1] || "";
        const v = (/<v>([\s\S]*?)<\/v>/.exec(c) || [])[1];
        const inline = (/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(c) || [])[1];
        let val = "";
        if (type === "s" && v != null) val = shared[parseInt(v, 10)] || "";
        else if (inline != null) val = unescapeXml(inline);
        else if (v != null) val = unescapeXml(v);
        cells[colOf(ref)] = String(val);
      }
      rows.push(cells);
    }
    return rows;
  }

  /**
   * 엑셀 한 통을 읽는다.
   * @returns {Promise<{sheets: {name: string, rows: string[][]}[]}>}
   */
  async function readXlsx(arrayBuffer) {
    const dir = readDirectory(arrayBuffer);
    const shared = parseShared(await readEntry(arrayBuffer, dir, "xl/sharedStrings.xml"));
    const workbook = await readEntry(arrayBuffer, dir, "xl/workbook.xml");
    if (!workbook) throw new Error("엑셀 파일이 아닙니다 (workbook 이 없습니다)");
    const relsXml = await readEntry(arrayBuffer, dir, "xl/_rels/workbook.xml.rels");
    // r:id → 파일 이름. 시트 순서와 파일 번호가 늘 같지는 않다.
    const rels = new Map();
    for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
      const tag = m[0];
      const id = (/Id="([^"]+)"/.exec(tag) || [])[1];
      let target = (/Target="([^"]+)"/.exec(tag) || [])[1];
      if (!id || !target) continue;
      target = target.replace(/^\/?xl\//, "").replace(/^\.\//, "");
      rels.set(id, `xl/${target}`);
    }
    const sheets = [];
    for (const m of workbook.matchAll(/<sheet\b[^>]*\/>/g)) {
      const tag = m[0];
      const name = unescapeXml((/name="([^"]*)"/.exec(tag) || [])[1] || "");
      const rid = (/r:id="([^"]+)"/.exec(tag) || [])[1];
      const file = rels.get(rid);
      if (!file) continue;
      sheets.push({ name, rows: parseSheet(await readEntry(arrayBuffer, dir, file), shared) });
    }
    if (!sheets.length) throw new Error("시트를 하나도 못 읽었습니다");
    return { sheets };
  }

  window.HG_XLSX = { readXlsx, parseShared, parseSheet, colOf };
})();
