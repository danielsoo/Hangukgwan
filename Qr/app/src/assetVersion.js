// 배포했는데 화면은 그대로인 문제 — 정적 파일에 버전을 붙인다.
//
// 2026-09-10 사장님: "실시간주문 반응시간이 변화가 없어. 예전하고 똑같아."
// 고친 것은 배포돼 있었다(origin/main = 2e66259). 가게 태블릿의 POS 앱이
// 옛 admin.js 를 들고 있었을 뿐이다.
//
// 두 겹으로 그렇게 된다.
//
//  1. /admin 은 한 번 열면 계속 떠 있는 화면이다. 주문 목록만 계속 받아올
//     뿐 화면을 만드는 admin.js 자체는 다시 받지 않는다. 배포 전부터 열려
//     있던 탭은 배포 뒤에도 옛 코드를 돈다.
//  2. /js/*.js 와 /css/*.css 에 한 시간 캐시가 걸려 있다(server.js 의
//     express.static, 그리고 vercel.json 의 headers). 파일 이름에 버전이
//     없으므로 주소가 같고, 주소가 같으면 브라우저는 받아둔 것을 쓴다.
//     POS 앱은 WebView 라 더 끈질기다.
//
// server.js 의 그 캐시 설정 위에는 이미 이렇게 적혀 있었다 —
//   "고쳤다는데 왜 그대로냐"는 혼란이 반복됐다
// 반복된다고 적어만 두고 고치지 않았으니 또 반복된 것이다.
//
// ── 고치는 방법 ────────────────────────────────────────────────────────
//
// 파일 내용에서 짧은 지문을 뽑아 주소 뒤에 붙인다.
//
//     <script src="/js/admin.js"></script>
//     <script src="/js/admin.js?v=8f3a1c2b"></script>
//
// 내용이 바뀌면 지문이 바뀌고, 지문이 바뀌면 주소가 바뀌고, 주소가 바뀌면
// 브라우저는 받아둔 것을 못 쓴다. 안 바뀌었으면 주소도 그대로라 캐시가
// 그대로 듣는다 — 즉 캐시를 끄는 게 아니라 **정확할 때만 듣게** 하는 것이다.
//
// HTML 자체는 캐시하지 않는다(vercel.json 이 max-age=0, must-revalidate).
// 그래서 새 지문이 박힌 HTML 은 언제나 바로 도달한다.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PUBLIC_DIR = path.join(__dirname, "..", "public");
// 지문을 뜨는 대상. HTML 이 실제로 부르는 것들이다.
const WATCHED = ["js", "css"];

let cached = null;

/**
 * public/js 와 public/css 안의 모든 파일 내용에서 뽑은 짧은 지문.
 *
 * 파일 하나하나가 아니라 통째로 하나만 뽑는다. 배포는 어차피 한 번에
 * 일어나므로 파일별로 나눌 이유가 없고, 하나면 HTML 을 고칠 자리도 하나다.
 * 그 대신 css 만 바뀌어도 js 를 다시 받게 되는데, 배포는 자주 있는 일이
 * 아니고 두 파일 합쳐 1MB 남짓이라 그 편이 훨씬 단순하다.
 */
function assetVersion() {
  if (cached) return cached;
  cached = computeVersion(WATCHED.map((d) => path.join(PUBLIC_DIR, d)));
  return cached;
}

/**
 * 폴더 목록의 내용에서 지문을 뽑는다. assetVersion() 이 쓰는 알맹이를 따로
 * 둔 이유는 테스트 때문이다 — 이 함수의 핵심 성질은 "내용이 바뀌면 지문도
 * 바뀐다" 인데, 그걸 확인하려면 파일을 만들었다 지웠다 해야 한다. 진짜
 * public/ 안에서 그러면 테스트가 앱의 자산을 건드리게 된다.
 */
function computeVersion(dirs) {
  const h = crypto.createHash("sha1");
  for (const full of dirs) {
    let names = [];
    try {
      names = fs.readdirSync(full).sort();
    } catch (e) {
      continue; // 없는 폴더는 그냥 건너뛴다
    }
    for (const name of names) {
      const p = path.join(full, name);
      try {
        if (!fs.statSync(p).isFile()) continue;
        h.update(name);
        h.update(fs.readFileSync(p));
      } catch (e) {
        // 읽다 실패한 파일은 지문에서 빠질 뿐, 배포를 막지는 않는다.
      }
    }
  }
  return h.digest("hex").slice(0, 12);
}

/** 로컬 /js /css 주소에만 ?v= 를 붙인다. 바깥 주소(폰트 등)는 그대로. */
function stampHtml(html, version) {
  return String(html).replace(
    /(<(?:script|link)\b[^>]*\b(?:src|href)=")(\/(?:js|css)\/[^"?]+)(")/g,
    (_m, pre, url, post) => `${pre}${url}?v=${version}${post}`
  );
}

// 읽고 지문을 박은 결과를 들고 있는다. 서버리스 인스턴스 하나가 사는 동안
// 파일이 바뀔 일은 없다(바뀌면 새 배포이고, 그건 새 인스턴스다).
const rendered = new Map();

/** 지문이 박힌 HTML. 못 읽으면 null 을 돌려주니 부르는 쪽이 원래대로 보낸다. */
function stampedHtmlFile(fileName) {
  if (rendered.has(fileName)) return rendered.get(fileName);
  let out = null;
  try {
    out = stampHtml(fs.readFileSync(path.join(PUBLIC_DIR, fileName), "utf8"), assetVersion());
  } catch (e) {
    console.error("[assetVersion] HTML 을 못 읽었습니다:", fileName, e.message);
  }
  rendered.set(fileName, out);
  return out;
}

/**
 * express 핸들러. 지문을 박아 보내고, 어쩌다 실패하면 파일을 그대로 보낸다
 * — 버전 붙이기가 화면을 못 띄우는 이유가 되면 안 된다.
 */
function sendStamped(fileName) {
  return (req, res) => {
    const html = stampedHtmlFile(fileName);
    if (html == null) return res.sendFile(path.join(PUBLIC_DIR, fileName));
    res.set("Cache-Control", "no-cache");
    res.type("html").send(html);
  };
}

module.exports = { assetVersion, computeVersion, stampHtml, stampedHtmlFile, sendStamped, PUBLIC_DIR };
