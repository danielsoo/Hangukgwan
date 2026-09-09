// 배포 설정(vercel.json)과 빌드 스크립트가 서로 맞물려 있는지.
//
// 왜 필요한가 — 2026-09-08 속도 점검에서 드러난 것:
// 모든 요청이 서버리스 함수로 가고 엣지 캐시에 하나도 안 걸렸다
// (x-vercel-cache: MISS, 예외 없음). 원인은 두 가지였고 둘 다 설정 파일에
// 있었다. (1) 정적 출력이 없어서 rewrites 가 전부 함수로 넘김,
// (2) 함수 응답에 s-maxage 가 없어서 엣지가 캐시하지 않음.
//
// 배포 설정은 여기서 돌려볼 수 없는 종류의 코드라 조용히 틀어지기 쉽다.
// 최소한 서로 모순되지는 않는지 지킨다.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..");
const WEB_ROOT = path.join(__dirname, "..", "..", "..", "Web");
const vercel = JSON.parse(fs.readFileSync(path.join(APP, "vercel.json"), "utf8"));
const buildScript = fs.readFileSync(path.join(APP, "scripts", "build-site.js"), "utf8");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

// 2026-09-08: JSON 에 주석이 없어서 "// outputDirectory" 같은 키로 설명을
// 달았더니 Vercel 스키마 검사가 should NOT have additional property 로
// **배포를 실패**시켰다. 설명은 VERCEL.md 에 둔다.
out.push("\n[vercel.json 은 주석을 넣을 수 없다]");
const badKeys = Object.keys(vercel).filter((k) => k.trim().startsWith("//"));
check("주석용 키가 없다", badKeys.length === 0, badKeys.join(", "));
const ALLOWED = new Set([
  "buildCommand", "devCommand", "installCommand", "ignoreCommand", "framework",
  "outputDirectory", "public", "regions", "functions", "headers", "redirects",
  "rewrites", "routes", "cleanUrls", "trailingSlash", "crons", "images", "git",
]);
const unknown = Object.keys(vercel).filter((k) => !ALLOWED.has(k));
check("Vercel 이 아는 키만 쓴다", unknown.length === 0, unknown.join(", "));
check("설명은 VERCEL.md 에 있다", fs.existsSync(path.join(APP, "VERCEL.md")));

out.push("\n[정적 출력 — 홈페이지가 CDN 에서 나가는 근거]");
check("outputDirectory 가 site", vercel.outputDirectory === "site", String(vercel.outputDirectory));
check("빌드 스크립트가 그 폴더를 만든다", /const DEST = path\.join\(APP_DIR, "site"\)/.test(buildScript));
check("Web/ 이 없어도 site/ 는 만든다 (없으면 배포가 실패한다)", /fs\.mkdirSync\(DEST, \{ recursive: true \}\)/.test(buildScript));
// vercel.json 의 첫 rewrite 가 "/" 를 /index.html 로 보낸다. 그 파일이 없으면
// Vercel 은 다음 규칙으로 넘어가지 않고 404 를 낸다(맞는 규칙 하나만 적용하고
// 멈춘다). 홈페이지 빌드가 없는 상황에서도 /admin 으로는 갈 수 있어야 한다.
check("홈페이지가 없으면 /admin 으로 보내는 index.html 을 남긴다", /writeAdminFallback\(\)/.test(buildScript) && /url=\/admin/.test(buildScript));
check("buildCommand 가 그 스크립트를 부른다", vercel.buildCommand === "node scripts/build-site.js", String(vercel.buildCommand));

out.push("\n[페이지 주소가 정적 파일로 이어지는지 — 이게 없으면 전부 함수로 간다]");
// Vercel 은 요청 경로와 파일 경로가 정확히 같을 때만 파일시스템에서 바로
// 집어낸다. /menu/ → menu/index.html 같은 색인 찾기는 포괄 rewrite 보다
// 나중이라, 명시하지 않으면 함수로 끌려간다(2026-09-08 배포본에서 확인:
// / 응답에 x-powered-by: Express 가 붙어 있었고 계속 MISS 였다).
const rw = vercel.rewrites || [];
check("루트를 index.html 로", rw[0] && rw[0].source === "/" && rw[0].destination === "/index.html", JSON.stringify(rw[0]));
const pageRule = rw[1];
check("페이지 규칙이 그 다음", !!pageRule && /:page\(/.test(pageRule.source), JSON.stringify(pageRule));
check("포괄 규칙은 맨 마지막", rw[rw.length - 1].source === "/(.*)", JSON.stringify(rw[rw.length - 1]));
check("포괄 규칙이 함수로 넘긴다", rw[rw.length - 1].destination === "/api/index");

// 페이지 목록을 직접 적었으므로 낡을 수 있다. Web/src/app 과 대조한다.
const APP_PAGES = path.join(__dirname, "..", "..", "..", "Web", "src", "app");
const listed = (pageRule.source.match(/\(([^)]+)\)/) || [, ""])[1].split("|").filter(Boolean);
if (fs.existsSync(APP_PAGES)) {
  const actual = fs
    .readdirSync(APP_PAGES, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(APP_PAGES, e.name, "page.tsx")))
    .map((e) => e.name);
  const missing = actual.filter((p) => !listed.includes(p));
  const extra = listed.filter((p) => !actual.includes(p));
  check(`홈페이지 페이지가 전부 적혀 있다 (${actual.length}개)`, missing.length === 0, `빠짐: ${missing.join(", ")}`);
  check("없는 페이지가 적혀 있지 않다", extra.length === 0, `잉여: ${extra.join(", ")}`);
} else {
  out.push("  --   Web/ 이 없어 페이지 목록 대조는 건너뜀");
}

// 이 앱이 직접 처리해야 하는 주소가 정적 파일로 새어나가면 404 가 된다.
for (const own of ["admin", "api", "t"]) {
  check(`/${own}/ 는 페이지 규칙에 없다`, !listed.includes(own), listed.join(","));
}
check("함수 번들에 public/ 과 site/ 가 들어간다", /\{public,site\}/.test(vercel.functions["api/index.js"].includeFiles), vercel.functions["api/index.js"].includeFiles);
check("api/index.js 가 실제로 있다", fs.existsSync(path.join(APP, "api", "index.js")));

out.push("\n[브라우저 캐시 — site/ 는 Vercel 이 정적으로 내보내므로 엣지는 자동]");
const headerFor = (src) => {
  const h = (vercel.headers || []).find((x) => x.source === src);
  const cc = h && h.headers.find((k) => k.key === "Cache-Control");
  return cc ? cc.value : "";
};
check("_next/static 은 immutable (파일명에 해시가 박혀 있다)", /immutable/.test(headerFor("/_next/static/(.*)")), headerFor("/_next/static/(.*)"));
check("css/js/images 는 immutable 아님 (파일명이 안 바뀐다)", !/immutable/.test(headerFor("/(css|js|images)/(.*)")), headerFor("/(css|js|images)/(.*)"));
check("HTML 은 브라우저에 안 남긴다", /max-age=0/.test(headerFor("/(.*).html")), headerFor("/(.*).html"));

// stale-while-revalidate 는 브라우저에도 적용돼서 페이지를 열 때마다 배경
// 재검증 요청을 하나씩 더 만든다. 요청을 줄이려던 것이 늘어나므로 쓰지 않는다.
out.push("\n[stale-while-revalidate 금지 — 브라우저가 배경 요청을 더 만든다]");
for (const src of ["/_next/static/(.*)", "/(css|js|images)/(.*)", "/(.*).html"]) {
  check(`${src} 에 SWR 없음`, !/stale-while-revalidate/.test(headerFor(src)), headerFor(src));
}

// 함수가 답하는 경로(정적이 놓친 것)는 s-maxage 가 있어야 엣지가 캐시한다.
// CDN-Cache-Control 도 써봤지만 배포본에서 안 먹었다 — 문서화된 건 s-maxage 다.
out.push("\n[함수가 답하는 경로는 s-maxage 로 엣지 캐시를 지시한다]");
const site = fs.readFileSync(path.join(APP, "src", "site.js"), "utf8");
check("site.js 가 s-maxage 를 붙인다", /s-maxage=\d+/.test(site));
// 주석에는 왜 안 쓰는지 설명이 남아 있으므로, 실제로 내보내는 헤더 값만 본다.
const siteHeaderValues = (site.match(/setHeader\([^)]*\)/g) || []).join(" ");
check("site.js 도 SWR 은 안 쓴다", !/stale-while-revalidate/.test(siteHeaderValues), siteHeaderValues.slice(0, 200));
check("site.js 의 _next/static 은 immutable", /_next[\s\S]{0,500}?immutable/.test(site));

out.push("\n[빌드 시간 — npm ci 는 매번 처음부터다]");
// 주석에는 "npm ci" 가 왜 안 되는지 설명이 남아 있으므로, 실제 실행만 본다.
check("npm ci 를 실행하지 않는다", !/run\(\s*["'`]npm ci/.test(buildScript));
check("캐시를 우선한다", /--prefer-offline/.test(buildScript));
check("소스가 그대로면 재빌드를 건너뛴다", /재빌드 생략/.test(buildScript));

out.push("\n[크론은 그대로]");
check("정산 마감 크론 유지", Array.isArray(vercel.crons) && vercel.crons[0].path === "/api/settlements/cron-close");

out.push("\n[홈페이지에 다른 주소가 박히지 않는가]");
// 2026-09-10: 로컬에서 홈페이지만 따로 띄우는 줄 알고 Web/.env.local 에
// NEXT_PUBLIC_QR_APP_URL=http://localhost:3000 을 넣었다가, 실제 로컬 확인
// 방법은 dev:local 로 한 포트에 같이 띄우는 것이라 링크만 3000 을 가리키게
// 될 뻔했다. 빌드 시점에 박히는 값이라 화면에서야 드러난다 — 손님이
// 「온라인 주문」을 누르면 자기 컴퓨터를 열려고 한다.
{
  const buildSite = fs.readFileSync(path.join(APP, "scripts", "build-site.js"), "utf8");
  check("빌드가 localhost 가 박혔는지 확인한다",
    /localhost\|127\\\.0\\\.0\\\.1/.test(buildSite) || buildSite.includes("localhost|127"), "확인이 없다");
  check("박혀 있으면 배포를 멈춘다",
    /박혀 있습니다[\s\S]{0,400}process\.exit\(1\)/.test(buildSite), "멈추지 않는다");
  check("무엇을 고쳐야 하는지 알려준다", buildSite.includes("NEXT_PUBLIC_QR_APP_URL"), "안내가 없다");

  // 예시 파일이 잘못된 기본값을 권하면 같은 일이 반복된다.
  const example = path.join(WEB_ROOT, ".env.local.example");
  if (fs.existsSync(example)) {
    const ex = fs.readFileSync(example, "utf8");
    const active = ex.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
    check("예시 파일이 값을 켜둔 채로 두지 않는다", active.length === 0, active.join(" | "));
    check("예시 파일이 dev:local 을 권한다", ex.includes("dev:local"), "안내가 없다");
  }
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
