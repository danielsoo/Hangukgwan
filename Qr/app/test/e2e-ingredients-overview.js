// 식자재 「한눈에 보기」 — 급여 탭과 같은 모양으로, 업체별로 나눠 본다.
//
// 2026-10-06 사장님: "식자재 탭에서 급여처럼 저런 전체 보기로 결산 보는 것처럼
// 볼 수 있으면 좋겠는데?" / "어떤 업체에서 어떤 종류를 우리가 언제 샀고 이런
// 것들? 업체별로 나눠서 볼 수도 있게 해줬으면 좋겠고"
//
// 재는 것은 **사장님이 보시는 것**이다: 큰 숫자가 맞나, 업체를 고르면 그
// 업체만 남나, 그 업체에서 **뭘 언제 샀는지**가 뜨나, 다시 전체로 돌아오나.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};
process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-ing-overview";
process.env.ADMIN_PASSWORD = "ownerpass123";

const { launchBrowser } = require("./browser");
const app = require("../server");

let pass = 0, fail = 0;
const out = [];
const check = (name, cond, extra = "") => {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
};

// 오늘에서 가까운 날로 넣는다 — 기간을 안 고르면 서버가 최근 몇 달만 본다.
const day = (back) => new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);

// 한국어 이름은 사장님 엑셀의 「비  고」 칸에서 온다(normalizeRow 가 note → name_ko).
const ROWS = [
  { store: "main", date: day(3), name: "紅蘿蔔", note: "당근", qty: 5, unit: "斤", price: 22, amount: 110, vendor: "房信菓菜行" },
  { store: "main", date: day(3), name: "洋蔥", note: "양파", qty: 10, unit: "斤", price: 18, amount: 180, vendor: "房信菓菜行" },
  { store: "main", date: day(1), name: "紅蘿蔔", note: "당근", qty: 4, unit: "斤", price: 25, amount: 100, vendor: "房信菓菜行" },
  { store: "branch3", date: day(2), name: "雞蛋", note: "계란", qty: 2, unit: "箱", price: 300, amount: 600, vendor: "泳慶蛋行" },
];

(async () => {
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await fetch("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "ownerpass123" }),
    });
  });
  // 줄을 넣어 둔다 — 화면이 아니라 서버 길로(가져오기 화면은 여기서 재는 것이 아니다).
  // /import 는 지점마다 부른다(한 번에 한 지점이다).
  let put = { ok: () => true, status: () => 0 };
  for (const store of ["main", "branch3"]) {
    const rows = ROWS.filter((r) => r.store === store);
    put = await page.request.post(`${base}/api/ingredients/import`, { data: { store, rows } });
    if (!put.ok()) break;
  }
  check("자료를 넣었다", put.ok(), String(put.status()));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.locator('.admin-tabs button[data-tab="ingredients"]').click();
  await page.waitForTimeout(1200);

  out.push("[큰 숫자와 옆 칸 — 결산과 같은 모양]");
  {
    const total = await page.locator("#ingTotal").innerText();
    check("★★ 이 기간 식자재비 (110+180+100+600 = 990)", /990/.test(total), total);
    const stats = await page.locator("#ingHeroStats").innerText();
    // 산 날 3일 · 하루 평균 330 · 업체 2 · 품목 3
    check("★★ 옆 칸에 산 날·하루 평균·업체·품목", /3/.test(stats) && /330/.test(stats) && /2/.test(stats), stats.replace(/\n/g, " | "));
    const sub = await page.locator("#ingTotalSub").innerText();
    check("★ 몇 줄인지와 기간", /4/.test(sub) && /~/.test(sub), sub);
  }

  out.push("\n[그래프와 카드]");
  {
    check("★ 달마다 그래프 칸이 있다", await page.locator("#ingMonthsChart").isVisible(), "");
    const drawn = await page.locator("#ingMonthsChart").evaluate((c) => c.width > 0 && c.height > 0);
    check("★★ 그래프가 실제로 그려졌다(크기가 0 이 아니다)", drawn, "");
    check("★★ 지점이 둘이라 지점별 칸이 보인다", await page.locator("#ingStoresCard").isVisible(), "");
    const st = await page.locator("#ingStores").innerText();
    check("★ 지점 이름으로 적힌다", /본점|總店|main/.test(st), st.replace(/\n/g, " | "));
  }

  out.push("\n[업체별 한눈에]");
  {
    const t = await page.locator("#ingVendorTable").innerText();
    check("★★ 업체 두 곳이 줄로 있다", /房信菓菜行/.test(t) && /泳慶蛋行/.test(t), t.replace(/\n/g, " | ").slice(0, 200));
    check("★★ 몫(%)을 적는다 — 房信 390/990 = 39.4%", /39\.4%/.test(t), t.replace(/\n/g, " | ").slice(0, 300));
    check("★ 마지막 매입일", t.includes(day(1)), t.replace(/\n/g, " | ").slice(0, 300));
    check("★★ 합계 줄", /100%/.test(t), t.replace(/\n/g, " | ").slice(-200));
  }

  out.push("\n[업체별로 나눠 본다 — 뭘 언제 샀나]");
  {
    check("★ 처음엔 산 내역이 안 뜬다 (전체는 줄이 너무 많다)",
      await page.locator("#ingRowsCard").evaluate((el) => el.hidden), "");
    // 칩으로 고른다
    await page.locator('#ingVendorChips [data-ing-chip="房信菓菜行"]').click();
    await page.waitForTimeout(900);
    const total = await page.locator("#ingTotal").innerText();
    check("★★ 고른 업체만 더한다 (110+180+100 = 390)", /390/.test(total), total);
    check("★★ 산 내역이 뜬다", !(await page.locator("#ingRowsCard").evaluate((el) => el.hidden)), "");
    const rows = await page.locator("#ingRowsTable").innerText();
    check("★★ 날짜·품목·수량·단가·금액이 줄마다", /紅蘿蔔/.test(rows) && /당근/.test(rows) && /22/.test(rows) && rows.includes(day(3)), rows.replace(/\n/g, " | ").slice(0, 300));
    check("★★ 최근 것이 위에 있다", rows.indexOf(day(1)) < rows.indexOf(day(3)), rows.replace(/\n/g, " | ").slice(0, 200));
    check("★ 다른 업체 것은 안 섞인다", !/雞蛋/.test(rows), rows.replace(/\n/g, " | ").slice(0, 200));
    const title = await page.locator("#ingRowsTitle").innerText();
    check("★ 어느 업체를 보고 있는지 적는다", /房信菓菜行/.test(title), title);
    const chip = await page.locator('#ingVendorChips [data-ing-chip="房信菓菜行"]').getAttribute("class");
    check("★ 고른 칩이 눈에 띈다", /is-on/.test(chip), chip);
  }

  out.push("\n[전체로 돌아온다]");
  {
    // 고른 업체만 보고 있어도 **다른 업체 칩이 남아 있어야** 돌아갈 수 있다
    check("★★ 고른 뒤에도 다른 업체 칩이 남아 있다",
      await page.locator('#ingVendorChips [data-ing-chip="泳慶蛋行"]').isVisible(), "");
    await page.locator('#ingVendorChips [data-ing-chip=""]').click();
    await page.waitForTimeout(900);
    const total = await page.locator("#ingTotal").innerText();
    check("★★ 「전체 업체」로 돌아오면 다시 990", /990/.test(total), total);
    check("★ 산 내역은 다시 접힌다", await page.locator("#ingRowsCard").evaluate((el) => el.hidden), "");
  }

  out.push("\n[표의 줄을 눌러도 같다]");
  {
    await page.locator('#ingVendorTable [data-ing-vendor="泳慶蛋行"]').click();
    await page.waitForTimeout(900);
    const total = await page.locator("#ingTotal").innerText();
    check("★★ 표 줄을 누르면 그 업체만 (600)", /600/.test(total), total);
    const rows = await page.locator("#ingRowsTable").innerText();
    check("★ 그 업체가 판 것만", /雞蛋/.test(rows) && !/紅蘿蔔/.test(rows), rows.replace(/\n/g, " | ").slice(0, 200));
    await page.locator('#ingVendorTable [data-ing-vendor="泳慶蛋行"]').click();
    await page.waitForTimeout(900);
    check("★ 같은 줄을 다시 누르면 전체로", /990/.test(await page.locator("#ingTotal").innerText()), "");
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  // 터져도 **거기까지 잰 것은 보여준다** — 어디서 어긋났는지 알아야 고친다.
  console.log(out.join(String.fromCharCode(10)));
  console.error("터졌습니다:", String(e && e.message).slice(0, 200));
  process.exit(1);
});
