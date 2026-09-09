// 설정에서 무엇이 어디에 있는지 알 수 있는가.
//
// 2026-09-10 사장님: "설정 안에 너무 많은 게 담겨 있어. 나누거나 유아이적으로
// 뭐가 어디에 있는지 알 수 있게 해줘."
//
// 두 가지를 잰다. (1) 한 분류에 카드가 너무 많이 쌓여 있지 않은가 — 이건
// 시간이 지나면 자연히 다시 무너지는 종류의 문제라 숫자로 못 박아둔다.
// (2) 이름을 치면 그게 어느 분류에 있는지 알려주고 거기로 데려가는가 —
// 분류를 나누는 것만으로는 부족하다. 찾는 사람은 그게 「매장 정보」에
// 있는지 「주문 규칙」에 있는지를 모르는 채로 오기 때문이다.
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
process.env.SESSION_SECRET = "e2e-settings-nav";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");
const app = require("../server");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const MAX_CARDS_PER_CATEGORY = 4;

(async () => {
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.dismiss());
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "ownerpass123" }) });
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator('.admin-tabs button[data-tab="settings"]').click();
  await page.waitForTimeout(700);

  out.push("[한 분류에 너무 많이 쌓이지 않는다]");
  const perCat = await page.evaluate(() =>
    [...document.querySelectorAll(".settings-category")].map((c) => ({
      id: c.id.replace("settings-cat-", ""),
      cards: c.querySelectorAll(".settings-card").length,
      titles: [...c.querySelectorAll(".settings-card h3")].map((h) => h.textContent.trim()),
    }))
  );
  for (const c of perCat) out.push(`  ·    ${c.id}: ${c.cards}장 — ${c.titles.join(" / ")}`);
  const overloaded = perCat.filter((c) => c.cards > MAX_CARDS_PER_CATEGORY);
  check(`어느 분류도 ${MAX_CARDS_PER_CATEGORY}장을 넘지 않는다`, overloaded.length === 0,
    overloaded.map((c) => `${c.id}=${c.cards}`).join(", "));
  check("주문 규칙이 따로 있다", perCat.some((c) => c.id === "order" && c.cards >= 2));

  out.push("\n[분류마다 무엇이 들어 있는지 적혀 있다]");
  // 이름만으로는 「매장 정보」와 「주문 규칙」 중 어디에 영업시간이 있는지 모른다.
  const navs = await page.evaluate(() =>
    [...document.querySelectorAll(".settings-nav-btn")].map((b) => ({
      cat: b.dataset.category,
      name: (b.querySelector(".nav-name") || {}).textContent || "",
      sub: (b.querySelector(".nav-sub") || {}).textContent || "",
    }))
  );
  check("모든 분류에 설명줄이 있다", navs.every((n) => n.sub.trim().length > 0),
    JSON.stringify(navs.filter((n) => !n.sub.trim())));
  for (const n of navs) out.push(`  ·    ${n.name} — ${n.sub}`);

  out.push("\n[이름을 치면 어디 있는지 알려주고 데려간다]");
  const searchFor = async (term) => {
    await page.locator("#settingsSearch").fill(term);
    await page.waitForTimeout(250);
    return page.evaluate(() =>
      [...document.querySelectorAll("#settingsSearchResults .settings-search-hit")].map((b) => ({
        name: b.querySelector(".hit-name").textContent,
        cat: b.querySelector(".hit-cat").textContent,
      }))
    );
  };
  {
    const hits = await searchFor("영업시간");
    check("「영업시간」으로 찾힌다", hits.length > 0, JSON.stringify(hits));
    check("어느 분류인지 같이 알려준다", hits.every((h) => h.cat.trim().length > 0), JSON.stringify(hits));
    out.push(`  ·    영업시간 → ${hits.map((h) => `${h.name}(${h.cat})`).join(", ")}`);
    await page.screenshot({
      path: (() => {
        const d = path.join(__dirname, "..", "..", "..", "_screens");
        fs.mkdirSync(d, { recursive: true });
        return path.join(d, "settings-search.png");
      })(),
      clip: { x: 0, y: 100, width: 1000, height: 560 },
    });
  }
  {
    const hits = await searchFor("프린터");
    check("「프린터」로 찾힌다", hits.length > 0, JSON.stringify(hits));
    check("인쇄 분류라고 알려준다", hits.some((h) => h.cat.includes("인쇄")), JSON.stringify(hits));
  }
  {
    // 카드 제목에 없는 말도 찾힌다 — 사장님이 기억하는 단어가 제목에 있으리란
    // 보장이 없다.
    const hits = await searchFor("반경");
    check("카드 안의 글자로도 찾힌다", hits.length > 0, JSON.stringify(hits));
  }
  {
    const hits = await searchFor("없는설정이름");
    check("없으면 없다고 말한다", hits.length === 0);
    check("빈 목록 대신 안내가 뜬다",
      await page.locator("#settingsSearchResults .settings-search-empty").isVisible());
  }

  out.push("\n[눌러서 데려간다]");
  {
    await searchFor("주문 받는 시간");
    await page.locator("#settingsSearchResults .settings-search-hit").first().click();
    await page.waitForTimeout(600);
    check("그 분류가 열린다", await page.locator("#settings-cat-order").isVisible());
    check("그 카드가 보인다", await page.locator("#orderHoursState").isVisible());
    check("찾은 카드를 짚어준다", (await page.locator(".settings-card.is-found").count()) === 1);
    check("검색칸은 비워진다", (await page.locator("#settingsSearch").inputValue()) === "");
  }

  await browser.close();
  server.close();
  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
