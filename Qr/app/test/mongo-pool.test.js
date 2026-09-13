// Vercel 인스턴스 하나가 Atlas M0 연결을 과하게 점유하지 않는가.
//
// 2026-09-13 운영에서 연결 수가 약 480까지 올라 500개 한도에 가까워졌고,
// 모든 API가 공통 DB 단계에서 약 5초씩 기다렸다. 이 설정이 다시 커지면
// 트래픽이 늘 때 같은 연결 폭주가 재발하므로 실제 MongoClient에 전달되는
// 옵션을 검사한다.
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

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

(async () => {
  await db.connectDB();
  const captured = fake.__lastClientOptions();
  const opts = captured && captured.options;

  check("MongoClient 옵션이 실제로 전달된다", !!opts, JSON.stringify(captured));
  check("★ 인스턴스당 연결은 최대 1개", opts && opts.maxPoolSize === 1, JSON.stringify(opts));
  check("★ 유휴 연결을 미리 유지하지 않는다", opts && opts.minPoolSize === 0, JSON.stringify(opts));
  check("★ 새 연결은 한 번에 하나만 연다", opts && opts.maxConnecting === 1, JSON.stringify(opts));
  check("★ 유휴 연결은 30초 뒤 반환한다", opts && opts.maxIdleTimeMS === 30000, JSON.stringify(opts));

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.log(out.join("\n"));
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
