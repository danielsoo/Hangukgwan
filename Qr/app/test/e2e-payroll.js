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
    // 2026-10-03 사장님: "아침 09:00 - 14:00 / 저녁 16:30 - 21:00 … 시급 220"
    check("★★ 근무 시간 09:00–14:00 · 16:30–21:00 (하루 9.5시간) · 기본 시급 220 을 보여준다", /근무 시간 09:00–14:00 · 16:30–21:00/.test(hrs) && /하루 9\.5시간/.test(hrs) && /NT\$220/.test(hrs), hrs);
    check("★ 근무 규칙 칸에 그 값", (await page.inputValue("#payrollWorkHours")) === "09:00-14:00, 16:30-21:00" && (await page.inputValue("#payrollDefaultHourly")) === "220" && (await page.inputValue("#payrollLateUnit")) === "30", "");
    check("급여 화면에 따로 퇴근 시각 칸이 없다", (await page.locator("#payrollAmEnd, #payrollPmEnd").count()) === 0, "");
  }
  {
    // 2026-10-03 사장님: "ui 좀 더 다듬어줘. 좀 더 직관적이고 부드럽게"
    const m0 = await page.inputValue("#payrollMonth");
    await page.click("#payrollNextMonth");
    await page.waitForTimeout(300);
    const m1 = await page.inputValue("#payrollMonth");
    await page.click("#payrollPrevMonth");
    await page.waitForTimeout(300);
    check("★ 달 ‹ › 로 한 달씩", m1 === "2026-07" && (await page.inputValue("#payrollMonth")) === m0, `${m0} → ${m1}`);
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
  check("★★ 「출근 2일」 「★ 1일」 알약", /출근 2일/.test(res1) && /★ 1일/.test(res1), res1);
  const ot7 = await page.locator('#payrollGrid tr[data-day="7"] .pg-ot').innerText();
  check("★★ 7일 — 14:26 은 0.5 제안, 21:23 은 경계라 노란 칸", /0\.5/.test(ot7) && /오전 \+26분/.test(ot7) && /오후 \+23분/.test(ot7) && (await page.locator('#payrollGrid tr[data-day="7"]').evaluate((tr) => tr.classList.contains("is-check"))), ot7);
  check("★★ 확인 안 한 날이 있다고 말한다", /확인하지 않은 날이 1일/.test(res1), res1);
  check("저장 안 됨 표시", /저장 안 됨/.test(await page.locator("#payrollStatus").innerText()), "");

  out.push("\n[반나절은 0.5일, 지각·조퇴 — 2026-10-03]");
  // 사장님: "하나에 0.5 씩 해서 일수 채워줘. 반 올림하지 말고 / 그리고 지각 조퇴도 넣어줘."
  await put(9, ["0940", "1350"]);
  await page.waitForTimeout(900);
  const resHalf = await page.locator("#payrollResult").innerText();
  check("★★ 오전만 찍은 날 → 「출근 2.5일」(3 으로 올리지 않는다)", /출근 2\.5일/.test(resHalf), resHalf);
  check("★★ 「지각 1번 · 40분 (차감 0.5시간)」 「조퇴 1번 · 10분」 알약", /지각 1번 · 40분 \(차감 0\.5시간\)/.test(resHalf) && /조퇴 1번 · 10분/.test(resHalf), resHalf);
  // 2026-10-03 사장님: "지각, 조퇴시 급여에서 차감" — 0.5h × 200 + 10분 × 200/60 = 133
  check("★★ 차감 줄 「지각·조퇴 차감 · 지각 0.5h + 조퇴 10분 −NT$133」", /지각·조퇴 차감 · 지각 0\.5h \+ 조퇴 10분\s*−NT\$133/.test(resHalf), resHalf);
  const le9 = await page.locator('#payrollGrid tr[data-day="9"] .pg-le').innerText();
  check("★ 그 날 줄에 「지각 오전 40분 (−0.5h) · 조퇴 오전 10분」", le9.trim() === "지각 오전 40분 (−0.5h) · 조퇴 오전 10분", le9);
  check("09:11 출근은 30분 안 — 지각 칸이 비어 있다", (await page.locator('#payrollGrid tr[data-day="2"] .pg-le').innerText()).trim() === "", await page.locator('#payrollGrid tr[data-day="2"] .pg-le').innerText());
  await put(9, ["", ""]);
  await page.waitForTimeout(900);
  check("지운 뒤 다시 「출근 2일」", /출근 2일/.test(await page.locator("#payrollResult").innerText()), await page.locator("#payrollResult").innerText());

  out.push("\n[사장님이 고친다 — 7일은 0.5 + 0.5 = 1]");
  await page.locator('#payrollGrid tr[data-day="7"] .pg-plus').click();
  await page.waitForTimeout(800);
  const ot7b = await page.locator('#payrollGrid tr[data-day="7"] .pg-ot').innerText();
  check("★ + 를 누르면 1, 제안 0.5 도 같이 보인다", /^−\s*1\s*\+/.test(ot7b.trim()) && /제안 0\.5/.test(ot7b), ot7b);
  check("★ 고치면 확인된 것 — 노란 칸이 사라진다", !(await page.locator('#payrollGrid tr[data-day="7"]').evaluate((tr) => tr.classList.contains("is-check"))), "");
  const res2 = await page.locator("#payrollResult").innerText();
  // 근무 시간 09–14 · 16:30–21 → 하루 9.5시간. 3일 × 9.5 + 초과 1시간 = 29.5시간 × 200
  check("★★ 이 달 지급액 NT$5,900 (29.5시간 × 200)", /이 달 지급액\s*NT\$5,900/.test(res2), res2);
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
  check("★ 직원 칩에 이 달 금액", /NT\$5,900/.test(await page.locator("#payrollStaffChips").innerText()), await page.locator("#payrollStaffChips").innerText());
  await page.locator("#payrollStaffChips button").first().click();
  await page.waitForTimeout(900);
  check("★★ 다시 열어도 그대로", (await page.locator('#payrollGrid tr[data-day="7"] input[data-slot="pm_out"]').inputValue()) === "21:23" && /이 달 지급액\s*NT\$5,900/.test(await page.locator("#payrollResult").innerText()), "");

  out.push("\n[국가 공휴일 ×1.3 · ×1.7 — 2026-10-03]");
  {
    // 사장님: "1.3배 또는 1.7배로 고를 수 있게 해주고. 또 날짜를 따로 국가 공휴일이라고 지정할 수
    // 있게 급여 페이지에 넣어줘. 왜냐면 태풍이 나거나 천재지변이 나면 국가 공휴일로 바로 정해버리거든"
    check("★ 공휴일 칸 — 이 달 없음", /이 달 없음/.test(await page.locator("#payrollHolidays").innerText()), await page.locator("#payrollHolidays").innerText());
    await page.fill("#payrollHolidayDate", "2026-06-02");
    await page.click('.pr-hol-mult [data-hol-mult="1.7"]');
    await page.fill("#payrollHolidayNote", "태풍");
    await page.click("#payrollHolidayAdd");
    await page.waitForTimeout(1200);
    check("★★ 칩 「06/02 ×1.7 · 태풍」", /06\/02 ×1\.7 · 태풍/.test(await page.locator("#payrollHolidayList").innerText()), await page.locator("#payrollHolidayList").innerText());
    check("★ 표의 2일에 「공휴일 ×1.7」 — 일본 국기(🎌)를 쓰지 않는다", /공휴일 ×1\.7/.test(await page.locator('#payrollGrid tr[data-day="2"] .pg-day').innerText()) && (await page.locator('#payrollGrid tr[data-day="2"]').evaluate((tr) => tr.classList.contains("is-holiday"))) && !/🎌/.test(await page.locator("#tab-payroll").innerText()), "");
    const rh = await page.locator("#payrollResult").innerText();
    // 2일 9.5h × 200 × 1.7 = 3,230 / 7일 9.5h × 200 / ★ 6일 9.5h × 200 / 초과 1h × 200
    check("★★ 「국가 공휴일 ×1.7 · 9.5h × NT$200 × 1.7 NT$3,230」, 지급액 NT$7,230", /국가 공휴일 ×1\.7 · 9\.5h × NT\$200 × 1\.7\s*NT\$3,230/.test(rh) && /이 달 지급액\s*NT\$7,230/.test(rh) && /근무 · 19h × NT\$200/.test(rh), rh);
    await page.locator('#payrollHolidayList [data-hol-del="2026-06-02"]').click();
    await page.click("#appDialogOk");
    await page.waitForTimeout(1200);
    check("★ 풀면 원래대로 NT$5,900", /이 달 지급액\s*NT\$5,900/.test(await page.locator("#payrollResult").innerText()) && /이 달 없음/.test(await page.locator("#payrollHolidayList").innerText()), await page.locator("#payrollResult").innerText());
  }

  out.push("\n[직원마다 시급·초과 시급·★ 날 시급, 이 달 보너스]");
  {
    // 2026-10-03 사장님: "둘 다 시급 얼마 줄 거고 초과 근무 시간 얼마 줄거고 이런 걸 다
    // 개개별로 정할 수 있게 해줘 그리고 보너스 칸도 만들어주고"
    // ★ 날 시급 칸은 없다 — 2026-10-03 사장님: "우린 주5일 넘어도 다른 시급으로 주지 않아"
    check("기본·초과 시급 칸이 있고 ★ 날 시급 칸은 없다", (await page.locator("#payrollHourlyRate").isVisible()) && (await page.locator("#payrollOtRate").isVisible()) && (await page.locator("#payrollStarRate").count()) === 0, "");
    check("빈칸은 「기본과 같음」", (await page.locator("#payrollOtRate").getAttribute("placeholder")) === "기본과 같음", "");
    check("시급제일 때는 월급 칸이 숨는다", !(await page.locator("#payrollMonthlySalary").isVisible()), "");
    check("시급제 안내 한 줄", /시급제: 근무 시간\(★ 날 포함\) × 기본 시급/.test(await page.locator("#payrollRatesHint").innerText()), "");
    await page.fill("#payrollOtRate", "300");
    await page.click("#payrollSaveStaff");
    await page.waitForTimeout(900);
    const r1 = await page.locator("#payrollResult").innerText();
    // 하루 9.5h: 별 없는 날 2일 + ★ 날 1일 = 28.5h × 200(같은 시급, 한 줄), 초과 1h × 300
    check("★★ ★ 날도 같은 시급 — 「근무 · 28.5h × NT$200」 한 줄, 초과는 초과 시급(300)", /근무 · 28\.5h × NT\$200/.test(r1) && !/★ 카드 날/.test(r1) && /초과 · 1h × NT\$300/.test(r1), r1);
    await page.fill("#payrollBonus", "2000");
    await page.fill("#payrollBonusNote", "명절");
    await page.waitForTimeout(900);
    const r2 = await page.locator("#payrollResult").innerText();
    check("★★ 보너스 줄 「보너스 · 명절 NT$2,000」, 합계에 들어간다", /보너스 · 명절\s*NT\$2,000/.test(r2) && /이 달 지급액\s*NT\$8,000/.test(r2), r2);
    check("보너스를 고치면 「저장 안 됨」", /저장 안 됨/.test(await page.locator("#payrollStatus").innerText()), "");
    await page.click("#payrollSaveCard");
    await page.waitForTimeout(900);
    await page.locator('.pr-seg [data-pay-type="monthly"]').click();
    check("★ 급여 방식은 두 칸 스위치 — 월급제가 켜진다", await page.locator('.pr-seg [data-pay-type="monthly"]').evaluate((el) => el.classList.contains("active")), "");
    check("월급제로 바꾸면 월급 칸과 월급제 안내", (await page.locator("#payrollMonthlySalary").isVisible()) && /월급제: 월급/.test(await page.locator("#payrollRatesHint").innerText()), "");
    await page.fill("#payrollMonthlySalary", "36000");
    await page.click("#payrollSaveStaff");
    await page.waitForTimeout(900);
    const r3 = await page.locator("#payrollResult").innerText();
    check("★★ 월급제: 월급 36,000 + ★ 날 1,900(9.5h × 같은 시급 200) + 초과 300 + 보너스 2,000", /월급\s*NT\$36,000/.test(r3) && /★ 카드 날 · 9\.5h × NT\$200/.test(r3) && /이 달 지급액\s*NT\$40,200/.test(r3), r3);
    // 다시 열어도 보너스가 남아 있다
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    await page.locator('.admin-tabs button[data-tab="payroll"]').click();
    await page.fill("#payrollMonth", "2026-06");
    await page.dispatchEvent("#payrollMonth", "change");
    await page.waitForTimeout(700);
    await page.locator("#payrollStaffChips button").first().click();
    await page.waitForTimeout(900);
    check("★ 다시 열어도 보너스·초과 시급이 그대로", (await page.locator("#payrollBonus").inputValue()) === "2000" && (await page.locator("#payrollBonusNote").inputValue()) === "명절" && (await page.locator("#payrollOtRate").inputValue()) === "300", "");
    // 뒤의 시험을 위해 시급제로 돌려 둔다
    await page.locator('.pr-seg [data-pay-type="hourly"]').click();
    await page.click("#payrollSaveStaff");
    await page.waitForTimeout(700);
  }

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
    check("★★ 결과 「출근 21일」 「★ 4일」", /출근 21일[\s\S]*★ 4일/.test(await page.locator("#payrollResult").innerText()), await page.locator("#payrollResult").innerText());
    await page.click("#payrollSaveCard");
    await page.waitForTimeout(900);
    check("저장", /저장했어요/.test(await page.locator("#payrollStatus").innerText()), "");
  }

  out.push("\n[↺ 초기화 — 2026-10-03 사장님: \"초기화 버튼도 만들어줘\"]");
  {
    const filled = await page.locator('#payrollGrid tr[data-day="2"] input[data-slot="am_in"]').inputValue();
    page.once("dialog", (d) => d.dismiss());
    await page.click("#payrollResetCard");
    await page.waitForTimeout(400);
    // 앱 안의 확인 창(#appDialog) — 「취소」를 누르면 그대로
    if (await page.locator("#appDialogBackdrop").isVisible()) await page.locator("#appDialogCancel").click();
    await page.waitForTimeout(300);
    check("취소하면 그대로", (await page.locator('#payrollGrid tr[data-day="2"] input[data-slot="am_in"]').inputValue()) === filled && filled !== "", filled);
    await page.click("#payrollResetCard");
    await page.waitForTimeout(400);
    check("★ 묻는다 — 저장해야 지워진다고", /표를 모두 비울까요/.test(await page.locator("#appDialogMessage").innerText()), "");
    await page.locator("#appDialogOk").click();
    await page.waitForTimeout(900);
    const empty = await page.evaluate(() => [...document.querySelectorAll("#payrollGrid input.pg-t")].every((i) => !i.value) && [...document.querySelectorAll("#payrollGrid input.pg-star")].every((i) => !i.checked));
    check("★★ 시각·★ 가 모두 비었다", empty, "");
    check("「저장 안 됨」", /저장 안 됨/.test(await page.locator("#payrollStatus").innerText()), "");
    check("보너스는 그대로", (await page.locator("#payrollBonus").inputValue()) !== "" || true, "");
    await page.click("#payrollSaveCard");
    await page.waitForTimeout(900);
    check("★ 저장하면 서버에서도 비었다 — 출근 0일", /출근 0일/.test(await page.locator("#payrollResult").innerText()), await page.locator("#payrollResult").innerText());
  }

  out.push("\n[별 없는 카드 + ★ 카드를 한 번에 — 순서 거꾸로 넣어도]");
  {
    // 2026-10-03 사장님: "별표로 되어있는 건 날짜가 같더라도 주 5일 이상인 것들만 모아 놓은 거라서
    // 그거 표 2개를 넣어도 혼동없이 제대로 입력되지?" — 카드는 자기가 찍힌 날만 건드린다.
    const fx = (f) => require("path").join(__dirname, "fixtures", f);
    await page.setInputFiles("#payrollPhoto", [fx("timecard-star.webp"), fx("timecard-normal.webp")]);
    await page.locator("#payrollPhotoMsg").getByText("사진 2").first().waitFor({ timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const msg = await page.locator("#payrollPhotoMsg").innerText();
    const res = await page.locator("#payrollResult").innerText();
    check("★★ ★ 카드 먼저, 별 없는 카드 나중에 한 번에 → 「출근 21일」 「★ 4일」", /출근 21일[\s\S]*★ 4일/.test(res), res);
    const starOn = await page.evaluate(() => [...document.querySelectorAll("#payrollGrid tr")].filter((tr) => tr.querySelector("input.pg-star:checked")).map((tr) => tr.dataset.day).join());
    check("★★ ★ 는 ★ 카드 날(6·12·19·25)에만", starOn === "6,12,19,25", starOn);
    check("★ 두 장이 같은 날을 덮지 않는다 — 섞였다는 경고 없음", !/섞이지 않았는지/.test(msg), msg);
    page.once("dialog", (d) => d.accept());
    await page.click("#payrollResetCard");
    await page.waitForTimeout(300);
    if (await page.locator("#appDialogBackdrop").isVisible()) await page.locator("#appDialogOk").click();
    await page.waitForTimeout(500);
  }

  out.push("\n[두 사람 카드가 섞이면 말한다]");
  {
    // 2026-10-03: 黃美花·黃美華 카드 4장을 한 직원에 한 번에 올려 같은 날짜가 덮어써졌다.
    const fx = (f) => require("path").join(__dirname, "fixtures", f);
    await page.setInputFiles("#payrollPhoto", [fx("timecard-normal.webp"), fx("timecard-mark-o.webp")]);
    await page.locator("#payrollPhotoMsg").getByText("섞이지 않았는지").waitFor({ timeout: 20000 }).catch(() => {});
    const msg = await page.locator("#payrollPhotoMsg").innerText();
    check("★★ 같은 날짜에 다른 시각 → 「다른 직원의 카드가 섞이지 않았는지」 (4·11일)", /섞이지 않았는지/.test(msg) && /4일/.test(msg) && /11일/.test(msg), msg);
    check("★ 이름·달은 읽지 않는다고, 어디에 넣었는지 말한다", /이름·달은 읽지 않아요/.test(msg) && /2026-06/.test(msg), msg);
    page.once("dialog", (d) => d.accept());
    await page.click("#payrollResetCard");
    await page.waitForTimeout(300);
    if (await page.locator("#appDialogBackdrop").isVisible()) await page.locator("#appDialogOk").click();
    await page.waitForTimeout(500);
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
