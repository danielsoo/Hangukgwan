// 「첫 주문 최소 2인분」이 그 메뉴 화면에 적혀 있는가.
//
// 사장님(2026-09-12): "동판에 쓰여있는 이 문구를 닭갈비와 삼겹살에도
// 넣어달래."
//
// 셋 다 첫 주문 최소 2인분인데(min_first_order_qty: 2), 안내가 붙어 있던
// 것은 牛/豬 를 섞는 동판불고기뿐이었다. 닭갈비와 삼겹살은 수량이 2 로
// 미리 올라가 있기만 하고 **왜 그런지는 아무 데도 안 쓰여 있었다.**
// 손님은 그걸 「왜 1인분은 안 되지」로 읽는다.
//
// 문구는 메뉴마다 다르다. 섞는 메뉴에는 비율 이야기가 붙고, 안 섞는
// 메뉴에는 최소 수량만 적는다 — 닭갈비에 「牛豬 비율」이라고 쓸 수는 없다.
// 숫자도 글자로 박지 않고 그 메뉴의 min_first_order_qty 를 쓴다.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-min-first-hint";
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

(async () => {
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  page.on("dialog", (d) => d.dismiss());
  // 서버를 한 번 두드려 씨딩을 마치게 한 뒤에 store 를 읽는다 — 뜨자마자
  // 읽으면 메뉴도 테이블도 비어 있다.
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  const { connectDB } = require("../src/db");
  await connectDB();
  await require("./disable-order-hours")();

  const T = store.tables.find((t) => !t.is_counter).number;
  await page.goto(`${base}/order.html?table=${encodeURIComponent(T)}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  // 인원수를 먼저 묻는 화면이 뜨면 넘긴다.
  const party = page.locator("#partySizeBackdrop:not([hidden]) button", { hasText: /2|확인|確認/ }).first();
  if (await party.count()) { await party.click().catch(() => {}); await page.waitForTimeout(600); }

  const grill = store.menuItems.filter((m) => m.min_first_order_qty);
  check("첫 주문 최소가 걸린 메뉴가 셋 이상", grill.length >= 3, JSON.stringify(grill.map((m) => m.name_ko)));

  const openItem = async (item) => {
    // 메뉴 목록에서 그 줄을 찾아 연다. 검색칸이 있으면 그걸로 좁힌다.
    await page.evaluate((zh) => {
      const row = [...document.querySelectorAll(".item-row")].find((r) => r.textContent.includes(zh));
      if (row) row.click();
    }, item.name_zh);
    await page.waitForTimeout(700);
    return page.evaluate(() => {
      const vis = (sel) => {
        const el = document.querySelector(sel);
        return !!el && !el.hidden && el.offsetParent !== null;
      };
      return {
        open: !document.querySelector("#itemSheetBackdrop").hidden,
        qty: (document.querySelector("#qtyVal") || {}).textContent || "",
        qtyHint: vis("#qtyHint") ? document.querySelector("#qtyHint").textContent.trim() : "",
        mixHint: vis("#mixOptionsHint") ? document.querySelector("#mixOptionsHint").textContent.trim() : "",
      };
    });
  };
  const closeSheet = async () => {
    await page.evaluate(() => {
      const b = document.querySelector("#itemSheetClose") || document.querySelector("#itemSheetBackdrop .sheet-close");
      if (b) b.click();
      else document.querySelector("#itemSheetBackdrop").hidden = true;
    });
    await page.waitForTimeout(400);
  };

  out.push("[동판불고기 — 원래 있던 안내는 그대로]");
  const bulgogi = grill.find((m) => m.mix_options);
  let r = await openItem(bulgogi);
  check("화면이 열린다", r.open === true);
  check("★ 비율 + 최소 수량 안내가 있다", /比例/.test(r.mixHint) && /2/.test(r.mixHint), r.mixHint);
  check("숫자가 그 메뉴의 최소 수량이다", r.mixHint.includes(String(bulgogi.min_first_order_qty)), r.mixHint);
  check("★ 안내가 두 줄로 겹치지 않는다", r.qtyHint === "", r.qtyHint);
  await closeSheet();

  out.push("\n[닭갈비 · 삼겹살 — 여기에도 적힌다]");
  for (const item of grill.filter((m) => !m.mix_options)) {
    r = await openItem(item);
    check(`${item.name_ko}: 수량이 ${item.min_first_order_qty} 로 올라가 있다`,
      r.qty.trim() === String(item.min_first_order_qty), r.qty);
    check(`★★ ${item.name_ko}: 왜 그런지 적혀 있다`, r.qtyHint.length > 0, `"${r.qtyHint}"`);
    check(`★ ${item.name_ko}: 최소 수량이 문장에 있다`, r.qtyHint.includes(String(item.min_first_order_qty)), r.qtyHint);
    // 닭갈비에 「牛豬 비율」이라고 쓰면 안 된다 — 섞을 것이 없는 메뉴다.
    check(`★ ${item.name_ko}: 섞는 이야기는 안 붙는다`, !/牛豬|소\/돼지|beef and pork/i.test(r.qtyHint), r.qtyHint);
    await closeSheet();
  }

  out.push("\n[최소가 없는 메뉴에는 안 붙는다]");
  const plain = store.menuItems.find((m) => !m.min_first_order_qty && !m.mix_options && m.available !== 0);
  r = await openItem(plain);
  check(`${plain.name_ko}: 수량은 1`, r.qty.trim() === "1", r.qty);
  check("★ 안내가 없다", r.qtyHint === "", r.qtyHint);
  await closeSheet();

  out.push("\n[숫자를 글자로 박아두지 않았다]");
  const fs = require("fs");
  const path = require("path");
  const i18n = fs.readFileSync(path.join(__dirname, "..", "public", "js", "i18n.js"), "utf8");
  check("★ 최소 수량 자리가 {n} 이다 (세 언어 모두)",
    (i18n.match(/minFirstOrderHint: "[^"]*\{n\}[^"]*"/g) || []).length === 3,
    JSON.stringify(i18n.match(/minFirstOrderHint: "[^"]*"/g)));
  check("섞는 메뉴 안내도 마찬가지",
    (i18n.match(/mixOptionsHint: "[^"]*\{n\}[^"]*"/g) || []).length === 3,
    JSON.stringify(i18n.match(/mixOptionsHint: "[^"]*"/g)));

  {
    const dir = path.join(__dirname, "..", "..", "..", "_screens");
    fs.mkdirSync(dir, { recursive: true });
    const dak = grill.find((m) => !m.mix_options);
    await openItem(dak);
    await page.locator("#itemSheet").screenshot({ path: path.join(dir, "min-first-hint.png") });
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  await browser.close();
  server.close();
  process.exit(fail === 0 ? 0 : 1);
})();
