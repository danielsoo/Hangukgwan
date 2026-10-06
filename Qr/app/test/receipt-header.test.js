// 영수증 머리 — 업체·날짜·지점을 파일 이름 없이 가린다.
//
// 재료는 **2026-10-05 눈가림 시험에 쓴 실제 영수증 12장**이다. 사진은
// 사장님 장부라 저장소에 넣지 않으므로, 사진에서 읽힌 글자와 장부의 답만
// 여기 적는다. 그 12장이 이 파일의 시험이다.
const assert = require("assert");
const H = require("../src/receiptHeader");

// 사장님 장부에 있는 업체들(2026-10-05 기준 19곳).
const VENDORS = [
  "大川食品行", "豆腐", "萬濱企業", "萬通水産食品行", "房信菓菜行", "思皓企業社",
  "瑞騰國際", "新竹錦海産批發商", "阿麵製麵", "阿寶水産", "億豊行", "泳慶蛋行",
  "旺旺來商行", "龍江興南北商行", "源香企業有限公司", "千宇開發", "台裕行",
  "韓濟", "丸邱菓菜行",
];

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); n++; };

// ── 종이에 찍힌 상호 → 장부의 이름
// 12장 중 셋이 이것 때문에 「틀린」 것으로 나왔다. 읽기가 틀린 게 아니다.
const SAME = [
  ["思皓興業有限公司", "思皓企業社"],       // 05·09번 전표
  ["阿麵製麵廠", "阿麵製麵"],               // 11번
  ["旺旺來", "旺旺來商行"],                 // 03·07번 — 전표 머리가 짧게 찍힌다
  ["龍江興南北商行", "龍江興南北商行"],
  ["房信菓菜行", "房信菓菜行"],
  ["丸邱菓菜行", "丸邱菓菜行"],
  ["泳慶蛋行", "泳慶蛋行"],
  ["千宇開發", "千宇開發"],
  ["大川食品行", "大川食品行"],
];
for (const [paper, want] of SAME) {
  const got = H.matchVendor(paper, VENDORS);
  ok(got, `${paper} — 못 가렸다`);
  eq(got.vendor, want, `${paper} → ${want}`);
}

// 글자 하나를 잘못 읽어도 목록에 맞춰 바로잡는다(06번: 氵萬 을 溝 로 봤다).
eq(H.matchVendor("溝通水産食品行", VENDORS).vendor, "萬通水産食品行", "글자 하나");

// 龍國興業社는 같은 회사다 — src/ingredients.js 의 VENDOR_ALIASES 가 받는다.
eq(H.matchVendor("龍國興業社", VENDORS).vendor, "龍江興南北商行", "같은 회사");

// ── 지어내지 않는다
//
// 「丸邱菓菜行」을 장부에서 빼면 **房信菓菜行으로 가면 안 된다.** 꼬리
// 세 글자가 같아 0.6 이 나오지만 첫 글자가 다르다. 남의 업체 지출로 적히면
// 눈으로는 영영 못 찾는다.
const WITHOUT = VENDORS.filter((v) => v !== "丸邱菓菜行");
eq(H.matchVendor("丸邱菓菜行", WITHOUT), null, "모르는 업체는 비워 둔다");
eq(H.matchVendor("阿寶水産", ["阿麵製麵"]), null, "첫 글자만 같은 것");
eq(H.matchVendor("韓國館", VENDORS), null, "우리 가게는 업체가 아니다");
eq(H.matchVendor("韓食館台元三店", VENDORS), null, "받는 쪽 이름");
eq(H.matchVendor("", VENDORS), null, "빈 글자");

// 2등이 바짝 붙으면 「맞다」고 하지 않는다
const close = H.matchVendor("思皓企業", ["思皓企業社", "思皓企業行"]);
ok(close && close.sure === false, "둘이 비슷하면 확실하지 않다");

// ── 날짜. 전표마다 적는 법이 다르다.
const DATES = [
  ["民國113年10月25日", "2024-10-25"],        // 06번 손글씨
  ["113 年 1 月 11 日", "2024-01-11"],        // 04번
  ["日期:114年04月29日", "2025-04-29"],       // 07번
  ["日期:112年02月07日", "2023-02-07"],       // 03번
  ["單據日期:112/07/27", "2023-07-27"],       // 10번
  ["日期 2023.06.26", "2023-06-26"],          // 02번 — 전산 출력은 서기로 찍는다
  ["111年1月12日", "2022-01-12"],             // 11번
];
for (const [text, want] of DATES) eq(H.parseDate(text), want, text);

// 思皓 전표는 날짜가 둘이다 — **물건이 온 날**을 고른다.
eq(H.parseDate("銷貨日期:24.05.27 ... 列印日期: 24.05.25"), "2024-05-27", "銷貨 먼저");
eq(H.parseDate("列印日期: 25.04.09 銷貨日期:25.04.10"), "2025-04-10", "차례가 바뀌어도");

// 날짜가 아닌 숫자를 날짜로 만들지 않는다
eq(H.parseDate("No.736254"), null, "전표 번호");
eq(H.parseDate("TEL 03-5555996"), null, "전화번호");
eq(H.parseDate("113年13月1日"), null, "없는 달");
eq(H.parseDate("95年5月5日"), null, "너무 오래된 날");

// ── 지점
eq(H.storeFromText("台元三店"), "branch3", "도장");
eq(H.storeFromText("韓國館(台元)-A"), "branch3", "받는 이");
eq(H.storeFromText("竹北市台元科技園區台元街7號"), "branch3", "2호점 주소에 竹北이 들어 있어도");
eq(H.storeFromText("韓國館(縣政週一公休) / 竹北區(CE010)"), "main", "본점");
eq(H.storeFromText("竹北韓國"), "main", "손글씨");
eq(H.storeFromText("韓國館"), null, "모르면 비워 둔다");

// ── 셋을 한 번에
const got = H.readHeader(
  { vendor: "思皓興業有限公司", date: "銷貨日期:24.05.27 列印日期: 24.05.25", store: "韓食館 台元 85358015內" },
  { vendors: VENDORS }
);
eq(got.vendor, "思皓企業社", "머리 — 업체");
eq(got.date, "2024-05-27", "머리 — 날짜");
eq(got.store, "branch3", "머리 — 지점");
eq(got.vendor_text, "思皓興業有限公司", "종이에 찍힌 그대로도 남긴다");

const none = H.readHeader({ vendor: "없는가게", date: "", store: "" }, { vendors: VENDORS });
eq(none.vendor, "", "못 가리면 빈 칸");
eq(none.vendor_sure, false, "확실하지 않다");

console.log(`receipt-header: ${n}개 통과`);
