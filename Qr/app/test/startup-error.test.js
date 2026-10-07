// A bad Vercel environment variable must not become an opaque
// FUNCTION_INVOCATION_FAILED page, and the safe response must never echo a
// database URI/password.
const assert = require("assert");
const { startupReason, failedStartupHandler } = require("../src/startupError");

let pass = 0;
function check(name, condition, extra = "") {
  if (!condition) throw new Error(`${name}: ${extra}`);
  pass++;
  console.log(`  ok   ${name}`);
}

console.log("\n[서버 시작 오류를 안전하게 구분한다]");
check(
  "MongoDB 주소 누락",
  startupReason(new Error("MONGODB_URI is not set. secret")) === "database_url_missing"
);
const parseError = new Error("Invalid scheme in mongodb://owner:secret@example.test/db");
parseError.name = "MongoParseError";
check("MongoDB 주소 형식 오류", startupReason(parseError) === "database_url_invalid");
check("그 밖의 시작 오류", startupReason(new Error("unexpected")) === "server_start_failed");

let body = "";
const headers = {};
const res = {
  statusCode: 200,
  setHeader(name, value) { headers[String(name).toLowerCase()] = value; },
  end(value) { body = String(value || ""); },
};
failedStartupHandler(parseError)({}, res);
const parsed = JSON.parse(body);

check("503으로 답한다", res.statusCode === 503, String(res.statusCode));
check("캐시하지 않는다", headers["cache-control"] === "no-store", headers["cache-control"]);
check("안전한 오류 종류만 답한다", parsed.reason === "database_url_invalid", body);
check("URI와 비밀번호를 내보내지 않는다", !body.includes("mongodb://") && !body.includes("secret"), body);

// The real Vercel entry point also catches the missing variable while
// importing server.js. This is the exact failure that previously happened
// before a request handler existed.
delete process.env.MONGODB_URI;
delete require.cache[require.resolve("../api/index")];
const handler = require("../api/index");
body = "";
res.statusCode = 200;
handler({}, res);
check("실제 진입점도 죽지 않고 함수가 된다", typeof handler === "function");
check("실제 진입점이 누락을 알려준다", JSON.parse(body).reason === "database_url_missing", body);

console.log(`\n${pass} passed, 0 failed\n`);
assert.strictEqual(pass, 9);
