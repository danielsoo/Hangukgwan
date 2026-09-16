// 結帳單 — 할인이 **보이는가**, 그리고 **전부 중국어인가**.
//
// 2026-09-16 사장님, 세 번에 걸쳐:
//   "b 안이 제일 좋은 것 같긴 해. 근데 프린트는 빨간색이 안나와서 총 금액을
//    긋고 하는 게 나을 거 같아."            → 시안 B2 (小計 없이, 할인 한 줄 + 合計)
//   "vip 로 할인들어가는 그거는 할인 들어간 요소마다 줄 가로로 긋고 가격
//    새로 써주는 거 해줬으면 좋겠어."
//   "언어 조심해줘. 영수증은 무조건 다 중국어야 해."
//
// ── 왜 취소선인가 ────────────────────────────────────────────────────
// 열전사 프린터는 점이 찍히거나 안 찍히거나(1비트)다. 빨강도 회색도 못
// 쓴다 — 남는 표시는 취소선 하나뿐이다.
//
// 인쇄 경로가 셋이고 할 수 있는 일이 서로 다르다.
//   · 브라우저 인쇄(HTML)  — CSS text-decoration
//   · 래스터(그림으로 그려 보냄) — 우리가 직접 선을 긋는다
//   · 텍스트 ESC/POS — 취소선 명령이 **없다**. 화살표가 그 자리를 대신한다.
//     이것까지 취소선을 요구하면 있지도 않은 기능을 재는 시험이 된다.
//
// ── 왜 언어를 재는가 ─────────────────────────────────────────────────
// 廚房出單 은 주방이 읽는 종이라 한글이 같이 있는 게 낫고, 結帳單 은 손님이
// 가져가는 종이다. 같은 함수가 둘 다 만들기 때문에 한쪽만 고치면 다른 쪽이
// 조용히 샌다. 그래서 **글자를 맞춰보지 않고 실제로 종이를 만들어** 한글이
// 한 자라도 있는지 본다.
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

out.push("[브라우저 인쇄 — CSS]");
check("★ 품목의 원래 값에 줄이 그어진다", /\.item-price-orig \{[^}]*text-decoration: line-through/.test(admin), "");
check("★ 合計 의 원래 값에도 줄이 그어진다", /\.total-price-orig \{[^}]*text-decoration: line-through/.test(admin), "");
check(
  "★ 회색이 아니라 검정이다 — 열전사는 회색을 성기게 찍는다",
  /\.item-price-orig \{ color: #000;/.test(admin) && /\.total-price-orig \{ color: #000;/.test(admin),
  "#999 로 두면 종이에서 안 보인다"
);
check("★ 붉은 기가 돌던 안내도 검정으로", /\.price-copy-drink-note \{ color: #000;/.test(admin), "빨간색은 아예 안 찍힌다");
check("할인 줄 자리가 있다", /\.discount-row \{ display: flex;/.test(admin), "");

out.push("\n[영수증 구성 — 시안 B2]");
const body = admin.slice(
  admin.indexOf("  function buildReceiptBodyHtml(o, priceCopy) {"),
  admin.indexOf("\n  // 위 buildReceiptBodyHtml()")
);
check("본문을 찾았다", body.length > 500, `${body.length}`);
check("★ 「무슨 할인 얼마」 한 줄이 있다", /class="discount-row"/.test(body), "");
check(
  "★ 할인이 0 이면 그 줄을 안 만든다",
  /discountInfo\.active && Number\(discountInfo\.amount\) > 0/.test(body),
  "「折扣 -NT$0」 은 아무것도 알려주지 않는다"
);

out.push("\n[종이에 찍는 할인 이름은 중국어다]");
check("★ 종이 전용 이름표가 따로 있다", /const RECEIPT_DISCOUNT_PART_LABELS = \{/.test(admin), "");
{
  const i = admin.indexOf("const RECEIPT_DISCOUNT_PART_LABELS = {");
  const table = admin.slice(i, admin.indexOf("};", i));
  check("特約95折 · VIP9折 · 折扣", /te95: "特約95折"/.test(table) && /vip9: "VIP9折"/.test(table) && /manual: "折扣"/.test(table), table);
  check("★ 한글이 섞여 있지 않다", !HANGUL.test(table), table);
  check("★ 화면 언어를 따르는 T() 를 안 쓴다", !/T\(/.test(table), "화면은 한국어다");
}
{
  const info = admin.slice(admin.indexOf("  function computeTicketDiscountInfo(o) {"), admin.indexOf("\n  // 결제 방식/재량 할인 미리보기"));
  check("★ 결제된 주문도 종이용 이름을 쓴다", /label: receiptDiscountLabelOf\(o\.discount_type\)/.test(info), "");
  check("★ 아직 안 낸 주문의 미리보기도 같다", !/discountPartLabelOf\(/.test(info), "화면용 이름표가 종이에 새면 안 된다");
}

out.push("\n[래스터 — 진짜로 선을 긋는다]");
check(
  "★ 품목 줄이 취소선을 달고 나간다",
  /strike: \{ before: "  └ ", text: orig \}/.test(escposSrc),
  "사장님: 할인 들어간 요소마다 줄 가로로 긋고 가격 새로 써주는 거"
);
check("★ 合計 도 앞부분에 취소선", /strikePrefix: `NT\$\$\{money\(o\.total\)\}`/.test(escposSrc), "");
check("★ line() 이 그 옵션을 실어 나른다", /strike: opts\.strike \|\| null/.test(escposSrc), "");
check("★ row() 도", /strikePrefix: opts\.strikePrefix \|\| null/.test(escposSrc), "");
check(
  "★ 그리는 쪽이 실제로 선을 긋는다 (품목)",
  /if \(op\.strike && op\.align !== "center"\) \{[\s\S]{0,400}?ctx\.fillRect\(/.test(escposSrc),
  "옵션만 실어 보내고 안 그리면 종이에는 아무 일도 안 일어난다"
);
check("★ 그리는 쪽이 실제로 선을 긋는다 (合計)", /if \(op\.strikePrefix\) \{[\s\S]{0,400}?ctx\.fillRect\(/.test(escposSrc), "");
check("★ 品目 줄에 화살표를 안 쓴다", !/line\("  └ NT\$" \+ money\(amount\) \+ "→NT\$"/.test(escposSrc), "옛 방식이 남아 있다");

out.push("\n[텍스트 ESC/POS — 할 수 있는 만큼만]");
check("★ 할인 한 줄은 여기에도 찍힌다", /out \+= padLine\(discount\.label \|\| "折扣", `-NT\$\$\{money\(discount\.amount\)\}`\)/.test(escposSrc), "");
check("★ 小計 는 안 찍는다", !/padLine\("小計"/.test(escposSrc), "");
check("★ 취소선이 없다는 사실이 적혀 있다", /텍스트 모드에는 취소선이 없다/.test(escposSrc), "");

// ────────────────────────────────────────────────────────────────────
// 여기서부터는 글자를 맞춰보지 않고 **진짜 종이를 만들어서** 본다.
// ────────────────────────────────────────────────────────────────────

/** 최소한의 캔버스 흉내 — 래스터 렌더러를 node 에서 돌리기 위한 것. */
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

const ORDER = {
  id: 77, status: "paid", table_number: "9", party_size: 2, party_adults: 2, party_children: 0,
  created_at: "2026-09-16 19:24:00", order_type: "dine_in", total: 890,
  items: [
    // 中文 이름이 없는 품목 — 여기서 한글로 떨어지면 손님 종이에 한글이 찍힌다.
    { name_ko: "돌솥비빔밥", name_en: "Stone Pot Bibimbap", qty: 1, unit_price: 230, selected_addons: [] },
    { name_zh: "辣炒雞排", name_ko: "닭갈비", qty: 2, unit_price: 300, selected_addons: [{ name: "加點泡麵", price: 50 }] },
  ],
};
const DISCOUNT = { active: true, isPercent: true, rate: 0.95, discountedTotal: 847, label: "特約95折", amount: 43 };

out.push("\n[結帳單 에는 한글이 한 자도 없다 — 실제로 만들어서 본다]");
{
  const sandbox = { window: {} };
  // eslint-disable-next-line no-new-func
  new Function("window", "document", escposSrc)(sandbox.window, fakeDocument([]));
  const buildText = sandbox.window.buildEscPosTicket;
  check("종이 만드는 함수를 부를 수 있다", typeof buildText === "function", "");

  if (typeof buildText === "function") {
    const priceText = buildText(ORDER, "韓國館", { priceCopy: true, discount: DISCOUNT });
    check("★ 텍스트 結帳單 에 한글이 없다", !HANGUL.test(priceText), JSON.stringify((priceText.match(/[가-힣].{0,20}/) || [])[0] || ""));
    check("★ 中文 이름이 없는 품목은 영어로 떨어진다", priceText.includes("Stone Pot Bibimbap"), "");
    check("★ 中文 이름이 있으면 그것을 쓴다", priceText.includes("辣炒雞排"), "");

    // 廚房出單 은 반대다 — 주방이 읽으니 한글이 있어야 한다.
    const kitchen = buildText(ORDER, "한국관", { priceCopy: false, discount: { active: false } });
    check("★ 廚房出單 은 예전 그대로 한글을 쓴다", kitchen.includes("돌솥비빔밥"), "주방이 읽는 종이다");

    // 테스터 주문도 손님 종이에는 중국어만.
    const test = buildText({ ...ORDER, test_session: "test_table" }, "韓國館", { priceCopy: true, discount: DISCOUNT });
    check("★ 테스터 結帳單 에도 한글이 없다", !HANGUL.test(test), JSON.stringify((test.match(/[가-힣].{0,20}/) || [])[0] || ""));
    check("테스터 표시 자체는 남는다", test.includes("請勿製作此訂單"), "");
  }
}
{
  const drawn = [];
  const sandbox = { window: {} };
  // eslint-disable-next-line no-new-func
  new Function("window", "document", escposSrc)(sandbox.window, fakeDocument(drawn));
  const buildRaster = sandbox.window.buildEscPosRasterTicket;
  check("래스터 함수를 부를 수 있다", typeof buildRaster === "function", "");
  if (typeof buildRaster === "function") {
    drawn.length = 0;
    buildRaster(ORDER, "韓國館", null, null, { priceCopy: true, discount: DISCOUNT });
    const paper = drawn.join("\n");
    check("★ 래스터 結帳單 에 한글이 없다", !HANGUL.test(paper), JSON.stringify((paper.match(/[가-힣].{0,20}/) || [])[0] || ""));
    check("★ 품목마다 원가와 할인가가 같이 찍힌다", /NT\$230 NT\$218/.test(paper), paper.slice(0, 400));
    check("★ 合計 도 원가와 받은 돈이 같이", /NT\$890 NT\$847/.test(paper), "");
    check("★ 할인 한 줄이 있다", paper.includes("特約95折") && paper.includes("-NT$43"), "");

    // 주문 변경 알림의 결제용 사본 — 여기 라벨이 한글이었다.
    drawn.length = 0;
    buildRaster(
      { ...ORDER, items: ORDER.items.map((it, i) => ({ ...it, __delta: i === 0 ? "+" : "-" })) },
      "韓國館",
      null,
      null,
      { priceCopy: true, discount: DISCOUNT, notice: { kind: "changed" } }
    );
    const notice = drawn.join("\n");
    check("★ 변경 통지의 結帳 사본에도 한글이 없다", !HANGUL.test(notice), JSON.stringify((notice.match(/[가-힣].{0,20}/) || [])[0] || ""));
    check("추가·취소 표시는 남는다", notice.includes("[追加]") && notice.includes("[取消]"), notice.slice(0, 300));
  }
}

out.push("\n[HTML 結帳單 도 같은 규칙]");
{
  const cut = (a, b) => { const i = admin.indexOf(a); return admin.slice(i, admin.indexOf(b, i)); };
  const helpers = `
    const storeSettings = {};
    const money = (v) => (v === "" || v == null ? "" : Number(v).toLocaleString("en-US"));
    const escapeHtml = (v) => String(v == null ? "" : v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const isCounterOrder = () => false;
    const orderTypeLabel = () => "內用";
    const partyTag = (o) => (o && o.party_size ? " (" + o.party_size + ")" : "");
    const discountBaseOfClient = (it) => (it.unit_price||0)*(it.qty||0);
    const payableAfterRateClient = (a, r) => Math.floor(a*r);
    const window = { HG_SPICE: { isSilentOnTicket: () => true } };
    function computeTicketDiscountInfo() { return ${JSON.stringify(DISCOUNT)}; }
  `;
  const banner = cut("  function testTicketBannerHtml(o, priceCopy) {", "\n  function buildReceiptBodyHtml(");
  const bodyFn = cut("  function buildReceiptBodyHtml(o, priceCopy) {", "\n  // 위 buildReceiptBodyHtml()");
  // eslint-disable-next-line no-new-func
  const build = new Function(`${helpers}\n${banner}\n${bodyFn}\n return buildReceiptBodyHtml;`)();
  const priceHtml = build({ ...ORDER, test_session: "test_table" }, true);
  check("★ HTML 結帳單 에 한글이 없다", !HANGUL.test(priceHtml), JSON.stringify((priceHtml.match(/[가-힣].{0,20}/) || [])[0] || ""));
  check("★ 가게 이름도 중국어로 떨어진다", priceHtml.includes("韓國館"), "설정에 中文 이름이 없어도 한글로 가면 안 된다");
  check("★ 中文 이름이 없는 품목은 영어로", priceHtml.includes("Stone Pot Bibimbap"), "");
  check("★ 품목마다 원가에 줄을 긋는다", /item-price-orig">NT\$230<\/span> <span class="item-price-final">NT\$218/.test(priceHtml), "");
  // 소스에 적힌 글자가 아니라 **실제로 만들어진 종이**로 본다 — 주석에
  // 「小計」라고 써 있는 것까지 세면 시험이 거짓말을 한다.
  check("★ 小計 줄은 없다 (B2)", !priceHtml.includes("小計"), "같은 금액이 두 번 적히면 헷갈린다");
  check(
    "★ 할인 줄이 合計 보다 위에",
    priceHtml.indexOf('class="discount-row"') < priceHtml.indexOf("合計") && priceHtml.includes('class="discount-row"'),
    "깎고 나서 얼마를 받았는지 순서대로 읽혀야 한다"
  );
  const kitchenHtml = build(ORDER, false);
  check("★ 廚房出單 은 예전 그대로 한글을 쓴다", kitchenHtml.includes("돌솥비빔밥"), "주방이 읽는 종이다");
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
