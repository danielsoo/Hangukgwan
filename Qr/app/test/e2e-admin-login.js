// 저장된 옛 비밀번호가 채워져 있을 때, 화면이 사람을 가둬두지 않는가.
//
// 2026-09-10 사장님: "같은 비밀번호인데 로컬 3002에서는 비밀번호가 틀렸다고
// 못 들어가고 있어. 근데 본 서버는 잘 돼."
//
// 확인해보니 서버도 DB 도 멀쩡했다(scripts/set-admin-password.js 가 떠 있는
// 서버에 직접 로그인해서 ✓ 를 받았다). 문제는 화면이었다 — 비밀번호 칸은
// autocomplete="current-password" 라서 브라우저가 예전에 저장해둔 값을
// 알아서 채우는데, 실패해도 그 값이 칸에 그대로 남는다. 그래서 몇 번을
// 눌러도 같은 값이 다시 가고, 맞는 비밀번호를 들고도 영영 못 들어간다.
//
// 여기서 재는 건 세 가지다: 실패한 값이 칸에 남지 않는가, 자동완성으로
// 채워진 경우 그렇다고 말해주는가, 그리고 사람이 직접 친 경우에는 괜히
// 자동완성 탓을 하지 않는가.
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
process.env.SESSION_SECRET = "e2e-admin-login";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const { chromium } = require("playwright");
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
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.dismiss());
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });

  const field = page.locator("#loginPassword");
  const err = page.locator("#loginError");

  out.push("[칸이 자동완성을 받는 칸인지부터 확인한다]");
  // 이게 아니면 아래 시나리오 자체가 성립하지 않는다.
  check('autocomplete="current-password" 다',
    (await field.getAttribute("autocomplete")) === "current-password",
    await field.getAttribute("autocomplete"));

  out.push("\n[브라우저가 옛 비밀번호를 채워 넣은 경우]");
  // 자동완성은 값만 바꾸고 beforeinput 을 내지 않는다 — 그걸 그대로 흉내낸다.
  await page.evaluate(() => { document.querySelector("#loginPassword").value = "oldpass9999"; });
  await page.locator("#loginBtn").click();
  await page.waitForTimeout(500);
  check("들여보내지 않는다", !(await page.locator("#dashboard").isVisible()));
  check("실패한 값이 칸에 남지 않는다", (await field.inputValue()) === "", await field.inputValue());
  check("칸에 커서가 가 있다", await field.evaluate((el) => el === document.activeElement));
  {
    const t = await err.innerText();
    check("저장된 비밀번호 때문이라고 말해준다", t.includes("저장해둔"), t);
    check("무엇을 하라고 말해준다", t.includes("직접 입력"), t);
  }

  out.push("\n[사람이 직접 틀린 비밀번호를 친 경우]");
  // 이때 자동완성 탓을 하면 엉뚱한 곳을 뒤지게 만든다.
  await field.pressSequentially("wrongpass", { delay: 10 });
  await page.locator("#loginBtn").click();
  await page.waitForTimeout(500);
  {
    const t = await err.innerText();
    check("자동완성 얘기를 하지 않는다", !t.includes("저장해둔"), t);
    check("그냥 틀렸다고 말한다", t.includes("올바르지 않습니다"), t);
  }
  check("이 경우에도 칸은 비워진다", (await field.inputValue()) === "", await field.inputValue());

  out.push("\n[맞는 비밀번호를 치면 들어간다]");
  // 위에서 칸을 비우고 커서까지 옮겨줬으니, 사람은 그냥 치기만 하면 된다.
  await field.pressSequentially("ownerpass123", { delay: 10 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1200);
  check("관리자 화면이 열린다", await page.locator("#dashboard").isVisible());
  check("오류 문구는 사라진다", await err.isHidden());

  await browser.close();
  server.close();
  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
