// GET /api/account/methods 가 "구글 버튼을 띄울지"를 정직하게 답하는지.
//
// 왜 이 파일이 있나 — 2026-09-08 배포에서 실제로 일어난 일:
// FIREBASE_SERVICE_ACCOUNT(서버)는 넣었는데 firebase_web_config(관리자
// 화면)는 아직 안 넣은 상태였다. 그때 이 엔드포인트가 서버 쪽만 보고
// google:true 를 돌려주는 바람에, 홈페이지에 구글 버튼이 멀쩡히 떠 있는데
// 누르면 "Google 로그인이 아직 설정되지 않았습니다" 가 떴다. 눌러야만
// 드러나는 고장이라 사장님이 직접 발견하실 때까지 아무도 몰랐다.
const crypto = require("crypto");

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

// 형식이 진짜와 같은 서비스 계정 키 (test/firebase-admin.test.js 와 같은 이유).
const { privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
  type: "service_account",
  project_id: "test-project",
  private_key_id: "0123456789abcdef0123456789abcdef01234567",
  private_key: privateKey,
  client_email: "firebase-adminsdk-test@test-project.iam.gserviceaccount.com",
  client_id: "000000000000000000000",
});

const express = require("express");
const request = require("supertest");
const { store } = require("../src/db");

const app = express();
app.use(express.json());
app.use("/api/account", require("../src/routes/account"));

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const GOOD = JSON.stringify({
  apiKey: "AIzaSyTestTestTestTestTestTestTestTest",
  authDomain: "test-project.firebaseapp.com",
  projectId: "test-project",
  appId: "1:000:web:abc",
});

// Firebase 콘솔이 화면에 보여주는 형태 — 키에 따옴표가 없어서 JSON 이 아니다.
// 사장님이 그대로 복사해 붙이기 딱 좋은 값이라 반드시 걸러져야 한다.
const CONSOLE_SNIPPET = `{
  apiKey: "AIzaSyTestTestTestTestTestTestTestTest",
  projectId: "test-project"
}`;

(async () => {
  store.settings = store.settings || {};

  const cases = [
    ["설정 전 — 버튼 안 뜬다", undefined, false],
    ["빈 문자열", "   ", false],
    ["콘솔의 JS 객체 리터럴(따옴표 없음)은 거부", CONSOLE_SNIPPET, false],
    ["JSON 이지만 apiKey 없음", JSON.stringify({ projectId: "test-project" }), false],
    ["JSON 이지만 projectId 없음", JSON.stringify({ apiKey: "AIza..." }), false],
    ["둘 다 갖춰지면 버튼이 뜬다", GOOD, true],
  ];

  out.push("\n[서버 키는 있는 상태에서, 웹 설정값에 따라]");
  for (const [name, value, expected] of cases) {
    if (value === undefined) delete store.settings.firebase_web_config;
    else store.settings.firebase_web_config = value;
    const r = await request(app).get("/api/account/methods");
    check(name, r.body.google === expected, `google=${r.body.google}, 기대=${expected}`);
  }

  out.push("\n[엣지 캐시 — 페이지마다 함수를 깨우지 않도록]");
  store.settings.firebase_web_config = GOOD;
  const h = (await request(app).get("/api/account/methods")).headers;
  const cc = h["cache-control"] || "";
  const cdn = h["cdn-cache-control"] || "";
  check("엣지에 캐시하라고 지시한다", /max-age=\d+/.test(cdn) && !/max-age=0/.test(cdn), cdn);
  check("브라우저에는 안 남긴다 (설정 바꾼 뒤 그 기기만 옛날 상태가 되지 않게)", /max-age=0/.test(cc), cc);
  // SWR 은 브라우저에도 적용돼서 페이지마다 배경 재검증 요청을 하나 더 만든다.
  check("stale-while-revalidate 는 안 쓴다", !/stale-while-revalidate/.test(cc) , cc);

  out.push("\n[이메일 로그인은 어떤 경우에도 켜져 있다]");
  delete store.settings.firebase_web_config;
  let r = await request(app).get("/api/account/methods");
  check("email true", r.body.email === true, JSON.stringify(r.body));

  out.push("\n[웹 설정값만 있고 서버 키가 없으면]");
  store.settings.firebase_web_config = GOOD;
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  delete require.cache[require.resolve("../src/firebaseAdmin")];
  delete require.cache[require.resolve("../src/routes/account")];
  const app2 = express();
  app2.use(express.json());
  app2.use("/api/account", require("../src/routes/account"));
  r = await request(app2).get("/api/account/methods");
  check("서버가 토큰을 검증 못 하면 버튼 안 뜬다", r.body.google === false, JSON.stringify(r.body));

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.log(out.join("\n"));
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
