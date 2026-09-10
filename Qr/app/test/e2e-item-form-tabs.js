// 메뉴 수정 폼의 왼쪽 탭 — 나눠 놓고도 한 번에 다 저장되는가.
//
// 사장님(2026-09-10, 폼 스크린샷과 함께): "메뉴 관리 폼이 너무 이것 저것 다
// 섞여 있어서 엄청 헷갈려. 이걸 좀 더 보기 좋게 분류 했으면 좋겠어. 왼쪽에
// 탭을 둬서 설정처럼 구분하면서 보는 게 좋을 것 같아."
//
// 보기 좋아지는 것보다 훨씬 중요한 게 있다. 입력칸을 다섯 군데로 옮겼는데
// 저장할 때 한 칸이라도 빠지면, 사장님은 가격만 고쳤는데 옵션이 조용히
// 지워지는 일이 생긴다. 화면에는 아무 오류도 안 뜬다. 그래서 여기서 재는
// 것은 「탭이 예쁘게 나뉘었는가」가 아니라 **안 보이는 탭의 값도 그대로
// 저장되는가** 다.
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
process.env.SESSION_SECRET = "e2e-item-form-tabs";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const { launchBrowser } = require("./browser");
const app = require("../server");
const { store } = require("../src/db");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const PANES = ["basic", "price", "options", "display", "soldout"];

(async () => {
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.on("dialog", (d) => d.dismiss());
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "ownerpass123" }) });
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.locator('.admin-tabs button[data-tab="menu"]').click();
  await page.waitForTimeout(1200);

  // 옵션·추가옵션·가격이 골고루 들어 있는 품목을 고른다 — 한 탭만 채워진
  // 품목으로 재면 다른 탭이 빠져도 모른다.
  const target = store.menuItems.find((m) => m.code === "15") || store.menuItems[0];
  await page.locator("#menuCategories tr").filter({ hasText: target.name_ko }).first().click();
  await page.waitForTimeout(800);
  check("메뉴 수정 창이 열린다", await page.locator("#itemModalBackdrop").isVisible());

  out.push("[다섯 개로 나뉘어 있고, 한 번에 하나만 보인다]");
  check("탭이 다섯 개다", (await page.locator(".item-form-nav-btn").count()) === PANES.length);
  check("열면 「기본」부터 보인다",
    await page.locator('.item-form-nav-btn[data-item-pane="basic"]').evaluate((el) => el.classList.contains("active")));
  for (const p of PANES) {
    await page.locator(`.item-form-nav-btn[data-item-pane="${p}"]`).click();
    await page.waitForTimeout(250);
    const shown = await page.evaluate(
      () => [...document.querySelectorAll(".item-form-pane")].filter((el) => !el.hidden).map((el) => el.dataset.itemPane)
    );
    check(`「${p}」 을 누르면 그것 하나만 보인다`, shown.length === 1 && shown[0] === p, JSON.stringify(shown));
    // 어느 탭에 있든 저장은 늘 같은 자리에 있어야 한다 — 찾아 헤매면 안 된다.
    check(`  저장 버튼이 계속 보인다 (${p})`, await page.locator("#saveItemBtn").isVisible());
  }

  out.push("");
  out.push("[여기가 진짜다 — 안 보이는 탭의 값이 저장에서 빠지지 않는가]");
  // 「가격」 탭에서 가격만 고치고 저장한다. 나머지 네 탭은 한 번도 안 본다.
  const before = JSON.parse(JSON.stringify(target));
  const NEW_PRICE = (before.price || 200) + 7;
  await page.locator('.item-form-nav-btn[data-item-pane="price"]').click();
  await page.waitForTimeout(300);
  await page.fill("#f_price", String(NEW_PRICE));
  await page.locator("#saveItemBtn").click();
  await page.waitForTimeout(1600);

  const after = await page.evaluate(async (id) => {
    const list = await (await fetch("/api/menu/admin")).json();
    for (const c of list) {
      const hit = (c.items || []).find((i) => i.id === id);
      if (hit) return hit;
    }
    return null;
  }, target.id);
  check("저장된 메뉴를 다시 찾을 수 있다", !!after, JSON.stringify(after));
  check(`가격이 ${NEW_PRICE} 로 바뀌었다`, after && after.price === NEW_PRICE, after && `${after.price}`);
  // 아래가 핵심 — 한 번도 열지 않은 탭의 값들이다.
  check("이름(기본 탭)이 그대로다", after && after.name_ko === before.name_ko, after && after.name_ko);
  check("중국어 이름도 그대로다", after && after.name_zh === before.name_zh, after && after.name_zh);
  check("코드도 그대로다", after && (after.code || null) === (before.code || null), after && `${after.code}`);
  check("옵션(옵션 탭)이 그대로다", after && (after.options || null) === (before.options || null), after && `${after.options}`);
  check("추가 옵션도 그대로다", after && (after.addons || null) === (before.addons || null), after && `${after.addons}`);
  check("대표 메뉴 배지(손님 화면 탭)가 그대로다",
    after && !!after.is_signature === !!before.is_signature, after && `${after.is_signature}`);
  check("판매 상태(품절 탭)가 그대로다", after && !!after.available === !!before.available, after && `${after.available}`);
  check("사진이 날아가지 않았다", after && (after.photo_url || null) === (before.photo_url || null), after && `${after.photo_url}`);

  out.push("");
  out.push("[옵션을 치고 Enter — 쉼표를 직접 찍지 않는다]");
  {
    // 사장님(2026-09-10): "옵션 치고 엔터하면 밑에 글자 등록되어있는 것처럼
    // 뜨게 해서 보다 더 직관적으로 옵션이 등록되었다는 걸 인지하게 해주고
    // 싶어."
    //
    // 화면만 바뀌고 저장 형태는 그대로여야 한다. 형식이 어긋나면 손님
    // 화면과 서버 파서(src/addons.js)가 옵션을 못 읽는다.
    await page.locator("#menuCategories tr").filter({ hasText: target.name_ko }).first().click();
    await page.waitForTimeout(700);
    await page.locator('.item-form-nav-btn[data-item-pane="options"]').click();
    await page.waitForTimeout(300);

    const opt = page.locator('.chip-field[data-chip-for="f_options"]');
    const startCount = await opt.locator(".chip").count();
    check("이미 있던 옵션이 조각으로 뜬다", startCount > 0, `${startCount}`);

    await opt.locator(".chip-entry").fill("羊");
    await opt.locator(".chip-entry").press("Enter");
    await page.waitForTimeout(250);
    check("Enter 로 조각이 하나 늘어난다", (await opt.locator(".chip").count()) === startCount + 1);
    check("입력칸이 비워진다", (await opt.locator(".chip-entry").inputValue()) === "");
    check("저장될 값은 여전히 쉼표로 이어진다",
      (await page.locator("#f_options").inputValue()).endsWith(",羊"),
      await page.locator("#f_options").inputValue());

    // 지금까지 쉼표로 찍어오셨으니 손이 그렇게 간다 — 쉼표도 받아준다.
    await opt.locator(".chip-entry").fill("鴨");
    await opt.locator(".chip-entry").press(",");
    await page.waitForTimeout(250);
    check("쉼표를 쳐도 조각으로 들어간다", (await opt.locator(".chip").count()) === startCount + 2);

    // 같은 걸 두 번 넣으면 안 된다 — 손님 화면에 같은 버튼이 두 개 뜬다.
    const beforeDupe = await page.locator("#f_options").inputValue();
    await opt.locator(".chip-entry").fill("羊");
    await opt.locator(".chip-entry").press("Enter");
    await page.waitForTimeout(200);
    check("같은 값은 두 번 안 들어간다", (await page.locator("#f_options").inputValue()) === beforeDupe);

    await opt.locator(".chip .chip-x").last().click();
    await page.waitForTimeout(200);
    check("✕ 로 하나만 뺀다", (await opt.locator(".chip").count()) === startCount + 1);

    // 값이 붙는 「추가 옵션」은 이름과 가격 두 칸이다.
    const add = page.locator('.chip-field[data-chip-for="f_addons"]');
    await add.locator(".chip-entry").fill("치즈 추가");
    await add.locator(".chip-entry-price").fill("30");
    await add.locator(".chip-add-btn").click();
    await page.waitForTimeout(250);
    const addonsValue = await page.locator("#f_addons").inputValue();
    check("추가 옵션은 「이름:가격」 으로 저장된다", addonsValue.includes("치즈 추가:30"), addonsValue);
    check("조각에는 값이 보인다",
      (await add.locator(".chip-text").allTextContents()).some((t) => t.includes("치즈 추가 +NT$30")),
      JSON.stringify(await add.locator(".chip-text").allTextContents()));

    // 이름에 쉼표나 콜론을 치면 값이 쪼개진다 — 지워서 받는다.
    await add.locator(".chip-entry").fill("계란:추가,둘");
    await add.locator(".chip-entry-price").fill("20");
    await add.locator(".chip-add-btn").click();
    await page.waitForTimeout(250);
    const cleaned = await page.locator("#f_addons").inputValue();
    check("이름 속 쉼표·콜론은 지우고 넣는다", cleaned.includes("계란 추가 둘:20"), cleaned);

    out.push("");
    out.push("  [저장하면 서버에도 그 형태 그대로 들어간다]");
    const expectOptions = await page.locator("#f_options").inputValue();
    const expectAddons = await page.locator("#f_addons").inputValue();
    await page.locator("#saveItemBtn").click();
    await page.waitForTimeout(1600);
    const saved = await page.evaluate(async (id) => {
      const list = await (await fetch("/api/menu/admin")).json();
      for (const c of list) {
        const hit = (c.items || []).find((i) => i.id === id);
        if (hit) return hit;
      }
      return null;
    }, target.id);
    check("옵션이 그대로 저장된다", saved && saved.options === expectOptions, saved && `${saved.options}`);
    check("추가 옵션이 그대로 저장된다", saved && saved.addons === expectAddons, saved && `${saved.addons}`);

    // 다시 열면 저장된 값이 조각으로 돌아와야 한다.
    await page.locator("#menuCategories tr").filter({ hasText: target.name_ko }).first().click();
    await page.waitForTimeout(800);
    await page.locator('.item-form-nav-btn[data-item-pane="options"]').click();
    await page.waitForTimeout(300);
    check("다시 열면 조각으로 되살아난다",
      (await page.locator('.chip-field[data-chip-for="f_options"] .chip').count()) === expectOptions.split(",").length,
      expectOptions);
    check("추가 옵션도 되살아난다",
      (await page.locator('.chip-field[data-chip-for="f_addons"] .chip').count()) === expectAddons.split(",").length,
      expectAddons);
    await page.locator("#itemModalClose").click();
    await page.waitForTimeout(300);
  }

  out.push("");
  out.push("[하나만 고르는 것과 여러 개 고르는 것이 갈라 보인다]");
  {
    await page.locator("#menuCategories tr").filter({ hasText: target.name_ko }).first().click();
    await page.waitForTimeout(700);
    await page.locator('.item-form-nav-btn[data-item-pane="options"]').click();
    await page.waitForTimeout(300);
    const titles = await page.locator(".option-group-title").allTextContents();
    check("제목이 둘로 나뉘어 있다", titles.length === 2, JSON.stringify(titles));
    check("「하나만」 이 먼저", /하나만/.test(titles[0] || ""), JSON.stringify(titles));
    check("「여러 개」 가 다음", /여러 개/.test(titles[1] || ""), JSON.stringify(titles));
    await page.locator("#itemModalClose").click();
    await page.waitForTimeout(300);
  }

  out.push("");
  out.push("[다른 메뉴를 열면 「기본」부터 다시 시작한다]");
  {
    // 지난번에 보던 탭이 그대로 열려 있으면, 이름을 고치러 들어왔는데
    // 품절 화면에서 시작하게 된다. (저장하면 창이 닫히므로 다시 열어서
    // 「기본」이 아닌 탭을 띄워두고, 그 상태로 다른 메뉴를 연다.)
    await page.locator("#menuCategories tr").filter({ hasText: target.name_ko }).first().click();
    await page.waitForTimeout(700);
    await page.locator('.item-form-nav-btn[data-item-pane="soldout"]').click();
    await page.waitForTimeout(250);
    await page.locator("#itemModalClose").click();
    await page.waitForTimeout(400);
    const other = store.menuItems.find((m) => m.id !== target.id && m.name_ko);
    await page.locator("#menuCategories tr").filter({ hasText: other.name_ko }).first().click();
    await page.waitForTimeout(700);
    check("다시 「기본」이 열린다",
      await page.locator('.item-form-nav-btn[data-item-pane="basic"]').evaluate((el) => el.classList.contains("active")));
    check("이름이 바로 보인다", await page.locator("#f_name_ko").isVisible());
    await page.locator("#itemModalClose").click();
    await page.waitForTimeout(300);
  }

  out.push("");
  out.push("[새 메뉴 추가도 같은 창을 쓴다]");
  {
    await page.locator("#addItemBtn").click();
    await page.waitForTimeout(700);
    check("추가 창이 열린다", await page.locator("#itemModalBackdrop").isVisible());
    check("「기본」부터 시작한다",
      await page.locator('.item-form-nav-btn[data-item-pane="basic"]').evaluate((el) => el.classList.contains("active")));
    check("삭제 버튼은 새 메뉴에는 없다", !(await page.locator("#deleteItemBtn").isVisible()));
    await page.locator("#itemModalClose").click();
  }

  await browser.close();
  server.close();
  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
