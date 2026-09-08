#!/usr/bin/env node
// 로컬 확인용 — 홈페이지와 주문 시스템을 한 포트에 같이 띄운다.
//
//   npm run dev:local          → http://localhost:3002
//   PORT=4000 npm run dev:local
//
// 2026-09-08부터는 홈페이지 서빙이 server.js 안으로 들어갔다(src/site.js).
// 배포도 같은 코드로 같은 일을 하므로, 이 파일이 하는 일은 이제 포트를
// 3002로 맞추고 어디를 열어보면 되는지 안내하는 것뿐이다. 예전에는 여기서
// 따로 정적 서빙을 했는데, 그러면 "로컬에서만 되는 구성"이 하나 더 생겨서
// 배포에서 처음 드러나는 차이가 생긴다.
require("dotenv").config();

const PORT = process.env.PORT || 3002;
const app = require("../server");
const { resolveSiteDir } = require("../src/site");

const siteDir = resolveSiteDir();

app.listen(PORT, () => {
  console.log(`\n  한국관 로컬  →  http://localhost:${PORT}`);
  if (siteDir) {
    console.log(`    홈페이지     http://localhost:${PORT}/`);
    console.log(`    로그인       http://localhost:${PORT}/login/`);
    console.log(`    내 계정      http://localhost:${PORT}/account/`);
  } else {
    console.log(`\n  [dev-local] 홈페이지 빌드가 없습니다 — 주문 시스템만 띄웁니다.`);
    console.log(`  [dev-local] 홈페이지도 보려면: cd ../../Web && npm install && npm run build\n`);
  }
  console.log(`    관리자       http://localhost:${PORT}/admin`);
  console.log(`    손님 주문    http://localhost:${PORT}/t/7`);
  console.log(`    DB           ${process.env.MONGODB_DB || "hangukgwan (기본값)"}\n`);
});
