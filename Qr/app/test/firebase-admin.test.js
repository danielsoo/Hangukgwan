// Firebase 서비스 계정 키가 들어왔을 때 src/firebaseAdmin.js 가 실제로
// 초기화되는지 확인한다.
//
// 왜 이 파일이 있나: 이 모듈은 어떤 실패든 조용히 null 로 되돌리도록
// 설계돼 있다(설정 전에도 나머지 앱이 정상 동작해야 하니까). 그래서
// firebase-admin 의 API 가 바뀌었을 때 — v13 부터 admin.credential.cert /
// admin.apps / app.auth() 가 사라졌다 — 사장님이 키를 정확히 넣어도
// "Google 로그인만 안 됨" 이라는 형태로만 드러나고 서버 로그를 봐야 알 수
// 있었다. 여기서 잡는다.
const assert = require("assert");
const crypto = require("crypto");
const path = require("path");

let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL ${name}\n       ${e.message}`);
  }
}
async function checkAsync(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL ${name}\n       ${e.message}`);
  }
}

// 진짜 Firebase 키는 저장소에 둘 수 없으니, 형식만 진짜와 같은 키를
// 그때그때 만든다. cert() 는 private_key 가 실제 PEM 인지까지 보기 때문에
// 아무 문자열이나 넣으면 이 테스트가 무의미해진다.
function fakeServiceAccount() {
  const { privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return {
    type: "service_account",
    project_id: "test-project",
    private_key_id: "0123456789abcdef0123456789abcdef01234567",
    private_key: privateKey,
    client_email: "firebase-adminsdk-test@test-project.iam.gserviceaccount.com",
    client_id: "000000000000000000000",
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
  };
}

function freshModule() {
  delete require.cache[require.resolve("../src/firebaseAdmin")];
  return require("../src/firebaseAdmin");
}

(async () => {
  console.log("\n[설정 전 — 앱이 죽지 않아야 한다]");
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  let fa = freshModule();
  check("키가 없으면 isConfigured() 는 false", () => assert.strictEqual(fa.isConfigured(), false));
  await checkAsync("키가 없으면 토큰 검증은 null (에러 아님)", async () => {
    assert.strictEqual(await fa.verifyIdToken("whatever"), null);
  });

  console.log("\n[망가진 키 — 조용히 꺼지되 로그는 남는다]");
  process.env.FIREBASE_SERVICE_ACCOUNT = "{ 이건 JSON 이 아님";
  fa = freshModule();
  const errs = [];
  const realErr = console.error;
  console.error = (...a) => errs.push(a.join(" "));
  const brokenResult = fa.isConfigured();
  console.error = realErr;
  check("JSON 이 깨졌으면 false", () => assert.strictEqual(brokenResult, false));
  check("무엇이 문제인지 로그에 남는다", () =>
    assert.ok(errs.some((e) => e.includes("FIREBASE_SERVICE_ACCOUNT")), JSON.stringify(errs))
  );

  console.log("\n[정상 키 — 실제로 초기화되어야 한다]");
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify(fakeServiceAccount());
  fa = freshModule();
  const errs2 = [];
  const realErr2 = console.error;
  console.error = (...a) => errs2.push(a.join(" "));
  const ok = fa.isConfigured();
  console.error = realErr2;
  check("형식이 맞는 키를 넣으면 isConfigured() 는 true", () =>
    assert.strictEqual(ok, true, `초기화 실패: ${errs2.join(" | ")}`)
  );
  check("초기화 에러 로그가 없다", () => assert.deepStrictEqual(errs2, []));

  await checkAsync("가짜 토큰은 여전히 null (네트워크 없이도 즉시)", async () => {
    assert.strictEqual(await fa.verifyIdToken("not.a.real.token"), null);
  });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
