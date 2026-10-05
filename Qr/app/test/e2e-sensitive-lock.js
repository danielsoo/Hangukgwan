// 급여·결산 탭 — 들어갈 때마다 로그인과 다른 비밀번호(src/sensitiveLock.js).
//
// 2026-10-04 사장님: "사장 탭에 급여와 결산이 직원들이나 다른 사람한테 엑세스가 될까봐 걱정이 된대
// 그래서 그 탭 들어갈 때마다 비밀번호 치게 해줘. 비밀번호 설정에서 한 번 저장하게 해줘. 로그인
// 비번이랑 결산 급여 비번은 다르게"
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};
process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-sensitive-lock";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.STAFF_PASSWORD = "staffpass123";

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
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.request.post(`${base}/api/auth/login`, { data: { password: "ownerpass123" } });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const tab = (t) => page.locator(`.admin-tabs button[data-tab="${t}"]`);
  const gate = () => page.locator("#pinGateBackdrop").isVisible();
  const st = async (u, opts) => (await page.request.fetch(`${base}${u}`, opts)).status();

  out.push("[정하기 전 — 예전처럼 열린다]");
  await tab("settlement").click();
  await page.waitForTimeout(800);
  check("비밀번호를 정하기 전엔 결산이 그냥 열린다", !(await gate()) && !(await page.locator("#tab-settlement").evaluate((el) => el.hidden)), "");
  await tab("orders").click();
  await page.waitForTimeout(300);

  out.push("\n[설정 > 계정에서 한 번 정한다]");
  await tab("settings").click();
  await page.waitForTimeout(400);
  await page.locator('.settings-nav-btn[data-category="account"]').click();
  await page.waitForTimeout(400);
  check("「🔒 급여·결산 비밀번호」 칸 — 아직 정하지 않았다고", (await page.locator("#saveSensitivePinBtn").isVisible()) && /아직 정하지 않았어요/.test(await page.locator("#sensitivePinStatus").innerText()), "");
  const setPin = async (ownerPw, pin, confirm = pin) => {
    await page.fill("#sensitive_owner_pw", ownerPw);
    await page.fill("#sensitive_pin_new", pin);
    await page.fill("#sensitive_pin_confirm", confirm);
    await page.click("#saveSensitivePinBtn");
    await page.waitForTimeout(700);
    return page.locator("#sensitivePinMsg").innerText();
  };
  check("두 칸이 다르면 안 받는다", /두 칸이 달라요/.test(await setPin("ownerpass123", "1357", "1358")), "");
  check("사장 로그인 비밀번호가 틀리면 안 받는다", /사장 로그인 비밀번호가 달라요/.test(await setPin("nope", "1357")), "");
  check("★★ 로그인 비밀번호(사장)와 같으면 안 받는다", /로그인 비밀번호.*같아요/.test(await setPin("ownerpass123", "ownerpass123")), "");
  check("★★ 직원 로그인 비밀번호와 같아도 안 받는다", /로그인 비밀번호.*같아요/.test(await setPin("ownerpass123", "staffpass123")), "");
  check("★ 저장", /저장했어요/.test(await setPin("ownerpass123", "1357")) && /정해져 있어요/.test(await page.locator("#sensitivePinStatus").innerText()), "");

  out.push("\n[결산 — 들어갈 때마다 묻는다]");
  await tab("orders").click();
  await page.waitForTimeout(300);
  await tab("settlement").click();
  await page.waitForTimeout(400);
  check("★★ 결산을 누르면 비밀번호 창", (await gate()) && /결산.*비밀번호/.test(await page.locator("#pinGateTitle").innerText()), await page.locator("#pinGateTitle").innerText());
  await page.click("#pinGateCancel");
  await page.waitForTimeout(300);
  check("★ 취소하면 결산이 안 열리고 있던 탭 그대로", (await page.locator("#tab-settlement").evaluate((el) => el.hidden)) && !(await page.locator("#tab-orders").evaluate((el) => el.hidden)), "");
  await tab("settlement").click();
  await page.waitForTimeout(300);
  await page.fill("#pinGateInput", "0000");
  await page.click("#pinGateOk");
  await page.waitForTimeout(600);
  check("★ 틀리면 창에서 바로 — 몇 번 남았는지", (await gate()) && /비밀번호가 달라요.*4번/.test(await page.locator("#pinGateError").innerText()), await page.locator("#pinGateError").innerText());
  check("★★ 로그인 비밀번호로는 안 열린다", await (async () => { await page.fill("#pinGateInput", "ownerpass123"); await page.click("#pinGateOk"); await page.waitForTimeout(600); return gate(); })(), "");
  await page.fill("#pinGateInput", "1357");
  await page.press("#pinGateInput", "Enter");
  await page.waitForTimeout(1200);
  check("★★ 맞으면 결산이 열린다", !(await gate()) && !(await page.locator("#tab-settlement").evaluate((el) => el.hidden)), "");
  check("열린 동안 서버도 결산을 준다", (await st("/api/settlements")) === 200, "");
  await tab("orders").click();
  await page.waitForTimeout(600);
  check("★★ 떠나면 서버에서도 다시 잠긴다(423)", (await st("/api/settlements")) === 423, String(await st("/api/settlements")));
  await tab("settlement").click();
  await page.waitForTimeout(400);
  check("★★ 다시 들어가면 또 묻는다", await gate(), "");
  await page.click("#pinGateCancel");

  out.push("\n[급여도]");
  check("★ 잠긴 급여는 서버가 안 준다(423) — 주소로 불러도", (await st("/api/payroll/staff")) === 423, "");
  await tab("payroll").click();
  await page.waitForTimeout(400);
  check("★★ 급여를 누르면 비밀번호 창", (await gate()) && /급여/.test(await page.locator("#pinGateTitle").innerText()), "");
  await page.fill("#pinGateInput", "1357");
  await page.click("#pinGateOk");
  await page.waitForTimeout(1200);
  check("★ 맞으면 급여가 열린다", !(await page.locator("#tab-payroll").evaluate((el) => el.hidden)) && (await st("/api/payroll/staff")) === 200, "");
  check("급여를 풀어도 결산은 따로 잠겨 있다", (await st("/api/settlements")) === 423, "");
  // 탭에 둔 채 서버가 다시 잠갔다(15분 지남) — 다음 요청이 423 이면 화면이 탭을 닫고 이유를 말한다.
  await page.request.post(`${base}/api/auth/sensitive-lock`, { data: { area: "payroll" } });
  await page.click("#payrollNextMonth");
  await page.waitForTimeout(1200);
  check("★★ 열린 채 잠기면 급여 탭을 닫고 「다시 잠겼어요」라고 말한다", (await page.locator("#tab-payroll").evaluate((el) => el.hidden)) && /다시 잠겼어요/.test(await page.locator("#appDialogMessage").innerText()), await page.locator("#appDialogMessage").innerText());
  await page.click("#appDialogOk").catch(() => {});
  await page.goto(`${base}/admin#settlement`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  check("★ 주소(#settlement)로 열어도 묻는다", await gate(), "");
  await page.click("#pinGateCancel");

  out.push("\n[실시간 주문의 「오전/오후 정산」은 그대로]");
  const sc = await st("/api/settlements/shift-close", { method: "POST", data: { shift: "am" } });
  check("★★ 잠겨 있어도 오전·오후 정산 버튼 길은 막히지 않는다(423 아님)", sc !== 423, String(sc));

  out.push("\n[로그인 비밀번호를 급여·결산 비밀번호로 바꾸지 못한다]");
  const cp = await page.request.post(`${base}/api/auth/change-password`, { data: { currentPassword: "ownerpass123", newPassword: "1357abc" } });
  check("다른 것은 바뀐다(되돌림 시험 준비)", cp.status() === 200, String(cp.status()));
  await page.request.post(`${base}/api/auth/change-password`, { data: { currentPassword: "1357abc", newPassword: "ownerpass123" } });
  await page.request.put(`${base}/api/auth/sensitive-pin`, { data: { ownerPassword: "ownerpass123", pin: "135799" } });
  const same = await page.request.post(`${base}/api/auth/change-password`, { data: { currentPassword: "ownerpass123", newPassword: "135799" } });
  check("★★ 사장 로그인 비밀번호를 급여·결산 것과 같게 바꾸면 안 받는다", same.status() === 400 && (await same.json()).error === "same_as_pin", String(same.status()));
  const sameStaff = await page.request.post(`${base}/api/auth/set-staff-password`, { data: { newPassword: "135799" } });
  check("★ 직원 비밀번호도", sameStaff.status() === 400, String(sameStaff.status()));

  out.push("\n[직원]");
  {
    const c2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const p2 = await c2.newPage();
    await p2.goto(`${base}/admin`, { waitUntil: "networkidle" });
    await p2.request.post(`${base}/api/auth/login`, { data: { password: "staffpass123" } });
    await p2.reload({ waitUntil: "networkidle" });
    await p2.waitForTimeout(900);
    // 2026-10-05 사장님: "직원용 결산 페이지는 비번 없이 해줘 어짜피 하루 밖에안나와서"
    check("★★ 직원 결산(오늘)은 비밀번호 없이 열린다(200)", (await p2.request.get(`${base}/api/settlements`)).status() === 200, "");
    check("★ 직원은 여전히 오늘만 — 다른 날은 403", (await p2.request.get(`${base}/api/settlements?start=2026-01-01&end=2026-01-01`)).status() === 403, "");
    check("★ 직원 세션도 급여는 못 본다", (await p2.request.get(`${base}/api/payroll/staff`)).status() !== 200, "");
    await p2.locator('.admin-tabs button[data-tab="settlement"]').click();
    await p2.waitForTimeout(600);
    check("★★ 직원이 결산을 누르면 비밀번호 창 없이 바로", !(await p2.locator("#pinGateBackdrop").isVisible()) && !(await p2.locator("#tab-settlement").evaluate((el) => el.hidden)), "");
    // 다섯 번 틀리면 5분 — 비밀번호 길 자체는 그대로
    for (let i = 0; i < 5; i++) await p2.request.post(`${base}/api/auth/sensitive-unlock`, { data: { area: "settlement", pin: "x" + i } });
    const r = await p2.request.post(`${base}/api/auth/sensitive-unlock`, { data: { area: "settlement", pin: "135799" } });
    check("★ 다섯 번 틀리면 맞는 비밀번호도 안 받는다(429)", r.status() === 429, String(r.status()));
    await c2.close();
  }

  await browser.close();
  server.close();
  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
