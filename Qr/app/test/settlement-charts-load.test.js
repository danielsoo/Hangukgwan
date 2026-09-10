// 그래프 파일은 우리 서버에서 나간다.
//
// 사장님(2026-09-10): "여기도 볼 수 있게 해줘. 지금은 비어있어."
//
// ── 무슨 일이 있었나 ────────────────────────────────────────────────
//
// 결산의 「언제, 어디서」와 품목 그래프가 계속 빈칸이었다. admin.html 에
// cdnjs 의 Chart.js **4.4.4** 주소가 박혀 있었는데, cdnjs 에는 그 판이
// 아예 없다 — 있는 것은 4.4.0, 4.4.1, 그리고 최신 4.5.1. 404 가 떨어지고
// window.Chart 가 안 만들어지니, 그리는 함수들이 하나같이
//
//     if (!canvas || typeof Chart === "undefined") return;
//
// 로 **조용히** 돌아섰다. 화면에는 아무 말도 없이 빈 상자만 남았다.
//
// ── 이 파일이 지키는 두 가지 ────────────────────────────────────────
//
//   1. **그래프 파일은 우리 주소에서 나간다.** 주소만 고치면 또 난다.
//      가게 태블릿은 매장 와이파이의 WebView 이고, 사장님 매출 그래프가
//      남의 서버가 살아 있는지에 달려 있을 이유가 없다.
//   2. **못 그리면 못 그렸다고 적는다.** 빈 그래프는 「오늘 손님이 없었나
//      보다」로 읽힌다. 숫자가 없는 것과 그리지 못한 것은 다른 일이다.
const fs = require("fs");
const path = require("path");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const PUB = path.join(__dirname, "..", "public");
const html = fs.readFileSync(path.join(PUB, "admin.html"), "utf8");
const js = fs.readFileSync(path.join(PUB, "js", "admin.js"), "utf8");
const css = fs.readFileSync(path.join(PUB, "css", "admin.css"), "utf8");

out.push("[1] ★★ 그래프 파일이 실제로 저장소에 있다");
{
  const p = path.join(PUB, "js", "chart.umd.min.js");
  const exists = fs.existsSync(p);
  check("★ public/js/chart.umd.min.js 가 있다", exists, p);
  if (exists) {
    const src = fs.readFileSync(p, "utf8");
    check("빈 파일이 아니다 (100KB 넘는다)", src.length > 100000, `${src.length}자`);
    check("★ window.Chart 를 실제로 만든다", /window\.Chart\s*=/.test(src), "");
    check("어느 판인지 파일 안에 적혀 있다", /Chart\.js v4\./.test(src), src.slice(0, 60));
  }
}

out.push("\n[2] ★★ 화면이 그 파일을 부른다 — 바깥 주소가 아니라");
{
  check("★ 우리 주소를 부른다", /<script src="\/js\/chart\.umd\.min\.js"><\/script>/.test(html), "");
  // 바깥 CDN 주소가 하나라도 남아 있으면 그 하나가 또 404 가 된다.
  check("★ cdnjs 주소가 남아 있지 않다", !/cdnjs\.cloudflare\.com/.test(html), (html.match(/cdnjs[^"]*/) || [""])[0]);
  check("unpkg/jsdelivr 도 없다", !/unpkg\.com|jsdelivr/.test(html), "");
  // ?v= 지문은 서버가 /js/ 주소에만 붙인다(src/assetVersion.js). 우리
  // 주소로 옮겼으니 배포할 때마다 지문이 따라붙어, 태블릿이 옛 파일을
  // 붙들고 있는 일도 같이 없어진다.
  const { stampHtml } = require("../src/assetVersion");
  check("★ 배포 지문이 붙는다", /\/js\/chart\.umd\.min\.js\?v=abc123/.test(stampHtml(html, "abc123")), "");
}

out.push("\n[3] ★★ 못 그리면 말을 한다 (조용히 빈칸이 되지 않는다)");
{
  check("★ 조용히 돌아서는 코드가 없다", !/typeof Chart === "undefined"\) return;/.test(js), "");
  check("한 곳에서 판단한다", /function chartReady\(canvas\)/.test(js), "");
  // 그래프를 그리는 곳 전부가 그 판단을 거쳐야 한다. 하나라도 빠지면
  // 그 그래프만 다시 조용한 빈칸이 된다.
  const renderers = ["renderItemsChart", "renderTrendChart", "renderHourlyChart", "renderHistoryChart"];
  for (const fn of renderers) {
    const body = js.slice(js.indexOf(`function ${fn}(`), js.indexOf(`function ${fn}(`) + 400);
    check(`★ ${fn} 가 거친다`, /if \(!chartReady\(canvas\)\) return;/.test(body), body.slice(0, 120));
  }
  check("문구가 있다", /settlementChartUnavailable/.test(js), "");
  check("두 언어 모두 있다", (js.match(/settlementChartUnavailable:/g) || []).length === 2, "");
  check("그 자리에 보이게 하는 모양이 있다", /\.stl-chart-missing/.test(css), "");
}

out.push("\n[4] Chart.js 파일이 브라우저 없이도 실제로 실행된다");
{
  // 파일이 있다는 것만으로는 부족하다 — 받아온 파일이 깨져 있으면 화면은
  // 똑같이 빈칸이다. 여기서 한 번 돌려보고 Chart 가 생기는지 본다.
  const src = fs.readFileSync(path.join(PUB, "js", "chart.umd.min.js"), "utf8");
  const win = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
  const sandbox = { window: win, self: win, document: undefined, navigator: { userAgent: "node" } };
  let ran = false;
  let err = "";
  try {
    // UMD 는 module/exports 가 있으면 그쪽으로 간다. 브라우저처럼 보이게
    // 둘 다 없는 채로 돌려서 window.Chart 로 붙는 길을 확인한다.
    const vm = require("vm");
    vm.createContext(sandbox);
    new vm.Script(src).runInContext(sandbox, { timeout: 10000 });
    ran = typeof win.Chart === "function";
  } catch (e) {
    err = String(e && e.message).slice(0, 160);
  }
  check("★ 돌려보면 window.Chart 가 생긴다", ran, err || typeof win.Chart);
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
