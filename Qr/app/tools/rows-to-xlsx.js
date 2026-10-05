// 읽은 영수증 줄들을 **사장님 엑셀 양식 그대로** 파일로 만든다.
//
// 2026-10-05 사장님: "api 를 사용하려면 프롬프트를 적어야 하는거고 내가 매번
// 여기에 넣는거면 그냥 여기에 계속 넣어주면 되는거지?"
//
// 그렇다. API 키 없이, 돈 안 들이고 쓰는 길이 이것이다:
//
//   1. 사장님이 영수증 사진을 세션에 넣으신다
//   2. Claude 가 읽어서 아래 모양의 JSON 을 적는다
//   3. 이 도구가 **가져오기가 그대로 먹는 .xlsx** 를 만든다
//   4. 식자재 탭 「⬆️ 엑셀 가져오기」로 넣으신다
//
// 읽는 품질은 POS 에서 API 로 부르는 것과 **똑같다**(같은 모델이 같은 사진을
// 본다). 다른 것은 누가 단추를 누르느냐와 돈이 드느냐뿐이다.
//
// 넣는 JSON:
//
//   [{ "store": "main" | "branch3",
//      "date": "2026-10-05",
//      "vendor": "房信菓菜行",
//      "rows": [{ "name": "紅蘿蔔", "qty": 5, "unit": "斤",
//                 "price": 22, "amount": 110, "name_ko": "당근" }] }]
//
// 쓰는 법:
//   node tools/rows-to-xlsx.js 읽은것.json 내보낼것.xlsx
const fs = require("fs");
const path = require("path");

// 화면과 **같은 머리글**을 쓴다. 한 글자라도 다르면 가져오기가 칸을 못 찾는다
// (public/js/ingredients.js 의 EXPORT_HEAD, 「내  용」의 가운데 공백 둘까지).
const HEAD = ["날짜", "내  용", "수량", "단위", "단가", "금액", "업체명", "비  고", "월"];

// 시트 이름 → 지점. src/ingredients.js 의 storeOfSheetName 과 맞춰 둔다.
const SHEET = { main: "韓國館總店", branch3: "韓國館台元三店" };

function toSheets(receipts) {
  const by = { main: [], branch3: [] };
  for (const r of receipts || []) {
    const store = r.store === "branch3" ? "branch3" : "main";
    const date = String(r.date || "").slice(0, 10);
    const vendor = String(r.vendor || "").normalize("NFC").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`날짜가 이상합니다: ${r.date}`);
    if (!vendor) throw new Error(`업체가 비어 있습니다 (${date})`);
    for (const line of r.rows || []) {
      const name = String(line.name || "").normalize("NFC").trim();
      if (!name) continue;
      by[store].push([
        date, name,
        line.qty === "" || line.qty == null ? "" : Number(line.qty),
        String(line.unit || ""),
        line.price === "" || line.price == null ? "" : Number(line.price),
        line.amount === "" || line.amount == null ? "" : Number(line.amount),
        vendor,
        String(line.name_ko || line.note || ""),
        Number(date.slice(5, 7)),
      ]);
    }
  }
  const sheets = [];
  for (const key of ["main", "branch3"]) {
    if (!by[key].length) continue;
    // 날짜 → 업체 차례로 정렬한다. 사장님 장부가 그 차례다.
    by[key].sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[6]).localeCompare(String(b[6])));
    sheets.push({ name: SHEET[key], rows: [HEAD].concat(by[key]) });
  }
  return sheets;
}

async function build(receipts) {
  // 화면이 쓰는 그 코드를 그대로 쓴다 — 두 벌이 되면 언젠가 어긋난다.
  global.window = global.window || {};
  require(path.join(__dirname, "..", "public", "js", "xlsx-write.js"));
  const { writeXlsx } = global.window.HG_XLSX_WRITE;
  const sheets = toSheets(receipts);
  if (!sheets.length) throw new Error("넣을 줄이 없습니다");
  const bytes = await writeXlsx(sheets);
  return { bytes: Buffer.from(bytes), sheets };
}

if (require.main === module) {
  (async () => {
    const [inFile, outFile] = process.argv.slice(2);
    if (!inFile) {
      console.log("쓰는 법: node tools/rows-to-xlsx.js 읽은것.json [내보낼것.xlsx]");
      process.exit(1);
    }
    const receipts = JSON.parse(fs.readFileSync(inFile, "utf8"));
    const { bytes, sheets } = await build(Array.isArray(receipts) ? receipts : [receipts]);
    const out = outFile || inFile.replace(/\.json$/i, "") + ".xlsx";
    fs.writeFileSync(out, bytes);
    const n = sheets.reduce((a, s) => a + s.rows.length - 1, 0);
    console.log(`${out} — ${sheets.map((s) => `${s.name} ${s.rows.length - 1}줄`).join(" · ")} (모두 ${n}줄)`);
    console.log("식자재 탭 「⬆️ 엑셀 가져오기」로 넣으시면 됩니다.");
  })().catch((e) => { console.error("실패:", e.message); process.exit(1); });
}

module.exports = { build, toSheets, HEAD, SHEET };
