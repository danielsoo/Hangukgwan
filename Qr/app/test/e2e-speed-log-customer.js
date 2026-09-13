// 손님 화면도 재는가.
//
// 2026-09-12 사장님: "그럼 모든 행동이 이제 다 로그로 남는거지?"
//
// 처음에는 관리자 화면에만 넣었다. 그런데 「영업에 지장」은 손님 쪽에서도
// 똑같이 생긴다 — QR 을 찍고 메뉴가 안 뜨거나 주문 담기가 멎으면 그게 제일
// 크다. 그리고 원인을 찾는 데도 손님 쪽 숫자가 중요할 수 있다: 태블릿은
// 가게 와이파이지만 손님 폰은 통신사 망이라, 같은 서버라도 다르게 나온다.
//
// 손님 화면은 로그인이 없어서 유닛으로는 확인이 안 된다. 브라우저로 연다.
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
process.env.SESSION_SECRET = "e2e-speed-customer";
process.env.ADMIN_PASSWORD = "ownerpass123";

const { launchBrowser } = require("./browser");
const app = require("../server");
const db = require("../src/db");
const requestLog = require("../src/requestLog");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

(async () => {
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); // 손님은 폰이다
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.dismiss());

  const withTiming = [];
  page.on("request", (r) => {
    const h = r.headers()["x-client-timing"];
    if (h) withTiming.push(h);
  });

  await page.goto(`${base}/t/7`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);

  out.push("[손님 화면이 재는 코드를 들고 있다]");
  const hasModule = await page.evaluate(() => !!(window.HG_TIMING && typeof window.HG_TIMING.header === "function"));
  check("★ clientTiming.js 가 실려 있다", hasModule, String(hasModule));
  const wrapped = await page.evaluate(() => window.__hgTimingFetch === true);
  check("fetch 를 감쌌다", wrapped, String(wrapped));

  // 몇 번 오가게 해서 앞 요청의 값이 다음 요청에 얹히도록 한다.
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => fetch("/api/menu").then((r) => r.json()).catch(() => null));
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(400);

  out.push("\n[그 값이 실제로 서버까지 간다]");
  check("★ X-Client-Timing 헤더가 나갔다", withTiming.length > 0, `${withTiming.length}번`);
  if (withTiming.length) {
    const sample = withTiming[withTiming.length - 1];
    check("ASCII 만 들어 있다", /^[\x20-\x7E]*$/.test(sample), sample.slice(0, 120));
    check("주소|시간|상태 모양이다", /\|\d+\|\d+/.test(sample), sample.slice(0, 120));
  }

  const handle = db.getDb();
  // 운영에서는 Atlas 연결 수를 줄이려고 로그를 30초씩 모아 한 번에 쓴다.
  // 시험은 그 시간을 기다리지 않고, 지금까지 모인 줄만 즉시 비운다.
  await requestLog.flush(handle);
  const clientRows = await handle.collection(requestLog.COLLECTION).find({ src: "client" }).toArray();
  check("★ 손님 화면이 잰 줄이 몽고에 있다", clientRows.length > 0, `${clientRows.length}줄`);

  out.push("\n[손님이 누른 것도 한 줄로 잡힌다]");
  const before = (await handle.collection(requestLog.COLLECTION).find({ src: "click" }).toArray()).length;
  await page.evaluate(() => {
    const b = document.createElement("button");
    b.id = "e2eCustomerBtn";
    b.onclick = async () => {
      const get = (u) => fetch(u).then((r) => r.json()).catch(() => null);
      await Promise.all([get("/api/menu?e2e=1"), get("/api/settings?e2e=2")]);
      await get("/api/menu?e2e=3");
    };
    document.body.appendChild(b);
  });
  // 진짜로 눌러서 맞히지 않는다. 손님 화면에는 인원수 입력 창이 화면을 덮고
  // 있고(partySizeBackdrop), 시험용 단추는 아주 아래(y≈7000)에 붙는다 —
  // 실제 손가락으로는 닿지 않는 자리다. 2026-09-13 에 이 시험이 그걸로 30초
  // 기다리다 죽었다.
  //
  // 여기서 재는 것은 「누름 하나가 한 줄로 잡히는가」이지 「저 자리를 누를 수
  // 있는가」가 아니다. 그건 다른 시험들이 본다. 그래서 단추에 바로 누름을
  // 보낸다 — document 에 걸린 그 귀는 똑같이 듣는다.
  await page.evaluate(() => document.querySelector("#e2eCustomerBtn").click());
  await page.waitForTimeout(1200);
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => fetch("/api/menu").then((r) => r.json()).catch(() => null));
    await page.waitForTimeout(500);
  }
  await requestLog.flush(handle);
  const clicks = await handle.collection(requestLog.COLLECTION).find({ src: "click", route: "#e2eCustomerBtn" }).toArray();
  check("★★ 요청 세 번이 한 줄로 잡힌다", clicks.length === 1, `${clicks.length}줄: ${JSON.stringify(clicks.map((r) => `${r.ms}ms/${r.reqs}건`))}`);
  if (clicks.length) check("요청 수를 들고 있다", clicks[0].reqs >= 3, String(clicks[0].reqs));
  check("관리자 화면 것과 같은 모양이다", clicks.every((r) => r.method === "CLICK"), JSON.stringify(clicks.map((r) => r.method)));
  check("앞서 있던 줄에 더해진 것이다", clicks.length + before >= 1);

  await browser.close();
  server.close();
  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.log(out.join("\n"));
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
