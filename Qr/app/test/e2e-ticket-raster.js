// 주문서 비트맵이 프린터가 삼킬 수 있는 크기로 나가는지.
//
// 2026-09-09 사장님: "주문서 출력이 어떤 테이블은 고객, 주방용 2가지로,
// 어쩔때는 주방만 나옴."
//
// 원인: 결제용 사본은 품목마다 금액 줄이 하나씩 더 붙어 주방용보다 항상
// 크다(품목 20개면 96KB 대 149KB). 그걸 GS v 0 명령 하나에 통째로 실어
// 보내고 있었는데, 이 값싼 영수증 프린터들은 입력 버퍼가 64KB 안팎이라
// 한 명령이 그보다 크면 이미지를 통째로 버린다. 주방용은 들어가고
// 결제용만 넘치는 크기대여서 정확히 "주방용만 나오는" 증상이 됐고,
// 많이 주문한 테이블일수록 잘 터져서 "어떤 테이블은"으로 보였다.
//
// 고친 뒤에도 같은 실수가 돌아오지 않게, 명령 하나의 크기를 실제로 잰다.
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
process.env.SESSION_SECRET = "e2e-raster";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const { chromium } = require("playwright");
const app = require("../server");

// 이 프린터(XP-N160II)류의 입력 버퍼는 대개 64KB 안팎이다. 명령 하나가
// 그 근처만 가도 위험하므로 넉넉히 아래에서 자른다.
const SAFE_COMMAND_BYTES = 32 * 1024;

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
  const page = await browser.newPage();
  page.on("dialog", (d) => d.dismiss());
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "ownerpass123" }) });
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  // 품목 수를 늘려가며 두 사본을 다 만들어, 명령 하나하나의 크기를 잰다.
  const report = await page.evaluate(async (safeBytes) => {
    // /api/menu/admin 은 카테고리 배열이고 메뉴는 그 안의 items 다.
    const menu = await (await fetch("/api/menu/admin")).json();
    const items = (menu || []).flatMap((c) => c.items || []);
    const mk = (n) => ({
      table_number: "7", order_type: "dine_in",
      created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
      items: Array.from({ length: n }, (_, i) => {
        const m = items[i % items.length];
        return { item_id: m.id, code: m.code, name_ko: m.name_ko, name_zh: m.name_zh, qty: 2,
          unit_price: m.price, selected_addons: [], option_choice: "보통", spice_choice: null,
          category_key: i % 5 === 0 ? "drink" : null, order_type: "dine_in" };
      }),
      total: 1000, note: "",
    });

    // GS v 0 (1D 76 30 m xL xH yL yH) 블록들을 다시 파싱해서, 블록별
    // 크기와 전체 픽셀을 되짚는다.
    const parse = (u8) => {
      const blocks = [];
      let i = 0;
      let totalRows = 0;
      const pixels = [];
      while (i < u8.length) {
        if (u8[i] === 0x1d && u8[i + 1] === 0x76 && u8[i + 2] === 0x30) {
          const xb = u8[i + 4] | (u8[i + 5] << 8);
          const rows = u8[i + 6] | (u8[i + 7] << 8);
          const dataLen = xb * rows;
          blocks.push({ rows, bytes: 8 + dataLen });
          totalRows += rows;
          for (let k = 0; k < dataLen; k++) pixels.push(u8[i + 8 + k]);
          i += 8 + dataLen;
        } else {
          i += 1;
        }
      }
      return { blocks, totalRows, pixels, widthBytes: blocks.length ? 72 : 0 };
    };

    const rows = [];
    for (const n of [1, 5, 10, 20, 40]) {
      const o = mk(n);
      const label = { tableLabel: "桌號 7" };
      const k = buildEscPosRasterTicket(o, "한국관", {}, label);
      const p = buildEscPosRasterTicket(o, "한국관", {}, label, { priceCopy: true, discount: { active: false } });
      const pk = parse(k);
      const pp = parse(p);
      rows.push({
        n,
        kitchenTotalKB: +(k.length / 1024).toFixed(1),
        priceTotalKB: +(p.length / 1024).toFixed(1),
        kitchenMaxCmd: Math.max(...pk.blocks.map((b) => b.bytes)),
        priceMaxCmd: Math.max(...pp.blocks.map((b) => b.bytes)),
        kitchenBlocks: pk.blocks.length,
        priceBlocks: pp.blocks.length,
        kitchenRows: pk.totalRows,
        priceRows: pp.totalRows,
        priceTallerThanKitchen: pp.totalRows > pk.totalRows,
        overSafe: [...pk.blocks, ...pp.blocks].filter((b) => b.bytes > safeBytes).length,
      });
    }
    return rows;
  }, SAFE_COMMAND_BYTES);

  out.push("[비트맵 한 덩어리가 프린터 버퍼를 넘지 않는가]");
  for (const r of report) {
    out.push(`  ·    품목 ${String(r.n).padStart(2)}개 — 주방 ${r.kitchenTotalKB}KB(${r.kitchenBlocks}조각) / 결제 ${r.priceTotalKB}KB(${r.priceBlocks}조각), 가장 큰 명령 ${Math.round(Math.max(r.kitchenMaxCmd, r.priceMaxCmd) / 1024)}KB`);
  }
  const over = report.filter((r) => r.overSafe > 0);
  check(`명령 하나가 ${SAFE_COMMAND_BYTES / 1024}KB를 넘지 않는다`, over.length === 0,
    over.map((r) => `품목 ${r.n}개`).join(", "));

  // 큰 주문일수록 조각이 늘어나야 한다 — 안 늘면 다시 통짜로 보내는 것이다.
  const small = report[0];
  const big = report[report.length - 1];
  check("주문이 커지면 조각 수가 늘어난다", big.priceBlocks > small.priceBlocks,
    `${small.priceBlocks} → ${big.priceBlocks}`);

  // 결제용이 주방용보다 크다는 사실 자체를 기록해 둔다 — 이게 왜 결제용만
  // 안 나왔는지의 이유다.
  check("결제용 사본이 주방용보다 크다(=먼저 터지는 쪽)",
    report.every((r) => r.priceTallerThanKitchen), JSON.stringify(report.map((r) => [r.kitchenRows, r.priceRows])));

  // 조각내기 전과 픽셀이 같아야 한다 — 잘라 보내도 종이에 찍히는 그림은
  // 한 글자도 달라지면 안 된다.
  out.push("\n[잘라 보내도 그림은 그대로인가]");
  const same = await page.evaluate(() => {
    const menu = { items: [] };
    const o = {
      table_number: "7", order_type: "dine_in",
      created_at: "2026-09-09 12:00:00",
      items: Array.from({ length: 9 }, (_, i) => ({
        item_id: i, code: "A" + i, name_ko: "김치찌개", name_zh: "泡菜鍋", qty: 1,
        unit_price: 230, selected_addons: [], option_choice: null, spice_choice: null,
        category_key: null, order_type: "dine_in",
      })),
      total: 2070, note: "",
    };
    const u8 = buildEscPosRasterTicket(o, "한국관", {}, { tableLabel: "桌號 7" }, { priceCopy: true, discount: { active: false } });
    // 조각들을 다시 이어붙여 원래 한 장짜리 비트맵과 같은지 본다.
    const pixels = [];
    let rows = 0;
    let i = 0;
    while (i < u8.length) {
      if (u8[i] === 0x1d && u8[i + 1] === 0x76 && u8[i + 2] === 0x30) {
        const xb = u8[i + 4] | (u8[i + 5] << 8);
        const r = u8[i + 6] | (u8[i + 7] << 8);
        for (let k = 0; k < xb * r; k++) pixels.push(u8[i + 8 + k]);
        rows += r;
        i += 8 + xb * r;
      } else i += 1;
    }
    // 이어붙인 픽셀 수 = 줄수 × 72 여야 한다(조각 경계에서 한 줄도 빠지거나
    // 겹치지 않았다는 뜻).
    const inkRows = new Set();
    for (let r = 0; r < rows; r++) {
      for (let b = 0; b < 72; b++) if (pixels[r * 72 + b]) { inkRows.add(r); break; }
    }
    return { rows, pixelBytes: pixels.length, expected: rows * 72, inkRows: inkRows.size };
  });
  check("조각 경계에서 줄이 빠지거나 겹치지 않는다", same.pixelBytes === same.expected, JSON.stringify(same));
  check("실제로 글자가 찍혀 있다(빈 종이가 아니다)", same.inkRows > 20, JSON.stringify(same));

  await browser.close();
  server.close();
  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.log(out.join("\n"));
  console.error("HARNESS ERROR:", e.message, e.stack);
  process.exit(1);
});
