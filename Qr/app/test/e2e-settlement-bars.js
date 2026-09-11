// 막대와 그 옆의 퍼센트가 같은 것을 말하는가.
//
// 사장님(2026-09-11): "지금 결산에 퍼센트가 100%가 아닌데 바가 꽉 차있거든?
// 그거 왜 그런거야?"
//
// ── 무엇이었나 ──────────────────────────────────────────────────────
//
// 둘이 서로 다른 자를 쓰고 있었다. 오른쪽 퍼센트는 「전체 중 몇 %」인데
// 막대 길이는 「그 묶음의 1등 대비 몇 %」라서, 1등은 몇 %든 늘 꽉 찼다.
// 현금 59% 옆에도 꽉 찬 막대, 직접 입력 47% 옆에도 꽉 찬 막대.
//
// 눈은 숫자보다 막대를 먼저 읽는다. 그래서 이건 「보기 불편한」 것이 아니라
// **틀리게 읽히는** 것이다 — 절반쯤 걷힌 돈이 전부인 것처럼 보인다.
//
// 이 테스트는 화면에 실제로 그려진 막대의 픽셀을 재서, 그 길이가 옆에 적힌
// 퍼센트와 맞는지 본다. 「1등이니까 꽉 참」이 되살아나면 곧장 걸린다.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-settlement-bars";
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
// 막대가 「1등 대비」이면 이 배치에서 현금 막대가 꽉 찬다(60% 인데도).
// 「전체 대비」이면 60% 만큼만 찬다. 둘을 눈으로 가를 수 있는 배치다.
const PLAN = [
  { pay: "cash", amount: 1000, n: 6 },     // 6,000 = 60%
  { pay: "linepay", amount: 1000, n: 3 },  // 3,000 = 30%
  { pay: "card", amount: 1000, n: 1 },     // 1,000 = 10%
];

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
  const items = store.menuItems;
  const tableNumbers = store.tables.filter((t) => !t.is_counter).map((t) => t.number);
  let id = 730000;
  let hour = 11;
  const rows = [];
  let ti = 0;
  for (const p of PLAN) {
    for (let k = 0; k < p.n; k++) {
      const mi = items[id % items.length];
      const at = `${D} ${String(11 + (ti % 8)).padStart(2, "0")}:${String((ti * 7) % 60).padStart(2, "0")}:00`;
      rows.push({
        _id: ++id, id, table_number: String(tableNumbers[ti % tableNumbers.length]),
        status: "paid", order_type: "dine_in",
        created_at: at, paid_at: at, updated_at: at,
        payment_method: p.pay, party_size: 2, party_adults: 2, party_children: 0,
        subtotal: p.amount, discount_amount: 0, discount_type: null, total: p.amount,
        items: [{
          item_id: mi.id, code: mi.code, name_ko: mi.name_ko, name_zh: mi.name_zh, name_en: mi.name_en,
          qty: 1, unit_price: p.amount, selected_addons: [], option_choice: null, spice_choice: null,
          category_key: (store.categories.find((c) => c.id === mi.category_id) || {}).key || null,
          order_type: "dine_in", paid: true, payment_method: p.pay, paid_at: at, note: "",
        }],
        account_id: null, note: "",
      });
      ti++;
    }
  }
  await getDb().collection("orders").bulkWrite(rows.map((r) => ({ replaceOne: { filter: { _id: r.id }, replacement: r, upsert: true } })));
  store.settings.service_started_at = "2026-09-08 17:00:00";
  await save();
  void hour;

  await page.locator('.admin-tabs button[data-tab="settlement"]').click();
  await page.waitForTimeout(900);
  await page.fill("#settlementStartDate", D);
  await page.fill("#settlementEndDate", D);
  await page.waitForTimeout(1700);
  // 테이블별 막대는 「시간대별 / 테이블별 / 매출 추이」 탭 안에 접혀 있다.
  // 접힌 것은 화면에서 폭이 0 이라 잴 수 없으니 그 탭을 편다.
  await page.locator('.stl-tab[data-pane="whenTable"]').first().click();
  await page.waitForTimeout(600);

  // 화면에 그려진 것을 그대로 읽는다 — style 문자열이 아니라 실제 픽셀 폭.
  const groups = await page.evaluate(() => {
    const ids = ["settlementPaymentMethodBars", "settlementOrderTypeBars", "settlementDiscountBars",
      "settlementCategoryBars", "settlementTableBars"];
    return ids.map((gid) => {
      const el = document.getElementById(gid);
      const bars = el ? [...el.querySelectorAll(".stl-bar-row")] : [];
      return {
        id: gid,
        rows: bars.map((row) => {
          const track = row.querySelector(".stl-bar-track");
          const fill = row.querySelector(".stl-bar-fill");
          const tw = track ? track.getBoundingClientRect().width : 0;
          const fw = fill ? fill.getBoundingClientRect().width : 0;
          return {
            name: (row.querySelector(".stl-bar-name") || {}).textContent || "",
            label: parseFloat(((row.querySelector(".stl-bar-share") || {}).textContent || "0").replace("%", "")),
            drawn: tw > 0 ? Math.round((fw / tw) * 1000) / 10 : 0,
          };
        }),
      };
    });
  });

  const shown = groups.filter((g) => g.rows.length);
  check("막대 묶음이 그려져 있다", shown.length >= 2, JSON.stringify(groups.map((g) => [g.id, g.rows.length])));

  out.push("[막대 길이가 옆에 적힌 퍼센트와 같다]");
  for (const g of shown) {
    for (const r of g.rows) {
      // 0 이 아닌데 안 보이면 안 되므로 최소 2% 는 남긴다 — 작은 항목은
      // 그만큼 여유를 준다.
      const floor = r.label <= 2;
      const ok = floor ? r.drawn <= 3 : Math.abs(r.drawn - r.label) <= 1.5;
      check(`${g.id} · ${r.name.trim().slice(0, 12)} — 적힌 ${r.label}% / 그려진 ${r.drawn}%`, ok,
        `${r.drawn} vs ${r.label}`);
    }
  }

  out.push("\n[100% 가 아닌데 꽉 찬 막대가 없다]");
  // ★ 사장님이 보신 그 증상 그대로.
  const overfull = [];
  for (const g of shown) {
    for (const r of g.rows) {
      if (r.drawn >= 98 && r.label < 98) overfull.push(`${g.id}/${r.name.trim()} ${r.label}% → ${r.drawn}%`);
    }
  }
  check("★ 꽉 찬 막대는 전부 100% 짜리다", overfull.length === 0, overfull.join(" | "));

  out.push("\n[막대가 전부 같은 자리에서 출발한다]");
  // 사장님(2026-09-11): "그래프 바가 시작이 다 같았으면 좋겠어. 지금은 글
  // 길이에 따라 시작 위치가 다르잖아." 줄마다 자기 혼자 grid 라서 이름 칸이
  // 그 줄의 글자 길이에 맞춰졌었다. 시작이 들쭉날쭉하면 막대 길이를 서로
  // 견줄 수가 없다 — 막대를 쓰는 이유가 그건데.
  const starts = await page.evaluate(() => {
    const ids = ["settlementPaymentMethodBars", "settlementOrderTypeBars", "settlementDiscountBars",
      "settlementCategoryBars", "settlementTableBars"];
    return ids.map((gid) => {
      const el = document.getElementById(gid);
      const tracks = el ? [...el.querySelectorAll(".stl-bar-track")] : [];
      const names = el ? [...el.querySelectorAll(".stl-bar-name")].map((n) => n.textContent.trim()) : [];
      return { id: gid, lefts: tracks.map((t) => Math.round(t.getBoundingClientRect().left)), names };
    }).filter((g) => g.lefts.length >= 2);
  });
  check("견줄 묶음이 있다 (이름 길이가 서로 다른)", starts.length >= 1, JSON.stringify(starts.map((g) => g.id)));
  for (const g of starts) {
    const uniq = [...new Set(g.lefts)];
    const lens = g.names.map((n) => n.length);
    check(`★ ${g.id} — ${g.lefts.length}줄이 같은 x 에서 시작 (${uniq.join(", ")})`, uniq.length === 1,
      `${JSON.stringify(g.lefts)} / 이름 길이 ${JSON.stringify(lens)}`);
    // 이름 길이가 다 같으면 이 검사는 아무것도 안 재는 것이다.
    check(`${g.id} — 이름 길이가 서로 다르다 (검사가 헛돌지 않게)`, new Set(lens).size > 1, JSON.stringify(g.names));
  }

  out.push("\n[정해둔 배치대로 나왔는가 — 테스트가 헛돌지 않게]");
  const payRows = shown.find((g) => g.id === "settlementPaymentMethodBars").rows;
  const top = payRows.find((r) => r.label === 60);
  check("현금이 60% 로 적힌다", !!top, JSON.stringify(payRows.map((r) => [r.name.trim(), r.label])));
  // 예전 코드였다면 여기서 100 이 나온다(1등이라서). 이 한 줄이 이 파일의 핵심.
  check("★★ 60% 짜리 막대가 60% 만큼만 찬다", top && Math.abs(top.drawn - 60) <= 1.5, top && String(top.drawn));

  {
    const fs = require("fs");
    const path = require("path");
    const dir = path.join(__dirname, "..", "..", "..", "_screens");
    fs.mkdirSync(dir, { recursive: true });
    const box = await page.locator("#settlementPaymentMethodBars").boundingBox();
    if (box) await page.screenshot({ path: path.join(dir, "settlement-bars.png"), clip: box });
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  await browser.close();
  server.close();
  process.exit(fail === 0 ? 0 : 1);
})();
