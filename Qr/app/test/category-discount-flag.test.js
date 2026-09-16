// 할인에서 빼는 분류를 사장님이 직접 보고 고칠 수 있는가.
//
// 2026-09-16 사장님: "그리고 할인은 기타, 음료 는 모두 적용 안돼."
//
// **같은 요청이 두 번째다.** 2026-09-14 에도 "지금은 음료 주류만 빠지는데
// 기타 항목도 모두 할인 안하게 해줘" 가 있었고, 그때는 코드에 키 목록
// (["drink", "other"])을 적는 것으로 끝냈다.
//
// 그 방법의 문제: 분류의 key 는 만들 때 한 번 정해지고 **화면에 안 보인다.**
// 「기타」라고 보이는 분류의 key 가 other 가 아니면 할인이 그대로 걸리는데,
// 사장님은 그 사실을 알 방법도 고칠 방법도 없다. 요청이 두 번 온 이유가
// 그것으로 보인다.
//
// 그래서 세 가지를 잰다.
//  1) 이름이 「기타」면 key 가 뭐든 빠지는가
//  2) 사장님이 메뉴 관리에서 켜고 끌 수 있는가 (그리고 그 값이 이긴다)
//  3) 손님 주문의 실제 금액까지 그 값을 따라가는가 — 화면만 바뀌면 소용없다
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
process.env.SESSION_SECRET = "category-discount-flag";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const request = require("supertest");
const app = require("../server");
const { store } = require("../src/db");
const { isDiscountExcludedCategory, guessDiscountExcluded } = require("../src/discounts");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

(async () => {
  // 먼저 로그인한다. 씨딩과 마이그레이션이 서버 기동 뒤에 도는데, 그것을
  // 안 기다리고 store 를 읽으면 분류가 아직 하나도 없다.
  const staff = request.agent(app);
  let r = await staff.post("/api/auth/login").send({ password: "ownerpass123" });
  check("로그인된다", r.status === 200, `${r.status}`);
  await require("./disable-order-hours")();

  out.push("[이름으로도 알아본다 — key 는 화면에 안 보인다]");
  check("★ key 가 other 가 아니어도 이름이 기타면 뺀다", guessDiscountExcluded({ key: "etc", name_ko: "기타" }) === true, "");
  check("★ 중국어 이름도 알아본다", guessDiscountExcluded({ key: "zzz", name_zh: "其他" }) === true, "");
  check("음료도 이름으로 잡힌다", guessDiscountExcluded({ key: "bev", name_ko: "음료" }) === true, "");
  check("주류도", guessDiscountExcluded({ key: "al", name_zh: "酒類" }) === true, "");
  check("key 가 맞으면 이름과 상관없다", guessDiscountExcluded({ key: "drink", name_ko: "마실것" }) === true, "");
  check("밥류는 안 빠진다", guessDiscountExcluded({ key: "rice", name_ko: "밥류" }) === false, "");
  check("전통한식요리도 안 빠진다", guessDiscountExcluded({ key: "traditional", name_ko: "전통한식요리" }) === false, "");

  out.push("\n[사장님이 정한 값이 이긴다]");
  check("★ 켜면 밥류도 빠진다", isDiscountExcludedCategory({ key: "rice", discount_excluded: true }) === true, "");
  check("★ 끄면 음료도 안 빠진다 — 짐작이 틀렸으면 풀 수 있어야 한다", isDiscountExcludedCategory({ key: "drink", discount_excluded: false }) === false, "");
  check("표가 없으면 짐작한다", isDiscountExcludedCategory({ key: "drink" }) === true, "");

  out.push("\n[마이그레이션이 처음 값을 채운다]");
  for (const c of store.categories) {
    check(`${c.name_ko} 에 표가 있다`, c.discount_excluded !== undefined, `${c.key}`);
  }
  const drink = store.categories.find((c) => c.key === "drink");
  check("★ 음료는 켜져 있다", !!drink && drink.discount_excluded === true, JSON.stringify(drink && drink.discount_excluded));
  const rice = store.categories.find((c) => c.key === "rice");
  check("밥류는 꺼져 있다", !!rice && rice.discount_excluded === false, "");

  out.push("\n[화면이 답을 그대로 받는다]");
  r = await staff.get("/api/menu/admin");
  const seen = r.body.find((c) => c.key === "drink");
  check("★ 분류마다 답이 실려 온다", !!seen && seen.discount_excluded === true, JSON.stringify(seen && seen.discount_excluded));
  const seenRice = r.body.find((c) => c.key === "rice");
  check("빠지지 않는 분류는 false 로 온다", !!seenRice && seenRice.discount_excluded === false, "");
  const guest = await request(app).get("/api/menu");
  check("손님 화면에도 같이 간다", (guest.body.find((c) => c.key === "drink") || {}).discount_excluded === true, "");
  // 표가 아예 없는 옛 분류도 **서버가 답을 내서** 보내야 한다. 화면은
  // 짐작하지 않는다 — 그 규칙은 서버에만 있다.
  const noodle = store.categories.find((c) => c.key === "noodle");
  delete noodle.discount_excluded;
  noodle.name_ko = "기타";
  r = await staff.get("/api/menu/admin");
  const guessed = r.body.find((c) => c.key === "noodle");
  check(
    "★ 표가 없는 옛 분류도 서버가 답을 내서 보낸다",
    !!guessed && guessed.discount_excluded === true,
    JSON.stringify(guessed && guessed.discount_excluded) + " — 화면은 짐작하지 않는다"
  );
  noodle.name_ko = "면류";
  noodle.discount_excluded = false;

  out.push("\n[메뉴 관리에서 켜고 끈다]");
  r = await staff.patch(`/api/menu/admin/categories/${rice.id}`).send({ discount_excluded: true });
  check("★ 켤 수 있다", r.status === 200 && r.body.discount_excluded === true, `${r.status} ${JSON.stringify(r.body)}`);
  check("실제로 저장된다", store.categories.find((c) => c.id === rice.id).discount_excluded === true, "");
  r = await staff.patch(`/api/menu/admin/categories/${rice.id}`).send({ discount_excluded: false });
  check("★ 끌 수 있다", r.status === 200 && r.body.discount_excluded === false, `${r.status}`);
  r = await staff.patch("/api/menu/admin/categories/999999").send({ discount_excluded: true });
  check("없는 분류는 404", r.status === 404, `${r.status}`);

  out.push("\n[실제 결제 금액이 따라간다]");
  // 화면만 바뀌면 소용없다. 손님 주문을 넣고 VIP 할인을 걸어 실제로
  // 깎인 금액을 본다.
  const riceItem = store.menuItems.find((m) => m.available && m.category_id === rice.id && m.price > 0);
  async function payWithVip(table) {
    const g = request.agent(app);
    await g.put(`/api/tables/${table}/party-size`).send({ adults: 2, children: 0 });
    const res = await g.post("/api/orders").send({
      tableNumber: String(table),
      items: [{ itemId: riceItem.id, qty: 1, orderType: "dine_in", addons: [] }],
    });
    if (res.status !== 201) throw new Error(`주문 실패 ${res.status} ${JSON.stringify(res.body)}`);
    await staff.patch(`/api/orders/${res.body.id}`).send({ status: "paid", paymentMethod: "cash", vipDiscountType: "vip9" });
    return store.orders.find((o) => o.id === res.body.id);
  }

  let o = await payWithVip(11);
  check("★ 평소에는 밥류에 할인이 걸린다", (o.discount_amount || 0) > 0, `${o.discount_amount}`);

  await staff.patch(`/api/menu/admin/categories/${rice.id}`).send({ discount_excluded: true });
  o = await payWithVip(12);
  check("★ 제외로 켜면 실제로 안 깎인다", (o.discount_amount || 0) === 0, `${o.discount_amount} — 화면만 바뀌고 돈은 그대로면 소용없다`);

  await staff.patch(`/api/menu/admin/categories/${rice.id}`).send({ discount_excluded: false });
  o = await payWithVip(13);
  check("★ 다시 끄면 또 깎인다", (o.discount_amount || 0) > 0, `${o.discount_amount}`);

  out.push("\n[메뉴 관리 화면에 보인다]");
  const fs = require("fs");
  const path = require("path");
  const admin = fs.readFileSync(path.join(__dirname, "../public/js/admin.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../public/css/admin.css"), "utf8");
  check("★ 분류마다 체크칸이 있다", /data-cat-discount-id="\$\{c\.id\}"/.test(admin), "볼 자리가 없으면 또 물어보게 된다");
  check("★ 눌리면 서버에 저장한다", /\/api\/menu\/admin\/categories\/\$\{id\}`, \{\s*method: "PATCH"/.test(admin), "");
  check("★ 저장한 뒤 서버 값으로 다시 그린다", /catDiscountId[\s\S]{0,700}?loadMenu\(\)/.test(admin), "눌린 대로 믿으면 저장 실패가 안 보인다");
  check("직원 권한이 없으면 못 누른다", /data-cat-discount-id[\s\S]{0,120}?canMenuEdit\(\) \? "" : "disabled"/.test(admin), "");
  check("자리 규칙이 있다", /\.cat-discount-toggle/.test(css), "");
  for (const k of ["catDiscountExcluded", "catDiscountExcludedTitle"]) {
    check(`${k} 가 한국어/중국어 둘 다 있다`, admin.split(`${k}:`).length - 1 >= 2, "");
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
