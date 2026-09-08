#!/usr/bin/env node
// 로컬 확인용 — 홈페이지(Web/)와 주문 시스템을 한 포트에 같이 띄운다.
//
//   npm run dev:local          → http://localhost:3002
//   PORT=4000 npm run dev:local
//
// 왜 한 포트여야 하나: 통합 로그인은 서버가 내려주는 세션 쿠키로 동작한다.
// 홈페이지를 3000, API를 3002처럼 따로 띄우면 브라우저가 둘을 다른 사이트로
// 보기 때문에 로그인해도 쿠키가 안 붙어서 "로그인이 안 되는 것처럼" 보인다.
// 실제 배포에서는 vercel.json 의 rewrite 가 /api/* 를 주문 시스템으로
// 넘겨서 같은 효과를 내고, 나중에 커스텀 도메인 하나로 합치면 이 파일이
// 하는 일과 완전히 같아진다.
//
// ⚠️ 이 파일은 로컬 확인 전용이다. 배포(Vercel)는 api/index.js → server.js 로
// 들어가므로 여기를 거치지 않는다.
require("dotenv").config();

const path = require("path");
const fs = require("fs");
const express = require("express");

const SITE_OUT = path.join(__dirname, "..", "..", "..", "Web", "out");
const PORT = process.env.PORT || 3002;

const host = express();

if (fs.existsSync(path.join(SITE_OUT, "index.html"))) {
  host.use(express.static(SITE_OUT, { extensions: ["html"] }));
  // next.config.mjs 의 trailingSlash: true 때문에 각 페이지는
  // out/<경로>/index.html 로 떨어진다. "/login" (슬래시 없이)도 이어준다.
  // /api 는 절대 가로채지 않는다 — 주문 시스템이 처리해야 한다.
  host.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) return next();
    const rel = req.path.replace(/^\/+|\/+$/g, "");
    const candidate = path.join(SITE_OUT, rel, "index.html");
    if (candidate.startsWith(SITE_OUT) && fs.existsSync(candidate)) return res.sendFile(candidate);
    next();
  });
} else {
  console.log("\n[dev-local] 홈페이지 빌드가 없습니다 — 주문 시스템만 띄웁니다.");
  console.log("[dev-local] 홈페이지도 보려면: cd ../../Web && npm install && npm run build\n");
}

host.use(require("../server"));

host.listen(PORT, () => {
  const has = fs.existsSync(path.join(SITE_OUT, "index.html"));
  console.log(`\n  한국관 로컬  →  http://localhost:${PORT}`);
  if (has) console.log(`    홈페이지     http://localhost:${PORT}/`);
  console.log(`    관리자       http://localhost:${PORT}/admin`);
  console.log(`    손님 주문    http://localhost:${PORT}/t/7`);
  if (has) console.log(`    로그인       http://localhost:${PORT}/login/`);
  console.log(`    DB           ${process.env.MONGODB_DB || "hangukgwan (기본값)"}\n`);
});
