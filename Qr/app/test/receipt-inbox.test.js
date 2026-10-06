// 영수증 대기함 — 붙여넣은 결과를 어떻게 받아들이나(src/receiptInbox.js).
//
// 2026-10-06 사장님: "아빠가 일단 사진을 올려주면 그걸 내가 다운받아서 여기다가
// 칠거야 그럼 너가 급여처럼 인식해서 확실하거나 확실하지 않는 걸로 나눠서 옆에
// 사진 보여주면서 맞는지 아빠가 오케이 하고 저장하게 하는거지."
//
// 재는 것은 **지어내지 않는가**다. 붙여넣은 글은 사람 손을 거쳐 오므로 깨져
// 있을 수 있고, 셈이 안 맞는 줄은 조용히 넣으면 안 된다.
const assert = require("assert");
const I = require("../src/receiptInbox");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); n++; };

const VENDORS = ["房信菓菜行", "泳慶蛋行", "思皓企業社", "阿麵製麵"];
const R = (rows, extra) => Object.assign({ vendor: "房信菓菜行", date: "2026-10-05", store: "main", rows }, extra || {});

// ── 붙여넣은 글에서 JSON 을 꺼낸다
{
  const body = JSON.stringify(R([{ name: "紅蘿蔔", qty: 5, price: 22, amount: 110 }]));
  ok(I.parsePasted(body).ok, "그냥 JSON");
  ok(I.parsePasted("여기 있습니다:\n```json\n" + body + "\n```\n확인해 보세요").ok, "울타리와 설명이 붙어 있어도");
  ok(I.parsePasted("앞말 " + body + " 뒷말").ok, "앞뒤에 말이 붙어도");
  ok(I.parsePasted("[" + body + "]").ok, "배열로 와도");
  ok(I.parsePasted(JSON.stringify({ receipts: [R([{ name: "甲", qty: 1, price: 1, amount: 1 }])] })).ok, "{receipts:[...]} 로 와도");
  eq(I.parsePasted("[" + body + "," + body + "]").more, 1, "여러 장이면 몇 장 더 있는지 말한다");

  eq(I.parsePasted("").error, "empty", "빈 글");
  eq(I.parsePasted("안녕하세요").error, "bad_json", "JSON 이 아니면");
  eq(I.parsePasted('{"vendor":"房信菓菜行"}').error, "no_rows", "줄이 없으면");
  eq(I.parsePasted('{"rows":').error, "bad_json", "중간에 끊겼으면");
}

// ── 셈이 맞는 줄과 안 맞는 줄
{
  const got = I.normalizeRead(R([
    { name: "紅蘿蔔", name_ko: "당근", qty: 5, unit: "斤", price: 22, amount: 110, sure: true },
    { name: "洋蔥", qty: 3, unit: "斤", price: 18, amount: 90, sure: true },      // 3×18=54 ≠ 90
    { name: "白菜", qty: 2, unit: "斤", price: 35, amount: 70, sure: false },     // 셈은 맞지만 못 읽겠다고 함
  ]), { vendors: VENDORS });
  eq(got.rows.length, 3, "세 줄");
  ok(got.rows[0].sure, "셈이 맞고 확실하다고 한 줄은 흰 줄");
  eq(got.rows[0].name_ko, "당근", "한국어 이름도 받는다 — 장부의 「비  고」 칸이다");
  ok(!got.rows[1].sure, "★★ 수량 × 단가 ≠ 금액 이면 확실치 않음");
  ok(got.rows[1].warn.includes("math"), "★ 왜 그런지 적는다");
  ok(!got.rows[2].sure, "★ 읽은 쪽이 아니라고 하면 그대로 아니다");
  eq(got.unsure, 2, "★★ 확실치 않은 줄이 몇인지 센다");
  // **고치지 않는다.** 금액을 수량×단가로 덮으면 종이와 장부가 달라진다.
  eq(got.rows[1].amount, 90, "★★ 종이에 적힌 금액을 고쳐 쓰지 않는다");
}

// ── 머리(업체·날짜·지점)
{
  const got = I.normalizeRead(R([{ name: "甲", qty: 1, price: 10, amount: 10 }], { vendor: "房信菓菜行" }), { vendors: VENDORS });
  eq(got.head.vendor, "房信菓菜行", "업체");
  eq(got.head.date, "2026-10-05", "날짜");
  eq(got.head.store, "main", "지점 — main 으로 주면 그대로");

  const paper = I.normalizeRead(
    { vendor: "思皓興業有限公司", date: "113年5月29日", store: "韓食館 台元", rows: [{ name: "甲", qty: 1, price: 10, amount: 10 }] },
    { vendors: VENDORS }
  );
  eq(paper.head.vendor, "思皓企業社", "★★ 종이에 찍힌 상호를 장부 이름으로");
  eq(paper.head.date, "2024-05-29", "★★ 민국 연도를 서기로");
  eq(paper.head.store, "branch3", "★★ 「台元」이면 2호점");

  // 장부에 없는 업체는 **종이에 적힌 이름 그대로** 쓰고 「새 업체」라고 표시한다.
  //
  // 사진에서 저절로 채울 때(receiptHeader.matchVendor)는 비워 두는 것이 맞다 —
  // 남의 업체로 적히면 눈으로는 못 찾는다. 하지만 여기는 사장님이 표를 보고
  // 저장을 누르시는 자리라, 비워 두면 **새 업체의 첫 영수증을 아예 못 넣는다.**
  const none = I.normalizeRead({ vendor: "없는가게", date: "", store: "", rows: [] }, { vendors: VENDORS });
  eq(none.head.vendor, "없는가게", "★★ 장부에 없는 업체는 종이 이름 그대로");
  eq(none.head.vendor_new, true, "★★ 「장부에 없는 업체」라고 표시한다");
  eq(none.head.vendor_sure, false, "★ 확실하다고 하지 않는다");
}

// ── 인쇄된 合計와 맞춰 본다
{
  const good = I.normalizeRead(R([
    { name: "甲", qty: 1, price: 100, amount: 100 },
    { name: "乙", qty: 2, price: 50, amount: 100 },
  ], { total: 200 }), { vendors: VENDORS });
  eq(good.totalOk, true, "★ 더한 값이 종이의 合計와 같다");
  const bad = I.normalizeRead(R([{ name: "甲", qty: 1, price: 100, amount: 100 }], { total: 500 }), { vendors: VENDORS });
  eq(bad.totalOk, false, "★★ 合計가 안 맞으면 그렇다고 — 빠뜨린 줄이 있다는 뜻이다");
}

// ── 사진
{
  const tiny = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
  ok(I.decodeImage(tiny).buffer, "사진을 바이트로");
  eq(I.decodeImage("그냥 글").error, "bad_image", "사진이 아니면 안 받는다");
  eq(I.decodeImage(tiny, 4).error, "too_big", "★ 너무 크면 안 받는다");
}

// ── 목록에는 **사진을 안 보낸다**
{
  const item = I.listItem({
    _id: "abc", name: "a.jpg", at: "2026-10-06T01:00:00.000Z", status: I.STATUS.READ,
    image: Buffer.from([1, 2, 3]), thumb: "data:image/jpeg;base64,xx", bytes: 1234,
    read: { head: { vendor: "房信菓菜行" }, rows: [1, 2, 3], unsure: 1 },
  });
  eq(item.image, undefined, "★★ 목록에 사진 자체는 안 담는다 — 스무 장이면 8MB 다");
  ok(item.thumb, "작은 미리보기는 담는다");
  eq(item.read.rows, 3, "몇 줄 읽었는지");
  eq(item.read.unsure, 1, "그 중 몇 줄이 확실치 않은지");
  eq(item.has_image, true, "사진이 아직 있는지");
}

console.log(`receipt-inbox: ${n}개 통과`);
