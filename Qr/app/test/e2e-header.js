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

  out.push("\n[오른쪽 순서 — 설정, 로그인]");
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
    return {
      admin: x(".hg-cta-outline-gold"),
      settings: x(".hg-settings-btn"),
      profile: x(".hg-member-btn"),
      // 언어·밝기는 설정 안으로 들어갔으니 헤더에 직접 나와 있으면 안 된다.
      langPill: x(".hg-pill"),
      themeBtn: x(".hg-theme-btn"),
    };
  });
  check("로그인이 가장 오른쪽", order.profile > order.settings, JSON.stringify(order));
  check("설정이 그 왼쪽", order.settings > order.admin, JSON.stringify(order));
  check("관리자 버튼은 둘의 자리를 밀지 않는다 (맨 앞)", order.admin < order.settings, JSON.stringify(order));
  check("언어 버튼이 헤더에 직접 없다", order.langPill === null, JSON.stringify(order));
  check("밝기 버튼이 헤더에 직접 없다", order.themeBtn === null, JSON.stringify(order));

  out.push("\n[설정 안에 언어와 밝기]");
  check("처음엔 설정이 닫혀 있다", (await page.locator(".hg-panel").count()) === 0);
  await page.click(".hg-settings-btn");
  await page.waitForTimeout(350);
  check("눌러서 열린다", (await page.locator(".hg-panel").count()) === 1);
  const setText = await page.locator(".hg-panel").innerText().catch(() => "");
  check("언어 항목", /언어/.test(setText), setText.replace(/\n/g, " "));
  check("밝기 항목", /밝기/.test(setText), setText.replace(/\n/g, " "));
  for (const l of ["한국어", "中文", "EN"]) {
    check(`언어 선택지 "${l}"`, setText.includes(l), setText.replace(/\n/g, " "));
  }
  // 고른 것 하나가 분명히 보여야 한다.
  const onCount = await page.locator(".hg-choice-on").count();
  check("고른 언어와 밝기가 표시된다 (2개)", onCount === 2, `on=${onCount}`);
  await page.locator("header").screenshot({ path: path.join(shots, "32-header-settings.png") });

  // 돌려막기가 아니라 고르기 — 원하는 언어를 바로 누를 수 있어야 한다.
  const navKo = await page.locator(".hg-header-nav").innerText();
  await page.locator(".hg-choice", { hasText: "中文" }).first().click();
  await page.waitForTimeout(500);
  const navZh = await page.locator(".hg-header-nav").innerText();
  check("고른 언어로 바로 바뀐다", navZh !== navKo && /首頁/.test(navZh), `${navKo} → ${navZh}`);
  await page.locator(".hg-choice", { hasText: "한국어" }).first().click();
  await page.waitForTimeout(400);

  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("Esc 로 닫힌다", (await page.locator(".hg-panel").count()) === 0);

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

  out.push("\n[글자가 화면 크기를 따라간다]");
  // 고정 px 로 잡아두면 27인치 모니터에서 본문이 잡지 글씨만 해진다.
  const scale = {};
  for (const w of [390, 1280, 2560]) {
    const c = await browser.newContext({ viewport: { width: w, height: 900 } });
    const sp = await c.newPage();
    await sp.goto(`${base}/`, { waitUntil: "load" });
    await sp.waitForTimeout(700);
    scale[w] = await sp.evaluate(() => {
      const d = document.createElement("div");
      d.style.fontSize = getComputedStyle(document.documentElement).getPropertyValue("--fs-base");
      document.body.appendChild(d);
      const px = parseFloat(getComputedStyle(d).fontSize);
      d.remove();
      return Math.round(px * 10) / 10;
    });
    await c.close();
  }
  check("폰에서 최소 15px", scale[390] >= 15, JSON.stringify(scale));
  check("화면이 커지면 글자도 커진다", scale[2560] > scale[1280] && scale[1280] > scale[390], JSON.stringify(scale));
  check("큰 모니터에서 본문이 18px 이상", scale[2560] >= 18, JSON.stringify(scale));

  out.push("\n[좁은 화면 — 햄버거]");
  // 다섯 항목이 폰 폭에 물리적으로 안 들어간다. 예전에는 가로 스크롤로
  // 흘렸는데 "홈 메뉴 소개 오시…" 처럼 잘려 보여서 고장난 것 같았다.
  for (const [name, w] of [["태블릿", 834], ["폰", 390]]) {
    const small = await browser.newContext({ viewport: { width: w, height: 700 } });
    await small.addInitScript(() => { try { localStorage.setItem("hgw-lang", "ko"); } catch (e) {} });
    const sp = await small.newPage();
    await sp.goto(`${base}/`, { waitUntil: "load" });
    await sp.waitForTimeout(900);

    const vis = await sp.evaluate(() => ({
      nav: getComputedStyle(document.querySelector(".hg-header-nav")).display,
      burger: getComputedStyle(document.querySelector(".hg-hamburger")).display,
      overflowX: Math.round(document.documentElement.scrollWidth - window.innerWidth),
    }));
    check(`${name}: 가운데 내비는 감춘다`, vis.nav === "none", JSON.stringify(vis));
    check(`${name}: 햄버거가 보인다`, vis.burger !== "none", JSON.stringify(vis));
    check(`${name}: 가로 스크롤바가 생기지 않는다`, vis.overflowX <= 1, JSON.stringify(vis));

    check(`${name}: 처음엔 메뉴가 닫혀 있다`, (await sp.locator(".hg-menu-panel").count()) === 0);
    await sp.click(".hg-hamburger");
    await sp.waitForTimeout(350);
    const panel = sp.locator(".hg-panel");
    check(`${name}: 눌러서 열린다`, (await panel.count()) === 1);
    const panelText = await panel.innerText().catch(() => "");
    for (const label of ["홈", "메뉴", "소개", "오시는 길", "단체 예약"]) {
      check(`${name}: 메뉴에 "${label}"`, panelText.includes(label), panelText.replace(/\n/g, " "));
    }
    // 사장님: "햄버거 모양이 되면 메뉴들, 로그인, 설정 이렇게 있으면 될 듯해."
    check(`${name}: 메뉴에 로그인`, /로그인/.test(panelText), panelText.replace(/\n/g, " "));
    check(`${name}: 메뉴에 설정`, /설정/.test(panelText), panelText.replace(/\n/g, " "));
    check(`${name}: 설정 안에 언어와 밝기`, /언어/.test(panelText) && /밝기/.test(panelText), panelText.replace(/\n/g, " "));
    // 닫기 아이콘이 실제로 그려지는지 — 예전에 ✕(U+2715) 글자를 썼는데
    // 본문 서체에 그 자형이 없어 빈 네모로 나왔다.
    const icon = await sp.evaluate(() => {
      const btn = document.querySelector(".hg-hamburger");
      const lines = btn.querySelectorAll("svg line");
      return {
        lines: lines.length,
        stroke: lines.length ? getComputedStyle(lines[0]).stroke : null,
        // 버튼 자신의 배경과 비교해야 한다. 누른 직후에는 마우스가 버튼 위에
        // 있어서 :hover 가 걸리고, 그때는 금색 배경에 어두운 아이콘이 맞다.
        btnBg: getComputedStyle(btn).backgroundColor,
      };
    });
    check(`${name}: 닫기 아이콘이 그려진다`, icon.lines === 2, JSON.stringify(icon));
    check(`${name}: 아이콘이 버튼 배경에 묻히지 않는다`, icon.stroke !== icon.btnBg, JSON.stringify(icon));

    await sp.locator("header").screenshot({ path: path.join(shots, `31-header-${w}-open.png`) });
    await sp.click(".hg-hamburger");
    await sp.waitForTimeout(300);
    check(`${name}: 다시 눌러서 닫힌다`, (await sp.locator(".hg-menu-panel").count()) === 0);
    await small.close();
  }

  out.push("\n[아이콘 버튼에 마우스를 올려도 사라지지 않는다]");
  // 인라인 background:'none' 이 클래스의 :hover 배경을 이기는 바람에,
  // 글자색만 어두운 색으로 바뀌어 아이콘이 배경에 묻혔다.
  const hoverCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const hp = await hoverCtx.newPage();
  await hp.goto(`${base}/`, { waitUntil: "load" });
  await hp.waitForTimeout(800);
  await hp.hover(".hg-settings-btn");
  await hp.waitForTimeout(300);
  const hov = await hp.evaluate(() => {
    const cs = getComputedStyle(document.querySelector(".hg-settings-btn"));
    return { color: cs.color, bg: cs.backgroundColor };
  });
  check("호버 시 글자색과 배경색이 다르다", hov.color !== hov.bg, JSON.stringify(hov));
  check("호버 시 배경이 실제로 칠해진다", !/rgba\(0, 0, 0, 0\)|transparent/.test(hov.bg), JSON.stringify(hov));
  await hoverCtx.close();

  out.push("\n[톱니바퀴와 햄버거가 자기 네모의 정중앙에 있다]");
  // 사장님: "톱니바퀴가 정중앙이 아니야."
  // 버튼에 alignItems/justifyContent 만 style 로 넣고 display 를 안 줘서
  // 두 줄 다 무효였다. 아이콘이 글자 밑선에 앉아 아래로 치우쳤다.
  // 눈으로 보면 1~2px 은 놓치므로 실제로 잰다.
  for (const [w, sel, label] of [
    [1440, ".hg-settings-btn", "톱니바퀴"],
    [700, ".hg-hamburger", "햄버거"],
    [700, ".hg-settings-btn", "톱니바퀴(좁은 화면)"],
  ]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
    const pg = await ctx.newPage();
    await pg.goto(`${base}/`, { waitUntil: "load" });
    await pg.waitForTimeout(700);
    const el = pg.locator(sel).first();
    if (await el.isVisible()) {
      const inner = el.locator("svg").first();
      if ((await inner.count()) > 0) {
        const b = await el.boundingBox();
        const i = await inner.boundingBox();
        const dx = i.x + i.width / 2 - (b.x + b.width / 2);
        const dy = i.y + i.height / 2 - (b.y + b.height / 2);
        check(`${label} 아이콘이 가로 가운데`, Math.abs(dx) <= 0.6, `${dx.toFixed(2)}px`);
        check(`${label} 아이콘이 세로 가운데`, Math.abs(dy) <= 0.6, `${dy.toFixed(2)}px`);
      }
      const disp = await el.evaluate((e) => getComputedStyle(e).display);
      check(`${label} 가 flex 로 안쪽을 잡는다`, /flex/.test(disp), disp);
    }
    await ctx.close();
  }

  // 톱니바퀴와 로그인은 나란히 서 있다 — 높이와 세로 중심이 어긋나면
  // 둘 중 하나가 떠 보인다.
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pg = await ctx.newPage();
    await pg.goto(`${base}/`, { waitUntil: "load" });
    await pg.waitForTimeout(700);
    const gear = await pg.locator(".hg-settings-btn").boundingBox();
    const login = await pg.locator(".hg-account-wide a, .hg-account-wide button").first().boundingBox();
    if (login) {
      const dy = gear.y + gear.height / 2 - (login.y + login.height / 2);
      check("톱니바퀴와 로그인의 세로 중심이 같다", Math.abs(dy) <= 1, `${dy.toFixed(2)}px`);
      check("둘의 높이가 비슷하다", Math.abs(gear.height - login.height) <= 4,
        `${Math.round(gear.height)} vs ${Math.round(login.height)}`);
    }
    await ctx.close();
  }

  out.push("\n[양 끝 공백이 화면을 따라간다]");
  // 사장님: "헤더랑 전체적인 웹사이트 양 끝 공백이 너무 놀고 있어서."
  // 예전에는 어디서나 1320px 로 고정이라 2000px 모니터에서 양옆이 각각
  // 340px 씩 비었다. 이제 넓어지면 같이 넓어져야 한다.
  const barWidths = {};
  for (const w of [1280, 2000]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
    const pg = await ctx.newPage();
    await pg.goto(`${base}/`, { waitUntil: "load" });
    await pg.waitForTimeout(700);
    const bar = await pg.locator(".hg-header-bar").boundingBox();
    barWidths[w] = bar.width;
    check(`${w}px 에서 남는 여백이 화면의 1/8 을 넘지 않는다`, bar.x <= w / 8, `왼쪽 ${Math.round(bar.x)}px`);

    // 헤더와 본문 섹션의 왼쪽 끝이 같아야 한다 — 다르면 계단처럼 보인다.
    const edges = await pg.evaluate(() => {
      const want = getComputedStyle(document.querySelector(".hg-header-bar")).maxWidth;
      const xs = [];
      document.querySelectorAll("div, section, main, footer").forEach((el) => {
        const cs = getComputedStyle(el);
        if (cs.maxWidth === want && cs.marginLeft === cs.marginRight && el.getBoundingClientRect().width > 0) {
          xs.push(Math.round(el.getBoundingClientRect().x));
        }
      });
      return { count: xs.length, distinct: [...new Set(xs)] };
    });
    check(`${w}px 에서 헤더와 본문이 같은 왼쪽 끝을 쓴다`, edges.distinct.length <= 1, JSON.stringify(edges));
    check(`${w}px 에서 껍데기를 쓰는 곳이 여럿이다`, edges.count >= 2, String(edges.count));
    await ctx.close();
  }
  check("화면이 넓어지면 내용도 같이 넓어진다", barWidths[2000] > barWidths[1280] + 200,
    `${Math.round(barWidths[1280])} → ${Math.round(barWidths[2000])}`);

  out.push("\n[설정 판이 톱니바퀴 아래에 붙는다]");
  // 전에는 헤더 폭을 가득 채우는 띠였고 내용이 왼쪽 끝에서 시작했다.
  // 2000px 모니터에서는 누른 톱니바퀴와 열린 판이 1600px 넘게 떨어져 있었다.
  // 그리고 흐름 안에 있어서 판을 열 때마다 본문이 아래로 밀렸다.
  for (const w of [2000, 1440, 900, 700, 390]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
    const pg = await ctx.newPage();
    await pg.goto(`${base}/`, { waitUntil: "load" });
    await pg.waitForTimeout(700);
    if (!(await pg.locator(".hg-settings-btn").isVisible())) { await ctx.close(); continue; }
    const before = await pg.evaluate(() => document.querySelector("main").getBoundingClientRect().top);
    await pg.locator(".hg-settings-btn").click();
    await pg.waitForTimeout(350);
    const after = await pg.evaluate(() => document.querySelector("main").getBoundingClientRect().top);
    check(`${w}px: 판을 열어도 본문이 밀리지 않는다`, Math.abs(after - before) < 1, `${Math.round(before)} → ${Math.round(after)}`);

    const pop = await pg.locator(".hg-settings-pop").boundingBox();
    const gear = await pg.locator(".hg-settings-btn").boundingBox();
    const login = await pg.locator(".hg-account-wide a, .hg-account-wide button").first().boundingBox();
    const rightRef = login ? Math.max(gear.x + gear.width, login.x + login.width) : gear.x + gear.width;
    check(`${w}px: 판이 화면 안에 들어온다`, pop.x >= -0.5 && pop.x + pop.width <= w + 0.5,
      `${Math.round(pop.x)}~${Math.round(pop.x + pop.width)}`);
    check(`${w}px: 판 오른쪽 끝이 버튼과 맞는다`, Math.abs(pop.x + pop.width - rightRef) <= 2,
      `${Math.round(pop.x + pop.width)} vs ${Math.round(rightRef)}`);
    check(`${w}px: 판이 톱니바퀴 아래에 뜬다`, pop.y >= gear.y + gear.height - 2, `${Math.round(pop.y)} vs ${Math.round(gear.y + gear.height)}`);
    const ov = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`${w}px: 판을 열어도 가로 스크롤 없음`, ov <= 1, `${ov}px`);
    await ctx.close();
  }

  out.push("\n[어느 폭에서도 가로 스크롤이 생기지 않는다]");
  // 중국어에 word-break: keep-all 이 걸려 있어서 800px 에서 인용구가
  // 줄바꿈 없이 화면 밖으로 12px 흘러넘쳤다.
  for (const lang of ["zh-TW", "ko", "en"]) {
    for (const w of [390, 700, 800, 1024, 1440, 2000]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
      await ctx.addInitScript((l) => { try { localStorage.setItem("hgw-lang", l); } catch {} }, lang);
      const pg = await ctx.newPage();
      await pg.goto(`${base}/`, { waitUntil: "load" });
      await pg.waitForTimeout(600);
      const over = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(`${lang} ${w}px 가로 스크롤 없음`, over <= 1, `${over}px 초과`);
      await ctx.close();
    }
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
