// 영수증 부가세 5% — 이미 포함 · +5% 더하기 · 없음 (2026-10-21, src/ingredientVat.js).
//
// 사장님: "영수증의 부가세 첨부 방법이 업체들마다 다른데, 대만의 부가세는 5%래. 1. 합계금액의 5%를 넣는 업체
// 2. 각 항목마다 5%를 넣는 업체 3. 월말에 한꺼번에 5% 청구하는 업체 4. 부가세가 아예 없는 업체 … 체크해서
// 정확한 금액이 산정될 수 있도록 해야함."
//
// 재는 것은 **장부 합계가 맞는가**다 — 「+5%」로 고른 영수증은 한눈에 보기·업체별·월 결산 어디서 세든 5% 가
// 더해져 있어야 하고, 고친 뒤(다시 저장·되돌리기·엑셀 가져오기)에도 5% 가 남거나 두 번 붙으면 안 된다.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};
process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-receipt-vat";
process.env.ADMIN_PASSWORD = "ownerpass123";

const { launchBrowser } = require("./browser");
const app = require("../server");

let pass = 0, fail = 0;
const out = [];
const check = (name, cond, extra = "") => {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
};
const PHOTO = "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAXklEQVR4nO3PMQ0AMAzAsPInvYLYYVWKESTzjhsd8KsBrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BbQHKU9LC7/CP1AAAAABJRU5ErkJggg==";
const photoFile = (name) => ({ name, mimeType: "image/png", buffer: Buffer.from(PHOTO, "base64") });

(async () => {
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 }, timezoneId: "Asia/Taipei" });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "ownerpass123" }) });
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const api = (url, method, body) => page.evaluate(async ([u, m, b]) => {
    const r = await fetch(u, { method: m || "GET", headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, [url, method, body]);
  const total = async (q) => (await api("/api/ingredients/summary?all=1" + (q || ""))).body.total;
  const rowsOf = async (date, vendor) => (await api(`/api/ingredients/rows?start=${date}&end=${date}&vendor=${encodeURIComponent(vendor)}&limit=50`)).body.rows;

  await page.locator('.admin-tabs button[data-tab="ingredients"]').click();
  await page.waitForTimeout(900);
  await page.locator('[data-ing-view="check"]').click();
  await page.waitForTimeout(400);

  const V = "房信菓菜行";
  const D1 = "2026-10-01";
  // 장부에 업체가 있어야 붙여넣은 이름이 맞춰진다
  await api("/api/ingredients/rows", "POST", { store: "main", date: "2026-09-01", vendor: V, lines: [{ name: "蔥", qty: 1, unit: "斤", price: 10, amount: 10 }], vat: "none" });

  out.push("[영수증 확인 — 표 밑에 부가세 셋 중 하나]");
  const paste = (date, total, rows) => "```json\n" + JSON.stringify({ vendor: V, date, store: "main", total, rows }) + "\n```";
  await page.setInputFiles("#ingInboxFile", [photoFile("vat-1.png")]);
  await page.waitForTimeout(1500);
  let inbox = (await api("/api/ingredients/inbox")).body.items;
  const id1 = inbox.find((i) => i.name === "vat-1.png").id;
  // 종이 合計 1,050 = 줄 합계 1,000 + 5% — 1항 업체인데 부가세 줄이 표에 안 들어온 경우
  await api(`/api/ingredients/inbox/${id1}/read`, "POST", { text: paste(D1, 1050, [
    { name: "紅蘿蔔", qty: 20, unit: "斤", price: 30, amount: 600, sure: true },
    { name: "洋蔥", qty: 20, unit: "斤", price: 20, amount: 400, sure: true },
  ]) });
  await page.evaluate(() => window.HG_ADMIN && window.HG_ADMIN.reloadIngredients && window.HG_ADMIN.reloadIngredients());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.locator('.admin-tabs button[data-tab="ingredients"]').click();
  await page.waitForTimeout(900);
  await page.locator('[data-ing-view="check"]').click();
  await page.waitForTimeout(600);
  const fold = page.locator("#ingInboxFold");
  if (await fold.isVisible() && (await page.locator("#ingInboxBody").evaluate((el) => el.hidden))) { await fold.click(); await page.waitForTimeout(300); }
  await page.locator(`.ing-inbox-row[data-inbox="${id1}"] [data-inbox-use]`).click();
  await page.waitForTimeout(1500);
  check("★★ 부가세 칸에 셋(이미 포함 · +5% 더하기 · 없음)", (await page.locator("#ingVatOpts [data-vat]").count()) === 3, "");
  const note0 = await page.locator("#ingVatNote").innerText();
  check("★ 처음엔 안 골랐다고 말한다", /아직 안 골랐어요/.test(note0), note0);
  check("★★ 종이 합계가 딱 5% 많으면 「부가세가 표에 안 들어온 것 같아요」", /딱 5% 많아요/.test(note0) && /1,050/.test(note0), note0);
  await page.locator('#ingVatOpts [data-vat="add"]').click();
  await page.waitForTimeout(200);
  const note1 = await page.locator("#ingVatNote").innerText();
  check("★★ 「+5% 더하기」 — 장부에 들어갈 돈 1,050 = 1,000 + 50", /1,050/.test(note1) && /1,000/.test(note1) && /50/.test(note1) && !/딱 5%/.test(note1), note1);
  await page.locator("#ingEntrySave").click();
  await page.waitForTimeout(400);
  if (await page.locator("#appDialogBackdrop").isVisible()) await page.locator("#appDialogOk").click();
  await page.waitForTimeout(1800);
  let rows = await rowsOf(D1, V);
  const vatRow = rows.find((r) => r.vat);
  check("★★ 장부에 「營業稅 5%」 줄이 붙는다 (50)", !!vatRow && vatRow.amount === 50 && /營業稅/.test(vatRow.name), JSON.stringify(rows.map((r) => [r.name, r.amount])));
  check("★★ 한눈에 보기 합계에 5% 가 들어간다 (10 + 1,050)", (await total()) === 1060, String(await total()));
  check("★ 업체별에도 같은 돈", ((await api("/api/ingredients/summary?all=1")).body.vendors.find((v) => v.vendor === V) || {}).amount === 1060, "");
  const cat = (await api(`/api/ingredients/catalog?vendor=${encodeURIComponent(V)}`)).body.items || [];
  check("★ 부가세 줄은 품목 고르는 목록에 안 나온다", !cat.some((x) => /營業稅/.test(x.name)), JSON.stringify(cat.map((x) => x.name)));

  out.push("\n[저장됨 줄에서 고쳐 고른다]");
  inbox = (await api("/api/ingredients/inbox")).body.items;
  const saved1 = inbox.find((i) => i.id === id1);
  check("★ 저장됨 줄이 부가세를 안다", saved1 && saved1.vat === "add", JSON.stringify(saved1 && saved1.vat));
  await page.locator('[data-inbox-tab="saved"]').click().catch(() => {});
  await page.waitForTimeout(400);
  const chip = page.locator(`.ing-inbox-row[data-inbox="${id1}"] [data-inbox-vat]`);
  check("★★ 저장됨 줄에 「부가세: +5% 더하기」", /\+5%/.test(await chip.innerText()), await chip.innerText());
  await chip.click();
  await page.waitForTimeout(200);
  await page.locator(`#vat-${id1} [data-vat-mode="none"]`).click();
  await page.waitForTimeout(1500);
  rows = await rowsOf(D1, V);
  check("★★ 「없음」으로 고치면 5% 줄이 빠진다", !rows.some((r) => r.vat) && (await total()) === 1010, `${await total()}`);
  // 저장됨 줄에서 고르면 업체 기억도 따라 바뀐다(「없음」) — 다시 「+5%」로, 업체 기억까지
  const back = await api("/api/ingredients/vat", "POST", { store: "main", date: D1, vendor: V, mode: "add", remember: true });
  check("되돌려 고르면 5% 가 다시 붙는다", back.body.amount === 50, JSON.stringify(back.body));

  out.push("\n[고쳐도 5% 가 맞는다 — 다시 저장 · 엑셀 가져오기 · 되돌리기]");
  await api("/api/ingredients/rows", "POST", { store: "main", date: D1, vendor: V, lines: [{ name: "紅蘿蔔", qty: 40, unit: "斤", price: 30, amount: 1200 }] });
  rows = await rowsOf(D1, V);
  check("★★ 다시 저장하면 그 영수증의 값을 지키고 5% 를 다시 센다 (1,200 → 60)", rows.filter((r) => r.vat).length === 1 && rows.find((r) => r.vat).amount === 60, JSON.stringify(rows.map((r) => [r.name, r.amount])));
  const imp = await api("/api/ingredients/import", "POST", { store: "main", rows: [{ date: D1, name: "紅蘿蔔", qty: 40, unit: "斤", price: 30, amount: 1200, vendor: V }] });
  rows = await rowsOf(D1, V);
  check("★★ 엑셀로 그 날짜를 다시 가져와도 5% 줄이 한 번만 남는다", imp.status === 200 && rows.filter((r) => r.vat).length === 1 && rows.find((r) => r.vat).amount === 60, JSON.stringify(rows.map((r) => [r.name, r.amount])));

  const un = await api(`/api/ingredients/inbox/${id1}/unsave`, "POST", { force: true });
  rows = await rowsOf(D1, V);
  check("★★ 되돌리면 그 영수증 줄과 함께 5% 줄도 빠진다(5% 만 남지 않는다)", un.status === 200 && rows.length === 0, JSON.stringify(rows.map((r) => [r.name, r.amount])));
  await api("/api/ingredients/rows", "POST", { store: "main", date: D1, vendor: V, lines: [{ name: "紅蘿蔔", qty: 40, unit: "斤", price: 30, amount: 1200 }] });
  check("다시 넣으면 그 영수증에 고른 값(+5%)이 그대로", (await rowsOf(D1, V)).some((r) => r.vat && r.amount === 60), "");

  out.push("\n[업체 기억 — 다음 영수증은 그 값으로 시작한다]");
  await page.locator('[data-entry-mode="manual"]').click();
  await page.waitForTimeout(400);
  await page.locator("#ingEntryDate").fill("2026-10-05");
  await page.locator("#ingEntryVendor").fill(V);
  await page.locator("#ingEntryVendor").dispatchEvent("change");
  await page.waitForTimeout(800);
  const on = await page.locator("#ingVatOpts .is-on").getAttribute("data-vat").catch(() => null);
  check("★★ 같은 업체를 적으면 「+5% 더하기」가 골라져 있다", on === "add", String(on));
  check("★ 전에 고른 값이라고 말한다", /전에 고른 값/.test(await page.locator("#ingVatNote").innerText()), await page.locator("#ingVatNote").innerText());
  const r2 = await api("/api/ingredients/rows", "POST", { store: "main", date: "2026-10-06", vendor: V, lines: [{ name: "洋蔥", qty: 10, unit: "斤", price: 20, amount: 200 }] });
  check("★★ 고르지 않고 저장해도 업체 기억값(+5%)이 붙는다", r2.body.vat === "add" && r2.body.vat_amount === 10, JSON.stringify(r2.body));
  const other = await api("/api/ingredients/rows", "POST", { store: "main", date: "2026-10-06", vendor: "韓濟", lines: [{ name: "豆腐", qty: 1, unit: "盒", price: 30, amount: 30 }] });
  check("★ 다른 업체는 안 고른 채(5% 없음)", other.body.vat === null && other.body.vat_amount === 0, JSON.stringify(other.body));

  out.push("\n[월 결산의 식자재도 5% 를 센다]");
  const per = await api("/api/settlements/period?key=2026-10");
  const ing = per.body && per.body.ingredients && per.body.ingredients.total;
  check("★★ 10월 식자재 = 1,260 + 210 + 30", ing === 1500, JSON.stringify(per.body && per.body.ingredients));

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
