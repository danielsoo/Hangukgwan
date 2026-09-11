// 판매 비중 — 입체 원 그래프.
//
// 사장님(2026-09-11): "팔린 항목들의 개수를 원 그래프로 3d 로 보여주면
// 좋을 것 같아. ... 둘이 별개의 기능이야." (위 「전체 메뉴 막대」와 별개)
//
// ── 이 파일이 지키는 것 ──────────────────────────────────────────────
//
//   1. **그림이 실제로 그려진다.** 캔버스에 직접 그리는 것이라, 안 그려져도
//      화면에는 빈 네모만 남고 아무도 모른다. 픽셀을 읽어서 확인한다.
//   2. **숫자는 범례에서 읽힌다.** 입체로 눕히면 앞쪽 조각이 뒤쪽보다 커
//      보인다 — 3D 원 그래프의 피할 수 없는 성질이다. 그래서 수량과
//      퍼센트를 글자로 같이 적는다. 그림만 믿게 두면 틀리게 읽는다.
//   3. **조각이 너무 많아지지 않는다.** 40조각짜리 원은 아무것도 안 알려준다.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-sold-pie";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const { launchBrowser } = require("./browser");
const app = require("../server");
const { store, getDb, connectDB, save } = require("../src/db");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const D = "2026-09-09";
const SOLD = 12; // 12가지를 판다 — 위 8가지 + 「기타」가 되는지 보려고

(async () => {
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.on("dialog", (d) => d.dismiss());
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "ownerpass123" }) });
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  await connectDB();
  // 수량을 12, 11, 10 ... 1 로 내려가게 깔면 순서와 「기타」 묶음이 눈에 보인다.
  const rows = [];
  for (let i = 0; i < SOLD; i++) {
    const mi = store.menuItems[i];
    const qty = SOLD - i;
    rows.push({
      _id: 760001 + i, id: 760001 + i, table_number: String((i % 5) + 1), status: "paid", order_type: "dine_in",
      created_at: `${D} 12:${String(i).padStart(2, "0")}:00`, paid_at: `${D} 12:${String(i).padStart(2, "0")}:30`,
      updated_at: `${D} 12:${String(i).padStart(2, "0")}:30`,
      payment_method: "cash", party_size: 2, party_adults: 2, party_children: 0,
      subtotal: mi.price * qty, discount_amount: 0, discount_type: null, total: mi.price * qty,
      items: [{
        item_id: mi.id, code: mi.code, name_ko: mi.name_ko, name_zh: mi.name_zh, name_en: mi.name_en,
        qty, unit_price: mi.price, selected_addons: [], option_choice: null, spice_choice: null,
        category_key: null, order_type: "dine_in", paid: true, payment_method: "cash",
        paid_at: `${D} 12:${String(i).padStart(2, "0")}:30`, note: "",
      }],
      account_id: null, note: "",
    });
  }
  await getDb().collection("orders").bulkWrite(rows.map((r) => ({ replaceOne: { filter: { _id: r.id }, replacement: r, upsert: true } })));
  store.settings.service_started_at = "2026-09-08 17:00:00";
  await save();
  const totalQty = (SOLD * (SOLD + 1)) / 2; // 12+11+...+1 = 78

  await page.locator('.admin-tabs button[data-tab="settlement"]').click();
  await page.waitForTimeout(900);
  await page.fill("#settlementStartDate", D);
  await page.fill("#settlementEndDate", D);
  await page.waitForTimeout(1700);
  await page.locator('.stl-tab[data-pane="soldPie"]').first().click();
  await page.waitForTimeout(800);

  out.push("[그림이 실제로 그려진다]");
  const painted = await page.evaluate(() => {
    const c = document.querySelector("#settlementPie");
    if (!c || !c.width) return { w: 0, h: 0, colors: 0, filled: 0 };
    const ctx = c.getContext("2d");
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const seen = new Set();
    let filled = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 200) continue;
      filled++;
      seen.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`);
    }
    return { w: c.width, h: c.height, colors: seen.size, filled, ratio: filled / (c.width * c.height) };
  });
  check("캔버스에 크기가 잡혀 있다", painted.w > 200 && painted.h > 120, JSON.stringify([painted.w, painted.h]));
  check("★ 실제로 칠해져 있다", painted.ratio > 0.15, `채워진 비율 ${(painted.ratio * 100).toFixed(1)}%`);
  check("★ 조각마다 색이 다르다", painted.colors >= 8, `색 ${painted.colors}가지`);

  out.push("\n[입체로 보인다 — 아래쪽에 옆면이 있다]");
  // 같은 x 에서 위/아래 색을 비교한다. 옆면은 윗면을 어둡게 칠한 것이라,
  // 두께가 없으면 아래쪽이 그냥 비어 있다.
  const depth = await page.evaluate(() => {
    const c = document.querySelector("#settlementPie");
    const ctx = c.getContext("2d");
    const x = Math.round(c.width / 2);
    let top = null;
    let bottom = null;
    for (let y = 0; y < c.height; y++) {
      const p = ctx.getImageData(x, y, 1, 1).data;
      if (p[3] > 200) { if (top === null) top = [p[0], p[1], p[2]]; bottom = [p[0], p[1], p[2], y]; }
    }
    return { top, bottom };
  });
  const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  check("★ 아래쪽이 위쪽보다 어둡다 (옆면)", depth.top && depth.bottom && lum(depth.bottom) < lum(depth.top) - 5,
    JSON.stringify(depth));

  out.push("\n[숫자는 범례에서 읽힌다]");
  const legend = await page.evaluate(() =>
    [...document.querySelectorAll("#settlementPieLegend .stl-pie-item")].map((el) => ({
      name: el.querySelector(".stl-pie-name").textContent.trim(),
      qty: el.querySelector(".stl-pie-qty").textContent.trim(),
      pct: el.querySelector(".stl-pie-pct").textContent.trim(),
    }))
  );
  check("★ 조각이 너무 많지 않다 (위 8가지 + 기타)", legend.length === 9, `${legend.length}줄`);
  check("★ 나머지는 「기타」로 묶인다", /기타|其他/.test(legend[8].name), legend[8].name);
  check("기타에 몇 가지인지 적힌다", /\(4\)/.test(legend[8].name), legend[8].name);
  check("★ 수량이 글자로 적힌다", /^12/.test(legend[0].qty), legend[0].qty);
  check("★ 퍼센트도 같이 적힌다", legend.every((l) => /%$/.test(l.pct)), JSON.stringify(legend.map((l) => l.pct)));
  const sum = legend.reduce((s, l) => s + parseInt(l.qty, 10), 0);
  check(`★ 수량 합이 실제 판매 수량과 같다 (${sum} = ${totalQty})`, sum === totalQty, `${sum} vs ${totalQty}`);
  check("많이 팔린 순", parseInt(legend[0].qty, 10) >= parseInt(legend[1].qty, 10), JSON.stringify(legend.map((l) => l.qty)));

  out.push("\n[판 것이 없는 날에는 말로 알려준다]");
  await page.fill("#settlementStartDate", "2026-09-01");
  await page.fill("#settlementEndDate", "2026-09-01");
  await page.waitForTimeout(1600);
  const empty = await page.evaluate(() => (document.querySelector("#settlementPieLegend") || {}).textContent || "");
  check("★ 빈 원을 그리지 않고 이유를 적는다", empty.trim().length > 0 && !/NaN/.test(empty), empty.trim().slice(0, 60));

  {
    const fs = require("fs");
    const path = require("path");
    const dir = path.join(__dirname, "..", "..", "..", "_screens");
    fs.mkdirSync(dir, { recursive: true });
    await page.fill("#settlementStartDate", D);
    await page.fill("#settlementEndDate", D);
    await page.waitForTimeout(2000);
    const box = await page.locator(".stl-pie-wrap").boundingBox();
    if (box) await page.screenshot({ path: path.join(dir, "sold-pie-3d.png"), clip: box });
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  await browser.close();
  server.close();
  process.exit(fail === 0 ? 0 : 1);
})();
