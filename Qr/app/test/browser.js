// e2e 가 쓸 브라우저를 어디서 찾을지.
//
// 2026-09-10: e2e 파일 16개가 전부 이렇게 브라우저를 켜고 있었다.
//
//     chromium.launch({ executablePath: "/opt/pw-browsers/chromium" })
//
// 그 경로는 클라우드 컨테이너에만 있다. 맥에는 없다. 그래서 맥에서
// `npm run test:e2e` 를 치면 두 가지 이유로 죽었다 — playwright 가 아예
// 설치돼 있지 않았고, 설치하더라도 저 경로가 없어서 실행이 안 됐다.
//
// 여기서 순서대로 찾는다. 어느 컴퓨터에서 돌리든 맞는 것을 고르게.
//
// 왜 `playwright` 가 아니라 `playwright-core` 인가: `playwright` 는 설치할
// 때 브라우저 세 종류를 통째로 내려받는다(수백 MB). 그런데 이 테스트들은
// 위처럼 브라우저 경로를 직접 넘기고 있어서 그 다운로드가 쓰이지 않는다.
// 게다가 devDependencies 에 들어가면 Vercel 이 배포할 때마다 그걸 받게 되어
// 빌드가 느려진다(빌드 시간은 claude/2026-09-08-speed-fixes.md 에서 40초를
// 0초로 줄여둔 참이다). `playwright-core` 는 같은 API 를 주면서 브라우저를
// 안 받는다.
const fs = require("fs");
const { execSync } = require("child_process");

const CANDIDATES = [
  // 1) 직접 지정. 어디서든 이게 최우선이다.
  process.env.PLAYWRIGHT_CHROMIUM,
  // 2) 클라우드 컨테이너에 미리 깔려 있는 것.
  "/opt/pw-browsers/chromium",
  // 3) 맥에 흔히 있는 것들.
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
];

// 4) 리눅스는 PATH 에서 찾는다.
function fromPath() {
  for (const name of ["google-chrome", "chromium", "chromium-browser"]) {
    try {
      const p = execSync(`command -v ${name}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
      if (p) return p;
    } catch (e) {
      /* 없으면 다음 */
    }
  }
  return null;
}

function chromiumPath() {
  for (const p of CANDIDATES) {
    if (p && fs.existsSync(p)) return p;
  }
  const found = fromPath();
  if (found) return found;
  throw new Error(
    [
      "e2e 를 돌릴 크롬을 못 찾았습니다.",
      "",
      "  · 맥이면 Google Chrome 을 깔거나, 아래처럼 경로를 직접 주세요:",
      '      PLAYWRIGHT_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run test:e2e',
      "  · 클라우드 컨테이너면 /opt/pw-browsers/chromium 이 있어야 합니다.",
      "",
      "찾아본 곳:",
      ...CANDIDATES.filter(Boolean).map((p) => `      ${p}`),
      "      PATH 의 google-chrome / chromium / chromium-browser",
    ].join("\n")
  );
}

/** 테스트들이 쓰는 한 줄. chromium.launch 를 대신한다. */
async function launchBrowser(opts = {}) {
  const { chromium } = require("playwright-core");
  return chromium.launch({ executablePath: chromiumPath(), ...opts });
}

module.exports = { launchBrowser, chromiumPath };
