// 정적 파일을 얼마나 오래 캐시하느냐 — "느리다"의 화면 쪽 절반.
//
// 2026-09-12 사장님: "로그인도 그렇고 버튼 누르는 것도 그렇고 다" 느리다.
//
// admin.js 는 673KB(압축 209KB)다. 이걸 얼마나 자주 다시 받느냐가 화면이
// 뜨는 속도를 그대로 정한다. 여태 두 가지가 겹쳐 있었다.
//
//  1. 한 시간 캐시 — 가게 태블릿은 한 시간마다 이 파일을 통째로 다시 받았다.
//  2. 엣지(CDN)가 하나도 안 들고 있었다 — Vercel 엣지는 `s-maxage` 가
//     있을 때만 함수 응답을 캐시한다. `max-age` 는 브라우저 지시어라 엣지에
//     아무 효과가 없다(2026-09-08 속도 점검 「원인 1」). 그래서 그 다시 받는
//     길이 매번 **서울의 함수**까지 갔다.
//
// 이제 오래 캐시한다. 그래도 되는 이유는 하나뿐이다 — **주소에 배포 지문이
// 박혀 있다**(assetVersion 의 `?v=`). 이 테스트가 지키는 것이 정확히 그
// 조건이다. 지문이 없는 주소까지 오래 캐시하는 순간, 이 파일이 애초에
// 막으려던 "고쳤다는데 왜 그대로냐"가 그대로 돌아온다.
const path = require("path");
const fs = require("fs");
const express = require("express");
const request = require("supertest");
const {
  cacheHeaderFor,
  staticSetHeaders,
  stampHtml,
  assetVersion,
  ASSET_IMMUTABLE,
  ASSET_SHORT,
} = require("../src/assetVersion");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

function secondsIn(header) {
  const m = /max-age=(\d+)/.exec(header || "");
  return m ? Number(m[1]) : 0;
}
function edgeSecondsIn(header) {
  const m = /s-maxage=(\d+)/.exec(header || "");
  return m ? Number(m[1]) : 0;
}

(async () => {
  out.push("\n[지문이 있을 때만 오래 준다]");
  const stamped = cacheHeaderFor({ query: { v: "8f3a1c2b" } }, { production: true });
  const bare = cacheHeaderFor({ query: {} }, { production: true });

  check("★ 지문이 있으면 1년", secondsIn(stamped) >= 31536000, stamped);
  check("★ 지문이 없으면 1분 이하 — 옛 파일이 오래 살지 않는다", secondsIn(bare) <= 60, bare);
  check("지문이 있으면 immutable (재검증 요청조차 안 만든다)", /immutable/.test(stamped), stamped);
  check("지문이 없으면 immutable 아님", !/immutable/.test(bare), bare);

  out.push("\n[엣지가 들고 있어야 서울까지 안 간다]");
  check("★ 지문 있는 주소에 s-maxage", edgeSecondsIn(stamped) >= 31536000, stamped);
  check("지문 없는 주소에도 s-maxage 는 있다 (짧게)", edgeSecondsIn(bare) > 0, bare);
  check(
    "SWR 은 안 쓴다 — 브라우저가 배경 요청을 더 만든다",
    !/stale-while-revalidate/.test(stamped + bare),
    stamped + " / " + bare
  );

  out.push("\n[로컬에서는 캐시하지 않는다 — 고친 게 바로 보여야 한다]");
  check("개발 중에는 no-store", /no-store/.test(cacheHeaderFor({ query: { v: "x" } }, { production: false })));

  out.push("\n[실제로 그 헤더가 나간다 — express.static 에 물려 있나]");
  const app = express();
  app.use(express.static(path.join(__dirname, "..", "public"), { setHeaders: staticSetHeaders }));
  const was = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  let r = await request(app).get("/js/admin.js?v=abc123");
  check("지문 붙은 admin.js 가 1년으로 나간다", r.status === 200 && secondsIn(r.headers["cache-control"]) >= 31536000, `${r.status} ${r.headers["cache-control"]}`);
  r = await request(app).get("/js/admin.js");
  check("지문 없는 admin.js 는 짧게 나간다", r.status === 200 && secondsIn(r.headers["cache-control"]) <= 60, `${r.status} ${r.headers["cache-control"]}`);
  process.env.NODE_ENV = was;

  out.push("\n[HTML 이 지문을 실제로 박아 준다 — 이게 전제다]");
  // 이 전제가 깨지면 위의 1년 캐시는 그냥 위험한 설정이 된다.
  const adminHtml = fs.readFileSync(path.join(__dirname, "..", "public", "admin.html"), "utf8");
  const st = stampHtml(adminHtml, assetVersion());
  const scripts = st.match(/<script\b[^>]*\bsrc="\/js\/[^"]+"/g) || [];
  check("admin.html 의 /js 주소가 하나도 안 빠지고 지문을 받는다",
    scripts.length > 0 && scripts.every((t) => /\?v=/.test(t)),
    scripts.filter((t) => !/\?v=/.test(t)).join(" ") || `${scripts.length}개`);
  const links = st.match(/<link\b[^>]*\bhref="\/css\/[^"]+"/g) || [];
  check("admin.html 의 /css 주소도 전부 지문을 받는다",
    links.length > 0 && links.every((t) => /\?v=/.test(t)),
    links.filter((t) => !/\?v=/.test(t)).join(" ") || `${links.length}개`);

  out.push("\n[server.js 가 문법적으로 성한가]");
  // 유닛 테스트는 server.js 를 아무도 require 하지 않는다. 그래서 2026-09-12
  // 에 이 파일을 고치다 중괄호 하나를 깨뜨렸는데 **npm test 가 전부
  // 통과했다.** 브라우저 테스트를 돌리고 나서야 알았다. 한 줄로 막는다.
  const { execFileSync } = require("child_process");
  let serverParses = true;
  let parseErr = "";
  try {
    execFileSync(process.execPath, ["--check", path.join(__dirname, "..", "server.js")], { stdio: "pipe" });
  } catch (e) {
    serverParses = false;
    parseErr = String(e.stderr || e.message).slice(0, 300);
  }
  check("★ server.js 가 열린다", serverParses, parseErr);

  out.push("\n[vercel.json 이 이 값을 덮어쓰면 안 된다]");
  // vercel.json 의 headers 는 함수가 붙인 헤더를 이긴다. css/js/images 규칙이
  // 남아 있으면 위의 조건부 설정이 통째로 무시되고 다시 한 시간으로 돌아간다.
  const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8"));
  const pinned = (vercel.headers || []).find((h) => /css\|js\|images/.test(h.source));
  check("★ css/js/images 를 고정하는 규칙이 없다", !pinned, JSON.stringify(pinned));

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.log(out.join("\n"));
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
