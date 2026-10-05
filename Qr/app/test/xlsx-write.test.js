// 엑셀을 브라우저 안에서 만드는 것 (public/js/xlsx-write.js).
//
// 2026-10-05 사장님: "사진들을 급여처럼 올리면 인식해서 **엑셀에 기입하고**
// 우리 시스템에도 기입해서."
//
// 시스템에 쌓는 것만으로는 사장님의 엑셀이 멈춘다. 18년을 그 파일로 해
// 오셨고 세무·거래처에 보낼 일도 그 모양이라, 같은 모양으로 다시 받을 수
// 있어야 한다.
//
// ── 재는 법: 왕복
//
// 쓴 것을 **읽는 쪽(xlsx-lite.js)으로 다시 읽어** 같은지 본다. 둘이 짝이라
// 한쪽만 맞아서는 뜻이 없다 — 받은 파일을 사장님이 다시 넣으실 수도 있다.
//
// CRC 는 따로 잰다. 내 읽는 쪽은 CRC 를 안 보지만 **엑셀은 본다** — 틀리면
// 「파일이 손상되었습니다」가 뜨고, 왕복 시험만으로는 그걸 못 잡는다.
global.window = {};
require("../public/js/xlsx-lite");
require("../public/js/xlsx-write");
const { readXlsx } = global.window.HG_XLSX;
const { writeXlsx, crc32, colName } = global.window.HG_XLSX_WRITE;

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

(async () => {
  out.push("[CRC — 엑셀이 실제로 검사하는 값]");
  {
    // 표준 확인값. crc32("123456789") = 0xCBF43926.
    const v = crc32(new TextEncoder().encode("123456789"));
    check("★★ CRC-32 가 표준 확인값과 맞는다", v === 0xcbf43926, `0x${v.toString(16)}`);
  }

  out.push("\n[칸 번호]");
  check("0 → A", colName(0) === "A", colName(0));
  check("25 → Z", colName(25) === "Z", colName(25));
  check("★ 26 → AA (여기서 자주 틀린다)", colName(26) === "AA", colName(26));
  check("27 → AB", colName(27) === "AB", colName(27));

  out.push("\n[왕복 — 쓴 것을 다시 읽는다]");
  const sheets = [
    {
      name: "韓國館總店",
      rows: [
        ["날짜", "내용", "수량", "단위", "단가", "금액", "업체명", "비고"],
        ["2025-01-01", "紅蘿蔔", 3, "斤", 25, 75, "房信菓菜行", "당근"],
        // 소수·0·빈칸·특수문자가 섞인 줄
        ["2025-01-01", "小靑椒", 0.5, "斤", 90, 45, "房信菓菜行", ""],
        ["2026-09-01", "復活擦手紙巾 21*20", 1, "箱", 330, 330, "思皓企業社", "손휴지 & 비누"],
      ],
    },
    { name: "韓國館台元三店", rows: [["날짜", "내용"], ["2019-12-04", "蔥"]] },
  ];

  const bytes = await writeXlsx(sheets);
  check("뭔가 만들어진다", bytes && bytes.length > 500, `${bytes && bytes.length}`);
  check("zip 으로 시작한다 (PK)", bytes[0] === 0x50 && bytes[1] === 0x4b, "");

  const back = await readXlsx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  check("시트 두 장", back.sheets.length === 2, `${back.sheets.length}`);
  check("★ 시트 이름이 그대로", back.sheets[0].name === "韓國館總店" && back.sheets[1].name === "韓國館台元三店", JSON.stringify(back.sheets.map((s) => s.name)));

  const got = back.sheets[0].rows;
  check("줄 수가 같다", got.length === 4, `${got.length}`);
  check("★ 머리글이 그대로", got[0].join("|") === "날짜|내용|수량|단위|단가|금액|업체명|비고", got[0].join("|"));
  check("★ 중국어 품목이 그대로", got[1][1] === "紅蘿蔔", got[1][1]);
  check("★ 한국어 비고가 그대로", got[1][7] === "당근", got[1][7]);
  check("★ 숫자가 숫자로 간다", got[1][2] === "3" && got[1][5] === "75", `${got[1][2]} ${got[1][5]}`);
  check("★ 소수도 그대로", got[2][2] === "0.5", got[2][2]);
  check("★★ 규격의 별표가 안 깨진다 (21*20)", got[3][1] === "復活擦手紙巾 21*20", got[3][1]);
  check("★★ & 가 안 깨진다", got[3][7] === "손휴지 & 비누", got[3][7]);
  check("빈칸은 빈칸으로", !got[2][7], JSON.stringify(got[2][7]));
  check("둘째 시트도 읽힌다", back.sheets[1].rows[1][1] === "蔥", JSON.stringify(back.sheets[1].rows));

  out.push("\n[엑셀이 거부하는 시트 이름]");
  {
    const w = await writeXlsx([{ name: "2025/2026 집계 [본점]", rows: [["가"]] }]);
    const r = await readXlsx(w.buffer.slice(w.byteOffset, w.byteOffset + w.byteLength));
    const n = r.sheets[0].name;
    check("★ / 와 [ ] 를 걸러낸다 — 안 그러면 엑셀이 파일을 안 연다", !/[:\\/?*[\]]/.test(n), n);
    const long = await writeXlsx([{ name: "가".repeat(60), rows: [["나"]] }]);
    const rl = await readXlsx(long.buffer.slice(long.byteOffset, long.byteOffset + long.byteLength));
    check("★ 31자까지만 (엑셀 한도)", rl.sheets[0].name.length <= 31, `${rl.sheets[0].name.length}`);
  }

  out.push("\n[빈 것]");
  {
    let msg = "";
    try {
      await writeXlsx([]);
    } catch (e) {
      msg = String(e && e.message);
    }
    check("시트가 없으면 말해준다", /시트/.test(msg), msg);
    const empty = await writeXlsx([{ name: "빈것", rows: [] }]);
    const r = await readXlsx(empty.buffer.slice(empty.byteOffset, empty.byteOffset + empty.byteLength));
    check("줄이 없어도 파일은 만들어진다", r.sheets.length === 1, "");
  }

  out.push("\n[화면에 붙어 있는가]");
  {
    const fs = require("fs");
    const path = require("path");
    const html = fs.readFileSync(path.join(__dirname, "..", "public/admin.html"), "utf8");
    const client = fs.readFileSync(path.join(__dirname, "..", "public/js/ingredients.js"), "utf8");
    const admin = fs.readFileSync(path.join(__dirname, "..", "public/js/admin.js"), "utf8");
    check("받기 단추가 있다", /id="ingExportBtn"/.test(html), "");
    check("★ 만드는 쪽이 실려 있다", /src="\/js\/xlsx-write\.js"/.test(html), "");
    check("단추가 연결돼 있다", /#ingExportBtn"\)\.onclick = \(\) => exportXlsx\(\)/.test(client), "");
    check(
      "★★ 칸 차례가 사장님 파일 그대로다 — 받아서 열었을 때 쓰던 것과 같아야 한다",
      /EXPORT_HEAD = \["날짜", "내  용", "수량", "단위", "단가", "금액", "업체명", "비  고", "월"\]/.test(client),
      ""
    );
    check(
      "★ 날짜는 글자로 적는다 — 일련번호로 적으면 서식 없이 「45658」로 보인다",
      /r\.date, r\.name/.test(client),
      ""
    );
    for (const k of ["ingExportBtn", "ingExportWorking", "ingExportDoneFmt", "ingExportEmpty", "ingExportFailed", "ingExportNoSupport"]) {
      check(`${k} 가 두 언어에 다 있다`, admin.split(`${k}:`).length - 1 === 2, `${admin.split(`${k}:`).length - 1}군데`);
    }
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log(out.join("\n"));
  console.error(e);
  process.exit(1);
});
