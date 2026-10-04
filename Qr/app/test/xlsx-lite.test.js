// 브라우저 안에서 엑셀을 읽는 것 (public/js/xlsx-lite.js).
//
// 2026-10-04: 식자재 기록 엑셀(2만 줄)을 가져오려고 만들었다. 출근 카드 사진과
// 같은 이유로 **기기 안에서** 읽는다 — 사장님 장부가 통째로 밖으로 나갈 일이
// 없고, 서버에 엑셀 라이브러리를 들일 일도 없다.
//
// ── 붙임 파일 없이 재는 법
//
// 시험 안에서 **작은 xlsx 를 직접 만들어** 되읽는다. 바이너리를 저장소에 두면
// 그 안이 무엇인지 아무도 모르게 되고, 고칠 수도 없다. 여기서는 어떤 칸을
// 넣었는지가 코드에 그대로 보인다.
//
// 압축 안 한 칸(method 0)과 압축한 칸(method 8)을 둘 다 넣는다 — 진짜 엑셀은
// 둘을 섞어 쓴다.
global.window = {};
require("../public/js/xlsx-lite");
const { readXlsx } = global.window.HG_XLSX;

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const enc = new TextEncoder();

/** zip 한 통을 만든다. entries: [{name, text, deflate}] */
async function makeZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const raw = enc.encode(e.text);
    let data = raw;
    let method = 0;
    if (e.deflate) {
      const s = new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate-raw"));
      data = new Uint8Array(await new Response(s).arrayBuffer());
      method = 8;
    }
    const name = enc.encode(e.name);
    const local = new Uint8Array(30 + name.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(8, method, true);
    // CRC 는 0 으로 둔다 — 읽는 쪽이 보지 않는다(압축 풀기에 필요한 값이 아니다).
    dv.setUint32(18, data.length, true);
    dv.setUint32(22, raw.length, true);
    dv.setUint16(26, name.length, true);
    local.set(name, 30);
    parts.push(local, data);

    const cen = new Uint8Array(46 + name.length);
    const cdv = new DataView(cen.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(10, method, true);
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
  const buf = new Uint8Array(total);
  let p = 0;
  for (const chunk of all) {
    buf.set(chunk, p);
    p += chunk.length;
  }
  return buf.buffer;
}

// 시트 번호와 순서를 **일부러 어긋나게** 둔다. 첫 시트가 sheet2.xml 이다 —
// 진짜 엑셀에서도 그런 일이 있고, rels 를 안 보고 번호로 짐작하면 두 지점의
// 자료가 통째로 뒤바뀐다.
const WORKBOOK = `<?xml version="1.0"?><workbook xmlns:r="x"><sheets>
  <sheet name="韓國館總店" sheetId="1" r:id="rId7"/>
  <sheet name="韓國館台元三店" sheetId="2" r:id="rId3"/>
</sheets></workbook>`;
const RELS = `<?xml version="1.0"?><Relationships>
  <Relationship Id="rId7" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Target="/xl/worksheets/sheet1.xml"/>
</Relationships>`;
const SHARED = `<?xml version="1.0"?><sst count="3"><si><t>紅蘿蔔</t></si><si><t>房信菓菜行</t></si><si><r><t>당</t></r><r><t>근</t></r></si></sst>`;
// A=날짜 B=이름(공유) ... D 를 건너뛰고 E 에 값을 둔다. 빈 칸은 아예 안 온다.
const SHEET_MAIN = `<?xml version="1.0"?><worksheet><sheetData>
  <row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c><c r="E1"><v>75</v></c></row>
  <row r="2"><c r="A2"><v>45658</v></c><c r="B2" t="inlineStr"><is><t>蔥 &amp; 파</t></is></c></row>
</sheetData></worksheet>`;
const SHEET_BRANCH = `<?xml version="1.0"?><worksheet><sheetData>
  <row r="1"><c r="A1" t="s"><v>2</v></c></row>
</sheetData></worksheet>`;

(async () => {
  const buf = await makeZip([
    { name: "xl/workbook.xml", text: WORKBOOK, deflate: true },
    { name: "xl/_rels/workbook.xml.rels", text: RELS },
    { name: "xl/sharedStrings.xml", text: SHARED, deflate: true },
    { name: "xl/worksheets/sheet1.xml", text: SHEET_BRANCH },
    { name: "xl/worksheets/sheet2.xml", text: SHEET_MAIN, deflate: true },
  ]);

  const { sheets } = await readXlsx(buf);
  out.push("[시트]");
  check("두 장을 읽는다", sheets.length === 2, `${sheets.length}`);
  check("이름이 맞다", sheets[0].name === "韓國館總店" && sheets[1].name === "韓國館台元三店", JSON.stringify(sheets.map((s) => s.name)));
  check(
    "★★ 번호가 아니라 rels 로 짝짓는다 — 짐작하면 두 지점이 통째로 뒤바뀐다",
    sheets[0].rows.length === 2 && sheets[1].rows.length === 1,
    JSON.stringify(sheets.map((s) => s.rows.length))
  );

  const main = sheets[0].rows;
  out.push("\n[칸 읽기]");
  check("★ 공유 글자를 풀어 넣는다", main[0][0] === "紅蘿蔔", JSON.stringify(main[0]));
  check("★★ 빈 칸은 건너뛰고 오므로 자리를 맞춰야 한다 (C 는 2번)", main[0][2] === "房信菓菜行", JSON.stringify(main[0]));
  check("★ 건너뛴 자리는 비어 있다", main[0][1] === undefined, JSON.stringify(main[0]));
  check("E 는 4번", main[0][4] === "75", JSON.stringify(main[0]));
  check("숫자는 글자로 온다", main[1][0] === "45658", main[1][0]);
  check("★ 칸 안에 바로 든 글자도 읽는다", main[1][1] === "蔥 & 파", main[1][1]);
  check("★ &amp; 를 풀어준다", main[1][1].includes("&") && !main[1][1].includes("amp"), main[1][1]);
  check("★ 쪼개 적힌 글자를 이어 붙인다", sheets[1].rows[0][0] === "당근", sheets[1].rows[0][0]);

  out.push("\n[압축]");
  check("★ 압축한 칸과 안 한 칸을 둘 다 읽는다", main[0][0] === "紅蘿蔔" && sheets[1].rows[0][0] === "당근", "");

  out.push("\n[엑셀이 아닌 것]");
  for (const [label, bad] of [
    ["빈 파일", new Uint8Array(0).buffer],
    ["그냥 글자", enc.encode("이건 엑셀이 아니에요").buffer],
  ]) {
    let msg = "";
    try {
      await readXlsx(bad);
    } catch (e) {
      msg = String(e && e.message);
    }
    check(`★ ${label} — 사람이 읽을 수 있는 말로 거절한다`, /엑셀|zip/.test(msg), msg);
  }
  {
    // zip 이긴 한데 엑셀이 아닌 경우
    const z = await makeZip([{ name: "hello.txt", text: "hi" }]);
    let msg = "";
    try {
      await readXlsx(z);
    } catch (e) {
      msg = String(e && e.message);
    }
    check("★ zip 이지만 엑셀이 아니면 그렇다고 말한다", /workbook/.test(msg), msg);
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log(out.join("\n"));
  console.error(e);
  process.exit(1);
});
