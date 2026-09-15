// 메뉴를 고치거나 새로 넣을 때 조용히 망가지지 않게 하는 장치들.
//
// 2026-09-15 사장님: "메뉴가 삭제되거나 수정되거나 업데이트 될 떄 문제가
// 생기지 않게 보안장치를 넣자는 거야."
//
// 여기서 막는 것은 전부 **저장됐다고 믿고 넘어가는** 종류다.
//
//   · 이름이 비면 손님 화면에 빈 줄이 뜬다
//   · 가격이 숫자가 아니면 그 뒤의 금액이 전부 NaN 이 된다
//   · 없는 분류로 저장하면 어느 분류에도 안 걸려 목록에서 **사라진다**
//     (categoriesWithItems 가 분류별로 그린다). 지운 것도 아닌데 없어진다.
//   · 코드가 겹치면 주방 빌지에 똑같이 「77」로 찍히는 서로 다른 메뉴가 생긴다
//   · 휴지통에 있는 것을 고치면 안 보이는 메뉴를 고친 게 된다
//
// 그리고 화면이 **거절을 봐야** 한다. 이 파일을 쓰기 전 admin.js 는 응답을
// 아예 안 봤다 — 서버가 막아도 창이 닫히고 목록을 다시 불러오니, 사장님
// 눈에는 고친 것이 그냥 사라진 것으로 보인다. 서버만 막고 화면이 모르면
// 오히려 전보다 나빠진다.
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
process.env.SESSION_SECRET = "menu-safeguards";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const fs = require("fs");
const path = require("path");
const request = require("supertest");
const app = require("../server");
const { store } = require("../src/db");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}
const byId = (id) => store.menuItems.find((m) => m.id === id);

(async () => {
  const staff = request.agent(app);
  let r = await staff.post("/api/auth/login").send({ password: "ownerpass123" });
  check("로그인된다", r.status === 200, `${r.status}`);

  const cat = store.categories[0];
  const freeCode = "ZZ9";
  const base = { category_id: cat.id, name_zh: "테스트메뉴", price: 100 };
  const countBefore = store.menuItems.length;

  out.push("\n[새로 넣을 때 — 막아야 하는 것들]");
  r = await staff.post("/api/menu/admin/items").send({ ...base, name_zh: "   " });
  check("★ 이름이 공백뿐이면 거절한다", r.status === 400, `${r.status} ${JSON.stringify(r.body)}`);
  r = await staff.post("/api/menu/admin/items").send({ ...base, price: -5 });
  check("★ 음수 가격은 거절한다", r.status === 400 && r.body.error === "invalid_price", `${r.status} ${JSON.stringify(r.body)}`);
  r = await staff.post("/api/menu/admin/items").send({ ...base, price: "비쌈" });
  check("★ 숫자가 아닌 가격은 거절한다 — 금액이 NaN 이 된다", r.status === 400 && r.body.error === "invalid_price", `${r.status} ${JSON.stringify(r.body)}`);
  r = await staff.post("/api/menu/admin/items").send({ ...base, category_id: 999999 });
  check("★ 없는 분류는 거절한다 — 목록에서 사라진다", r.status === 400 && r.body.error === "invalid_category", `${r.status} ${JSON.stringify(r.body)}`);
  r = await staff.post("/api/menu/admin/items").send({ ...base, original_price: -1 });
  check("음수 정가는 거절한다", r.status === 400 && r.body.error === "invalid_original_price", `${r.status} ${JSON.stringify(r.body)}`);
  r = await staff.post("/api/menu/admin/items").send({ ...base, min_first_order_qty: -2 });
  check("음수 최소주문수량은 거절한다", r.status === 400 && r.body.error === "invalid_min_first_order_qty", `${r.status} ${JSON.stringify(r.body)}`);
  check("★ 거절된 것은 하나도 안 들어갔다", store.menuItems.length === countBefore, `${countBefore} -> ${store.menuItems.length}`);

  out.push("\n[0원은 막지 않는다 — 서비스 메뉴가 있다]");
  r = await staff.post("/api/menu/admin/items").send({ ...base, name_zh: "서비스", price: 0 });
  check("0원은 통과한다", r.status === 201, `${r.status} ${JSON.stringify(r.body)}`);
  const freeId = r.body.id;

  out.push("\n[번호는 데이터베이스가 준다]");
  r = await staff.post("/api/menu/admin/items").send({ ...base, name_zh: "첫번째", code: freeCode });
  check("들어간다", r.status === 201, `${r.status} ${JSON.stringify(r.body)}`);
  const firstId = r.body.id;
  r = await staff.post("/api/menu/admin/items").send({ ...base, name_zh: "두번째" });
  const secondId = r.body.id;
  check("★ 번호가 겹치지 않는다", firstId !== secondId && firstId !== freeId, `${freeId}/${firstId}/${secondId}`);
  const menuSrc = fs.readFileSync(path.join(__dirname, "../src/routes/menu.js"), "utf8");
  const postSrc = menuSrc.slice(menuSrc.indexOf('router.post("/admin/items"'), menuSrc.indexOf('router.put("/admin/items/:id"'));
  check(
    "★ 메모리 ++ 가 아니라 reserveId 로 받는다",
    /reserveId\(\s*"menuItems"/.test(postSrc) && !/id:\s*nextId\(/.test(postSrc),
    "인스턴스가 둘이면 같은 번호를 두 번 준다 — 결산이 두 메뉴를 한 줄로 합친다"
  );

  out.push("\n[코드 중복 — 빌지에 같은 번호로 찍히는 일]");
  r = await staff.post("/api/menu/admin/items").send({ ...base, name_zh: "겹침", code: freeCode });
  check("★ 같은 코드로 새로 넣으면 거절한다", r.status === 409 && r.body.error === "code_taken", `${r.status} ${JSON.stringify(r.body)}`);
  check("★ 어느 메뉴가 쓰고 있는지 알려준다", r.body.itemId === firstId, `${r.body.itemId} vs ${firstId}`);
  r = await staff.put(`/api/menu/admin/items/${secondId}`).send({ code: freeCode });
  check("★ 수정으로 겹치게 만드는 것도 거절한다", r.status === 409 && r.body.error === "code_taken", `${r.status} ${JSON.stringify(r.body)}`);
  check("거절됐으면 안 바뀐다", (byId(secondId).code || "") !== freeCode, `${byId(secondId).code}`);
  r = await staff.put(`/api/menu/admin/items/${firstId}`).send({ code: freeCode, name_ko: "이름만 고침" });
  check("★ 자기가 쓰던 코드 그대로면 통과한다 — 상관없는 수정이 막히면 안 된다", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
  check("수정이 실제로 들어갔다", byId(firstId).name_ko === "이름만 고침", `${byId(firstId).name_ko}`);

  out.push("\n[고칠 때 — 보내온 칸만 본다]");
  const before = { ...byId(secondId) };
  r = await staff.put(`/api/menu/admin/items/${secondId}`).send({ price: -1 });
  check("★ 음수 가격은 거절한다", r.status === 400 && r.body.error === "invalid_price", `${r.status} ${JSON.stringify(r.body)}`);
  check("★ 거절되면 값이 그대로다", byId(secondId).price === before.price, `${byId(secondId).price} vs ${before.price}`);
  r = await staff.put(`/api/menu/admin/items/${secondId}`).send({ name_zh: "" });
  check("★ 이름을 비우는 것은 거절한다", r.status === 400 && r.body.error === "name_required", `${r.status} ${JSON.stringify(r.body)}`);
  check("이름이 그대로다", byId(secondId).name_zh === before.name_zh, `${byId(secondId).name_zh}`);
  r = await staff.put(`/api/menu/admin/items/${secondId}`).send({ category_id: 999999 });
  check("★ 없는 분류로 옮기는 것은 거절한다", r.status === 400 && r.body.error === "invalid_category", `${r.status} ${JSON.stringify(r.body)}`);
  check("분류가 그대로다", byId(secondId).category_id === before.category_id, `${byId(secondId).category_id}`);
  // 빈 분류는 거절하지 않는다 — 화면에서 고른 것이 풀렸을 뿐일 수 있다
  // (2026-09-14 「저절로 밥류로 바뀜」). 그때는 지금 분류를 그대로 둔다.
  // 여기서 막으면 멀쩡한 수정까지 못 하게 된다.
  r = await staff.put(`/api/menu/admin/items/${secondId}`).send({ category_id: "" });
  check("★ 빈 분류는 막지 않고 지금 분류를 그대로 둔다", r.status === 200 && r.body.category_id === before.category_id, `${r.status} ${r.body.category_id} vs ${before.category_id}`);
  r = await staff.put(`/api/menu/admin/items/${secondId}`).send({ name_ko: "값만 고침" });
  check("이름만 보내는 수정은 통과한다 — 가격/분류를 안 보냈다고 막으면 안 된다", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);

  out.push("\n[휴지통에 있는 것은 못 고친다]");
  r = await staff.delete(`/api/menu/admin/items/${secondId}`);
  check("버렸다", r.status === 200, `${r.status}`);
  r = await staff.put(`/api/menu/admin/items/${secondId}`).send({ name_ko: "안 보이는데 고침" });
  check("★ 버린 메뉴를 고치면 거절한다", r.status === 409 && r.body.error === "item_in_trash", `${r.status} ${JSON.stringify(r.body)}`);
  check("★ 고쳐지지 않았다", byId(secondId).name_ko !== "안 보이는데 고침", `${byId(secondId).name_ko}`);
  r = await staff.post("/api/menu/admin/items").send({ ...base, name_zh: "코드재사용", code: String(byId(secondId).code || "") || undefined });
  check("버린 것과는 코드가 안 겹친 것으로 친다", r.status === 201, `${r.status} ${JSON.stringify(r.body)}`);

  out.push("\n[화면이 거절을 본다]");
  const admin = fs.readFileSync(path.join(__dirname, "../public/js/admin.js"), "utf8");
  const saveIdx = admin.indexOf("/api/menu/admin/items`, {");
  const saveSrc = saveIdx > 0 ? admin.slice(saveIdx, saveIdx + 1600) : "";
  check(
    "★ 저장 응답의 res.ok 를 본다",
    /if\s*\(\s*!res\.ok\s*\)/.test(saveSrc),
    "응답을 안 보면 서버가 막아도 창이 닫힌다 — 고친 것이 사라진 것처럼 보인다"
  );
  check(
    "★ 거절되면 창을 닫지 않는다",
    /if\s*\(\s*!res\.ok\s*\)[\s\S]{0,400}?return;/.test(saveSrc) &&
      saveSrc.indexOf("itemModalBackdrop") > saveSrc.search(/if\s*\(\s*!res\.ok\s*\)/),
    "창이 닫히면 고친 내용을 다시 처음부터 넣어야 한다"
  );
  check(
    "이유를 사장님 말로 옮긴다",
    /function menuSaveErrorMsg/.test(admin) && /menuErrCodeTaken/.test(admin),
    ""
  );
  for (const key of ["menuErrCodeTaken", "menuErrPrice", "menuErrCategory", "menuErrInTrash", "menuErrSaveFailed"]) {
    const hits = admin.split(`${key}:`).length - 1;
    check(`${key} 가 한국어/중국어 둘 다 있다`, hits >= 2, `${hits}`);
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
