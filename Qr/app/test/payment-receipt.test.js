// 결제한 그 자리에서 손님 영수증 — 이번에 낸 것만, 시간과 결제 방식까지.
//
// 사장님(2026-09-29):
//   "변경 후 전체 이딴 거 필요없다고 그냥 손님은 자기가 시키고 결제한 것만
//    보면된다고 시간이랑 뭐 이런 것들"
//   "결제할 때 품목 선택해서 결제한 것들만 눌러서 결제 누르고 결제 방식까지
//    나오잖아 현금 카드 라인 뭐 이런 거 그거까지 누르면 영수증을
//    출력하시겠습니까를 만드는거야."
//
// 그리고 품목 추가·취소 때는 주방용 한 장만 — 결제용(「변경 후 전체」)은 없다
// (test/order-change-notice.test.js).
const fs = require("fs");
const path = require("path");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const HANGUL = /[가-힣]/;
const admin = fs.readFileSync(path.join(__dirname, "../public/js/admin.js"), "utf8");
const escposSrc = fs.readFileSync(path.join(__dirname, "../public/js/escpos.js"), "utf8");

function fakeDocument(drawn) {
  const ctx = {
    font: "", textAlign: "left", textBaseline: "top", fillStyle: "#000", strokeStyle: "#000", lineWidth: 1,
    measureText: (t) => ({ width: String(t).length * 10 }),
    fillText: (t) => drawn.push(String(t)),
    fillRect: () => {},
    beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {}, setLineDash: () => {},
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)).fill(255) }),
  };
  return { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
}
function fnSource(src, name) {
  const head = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(src);
  if (!head) return null;
  let i = src.indexOf("{", head.index);
  let depth = 0;
  for (let end = i; end < src.length; end++) {
    if (src[end] === "{") depth++;
    else if (src[end] === "}") {
      depth--;
      if (depth === 0) return src.slice(head.index, end + 1);
    }
  }
  return null;
}

// 한 테이블, 두 라운드. 이번 결제에서는 첫 라운드의 비빔밥과 두 번째 라운드의
// 닭갈비만 골랐다 — 음료는 아직 안 냈다.
const R1 = { id: 11, table_number: "9", party_size: 3, party_adults: 2, party_children: 1, items: [
  { name_ko: "돌솥비빔밥", name_zh: "石鍋拌飯", qty: 1, unit_price: 230, selected_addons: [] },
  { name_ko: "콜라", name_zh: "可樂", qty: 1, unit_price: 50, category_key: "drink", selected_addons: [] },
] };
const R2 = { id: 12, table_number: "9", items: [
  { name_ko: "닭갈비", name_zh: "辣炒雞排", qty: 2, unit_price: 300, selected_addons: [{ name: "加點泡麵", price: 50 }] },
] };
const selections = [{ order: R1, indexes: [0] }, { order: R2, indexes: [0] }];

out.push("[이번에 결제한 것만 모은다]");
let built = null;
{
  const src = [fnSource(admin, "buildPaymentReceiptOrder"), fnSource(admin, "nowLocalString"), fnSource(admin, "lineTotalOf")].join("\n");
  try {
    built = new Function(`${src}\n return buildPaymentReceiptOrder;`)()("9", selections, 41, "特約95折");
  } catch (e) {
    check("떼어내서 돌릴 수 있다", false, String(e && e.message));
  }
  if (built) {
    const names = built.order.items.map((it) => it.name_zh);
    check("★ 고른 두 줄만 — 아직 안 낸 콜라는 없다", JSON.stringify(names) === JSON.stringify(["石鍋拌飯", "辣炒雞排"]), JSON.stringify(names));
    check("합계는 고른 줄의 합 (230 + 600 + 50)", built.order.total === 880, `${built.order.total}`);
    check("할인이 들어간다", built.discount.active && built.discount.amount === 41 && built.discount.discountedTotal === 839, JSON.stringify(built.discount));
    check("품목마다 나눠 긋지 않는다 — 한 줄 + 合計", built.discount.isPercent === false, "");
    check("결제 시각이 찍힐 자리", /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(built.order.created_at), built.order.created_at);
  }
}

out.push("\n[종이]");
{
  const drawn = [];
  const sandbox = { window: { HG_SPICE: { isSilentOnTicket: () => true } } };
  new Function("window", "document", escposSrc)(sandbox.window, fakeDocument(drawn));
  const build = sandbox.window.buildEscPosRasterTicket;
  check("래스터 함수를 부를 수 있다", typeof build === "function", "");
  if (build && built) {
    build(built.order, "韓國館", null, { tableLabel: "桌號 9" }, { receipt: { method: "現金", paidAt: "2026-09-29 19:40:00" }, discount: built.discount });
    const paper = drawn.join("\n");
    check("★ 제목이 「收據」", /韓國館 收據/.test(paper), paper.slice(0, 200));
    check("★ 결제 시각이 찍힌다", /結帳時間/.test(paper), "");
    check("★ 결제 방식이 찍힌다", paper.includes("付款方式") && paper.includes("現金"), "");
    check("★ 「참고용」 문구가 없다 — 이미 받은 돈이다", !/僅供結帳參考/.test(paper), "");
    check("★ 「변경 후 전체」 같은 말이 없다", !/異動後合計|변경 후 전체|通知單/.test(paper), "");
    check("고른 품목이 찍힌다", paper.includes("石鍋拌飯") && paper.includes("辣炒雞排"), "");
    check("★ 안 낸 콜라는 안 찍힌다", !paper.includes("可樂"), "");
    check("할인 한 줄", paper.includes("特約95折") && paper.includes("-NT$41"), "");
    check("合計 — 원래 금액과 받은 금액", /NT\$880 NT\$839/.test(paper), "");
    check("★ 한글이 없다 — 손님 종이는 중국어", !HANGUL.test(paper), JSON.stringify((paper.match(/[가-힣].{0,20}/) || [])[0] || ""));
  }
}

out.push("\n[결제 흐름]");
{
  const handler = admin.slice(admin.indexOf('.querySelectorAll(".pay-selected-items-btn")'), admin.indexOf("$(\"#tableDetailBackdrop\").hidden = false;", admin.indexOf('.querySelectorAll(".pay-selected-items-btn")')));
  const iMethod = handler.indexOf("showPaymentMethodPopup(");
  const iPay = handler.indexOf("payTableOrders(");
  const iAsk = handler.indexOf('showConfirm(T("receiptPrintConfirm"))');
  check("★ 결제 방식을 고르고 → 결제 → 그다음에 묻는다", iMethod > 0 && iPay > iMethod && iAsk > iPay, `${iMethod} ${iPay} ${iAsk}`);
  check("★ 결제가 실패했으면 묻지 않는다", /!results\.some\(\(r\) => !r\.ok\) && \(await showConfirm\(T\("receiptPrintConfirm"\)\)\)/.test(handler), "");
  check("★ 이번에 고른 품목(selections)으로 찍는다", /printPaymentReceipt\(tableNumber, selections, method, breakdown\.total/.test(handler), "");
  check("★ 못 찍으면 화면에 말한다", /receiptPrintFailed/.test(handler), "");
  for (const k of ["receiptPrintConfirm", "receiptPrintFailed"]) {
    check(`${k} 가 두 언어에 다 있다`, admin.split(`${k}:`).length - 1 === 2, "");
  }
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
