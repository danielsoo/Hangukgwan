#!/usr/bin/env node
// 배포 빌드 — 홈페이지(Web/)를 빌드해서 이 앱의 site/ 로 모은다.
//
// site/ 는 vercel.json 의 outputDirectory 라서, 여기 들어가는 것은 Vercel
// 이 CDN 에서 바로 내보내고 서버리스 함수를 거치지 않는다. 함수가 맡는 건
// /api/*, /admin, /t/* 뿐이다. (자세한 배경은 vercel.json 주석.)
//
// Vercel 설정에서 이 프로젝트의 Root Directory 는 Qr/app 이어야 하고,
// "Include files outside of the Root Directory" 를 켜야 ../../Web 이 보인다.
const { execSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const APP_DIR = path.join(__dirname, "..");
const WEB_DIR = path.join(APP_DIR, "..", "..", "Web");
const OUT_DIR = path.join(WEB_DIR, "out");
const DEST = path.join(APP_DIR, "site");
const STAMP = path.join(DEST, ".build-stamp");

function run(cmd, cwd) {
  console.log(`[build-site] ${cmd}  (${cwd})`);
  execSync(cmd, { cwd, stdio: "inherit" });
}

// site/ 는 어떤 경우에도 존재해야 한다. 없으면 Vercel 이 outputDirectory 를
// 못 찾아 배포 자체가 실패한다 — 홈페이지를 못 만든 것과 배포가 죽는 것은
// 전혀 다른 문제다.
fs.mkdirSync(DEST, { recursive: true });

// 홈페이지 빌드가 없을 때 "/" 를 관리자 화면으로 안내하는 최소 페이지.
// vercel.json 의 첫 rewrite 가 "/" 를 /index.html 로 보내는데, 그 파일이
// 없으면 Vercel 은 다음 규칙으로 넘어가지 않고 그냥 404 를 낸다(맞는 규칙
// 하나를 적용하고 멈춘다). 예전에는 이 경우 server.js 가 /admin 으로
// 보내줬으므로, 그 동작을 여기서 지켜준다.
function writeAdminFallback() {
  fs.writeFileSync(
    path.join(DEST, "index.html"),
    [
      "<!doctype html>",
      '<html lang="ko"><head><meta charset="utf-8">',
      '<meta http-equiv="refresh" content="0; url=/admin">',
      "<title>한국관</title></head>",
      '<body><p>관리자 화면으로 이동합니다 — <a href="/admin">/admin</a></p></body></html>',
      "",
    ].join("\n")
  );
}

// 관리자·주문 화면이 쓰는 정적 자산도 CDN 에서 나가게 같이 올린다.
// 함수 안의 public/ 사본은 그대로 두고(라우트들이 sendFile 로 쓴다) 복사만
// 한다 — 둘 중 먼저 걸리는 쪽은 Vercel 의 정적 파일이다.
function copyPublicAssets() {
  for (const name of ["css", "js", "images"]) {
    const src = path.join(APP_DIR, "public", name);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(DEST, name), { recursive: true });
  }
}

if (!fs.existsSync(path.join(WEB_DIR, "package.json"))) {
  console.warn("[build-site] Web/ 이 안 보입니다 — 홈페이지 없이 진행합니다.");
  console.warn("[build-site] Vercel 프로젝트 설정에서 'Include files outside of");
  console.warn("[build-site] the Root Directory in the Build Step' 를 켜주세요.");
  copyPublicAssets();
  writeAdminFallback();
  process.exit(0);
}

// 홈페이지 소스가 지난 빌드와 같으면 다시 빌드하지 않는다. Vercel 이
// site/ 를 캐시해 준 경우 배포에서 40초(npm install 20 + next build 20)가
// 통째로 빠진다. 캐시가 없으면 스탬프도 없으니 평소대로 전부 빌드한다.
function sourceFingerprint() {
  const h = crypto.createHash("sha1");
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.name === "node_modules" || e.name === "out" || e.name === ".next") continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else h.update(p.slice(WEB_DIR.length)).update(fs.readFileSync(p));
    }
  };
  for (const sub of ["src", "public"]) {
    const p = path.join(WEB_DIR, sub);
    if (fs.existsSync(p)) walk(p);
  }
  for (const f of ["package.json", "package-lock.json", "next.config.mjs", "tailwind.config.ts", "tsconfig.json"]) {
    const p = path.join(WEB_DIR, f);
    if (fs.existsSync(p)) h.update(f).update(fs.readFileSync(p));
  }
  return h.digest("hex");
}

const fingerprint = sourceFingerprint();
const cached = fs.existsSync(STAMP) && fs.readFileSync(STAMP, "utf8").trim() === fingerprint;

if (cached && fs.existsSync(path.join(DEST, "index.html"))) {
  console.log("[build-site] 홈페이지 소스가 지난 빌드와 같습니다 — 재빌드 생략.");
} else {
  // npm ci 는 설계상 node_modules 를 통째로 지우고 다시 깐다. 그러면 캐시가
  // 있어도 무조건 처음부터라, 배포마다 20초를 그냥 버린다. install 은 이미
  // 맞는 게 있으면 건너뛴다. --prefer-offline 은 네트워크보다 로컬 캐시 우선,
  // --no-audit/--no-fund 는 빌드에서 아무 의미 없는 네트워크 왕복 제거.
  run("npm install --prefer-offline --no-audit --no-fund", WEB_DIR);
  run("npm run build", WEB_DIR);

  if (!fs.existsSync(path.join(OUT_DIR, "index.html"))) {
    console.error("[build-site] 빌드는 끝났는데 Web/out/index.html 이 없습니다.");
    process.exit(1);
  }
  fs.rmSync(DEST, { recursive: true, force: true });
  fs.cpSync(OUT_DIR, DEST, { recursive: true });
  fs.writeFileSync(STAMP, fingerprint);
}

copyPublicAssets();

// 통합 로그인이 실제로 서빙될지 여기서 확인한다. 빌드는 성공했는데 로그인
// 페이지가 안 들어간 채로 배포되면, 겉보기엔 멀쩡하고 손님이 가입 버튼을
// 누를 때에야 드러난다.
for (const required of ["login", "signup", "account"]) {
  if (!fs.existsSync(path.join(DEST, required, "index.html"))) {
    console.error(`[build-site] /${required}/ 가 빌드 결과에 없습니다 — 배포 중단.`);
    process.exit(1);
  }
}

const pages = fs
  .readdirSync(DEST, { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(DEST, e.name, "index.html")))
  .map((e) => `/${e.name}/`);
console.log(`[build-site] site/ 준비 완료 — 페이지: / ${pages.join(" ")}`);
