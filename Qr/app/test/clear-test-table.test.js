// 「T」 자리에 쌓인 시험 기록을 비우는 기능.
//
// 2026-09-17 사장님: "테스터 모드를 안 키고 만든 테스터 테이블은 지워지는
// 기능이 따로 없어서 만들어야 할 것 같아."
//
// ── 왜 따로 필요한가 ─────────────────────────────────────────────────
//
// 테스터 모드의 「종료」는 deleteMany({test_session: cur.id}) 다. 그 세션의
// id 를 가진 것만 지운다. 그런데 T 자리의 주문에는 **늘 켜져 있는 가짜 세션
// id**("test_table")가 박힌다 — 그래야 테스터 모드를 껐다 켜도 그 자리가
// 계속 시험용으로 남기 때문이다.
//
// 그 설계의 대가가 이것이다: 종료가 그 기록을 절대 안 지운다. 결산에도 지난
// 기록에도 안 나오니 눈에 안 띌 뿐, 데이터베이스에는 영영 쌓인다.
//
// ── 이 시험이 지키는 선 ──────────────────────────────────────────────
//
// 지우는 기능이라 **잘못 지우면 되돌릴 수 없다.** 그래서 두 가지를 잰다:
//  1) 시험 기록은 결제완료든 아니든 전부 지워지는가
//  2) 진짜 장사 기록은 **한 건도** 안 지워지는가 ← 이쪽이 더 중요하다
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
process.env.SESSION_SECRET = "clear-test-table";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.STAFF_PASSWORD = "staffpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const request = require("supertest");
const app = require("../server");
const { store, getDb, connectDB } = require("../src/db");
const testMode = require("../src/testMode");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const T = testMode.TEST_TABLE_NUMBER;

(async () => {
  const boss = request.agent(app);
  let r = await boss.post("/api/auth/login").send({ password: "ownerpass123" });
  check("사장님 로그인", r.status === 200, `${r.status}`);
  await require("./disable-order-hours")();

  const item = store.menuItems.find((m) => m.available && m.price > 0 && m.category_id === store.categories[0].id);
  const guest = request.agent(app);

  async function orderAt(table, qty) {
    const res = await guest.post("/api/orders").send({
      tableNumber: String(table),
      items: [{ itemId: item.id, qty, orderType: "dine_in", addons: [] }],
    });
    if (res.status !== 201) throw new Error(`주문 실패 ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.id;
  }

  // 시험용 자리에 세 건 — 그 중 하나는 결제까지 끝낸다.
  const t1 = await orderAt(T, 1);
  const t2 = await orderAt(T, 2);
  const t3 = await orderAt(T, 1);
  r = await boss.patch(`/api/orders/${t3}`).send({ status: "paid", paymentMethod: "cash" });
  check("시험 주문 하나는 결제까지 끝냈다", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);

  // 진짜 자리에도 하나 — 이건 절대 안 지워져야 한다.
  await guest.put("/api/tables/9/party-size").send({ adults: 2, children: 0 });
  const real = await orderAt(9, 2);

  out.push("[쌓인 것을 세어준다]");
  r = await boss.get("/api/test-mode/test-table");
  check("★ 몇 건인지 물어볼 수 있다", r.status === 200, `${r.status}`);
  check("★ 시험 주문 셋을 센다", r.body.orders === 3, JSON.stringify(r.body));
  check("★ 합계도 준다 — 확인 창이 이 숫자를 쓴다", r.body.total >= 3, JSON.stringify(r.body));

  out.push("\n[사장님만 지울 수 있다]");
  {
    store.settings.staff_password_hash = bcrypt.hashSync("staffpass123", 10);
    const staff = request.agent(app);
    const login = await staff.post("/api/auth/login").send({ password: "staffpass123" });
    check("직원으로 로그인된다", login.status === 200, `${login.status}`);
    // requireOwner 는 401 + {error:"owner_only"} 로 막는다(src/auth.js).
    const denied = await staff.delete("/api/test-mode/test-table");
    check("★ 직원은 못 지운다", denied.status === 401 && denied.body.error === "owner_only", `${denied.status} ${JSON.stringify(denied.body)}`);
    const peek = await staff.get("/api/test-mode/test-table");
    check("★ 세어보는 것도 막는다", peek.status === 401, `${peek.status}`);
    check("★ 막힌 뒤에도 기록은 그대로", store.orders.filter(testMode.isTestTableRow).length === 3, "");
  }

  out.push("\n[지운다]");
  r = await boss.delete("/api/test-mode/test-table");
  check("★ 지워진다", r.status === 200 && r.body.ok === true, `${r.status} ${JSON.stringify(r.body)}`);
  check("★ 주문 셋을 지웠다고 답한다", r.body.deleted && r.body.deleted.orders === 3, JSON.stringify(r.body.deleted));

  await connectDB();
  const left = await getDb().collection("orders").find({}).toArray();
  const leftIds = left.map((o) => o.id);
  check("★ 시험 주문이 정말로 없어졌다", !leftIds.includes(t1) && !leftIds.includes(t2), JSON.stringify(leftIds));
  check("★ 결제완료된 시험 주문도 같이 지운다", !leftIds.includes(t3), "그게 이 버튼의 뜻이다");
  check("★ 진짜 장사 기록은 그대로 있다", leftIds.includes(real), JSON.stringify(leftIds));
  check("★ 화면이 들고 있던 사본도 비었다", store.orders.filter(testMode.isTestTableRow).length === 0, "");
  check("★ 진짜 주문은 화면 사본에도 남아 있다", store.orders.some((o) => o.id === real), "");

  out.push("\n[자리의 인원수도 같이 비운다]");
  // 주문과 인원은 하나의 세트다. 주문만 지우고 인원을 남기면 아무도 없는
  // 자리에 「2인」이 뜬 채로 남는다.
  {
    await guest.put(`/api/tables/${T}/party-size`).send({ adults: 3, children: 1 });
    await orderAt(T, 1);
    const seated = store.tables.find((x) => String(x.number) === T);
    check("앉혀놨다", seated && seated.party_size === 4, `${seated && seated.party_size}`);
    const res = await boss.delete("/api/test-mode/test-table");
    check("지워진다", res.status === 200, `${res.status}`);
    const after = store.tables.find((x) => String(x.number) === T);
    check("★ 인원수가 비었다", !after.party_size, `${after.party_size}`);
    check("★ 진짜 자리의 인원수는 안 건드린다", (store.tables.find((x) => String(x.number) === "9") || {}).party_size === 2, "");
  }

  out.push("\n[빈 상태에서 눌러도 안 터진다]");
  r = await boss.delete("/api/test-mode/test-table");
  check("★ 두 번 눌러도 200", r.status === 200 && r.body.deleted.orders === 0, `${r.status} ${JSON.stringify(r.body)}`);

  out.push("\n[테스터 모드의 「종료」와 섞이지 않는다]");
  {
    // 진짜 테스터 세션이 만든 기록에는 ts_… id 가 박힌다. 이 버튼은 그것을
    // 안 건드린다 — 그건 「종료」의 몫이다.
    await connectDB();
    await getDb().collection("orders").insertOne({ _id: 990001, id: 990001, table_number: "12", test_session: "ts_deadbeefdeadbeefdead", items: [], total: 0, created_at: "2026-09-17 12:00:00", status: "served" });
    const res = await boss.delete("/api/test-mode/test-table");
    check("지우기가 돈다", res.status === 200, `${res.status}`);
    const still = await getDb().collection("orders").findOne({ _id: 990001 });
    check("★ 진짜 테스터 세션 기록은 그대로 둔다", !!still, "그건 「종료」가 지운다");
  }

  out.push("\n[화면에 버튼이 있다]");
  {
    const admin = fs.readFileSync(path.join(__dirname, "../public/js/admin.js"), "utf8");
    check("★ 시험용 자리에서만 보인다", /isTestTable\(table\) && currentRole === "owner"[\s\S]{0,160}clearTestTableBtn/.test(admin), "진짜 자리에 뜨면 큰일난다");
    check("★ 사장님에게만 보인다", /currentRole === "owner"[\s\S]{0,160}clearTestTableBtn/.test(admin), "");
    check("★ 몇 건인지 세어서 물어본다", /clearTestTableConfirm"\)\.replace\("\{n\}"/.test(admin), "「되돌릴 수 없다」는 숫자를 보고 결정해야 한다");
    check("★ 0 건이면 묻지 않는다", /if \(!n\) \{[\s\S]{0,140}clearTestTableEmpty/.test(admin), "");
    const ko = admin.indexOf('clearTestTableBtn: "🧹 시험 기록 전부 지우기"');
    const zh = admin.indexOf('clearTestTableBtn: "🧹 清除全部測試紀錄"');
    check("두 언어 다 있다", ko > 0 && zh > 0, `${ko}, ${zh}`);
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log(out.join("\n"));
  console.error(e);
  process.exit(1);
});
