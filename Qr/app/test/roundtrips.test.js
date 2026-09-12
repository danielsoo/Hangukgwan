// 동작 하나에 몽고를 몇 번 **줄줄이** 기다리나.
//
// 2026-09-12 사장님: "결제 탭, 결산 탭 들어가는 거 메뉴 수정하는 거 결제
// 완료 누르는 거 이런 게 너무 오래 걸려. 애초에 몽고디비에 저장하면서
// 왔다갔다 하는건데 이렇게 오래 걸릴 이유가 전혀 없잖아."
//
// 맞는 말이라, 재 봤다. 화면이 기다리는 시간은 거의 전부 「몽고 왕복 × 몇
// 번」이다. 대만에서 서울까지 한 왕복이 수십 ms 이므로, 다섯 번이면 그것만
// 으로 수백 ms 가 된다. 줄일 수 있는 것은 **횟수**뿐이다.
//
// 그래서 개수가 아니라 **깊이**를 잰다. 나란히 보낸 다섯 번은 한 번어치고,
// 줄줄이 보낸 두 번은 두 번어치다. 몽고 호출마다 같은 지연을 물려 놓고 전체
// 걸린 시간을 그 지연으로 나누면 그 깊이가 나온다.
//
// 여기 적힌 숫자는 「이 정도까지는 봐준다」는 예산이다. 넘으면 어딘가에서
// 기다림이 하나 늘어난 것이고, 그건 가게 화면이 그만큼 느려졌다는 뜻이다.
//
// (세션 조회는 여기 안 잡힌다 — connect-mongo 는 자기 연결을 따로 들고
// 있어서 이 계측기가 못 본다. 실제로는 아래 숫자마다 1을 더 보태야 한다.)
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
process.env.SESSION_SECRET = "roundtrips";
process.env.ADMIN_PASSWORD = "ownerpass123";

const request = require("supertest");
const app = require("../server");
const db = require("../src/db");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const DELAY = 40;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ops = [];
const wrapped = new WeakSet();

// 몽고 호출 하나하나에 같은 지연을 물린다. fake-mongo 는 컬렉션 객체를
// 재사용하므로, 같은 객체를 두 번 감싸면 지연도 두 겹이 된다 — WeakSet 으로
// 막는다. (이걸 빠뜨려서 처음 잰 값이 실제의 여덟 배로 나왔다.)
function instrument(handle) {
  const real = handle.collection.bind(handle);
  handle.collection = (name) => {
    const col = real(name);
    if (wrapped.has(col)) return col;
    wrapped.add(col);
    for (const m of ["findOne", "insertOne", "updateOne", "replaceOne", "deleteOne", "bulkWrite", "countDocuments", "updateMany", "findOneAndUpdate"]) {
      if (typeof col[m] === "function") {
        const r = col[m].bind(col);
        col[m] = async (...a) => { ops.push(`${name}.${m}`); await sleep(DELAY); return r(...a); };
      }
    }
    const rf = col.find.bind(col);
    col.find = (...a) => {
      const cur = rf(...a);
      const rt = cur.toArray.bind(cur);
      cur.toArray = async () => { ops.push(`${name}.find`); await sleep(DELAY); return rt(); };
      return cur;
    };
    return col;
  };
}

async function depthOf(fn) {
  ops = [];
  const t0 = Date.now();
  const res = await fn();
  const ms = Date.now() - t0;
  return { depth: Math.round(ms / DELAY), calls: ops.length, status: res && res.status, ops: ops.slice() };
}

(async () => {
  await db.connectDB();
  const boss = request.agent(app);
  await boss.post("/api/auth/login").send({ password: "ownerpass123" });
  instrument(db.getDb());

  // 예산. 「이만큼까지는 기다려도 된다」 — 넘으면 무언가 줄줄이 늘어난 것이다.
  const budget = [
    ["주문판을 연다        GET /api/orders", 1, () => boss.get("/api/orders")],
    ["결제 탭을 연다       GET /api/zones", 1, () => boss.get("/api/zones")],
    ["결산 탭을 연다       GET /api/settlements", 2, () => boss.get("/api/settlements?start=2026-09-01&end=2026-09-12")],
    ["로그인               GET /api/bootstrap", 4, () => boss.get("/api/bootstrap")],
  ];

  out.push("\n[화면을 여는 동작 — 몽고를 줄줄이 몇 번 기다리나]");
  for (const [label, max, fn] of budget) {
    const r = await depthOf(fn);
    check(`${label} ≤ ${max}`, r.status === 200 && r.depth <= max, `${r.depth}회 (호출 ${r.calls}: ${r.ops.join(", ")})`);
  }

  out.push("\n[쓰는 동작]");
  const menu = (await boss.get("/api/menu/admin")).body;
  const item = Array.isArray(menu) ? menu[0] : (menu && menu.items || [])[0];
  check("메뉴 항목이 하나는 있다 (아래 측정의 전제)", !!item);
  if (item) {
    const r = await depthOf(() => boss.put(`/api/menu/admin/items/${item.id}`).send({ ...item }));
    check(
      "메뉴를 고친다        PUT /api/menu/admin/items/:id ≤ 2",
      r.status === 200 && r.depth <= 2,
      `${r.depth}회 (호출 ${r.calls}: ${r.ops.join(", ")})`
    );
    // 같은 요청 안에서 store 문서를 두 번 읽지 않는다. 미들웨어가 방금
    // 읽었는데 저장 직전에 또 읽던 것을 없앴다(src/db.js refreshAndSave).
    const storeReads = r.ops.filter((o) => o === "store.findOne").length;
    check("★ 같은 요청에서 store 문서를 두 번 읽지 않는다", storeReads <= 1, `${storeReads}번`);
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.log(out.join("\n"));
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
