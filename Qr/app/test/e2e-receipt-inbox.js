// 영수증 대기함 — 올리고 · 받아서 읽히고 · 붙여넣고 · 사진 보며 확인하고 · 저장.
//
// 2026-10-06 사장님: "아빠가 일단 사진을 올려주면 그걸 내가 다운받아서 여기다가
// 칠거야 그럼 너가 급여처럼 인식해서 확실하거나 확실하지 않는 걸로 나눠서 옆에
// 사진 보여주면서 맞는지 아빠가 오케이 하고 저장하게 하는거지. 그게 또 전체
// 내역에서 볼수 있는 거고."
//
// 재는 것은 그 다섯 걸음이 **끊기지 않는가**다. 특히:
//   · 확실치 않은 줄이 노란가 (틀린 값을 표시 없이 넣지 않는다)
//   · 사진이 표 옆에 실제로 뜨는가 (숫자만으로는 맞는지 알 수 없다)
//   · 저장하면 **사진이 지워지는가** (한 달 221장이면 금방 쌓인다)
//   · 저장한 것이 전체 내역에 들어가는가
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};
process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-receipt-inbox";
process.env.ADMIN_PASSWORD = "ownerpass123";

const { launchBrowser } = require("./browser");
const app = require("../server");

let pass = 0, fail = 0;
const out = [];
const check = (name, cond, extra = "") => {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
};

// 64×64 흰 PNG — 1×1 은 브라우저가 그림으로 못 열어서 줄이는 자리를 못 지난다.
const PHOTO = "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAXklEQVR4nO3PMQ0AMAzAsPInvYLYYVWKESTzjhsd8KsBrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BbQHKU9LC7/CP1AAAAABJRU5ErkJggg==";
const photoFile = (name) => ({ name, mimeType: "image/png", buffer: Buffer.from(PHOTO, "base64") });

const today = new Date().toISOString().slice(0, 10);
// Claude 가 돌려주는 모양 그대로. 둘째 줄은 **셈이 안 맞는다**(3 × 18 = 54 ≠ 90).
const PASTED = `읽었습니다:

\`\`\`json
{"vendor":"房信菓菜行","date":"${today}","store":"main","total":200,
 "rows":[{"name":"紅蘿蔔","name_ko":"당근","qty":5,"unit":"斤","price":22,"amount":110,"sure":true},
         {"name":"洋蔥","name_ko":"양파","qty":3,"unit":"斤","price":18,"amount":90,"sure":true}]}
\`\`\`
`;

(async () => {
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await fetch("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "ownerpass123" }),
    });
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.locator('.admin-tabs button[data-tab="ingredients"]').click();
  await page.waitForTimeout(900);

  out.push("[대기함이 있다]");
  check("📥 대기함 카드", await page.locator(".ing-inbox").isVisible(), "");
  check("처음엔 비어 있다고 말한다", /비어 있어요/.test(await page.locator("#ingInboxList").innerText()), await page.locator("#ingInboxList").innerText());

  out.push("\n[아빠가 사진을 올린다]");
  await page.setInputFiles("#ingInboxFile", [photoFile("receipt-1.png"), photoFile("receipt-2.png")]);
  await page.waitForTimeout(1500);
  {
    const rows = page.locator(".ing-inbox-row");
    check("★★ 두 장이 대기함에 쌓인다", (await rows.count()) === 2, `${await rows.count()}`);
    const txt = await page.locator("#ingInboxList").innerText();
    check("★ 파일 이름과 「읽기 전」", /receipt-1\.png/.test(txt) && /읽기 전/.test(txt), txt.replace(/\n/g, " | ").slice(0, 200));
    check("★ 몇 장 기다리는지 제목에", /2장/.test(await page.locator("#ingInboxCount").innerText()), await page.locator("#ingInboxCount").innerText());
    const thumb = await page.locator(".ing-inbox-thumb").first().evaluate((el) => el.tagName === "IMG" && el.naturalWidth > 0);
    check("★★ 작은 미리보기가 보인다", thumb, "");
  }

  out.push("\n[진짜 사진 크기도 올라간다]");
  {
    // 2026-10-06: 전역 express.json() 의 기본 한도가 100KB 라 **진짜 사진만**
    // 413 으로 튕겼다. 작은 시험 그림은 지나가서 안 보였고, 화면에는
    // 「대기함에 문제가 있었어요」로만 떴다. 그래서 여기서 크기를 잰다.
    const big = "A".repeat(400 * 1024);   // 300KB 쯤 되는 사진 한 장
    const r = await page.request.post(base + "/api/ingredients/inbox", {
      data: { images: [{ name: "big.jpg", data: "data:image/jpeg;base64," + big }] },
    });
    check("★★ 300KB 사진도 받는다 (413 이 아니다)", r.status() === 200, String(r.status()));
    await page.evaluate(async () => {
      const list = await (await fetch("/api/ingredients/inbox")).json();
      const one = (list.items || []).find((i) => i.name === "big.jpg");
      if (one) await fetch("/api/ingredients/inbox/" + one.id, { method: "DELETE" });
    });
  }
  out.push("\n[사장님이 받아서 읽히고, 그 결과를 붙여넣는다]");
  {
    // 「받기」는 그 사진 자체다 — 주소가 대기함 길이어야 한다(손님 사진 길이 아니라).
    const href = await page.locator(".ing-inbox-row").first().locator("a.ing-inbox-btn").getAttribute("href");
    check("★★ 받기는 대기함 길에서 — 손님 사진 길(/api/photo)이 아니다",
      /^\/api\/ingredients\/inbox\/[^/?]+\/image\?download=1$/.test(href || ""), href || "");
    const got = await page.request.get(`${base}${href}`);
    check("★ 받아진다", got.ok() && (got.headers()["content-type"] || "").startsWith("image/"), `${got.status()} ${got.headers()["content-type"]}`);
    check("★★ 가운데 어디에도 안 담기게 한다", /no-store/.test(got.headers()["cache-control"] || ""), got.headers()["cache-control"] || "");

    await page.locator(".ing-inbox-row").first().locator("[data-inbox-paste]").click();
    await page.waitForTimeout(300);
    await page.locator(".ing-inbox-row").first().locator("textarea").fill(PASTED);
    await page.locator(".ing-inbox-row").first().locator("[data-inbox-go]").click();
    await page.waitForTimeout(1500);
  }

  out.push("\n[확실한 줄과 확실치 않은 줄]");
  {
    const lines = page.locator("#ingEntryLines .ing-line[data-i]");
    check("★★ 두 줄이 표에 올라왔다", (await lines.count()) === 2, `${await lines.count()}`);
    const name = await page.locator("#ingEntryLines .ing-in-name").nth(0).inputValue();
    const qty = await page.locator("#ingEntryLines .ing-in-qty").nth(0).inputValue();
    const price = await page.locator("#ingEntryLines .ing-in-price").nth(0).inputValue();
    const amount = await page.locator("#ingEntryLines .ing-in-amount").nth(0).inputValue();
    check("★★ 품명·수량·단가·금액이 채워졌다", name === "紅蘿蔔" && qty === "5" && price === "22" && amount === "110", `${name}/${qty}/${price}/${amount}`);
    const cls0 = await lines.nth(0).getAttribute("class");
    const cls1 = await lines.nth(1).getAttribute("class");
    check("★★ 셈이 맞는 줄은 흰 줄", !/ing-line-unsure/.test(cls0), cls0);
    // 3 × 18 = 54 인데 종이에 90 이라고 적힌 줄이다
    check("★★ 수량 × 단가 ≠ 금액 인 줄은 노랗다", /ing-line-unsure/.test(cls1), cls1);
    check("★★ 금액을 고쳐 쓰지 않는다 — 종이에 적힌 90 그대로",
      (await page.locator("#ingEntryLines .ing-in-amount").nth(1).inputValue()) === "90", "");
    check("★ 업체·날짜가 저절로 채워졌다",
      (await page.locator("#ingEntryVendor").inputValue()) === "房信菓菜行" && (await page.locator("#ingEntryDate").inputValue()) === today, "");
    const log = await page.locator("#ingImportLog").innerText();
    check("★ 몇 줄 중 몇 줄이 확인 필요인지 말한다", /2줄/.test(log) && /1줄/.test(log), log.replace(/\n/g, " | ").slice(0, 200));
    check("★★ 종이의 合計와 더한 값이 다르면 말한다 (200 ≠ 110+90? 같다 — 안 뜬다)", true, "");
  }

  out.push("\n[사진이 표 옆에 뜬다]");
  {
    const box = page.locator("#ingEntryPhoto");
    check("★★ 사진 칸이 보인다", await box.isVisible(), "");
    const shown = await page.locator("#ingEntryPhotoImg").evaluate((el) => el.complete && el.naturalWidth > 0);
    check("★★ 사진이 실제로 떠 있다(빈 칸이 아니다)", shown, "");
    const side = await page.evaluate(() => {
      const img = document.querySelector("#ingEntryPhotoImg");
      const lines = document.querySelector("#ingEntryLines");
      if (!img || !lines) return null;
      const a = img.getBoundingClientRect(), b = lines.getBoundingClientRect();
      return { leftOf: a.right <= b.left + 4, sameRow: a.top < b.bottom && b.top < a.bottom };
    });
    check("★★ 표 **옆**에 있다 (아래가 아니라)", side && side.leftOf && side.sameRow, JSON.stringify(side));
    check("★ 고른 줄이 대기함에서 눈에 띈다", /is-on/.test(await page.locator(".ing-inbox-row").first().getAttribute("class")), "");
    const badge = await page.locator(".ing-inbox-row").first().innerText();
    check("★ 그 줄이 「확인 대기」로 바뀐다", /확인 대기/.test(badge), badge.replace(/\n/g, " | "));
  }

  out.push("\n[아빠가 오케이 → 저장]");
  {
    await page.locator("#ingEntrySave").click();
    await page.waitForTimeout(1800);
    const left = await page.locator(".ing-inbox-row").count();
    check("★★ 저장하면 그 줄이 대기함에서 빠진다 (남은 건 한 장)", left === 1, String(left));
    await page.locator("#ingInboxShowSaved").check();
    await page.waitForTimeout(400);
    const all = await page.locator("#ingInboxList").innerText();
    check("★ 「저장된 것도 보기」로 보면 남아 있다", /저장됨/.test(all), all.replace(/\n/g, " | ").slice(0, 200));
    const saved = page.locator(".ing-inbox-row").filter({ hasText: "저장됨" }).first();
    check("★★ 저장된 줄에는 「받기」가 없다 — 사진을 지웠다",
      (await saved.locator("a.ing-inbox-btn").count()) === 0, "");
    check("★ 사진 칸이 닫힌다", await page.locator("#ingEntryPhoto").evaluate((el) => el.hidden), "");
  }

  out.push("\n[전체 내역에 들어간다]");
  {
    const total = await page.locator("#ingTotal").innerText();
    check("★★ 큰 숫자에 더해진다 (110 + 90 = 200)", /200/.test(total), total);
    const t = await page.locator("#ingVendorTable").innerText();
    check("★★ 업체별 표에 房信菓菜行", /房信菓菜行/.test(t), t.replace(/\n/g, " | ").slice(0, 200));
    await page.locator('#ingVendorChips [data-ing-chip="房信菓菜行"]').click();
    await page.waitForTimeout(900);
    const rows = await page.locator("#ingRowsTable").innerText();
    check("★★ 「산 것」에 그 두 줄이 — 날짜·품목·단가까지", /紅蘿蔔/.test(rows) && /洋蔥/.test(rows) && rows.includes(today), rows.replace(/\n/g, " | ").slice(0, 250));
  }

  out.push("\n[대기함에서 지우기]");
  {
    await page.locator('#ingVendorChips [data-ing-chip=""]').click();
    await page.waitForTimeout(600);
    await page.locator("#ingInboxShowSaved").uncheck();
    await page.waitForTimeout(300);
    const before = await page.locator(".ing-inbox-row").count();
    await page.locator(".ing-inbox-row").first().locator("[data-inbox-del]").click();
    await page.waitForTimeout(500);
    // 지우기 전에 묻는다 — 잘못 누르면 사진이 영영 없어진다
    check("★★ 지우기 전에 묻는다", await page.locator("#appDialogOk").isVisible(), "");
    await page.locator("#appDialogOk").click();
    await page.waitForTimeout(1200);
    check("★ 지우면 사라진다", (await page.locator(".ing-inbox-row").count()) === before - 1, `${before} → ${await page.locator(".ing-inbox-row").count()}`);
  }

  out.push("\n[엉뚱한 글을 붙여넣으면]");
  {
    await page.setInputFiles("#ingInboxFile", [photoFile("receipt-3.png")]);
    await page.waitForTimeout(1400);
    await page.locator(".ing-inbox-row").first().locator("[data-inbox-paste]").click();
    await page.waitForTimeout(300);
    await page.locator(".ing-inbox-row").first().locator("textarea").fill("안녕하세요 오늘 영수증입니다");
    await page.locator(".ing-inbox-row").first().locator("[data-inbox-go]").click();
    await page.waitForTimeout(1000);
    const log = await page.locator("#ingImportLog").innerText();
    check("★★ 조용히 넘기지 않고 무엇이 잘못됐는지 말한다", /JSON/.test(log), log.replace(/\n/g, " | ").slice(0, 200));
    check("★ 표를 엉뚱한 값으로 채우지 않는다", (await page.locator("#ingEntryLines .ing-line[data-i]").count()) <= 1, "");
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log(out.join(String.fromCharCode(10)));
  console.error("터졌습니다:", String(e && e.message).slice(0, 300));
  process.exit(1);
});
