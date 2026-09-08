// 홈페이지와 주문 시스템이 **한 서버**에서 서빙되는지 확인한다.
//
// 2026-09-08 이전에는 둘이 별개의 Vercel 프로젝트였고 Web/vercel.json 의
// rewrite 가 /api/* 를 넘겨주기로 되어 있었는데, 배포된 홈페이지에서
// 실제로 열어보니 /api/account/me 도 /admin 도 404 였다. 즉 홈페이지의
// 로그인·회원가입이 통째로 동작하지 않았고, 화면만 예쁘게 떠서 그게 안
// 보였다. 이 파일은 그 상태가 다시 오지 않게 지킨다.
//
// e2e-site-login.js 는 홈페이지 정적 파일을 테스트가 직접 앞에 붙여서
// "합쳐졌다고 가정한" 모습을 확인한다. 여기서는 아무것도 붙이지 않고
// server.js 하나만 띄운다 — 배포와 같은 모양이다.
const path = require("path");

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
process.env.SESSION_SECRET = "e2e-one-origin";
process.env.ADMIN_PASSWORD = "ownerpass123";

const request = require("supertest");
const app = require("../server");
const { resolveSiteDir } = require("../src/site");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) {
    pass++;
    out.push(`  ok   ${name}`);
  } else {
    fail++;
    out.push(`  FAIL ${name}  ${extra}`);
  }
}

(async () => {
  const dir = resolveSiteDir();
  if (!dir) {
    console.log("홈페이지 빌드가 없습니다 — Web/ 에서 `npm run build` 하세요.");
    process.exit(1);
  }
  out.push(`\n[홈페이지 위치] ${path.relative(path.join(__dirname, "..", "..", ".."), dir)}`);

  out.push("\n[한 주소에서 홈페이지가 나온다]");
  let r = await request(app).get("/");
  check("/ 가 홈페이지 (관리자로 리다이렉트 아님)", r.status === 200 && /<html/i.test(r.text), `status=${r.status} loc=${r.headers.location}`);
  check("5페이지 사이트가 맞다", /韓國館|한국관/.test(r.text), r.text.slice(0, 120));

  for (const p of ["/login/", "/signup/", "/account/", "/menu/", "/about/", "/visit/", "/group/"]) {
    r = await request(app).get(p);
    check(`${p} 200`, r.status === 200, `status=${r.status}`);
  }

  // next.config.mjs 가 trailingSlash: true 라서 정식 주소는 "/login/" 이다.
  // 슬래시 없이 들어오면 express.static 이 그쪽으로 넘겨준다. 관리자
  // 화면은 이 영향을 받지 않는다 — /admin 은 홈페이지 폴더에 없는
  // 이름이라 이 처리가 아예 닿지 않고, 위에서 이미 200 을 확인했다.
  out.push("\n[슬래시 없이 들어와도 열린다]");
  r = await request(app).get("/login");
  check("/login → /login/ 로 넘겨줌", r.status === 301 && r.headers.location === "/login/", `status=${r.status} loc=${r.headers.location}`);
  r = await request(app).get(r.headers.location || "/login/");
  check("넘어간 곳이 열린다", r.status === 200, `status=${r.status}`);

  out.push("\n[주문 시스템이 가려지지 않았다 — 여기가 핵심]");
  r = await request(app).get("/admin");
  check("/admin 은 여전히 관리자 화면", r.status === 200 && /admin/i.test(r.text), `status=${r.status}`);
  r = await request(app).get("/t/7");
  check("/t/7 은 여전히 주문 화면", r.status === 200, `status=${r.status}`);
  r = await request(app).get("/api/account/me");
  check("/api/account/me 가 살아있다 (404 아님)", r.status === 200, `status=${r.status}`);
  check("응답이 JSON", r.body && "isAdmin" in r.body, JSON.stringify(r.body).slice(0, 120));
  r = await request(app).get("/api/settings");
  check("/api/settings 살아있다", r.status === 200, `status=${r.status}`);

  out.push("\n[홈페이지에서 가입하면 같은 서버에 계정이 생긴다]");
  const agent = request.agent(app);
  r = await agent
    .post("/api/account/register")
    .send({ email: "one@example.com", password: "hunter2hunter", name: "한주소" });
  check("가입 200", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
  const cookie = r.headers["set-cookie"];
  check("세션 쿠키가 내려온다", !!cookie && /connect\.sid|sid/.test(String(cookie)), String(cookie).slice(0, 80));
  check("쿠키에 도메인이 박히지 않음 (같은 출처 전용)", !/Domain=/i.test(String(cookie)), String(cookie).slice(0, 120));
  r = await agent.get("/api/account/me");
  check("같은 쿠키로 로그인 상태 유지", r.status === 200 && r.body.user && r.body.user.email === "one@example.com", JSON.stringify(r.body).slice(0, 150));

  out.push("\n[빌드된 홈페이지가 다른 도메인을 가리키지 않는다]");
  r = await request(app).get("/");
  check("홈에 hangukgwan.vercel.app 링크 없음", !r.text.includes("hangukgwan.vercel.app"), "절대 URL이 남아있음");
  r = await request(app).get("/account/");
  check("내 계정에 절대 URL 없음", !r.text.includes("hangukgwan.vercel.app"));

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.log(out.join("\n"));
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
