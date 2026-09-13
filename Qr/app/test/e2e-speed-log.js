// 화면이 잰 시간이 실제로 서버에 닿는가.
//
// 2026-09-12 사장님: "모든 이벤트에 속도를 측정할 수 있게 해줘. 분명 대만
// 기준 오늘 아침 영업때는 빨랐는데 저녁 영업때는 갑자기 느려졌어. 느려지면
// 영업에 지장이 가."
//
// 서버가 재는 값은 서버 안에서 보낸 시간뿐이다. 신주에서 서울까지 오가는
// 시간, 연결 맺는 시간, 함수가 깨어나는 시간은 서버가 자기 시계로 못 본다.
// 그런데 사장님이 기다리는 것은 그 전부다. 그래서 화면이 잰 값을 다음
// 요청의 헤더에 얹어 보낸다.
//
// 이건 브라우저에서만 확인할 수 있다. 유닛 테스트는 헤더를 직접 만들어
// 넣으므로, 「화면이 정말로 붙이는가」는 못 잰다 — 오늘 실제로 한 번
// 놓쳤다(붙이는 코드가 아예 안 들어간 채로 유닛 테스트는 전부 통과했다).
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
process.env.SESSION_SECRET = "e2e-speed-log";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

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
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.dismiss());

  // 실제로 나간 헤더를 본다 — 코드 모양이 아니라.
  const withTiming = [];
  page.on("request", (r) => {
    const h = r.headers()["x-client-timing"];
    if (h) withTiming.push(h);
  });

  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.locator("#loginPassword").pressSequentially("ownerpass123", { delay: 5 });
  await page.locator("#loginBtn").click();
  await page.waitForSelector("#dashboard", { state: "visible", timeout: 15000 });
  await page.waitForLoadState("networkidle");
  // 몇 번 더 오가게 해서 앞 요청의 값이 다음 요청에 얹히도록 한다.
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => fetch("/api/tables").then((r) => r.json()));
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(400);

  out.push("[화면이 잰 값을 붙여 보낸다]");
  check("★ X-Client-Timing 헤더가 실제로 나갔다", withTiming.length > 0, `${withTiming.length}번`);
  if (withTiming.length) {
    const sample = withTiming[withTiming.length - 1];
    check("주소|시간|상태 모양이다", /\/api\/[^|]*\|\d+\|\d+/.test(sample), sample.slice(0, 120));
    check("주소의 숫자는 :id 로 모인다 (있다면)", !/\/\d+\|/.test(sample), sample.slice(0, 120));
    check("ASCII 만 들어 있다 (아니면 브라우저가 요청을 거부한다)", /^[\x20-\x7E]*$/.test(sample), sample.slice(0, 120));
    check("헤더가 너무 커지지 않는다", sample.length <= 1500, `${sample.length}자`);
  }

  out.push("\n[그 값이 기록으로 남는다]");
  const handle = db.getDb();
  await page.evaluate(() => fetch("/api/tables").then((r) => r.json())); // 마지막 것을 밀어낸다
  await page.waitForTimeout(500);
  const clientRows = await handle.collection(requestLog.COLLECTION).find({ src: "client" }).toArray();
  check("★ 화면이 잰 줄이 몽고에 있다", clientRows.length > 0, `${clientRows.length}줄`);
  const serverRows = await handle.collection(requestLog.COLLECTION).find({ src: "server" }).toArray();
  check("서버가 잰 줄도 있다", serverRows.length > 0, `${serverRows.length}줄`);
  check("서버 줄에는 몽고 시간이 들어 있다", serverRows.some((r) => typeof r.mongo_ms === "number"), JSON.stringify(serverRows[0] || {}).slice(0, 160));

  out.push("\n[★ 누른 것 하나가 통째로 잡힌다 — 요청이 몇 개든]");
  // 2026-09-12 사장님: "탭 변경, 버튼, 결제 완료 등 모든 클릭에 적용되는
  // 거지?" 요청 단위로 재면 결제 완료 한 번이 PATCH 세 줄로 흩어져서,
  // 정작 기다린 시간이 어디에도 안 남는다.
  const clicksBefore = (await handle.collection(requestLog.COLLECTION).find({ src: "click" }).toArray()).length;

  // (가) 요청을 보내는 누름 — 탭 전환
  await page.locator('[data-tab="settlement"]').first().click().catch(() => {});
  await page.waitForTimeout(900);
  // (나) 요청을 하나도 안 보내는 누름 — 그래도 화면은 그린다
  await page.locator('[data-tab="orders"]').first().click().catch(() => {});
  await page.waitForTimeout(900);
  // 담긴 것을 밀어낸다
  await page.evaluate(() => fetch("/api/tables").then((r) => r.json()));
  await page.waitForTimeout(600);
  await page.evaluate(() => fetch("/api/tables").then((r) => r.json()));
  await page.waitForTimeout(600);

  const clickRows = await handle.collection(requestLog.COLLECTION).find({ src: "click" }).toArray();
  check("★ 누름이 기록된다", clickRows.length > clicksBefore, `${clicksBefore} → ${clickRows.length}`);
  check(
    "★ 탭 전환이 이름으로 남는다",
    clickRows.some((r) => /^tab:/.test(r.route || "")),
    JSON.stringify(clickRows.map((r) => r.route).slice(0, 8))
  );
  check(
    "요청을 안 보낸 누름도 남는다 (화면 그리는 시간)",
    clickRows.some((r) => (r.reqs || 0) === 0),
    JSON.stringify(clickRows.map((r) => `${r.route}:${r.reqs}`).slice(0, 8))
  );
  check(
    "그 누름이 요청을 몇 개 보냈는지 안다",
    clickRows.some((r) => typeof r.reqs === "number"),
    JSON.stringify(clickRows[0] || {}).slice(0, 160)
  );
  check(
    "걸린 시간이 0 이상이고 말이 되는 값이다",
    clickRows.every((r) => typeof r.ms === "number" && r.ms >= 0 && r.ms < 60000),
    JSON.stringify(clickRows.map((r) => r.ms).slice(0, 8))
  );

  out.push("\n[★★ 결제 완료처럼 요청을 여러 번 보내는 누름 — 한 줄인가]");
  // 결제 완료는 한 자리에 주문이 N 개면 PATCH 를 N 번 보낸다. 요청 단위로만
  // 재면 "200ms 짜리 세 줄"이 되고, 사장님이 기다린 1.8초는 사라진다.
  // 게다가 응답을 받고 **그 뒤에** 목록을 다시 부르는 자리도 많다 — 그
  // 사이를 끊으면 한 번의 누름이 두 줄로 쪼개진다.
  await page.evaluate(() => {
    const b = document.createElement("button");
    b.id = "e2eMultiBtn";
    b.textContent = "multi";
    b.onclick = async () => {
      // 하나가 실패해도 뒤엣것이 안 나가면 재는 것이 아니라 시나리오를
      // 재게 된다. 전부 삼킨다.
      const get = (u) => fetch(u).then((r) => r.json()).catch(() => null);
      // 주소마다 다른 꼬리를 붙인다. 로그인할 때 한 번에 받아둔 답이 아직
      // 남아 있으면(/api/bootstrap 의 bootCache) 그 요청은 네트워크로 안
      // 나가고, 그러면 여기서 세는 숫자가 시나리오가 아니라 캐시 상태를
      // 재게 된다. 2026-09-12 에 실제로 그래서 3 이 나왔다(그리고 그 3 은
      // 틀린 값이 아니었다 — 정말 세 번만 나갔다).
      await Promise.all([get("/api/tables?e2e=1"), get("/api/orders?e2e=2"), get("/api/zones?e2e=3")]);
      // 응답 뒤에 한 번 더 — 여기까지 한 줄이어야 한다
      await get("/api/tables?e2e=4");
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
  await page.evaluate(() => document.querySelector("#e2eMultiBtn").click());
  await page.waitForTimeout(1200);
  await page.evaluate(() => fetch("/api/tables").then((r) => r.json()));
  await page.waitForTimeout(500);
  await page.evaluate(() => fetch("/api/tables").then((r) => r.json()));
  await page.waitForTimeout(500);

  const multi = (await handle.collection(requestLog.COLLECTION).find({ src: "click", route: "#e2eMultiBtn" }).toArray());
  check("★★ 요청 네 번이 한 줄로 잡힌다", multi.length === 1, `${multi.length}줄: ${JSON.stringify(multi.map((r) => `${r.ms}ms/${r.reqs}건`))}`);
  if (multi.length) {
    check("그 한 줄이 요청 수를 들고 있다", multi[0].reqs >= 4, String(multi[0].reqs));
    check(
      "★ 응답 뒤의 요청까지 포함한 시간이다",
      multi[0].ms > 0,
      `${multi[0].ms}ms`
    );
  }

  out.push("\n[사장 화면에서 그 요약을 볼 수 있다]");
  await page.locator('.tab-btn[data-tab="settings"], [data-tab="settings"]').first().click().catch(() => {});
  await page.waitForTimeout(300);
  const navOk = await page.locator('.settings-nav-btn[data-category="diag"]').count();
  check("설정에 「진단 · 속도」 자리가 있다", navOk > 0, String(navOk));
  if (navOk) {
    await page.locator('.settings-nav-btn[data-category="diag"]').click();
    await page.waitForTimeout(800);
    const text = await page.locator("#diagSummary").innerText();
    check("★ 빈 화면이 아니다", text.trim().length > 0, text.slice(0, 120));
    check("불러오지 못했다고 하지 않는다", !/불러오지 못/.test(text), text.slice(0, 160));
    check("★ 시간대별이 보인다 (아침과 저녁을 가르는 표)", /시간대별/.test(text) || /아직 쌓인/.test(text), text.slice(0, 200));
    check("★ 누른 것 하나가 표로 보인다", /누른 것 하나/.test(text) || /아직 쌓인/.test(text), text.slice(0, 300));
    check("내려받기 버튼이 있다", (await page.locator("#diagDownloadBtn").count()) > 0);
  }

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
