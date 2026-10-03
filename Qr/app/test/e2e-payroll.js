// 직원 급여 화면 — 카드를 표에 넣고, 초과 시간을 확인하고, 저장한다.
//
// 2026-10-03 사장님: "직원들 월급 계산을 하고 싶은데 시급제, 월급제 … 별이 없는
// 건 주5일까지만 찍고 별부터는 주5일이 지난 것만 넣어. 한마디로 둘이 합쳐야 한
// 직원이 일한 모든 게 들어간다는거야." 계산 규칙은 test/payroll.test.js 가 잰다 —
// 여기서는 손으로 넣는 흐름과 「확인 전에는 확정이 아니다」.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};
process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-payroll";
process.env.ADMIN_PASSWORD = "ownerpass123";

const { launchBrowser } = require("./browser");
const app = require("../server");

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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "ownerpass123" }) });
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  out.push("[급여 탭]");
  const tab = page.locator('.admin-tabs button[data-tab="payroll"]');
  check("사장님 화면에 「💰 급여」 탭", (await tab.isVisible()) && /급여/.test(await tab.innerText()), "");
  await tab.click();
  await page.waitForTimeout(600);
  await page.fill("#payrollMonth", "2026-06");
  await page.dispatchEvent("#payrollMonth", "change");
  await page.waitForTimeout(600);
  {
    const hrs = await page.locator("#payrollHours").innerText();
    // 2026-10-03 사장님: "이미 있는 근무 시간대가 있잖아 우리 영업 시간"
    check("★★ 근무 시간대 = 가게 영업시간이라고 보여준다", /영업시간 11:00–14:00 · 17:00–21:00/.test(hrs) && /하루 7시간/.test(hrs), hrs);
    check("급여 화면에 따로 퇴근 시각 칸이 없다", (await page.locator("#payrollAmEnd, #payrollPmEnd").count()) === 0, "");
  }
  check("직원이 없으면 그렇게 말한다", /직원이 없어요/.test(await page.locator("#payrollSummary").innerText()), "");

  await page.click("#payrollAddStaff");
  await page.fill("#payrollNewName", "劉芷芸");
  await page.click("#payrollAddStaff");
  await page.waitForTimeout(900);
  check("★ 직원을 추가하면 카드 표가 열린다", await page.locator("#payrollEditor").isVisible(), "");
  check("6월은 30줄", (await page.locator("#payrollGrid tbody tr").count()) === 30, "");
  check("6월 6일은 토요일 표시", /토/.test(await page.locator('#payrollGrid tr[data-day="6"] .pg-day').innerText()), "");
  await page.fill("#payrollHourlyRate", "200");
  await page.click("#payrollSaveStaff");
  await page.waitForTimeout(600);

  out.push("\n[카드 넣기 — 숫자만 쳐도 된다]");
  const put = async (day, vals) => {
    const slots = ["am_in", "am_out", "pm_in", "pm_out"];
    for (let i = 0; i < vals.length; i++) {
      const inp = page.locator(`#payrollGrid tr[data-day="${day}"] input[data-slot="${slots[i]}"]`);
      await inp.fill(vals[i]);
      await inp.press("Tab");
    }
  };
  await put(2, ["0911", "1400", "1604", "2100"]);
  await put(7, ["0902", "1426", "1614", "2123"]);
  await put(6, ["0911", "1402", "1610", "2100"]);
  await page.locator('#payrollGrid tr[data-day="6"] input.pg-star').check();
  await page.waitForTimeout(900);
  check("★ 「0911」 → 「09:11」", (await page.locator('#payrollGrid tr[data-day="2"] input[data-slot="am_in"]').inputValue()) === "09:11", "");
  check("★ 별 카드 날은 줄 색이 다르다", await page.locator('#payrollGrid tr[data-day="6"]').evaluate((tr) => tr.classList.contains("is-star")), "");
  const res1 = await page.locator("#payrollResult").innerText();
  check("★★ 「출근 2 + ★1일」", /출근 2 \+ ★1일/.test(res1), res1);
  const ot7 = await page.locator('#payrollGrid tr[data-day="7"] .pg-ot').innerText();
  check("★★ 7일 — 14:26 은 0.5 제안, 21:23 은 경계라 노란 칸", /0\.5/.test(ot7) && /오전 \+26분/.test(ot7) && /오후 \+23분/.test(ot7) && (await page.locator('#payrollGrid tr[data-day="7"]').evaluate((tr) => tr.classList.contains("is-check"))), ot7);
  check("★★ 확인 안 한 날이 있다고 말한다", /확인하지 않은 날이 1일/.test(res1), res1);
  check("저장 안 됨 표시", /저장 안 됨/.test(await page.locator("#payrollStatus").innerText()), "");

  out.push("\n[사장님이 고친다 — 7일은 0.5 + 0.5 = 1]");
  await page.locator('#payrollGrid tr[data-day="7"] .pg-plus').click();
  await page.waitForTimeout(800);
  const ot7b = await page.locator('#payrollGrid tr[data-day="7"] .pg-ot').innerText();
  check("★ + 를 누르면 1, 제안 0.5 도 같이 보인다", /^−\s*1\s*\+/.test(ot7b.trim()) && /제안 0\.5/.test(ot7b), ot7b);
  check("★ 고치면 확인된 것 — 노란 칸이 사라진다", !(await page.locator('#payrollGrid tr[data-day="7"]').evaluate((tr) => tr.classList.contains("is-check"))), "");
  const res2 = await page.locator("#payrollResult").innerText();
  // 근무 시간대 = 가게 영업시간(11:00-14:00, 17:00-21:00) → 하루 7시간.
  // 3일 × 7시간 + 초과 1시간 = 22시간 × 200
  check("★★ 합계 NT$4,400 (영업시간 기준 22시간 × 200)", /합계\s*NT\$4,400/.test(res2), res2);
  check("확인 경고가 사라진다", !/확인하지 않은/.test(res2), res2);

  out.push("\n[저장 → 다시 열기]");
  await page.click("#payrollSaveCard");
  await page.waitForTimeout(900);
  check("저장했어요", /저장했어요/.test(await page.locator("#payrollStatus").innerText()), "");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await page.locator('.admin-tabs button[data-tab="payroll"]').click();
  await page.waitForTimeout(500);
  await page.fill("#payrollMonth", "2026-06");
  await page.dispatchEvent("#payrollMonth", "change");
  await page.waitForTimeout(800);
  check("★ 직원 칩에 이 달 금액", /NT\$4,400/.test(await page.locator("#payrollStaffChips").innerText()), await page.locator("#payrollStaffChips").innerText());
  await page.locator("#payrollStaffChips button").first().click();
  await page.waitForTimeout(900);
  check("★★ 다시 열어도 그대로", (await page.locator('#payrollGrid tr[data-day="7"] input[data-slot="pm_out"]').inputValue()) === "21:23" && /합계\s*NT\$4,400/.test(await page.locator("#payrollResult").innerText()), "");

  out.push("\n[📷 카드 사진으로 채우기 — 2026-10-03]");
  {
    // 진짜 Claude 대신 가짜 — ★ 카드(6월)를 읽었다고 답한다.
    const V = require("../src/payrollVision");
    const answer = {
      name: "劉芷芸", roc_year: 115, month: 6, star: true,
      days: [
        { day: 12, am_in: "09:04", am_out: "14:00", pm_in: "16:11", pm_out: "21:08", ot_in: null, ot_out: null },
        { day: 19, am_in: "09:00", am_out: "14:07", pm_in: "16:07", pm_out: "21:06", ot_in: null, ot_out: null },
      ],
      unclear: [{ day: 19, slot: "pm_out", note: "smudged" }],
    };
    let calls = 0;
    V.setClientForTest({ beta: { messages: { create: async () => { calls++; return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(answer) }] }; } } } });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    await page.locator('.admin-tabs button[data-tab="payroll"]').click();
    await page.fill("#payrollMonth", "2026-06");
    await page.dispatchEvent("#payrollMonth", "change");
    await page.waitForTimeout(700);
    await page.locator("#payrollStaffChips button").first().click();
    await page.waitForTimeout(800);
    check("「📷 카드 사진으로 채우기」 버튼", /카드 사진/.test(await page.locator(".payroll-photo-btn").innerText()), "");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    await page.setInputFiles("#payrollPhoto", { name: "card.png", mimeType: "image/png", buffer: png });
    await page.waitForTimeout(1500);
    const msg = await page.locator("#payrollPhotoMsg").innerText();
    check("★★ 「★ 카드에서 2일을 읽었어요」", /★ 카드에서 2일을 읽었어요/.test(msg), msg);
    check("★★ 12일이 표에 들어가고 ★ 가 켜진다", (await page.locator('#payrollGrid tr[data-day="12"] input[data-slot="pm_out"]').inputValue()) === "21:08" && (await page.locator('#payrollGrid tr[data-day="12"] input.pg-star').isChecked()), "");
    check("★ 읽은 칸은 파란 글씨", await page.locator('#payrollGrid tr[data-day="12"] input[data-slot="am_in"]').evaluate((el) => el.classList.contains("is-read")), "");
    check("★ 확실치 않은 칸(19일 오후 퇴근)은 노란 칸", await page.locator('#payrollGrid tr[data-day="19"] input[data-slot="pm_out"]').evaluate((el) => el.classList.contains("is-unclear")), "");
    check("★★ 저장 전 — 「저장 안 됨」(사진만으로 저장하지 않는다)", /저장 안 됨/.test(await page.locator("#payrollStatus").innerText()), "");
    check("결과에 ★ 날이 늘었다(1 → 3)", /★3일/.test(await page.locator("#payrollResult").innerText()), await page.locator("#payrollResult").innerText());
    // 다른 달 카드는 채우지 않고 말한다.
    answer.month = 7;
    await page.setInputFiles("#payrollPhoto", { name: "card.png", mimeType: "image/png", buffer: png });
    await page.waitForTimeout(1500);
    check("★ 다른 달 카드는 채우지 않고 이유를 말한다", /2026-07 카드예요/.test(await page.locator("#payrollPhotoMsg").innerText()), await page.locator("#payrollPhotoMsg").innerText());
    check("모델을 두 번 불렀다", calls === 2, String(calls));
    await page.click("#payrollSaveCard");
    await page.waitForTimeout(900);
    check("저장하면 저장된다", /저장했어요/.test(await page.locator("#payrollStatus").innerText()), "");
    V.setClientForTest(null);
  }

  out.push("\n[잘못 친 시각]");
  const bad = page.locator('#payrollGrid tr[data-day="9"] input[data-slot="am_in"]');
  await bad.fill("2599");
  await bad.press("Tab");
  await page.waitForTimeout(300);
  check("빨간 칸", await bad.evaluate((el) => el.classList.contains("is-bad")), "");
  await page.click("#payrollSaveCard");
  await page.waitForTimeout(400);
  check("★ 빨간 칸이 있으면 저장하지 않고 이유를 말한다", /빨간 칸/.test(await page.locator("#appDialogMessage").innerText().catch(() => "")), "");
  await page.locator("#appDialogOk").click().catch(() => {});

  out.push("\n[휴대폰 폭]");
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("★ 화면이 옆으로 안 넘친다(표만 옆으로 민다)", overflow <= 1, `${overflow}px`);

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
