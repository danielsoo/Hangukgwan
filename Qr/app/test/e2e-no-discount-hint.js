// 할인이 안 되는 메뉴에 「本品項不適用任何優惠」 가 적히는가.
//
// 사장님(2026-09-28, 삼겹살 화면 캡처에 수량 아래·담기 버튼 위를 파란
// 박스로 그려서): "파란 박스 위치에 本品項不適用任何優惠 ... 문구 넣어주세요.
// 넣을 제품 1. 신라면 김밥세트 2. 기타류 전체 3. 음료 전체"
//
// 그 셋은 이미 결제에서 VIP 할인이 빠지는 것들이다 — 음료·기타는 분류
// 할인 제외(discount_excluded), 신라면 김밥세트는 정가가 적힌 「이미 깎아
// 파는」 세트(isSetDiscountItem). 그래서 이 시험은 문구가 **실제로 할인을
// 빼는 규칙과 똑같은 메뉴에만** 붙는지를 잰다. 이름으로 따로 적으면 문구는
// 「할인 없음」인데 결제에서는 깎이는 날이 온다.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-no-discount-hint";
process.env.ADMIN_PASSWORD = "ownerpass123";

const { launchBrowser } = require("./browser");
const app = require("../server");
const { store } = require("../src/db");
const { isDiscountExcludedMenuItem, isSetDiscountItem } = require("../src/discounts");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const TEXT = "本品項不適用任何優惠";

(async () => {
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  page.on("dialog", (d) => d.dismiss());
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  const { connectDB } = require("../src/db");
  await connectDB();
  await require("./disable-order-hours")();

  const catOf = (m) => store.categories.find((c) => c.id === m.category_id);
  const live = store.menuItems.filter((m) => !m.deleted_at && m.available !== 0);
  const setItem = live.find((m) => m.name_ko === "신라면 김밥세트");
  const drink = live.find((m) => (catOf(m) || {}).key === "drink");
  const plain = live.find((m) => m.name_ko === "삼겹살") ||
    live.find((m) => !isDiscountExcludedMenuItem(m, catOf(m)) && !isSetDiscountItem(m));

  out.push("[메뉴 응답 — 서버가 답을 낸다]");
  const menu = await (await fetch(`${base}/api/menu`)).json();
  const flat = menu.flatMap((c) => c.items.map((i) => ({ ...i, _cat: c })));
  const byId = (m) => flat.find((i) => i.id === m.id) || {};
  check("신라면 김밥세트가 있다", !!setItem);
  check("★ 신라면 김밥세트: no_discount", byId(setItem).no_discount === true, JSON.stringify(byId(setItem).no_discount));
  check("★ 음료: no_discount", !!drink && byId(drink).no_discount === true, drink && drink.name_ko);
  check("★ 보통 메뉴(삼겹살 등)는 아니다", byId(plain).no_discount === false, plain && plain.name_ko);
  {
    // 분류가 할인 제외면 그 분류 메뉴 **전부**, 아니면 세트만 — 결제 규칙 그대로.
    const wrong = flat.filter(
      (i) => i.no_discount !== (isDiscountExcludedMenuItem(i, i._cat) || isSetDiscountItem(i))
    );
    check("★★ 모든 메뉴가 결제의 할인 규칙과 같은 답이다", wrong.length === 0, wrong.map((i) => i.name_ko).join(","));
    const excludedCats = menu.filter((c) => c.discount_excluded);
    const leaks = excludedCats.flatMap((c) => c.items.filter((i) => i.discount_excluded && !i.no_discount));
    check("★ 할인 제외 분류(음료·기타)의 메뉴는 전부", leaks.length === 0, leaks.map((i) => i.name_ko).join(","));
  }

  out.push("\n[손님 화면 — 담기 버튼 바로 위]");
  const T = store.tables.find((t) => !t.is_counter).number;
  await page.goto(`${base}/order.html?table=${encodeURIComponent(T)}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const party = page.locator("#partySizeBackdrop:not([hidden]) button", { hasText: /2|확인|確認/ }).first();
  if (await party.count()) { await party.click().catch(() => {}); await page.waitForTimeout(600); }

  const openItem = async (item) => {
    await page.evaluate((zh) => {
      const row = [...document.querySelectorAll(".item-row")].find((r) => r.textContent.includes(zh));
      if (row) row.click();
    }, item.name_zh);
    await page.waitForTimeout(700);
    return page.evaluate(() => {
      const el = document.querySelector("#noDiscountHint");
      const btn = document.querySelector("#addToCartBtn");
      const shown = !!el && !el.hidden && el.offsetParent !== null;
      const a = shown ? el.getBoundingClientRect() : null;
      const b = btn.getBoundingClientRect();
      return {
        open: !document.querySelector("#itemSheetBackdrop").hidden,
        shown,
        text: shown ? el.textContent.trim() : "",
        gapToButton: a ? Math.round(b.top - a.bottom) : null,
      };
    });
  };
  const closeSheet = async () => {
    await page.evaluate(() => {
      const b = document.querySelector("#itemSheetClose");
      if (b) b.click();
      else document.querySelector("#itemSheetBackdrop").hidden = true;
    });
    await page.waitForTimeout(400);
  };

  for (const [label, item] of [["신라면 김밥세트", setItem], ["음료", drink]]) {
    const r = await openItem(item);
    check(`${label}: 창이 열린다`, r.open === true);
    check(`★★ ${label}: 「${TEXT}」 가 보인다`, r.shown && r.text === TEXT, `"${r.text}"`);
    // 사장님이 그린 자리 — 담기 버튼 바로 위. 사이에 다른 칸이 끼면 멀어진다.
    check(`★ ${label}: 담기 버튼 바로 위(40px 안)`, r.gapToButton != null && r.gapToButton >= 0 && r.gapToButton < 40, `${r.gapToButton}px`);
    await closeSheet();
  }
  {
    const r = await openItem(plain);
    check(`★ ${plain.name_ko}: 안 보인다`, r.shown === false, `"${r.text}"`);
    await closeSheet();
  }

  out.push("\n[문구]");
  const fs = require("fs");
  const path = require("path");
  const i18n = fs.readFileSync(path.join(__dirname, "..", "public", "js", "i18n.js"), "utf8");
  check("★ 중국어는 사장님 문구 그대로", i18n.includes(`noDiscountItem: "${TEXT}"`), "");
  check("세 언어에 다 있다", (i18n.match(/noDiscountItem: "/g) || []).length === 3, "");

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  await browser.close();
  server.close();
  process.exit(fail === 0 ? 0 : 1);
})();
