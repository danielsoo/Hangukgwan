// 하나만 고르는 옵션에 값을 붙일 수 있는가 — 크기(S/M/L/XL) 같은 것.
//
// 2026-09-16 사장님: "크기 같은 옵션은 옵션마다 금액이 추가가 되어야 하는데
// 이게 또 중복이 되면 안되거든? 당연히? 그래서 하나만 고르는 옵션으로
// 들어가야 하는데 그건 가격이 안 바뀐대."
//
// 그동안 둘 중 하나만 고를 수 있었다.
//
//   · 하나만 고르는 옵션(options) — 하나만 골라지는데 **값이 안 붙는다**
//   · 여러 개 고르는 옵션(addons) — 값이 붙는데 **여러 개 골라진다**
//
// 크기는 둘 다 필요하다. addons 로 넣으면 손님이 M 과 L 을 같이 고른다.
// 그래서 options 에도 「이름:금액」을 허용한다.
//
// ── 제일 조심할 것 ─────────────────────────────────────────────────────
//
// 지금 쓰고 있는 옵션은 전부 "牛,豬" 처럼 값이 없는 모양이다. 그것이 **한
// 글자도 안 바뀌고 그대로 돌아야** 한다. 금액을 안 적으면 0 이다.
//
// 그리고 값은 **서버가 다시 매긴다.** 화면이 보내온 금액은 안 믿는다 —
// addons 와 같은 원칙이다.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"),
  filename: require.resolve("mongodb"),
  loaded: true,
  exports: fake,
  paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "option-price";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const fs = require("fs");
const path = require("path");
const request = require("supertest");
const app = require("../server");
const { store } = require("../src/db");
const { parseOptions, optionPriceOf, parseAddons } = require("../src/addons");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

(async () => {
  out.push("[읽는 규칙 — addons 와 같아야 한다]");
  check("★ 지금 쓰는 값이 그대로 읽힌다", JSON.stringify(parseOptions("牛,豬")) === JSON.stringify([{ name: "牛", price: 0 }, { name: "豬", price: 0 }]), JSON.stringify(parseOptions("牛,豬")));
  check("★ 값이 붙은 옵션도 읽힌다", JSON.stringify(parseOptions("S:0,M:50,L:150")) === JSON.stringify([{ name: "S", price: 0 }, { name: "M", price: 50 }, { name: "L", price: 150 }]), JSON.stringify(parseOptions("S:0,M:50,L:150")));
  check("addons 와 똑같이 읽는다", JSON.stringify(parseOptions("M:50")) === JSON.stringify(parseAddons("M:50")), "");
  check("고른 것의 값을 찾는다", optionPriceOf("S:0,M:50,L:150", "L") === 150, `${optionPriceOf("S:0,M:50,L:150", "L")}`);
  check("★ 없는 옵션은 0 — 지어내지 않는다", optionPriceOf("S:0,M:50", "XL") === 0, "");
  check("★ 값이 없는 옵션도 0", optionPriceOf("牛,豬", "牛") === 0, "");
  check("옵션이 아예 없어도 안 터진다", optionPriceOf(null, "M") === 0 && optionPriceOf("", null) === 0, "");

  const staff = request.agent(app);
  let r = await staff.post("/api/auth/login").send({ password: "ownerpass123" });
  check("로그인된다", r.status === 200, `${r.status}`);
  await require("./disable-order-hours")();

  // 크기 옵션이 붙은 메뉴를 하나 만든다.
  const cat = store.categories[0];
  r = await staff.post("/api/menu/admin/items").send({
    category_id: cat.id,
    name_zh: "크기메뉴",
    name_ko: "크기메뉴",
    price: 200,
    options: "S:0,M:50,L:150",
    force_new: true,
  });
  check("메뉴가 만들어진다", r.status === 201, `${r.status} ${JSON.stringify(r.body)}`);
  const sized = r.body.id;
  // 값이 안 붙은 옛 모양의 메뉴도 하나.
  r = await staff.post("/api/menu/admin/items").send({
    category_id: cat.id, name_zh: "고기메뉴", name_ko: "고기메뉴", price: 300, options: "牛,豬", force_new: true,
  });
  const meat = r.body.id;

  async function order(table, itemId, option) {
    const guest = request.agent(app);
    await guest.put(`/api/tables/${table}/party-size`).send({ adults: 2, children: 0 });
    const res = await guest.post("/api/orders").send({
      tableNumber: String(table),
      items: [{ itemId, qty: 2, orderType: "dine_in", addons: [], option }],
    });
    if (res.status !== 201) throw new Error(`주문 실패 ${res.status} ${JSON.stringify(res.body)}`);
    return store.orders.find((o) => o.id === res.body.id);
  }

  out.push("\n[실제 주문 금액이 따라간다]");
  let o = await order(5, sized, "S");
  check("S 는 그대로", o.total === 400, `${o.total} (200 x2)`);
  check("붙은 값은 없다고 적는다", o.items[0].option_price == null, `${o.items[0].option_price}`);
  o = await order(6, sized, "L");
  // 2026-09-16 사장님: "가격에 넣은 그 액수만큼 올라가게 해줘. 최소 주문
  // 관련 없이." 200 x2 + 150 = 550 이다. 150 x2 가 아니다.
  check("★ 적어둔 금액이 그대로 한 번 붙는다", o.total === 550, `${o.total} (200 x2 + 150 이어야 한다)`);
  check("★ 붙은 값을 따로 적어둔다", o.items[0].option_price === 150, `${o.items[0].option_price}`);
  check("★ 밥값은 밥값대로 둔다", o.items[0].unit_price === 200, `${o.items[0].unit_price}`);
  check("고른 이름도 남는다", o.items[0].option_choice === "L", `${o.items[0].option_choice}`);

  out.push("\n[옛 모양 메뉴는 그대로다]");
  o = await order(7, meat, "牛");
  check("★ 값이 안 붙는다", o.total === 600, `${o.total} (300 x2)`);
  check("고른 이름은 남는다", o.items[0].option_choice === "牛", `${o.items[0].option_choice}`);
  check("붙은 값 칸은 비어 있다", o.items[0].option_price == null, "");

  out.push("\n[화면이 보내온 금액은 안 믿는다]");
  // addons 와 같은 원칙. 이름만 받아서 메뉴 쪽 정의에서 값을 찾는다.
  const guest = request.agent(app);
  await guest.put("/api/tables/8/party-size").send({ adults: 2, children: 0 });
  r = await guest.post("/api/orders").send({
    tableNumber: "8",
    // 「L 인데 값은 0 이야」라고 우겨본다.
    items: [{ itemId: sized, qty: 1, orderType: "dine_in", addons: [], option: "L", option_price: 0, unit_price: 1 }],
  });
  o = store.orders.find((x) => x.id === r.body.id);
  check("★ 서버가 다시 매긴다", o.total === 350 && o.items[0].option_price === 150, `${o.total} / ${o.items[0].option_price}`);

  r = await guest.post("/api/orders").send({
    tableNumber: "8",
    items: [{ itemId: sized, qty: 1, orderType: "dine_in", addons: [], option: "없는크기" }],
  });
  o = store.orders.find((x) => x.id === r.body.id);
  check("★ 없는 옵션을 보내도 주문은 들어간다 — 값만 0", o.total === 200, `${o.total}`);

  out.push("\n[할인도 옵션 값을 포함한 금액에 걸린다]");
  const paid = await order(9, sized, "L"); // 200x2 + 150 = 550
  r = await staff.patch(`/api/orders/${paid.id}`).send({ status: "paid", paymentMethod: "cash", vipDiscountType: "vip9" });
  check("결제된다", r.status === 200, `${r.status}`);
  const after = store.orders.find((x) => x.id === paid.id);
  check("★ 크기 값까지 넣은 550 의 10% 가 깎인다", (after.discount_amount || 0) === 55, `${after.discount_amount}`);

  out.push("\n[세 화면이 같은 규칙을 쓴다]");
  const admin = fs.readFileSync(path.join(__dirname, "../public/js/admin.js"), "utf8");
  const order_ = fs.readFileSync(path.join(__dirname, "../public/js/order.js"), "utf8");
  for (const [who, src] of [["관리자 화면", admin], ["손님 화면", order_]]) {
    check(`★ ${who} 도 「이름:금액」을 읽는다`, /function parseOptions\(str\)/.test(src), "이름만 쪼개면 「M:50」이 통째로 이름이 된다");
    check(`${who} 가 이름만 쓰는 자리를 따로 둔다`, /optionNames/.test(src), "");
  }
  check("★ 손님 화면이 고른 값을 담기 버튼에 더한다", /currentOptionPrice\(currentItem\)/.test(order_), "");
  check("★ 손님 화면이 칩에 얼마가 붙는지 적는다", /opt\.price[\s\S]{0,120}?\+\$\{money\(opt\.price\)\}/.test(order_), "");
  check("★ 관리자 수기 주문도 옵션 값을 더한다", /optionPriceOf\(mi\.options, option\)/.test(admin), "");
  check("★ 옵션을 바꾸면 금액이 다시 그려진다", /option = v;[\s\S]{0,60}?updateCommitLabel\(\)/.test(admin), "");

  out.push("\n[종이에도 얼마가 붙었는지 찍힌다]");
  const escpos = fs.readFileSync(path.join(__dirname, "../public/js/escpos.js"), "utf8");
  check("★ 값이 붙은 옵션은 종이에 금액이 같이 찍힌다", /function optionLine\(it\)/.test(escpos), "");
  check("두 인쇄 경로가 같은 함수를 쓴다", (escpos.match(/optionLine\(it\)/g) || []).length >= 2, "");

  out.push("\n[메뉴 관리 화면]");
  const html = fs.readFileSync(path.join(__dirname, "../public/admin.html"), "utf8");
  check(
    "★ 옵션 칸이 값을 받는다",
    /chip-field chip-field-priced" data-chip-for="f_options"/.test(html),
    "값을 넣을 자리가 없으면 사장님이 못 쓴다"
  );
  check("★ 「가격은 안 바뀌어요」 를 더 안 적는다", !/itemOptionsSingleHint: "[^"]*가격은 안 바뀌어요/.test(admin), "");
  check(
    "★ 값이 없는 옵션을 「무료」라고 지어내지 않는다",
    /hasPriceSlot[\s\S]{0,200}?chipFreeAddon/.test(admin),
    '"牛" 를 「무료」로 적으면 없는 말을 지어내는 것이다'
  );
  check("★ 개별 수량과 같이 쓰면 말해준다", /paintMixOptionsWarn/.test(admin) && /mixOptionsPriceWarn/.test(html), "값을 조용히 무시하는 것이 제일 나쁘다");
  for (const k of ["itemOptionsSingleHint", "itemMixOptionsPriceWarn", "chipOptionNamePlaceholder"]) {
    check(`${k} 가 한국어/중국어 둘 다 있다`, admin.split(`${k}:`).length - 1 >= 2, "");
  }

  out.push("\n[미리보기 탭 — 손님 폰에서 어떻게 보이나]");
  //
  // 2026-09-16 사장님: "옵션 탭이 지금 너무 혼잡해 읽어도 이해가 안되는
  // 부분이 꽤 있어서 (…) 폰에서 어떻게 보이는지 실제 ui 코드를 랜더링해서
  // 보여주면 좋을 것 같아. 실제 서비스에서 불러오면 괜히 복잡해지고 그냥
  // 작동 안하는 프론트만 보여주면 될 것 같아."
  const css = fs.readFileSync(path.join(__dirname, "../public/css/admin.css"), "utf8");
  check("탭이 있다", /data-item-pane="preview"/.test(html), "");
  check("그릴 자리가 있다", /id="itemPreviewScreen"/.test(html), "");
  check("★ 열 때마다 지금 폼 값으로 다시 그린다", /if \(name === "preview"\) renderItemPreview\(\)/.test(admin), "옛 그림이 남아 있으면 더 헷갈린다");
  check(
    "★ 손님 화면을 불러오지 않는다 — 작동 안 하는 그림이다",
    !/itemPreviewScreen[\s\S]{0,600}?<iframe/.test(admin) && !/renderItemPreview[\s\S]{0,1200}?fetch\(/.test(admin),
    "실제 서비스를 불러오면 괜히 복잡해진다"
  );
  check(
    "★ 눌리지 않는다",
    /\.phone-preview-screen\s*\{[^}]*pointer-events:\s*none/.test(css),
    "누를 수 있으면 진짜 화면인 줄 안다"
  );
  check(
    "★ 하나만 고르는 것은 알약, 여러 개는 체크박스로 그린다",
    /pv-chip/.test(admin) && /pv-check/.test(admin) && /\.pv-box/.test(css),
    "둘의 차이는 글보다 그림이 빠르다 — 그게 이 탭이 하는 일이다"
  );
  check(
    "★ 담기 버튼 금액도 실제 규칙대로 센다",
    /price \* qty \+ \(firstOpt \? firstOpt\.price : 0\)/.test(admin),
    "미리보기가 다른 숫자를 보여주면 아무 소용이 없다"
  );
  for (const k of ["itemPanePreview", "itemPreviewHint", "itemPreviewAddBtn"]) {
    check(`${k} 가 한국어/중국어 둘 다 있다`, admin.split(`${k}:`).length - 1 >= 2, "");
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
