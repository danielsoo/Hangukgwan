// 급여 「한눈에 보기」 — 이 달 직원 전체를 결산처럼(큰 숫자 · 직원별 막대 · 6개월 그래프 · 표).
//
// 2026-10-03 사장님: "지금 보이는 직원들이랑 결산처럼 그래프, 한 번에 볼 수 있게 되었으면 좋겠는데"
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};
process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-payroll-overview";
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
  const api = page.request;
  await api.post(`${base}/api/auth/login`, { data: { password: "ownerpass123" } });
  // 직원 셋: A 시급 200, B 시급 비움(가게 기본 220), C 카드 없음.
  const mk = async (name, hourly) => (await (await api.post(`${base}/api/payroll/staff`, { data: { name, pay_type: "hourly", hourly_rate: hourly } })).json()).staff.id;
  const a = await mk("가나다", 200);
  const b = await mk("라마바", "");
  await mk("사아자", 150);
  const d = await mk("차카타", 150);
  const full = { am_in: "09:00", am_out: "14:00", pm_in: "16:30", pm_out: "21:00" };
  // A 9월: 하루 다(9.5h) + 오전만(5h) = 14.5h × 200 = 2,900
  await api.put(`${base}/api/payroll/card`, { data: { staff_id: a, month: "2026-09", days: { 1: full, 2: { am_in: "09:00", am_out: "14:00" } } } });
  // B 9월: 09:40 출근(지각 0.5h) 하루 — 9.5h × 220 − 0.5h × 220 = 1,980, 보너스 500 → 2,480
  await api.put(`${base}/api/payroll/card`, { data: { staff_id: b, month: "2026-09", days: { 3: { ...full, am_in: "09:40" } }, bonus: 500 } });
  // D 9월: 10:05 출근(지각 65분 → 1h) · 13:30 퇴근(조퇴 30분) — 5h × 150 − 1.5h × 150 = 525
  await api.put(`${base}/api/payroll/card`, { data: { staff_id: d, month: "2026-09", days: { 4: { am_in: "10:05", am_out: "13:30" } } } });
  // A 8월: 하루 9.5h × 200 = 1,900
  await api.put(`${base}/api/payroll/card`, { data: { staff_id: a, month: "2026-08", days: { 5: full } } });

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.locator('.admin-tabs button[data-tab="payroll"]').click();
  await page.waitForTimeout(500);
  await page.fill("#payrollMonth", "2026-09");
  await page.dispatchEvent("#payrollMonth", "change");
  await page.waitForTimeout(1500);

  if (process.env.SHOT) await page.locator("#payrollOverview").screenshot({ path: process.env.SHOT });
  out.push("[큰 숫자]");
  check("★★ 「2026년 9월 인건비」 NT$5,905 (2,900 + 2,480 + 525) — 카드 넣은 직원만", (await page.locator("#prOvLabel").innerText()).includes("2026년 9월 인건비") && (await page.locator("#prOvTotal").innerText()) === "NT$5,905", await page.locator("#prOvTotal").innerText());
  const stats = await page.locator("#prOvStats").innerText();
  check("★ 근무 29시간 · 지각·조퇴 차감 −NT$335 · 보너스 NT$500", /근무 시간\s*29시간/.test(stats) && /지각·조퇴 차감\s*−NT\$335/.test(stats) && /보너스\s*NT\$500/.test(stats), stats);
  check("카드 넣은 직원 3명", /3명/.test(await page.locator("#prOvSub").innerText()), "");

  out.push("\n[직원별 막대]");
  const names = await page.$$eval("#prOvBars .stl-bar-row .stl-bar-name", (els) => els.map((e) => e.firstChild.textContent.trim()));
  check("★★ 많이 받는 순 — 가나다 · 라마바 · 차카타, 카드 없는 사아자는 맨 아래", names.join() === "가나다,라마바,차카타,사아자", names.join());
  const bars = await page.locator("#prOvBars").innerText();
  check("★ 금액·비율 — NT$2,900 49% · NT$2,480 42% · NT$525 9% · 「카드 없음」", /NT\$2,900\s*49%/.test(bars) && /NT\$2,480\s*42%/.test(bars) && /NT\$525\s*9%/.test(bars) && /카드 없음/.test(bars), bars);
  const w = await page.$$eval("#prOvBars .stl-bar-fill", (els) => els.map((e) => parseFloat(e.style.width)));
  check("막대 길이 — 제일 많은 사람 100%, 다음은 그 비율", w.length === 3 && w[0] === 100 && Math.abs(w[1] - (2480 / 2900) * 100) < 0.1, JSON.stringify(w));

  out.push("\n[근무 시간 기여도 — 누가 많이 일했나]");
  // 2026-10-03 사장님: "직원별 시간 기여도도 있으면 좋겠고 그래야 누가 열심히 일한지도 볼 수 있으니까"
  // 일한 시간 = 근무 + 초과 − 지각·조퇴: 가나다 14.5 · 라마바 9.5 − 0.5 = 9 · 차카타 5 − 1 − 0.5 = 3.5 → 합 27
  const hb = await page.locator("#prOvHoursBars").innerText();
  const hNames = await page.$$eval("#prOvHoursBars .stl-bar-name", (els) => els.map((e) => e.firstChild.textContent.trim()));
  check("★★ 많이 일한 순 — 가나다 14.5시간 54% · 라마바 9시간 33% · 차카타 3.5시간 13%", hNames.join() === "가나다,라마바,차카타" && /14\.5시간\s*54%/.test(hb) && /9시간\s*33%/.test(hb) && /3\.5시간\s*13%/.test(hb), hb);
  check("★ 카드 없는 직원은 시간 기여도에 안 나온다", !/사아자/.test(hb), hb);

  out.push("\n[지각·조퇴 — 누가 많이]");
  // 2026-10-03 사장님: "지각이나 그런 것도 누가 제일 많이 했고 볼 수 있으면 좋을 것 같고"
  const lb = await page.locator("#prOvLateBars").innerText();
  const lNames = await page.$$eval("#prOvLateBars .stl-bar-name", (els) => els.map((e) => e.firstChild.textContent.trim()));
  check("★★ 많은 순 — 차카타(지각 1 · 조퇴 1 = 2번, 95분) · 라마바(지각 1, 40분)", lNames.join() === "차카타,라마바" && /지각 1 · 조퇴 1[\s\S]*2번\s*95분/.test(lb) && /1번\s*40분/.test(lb), lb);
  check("★ 한 번도 없는 가나다는 안 적는다", !/가나다/.test(lb), lb);
  const tip = await page.locator('#prOvLateBars [data-payroll-ov="' + d + '"]').getAttribute("title");
  check("손을 대면 「지각 1번(65분) · 조퇴 1번(30분) · 차감 NT$225」", /지각 1번\(65분\)/.test(tip) && /조퇴 1번\(30분\)/.test(tip) && /NT\$225/.test(tip), tip);

  out.push("\n[표]");
  const rowA = await page.locator('#prOvTable tbody tr[data-payroll-ov="' + a + '"]').innerText();
  check("★★ 가나다 — 출근 1.5일 · 14.5h · NT$2,900 · ✓", /1\.5/.test(rowA) && /14\.5/.test(rowA) && /NT\$2,900/.test(rowA), rowA);
  const rowB = await page.locator('#prOvTable tbody tr[data-payroll-ov="' + b + '"]').innerText();
  check("★ 라마바 — 지각 1번 · 보너스 NT$500 · 차감 −NT$110", /1번/.test(rowB) && /NT\$500/.test(rowB) && /−NT\$110/.test(rowB) && /NT\$2,480/.test(rowB), rowB);
  const foot = await page.locator("#prOvTable tfoot").innerText();
  check("★ 합계 줄 — 3명 · 29h · NT$5,905", /3명/.test(foot) && /29/.test(foot) && /NT\$5,905/.test(foot), foot);

  out.push("\n[최근 6개월 그래프]");
  const chart = await page.evaluate(() => {
    const c = window.Chart && window.Chart.getChart && window.Chart.getChart(document.querySelector("#payrollTrendChart"));
    return c ? { labels: c.data.labels, data: c.data.datasets[0].data } : null;
  });
  check("★★ 4월 ~ 9월, 8월 1,900 · 9월 5,905", chart && chart.labels.length === 6 && chart.labels[5] === "2026년 9월" && chart.labels[0] === "2026년 4월" && chart.data[4] === 1900 && chart.data[5] === 5905, JSON.stringify(chart));

  out.push("\n[누르면 그 직원 카드]");
  await page.locator('#prOvBars [data-payroll-ov="' + b + '"]').click();
  await page.waitForTimeout(900);
  check("★★ 막대를 누르면 라마바 카드가 열린다", (await page.inputValue("#payrollStaffName")) === "라마바" && !(await page.locator("#payrollEditor").evaluate((el) => el.hidden)), "");
  await page.locator('#prOvTable tbody tr[data-payroll-ov="' + a + '"]').click();
  await page.waitForTimeout(900);
  check("★ 표의 줄을 누르면 가나다 카드", (await page.inputValue("#payrollStaffName")) === "가나다", "");

  out.push("\n[달을 바꾸면 따라온다]");
  await page.click("#payrollPrevMonth");
  await page.waitForTimeout(1500);
  check("★ 8월 — NT$1,900, 1명, 지각·조퇴 없음", (await page.locator("#prOvTotal").innerText()) === "NT$1,900" && /1명/.test(await page.locator("#prOvSub").innerText()) && /지각·조퇴가 없어요/.test(await page.locator("#prOvLateBars").innerText()), await page.locator("#prOvTotal").innerText());

  out.push("\n[두 기기에서 같은 카드 — 먼저 저장한 것을 조용히 덮지 않는다]");
  {
    // 2026-10-03 사장님: "그거 확인하고 알려주게 만들어줘"
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const pad = await ctx2.newPage();
    await pad.goto(`${base}/admin`, { waitUntil: "networkidle" });
    await pad.request.post(`${base}/api/auth/login`, { data: { password: "ownerpass123" } });
    const openA = async (pg) => {
      await pg.reload({ waitUntil: "networkidle" });
      await pg.waitForTimeout(700);
      await pg.locator('.admin-tabs button[data-tab="payroll"]').click();
      await pg.waitForTimeout(400);
      await pg.fill("#payrollMonth", "2026-09");
      await pg.dispatchEvent("#payrollMonth", "change");
      await pg.waitForTimeout(1200);
      await pg.locator(`#payrollStaffChips [data-payroll-staff="${a}"]`).click();
      await pg.waitForTimeout(900);
    };
    const put = async (pg, day, v) => {
      const inp = pg.locator(`#payrollGrid tr[data-day="${day}"] input[data-slot="am_in"]`);
      await inp.fill(v);
      await inp.press("Tab");
      await pg.waitForTimeout(400);
    };
    await openA(page); // PC
    await openA(pad); // 패드 — 둘 다 같은 rev 로 연다
    await put(page, 10, "0900");
    await page.click("#payrollSaveCard");
    await page.waitForTimeout(900);
    check("PC 가 먼저 저장", /저장했어요/.test(await page.locator("#payrollStatus").innerText()), "");
    await put(pad, 11, "0900");
    await pad.click("#payrollSaveCard");
    await pad.waitForTimeout(900);
    const msg = await pad.locator("#appDialogMessage").innerText();
    check("★★ 패드가 저장하면 「다른 기기에서 … 먼저 저장했어요」라고 묻는다", (await pad.locator("#appDialogBackdrop").isVisible()) && /다른 기기에서 .*「가나다 · 2026년 9월」 카드를 먼저 저장했어요/.test(msg), msg);
    check("★ 세 갈래 — 그쪽 것 불러오기 / 내 것으로 덮어쓰기 / 취소", (await pad.locator("#appDialogOk").innerText()) === "그쪽 것 불러오기" && (await pad.locator("#appDialogAlt").innerText()) === "내 것으로 덮어쓰기", "");
    let srv = (await (await page.request.get(`${base}/api/payroll/card?staff=${a}&month=2026-09`)).json()).card.days;
    check("★★ 묻는 동안 서버에는 PC 것(10일)이 그대로 — 패드의 11일이 덮지 않았다", srv["10"] && !srv["11"], JSON.stringify(Object.keys(srv)));
    await pad.click("#appDialogOk");
    await pad.waitForTimeout(1200);
    check("★ 「그쪽 것 불러오기」 → 패드 화면에 PC 가 넣은 10일, 패드의 11일은 사라짐", (await pad.inputValue('#payrollGrid tr[data-day="10"] input[data-slot="am_in"]')) === "09:00" && (await pad.inputValue('#payrollGrid tr[data-day="11"] input[data-slot="am_in"]')) === "" && /불러왔어요/.test(await pad.locator("#payrollStatus").innerText()), "");
    // 이제 PC 가 옛 화면 — 덮어쓰기를 고른다
    await put(pad, 12, "0900");
    await pad.click("#payrollSaveCard");
    await pad.waitForTimeout(900);
    check("불러온 뒤 저장은 그냥 된다", /저장했어요/.test(await pad.locator("#payrollStatus").innerText()) && !(await pad.locator("#appDialogBackdrop").isVisible()), "");
    await put(page, 13, "0900");
    await page.click("#payrollSaveCard");
    await page.waitForTimeout(900);
    check("PC 도 이번엔 옛 화면이라 묻는다", await page.locator("#appDialogBackdrop").isVisible(), "");
    await page.click("#appDialogAlt");
    await page.waitForTimeout(1200);
    srv = (await (await page.request.get(`${base}/api/payroll/card?staff=${a}&month=2026-09`)).json()).card.days;
    check("★ 「내 것으로 덮어쓰기」 → PC 화면 것(13일)이 저장되고 패드의 12일은 빠진다", srv["13"] && !srv["12"] && /저장했어요/.test(await page.locator("#payrollStatus").innerText()), JSON.stringify(Object.keys(srv)));
    await put(page, 14, "0900");
    await pad.locator('#payrollGrid tr[data-day="15"] input[data-slot="am_in"]').fill("0900");
    await page.click("#payrollSaveCard");
    await page.waitForTimeout(900);
    check("덮어쓴 뒤 PC 는 다시 그냥 저장된다", !(await page.locator("#appDialogBackdrop").isVisible()) && /저장했어요/.test(await page.locator("#payrollStatus").innerText()), "");
    await ctx2.close();
  }

  out.push("\n[휴대폰 폭]");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  check("가로로 넘치지 않는다(표는 그 안에서만 밀린다)", sw <= 392, String(sw));

  await browser.close();
  server.close();
  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
