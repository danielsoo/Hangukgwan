// 주방이 알아야 할 변화는 전부 종이로 나간다 — 그 두 가지 경로.
//
// 사장님(2026-09-10): "테스터 뿐만이 아니라 저렇게 늘 출력이 되어야 해.
// 수기던 고객이 직접 주문을 하던 자리 옮김이던."
//
// 손님 QR·수기 주문·테스터 모드 주문은 이미 한 길로 간다(수기 주문은 손님
// 주문 화면을 그대로 열어 POST /api/orders 로 보낸다). 안 되던 것이 둘이다.
//
//   품목 추가·수정 — 결제 전에 요리를 더 넣으면 금액에는 반영되는데 주방에는
//                    아무것도 안 갔다. 손님은 시켰고 돈도 내는데 음식이 안 나간다.
//   자리 옮김      — 7번 음식을 만들고 있는데 손님이 9번으로 갔다는 것을
//                    주방도 홀도 종이로는 몰랐다.
//
// 이 파일이 재는 것: 「무엇이 바뀌었는가」가 정확한가, 그리고 그 값이 실제로
// 종이까지 가는 길이 코드에 남아 있는가.
const fs = require("fs");
const path = require("path");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const line = (over) =>
  Object.assign(
    { item_id: 1, qty: 1, option_choice: null, spice_choice: null, takeout_choice: null, order_type: "dine_in", note: "", selected_addons: [] },
    over
  );

const { diffOrderLines } = require("../src/routes/orders");

out.push("[1] 무엇이 늘고 무엇이 빠졌는가");
{
  const before = [line({ item_id: 1, qty: 1 }), line({ item_id: 2, qty: 2 })];
  const after = [line({ item_id: 1, qty: 3 }), line({ item_id: 3, qty: 1 })];
  const d = diffOrderLines(before, after);

  const added1 = d.added.find((x) => x.item_id === 1);
  check("수량이 늘면 늘어난 만큼만 추가로 잡는다", added1 && added1.qty === 2, JSON.stringify(d.added));
  check("새로 넣은 품목은 추가로 잡는다", d.added.some((x) => x.item_id === 3 && x.qty === 1), JSON.stringify(d.added));
  check("★ 통째로 빠진 품목은 취소로 잡는다", d.removed.some((x) => x.item_id === 2 && x.qty === 2), JSON.stringify(d.removed));
  check("★ 안 바뀐 것은 어느 쪽에도 안 들어간다", !d.added.some((x) => x.item_id === 2) && !d.removed.some((x) => x.item_id === 1), JSON.stringify(d));
}

out.push("\n[2] 같은 메뉴라도 주방이 다르게 만들면 다른 줄이다");
{
  const before = [line({ item_id: 5, option_choice: "牛", qty: 1 })];
  const after = [line({ item_id: 5, option_choice: "豬", qty: 1 })];
  const d = diffOrderLines(before, after);
  check("고기 선택이 바뀌면 추가 1 · 취소 1", d.added.length === 1 && d.removed.length === 1, JSON.stringify(d));
  check("추가 쪽이 새 선택이다", d.added[0].option_choice === "豬", JSON.stringify(d.added));

  const spicy = diffOrderLines([line({ item_id: 5, spice_choice: "不辣" })], [line({ item_id: 5, spice_choice: "中辣" })]);
  check("맵기도 마찬가지다", spicy.added.length === 1 && spicy.removed.length === 1, JSON.stringify(spicy));

  const same = diffOrderLines([line({ item_id: 5 })], [line({ item_id: 5 })]);
  check("아무것도 안 바뀌면 둘 다 비어 있다", same.added.length === 0 && same.removed.length === 0, JSON.stringify(same));
}

out.push("\n[3] 바뀐 값이 주문에 남는가 (src/routes/orders.js)");
{
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "orders.js"), "utf8");
  check("품목 수정이 items_changed 를 남긴다", /order\.items_changed\s*=/.test(src), "");
  check("바꾸기 전 목록을 먼저 뜬다", /const before = \(order\.items \|\| \[\]\)/.test(src), "");
  check("자리 옮김이 주문에 moved_from · moved_at 을 남긴다", /o\.moved_from = from;/.test(src) && /o\.moved_at = now;/.test(src), "");
}

out.push("\n[4] 그 값이 종이까지 가는가 (public/js/admin.js)");
{
  const src = fs.readFileSync(path.join(__dirname, "..", "public", "js", "admin.js"), "utf8");
  check("주문을 새로 읽을 때마다 알림 인쇄를 확인한다", /printPendingNotices\(fresh\)/.test(src), "");
  check("품목 변경을 잡는다", /o\.items_changed/.test(src), "");
  check("★ 같은 변경을 두 번 찍지 않는다 (변경 시각까지 키에 넣는다)", /`c\$\{o\.id\}@\$\{ch\.at\}`/.test(src), "");
  // 자리 이동은 옮기는 그 자리에서 printMoveSlip 이 이미 한 장 뽑는다.
  // 여기서 또 찍으면 같은 이동에 종이가 두 장 나간다 — 2026-09-10 에 실제로
  // 그렇게 만들 뻔했다(다른 세션이 먼저 만들어 둔 것을 못 보고).
  check("★ 자리 이동은 여기서 또 찍지 않는다", !/kind: "moved"/.test(src), "");
  check("자리 이동 빌지는 따로 있다", /async function printMoveSlip\(/.test(src) && /await printMoveSlip\(buildMoveSlipInfo/.test(src), "");
  check("★ 찍기 전에 먼저 기록한다", /jobs\.forEach\(\(j\) => printedNoticeKeys\.add\(j\.key\)\);[\s\S]{0,40}writeNoticeKeys\(\);/.test(src), "");
  check("담당 기기가 아니면 안 찍는다", /if \(!autoPrintOn \|\| !printHereAllowed\(\)\) return;/.test(src), "");
  check("★ 알림 인쇄가 주문 상태를 밀지 않는다", !/printNoticeTicket[\s\S]{0,2000}markPrintSucceededAndAdvance/.test(src), "");
  check("★ 품목 변경은 두 장 — 주방용 + 결제용", /job\.notice\.kind === "changed"[\s\S]{0,300}priceCopy: true/.test(src), "");
  check("자리 이동은 한 장 (금액이 그대로다)", /const parts = \[buildEscPosRasterTicket\(noticeOrder/.test(src), "");
  check("두 장을 한 줄기로 보낸다", /sendRasterTicketParts\(parts, bridge\)/.test(src), "");
}

out.push("\n[5] 종이에 무슨 종이인지 적히는가 (public/js/escpos.js)");
{
  const src = fs.readFileSync(path.join(__dirname, "..", "public", "js", "escpos.js"), "utf8");
  check("주문 변경 표제가 있다", /주문 변경 \/ 訂單異動/.test(src), "");
  check("★ 취소 줄이 품목 이름보다 먼저 읽힌다", /it\.__delta === "-"[\s\S]{0,80}취소 \/ 取消/.test(src), "");
  check("추가 줄도 표시된다", /it\.__delta === "\+"[\s\S]{0,80}추가 \/ 追加/.test(src), "");
  check("★ 알림 주방용에는 합계를 안 찍는다", /if \(notice\) \{[\s\S]{0,200}주문번호 \/ 單號/.test(src), "");
  check("★ 알림 결제용에는 변경 후 전체 금액이 찍힌다", /if \(priceCopy\) \{[\s\S]{0,300}異動後合計/.test(src), "");
  check("주방용·결제용이 종이 위에서 구분된다", /通知單 · 結帳[\s\S]{0,40}通知單 · 廚房/.test(src), "");
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
