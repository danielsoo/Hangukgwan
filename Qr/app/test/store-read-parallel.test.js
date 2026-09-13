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
// 시험용 가짜 몽고는 같은 이름이면 **같은 컬렉션 객체**를 돌려준다. 그래서
// 예전처럼 부를 때마다 다시 감싸면 감싼 것 위에 또 감싸게 되고, 읽기 한 번이
// 로그 세 줄과 지연 세 번이 된다(2026-09-14 에 실제로 그래서 헛짚었다).
// 감싸기는 한 번만 하고, 기록할 곳만 갈아끼운다.
let activeLog = null;
let instrumented = false;
function instrument(handle) {
  activeLog = [];
  if (instrumented) return activeLog;
  instrumented = true;
  const realCollection = handle.collection.bind(handle);
  handle.collection = (name) => {
    const col = realCollection(name);
    if (!col.__instrumented) {
      col.__instrumented = true;
      const realFindOne = col.findOne.bind(col);
      const realFind = col.find.bind(col);
      col.findOne = async (...args) => {
        // 판 번호 한 칸만 읽은 것인지, 문서를 통째로 읽은 것인지 구분한다.
        const proj = (args[1] && args[1].projection) || {};
        if (activeLog) activeLog.push({ what: `${name}.findOne`, at: Date.now(), revOnly: proj.rev === 1 });
        await sleep(DELAY);
        return realFindOne(...args);
      };
      col.find = (...args) => {
        const cur = realFind(...args);
        const realToArray = cur.toArray.bind(cur);
        cur.toArray = async () => {
          if (activeLog) activeLog.push({ what: `${name}.find`, at: Date.now() });
          await sleep(DELAY);
          return realToArray();
        };
        return cur;
      };
    }
    return col;
  };
  return activeLog;
}

(async () => {
  await connectDB();
  const handle = getDb();
  // 실제 코드와 같은 문으로 넣는다 — storeWrite 가 판 번호를 같이 달아준다.
  // 직접 updateOne 으로 넣으면 판 번호 없는 문서가 되고, 그건 이 기능을
  // 넣기 전 상태라 캐시가 영영 안 걸린다.
  await db.storeWrite({ $set: { settings: {}, menuItems: [], tables: [] } }, { upsert: true });
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
  // 지켜야 하는 성질은 「둘째가 첫째가 끝나기 전에 출발했다」다. 시작
  // 시각의 간격을 아주 좁게 잡으면 기계가 바쁜 날 그냥 깜빡인다 —
  // 2026-09-12 에 실제로 한 번 깜빡였다(간격 30ms, 기준 30ms). 진짜 증거는
  // 아래의 전체 시간이고, 이 줄은 그 보조다.
  check(
    "★ 둘째가 첫째를 기다리지 않고 출발한다",
    reads.length >= 2 && Math.abs(reads[0].at - reads[1].at) < DELAY,
    `간격 ${reads.length >= 2 ? Math.abs(reads[0].at - reads[1].at) : "?"}ms (지연 ${DELAY}ms)`
  );
  // 처음 한 번은 두 값이다 — 판 번호를 묻고(나란히 주문도), 모르는 판이니
  // 통째로 한 번 더 받는다. 여기서 줄이려던 것은 이 첫 번이 아니라 **그
  // 다음부터 매번** 내던 37KB 다.
  check(
    `★ 처음에는 두 값 안에 끝난다 (${DELAY * 2}ms)`,
    took < DELAY * 2.8,
    `${took}ms`
  );

  out.push("\n[두 번째부터는 37KB 를 다시 받지 않는다]");
  // 2026-09-14. 운영에서 이 문서를 꺼내는 데 9ms, 37KB 를 실어 보내는 데
  // 394ms 였다. 바뀐 게 없으면 판 번호 한 칸만 묻고 끝나야 한다.
  const mark = log.length;
  const t1 = Date.now();
  await refreshStore({ includeOrders: false });
  const took2 = Date.now() - t1;
  const second = log.slice(mark);
  const fullReads = second.filter((l) => l.what === "store.findOne" && !l.revOnly);
  const revReads = second.filter((l) => l.what === "store.findOne" && l.revOnly);
  check("★ 판 번호만 묻는다", revReads.length === 1, JSON.stringify(second));
  check("★ 문서를 통째로 다시 받지 않는다", fullReads.length === 0, JSON.stringify(second));
  check(`★ 한 값 안에 끝난다 (${DELAY}ms)`, took2 < DELAY * 1.8, `${took2}ms`);

  out.push("\n[다른 기기가 고치면 그때는 다시 받는다]");
  // 판 번호가 바뀌면 반드시 통째로 다시 읽어야 한다. 안 그러면 메뉴를
  // 고쳤는데 손님 화면이 안 바뀐다 — 오류도 안 나고 조용히 틀린다.
  const mark2 = log.length;
  await db.storeWrite({ $set: { "settings.tester_marker": String(Date.now()) } });
  await refreshStore({ includeOrders: false });
  const third = log.slice(mark2);
  check(
    "★ 판 번호가 바뀌면 통째로 다시 읽는다",
    third.filter((l) => l.what === "store.findOne" && !l.revOnly).length === 1,
    JSON.stringify(third)
  );
  check("바뀐 값이 실제로 들어와 있다", !!(store.settings && store.settings.tester_marker));

  out.push("\n[주문이 필요 없는 요청은 주문 컬렉션을 아예 읽지 않는다]");
  const orderReadsBefore = log.filter((l) => l.what === `${ORDERS_COLLECTION}.find`).length;
  await handle.collection(ORDERS_COLLECTION).insertOne({ id: 3, status: "new", items: [], created_at: AFTER });
  await refreshStore({ includeOrders: false });
  const orderReadsAfter = log.filter((l) => l.what === `${ORDERS_COLLECTION}.find`).length;
  check("★ 주문 질의 0번", orderReadsAfter === orderReadsBefore, `${orderReadsBefore} → ${orderReadsAfter}`);
  check("기존 주문 배열을 지우지 않는다", store.orders.some((o) => o.id === 1), JSON.stringify(store.orders));
  check("새 주문을 읽은 척하지 않는다", !store.orders.some((o) => o.id === 3), JSON.stringify(store.orders));

  out.push("\n[그래도 틀린 목록이 나가지 않는다]");
  // 다른 인스턴스가 영업 시작을 방금 눌러서, 우리가 들고 있던 값과 데이터
  // 베이스의 값이 다른 상황. 이때는 주문을 다시 읽어야 한다.
  await handle.collection(ORDERS_COLLECTION).insertOne({ id: 2, status: "new", items: [], created_at: BEFORE });
  // 다른 인스턴스가 영업 시작을 누른 상황. 실제 코드처럼 storeWrite 를
  // 거치게 한다 — 그래야 판 번호가 올라가고, 우리 쪽이 다시 읽는다.
  await db.storeWrite({ $set: { settings: { service_started_at: START } } });
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
