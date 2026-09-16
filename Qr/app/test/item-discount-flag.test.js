// 메뉴 한 줄마다 할인을 켜고 끌 수 있는가.
//
// 2026-09-16 사장님: "모든 주문마다 할인 적용 온 오프 할 수 있게 메뉴
// 관리에서 할 수 있게 해줘."
//
// 같은 날 아침에 **분류마다** 켜고 끄는 것을 붙였는데(2026-09-16
// category-discount-flag), 그것으로는 같은 분류 안에서 하나만 빼거나 하나만
// 넣을 수가 없다. 그래서 메뉴 자신이 표를 하나 더 든다.
//
// 값은 셋이다 — 둘이 아니다:
//   null  분류를 따른다 (기본값, 지금까지의 모든 메뉴)
//   true  이 메뉴만 할인 안 함
//   false 분류가 「할인 제외」여도 이 메뉴는 할인함
//
// 셋째가 없으면 「음료는 전부 할인 안 함, 그런데 이 하나만 해줌」을 표현할
// 방법이 없어서 사장님이 분류를 통째로 풀어야 한다. 그래서 여기서 재는 것은
// 넷이다.
//   1) 세 값이 각각 제대로 저장되고 되읽히는가 (화면이 고른 것을 되돌려
//      보여줘야 한다 — "" 를 false 로 접으면 못 한다)
//   2) 메뉴 표가 분류 표를 이기는가, 양쪽 방향으로
//   3) **실제 결제 금액**이 따라가는가 — 화면만 바뀌면 소용없다
//   4) 메뉴 관리 화면에서 보이고 고칠 수 있는가
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
process.env.SESSION_SECRET = "item-discount-flag";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const fs = require("fs");
const path = require("path");
const request = require("supertest");
const app = require("../server");
const { store } = require("../src/db");
const { isDiscountExcludedMenuItem } = require("../src/discounts");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

(async () => {
  const staff = request.agent(app);
  let r = await staff.post("/api/auth/login").send({ password: "ownerpass123" });
  check("로그인된다", r.status === 200, `${r.status}`);
  await require("./disable-order-hours")();

  const EXCLUDED_CAT = { discount_excluded: true };
  const NORMAL_CAT = { discount_excluded: false };

  out.push("[규칙: 메뉴 표가 분류를 이긴다]");
  check("표가 없으면 분류를 따른다 — 제외 분류", isDiscountExcludedMenuItem({}, EXCLUDED_CAT) === true, "");
  check("표가 없으면 분류를 따른다 — 보통 분류", isDiscountExcludedMenuItem({}, NORMAL_CAT) === false, "");
  check("null 도 「분류 따름」이다", isDiscountExcludedMenuItem({ discount_excluded: null }, EXCLUDED_CAT) === true, "");
  check("★ true 면 보통 분류에서도 빠진다", isDiscountExcludedMenuItem({ discount_excluded: true }, NORMAL_CAT) === true, "");
  check(
    "★ false 면 제외 분류에서도 할인된다",
    isDiscountExcludedMenuItem({ discount_excluded: false }, EXCLUDED_CAT) === false,
    "이게 없으면 「음료는 다 빼고 이 하나만 해줌」을 못 한다"
  );
  check("메뉴가 없으면(스냅샷만 남은 옛 주문) 분류로 본다", isDiscountExcludedMenuItem(null, EXCLUDED_CAT) === true, "");

  out.push("\n[세 값이 저장되고 되읽힌다]");
  const rice = store.categories.find((c) => c.key === "rice");
  const drink = store.categories.find((c) => c.key === "drink");
  check("음료 분류는 「할인 제외」로 시작한다", drink.discount_excluded === true, "");

  const mk = async (body) => {
    const res = await staff.post("/api/menu/admin/items").send({
      category_id: rice.id, name_zh: body.name_zh, price: body.price, force_new: true,
      ...(body.discount_excluded === undefined ? {} : { discount_excluded: body.discount_excluded }),
    });
    if (res.status !== 201) throw new Error(`메뉴 만들기 실패 ${res.status} ${JSON.stringify(res.body)}`);
    return store.menuItems.find((m) => m.id === res.body.id);
  };

  const follow = await mk({ name_zh: "따름밥", price: 200 });
  check("★ 안 보내면 null 이다 — 지금까지의 모든 메뉴가 그렇다", follow.discount_excluded === null, `${follow.discount_excluded}`);
  const offItem = await mk({ name_zh: "할인안함밥", price: 200, discount_excluded: "1" });
  check('★ "1" 은 true 로 저장된다', offItem.discount_excluded === true, `${offItem.discount_excluded}`);
  const onItem = await mk({ name_zh: "할인함밥", price: 200, discount_excluded: "0" });
  check('★ "0" 은 false 로 저장된다 — null 로 접히면 안 된다', onItem.discount_excluded === false, `${onItem.discount_excluded}`);
  const blank = await mk({ name_zh: "빈칸밥", price: 200, discount_excluded: "" });
  check('★ "" 는 null(분류 따름) 이다', blank.discount_excluded === null, `${blank.discount_excluded}`);

  r = await staff.put(`/api/menu/admin/items/${follow.id}`).send({ name_zh: "따름밥", price: 200, discount_excluded: "1" });
  check("★ 수정으로 켤 수 있다", r.status === 200 && store.menuItems.find((m) => m.id === follow.id).discount_excluded === true, `${r.status}`);
  r = await staff.put(`/api/menu/admin/items/${follow.id}`).send({ name_zh: "따름밥", price: 200, discount_excluded: "" });
  check("★ 다시 「분류 따름」으로 되돌릴 수 있다", store.menuItems.find((m) => m.id === follow.id).discount_excluded === null, "");
  r = await staff.put(`/api/menu/admin/items/${follow.id}`).send({ name_zh: "따름밥2", price: 200 });
  check("안 보내면 안 건드린다", store.menuItems.find((m) => m.id === follow.id).discount_excluded === null, "");

  out.push("\n[화면이 답과 날것을 둘 다 받는다]");
  r = await staff.get("/api/menu/admin");
  const riceCat = r.body.find((c) => c.id === rice.id);
  const seen = (id) => riceCat.items.find((i) => i.id === id);
  check("★ 메뉴마다 답이 실려 온다", seen(offItem.id).discount_excluded === true, JSON.stringify(seen(offItem.id).discount_excluded));
  check("분류를 따르는 메뉴는 분류의 답", seen(blank.id).discount_excluded === false, "");
  check(
    "★ 날것도 같이 온다 — 수정 폼이 「분류 따름」을 되돌려 보여줘야 한다",
    seen(blank.id).discount_excluded_own === null && seen(offItem.id).discount_excluded_own === true && seen(onItem.id).discount_excluded_own === false,
    JSON.stringify([seen(blank.id).discount_excluded_own, seen(offItem.id).discount_excluded_own, seen(onItem.id).discount_excluded_own])
  );

  // 제외 분류(음료) 안에 「이 하나는 할인함」을 두고, 서버가 그걸 답으로
  // 내보내는지 본다.
  const drinkOn = await staff.post("/api/menu/admin/items").send({
    category_id: drink.id, name_zh: "할인되는음료", price: 100, force_new: true, discount_excluded: "0",
  });
  r = await staff.get("/api/menu/admin");
  const drinkCat = r.body.find((c) => c.id === drink.id);
  const drinkItems = drinkCat.items;
  check("분류 자체는 여전히 제외다", drinkCat.discount_excluded === true, "");
  check(
    "★ 그 안의 한 줄만 할인 대상으로 온다",
    (drinkItems.find((i) => i.id === drinkOn.body.id) || {}).discount_excluded === false,
    ""
  );
  check(
    "같은 분류의 다른 음료는 그대로 제외다",
    drinkItems.filter((i) => i.id !== drinkOn.body.id).every((i) => i.discount_excluded === true),
    ""
  );

  out.push("\n[실제 결제 금액이 따라간다 — 화면만 바뀌면 소용없다]");
  const TABLES = [11, 12, 13, 15, 16, 17, 18];
  let tableIdx = 0;
  async function payWithVip(itemId) {
    const table = TABLES[tableIdx++];
    const g = request.agent(app);
    const ps = await g.put(`/api/tables/${table}/party-size`).send({ adults: 2, children: 0 });
    if (ps.status !== 200) throw new Error(`자리 지정 실패 ${table} ${ps.status} ${JSON.stringify(ps.body)}`);
    const res = await g.post("/api/orders").send({
      tableNumber: String(table),
      items: [{ itemId, qty: 1, orderType: "dine_in", addons: [] }],
    });
    if (res.status !== 201) throw new Error(`주문 실패 ${res.status} ${JSON.stringify(res.body)}`);
    await staff.patch(`/api/orders/${res.body.id}`).send({ status: "paid", paymentMethod: "cash", vipDiscountType: "vip9" });
    return store.orders.find((o) => o.id === res.body.id);
  }

  let o = await payWithVip(blank.id);
  check("★ 분류를 따르는 밥은 깎인다 — 200 의 10%", (o.discount_amount || 0) === 20, `${o.discount_amount}`);
  o = await payWithVip(offItem.id);
  check("★ 「할인 안 함」으로 둔 밥은 안 깎인다", (o.discount_amount || 0) === 0, `${o.discount_amount} — 표만 바뀌고 돈은 그대로면 소용없다`);
  o = await payWithVip(drinkOn.body.id);
  check("★ 「할인함」으로 둔 음료는 깎인다 — 100 의 10%", (o.discount_amount || 0) === 10, `${o.discount_amount} — 분류(음료)는 제외인데 이 줄만 예외다`);

  // 사장님이 도중에 바꾸면 이미 앉아 있는 테이블도 같이 따라가야 한다 —
  // 같은 화면에서 두 규칙이 돌면 직원이 부르는 숫자가 갈린다.
  await staff.put(`/api/menu/admin/items/${offItem.id}`).send({ name_zh: "할인안함밥", price: 200, discount_excluded: "" });
  o = await payWithVip(offItem.id);
  check("★ 도중에 풀면 바로 다시 깎인다", (o.discount_amount || 0) === 20, `${o.discount_amount}`);

  out.push("\n[메뉴 관리 화면에서 보이고 고칠 수 있다]");
  const admin = fs.readFileSync(path.join(__dirname, "../public/js/admin.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "../public/admin.html"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../public/css/admin.css"), "utf8");
  check("★ 수정 폼에 칸이 있다", /id="f_discount_excluded"/.test(html), "");
  check("★ 세 값이 다 있다", /value=""[^>]*itemDiscountFollowCat/.test(html) && /value="0"/.test(html) && /value="1"/.test(html), "");
  check("★ 저장할 때 같이 보낸다", /discount_excluded: \$\("#f_discount_excluded"\)\.value/.test(admin), "");
  check(
    "★ 열 때 **날것**을 되돌려 보여준다",
    /discount_excluded_own/.test(admin) && !/f_discount_excluded"\)\.value = item\?\.discount_excluded /.test(admin),
    "합쳐진 답을 쓰면 분류를 따르는 메뉴가 전부 「할인 안 함」으로 고정돼 보인다"
  );
  check("★ 「분류 따름」이 지금 어느 쪽인지 알려준다", /paintDiscountExcludedHint/.test(admin) && /itemDiscountHintFollowOn/.test(admin), "분류 토글은 수정 창에서 안 보인다");
  check("분류를 바꾸면 안내도 다시 그린다", /f_category_id"\)\.addEventListener\("change", paintDiscountExcludedHint\)/.test(admin), "");
  check("★ 표에서 예외인 줄이 눈에 띈다", /discountFlagBadgeHtml\(item\)/.test(admin) && /item-discount-badge/.test(css), "");
  check(
    "분류를 따르는 메뉴에는 배지를 안 붙인다",
    /if \(own === null \|\| own === undefined\) return "";/.test(admin),
    "전부에 붙이면 정작 예외인 줄이 안 보인다"
  );
  for (const k of ["itemDiscountExcludedLabel", "itemDiscountFollowCat", "itemDiscountOn", "itemDiscountOff", "itemDiscountOffBadge"]) {
    check(`${k} 가 한국어/중국어 둘 다 있다`, admin.split(`${k}:`).length - 1 >= 2, "");
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
