// 홈페이지의 대표 메뉴 사진이 주문 시스템 메뉴 사진에서 온다.
//
// 2026-09-29 사장님: "우리 가게는 대표 메뉴들이 있고 그 메뉴들에 사진이 이미
// 들어있단 말이야. 그런 걸 바탕으로 사진을 넣어주는데 …"
//
// 홈페이지(Web/src/lib/menuPhotos.ts)가 /api/menu 를 읽어 요리 이름으로 사진을
// 찾는다. 사장님이 관리자 화면에서 메뉴 사진을 바꾸면 홈페이지도 따라 바뀐다.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};
process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-site-dish-photos";
process.env.ADMIN_PASSWORD = "ownerpass123";

const request = require("supertest");
const { launchBrowser } = require("./browser");
const app = require("../server");
const { resolveSiteDir } = require("../src/site");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

(async () => {
  if (!resolveSiteDir()) {
    console.log("홈페이지 빌드가 없습니다 — Web/ 에서 `npm run build` 하세요.");
    process.exit(1);
  }
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const menu = (await request(app).get("/api/menu")).body;
  const photoOf = {};
  for (const c of menu) for (const i of c.items) if (i.photo_url && !photoOf[i.name_ko]) photoOf[i.name_ko] = i.photo_url;

  const browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("hgw-lang", "ko"); } catch (e) {} });
  const page = await ctx.newPage();
  // 시험 서버에는 사진 파일이 없다 — 작은 그림으로 대신 답한다(주소가 맞는지만 본다).
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
  await ctx.route("**/uploads/dish-*.jpg", (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));

  out.push("[메뉴 페이지 — 대표 메뉴 여섯 장]");
  await page.goto(`${base}/menu/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const srcs = await page.$$eval("main img", (els) => els.map((e) => e.getAttribute("src")));
  for (const ko of ["부대찌개", "돌솥비빔밥", "해물파전", "삼겹살", "닭갈비", "순두부찌개"]) {
    check(`★ ${ko} — 메뉴 사진 그대로(${photoOf[ko]})`, !!photoOf[ko] && srcs.includes(photoOf[ko]), JSON.stringify(srcs));
  }

  out.push("\n[첫 화면 — 대표 요리 큰 사진]");
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const homeSrcs = await page.$$eval("img", (els) => els.map((e) => e.getAttribute("src")));
  check("★ 첫 대표 요리(부대찌개) 사진이 들어간다", homeSrcs.includes(photoOf["부대찌개"]), JSON.stringify(homeSrcs));

  out.push("\n[사진 주소가 깨졌으면 깨진 그림 대신 빈 면]");
  await page.route("**/uploads/dish-*.jpg", (r) => r.fulfill({ status: 404, body: "" }));
  await page.goto(`${base}/menu/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  check("★ 깨진 그림이 안 남는다", (await page.$$eval("main img", (e) => e.length)) === 0, "");
  await page.unroute("**/uploads/dish-*.jpg");

  out.push("\n[메뉴를 못 읽어도 화면이 안 깨진다]");
  await page.route("**/api/menu", (r) => r.fulfill({ status: 500, body: "x" }));
  await page.goto(`${base}/menu/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  check("사진 없이 빈 면으로 그린다", (await page.$$eval("main img", (e) => e.length)) === 0 && (await page.locator("main h3").count()) >= 6, "");

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
