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
  // **실제 가게 배치를 본떠서 놓는다.**
  //
  // 2026-09-13 사장님: "아니 로컬대로 하는 게 아니라 실제 배포된 애들을
  // 기준으로 바꿔야 하는 거 아니야?"
  //
  // 맞는 지적이었다. 처음엔 씨앗 자료(같은 크기의 빈 구역 4개, 거의
  // 정사각형)로 맞춰 놓고 됐다고 했다. 그런데 배포본의 실제 배치는 모양이
  // 아주 다르다 — 전면·중앙1·중앙2·후면이 **옆으로 늘어서 있어서 가로로 길고
  // 세로로 짧다**(대략 2.5 : 1). 그 모양에서는 가로에 맞춰 커지고 남는 세로가
  // 전부 아래에 몰린다. 정사각형 자료로만 보면 그 일이 안 일어난다.
  //
  // 그래서 여기서는 실제 배치의 **비율과 생김새**를 본뜬다: 크기가 제각각인
  // 구역 넷이 옆으로, 자리 옆에 포장 타일이 붙는 자리도(1-1, 2-1 처럼 구역
  // 밖으로 삐져나갈 수 있는 것) 함께.
  await db.connectDB();
  {
    const handle = db.getDb();
    const doc = await handle.collection("store").findOne({ _id: "main" });
    const zones = doc.zones || [];
    const tables = doc.tables || [];
    if (zones.length < 4 || tables.length < 12) throw new Error("씨앗 자료에 구역이나 자리가 모자란다");

    // 전면(넓다) · 중앙1(작다) · 중앙2(작다) · 후면(중간) — 옆으로 늘어선다.
    const layout = [
      { z: 0, x: 10, y: 20, w: 470, h: 380, seats: [[20, 40], [110, 90], [200, 90], [290, 90], [20, 180], [110, 180]] },
      { z: 1, x: 500, y: 10, w: 260, h: 170, seats: [[20, 40], [140, 40]] },
      { z: 2, x: 500, y: 195, w: 260, h: 250, seats: [[20, 40], [140, 40], [20, 140]] },
      { z: 3, x: 780, y: 45, w: 250, h: 320, seats: [[20, 40], [130, 40], [20, 140]] },
    ];
    let t = 0;
    for (const L of layout) {
      const zone = zones[L.z];
      zone.x = L.x; zone.y = L.y; zone.width = L.w; zone.height = L.h;
      for (const [sx, sy] of L.seats) {
        if (t >= tables.length) break;
        tables[t].zone_id = zone.id;
        tables[t].x = sx; tables[t].y = sy;
        tables[t].width = 70; tables[t].height = 70;
        t++;
      }
    }
    await handle.collection("store").updateOne({ _id: "main" }, { $set: { zones, tables } });
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

  out.push("\n[★ 남는 자리를 한쪽에 몰지 않는다 — 가운데로 모은다]");
  // 실제 배치는 가로로 길고 세로로 짧다. 그러면 가로에 맞춰 커지고 남는
  // 세로가 전부 **아래**에 몰려서 화면 아래쪽이 통째로 빈다. 사장님이
  // 「꽉차게」라고 한 것이 그 빈 자리였다. 위아래로 나눠 가운데에 놓는다.
  const box = await page.evaluate(() => {
    const wrap = document.querySelector("#paymentFloorPlan");
    const tiles = [...document.querySelectorAll("#paymentFloorPlan .table-block")];
    const zones = [...document.querySelectorAll("#paymentFloorPlan .zone-block")];
    const all = tiles.concat(zones).map((e) => e.getBoundingClientRect());
    const w = wrap.getBoundingClientRect();
    return {
      wrap: { top: w.top, bottom: w.bottom, left: w.left, right: w.right, h: w.height, w: w.width },
      content: {
        top: Math.min(...all.map((r) => r.top)),
        bottom: Math.max(...all.map((r) => r.bottom)),
        left: Math.min(...all.map((r) => r.left)),
        right: Math.max(...all.map((r) => r.right)),
      },
    };
  });
  const gapTop = box.content.top - box.wrap.top;
  const gapBottom = box.wrap.bottom - box.content.bottom;
  const gapLeft = box.content.left - box.wrap.left;
  const gapRight = box.wrap.right - box.content.right;
  check(
    "★ 위아래 빈 자리가 비슷하다 (아래로 몰리지 않는다)",
    Math.abs(gapTop - gapBottom) <= Math.max(24, box.wrap.h * 0.06),
    `위 ${Math.round(gapTop)} / 아래 ${Math.round(gapBottom)}`
  );
  check(
    "좌우 빈 자리도 비슷하다",
    Math.abs(gapLeft - gapRight) <= Math.max(24, box.wrap.w * 0.06),
    `왼 ${Math.round(gapLeft)} / 오른 ${Math.round(gapRight)}`
  );
  check(
    "★ 배치도 칸이 화면 아래까지 쓴다",
    box.wrap.bottom >= after.viewportH - 40,
    `칸 바닥 ${Math.round(box.wrap.bottom)} / 화면 ${after.viewportH}`
  );

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
