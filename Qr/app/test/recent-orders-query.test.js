// 안 끝난 주문을 찾는 데 전부를 훑지 않는다.
//
// 2026-09-13 — 사장님 화면이 4.25초였는데, /api/_diag 로 재니 그중 3979ms 가
// 「최근 주문 읽기」 한 줄이었다. 몽고 왕복 자체는 5ms 였다.
//
// 예전 질의:
//     { $or: [ { status: { $nin: ["paid","cancelled"] } },
//              { created_at: { $gte: 사흘전 } } ] }
//
// `$nin` 은 인덱스를 못 탄다. 「이것만 빼고 전부」는 색인으로 좁힐 수가 없다.
// 그래서 안 끝난 주문 몇 건을 찾으려고 영업 시작 이후의 **모든 주문**을
// 훑었고, 장사를 하루 더 할수록 훑을 것이 하루치 늘었다.
//
// 이 테스트가 지키는 것은 두 가지다.
//   1. 인덱스를 탈 수 있는 모양인가 ($nin 이 없는가)
//   2. **그러고도 안 끝난 주문이 하나도 안 사라지는가** — 이게 더 중요하다.
//      화면에서 사라지면 이 가게에서는 받을 돈이 사라진다.
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
const { store, connectDB, getDb, ORDERS_COLLECTION, loadRecentOrders, RECENT_DAYS } = db;
const orderStatus = require("../src/orderStatus");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

function day(offset) {
  const d = new Date(Date.now() + offset * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

(async () => {
  await connectDB();
  const handle = getDb();
  const col = handle.collection(ORDERS_COLLECTION);

  // 어떤 질의가 나갔는지 들여다본다. 인덱스를 탈 수 있는 모양인지는 결과가
  // 아니라 **질의 자체**를 봐야 알 수 있다.
  const filters = [];
  const realFind = col.find.bind(col);
  col.find = (f, ...rest) => { filters.push(JSON.stringify(f)); return realFind(f, ...rest); };
  handle.collection = ((real) => (name) => (name === ORDERS_COLLECTION ? col : real(name)))(handle.collection.bind(handle));

  store.settings = { service_started_at: `${day(-30)} 00:00:00` };

  // 옛날에 끝난 주문을 잔뜩. 예전 질의는 이걸 전부 훑었다.
  const old = [];
  for (let i = 1; i <= 400; i++) {
    old.push({ _id: i, id: i, status: i % 2 ? "paid" : "cancelled", items: [], created_at: `${day(-20)} 12:00:00` });
  }
  // 아주 오래됐지만 **아직 안 끝난** 주문 — 절대 사라지면 안 된다.
  old.push({ _id: 900, id: 900, status: "new", items: [], created_at: `${day(-20)} 12:00:00` });
  old.push({ _id: 901, id: 901, status: "preparing", items: [], created_at: `${day(-25)} 12:00:00` });
  old.push({ _id: 902, id: 902, status: "served", items: [], created_at: `${day(-15)} 12:00:00` });
  // 최근 것 — 끝났어도 들고 있어야 한다(재인쇄·결산이 닿는 범위)
  old.push({ _id: 950, id: 950, status: "paid", items: [], created_at: `${day(-1)} 12:00:00` });
  // 영업 시작 전 테스트 주문 — 안 끝났어도 들어오면 안 된다
  old.push({ _id: 800, id: 800, status: "new", items: [], created_at: `${day(-40)} 12:00:00` });
  for (const o of old) await col.insertOne(o);

  filters.length = 0;
  const rows = await loadRecentOrders();
  const ids = rows.map((r) => r.id);

  out.push("\n[안 끝난 주문이 하나도 안 사라진다 — 이게 제일 중요하다]");
  check("★ 20일 전 「신규」 주문이 그대로 있다", ids.includes(900), JSON.stringify(ids.slice(0, 12)));
  check("★ 25일 전 「조리중」 주문도 있다", ids.includes(901));
  check("★ 15일 전 「서빙완료」 주문도 있다", ids.includes(902));
  check("최근 며칠 안의 끝난 주문도 있다", ids.includes(950));

  out.push("\n[들어오면 안 되는 것은 안 들어온다]");
  check("★ 영업 시작 전 주문은 안 들어온다", !ids.includes(800), JSON.stringify(ids));
  check("오래된 결제완료는 안 들어온다", !ids.includes(1) && !ids.includes(399), JSON.stringify(ids.length));
  check("같은 주문이 두 번 들어오지 않는다", new Set(ids).size === ids.length, `${ids.length} vs ${new Set(ids).size}`);
  check("주문 번호 순으로 정렬돼 있다", ids.every((v, i) => i === 0 || ids[i - 1] <= v), JSON.stringify(ids));

  out.push("\n[인덱스를 탈 수 있는 모양인가]");
  const joined = filters.join(" ");
  check("★ $nin 을 쓰지 않는다 (인덱스를 못 탄다)", !/\$nin/.test(joined), joined.slice(0, 300));
  check("★ 안 끝난 주문은 $in 으로 고른다", /\$in/.test(joined), joined.slice(0, 300));
  check("두 번으로 나눠 묻는다 (한 $or 에 묶지 않는다)", filters.length === 2, `${filters.length}개: ${joined.slice(0, 200)}`);
  check("$or 로 묶지 않았다", !/\$or/.test(joined), joined.slice(0, 200));
  check("두 질의 모두 created_at 으로 범위가 잡혀 있다",
    filters.every((f) => /created_at/.test(f)), joined.slice(0, 300));

  out.push("\n[상태 목록이 한 곳에서만 정해진다]");
  // 여기가 갈라지면 빠진 상태의 주문이 화면에서 조용히 사라진다.
  const routeSrc = require("fs").readFileSync(require("path").join(__dirname, "../src/routes/orders.js"), "utf8");
  check("★ 라우트의 입력 검사가 같은 목록을 쓴다",
    /require\("\.\.\/orderStatus"\)\.ALL/.test(routeSrc),
    (routeSrc.match(/const valid = .*/) || [""])[0]);
  check("결산도 같은 목록을 쓴다",
    /require\("\.\/orderStatus"\)\.OPEN/.test(require("fs").readFileSync(require("path").join(__dirname, "../src/settlement.js"), "utf8")));
  check("안 끝난 것 + 끝난 것 = 전부", orderStatus.OPEN.concat(orderStatus.CLOSED).sort().join() === orderStatus.ALL.slice().sort().join());
  check("겹치는 상태가 없다", orderStatus.OPEN.every((s) => !orderStatus.CLOSED.includes(s)));

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.log(out.join("\n"));
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
