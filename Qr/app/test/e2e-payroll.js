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

  out.push("\n[📷 카드 사진으로 채우기 — AI 없이, 이 브라우저에서]");
  {
    // 2026-10-03 사장님: "손글씨로 인식이 되면 직접 채워 넣어야 한다는 걸 표시해줘."
    // 사장님이 보내신 6월 카드(이름 칸 지움)를 그대로 올린다.
    const requests = [];
    page.on("request", (r) => { if (r.method() === "POST") requests.push(r.url()); });
    check("「📷 카드 사진으로 채우기」 버튼", /카드 사진/.test(await page.locator(".payroll-photo-btn").innerText()), "");
    await page.setInputFiles("#payrollPhoto", require("path").join(__dirname, "fixtures", "timecard-normal.webp"));
    await page.locator("#payrollPhotoMsg").getByText("직접 채워 넣어").waitFor({ timeout: 20000 }).catch(() => {});
    const msg = await page.locator("#payrollPhotoMsg").innerText();
    check("★★ 두 면을 읽었다고 말한다", /1~15일 면에서 10일/.test(msg) && /16~31일 면에서 11일/.test(msg), msg);
    check("★★ 손글씨 칸 2개 — 어디인지 적는다", /손글씨라 읽지 않은 칸 2개/.test(msg) && /3일 오전 퇴근/.test(msg) && /30일 오후 출근/.test(msg), msg);
    const hand3 = page.locator('#payrollGrid tr[data-day="3"] input[data-slot="am_out"]');
    check("★★ 손글씨 칸은 빨간 칸 + 「✍」, 값은 비어 있다", (await hand3.evaluate((el) => el.classList.contains("is-hand") && el.placeholder === "✍")) && (await hand3.inputValue()) === "", "");
    check("빨간 칸에 마우스를 올리면 「직접 채워 넣어 주세요」", /직접 채워 넣어/.test(await hand3.getAttribute("title")), "");
    check("★ 읽은 칸은 파란 글씨 — 2일 09:11", (await page.locator('#payrollGrid tr[data-day="2"] input[data-slot="am_in"]').inputValue()) === "09:11" && (await page.locator('#payrollGrid tr[data-day="2"] input[data-slot="am_in"]').evaluate((el) => el.classList.contains("is-read"))), "");
    check("28일 23:12 도 읽는다", (await page.locator('#payrollGrid tr[data-day="28"] input[data-slot="pm_out"]').inputValue()) === "23:12", "");
    check("★★ 사진은 서버로 가지 않는다(POST 는 계산 미리보기뿐)", requests.every((u) => /\/api\/payroll\/preview$/.test(u)), requests.join(" "));
    check("저장 전 — 「저장 안 됨」", /저장 안 됨/.test(await page.locator("#payrollStatus").innerText()), "");
    // 사장님이 카드를 보고 손글씨 칸을 채우면 빨간 칸이 풀린다.
    await hand3.fill("1405");
    await hand3.press("Tab");
    await page.waitForTimeout(300);
    check("★ 채우면 빨간 칸이 풀린다", (await hand3.inputValue()) === "14:05" && !(await hand3.evaluate((el) => el.classList.contains("is-hand"))), "");
    // ★ 카드
    await page.setInputFiles("#payrollPhoto", require("path").join(__dirname, "fixtures", "timecard-star.webp"));
    await page.locator("#payrollPhotoMsg").getByText("★ 카드").first().waitFor({ timeout: 20000 }).catch(() => {});
    check("★★ ★ 카드를 올리면 그 날들에 ★ 가 켜진다", await page.locator('#payrollGrid tr[data-day="19"] input.pg-star').isChecked(), await page.locator("#payrollPhotoMsg").innerText());
    await page.waitForTimeout(800);
    check("★★ 결과 「출근 21 + ★4일」", /출근 21 \+ ★4일/.test(await page.locator("#payrollResult").innerText()), await page.locator("#payrollResult").innerText());
    await page.click("#payrollSaveCard");
    await page.waitForTimeout(900);
    check("저장", /저장했어요/.test(await page.locator("#payrollStatus").innerText()), "");
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
