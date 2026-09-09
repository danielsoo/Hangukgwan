// 헤더가 한 줄인지, 가운데 내비게이션이 진짜 화면 중앙인지, 오른쪽 버튼
// 순서가 사장님이 정한 대로인지, 글자 크기가 전부 같은지.
//
// 2026-09-09 사장님 요청: "지금 사실상 헤더가 2개인 셈인데 하나로
// 합치려고 하는거야", "가장 오른쪽부터 프로필, 밝기, 언어",
// "글자 크기는 헤더들 다 같게."
//
// 눈으로만 확인하면 다음에 헤더에 뭔가 하나 추가할 때 조용히 무너진다.
const path = require("path");
const fs = require("fs");

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
process.env.SESSION_SECRET = "e2e-header";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const { chromium } = require("playwright");
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
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const shots = path.join(__dirname, "..", "..", "..", "_screens");
  fs.mkdirSync(shots, { recursive: true });

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("hgw-lang", "ko"); } catch (e) {} });
  const page = await ctx.newPage();

  out.push("\n[한 줄인가]");
  await page.goto(`${base}/`, { waitUntil: "load" });
  await page.waitForTimeout(1000);
  check("헤더 안의 nav 가 하나뿐", (await page.locator("header nav").count()) === 1, `count=${await page.locator("header nav").count()}`);
  const bar = await page.locator(".hg-header-bar").boundingBox();
  check("헤더 높이가 한 줄 수준 (≤80px)", bar && bar.height <= 80, `height=${bar && bar.height}`);

  out.push("\n[가운데 내비게이션이 화면 중앙]");
  const centered = await page.evaluate(() => {
    const n = document.querySelector(".hg-header-nav").getBoundingClientRect();
    return { screen: Math.round(window.innerWidth / 2), nav: Math.round(n.left + n.width / 2) };
  });
  check("내비 중심 = 화면 중심 (±2px)", Math.abs(centered.screen - centered.nav) <= 2, JSON.stringify(centered));
  const navText = await page.locator(".hg-header-nav").innerText();
  for (const label of ["홈", "메뉴", "소개", "오시는 길", "단체 예약"]) {
    check(`가운데에 "${label}"`, navText.includes(label), navText.replace(/\n/g, " "));
  }

  out.push("\n[오른쪽 순서 — 가장 오른쪽부터 프로필, 밝기, 언어]");
  // 사장 계정으로 로그인해야 관리자 버튼까지 있는 최대 상태가 된다.
  await page.goto(`${base}/signup/`, { waitUntil: "load" });
  await page.waitForTimeout(600);
  await page.fill('input[autocomplete="name"]', "박윤수");
  await page.fill('input[type="email"]', "boss@hangukgwan.tw");
  await page.fill('input[autocomplete="new-password"]', "bosspass1234");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/account/**", { timeout: 15000 });
  await page.goto(`${base}/menu/`, { waitUntil: "load" });
  await page.waitForTimeout(1000);

  const order = await page.evaluate(() => {
    const x = (sel) => {
      const el = document.querySelector(`header ${sel}`);
      return el ? el.getBoundingClientRect().left : null;
    };
    return { admin: x(".hg-cta-outline-gold"), lang: x(".hg-pill"), theme: x(".hg-theme-btn"), profile: x(".hg-member-btn") };
  });
  check("프로필이 가장 오른쪽", order.profile > order.theme, JSON.stringify(order));
  check("밝기가 그 왼쪽", order.theme > order.lang, JSON.stringify(order));
  check("언어가 그 왼쪽", order.lang > order.admin, JSON.stringify(order));
  check("관리자 버튼은 셋의 자리를 밀지 않는다 (맨 앞)", order.admin < order.lang, JSON.stringify(order));

  out.push("\n[글자 크기가 전부 같다]");
  const sizes = await page.evaluate(() => {
    const px = (sel) => { const el = document.querySelector(`header ${sel}`); return el ? getComputedStyle(el).fontSize : null; };
    return { logo: px(".hg-logo-word"), nav: px(".hg-nav-item"), lang: px(".hg-pill span"), admin: px(".hg-cta-outline-gold"), profile: px(".hg-member-btn") };
  });
  const unique = [...new Set(Object.values(sizes).filter(Boolean))];
  check("헤더 글자 크기가 한 종류", unique.length === 1, JSON.stringify(sizes));
  await page.locator("header").screenshot({ path: path.join(shots, "30-header-one-row.png") });

  out.push("\n[전화번호는 헤더에서 뺐다]");
  const headerHtml = await page.locator("header").innerHTML();
  check("헤더에 tel: 링크 없음", !/href="tel:/.test(headerHtml));
  // 푸터에는 남아 있어야 한다 — 헤더에서만 뺀 것이지 없앤 게 아니다.
  const footerHtml = await page.locator("footer").innerHTML().catch(() => "");
  check("푸터에는 전화번호가 남아 있다", /href="tel:/.test(footerHtml), footerHtml.slice(0, 120));

  out.push("\n[좁은 화면에서 겹치지 않는다]");
  for (const [name, w] of [["태블릿", 834], ["폰", 390]]) {
    const small = await browser.newContext({ viewport: { width: w, height: 700 } });
    await small.addInitScript(() => { try { localStorage.setItem("hgw-lang", "ko"); } catch (e) {} });
    const sp = await small.newPage();
    await sp.goto(`${base}/`, { waitUntil: "load" });
    await sp.waitForTimeout(900);
    const overlap = await sp.evaluate(() => {
      const nav = document.querySelector(".hg-header-nav").getBoundingClientRect();
      const right = document.querySelector(".hg-header-bar > :last-child").getBoundingClientRect();
      return { navRight: Math.round(nav.right), rightLeft: Math.round(right.left), overflowX: Math.round(document.documentElement.scrollWidth - window.innerWidth) };
    });
    check(`${name}: 내비가 오른쪽 버튼을 덮지 않는다`, overlap.navRight <= overlap.rightLeft + 1, JSON.stringify(overlap));
    check(`${name}: 가로 스크롤바가 생기지 않는다`, overlap.overflowX <= 1, JSON.stringify(overlap));
    check(`${name}: 여전히 한 줄`, (await sp.locator("header nav").count()) === 1);
    await sp.locator("header").screenshot({ path: path.join(shots, `31-header-${w}.png`) });
    await small.close();
  }

  await browser.close();
  server.close();
  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.log(out.join("\n"));
  console.error("HARNESS ERROR:", e.message);
  process.exit(1);
});
