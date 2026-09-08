// 홈페이지(Web/, Next.js 정적 내보내기)를 이 앱이 직접 서빙한다.
//
// 왜 이렇게 하나 — 2026-09-08:
// 원래는 홈페이지와 주문 시스템이 각각 별개의 Vercel 프로젝트였고,
// Web/vercel.json 의 rewrite 가 /api/*, /admin, /t/* 를 주문 시스템으로
// 넘겨주기로 되어 있었다. 그런데 배포된 홈페이지에서 실제로 확인해보니
// 그 rewrite 가 전혀 동작하지 않았다 (/api/account/me, /admin 둘 다 404).
// 통합 로그인은 서버가 내려주는 세션 쿠키로 동작하므로, 이 상태에서는
// 홈페이지의 로그인·회원가입·VIP·주문내역이 하나도 동작할 수 없다.
//
// 게다가 두 주소가 hangukgwan.vercel.app / hangookguan.vercel.app 처럼
// 둘 다 vercel.app 아래에 있으면, 설령 rewrite 를 고치더라도 브라우저가
// 그 둘 사이의 쿠키 공유를 아예 막는다 (vercel.app 은 Public Suffix List
// 에 올라 있는 공용 호스팅 도메인이라, 남의 Vercel 사이트가 우리 세션
// 쿠키를 읽는 걸 막기 위해 브라우저가 강제하는 규칙이다). 즉 커스텀
// 도메인을 사기 전까지 "두 주소 + 하나의 로그인" 은 성립하지 않는다.
//
// 그래서 한 출처로 합친다. 프록시가 끼지 않으니 rewrite 도 필요 없고,
// 브라우저 입장에서 홈페이지와 /api/* 가 문자 그대로 같은 사이트가 된다.
// 이 구조는 새로 만든 게 아니라 scripts/dev-local.js 가 로컬에서 이미
// 쓰던 것과 같다 — 이제 그쪽도 이 파일을 쓴다.
const path = require("path");
const fs = require("fs");
const express = require("express");

// 빌드된 홈페이지를 찾는다. 배포에서는 빌드 단계가 Web/out 을 이 앱 안의
// site/ 로 복사해 넣고(vercel.json 의 includeFiles 가 함께 올려준다),
// 로컬에서는 복사 없이 Web/out 을 그대로 쓴다.
function resolveSiteDir() {
  const candidates = [
    path.join(__dirname, "..", "site"),
    path.join(__dirname, "..", "..", "..", "Web", "out"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "index.html"))) return dir;
  }
  return null;
}

// Next.js 가 파일 이름에 내용 해시를 박아 내보내는 경로. 내용이 바뀌면
// 이름이 바뀌므로 오래 캐시해도 낡은 파일이 남을 일이 없다. 반대로 HTML
// 은 이름이 그대로라 짧게 잡는다 — 안 그러면 배포 후에도 손님 폰에
// 예전 페이지가 계속 보인다.
// max-age 는 **브라우저**용, s-maxage 는 **Vercel 엣지**용이다. 처음엔
// max-age 만 붙였는데, 배포본을 재보니 모든 응답이 x-vercel-cache: MISS 였다
// — 함수 응답은 s-maxage 가 있어야 엣지가 캐시한다. 엣지 캐시는 배포할 때마다
// 자동으로 비워지므로 길게 잡아도 낡은 파일이 남지 않는다.
//
// 이 파일이 응답하는 건 정적 출력(site/, vercel.json 의 outputDirectory)이
// 놓친 경로뿐이다 — 대부분은 여기까지 오지 않고 CDN 에서 끝난다.
function cacheControl(res, filePath) {
  if (filePath.includes(`${path.sep}_next${path.sep}static${path.sep}`)) {
    // 파일 이름에 내용 해시가 박혀 있어 내용이 바뀌면 이름이 바뀐다.
    res.setHeader("Cache-Control", "public, max-age=31536000, s-maxage=31536000, immutable");
  } else if (filePath.endsWith(".html")) {
    // max-age=0 은 브라우저용(배포 후에도 손님 폰에 예전 페이지가 보이면
    // 안 된다), s-maxage 는 엣지용(브라우저는 무시한다). 엣지 캐시는 배포마다
    // 자동으로 비워지므로 맡겨도 낡은 페이지가 남지 않는다.
    //
    // stale-while-revalidate 는 쓰지 않는다 — 공유 캐시뿐 아니라 브라우저
    // 캐시에도 적용돼서 페이지를 열 때마다 배경 재검증 요청을 하나씩 더
    // 만든다(요청을 줄이려다 늘어난다).
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600");
  }
}

// 홈페이지가 빌드돼 있으면 그걸 서빙하는 미들웨어를, 없으면 null 을
// 돌려준다. 없어도 주문 시스템은 평소대로 동작해야 한다 — 홈페이지 빌드
// 여부가 주문·관리자 기능을 좌우해서는 안 된다.
function siteMiddleware(dir = resolveSiteDir()) {
  if (!dir) return null;

  const router = express.Router();

  // /api 는 절대 가로채지 않는다. 홈페이지에 그런 파일이 있을 리 없지만,
  // 여기서 한 번 더 막아두는 편이 나중에 홈페이지에 api 라는 이름의
  // 페이지가 생겼을 때 API 가 조용히 가려지는 사고를 막아준다.
  router.use((req, res, next) => {
    if (req.path === "/api" || req.path.startsWith("/api/")) return next("router");
    next();
  });

  router.use(express.static(dir, { extensions: ["html"], setHeaders: cacheControl }));

  // next.config.mjs 의 trailingSlash: true 때문에 각 페이지는
  // out/<경로>/index.html 로 떨어진다. 위의 express.static 은 "/login/" 은
  // 처리하지만 "/login" (슬래시 없이)은 놓친다. 리다이렉트 대신 곧바로
  // 내려주는 이유: 리다이렉트로 처리하면 Vercel 쪽 trailingSlash 설정과
  // 얽혀서 /admin 까지 /admin/ 으로 튕길 위험이 있는데, /admin 은 이
  // 앱의 라우트라 그렇게 되면 관리자 화면이 통째로 죽는다.
  router.get(/.*/, (req, res, next) => {
    const rel = req.path.replace(/^\/+|\/+$/g, "");
    if (!rel) return next();
    const candidate = path.join(dir, rel, "index.html");
    if (!candidate.startsWith(dir + path.sep)) return next();
    if (!fs.existsSync(candidate)) return next();
    cacheControl(res, candidate);
    res.sendFile(candidate);
  });

  return router;
}

module.exports = { siteMiddleware, resolveSiteDir };
