// 결제 탭 배치도가 화면을 꽉 채우는가.
//
// 2026-09-13 사장님: "결제 화면을 화면에 꽉차게 키워줄 수 있어?"
// (어느 화면인지 여쭤보니 "실시간 주문 탭 바로 옆에 있는 결재탭")
//
// 배치도는 「테이블 / QR 코드」 탭에서 잡은 픽셀 좌표 그대로 그린다. 그
// 좌표는 배치를 만들 때의 화면 크기에 맞춰져 있어서, 큰 화면에서는 왼쪽
// 위에 작게 몰려 있고 나머지가 전부 빈 자리가 된다. 영업 중에 자리를
// 눌러야 하는 화면인데 표적이 작으면 그만큼 잘못 누른다.
//
// 여기서 재는 것은 세 가지다.
//   1. 정말 커졌는가 (빈 자리가 줄었는가)
//   2. **잘리지 않았는가** — 키우다가 자리 하나가 화면 밖으로 나가면,
//      그 자리는 결제를 못 받는다. 커진 것보다 이게 중요하다
//   3. 화면 크기가 바뀌면 다시 맞추는가
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
process.env.SESSION_SECRET = "e2e-payment-floor-fit";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const { launchBrowser } = require("./browser");
const app = require("../server");
const db = require("../src/db");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

async function openPaymentTab(page) {
  await page.locator('[data-tab="payment"]').first().click();
  await page.waitForTimeout(500);
}

// 화면에 실제로 보이는 자리 타일들의 크기와 위치.
async function tiles(page) {
  return page.evaluate(() => {
    const wrap = document.querySelector("#paymentFloorPlan");
    const stage = wrap && wrap.querySelector(".floor-stage");
    const els = [...document.querySelectorAll("#paymentFloorPlan .table-block")];
    return {
      wrap: wrap ? wrap.getBoundingClientRect().toJSON() : null,
      hasStage: !!stage,
      transform: stage ? getComputedStyle(stage).transform : "",
      viewportH: window.innerHeight,
      viewportW: window.innerWidth,
      tiles: els.map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
      }),
    };
  });
}

(async () => {
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchBrowser();
  // 가게 태블릿만 한 큰 화면. 배치도가 작게 몰려 있던 것이 바로 이런 화면이다.
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.dismiss());

  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  // 씨앗 자료는 첫 /api 요청 때 만들어진다. 위의 화면 열기가 그걸 부른다.
  // 씨앗 자료는 자리를 구역에 안 붙여 둔다(zone_id 없음). 그러면 배치도에
  // 자리 타일이 하나도 안 그려져서, 이 테스트가 재려는 것 자체가 없어진다.
  // 실제 가게처럼 구역 안에 자리를 몇 개 놓아 준다.
  await db.connectDB();
  {
    const handle = db.getDb();
    const doc = await handle.collection("store").findOne({ _id: "main" });
    const zones = doc.zones || [];
    const tables = doc.tables || [];
    if (!zones.length || !tables.length) throw new Error("씨앗 자료에 구역이나 자리가 없다");
    // 첫 구역 안에 가로로 여섯 개.
    for (let i = 0; i < 6 && i < tables.length; i++) {
      tables[i].zone_id = zones[0].id;
      tables[i].x = 10 + (i % 3) * 90;
      tables[i].y = 30 + Math.floor(i / 3) * 90;
      tables[i].width = 70;
      tables[i].height = 70;
    }
    await handle.collection("store").updateOne({ _id: "main" }, { $set: { tables } });
  }

  await page.locator("#loginPassword").pressSequentially("ownerpass123", { delay: 5 });
  await page.locator("#loginBtn").click();
  await page.waitForSelector("#dashboard", { state: "visible", timeout: 15000 });
  await page.waitForLoadState("networkidle");

  await openPaymentTab(page);
  const after = await tiles(page);

  out.push("[자리 타일이 실제로 그려졌다 — 아래 측정의 전제]");
  check("★ 자리 타일이 있다", after.tiles.length > 0, `${after.tiles.length}개`);
  check("확대용 층이 생겼다", after.hasStage, String(after.hasStage));
  if (!after.tiles.length) {
    console.log(out.join("\n"));
    console.log(`\n${pass} passed, ${fail + 1} failed\n`);
    await browser.close(); server.close();
    process.exit(1);
  }

  out.push("\n[커졌는가]");
  // 확대를 끄고 같은 것을 재서 견준다. 「크다」는 견줄 것이 있어야 말이 된다.
  const beforeTiles = await page.evaluate(() => {
    const stage = document.querySelector("#paymentFloorPlan .floor-stage");
    const keep = stage.style.transform;
    stage.style.transform = "none";
    const els = [...document.querySelectorAll("#paymentFloorPlan .table-block")];
    const out = els.map((e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height }; });
    stage.style.transform = keep;
    return out;
  });
  const areaBefore = beforeTiles.reduce((a, t) => a + t.w * t.h, 0);
  const areaAfter = after.tiles.reduce((a, t) => a + t.w * t.h, 0);
  check(
    "★ 자리 타일이 예전보다 커졌다",
    areaAfter > areaBefore * 1.2,
    `${Math.round(areaBefore)} → ${Math.round(areaAfter)} (배율 ${(areaAfter / areaBefore).toFixed(2)})`
  );
  const m = /matrix\(([-\d.]+)/.exec(after.transform || "");
  const scale = m ? Number(m[1]) : 1;
  check("확대 배율이 1보다 크다", scale > 1.05, String(scale));
  check("끝없이 커지지는 않는다", scale <= 4.01, String(scale));

  out.push("\n[★★ 잘리지 않았는가 — 잘린 자리는 결제를 못 받는다]");
  const wrapBox = after.wrap;
  const overflowRight = after.tiles.filter((t) => t.right > wrapBox.right + 1);
  const overflowBottom = after.tiles.filter((t) => t.bottom > wrapBox.bottom + 1);
  const offScreen = after.tiles.filter((t) => t.bottom > after.viewportH + 1 || t.right > after.viewportW + 1);
  check("★★ 오른쪽으로 삐져나간 자리가 없다", overflowRight.length === 0, `${overflowRight.length}개`);
  check("★★ 아래로 삐져나간 자리가 없다", overflowBottom.length === 0, `${overflowBottom.length}개`);
  check("★★ 화면 밖으로 나간 자리가 없다", offScreen.length === 0, `${offScreen.length}개`);
  check("모든 자리가 보이는 크기다", after.tiles.every((t) => t.w > 4 && t.h > 4), JSON.stringify(after.tiles.slice(0, 3)));

  out.push("\n[누를 수 있는가 — 키운 뒤에도 그 자리가 열려야 한다]");
  await page.locator("#paymentFloorPlan .table-block").first().click();
  await page.waitForTimeout(600);
  const opened = await page.locator("#tableDetailBackdrop").isVisible().catch(() => false);
  check("★ 자리를 누르면 결제 창이 열린다", opened, String(opened));
  if (opened) await page.locator("#tableDetailClose").click().catch(() => {});
  await page.waitForTimeout(300);

  out.push("\n[화면 크기가 바뀌면 다시 맞춘다]");
  await page.setViewportSize({ width: 900, height: 700 });
  await page.waitForTimeout(500);
  const small = await tiles(page);
  const smallOverflow = small.tiles.filter((t) => t.right > small.wrap.right + 1 || t.bottom > small.wrap.bottom + 1);
  check("★ 화면을 줄여도 삐져나가지 않는다", smallOverflow.length === 0, `${smallOverflow.length}개`);
  const smallScale = (/matrix\(([-\d.]+)/.exec(small.transform || "") || [])[1];
  check("작은 화면에서는 배율도 작아졌다", Number(smallScale) < scale, `${scale} → ${smallScale}`);

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
