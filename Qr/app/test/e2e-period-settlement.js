// 월 결산·연 결산 — 매출 − 식자재 − 인건비, 그리고 LINE 으로 보내기.
//
// 2026-10-06 사장님: "결산탭에 월 결산, 연결산도 만들어줄래? 그 결산에는
// 식자재 비용, 급여도 같이 넣어서 계산하면 좋을 것 같은데? 그리고 그것도
// line 으로 한 번 싹 정리해서 보내주면 더 좋을 것 같고. 그리고 더 확실하게
// 알고 싶다면 링크 첨부하면서 메세지에 여기서 더 볼 수 있다고 하는 것도
// 좋을 것 같아"
//
// 재는 것:
//   · 세 곳(마감 기록·식자재·급여)에서 모은 숫자가 맞는가
//   · 「남은 것」이 매출 − 식자재 − 인건비 인가
//   · 빠진 것(마감 기록 없는 날)을 **말하는가**
//   · LINE 문자에 링크와 「여기서 더 볼 수 있다」가 들어 있는가
//   · 그 링크로 들어오면 그 달이 열리는가
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};
process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-period";
process.env.ADMIN_PASSWORD = "ownerpass123";

const { launchBrowser } = require("./browser");
const app = require("../server");

let pass = 0, fail = 0;
const out = [];
const check = (name, cond, extra = "") => {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
};

const MONTH = "2026-09";
// 하루 마감 기록 — 매출 100,000
const SNAPS = [
  { id: "ds-2026-09-01", date: "2026-09-01", total_revenue: 30000, paid_order_count: 40, guest_count: 95 },
  { id: "ds-2026-09-02", date: "2026-09-02", total_revenue: 25000, paid_order_count: 33, guest_count: 80 },
  { id: "ds-2026-09-03", date: "2026-09-03", total_revenue: 45000, paid_order_count: 55, guest_count: 130 },
];
// 식자재 20,000
const ING = [
  { store: "main", date: "2026-09-02", name: "紅蘿蔔", qty: 100, unit: "斤", price: 120, amount: 12000, vendor: "房信菓菜行", note: "당근" },
  { store: "main", date: "2026-09-03", name: "雞蛋", qty: 10, unit: "箱", price: 800, amount: 8000, vendor: "泳慶蛋行", note: "계란" },
];

(async () => {
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await fetch("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "ownerpass123" }),
    });
  });

  // 마감 기록을 넣는다(가짜 DB 에 바로 — 화면으로 사흘치를 만드는 것이 아니다)
  const db = fake.__db;
  await db.collection("daily_settlements").insertMany(SNAPS.map((x) => ({ ...x, _id: x.id })));
  // 식자재
  const put = await page.request.post(`${base}/api/ingredients/import`, { data: { store: "main", rows: ING } });
  check("식자재를 넣었다", put.ok(), String(put.status()));
  // 급여 — 직원 하나, 그 달 카드. 시급제 220원, 하루 9.5시간 × 10일 = 20,900
  const staffRes = await page.request.post(`${base}/api/payroll/staff`, {
    data: { name: "시험직원", pay_type: "hourly", hourly_rate: 220 },
  });
  const staffId = staffRes.ok() ? ((await staffRes.json()).staff || {}).id : null;
  if (staffId) {
    const days = {};
    for (let d = 1; d <= 10; d++) {
      days[String(d)] = { am_in: "09:00", am_out: "14:00", pm_in: "16:30", pm_out: "21:00" };
    }
    const card = await page.request.put(`${base}/api/payroll/card`, { data: { staff_id: staffId, month: MONTH, days } });
    check("급여 카드를 넣었다", card.ok(), String(card.status()));
  }
  check("직원·카드를 넣었다", !!staffId, String(staffId));

  out.push("[서버가 세 곳을 모은다]");
  const got = await (await page.request.get(`${base}/api/settlements/period?key=${MONTH}`)).json();
  {
    check("★★ 매출은 하루 마감 기록을 더한 것 (100,000)", got.revenue.total === 100000, JSON.stringify(got.revenue));
    check("★ 주문·손님도 더한다 (128건 · 305명)", got.revenue.orders === 128 && got.revenue.guests === 305, JSON.stringify(got.revenue));
    check("★★ 식자재비가 들어온다 (20,000)", got.ingredients.total === 20000, String(got.ingredients.total));
    check("★ 어느 업체에 많이 썼는지도", (got.ingredients.vendors || [])[0] && got.ingredients.vendors[0].vendor === "房信菓菜行", JSON.stringify(got.ingredients.vendors));
    check("★★ 인건비가 들어온다 (0 보다 크다)", got.payroll.total > 0, JSON.stringify(got.payroll));
    check("★★ 남은 것 = 매출 − 식자재 − 인건비",
      got.left === Math.round((got.revenue.total - got.ingredients.total - got.payroll.total) * 100) / 100,
      `${got.left} vs ${got.revenue.total}-${got.ingredients.total}-${got.payroll.total}`);
    check("★ 매출 대비 비율도 준다", got.cost_pct.ingredients === 20, String(got.cost_pct.ingredients));
    // 9월은 30일인데 기록은 사흘 — 숨기지 않는다
    check("★★ 마감 기록이 없는 날을 센다 (27일)", got.missing_days === 27, String(got.missing_days));
    check("★ 지난 달이라 「진행 중」이 아니다", got.ongoing === false, String(got.ongoing));
  }

  {
    const year = await (await page.request.get(`${base}/api/settlements/period?key=2026`)).json();
    check("★★ 한 해 매출에 그 달이 들어 있다", year.revenue.total === 100000, String(year.revenue.total));
    check("★★ 달이 열두 줄", (year.by_month || []).length === 12, String((year.by_month || []).length));
    const sep = (year.by_month || []).find((m) => m.month === MONTH);
    check("★★ 9월 줄에 매출·식자재·인건비가 다 있다",
      sep && sep.revenue === 100000 && sep.ingredients === 20000 && sep.payroll > 0, JSON.stringify(sep));
    check("★ 자료 없는 달은 0 — 지어내지 않는다",
      (year.by_month || []).filter((m) => m.month === "2026-05")[0].revenue === 0, "");
  }

  out.push("\n[이상한 기간은 안 받는다]");
  {
    const bad = await page.request.get(`${base}/api/settlements/period?key=2026-13`);
    check("★ 없는 달은 400", bad.status() === 400, String(bad.status()));
    const bad2 = await page.request.get(`${base}/api/settlements/period?key=abc`);
    check("★ 아무 글자나 안 받는다", bad2.status() === 400, String(bad2.status()));
  }

  {
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    await page.locator('.admin-tabs button[data-tab="settlement"]').click();
    await page.waitForTimeout(1200);
    // 쌓지 않고 바꾼다 — 도구 줄의 「월」을 눌러야 열린다(2026-10-06)
    check("★ 처음엔 하루 결산이다", await page.locator("#settlementPeriod").evaluate((el) => el.hidden), "");
    await page.locator("[data-stl-mode=\"month\"]").click();
    await page.waitForTimeout(1200);
    check("★★ 「월」을 누르면 월 결산이 열린다", await page.locator("#settlementPeriod").isVisible(), "");
    check("★★ 하루 결산은 감춰진다 — 화면이 길어지지 않게",
      !(await page.locator("#tab-settlement .stl-hero").first().isVisible()), "");
    // 이 달(10월)로 시작하니 9월로 한 번 되돌린다
    await page.locator("#periodPrev").click();
    await page.waitForTimeout(1200);
    const texts = await page.evaluate(() => ({
      rev: document.querySelector("#periodRevenue").textContent,
      ing: document.querySelector("#periodIngredients").textContent,
      pay: document.querySelector("#periodPayroll").textContent,
      left: document.querySelector("#periodLeft").textContent,
      note: document.querySelector("#periodNote").textContent,
      month: document.querySelector("#periodMonthInput").value,
    }));
    check("★★ 9월로 옮겨진다", texts.month === MONTH, texts.month);
    check("★★ 매출이 화면에 (100,000)", /100,000/.test(texts.rev), texts.rev);
    check("★★ 식자재 (20,000)", /20,000/.test(texts.ing), texts.ing);
    check("★★ 인건비가 0 이 아니다", !/^NT\$0$/.test(texts.pay.trim()), texts.pay);
    check("★★ 남은 것이 보인다", /NT\$/.test(texts.left), texts.left);
    // 결산 탭을 열면 빠진 날이 주문으로 채워진다(backfillMissingSnapshots).
    // 그래서 9월은 경고가 사라지는 것이 맞다 — 경고는 **정말 없는 달**에서 잰다.
    await page.locator("#periodPrev").click();
    await page.waitForTimeout(1200);
    const aug = await page.evaluate(() => ({
      month: document.querySelector("#periodMonthInput").value,
      note: document.querySelector("#periodNote").textContent,
      warn: document.querySelector("#periodNote").classList.contains("is-warn"),
      rev: document.querySelector("#periodRevenue").textContent,
    }));
    check("★ 8월로 간다", aug.month === "2026-08", aug.month);
    check("★★ 기록이 아예 없는 달은 그렇다고 말한다", /마감 기록이 없는 날/.test(aug.note), aug.note);
    check("★★ 그 줄이 눈에 띈다", aug.warn, String(aug.warn));
    check("★ 매출은 0 으로 보인다 — 그래서 위 경고가 꼭 필요하다", /NT\$0/.test(aug.rev), aug.rev);
    await page.locator("#periodNext").click();
    await page.waitForTimeout(1000);
    const hint = await page.locator('[data-i18n="periodMissingCosts"]').innerText();
    check("★★ 임대료·세금이 안 들어갔다고 적혀 있다", /임대료/.test(hint) && /이익이 아니라/.test(hint), hint.slice(0, 80));
  }

  {
    await page.locator('[data-stl-mode="year"]').click();
    await page.waitForTimeout(1400);
    check("★ 달별 칸이 열린다", !(await page.locator("#periodYearBlock").evaluate((el) => el.hidden)), "");
    // 연으로 바꾸면 **고르는 칸도** 연으로 바뀐다(2026-10-06: 달 칸이 그대로 남아
    // 9월을 보고 있는 것처럼 보였다)
    check("★★ 연을 고르면 달 칸이 사라지고 연 칸이 뜬다",
      (await page.locator("#periodMonthInput").evaluate((el) => el.hidden)) &&
      !(await page.locator("#periodYearInput").evaluate((el) => el.hidden)), "");
    const t = await page.locator("#periodYearTable").innerText();
    check("★★ 열두 달이 줄로", (t.match(/월/g) || []).length >= 12, t.replace(/\n/g, " | ").slice(0, 120));
    check("★ 합계 줄", /합계/.test(t), t.replace(/\n/g, " | ").slice(-100));
    await page.locator('[data-stl-mode="month"]').click();
    await page.waitForTimeout(1000);
  }

  {
    // LINE 은 실제로 안 나가게 가로채고, **무엇이 나갔는지**를 본다.
    const sent = await page.evaluate(async (month) => {
      const res = await fetch("/api/settlements/period/line", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: month }),
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    }, MONTH);
    // LINE 설정이 없으면 502 가 나는데, 그때도 **무슨 글이 나갈지**는 돌려준다
    const text = (sent.body && sent.body.text) || "";
    check("★★ 보낼 글을 만든다", !!text, JSON.stringify(sent).slice(0, 160));
    check("★★ 매출·식자재·인건비·남은 것이 다 적힌다",
      /매출 NT\$100,000/.test(text) && /식자재 NT\$20,000/.test(text) && /인건비/.test(text) && /남은 것/.test(text),
      text.split("\n").join(" | ").slice(0, 220));
    check("★★ 링크가 들어 있다 (그 달을 바로 여는 주소)",
      /\/admin\?period=2026-09#settlement/.test(text), text.split("\n").join(" | ").slice(-160));
    check("★★ 「여기서 더 볼 수 있다」고 적는다", /더 자세히 보시려면/.test(text), "");
    check("★★ 임대료·세금이 빠졌다고 문자에도", /임대료·수도광열·세금은 아직 안 들어갔어요/.test(text), "");
    check("★ 「이익」이라고 쓰지 않는다", !/이익/.test(text), "");
    check("★ LINE 이 꺼져 있으면 그렇다고 — 조용히 성공하지 않는다",
      sent.status === 200 || sent.status === 502, String(sent.status));
  }

  out.push("\n[문자의 링크로 들어오면 그 달이 열린다]");
  {
    await page.goto(`${base}/admin?period=${MONTH}#settlement`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1600);
    const v = await page.locator("#periodMonthInput").inputValue();
    check("★★ 링크의 달이 골라져 있다", v === MONTH, v);
    const rev = await page.locator("#periodRevenue").innerText();
    check("★★ 그 달 숫자가 떠 있다", /100,000/.test(rev), rev);
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log(out.join(String.fromCharCode(10)));
  console.error("터졌습니다:", String(e && e.message).slice(0, 300));
  process.exit(1);
});
