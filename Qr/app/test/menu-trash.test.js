// 지운 메뉴는 없어지지 않고 휴지통으로 간다.
//
// 2026-09-15 사장님: "삭제는 휴지통을 하나 만들어서 복원 버튼을 만들어줬으면
// 좋겠어." 그 앞에: "잘못 삭제해서 같은 메뉴를 다시등록하거나 할 때 오류가
// 있을 것 같아서."
//
// 걱정이 맞았다. 지우고 다시 등록하면 새 번호를 받는데, 결산은 메뉴를
// **번호로** 묶는다(src/settlement.js). 그래서 같은 메뉴가 결산에서 두 줄로
// 갈라지고 추이가 끊긴다. 번호를 살려두면 그 일이 없다.
//
// 그리고 예전 삭제는 store 문서를 **다시 읽지 않고 통째로** 덮어썼다. 그
// 사이 다른 태블릿이 고친 것이 되살아날 수 있었다 — 2026-09-10 인원수
// 사고와 같은 모양이다.
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
process.env.SESSION_SECRET = "menu-trash";
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
const flat = (cats) => cats.flatMap((c) => c.items || []);

(async () => {
  const staff = request.agent(app);
  let r = await staff.post("/api/auth/login").send({ password: "ownerpass123" });
  check("로그인된다", r.status === 200, `${r.status}`);
  await require("./disable-order-hours")();

  const target = store.menuItems.find((m) => m.available);
  const id = target.id;
  const beforeCount = store.menuItems.length;

  out.push("\n[지우면 휴지통으로 간다]");
  r = await staff.delete(`/api/menu/admin/items/${id}`);
  check("지워진다", r.status === 200, `${r.status}`);
  check("★ 메뉴가 없어지지 않는다 (번호가 남는다)", store.menuItems.length === beforeCount, `${beforeCount} -> ${store.menuItems.length}`);
  check("★ 버린 표가 찍힌다", !!store.menuItems.find((m) => m.id === id).deleted_at, "");

  out.push("\n[어디에도 안 보인다]");
  r = await staff.get("/api/menu/admin");
  check("★ 메뉴 관리 목록에서 빠진다", !flat(r.body).some((i) => i.id === id), "");
  r = await request(app).get("/api/menu");
  check("★ 손님 화면에서도 빠진다", !flat(r.body).some((i) => i.id === id), "");

  out.push("\n[주소를 알아도 주문이 안 된다]");
  const guest = request.agent(app);
  await guest.put("/api/tables/7/party-size").send({ adults: 2, children: 0 });
  r = await guest.post("/api/orders").send({
    tableNumber: "7",
    items: [{ itemId: id, qty: 1, orderType: "dine_in", addons: [] }],
  });
  check("★ 지운 메뉴만 담으면 주문이 안 들어간다", r.status === 400, `${r.status} ${JSON.stringify(r.body)}`);

  out.push("\n[휴지통 목록]");
  r = await staff.get("/api/menu/admin/trash");
  check("휴지통에 있다", r.status === 200 && r.body.some((m) => m.id === id), JSON.stringify(r.body.map((m) => m.id)));
  const row = r.body.find((m) => m.id === id);
  check("이름과 값을 같이 준다", !!row && row.name_ko != null && row.price != null, JSON.stringify(row));
  check("버린 날을 준다", !!row.deleted_at, "");

  out.push("\n[되살리면 번호가 그대로다]");
  r = await staff.post(`/api/menu/admin/items/${id}/restore`);
  check("되살아난다", r.status === 200, `${r.status}`);
  check("★ 번호가 같다 — 결산이 안 갈라진다", r.body.id === id, `${r.body.id} vs ${id}`);
  r = await staff.get("/api/menu/admin");
  check("★ 목록에 다시 보인다", flat(r.body).some((i) => i.id === id), "");
  r = await staff.get("/api/menu/admin/trash");
  check("휴지통에서 빠진다", !r.body.some((m) => m.id === id), JSON.stringify(r.body.map((m) => m.id)));

  r = await guest.post("/api/orders").send({
    tableNumber: "7",
    items: [{ itemId: id, qty: 1, orderType: "dine_in", addons: [] }],
  });
  check("★ 되살리면 다시 주문된다", r.status === 201, `${r.status} ${JSON.stringify(r.body)}`);

  out.push("\n[없는 메뉴]");
  r = await staff.delete("/api/menu/admin/items/999999");
  check("없는 것을 지우면 404", r.status === 404, `${r.status}`);
  r = await staff.post("/api/menu/admin/items/999999/restore");
  check("없는 것을 되살리면 404", r.status === 404, `${r.status}`);

  out.push("\n[통째로 덮어쓰지 않는다]");
  const menu = fs.readFileSync(path.join(__dirname, "../src/routes/menu.js"), "utf8");
  const del = menu.slice(menu.indexOf('router.delete("/admin/items/:id"'));
  check(
    "★ 지울 때 저장 직전에 다시 읽는다",
    /refreshAndSave\(/.test(del.slice(0, 700)),
    "save() 로 통째로 덮어쓰면 다른 태블릿이 방금 고친 것이 되살아난다"
  );
  check(
    "배열에서 빼지 않는다",
    !/store\.menuItems = store\.menuItems\.filter/.test(menu),
    "번호가 사라지면 결산이 갈라진다"
  );

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
