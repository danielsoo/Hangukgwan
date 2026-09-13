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
// 줄줄이 보낸 두 번은 두 번어치다.
//
// 여기 적힌 숫자는 「이 정도까지는 봐준다」는 예산이다. 넘으면 어딘가에서
// 기다림이 하나 늘어난 것이고, 그건 가게 화면이 그만큼 느려졌다는 뜻이다.
//
// ── 깊이를 시계로 재면 안 된다 (2026-09-13) ─────────────────────────
//
// 처음에는 몽고 호출마다 같은 지연을 물리고 **전체 걸린 시간을 그 지연으로
// 나눠서** 깊이를 구했다. 그건 틀린 방법이었다.
//
// 다른 세션이 맥에서 이 시험이 깨진다고 알려왔다. 여기(클라우드)서는
// 통과했다. 같은 코드가 기계에 따라 갈린다는 뜻이다 — 재 보니 결산 탭이
// 「2.40번어치」였고, 한도는 2 였다. 2.50 만 넘으면 3 으로 반올림돼 실패한다.
// 기계가 조금만 느리면 넘어간다.
//
// 직접 원인은 `$nin` 커밋이었다. 질의를 하나 더 **나란히** 보내서 깊이는
// 그대로인데 걸린 시간만 늘었고, 그게 반올림 경계를 밀었다. 그렇다고 한도를
// 3 으로 올리면 시험이 아무것도 안 지킨다 — 진짜로 줄줄이 하나가 늘어도
// 통과하게 된다.
//
// 그래서 세는 방식으로 바꿨다. 그런데 **첫 시도도 틀렸다.** 「아무것도 안
// 돌고 있을 때 시작하면 새 묶음」으로 셌더니, 요청 내내 나란히 도는 호출이
// 하나만 있어도(기록을 내보내는 request_log.insertOne 이 그렇다) 「돌고 있는
// 게 없는 순간」이 영영 안 와서 전부 한 묶음이 됐다. 줄줄이로 되돌려 놓고
// 돌려 보니 그대로 통과했다 — **아무것도 안 지키는 시험**이었다.
//
// 지금 세는 것은 **그 호출이 몇 번째로 기다린 것인가**다. 어떤 호출이
// 시작할 때, 그 시점에 **이미 끝나 있던** 호출들 중 가장 깊은 것 + 1 이
// 그 호출의 깊이다. 전체 깊이는 그중 가장 큰 값이다.
//
//   나란히 둘: 둘 다 아무것도 안 끝난 때 시작 → 둘 다 1, 전체 1
//   줄줄이 둘: 뒤엣것은 앞엣것이 끝난 뒤 시작 → 2, 전체 2
//   내내 도는 것이 하나 끼어 있어도 위 계산은 안 흔들린다
//
// 기계 속도와도 무관하다. 지연을 다섯 배로 흔들어 놓고 돌려도 값이 같다.
//
// (지연은 남겨 둔다. 나란히 보낸 호출들이 확실히 겹치게 해서, 「먼저 것이
//  끝난 뒤에 다음 것이 시작」으로 잘못 세어지는 일을 막는다.)
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

const DELAY = 25;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ops = [];
let maxDepth = 0; // 제일 깊이 줄줄이 기다린 횟수
let doneDepths = []; // 이미 끝난 호출들의 깊이
const wrapped = new WeakSet();

// 이 호출은 몇 번째로 기다린 것인가 — 시작하는 그 시점에 **이미 끝나 있던**
// 호출들 중 가장 깊은 것 + 1. 내내 돌고 있는 호출이 끼어 있어도 안 흔들린다.
async function timed(name, run) {
  ops.push(name);
  const mine = (doneDepths.length ? Math.max(...doneDepths) : 0) + 1;
  if (mine > maxDepth) maxDepth = mine;
  try {
    await sleep(DELAY);
    return await run();
  } finally {
    doneDepths.push(mine);
  }
}

// 몽고 호출 하나하나에 같은 지연을 물린다. fake-mongo 는 컬렉션 객체를
// 재사용하므로, 같은 객체를 두 번 감싸면 지연도 두 겹이 된다 — WeakSet 으로
// 막는다. (이걸 빠뜨려서 처음 잰 값이 실제의 여덟 배로 나왔다.)
function instrument(handle) {
  const real = handle.collection.bind(handle);
  handle.collection = (name) => {
    const col = real(name);
    if (wrapped.has(col)) return col;
    wrapped.add(col);
    for (const m of ["findOne", "insertOne", "updateOne", "replaceOne", "deleteOne", "bulkWrite", "countDocuments", "updateMany", "findOneAndUpdate", "estimatedDocumentCount", "indexes"]) {
      if (typeof col[m] === "function") {
        const r = col[m].bind(col);
        col[m] = (...a) => timed(`${name}.${m}`, () => r(...a));
      }
    }
    const rf = col.find.bind(col);
    col.find = (...a) => {
      const cur = rf(...a);
      const rt = cur.toArray.bind(cur);
      cur.toArray = () => timed(`${name}.find`, () => rt());
      return cur;
    };
    return col;
  };
}

async function depthOf(fn) {
  ops = [];
  maxDepth = 0;
  doneDepths = [];
  const res = await fn();
  return { depth: maxDepth, calls: ops.length, status: res && res.status, ops: ops.slice() };
}

(async () => {
  await db.connectDB();
  const boss = request.agent(app);
  await boss.post("/api/auth/login").send({ password: "ownerpass123" });
  // 이 파일은 화면 동작의 왕복 깊이를 재는 시험이다. 실행 시각이 오후 자동
  // 정산 시각을 지났으면 주문 GET이 하루 한 번짜리 정산 작업을 백그라운드로
  // 시작해 다음 항목의 계측에 섞인다. 그 기능 자체는 auto-am-close.test.js가
  // 따로 재므로, 여기서는 오늘 확인이 끝난 상태로 고정한다.
  const { AUTO_AM_DONE_SETTING } = require("../src/routes/settlements");
  db.store.settings[AUTO_AM_DONE_SETTING] = require("../src/time").taipeiDateString();
  instrument(db.getDb());

  // 예산. 「이만큼까지는 기다려도 된다」 — 넘으면 무언가 줄줄이 늘어난 것이다.
  const budget = [
    ["주문판을 연다        GET /api/orders", 1, () => boss.get("/api/orders")],
    ["결제 탭을 연다       GET /api/zones", 1, () => boss.get("/api/zones")],
    ["결산 탭을 연다       GET /api/settlements", 2, () => boss.get("/api/settlements?start=2026-09-01&end=2026-09-12")],
    ["로그인               GET /api/bootstrap", 4, () => boss.get("/api/bootstrap")],
  ];

  // 인스턴스가 막 뜬 순간에는 store 문서를 한 번 통째로 받는다(판 번호를
  // 아직 모르니까). 그 뒤로는 판 번호 한 칸만 묻는다 — 운영에서 그 차이가
  // 9ms 대 394ms 다(src/db.js STORE_REV). 아래 예산은 **장사 중의 값**,
  // 즉 이미 한 번 받아 둔 인스턴스의 값이라 여기서 한 번 덥힌다.
  await boss.get("/api/zones");

  out.push("\n[같은 것을 또 받지 않는다]");
  {
    const r = await depthOf(() => boss.get("/api/zones"));
    const fullStoreReads = r.ops.filter((o) => o === "store.findOne").length;
    check(
      "★ 두 번째 요청은 store 문서를 다시 받지 않는다",
      r.status === 200 && fullStoreReads <= 1,
      `store 읽기 ${fullStoreReads}번 (호출 ${r.calls}: ${r.ops.join(", ")})`
    );
  }

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
