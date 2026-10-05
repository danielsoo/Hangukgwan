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
  // 4) 윈도우에 흔히 있는 것들.
  //
  // 2026-10-05: **메인 사본이 윈도우 PC 인데 여기 경로가 없었다**(CLAUDE.md
  // 「세 곳에서 일한다」). PC 에서 e2e 를 돌리면 크롬이 깔려 있는데도
  // 「못 찾았습니다」로 죽었다. 그래서 유닛만 돌리고 e2e 는 한 번도 PC 에서
  // 못 돌렸다.
  //
  // 경로는 환경변수(ProgramFiles 등)로 만든다 — 한국어판 윈도우도 이 값은
  // 영어 경로지만 드라이브가 C: 가 아닌 컴퓨터가 있다.
  ...winPaths(),
];

/** 윈도우에 크롬·엣지가 깔리는 자리들. 윈도우가 아니면 빈 목록. */
function winPaths() {
  if (process.platform !== "win32") return [];
  const roots = [
    process.env.PROGRAMFILES,
    process.env["PROGRAMFILES(X86)"],
    process.env.LOCALAPPDATA,
  ].filter(Boolean);
  const rel = [
    "Google\\Chrome\\Application\\chrome.exe",
    "Google\\Chrome Beta\\Application\\chrome.exe",
    "Chromium\\Application\\chrome.exe",
    "Microsoft\\Edge\\Application\\msedge.exe",
  ];
  const out = [];
  for (const r of roots) for (const f of rel) out.push(r + "\\" + f);
  return out;
}

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
      "  · 윈도우면 Chrome 을 깔거나, 경로를 PLAYWRIGHT_CHROMIUM 으로 주세요.",
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
