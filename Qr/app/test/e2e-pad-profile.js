// 패드 프로필 — 로그인하면 「이 기기는 어디인가요?」, 고르면 그 프로필의
// 프린터와 자동 인쇄가 이 패드에 적용된다. 터치 수는 프로필마다 센다.
//
// 사장님(2026-09-29): "패드 프로필을 만들어줘. 여러명이 한 프로필 들어가도
// 되니까. 그냥 해당 프로필의 ip 와 프린터기 그것 때문에 있으면 좋겠다고 느낀
// 거야 / 그리고 얼마나 많은 터치 이벤트가 있는지도 프로필 별로 알 수도 있을 것
// 같고."
//
// 패드의 한국관 POS 앱(window.HangukgwanPrint)을 흉내 낸다 — e2e-printer-pick.js 와 같은 방법.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-pad-profile";
process.env.ADMIN_PASSWORD = "ownerpass123";

const { launchBrowser } = require("./browser");
const request = require("supertest");
const app = require("../server");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const KITCHEN = { name: "주방 프린터", ip: "192.168.111.142", port: 9100 };
const COUNTER = { name: "카운터 프린터", ip: "192.168.111.150", port: 9100 };

(async () => {
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  await request(app).get("/api/menu");

  const boss = request.agent(app);
  await boss.post("/api/auth/login").send({ password: "ownerpass123" });
  let r = await boss.put("/api/settings/printers").send({ printers: [KITCHEN, COUNTER] });
  const [kp, cp] = r.body.printers;
  r = await boss.put("/api/settings/pad-profiles").send({
    profiles: [
      { name: "주방", printerId: kp.id, autoPrint: true },
      { name: "카운터", printerId: cp.id, autoPrint: true },
    ],
  });
  const [kitchen, counter] = r.body.profiles;

  const browser = await launchBrowser();
  async function pad({ target = "192.168.111.150:9100", app: isApp = true, viewport = { width: 1280, height: 800 }, androidId = null } = {}) {
    const ctx = await browser.newContext({ viewport });
    if (isApp) {
      await ctx.addInitScript(({ target, androidId }) => {
        window.__set = [];
        window.__target = sessionStorage.getItem("__fakeTarget") || target;
        window.HangukgwanPrint = {
          // 찍을 때 앱이 어느 주소로 보냈는지 남긴다.
          printBase64() { (window.__jobs = window.__jobs || []).push(window.__target); return "queued"; },
          target() { return window.__target; },
          available() { return true; },
          setPrinter(ip, port) {
            window.__set.push([ip, port]);
            window.__target = `${ip}:${port}`;
            sessionStorage.setItem("__fakeTarget", window.__target);
            return "ok";
          },
        };
        // 앱 1.6 — 다시 깔아도 같은 기기 번호(ANDROID_ID)와 모델 이름.
        if (androidId) {
          window.HangukgwanPrint.deviceId = () => androidId;
          window.HangukgwanPrint.deviceModel = () => "LENOVO TB-X606F";
        }
      }, { target, androidId });
    }
    const page = await ctx.newPage();
    page.on("dialog", (d) => d.dismiss());
    await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
    await page.evaluate(async () => {
      await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "ownerpass123" }) });
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    return { ctx, page };
  }
  const printDevices = async () => (await boss.get("/api/settings/print-device")).body.devices || [];

  out.push("[주방 패드 — 처음 로그인하면 묻는다]");
  const A = await pad({ target: "192.168.111.150:9100" });
  check("★ 「이 기기는 어디인가요?」가 뜬다", await A.page.locator("#padProfileBackdrop").isVisible(), "");
  check("처음 묻는 창에는 「취소」가 없다 — 골라야 한다", !(await A.page.locator("#padProfileCancel").isVisible()), "");
  const choices = await A.page.locator("#padProfileChoices button").allTextContents();
  check("프로필 두 개가 보인다", choices.length === 2 && /주방/.test(choices[0]) && /카운터/.test(choices[1]), JSON.stringify(choices));
  check("어느 프린터인지도 적혀 있다", /주방 프린터/.test(choices[0]), choices[0]);
  await A.page.locator("#padProfileChoices button", { hasText: "주방" }).first().click();
  await A.page.waitForTimeout(800);
  check("창이 닫힌다", !(await A.page.locator("#padProfileBackdrop").isVisible()), "");
  const set = await A.page.evaluate(() => window.__set);
  check("★★ 앱에 주방 프린터가 저장된다", JSON.stringify(set) === JSON.stringify([[KITCHEN.ip, KITCHEN.port]]), JSON.stringify(set));
  check("★ 자동 인쇄가 켜진다", await A.page.locator("#autoPrintToggle").isChecked(), "");
  let devs = await printDevices();
  check("★ 「자동 인쇄 중」 목록에 「주방」으로 들어간다", devs.some((d) => d.name === "주방"), JSON.stringify(devs));
  check("★ 위에 「📍 주방」이 보인다", (await A.page.locator("#padProfileBadge").textContent()) === "🔒📍 주방", await A.page.locator("#padProfileBadge").textContent());
  check("프린터 고르기 칸도 주방 프린터", (await A.page.locator("#printerPick option:checked").textContent()) === KITCHEN.name, "");

  await A.page.reload({ waitUntil: "networkidle" });
  await A.page.waitForTimeout(1500);
  check("★ 새로고침하면 다시 묻지 않는다(기기에 남는다)", !(await A.page.locator("#padProfileBackdrop").isVisible()), "");
  check("「📍 주방」 그대로", (await A.page.locator("#padProfileBadge").textContent()) === "🔒📍 주방", "");

  out.push("\n[📍 는 잠겨 있다 — 잘못 스쳐도 안 바뀐다]");
  // 2026-09-29 사장님: "잠금은 잘못 터치할 때를 방지해서 잠금으로 해주고 직원들이 직접 풀고 수정할 수 있게 해줘"
  await A.page.locator("#padProfileBadge").click();
  await A.page.waitForTimeout(300);
  check("★ 누르면 먼저 「잠겨 있어요 — 풀고 바꿀까요?」", await A.page.locator("#appDialogBackdrop").isVisible() && /잠겨 있어요/.test(await A.page.locator("#appDialogMessage").textContent()), await A.page.locator("#appDialogMessage").textContent());
  check("★ 아직 고르는 창은 안 뜬다", !(await A.page.locator("#padProfileBackdrop").isVisible()), "");
  await A.page.locator("#appDialogCancel").click();
  await A.page.waitForTimeout(300);
  check("★★ 「취소」면 아무것도 안 바뀐다", !(await A.page.locator("#padProfileBackdrop").isVisible()) && (await A.page.locator("#padProfileBadge").textContent()) === "🔒📍 주방", "");
  // 풀었지만 마음이 바뀌었다 — 고르는 창에서 「취소」.
  await A.page.locator("#padProfileBadge").click();
  await A.page.locator("#appDialogOk").click();
  await A.page.waitForTimeout(300);
  check("풀면 고르는 창이 뜬다", await A.page.locator("#padProfileBackdrop").isVisible(), "");
  check("★ 고르는 창에 「취소」가 있다", await A.page.locator("#padProfileCancel").isVisible(), "");
  const nBefore = await A.page.evaluate(() => window.__set.length);
  await A.page.locator("#padProfileCancel").click();
  await A.page.waitForTimeout(300);
  check("★ 취소하면 그대로(프린터도 안 건드린다)", (await A.page.locator("#padProfileBadge").textContent()) === "🔒📍 주방" && (await A.page.evaluate(() => window.__set.length)) === nBefore, "");

  out.push("\n[풀고 카운터로 바꾼다 — 홀 프린터 고장]");
  await A.page.locator("#padProfileBadge").click();
  await A.page.locator("#appDialogOk").click();
  await A.page.waitForTimeout(300);
  check("창이 다시 뜬다", await A.page.locator("#padProfileBackdrop").isVisible(), "");
  check("지금 프로필이 표시된다", /주방/.test(await A.page.locator("#padProfileChoices button.is-current").textContent()), "");
  await A.page.locator("#padProfileChoices button", { hasText: "카운터" }).first().click();
  await A.page.waitForTimeout(800);
  const set2 = await A.page.evaluate(() => window.__set);
  check("★★ 앱이 카운터 프린터로 바뀐다", JSON.stringify(set2[set2.length - 1]) === JSON.stringify([COUNTER.ip, COUNTER.port]), JSON.stringify(set2));
  check("「📍 카운터」", (await A.page.locator("#padProfileBadge").textContent()) === "🔒📍 카운터", "");
  devs = await printDevices();
  const mine = devs.filter((d) => d.name === "카운터" || d.name === "주방");
  check("★ 같은 기기가 두 번 들어가지 않고 이름만 바뀐다", mine.length === 1 && mine[0].name === "카운터", JSON.stringify(devs));

  out.push("\n[두 번째 패드도 「카운터」 — 여러 패드가 한 프로필]");
  const B = await pad({ target: "192.168.111.142:9100" });
  await B.page.locator("#padProfileChoices button", { hasText: "카운터" }).first().click();
  await B.page.waitForTimeout(800);
  devs = await printDevices();
  check("★ 두 패드 모두 자동 인쇄 목록에 있다", devs.filter((d) => d.name === "카운터").length === 2, JSON.stringify(devs));

  out.push("\n[터치 수 — 프로필마다 센다]");
  for (let i = 0; i < 7; i++) await B.page.mouse.click(400, 500);
  for (let i = 0; i < 3; i++) await A.page.mouse.click(400, 500);
  // 설정 탭에 들어가면 모아 둔 것을 먼저 보내고 표를 새로 그린다.
  await B.page.locator('.admin-tabs button[data-tab="settings"]').click();
  await B.page.waitForTimeout(800);
  await A.page.locator('.admin-tabs button[data-tab="settings"]').click();
  await A.page.waitForTimeout(800);
  await A.page.locator('.admin-tabs button[data-tab="orders"]').click();
  await A.page.locator('.admin-tabs button[data-tab="settings"]').click();
  await A.page.waitForTimeout(800);
  r = await boss.get("/api/settings/pad-touches");
  const cRow = (r.body.rows || []).find((x) => x.profile === counter.id) || {};
  // B: 뽑기 1 + 7 + 탭 1 = 9 안팎, A: 3 + 탭 … — 정확한 수보다 「프로필로 모였다」를 본다.
  check("★★ 두 패드의 터치가 「카운터」 한 줄에 모인다", cRow.today >= 10, JSON.stringify(r.body.rows));
  check("「주방」으로 있을 때 누른 것은 주방 몫", ((r.body.rows || []).find((x) => x.profile === kitchen.id) || { today: 0 }).today >= 1, JSON.stringify(r.body.rows));
  const tableText = await A.page.locator("#padTouchTable").textContent();
  check("★ 설정 화면 표에 프로필 이름과 수가 보인다", /카운터/.test(tableText) && /오늘/.test(tableText) && /최근 7일/.test(tableText), tableText);

  out.push("\n[패드를 알아보는가 — 설정 화면에 「이 프로필을 쓰는 기기」]");
  // 2026-09-29 사장님: "저 프로필이랑 패드랑 인식을 하는거야? 인식을 못하면 저걸 하는 의미가 없잖아."
  out.push("\n[프로필이 프린터의 주인이다 — 앱 설정에 남은 옛 IP 로 안 찍는다]");
  // 2026-09-30 사장님(앱 1.6 을 깐 뒤): "설치 할 때 입력한 IP 192.168.111.142 프린터
  // 정보를 그대로 사용하는 듯 / 설정값에서 프린터 IP 주소를 공백으로 처리하면
  // POS 2대 모두 프린터를 찾지 못함." — 예전에는 프로필을 고를 때 한 번만 앱에 넣었다.
  await B.page.locator('.admin-tabs button[data-tab="orders"]').click();
  await B.page.waitForTimeout(3000); // 「설정했어요」가 잠깐 떴다 사라진 뒤
  check("★ 프로필이 프린터를 정한 패드에서는 「이 기기 프린터」 칸이 잠긴다", await B.page.locator("#printerPick").isDisabled(), "");
  check("★ 왜 잠겼는지 글로 보인다(패드에는 마우스 올리기가 없다)", /프로필/.test(await B.page.locator("#printerPickMsg").textContent()) && await B.page.locator("#printerPickMsg").isVisible(), await B.page.locator("#printerPickMsg").textContent());
  // 앱 설정 화면에서 누가 설치 때 IP(.142, 주방)로 되돌려 놓았다.
  await B.page.evaluate((t) => { window.__target = t; sessionStorage.setItem("__fakeTarget", t); window.__set = []; }, `${KITCHEN.ip}:${KITCHEN.port}`);
  await B.page.locator("#printerPickTest").click();
  await B.page.waitForTimeout(500);
  let bs = await B.page.evaluate(() => [window.__set, window.__target]);
  check("★★ 찍기 직전에 프로필 프린터(카운터)로 맞춘다 — 옛 IP 로 안 나간다", bs[1] === `${COUNTER.ip}:${COUNTER.port}` && JSON.stringify(bs[0]) === JSON.stringify([[COUNTER.ip, COUNTER.port]]), JSON.stringify(bs));
  // 앱 설정의 IP 를 비웠다.
  await B.page.evaluate(() => { window.__target = ":9100"; sessionStorage.setItem("__fakeTarget", ":9100"); window.__set = []; });
  await B.page.locator("#printerPickTest").click();
  await B.page.waitForTimeout(500);
  bs = await B.page.evaluate(() => [window.__set, window.__target, (window.__jobs || []).slice(-1)[0]]);
  check("★★ 앱 IP 를 비워도 프로필 프린터로 찍힌다", bs[1] === `${COUNTER.ip}:${COUNTER.port}` && bs[2] === `${COUNTER.ip}:${COUNTER.port}`, JSON.stringify(bs));
  // 화면을 새로 열 때도 맞춘다(찍기 전에 설정 화면의 ✓ 가 맞게).
  await B.page.evaluate((t) => sessionStorage.setItem("__fakeTarget", t), `${KITCHEN.ip}:${KITCHEN.port}`);
  await B.page.reload({ waitUntil: "networkidle" });
  await B.page.waitForTimeout(1500);
  check("★ 다시 열면 바로 맞춘다", (await B.page.evaluate(() => window.__target)) === `${COUNTER.ip}:${COUNTER.port}`, await B.page.evaluate(() => window.__target));

  // 옛 앱(1.4)이라 프린터를 못 바꾸는 패드 — 설정 화면이 빨간 줄로 말해야 한다.
  await boss.post("/api/settings/pad-seen").send({ deviceId: "dOldApp", profileId: counter.id, kind: "app", printer: `${KITCHEN.ip}:${KITCHEN.port}`, canSetPrinter: false, autoPrint: true });
  await A.page.locator('.admin-tabs button[data-tab="orders"]').click();
  await A.page.locator('.admin-tabs button[data-tab="settings"]').click();
  await A.page.locator('.settings-nav-btn[data-category="print"]').click();
  await A.page.waitForTimeout(1000);
  const counterBox = A.page.locator(`#padProfilesList .pad-profile-row[data-id="${counter.id}"] .pad-profile-devices`);
  const cText = await counterBox.textContent();
  check("★★ 「카운터」 아래에 패드가 보인다(2대 + 옛 앱 1대)", /3대/.test(cText) && (await counterBox.locator(".pad-device").count()) === 3, cText);
  check("★ 이 기기는 「이 기기」로 적힌다", /이 기기/.test(cText), cText);
  check("★ 맞는 프린터면 ✓", /카운터 프린터 ✓/.test(cText), cText);
  check("★ 두 패드 모두 카운터 프린터 ✓", (cText.match(/카운터 프린터 ✓/g) || []).length === 2, cText);
  check("★★ 프린터를 못 바꾸는 옛 앱은 빨간 경고", /다른 프린터로 찍는 중: 주방 프린터/.test(cText) && /1\.4/.test(cText), cText);
  check("방금 본 기기는 「방금」", /방금/.test(cText), cText);
  const kText = await A.page.locator(`#padProfilesList .pad-profile-row[data-id="${kitchen.id}"] .pad-profile-devices`).textContent();
  check("아무도 안 고른 프로필은 그렇다고 말한다", /아직 이 프로필을 고른 기기가 없어요/.test(kText), kText);
  if (process.env.SHOT) await A.page.locator("#padProfilesList").screenshot({ path: process.env.SHOT });

  out.push("\n[한 줄이 안 깨진다 — 이름·프린터·자동 인쇄·✕]");
  const lay = await A.page.evaluate(() => {
    const row = document.querySelector("#padProfilesList .pad-profile-row .pad-profile-fields");
    const r = (sel) => row.querySelector(sel).getBoundingClientRect();
    const name = r(".pad-profile-name"), sel = r(".pad-profile-printer"), lab = r(".pad-profile-auto-label"), del = r(".pad-profile-del");
    const overlap = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    return {
      noOverlap: !overlap(name, sel) && !overlap(sel, lab) && !overlap(lab, del) && !overlap(name, del) && !overlap(sel, del),
      labelOneLine: lab.height < 30,
      checkboxSmall: row.querySelector(".pad-profile-auto").getBoundingClientRect().width <= 24,
      nameNotFull: name.width < row.getBoundingClientRect().width * 0.6,
    };
  });
  check("★ 칸끼리 안 겹친다(✕ 가 글자를 안 덮는다)", lay.noOverlap, JSON.stringify(lay));
  check("「새 주문 자동 인쇄」가 한 줄", lay.labelOneLine, JSON.stringify(lay));
  check("체크박스가 제 크기", lay.checkboxSmall, JSON.stringify(lay));
  check("이름 칸이 혼자 한 줄을 차지하지 않는다", lay.nameNotFull, JSON.stringify(lay));
  await B.ctx.close();

  out.push("\n[사장님 폰(크롬) — 「프로필 없이 쓰기」]");
  const C = await pad({ app: false, viewport: { width: 390, height: 844 } });
  check("묻는다", await C.page.locator("#padProfileBackdrop").isVisible(), "");
  await C.page.locator("#padProfileNone").click();
  await C.page.waitForTimeout(500);
  check("자동 인쇄를 건드리지 않는다", !(await C.page.locator("#autoPrintToggle").isChecked()), "");
  await C.page.reload({ waitUntil: "networkidle" });
  await C.page.waitForTimeout(1500);
  check("★ 다시 묻지 않는다", !(await C.page.locator("#padProfileBackdrop").isVisible()), "");
  check("📍 는 「프로필」로 보인다(누르면 고를 수 있다)", /프로필/.test(await C.page.locator("#padProfileBadge").textContent()), "");
  await C.ctx.close();

  out.push("\n[크롬으로 연 패드가 「주방」을 고르면 — 자동 인쇄가 안 된다고 경고]");
  {
    const D = await pad({ app: false });
    await D.page.locator("#padProfileChoices button", { hasText: "주방" }).first().click();
    await D.page.waitForTimeout(800);
    await D.ctx.close();
    const devs = (await boss.get("/api/settings/pad-devices")).body.devices || [];
    const d = devs.find((x) => x.profile === kitchen.id);
    check("서버가 크롬 기기를 「주방」으로 안다", d && d.kind !== "app", JSON.stringify(devs));
    await A.page.locator('.admin-tabs button[data-tab="orders"]').click();
    await A.page.locator('.admin-tabs button[data-tab="settings"]').click();
    await A.page.waitForTimeout(1000);
    const t = await A.page.locator(`#padProfilesList .pad-profile-row[data-id="${kitchen.id}"] .pad-profile-devices`).textContent();
    check("★ 「POS 앱이 아니라 자동 인쇄가 안 돼요」", /POS 앱이 아니라 자동 인쇄가 안 돼요/.test(t), t);
  }

  out.push("\n[설정 > 인쇄 — 프로필 편집]");
  await A.page.locator('.settings-nav-btn[data-category="print"]').click();
  await A.page.waitForTimeout(300);
  check("★ 설정 > 인쇄에 표가 보인다", await A.page.locator("#padTouchTable").isVisible(), "");
  await A.page.locator("#addPadProfileBtn").click();
  const rows = A.page.locator("#padProfilesList .pad-profile-row");
  check("추가하면 한 줄 늘어난다", (await rows.count()) === 3, "");
  await rows.nth(2).locator(".pad-profile-name").fill("2층");
  await rows.nth(2).locator(".pad-profile-printer").selectOption({ label: `🖨️ ${KITCHEN.name}` });
  await A.page.locator("#savePadProfilesBtn").click();
  await A.page.waitForTimeout(500);
  r = await boss.get("/api/settings/pad-profiles");
  const p3 = r.body.profiles[2] || {};
  check("★ 저장된다 — 이름·프린터", p3.name === "2층" && p3.printerId === kp.id, JSON.stringify(r.body.profiles));

  out.push("\n[앱을 지웠다 다시 깔아도 자리를 기억한다 — 앱 1.6]");
  {
    const E1 = await pad({ target: "", androidId: "lenovo42" });
    await E1.page.locator("#padProfileChoices button", { hasText: "카운터" }).first().click();
    await E1.page.waitForTimeout(800);
    await E1.ctx.close(); // 앱 삭제 — 저장 공간(localStorage)과 앱의 프린터 설정이 전부 사라진다
    const E2 = await pad({ target: "", androidId: "lenovo42" });
    check("★★ 다시 깐 패드에 「이 기기는 어디인가요?」가 안 뜬다", !(await E2.page.locator("#padProfileBackdrop").isVisible()), "");
    check("★★ 「🔒📍 카운터」로 돌아온다", (await E2.page.locator("#padProfileBadge").textContent()) === "🔒📍 카운터", await E2.page.locator("#padProfileBadge").textContent());
    const es = await E2.page.evaluate(() => window.__set);
    check("★ 앱 프린터도 카운터 프린터로 다시 적힌다", JSON.stringify(es[es.length - 1]) === JSON.stringify([COUNTER.ip, COUNTER.port]), JSON.stringify(es));
    check("자동 인쇄도 다시 켜진다", await E2.page.locator("#autoPrintToggle").isChecked(), "");

    out.push("\n[사장님이 설정 화면에서 그 패드를 「주방」으로 옮긴다]");
    await A.page.locator('.admin-tabs button[data-tab="orders"]').click();
    await A.page.locator('.admin-tabs button[data-tab="settings"]').click();
    await A.page.waitForTimeout(1000);
    const li = A.page.locator('#padProfilesList .pad-device[data-device="alenovo42"]');
    check("★ 설정에 모델 이름이 보인다", /LENOVO TB-X606F/.test(await li.textContent()), await li.textContent());
    await li.locator(".pad-device-move").selectOption(kitchen.id);
    await A.page.waitForTimeout(1000);
    check("옮긴 뒤 「주방」 아래로 간다", (await A.page.locator(`#padProfilesList .pad-profile-row[data-id="${kitchen.id}"] .pad-device[data-device="alenovo42"]`).count()) === 1, "");
    // 패드는 1분마다 알리며 따라간다 — 시험에서는 새로 열어 바로 본다.
    await E2.page.reload({ waitUntil: "networkidle" });
    await E2.page.waitForTimeout(1500);
    check("★★ 패드가 「주방」으로 바뀐다", (await E2.page.locator("#padProfileBadge").textContent()) === "🔒📍 주방", await E2.page.locator("#padProfileBadge").textContent());
    const es2 = await E2.page.evaluate(() => window.__set);
    check("★ 앱 프린터도 주방 프린터로", JSON.stringify(es2[es2.length - 1]) === JSON.stringify([KITCHEN.ip, KITCHEN.port]), JSON.stringify(es2));
    await E2.ctx.close();
  }

  out.push("\n[사장님이 프로필의 프린터를 바꾸면 패드가 따라간다]");
  r = await boss.get("/api/settings/pad-profiles");
  const profs = r.body.profiles.map((p) => (p.id === counter.id ? { ...p, printerId: kp.id } : p));
  await boss.put("/api/settings/pad-profiles").send({ profiles: profs });
  await A.page.reload({ waitUntil: "networkidle" });
  await A.page.waitForTimeout(1500);
  const set3 = await A.page.evaluate(() => window.__set);
  check("★★ 다시 열면 앱 프린터가 새 프린터(주방)로", JSON.stringify(set3[set3.length - 1]) === JSON.stringify([KITCHEN.ip, KITCHEN.port]), JSON.stringify(set3));
  await A.page.reload({ waitUntil: "networkidle" });
  await A.page.waitForTimeout(1500);
  // 가짜 앱의 기록(__set)은 새로고침마다 비워진다 — 이번 열기에서 부른 것이 없어야 한다.
  check("★ 이미 맞는 프린터면 다시 안 건드린다", (await A.page.evaluate(() => window.__set.length)) === 0, JSON.stringify(await A.page.evaluate(() => window.__set)));
  await A.ctx.close();

  out.push("\n[패드 크기에서 위쪽이 안 깨진다 — 📍 가 붙어도]");
  for (const [w, h] of [[1280, 800], [1024, 700], [960, 600], [800, 1280]]) {
    const P = await pad({ viewport: { width: w, height: h } });
    const first = P.page.locator("#padProfileChoices button").first();
    if (await first.isVisible()) await first.click();
    await P.page.waitForTimeout(500);
    const m = await P.page.evaluate(() => {
      const tabs = document.querySelector(".admin-tabs");
      const badge = document.querySelector("#padProfileBadge").getBoundingClientRect();
      const top = document.querySelector(".admin-topbar").getBoundingClientRect();
      return {
        tabsFit: tabs.scrollWidth <= tabs.clientWidth + 1, over: tabs.scrollWidth - tabs.clientWidth, bw: Math.round(badge.width),
        badgeIn: badge.width > 0 && badge.right <= innerWidth && badge.bottom <= top.bottom,
        pageFits: document.documentElement.scrollWidth <= innerWidth,
      };
    });
    check(`★ ${w}×${h}: 탭이 전부 보인다`, m.tabsFit, JSON.stringify(m));
    check(`${w}×${h}: 📍 가 위 줄 안에 보인다`, m.badgeIn, JSON.stringify(m));
    check(`${w}×${h}: 화면이 옆으로 안 넘친다`, m.pageFits, "");
    await P.ctx.close();
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
