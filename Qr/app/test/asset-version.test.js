// 배포한 것이 가게 화면에 닿는가.
//
// 2026-09-10 사장님: "실시간주문 반응시간이 변화가 없어. 예전하고 똑같아."
// 고친 것은 배포돼 있었다. 태블릿의 POS 앱(WebView)이 옛 admin.js 를 들고
// 있었을 뿐이다. 배경은 src/assetVersion.js 맨 위 주석.
//
// 이 테스트가 지키는 것: **화면을 만드는 파일 주소에 배포 지문이 박혀
// 나가는가.** 지문이 빠지면 다음 배포도 조용히 안 닿고, 그건 화면에
// 아무 오류도 안 남기므로 이런 테스트가 아니면 알아챌 방법이 없다.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"),
  filename: require.resolve("mongodb"),
  loaded: true,
  exports: fake,
  paths: [],
};
process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "asset-version-test";
process.env.ADMIN_PASSWORD = "ownerpass123";

const fs = require("fs");
const path = require("path");
const request = require("supertest");
const app = require("../server");
const { assetVersion, stampHtml } = require("../src/assetVersion");

let pass = 0, fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

(async () => {
  const ver = assetVersion();

  out.push("[1] 지문");
  check("지문이 나온다", /^[0-9a-f]{12}$/.test(ver), ver);
  check("같은 파일이면 같은 지문", assetVersion() === ver);

  out.push("\n[2] 어디에 붙고 어디에 안 붙나");
  {
    const html = stampHtml(
      [
        '<link rel="stylesheet" href="/css/admin.css" />',
        '<script src="/js/admin.js"></script>',
        '<link href="https://fonts.googleapis.com/css2?family=X" rel="stylesheet">',
        '<img src="/images/logo.png">',
        '<script src="/js/already.js?v=old"></script>',
      ].join("\n"),
      "TESTVER"
    );
    check("css 에 붙는다", html.includes('/css/admin.css?v=TESTVER'));
    check("js 에 붙는다", html.includes('/js/admin.js?v=TESTVER'));
    check("바깥 주소(구글 폰트)는 그대로", html.includes("fonts.googleapis.com/css2?family=X\" rel"));
    check("이미지는 건드리지 않는다", html.includes('<img src="/images/logo.png">'), html);
    check("이미 ?가 있는 주소는 두 번 안 붙인다", !html.includes("?v=old?v="), html);
  }

  out.push("\n[3] 실제로 그렇게 나가는가");
  {
    const r = await request(app).get("/admin");
    check("관리자 화면이 나온다", r.status === 200, String(r.status));
    check(`admin.js 에 지문이 박혀 있다 (?v=${ver})`, r.text.includes(`/js/admin.js?v=${ver}`), (r.text.match(/\/js\/admin\.js[^"]*/) || [""])[0]);
    check("admin.css 에도", r.text.includes(`/css/admin.css?v=${ver}`));
    check("지문 없는 옛 주소가 남아 있지 않다", !/src="\/js\/[^"?]+\.js"/.test(r.text), (r.text.match(/src="\/js\/[^"?]+\.js"/) || [""])[0]);
    check("HTML 은 캐시하지 말라고 말한다", /no-cache/.test(r.headers["cache-control"] || ""), r.headers["cache-control"]);

    const t = await request(app).get("/t/1");
    check("손님 주문 화면도 나온다", t.status === 200, String(t.status));
    check("order.js 에 지문이 박혀 있다", t.text.includes(`/js/order.js?v=${ver}`), (t.text.match(/\/js\/order\.js[^"]*/) || [""])[0]);
  }

  out.push("\n[4] 그 주소로 실제 파일이 나오는가");
  {
    // ?v= 가 붙어도 정적 파일은 그대로 나와야 한다. 안 그러면 화면이 통째로
    // 안 뜬다 — 캐시를 고치려다 화면을 깨뜨리는 것이 최악이다.
    const r = await request(app).get(`/js/admin.js?v=${ver}`);
    check("?v= 가 붙은 주소로도 js 가 나온다", r.status === 200, String(r.status));
    check("내용이 진짜 admin.js 다", r.text.includes("applyOrderUpdate"), r.text.slice(0, 80));
  }

  out.push("\n[5] 내용이 바뀌면 지문도 바뀌어야 한다");
  {
    // 이 성질이 이 파일 전체의 전제다. 내용이 바뀌어도 지문이 그대로면
    // 주소가 그대로고, 주소가 그대로면 브라우저는 옛 파일을 계속 쓴다 —
    // 바로 사장님이 겪은 그 상황으로 돌아간다.
    //
    // 진짜 public/ 을 건드리지 않고 임시 폴더로 잰다(computeVersion 이
    // 따로 있는 이유).
    const os = require("os");
    const { computeVersion } = require("../src/assetVersion");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "assetver-"));
    fs.writeFileSync(path.join(dir, "a.js"), "console.log(1)");
    const v1 = computeVersion([dir]);

    fs.writeFileSync(path.join(dir, "a.js"), "console.log(2)");
    const v2 = computeVersion([dir]);
    check("한 글자만 바뀌어도 지문이 달라진다", v1 !== v2, `${v1} -> ${v2}`);

    fs.writeFileSync(path.join(dir, "a.js"), "console.log(1)");
    check("되돌리면 지문도 돌아온다", computeVersion([dir]) === v1);

    fs.writeFileSync(path.join(dir, "b.js"), "// 새 파일");
    check("파일이 늘어도 달라진다", computeVersion([dir]) !== v1);

    check("없는 폴더를 줘도 죽지 않는다", /^[0-9a-f]{12}$/.test(computeVersion([path.join(dir, "없는폴더")])));

    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
