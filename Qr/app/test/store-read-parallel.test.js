// 매 요청이 치르는 읽기 — 두 번을 나란히 보내는가.
//
// 2026-09-12 사장님: "로그인도 그렇고 버튼 누르는 것도 그렇고 다" 느리다.
//
// refreshStore() 는 /api/* 요청 **하나하나가 전부** 거치는 자리다. 여기서
// 몽고 왕복이 두 번 줄줄이 일어나면, 화면에 보이는 모든 동작이 그 두 번을
// 다 기다린다. 나란히 보내면 한 번 값으로 끝난다.
//
// 순서대로 해야 할 이유가 하나 있었다 — 주문을 고르는 조건에 영업 시작
// 시각이 들어가는데 그 값이 방금 읽어온 store 안에 있다. 그래서 「먼저
// store, 다음 주문」이었다. 그 값은 하루에 한 번 바뀌므로, 지금 들고 있는
// 값으로 같이 쏘고 **정말 바뀌었을 때만** 주문을 다시 읽는다.
//
// 이 테스트가 지키는 것은 두 가지다. 빨라졌나, 그리고 **틀린 목록이
// 나가지는 않나.** 뒤엣것을 놓치면 영업 시작 직후 테스트 주문이 손님
// 주문 목록에 섞여 나온다.
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

const db = require("../src/db");
const { store, connectDB, refreshStore, getDb, ORDERS_COLLECTION } = db;

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 두 읽기에 같은 지연을 물려 놓고 전체가 얼마나 걸리는지 본다. 줄줄이면
// 두 배, 나란히면 한 배다.
const DELAY = 60;
function instrument(handle) {
  const log = [];
  const realCollection = handle.collection.bind(handle);
  handle.collection = (name) => {
    const col = realCollection(name);
    const realFindOne = col.findOne.bind(col);
    const realFind = col.find.bind(col);
    col.findOne = async (...args) => {
      log.push({ what: `${name}.findOne`, at: Date.now() });
      await sleep(DELAY);
      return realFindOne(...args);
    };
    col.find = (...args) => {
      const cur = realFind(...args);
      const realToArray = cur.toArray.bind(cur);
      cur.toArray = async () => {
        log.push({ what: `${name}.find`, at: Date.now() });
        await sleep(DELAY);
        return realToArray();
      };
      return cur;
    };
    return col;
  };
  return log;
}

(async () => {
  await connectDB();
  const handle = getDb();
  await handle.collection("store").updateOne(
    { _id: "main" },
    { $set: { settings: {}, menuItems: [], tables: [] } },
    { upsert: true }
  );
  // created_at 과 영업 시작 시각은 둘 다 대만 시각 "YYYY-MM-DD HH:MM:SS"
  // 문자열이다(src/serviceStart.js). 다른 모양으로 넣으면 조건이 조용히
  // 꺼져서 테스트가 통과해 버린다.
  const AFTER = "2026-09-12 18:00:00";
  const BEFORE = "2026-09-12 08:00:00";
  const START = "2026-09-12 12:00:00";
  await handle.collection(ORDERS_COLLECTION).insertOne({ id: 1, status: "new", items: [], created_at: AFTER });

  const log = instrument(handle);

  out.push("\n[두 번 읽는 것을 나란히 보낸다]");
  const t0 = Date.now();
  await refreshStore();
  const took = Date.now() - t0;
  const reads = log.filter((l) => l.what === "store.findOne" || l.what.endsWith(".find"));
  check("읽기가 두 번 일어난다 (store 문서 + 최근 주문)", reads.length >= 2, JSON.stringify(log.map((l) => l.what)));
  check(
    "★ 둘이 거의 같은 때 출발한다 (줄줄이 아님)",
    reads.length >= 2 && Math.abs(reads[0].at - reads[1].at) < DELAY / 2,
    `간격 ${reads.length >= 2 ? Math.abs(reads[0].at - reads[1].at) : "?"}ms`
  );
  check(
    `★ 전체가 한 번 값으로 끝난다 (${DELAY}ms 두 번이면 ${DELAY * 2}ms)`,
    took < DELAY * 1.8,
    `${took}ms`
  );

  out.push("\n[그래도 틀린 목록이 나가지 않는다]");
  // 다른 인스턴스가 영업 시작을 방금 눌러서, 우리가 들고 있던 값과 데이터
  // 베이스의 값이 다른 상황. 이때는 주문을 다시 읽어야 한다.
  await handle.collection(ORDERS_COLLECTION).insertOne({ id: 2, status: "new", items: [], created_at: BEFORE });
  await handle.collection("store").updateOne({ _id: "main" }, { $set: { settings: { service_started_at: START } } });
  store.settings = {}; // 우리 인스턴스는 아직 모른다

  const log2 = instrument(handle);
  await refreshStore();
  const reads2 = log2.filter((l) => l.what.endsWith(".find") || l.what === "store.findOne");
  check("영업 시작이 바뀐 것을 알아채고 주문을 다시 읽는다", reads2.length >= 3, JSON.stringify(log2.map((l) => l.what)));
  check(
    "★ 영업 시작 전 주문은 목록에 없다",
    !store.orders.some((o) => o.id === 2),
    JSON.stringify(store.orders.map((o) => o.id))
  );
  check("영업 시작 뒤 주문은 그대로 있다", store.orders.some((o) => o.id === 1), JSON.stringify(store.orders.map((o) => o.id)));

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.log(out.join("\n"));
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
