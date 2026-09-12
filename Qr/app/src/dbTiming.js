// 이 요청이 몽고에서 보낸 시간.
//
// 2026-09-12 사장님: "분명 대만 기준 오늘 아침 영업때는 빨랐는데 저녁
// 영업때는 갑자기 느려졌어."
//
// 아침과 저녁 사이에 코드는 안 바뀌었다. 바뀐 것은 **부하**다. 그러면
// 후보가 좁혀진다 — 몽고가 느려졌거나(M0 는 여러 손님이 같이 쓰는 호스트라
// 초당 연산 제한이 있다), 인스턴스가 계속 새로 뜨거나, 주문이 쌓여 읽는
// 양이 늘었거나.
//
// 그런데 「요청이 500ms 걸렸다」만으로는 셋 중 무엇인지 알 수 없다. 그래서
// 한 요청 안에서 **몽고를 기다린 시간만** 따로 더한다.
//
//   ms 500, mongo_ms 450  → 몽고다. M0 를 올리거나 읽는 양을 줄여야 한다
//   ms 500, mongo_ms 20   → 몽고가 아니다. 콜드 스타트나 우리 코드다
//
// AsyncLocalStorage 를 쓰는 이유는 이게 요청마다 따로 세어져야 하기
// 때문이다. 전역 변수 하나로 세면 동시에 들어온 요청들이 서로의 시간을
// 더해서, 바쁠수록 숫자가 부풀어 오른다 — 하필 바쁠 때를 보려는 것인데.
const { AsyncLocalStorage } = require("async_hooks");

const als = new AsyncLocalStorage();

/** 이 요청의 측정 칸을 열고 fn 을 돌린다. */
function run(fn) {
  return als.run({ ms: 0, ops: 0 }, fn);
}

function add(ms) {
  const box = als.getStore();
  if (!box) return;
  box.ms += ms;
  box.ops += 1;
}

/** 지금까지 이 요청이 몽고에서 보낸 시간. 밖에서 부르면 null. */
function current() {
  const box = als.getStore();
  return box ? { mongo_ms: box.ms, mongo_ops: box.ops } : { mongo_ms: null, mongo_ops: null };
}

// 몽고 컬렉션 하나를 감싸 시간을 더하게 한다. 같은 객체를 두 번 감싸면
// 시간이 두 겹으로 세어지므로 한 번만 감싼다(2026-09-12 에 계측기를 만들다
// 실제로 여덟 겹이 된 적이 있다).
const seen = new WeakSet();
const READS = ["findOne", "countDocuments", "distinct", "aggregate"];
const WRITES = ["insertOne", "insertMany", "updateOne", "updateMany", "replaceOne", "deleteOne", "deleteMany", "bulkWrite", "findOneAndUpdate"];

function wrapCollection(col) {
  if (!col || seen.has(col)) return col;
  seen.add(col);
  for (const m of READS.concat(WRITES)) {
    if (typeof col[m] !== "function") continue;
    const real = col[m].bind(col);
    col[m] = async (...args) => {
      const t0 = Date.now();
      try {
        return await real(...args);
      } finally {
        add(Date.now() - t0);
      }
    };
  }
  if (typeof col.find === "function") {
    const realFind = col.find.bind(col);
    col.find = (...args) => {
      const cur = realFind(...args);
      if (cur && typeof cur.toArray === "function") {
        const realToArray = cur.toArray.bind(cur);
        cur.toArray = async () => {
          const t0 = Date.now();
          try {
            return await realToArray();
          } finally {
            add(Date.now() - t0);
          }
        };
      }
      return cur;
    };
  }
  return col;
}

/** db 핸들의 collection() 을 감싼다. 한 번만 부르면 된다. */
function wrapDb(db) {
  if (!db || seen.has(db)) return db;
  seen.add(db);
  const real = db.collection.bind(db);
  db.collection = (...args) => wrapCollection(real(...args));
  return db;
}

module.exports = { run, current, wrapDb };
