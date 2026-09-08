#!/usr/bin/env node
// 배포 빌드 — 홈페이지(Web/)를 빌드해서 이 앱 안의 site/ 로 복사한다.
// vercel.json 의 buildCommand 가 이걸 부르고, includeFiles 가 site/** 를
// 서버리스 함수와 함께 올려준다. 실제 서빙은 src/site.js 가 한다.
//
// Vercel 설정에서 이 프로젝트의 Root Directory 는 Qr/app 이어야 하고,
// "Include files outside of the Root Directory" 를 켜야 ../../Web 이 보인다.
// 그게 꺼져 있으면 아래 SITE_SRC 가 없어서 홈페이지 없이 빌드가 끝난다 —
// 주문 시스템과 관리자 화면은 그래도 정상 동작하고, 로그로 알려준다.
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const APP_DIR = path.join(__dirname, "..");
const WEB_DIR = path.join(APP_DIR, "..", "..", "Web");
const OUT_DIR = path.join(WEB_DIR, "out");
const DEST = path.join(APP_DIR, "site");

function run(cmd, cwd) {
  console.log(`[build-site] ${cmd}  (${cwd})`);
  execSync(cmd, { cwd, stdio: "inherit" });
}

if (!fs.existsSync(path.join(WEB_DIR, "package.json"))) {
  console.warn("[build-site] Web/ 이 안 보입니다 — 홈페이지 없이 진행합니다.");
  console.warn("[build-site] Vercel 프로젝트 설정에서 'Include files outside of");
  console.warn("[build-site] the Root Directory in the Build Step' 를 켜주세요.");
  process.exit(0);
}

// npm ci 는 package-lock.json 이 있어야 하고, 없으면 install 로 떨어진다.
run(fs.existsSync(path.join(WEB_DIR, "package-lock.json")) ? "npm ci" : "npm install", WEB_DIR);
run("npm run build", WEB_DIR);

if (!fs.existsSync(path.join(OUT_DIR, "index.html"))) {
  console.error("[build-site] 빌드는 끝났는데 Web/out/index.html 이 없습니다.");
  process.exit(1);
}

fs.rmSync(DEST, { recursive: true, force: true });
fs.cpSync(OUT_DIR, DEST, { recursive: true });

const pages = fs
  .readdirSync(DEST, { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(DEST, e.name, "index.html")))
  .map((e) => `/${e.name}/`);
console.log(`[build-site] site/ 준비 완료 — 페이지: / ${pages.join(" ")}`);

// 통합 로그인이 실제로 서빙될지 여기서 확인한다. 빌드는 성공했는데 로그인
// 페이지가 안 들어간 채로 배포되면, 겉보기엔 멀쩡하고 손님이 가입 버튼을
// 누를 때에야 드러난다.
for (const required of ["login", "signup", "account"]) {
  if (!fs.existsSync(path.join(DEST, required, "index.html"))) {
    console.error(`[build-site] /${required}/ 가 빌드 결과에 없습니다 — 배포 중단.`);
    process.exit(1);
  }
}
