// 설정은 「설정 저장」을 눌러야 저장된다 — 실제로 눌러본다.
//
// 사장님(2026-09-11): "누르는 즉시 저장되는 카드 — 이것도 그냥 저장 누르게
// 만들어줘."
//
// 글자 크기·알림음·로고·직원 권한 네 카드는 지금까지 만지는 순간 저장됐다.
// 이제 다른 설정들과 똑같이 버튼을 눌러야 저장된다.
//
// ── 이 파일이 지키는 세 가지 ────────────────────────────────────────
//
//   1. **누르기 전에는 저장되지 않는다.** 이걸 안 재면 「저장 버튼을 달았다」가
//      「버튼도 있고 예전처럼 즉시 저장도 된다」일 수 있다.
//   2. **누르면 저장된다.** 당연해 보이지만 이게 이 작업의 전부다.
//   3. **안 눌렀으면 안 눌렀다고 말해준다.** 즉시 저장은 아무것도 안 잃었다.
//      버튼 저장으로 바꾸면 안 누르고 나가서 잃을 수 있다.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-settings-save";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

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
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on("dialog", (d) => d.dismiss());
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "ownerpass123" }) });
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1300);
  await page.locator('.admin-tabs button[data-tab="settings"]').click();
  await page.waitForTimeout(800);

  const dirty = (btn) => page.evaluate((b) => {
    const el = document.querySelector(`#${b}Dirty`);
    return !!el && !el.hidden;
  }, btn);
  const stored = (key) => page.evaluate((k) => localStorage.getItem(k), key);

  out.push("[★★ 화면 글자 크기 — 누르기 전에는 저장되지 않는다]");
  {
    await page.locator('.settings-nav-btn[data-category="display"]').click();
    await page.waitForTimeout(500);
    const before = await stored("hangukgwan_admin_ui_font_scale");
    await page.locator("#uiFontScaleIncBtn").click();
    await page.waitForTimeout(300);
    const shown = await page.locator("#uiFontScaleValue").textContent();
    check("크기는 바로 보여준다 (눈으로 고르는 것이라)", shown.trim() !== "100%", shown);
    check("★ 아직 기기에 저장되지 않았다", (await stored("hangukgwan_admin_ui_font_scale")) === before, `${before} → ${await stored("hangukgwan_admin_ui_font_scale")}`);
    check("★ 저장 안 됐다고 말해준다", await dirty("saveUiFontScaleBtn"), "");

    await page.locator("#saveUiFontScaleBtn").click();
    await page.waitForTimeout(500);
    check("★ 누르면 저장된다", (await stored("hangukgwan_admin_ui_font_scale")) !== before, String(await stored("hangukgwan_admin_ui_font_scale")));
    check("★ 표시가 사라진다", !(await dirty("saveUiFontScaleBtn")), "");
    check("저장되었다고 뜬다", await page.evaluate(() => !document.querySelector("#uiFontScaleMsg").hidden), "");
  }

  out.push("\n[★★ 알림음 — 고르는 중에 주문이 와도 아까 그 소리로 운다]");
  {
    const before = await stored("hg_admin_alarmSound");
    // 「딩동」처럼 기본이 아닌 소리를 고른다.
    const picked = await page.evaluate(() => {
      const r = [...document.querySelectorAll("input[name='alarmTone']")].find((x) => !x.checked);
      if (!r) return null;
      r.checked = true;
      r.dispatchEvent(new Event("change", { bubbles: true }));
      return r.value;
    });
    await page.waitForTimeout(500);
    check("다른 소리를 골랐다", !!picked, String(picked));
    // ★ 이게 핵심이다. 고르는 동안 실제 알림은 안 바뀌어야 한다.
    check("★ 고르는 중에는 기기에 안 적힌다", (await stored("hg_admin_alarmSound")) === before, `${before} → ${await stored("hg_admin_alarmSound")}`);
    check("★ 저장 안 됐다고 말해준다", await dirty("saveAlarmBtn"), "");

    await page.locator("#saveAlarmBtn").click();
    await page.waitForTimeout(500);
    check("★ 누르면 저장된다", (await stored("hg_admin_alarmSound")) === picked, `${await stored("hg_admin_alarmSound")} vs ${picked}`);
    check("★ 표시가 사라진다", !(await dirty("saveAlarmBtn")), "");
  }

  out.push("\n[★★ 직원 권한 — 여러 개를 고쳐놓고 한 번에 저장]");
  {
    await page.locator('.settings-nav-btn[data-category="account"]').click();
    await page.waitForTimeout(600);
    const read = () => page.evaluate(async () => (await fetch("/api/settings/staff-permissions").then((r) => r.json())));
    const before = await read();
    await page.locator("#perm_menuEdit").click();
    await page.waitForTimeout(400);
    const mid = await read();
    // 하나씩 저장되면 그 사이에 직원이 반쯤 열린 권한으로 들어온다.
    check("★ 스위치만 만져서는 서버가 안 바뀐다",
      JSON.stringify(mid) === JSON.stringify(before), `${JSON.stringify(before)} → ${JSON.stringify(mid)}`);
    check("★ 저장 안 됐다고 말해준다", await dirty("saveStaffPermsBtn"), "");

    await page.locator("#saveStaffPermsBtn").click();
    await page.waitForTimeout(700);
    const after = await read();
    check("★ 누르면 서버에 저장된다", JSON.stringify(after) !== JSON.stringify(before), JSON.stringify(after));
    check("★ 표시가 사라진다", !(await dirty("saveStaffPermsBtn")), "");
  }

  out.push("\n[매장 로고 — 고른 파일은 저장을 눌러야 올라간다]");
  {
    await page.locator('.settings-nav-btn[data-category="store"]').click();
    await page.waitForTimeout(600);
    check("저장 버튼이 있다", await page.locator("#saveLogoBtn").isVisible(), "");
    // 파일을 안 고르고 누르면, 아무 말 없이 성공한 척하지 않는다.
    await page.locator("#saveLogoBtn").click();
    await page.waitForTimeout(500);
    const msg = await page.locator("#logoMsg").textContent();
    check("★ 파일을 안 골랐으면 그렇게 말한다", /골라|選擇/.test(msg), msg);
  }

  out.push("\n[★★ 넣은 시각을 기본값으로 되돌릴 수 있다]");
  {
    // <input type="time"> 은 한 번 값이 들어가면 다시 비우는 방법이 브라우저
    // 마다 다르고, 가게 태블릿에서는 아예 없다시피 하다.
    await page.locator('.settings-nav-btn[data-category="order"]').click();
    await page.waitForTimeout(600);
    await page.locator("#s_soldout_release_time").fill("06:00");
    await page.locator("#saveSoldOutReleaseBtn").click();
    await page.waitForTimeout(800);
    const saved = await page.evaluate(async () => (await fetch("/api/settings").then((r) => r.json())).soldout_release_time);
    check("시각을 넣어 저장했다", saved === "06:00", String(saved));

    check("★ 기본값 버튼이 보인다", await page.locator("#soldOutReleaseResetBtn").isVisible(), "");
    await page.locator("#soldOutReleaseResetBtn").click();
    await page.waitForTimeout(300);
    check("★ 누르면 칸이 비워진다", (await page.locator("#s_soldout_release_time").inputValue()) === "", "");
    check("★ 저장 안 됐다고 말해준다", await dirty("saveSoldOutReleaseBtn"), "");

    await page.locator("#saveSoldOutReleaseBtn").click();
    await page.waitForTimeout(900);
    const cleared = await page.evaluate(async () => (await fetch("/api/settings").then((r) => r.json())).soldout_release_time);
    check("★ 저장하면 기본값(영업 시작)으로 돌아간다", cleared == null, String(cleared));
    check("안내도 영업 시작을 가리킨다", /11:00/.test(await page.locator("#soldOutReleaseEffective").textContent()), "");
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  await browser.close();
  server.close();
  process.exit(fail === 0 ? 0 : 1);
})();
