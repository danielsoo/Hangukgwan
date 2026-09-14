// 메뉴를 고쳤는데 분류가 저절로 바뀌면 안 된다.
//
// 2026-09-14 사장님: "메뉴관리에서 메뉴수정하면 항목이 저절로 밥류로 바뀌어
// 저장됨."
//
// 밥류는 분류 목록의 **맨 앞**이다(src/seed.js, sort_order 1). 그게 단서였다.
//
// populateCategorySelect() 는 <option> 을 통째로 다시 만든다. 그러면 고른
// 것이 풀리고 맨 앞이 골라진다. 그리고 이 함수는 메뉴를 다시 불러올 때마다
// 도는데, 그 계기가 사장님과 상관없이 온다 — 품절이 풀릴 시각에 맞춘 알람,
// 다른 태블릿이 메뉴를 고쳤다는 실시간 알림, 품절 배지 저장, 언어 바꾸기.
//
// 수정 폼을 열어둔 채 그중 하나라도 오면, 손도 안 댄 분류가 밥류로 바뀐 채
// 저장된다. 폼을 오래 붙들고 있을수록 잘 걸린다.
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
process.env.SESSION_SECRET = "menu-category-keeps";
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

// 브라우저의 <select> 를 그대로 흉내낸다. 기대는 두 가지뿐이고 둘 다 표준이다.
//   1) <option> 을 통째로 갈아끼우면 고른 것이 풀리고 맨 앞이 골라진다
//   2) 목록에 없는 값을 .value 에 넣으면 아무것도 안 고른 상태가 된다("")
// 이 시험이 지키는 것은 그 둘이 아니라, 그 앞에서 **우리 코드가 고른 것을
// 지키는가** 다.
function fakeSelect() {
  return {
    options: [],
    _value: "",
    set innerHTML(html) {
      this.options = [...String(html).matchAll(/<option value="([^"]*)"/g)].map((m) => ({ value: m[1] }));
      this._value = this.options.length ? this.options[0].value : "";
    },
    get value() { return this._value; },
    set value(v) {
      const want = v == null ? "" : String(v);
      this._value = this.options.some((o) => o.value === want) ? want : "";
    },
    appendChild(o) { this.options.push(o); },
  };
}

const CATS = [{ id: 1, name_ko: "밥류" }, { id: 2, name_ko: "면류" }, { id: 3, name_ko: "찌개류" }];

function loadScreenCode(src, sel) {
  const from = src.indexOf("  function populateCategorySelect() {");
  const to = src.indexOf('  $("#addItemBtn").onclick');
  if (from < 0 || to <= from) return null;
  return new Function(
    "$", "categories", "catName", "document",
    `${src.slice(from, to)}
     return { populateCategorySelect, setCategorySelect };`
  )(() => sel, CATS, (c) => c.name_ko, { createElement: () => ({ value: "", textContent: "" }) });
}

(async () => {
  const src = fs.readFileSync(path.join(__dirname, "../public/js/admin.js"), "utf8");

  out.push("[수정 폼을 열어둔 채 메뉴가 다시 불러와진다]");
  const sel = fakeSelect();
  const api = loadScreenCode(src, sel);
  check("화면 쪽 코드를 찾는다", !!api, "populateCategorySelect 를 못 찾았다");
  if (!api) throw new Error("화면 쪽 코드를 못 찾았습니다.");

  api.populateCategorySelect();
  api.setCategorySelect(3); // 사장님이 찌개류인 메뉴를 연다
  check("연 메뉴의 분류가 찍힌다", sel.value === "3", sel.value);

  // 여기서 알람/실시간 알림이 온다. 사장님은 아무것도 안 눌렀다.
  api.populateCategorySelect();
  check("★ 다시 불러와도 고른 분류가 그대로다", sel.value === "3", `${sel.value} — 맨 앞(밥류)으로 바뀌었다면 1 이다`);

  api.populateCategorySelect();
  api.populateCategorySelect();
  check("★ 여러 번 와도 그대로다", sel.value === "3", sel.value);

  out.push("\n[없어진 분류에 매달린 옛 메뉴]");
  const sel2 = fakeSelect();
  const api2 = loadScreenCode(src, sel2);
  api2.populateCategorySelect();
  api2.setCategorySelect(99); // 지금 목록에 없는 분류
  check("★ 목록에 없어도 분류가 안 날아간다", sel2.value === "99", `${sel2.value} — 빈 값이면 저장할 때 분류가 통째로 날아간다`);

  out.push("\n[서버 — 숫자가 아니면 안 바꾼다]");
  const staff = request.agent(app);
  let r = await staff.post("/api/auth/login").send({ password: "ownerpass123" });
  check("로그인된다", r.status === 200, `${r.status}`);

  const item = store.menuItems.find((i) => i.category_id === 3) || store.menuItems[0];
  const before = item.category_id;
  const id = item.id;

  r = await staff.put(`/api/menu/admin/items/${id}`).send({ name_ko: "이름만 바꿈" });
  check("분류를 안 보내면 그대로다", r.status === 200 && r.body.category_id === before, `${before} -> ${r.body.category_id}`);

  r = await staff.put(`/api/menu/admin/items/${id}`).send({ category_id: "" });
  check("★ 빈 값이 와도 그대로다", r.status === 200 && r.body.category_id === before, `${before} -> ${r.body.category_id}`);

  r = await staff.put(`/api/menu/admin/items/${id}`).send({ category_id: null });
  check("★ null 이 와도 그대로다", r.status === 200 && r.body.category_id === before, `${before} -> ${r.body.category_id}`);

  const other = before === 2 ? 1 : 2;
  r = await staff.put(`/api/menu/admin/items/${id}`).send({ category_id: other });
  check("진짜로 바꿀 때는 바뀐다", r.status === 200 && r.body.category_id === other, `${r.body.category_id}`);

  r = await staff.put(`/api/menu/admin/items/${id}`).send({ category_id: String(before) });
  check("글자로 된 숫자도 받는다", r.status === 200 && r.body.category_id === before, `${r.body.category_id}`);

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
