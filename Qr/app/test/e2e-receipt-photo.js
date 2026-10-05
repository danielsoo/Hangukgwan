// 영수증 사진을 올리면 표가 채워진다 (public/js/receipt-read.js + ingredients.js).
//
// 2026-10-05 사장님: "영수증을 올리면 가격 품목 어디서 언제 샀는지를 내가 직접
// 타자로 쳐서 하나하나 입력하는 게 아니라 적용되도록 하려는건데."
//
// 재는 것은 **얼마나 잘 읽는가가 아니다.** 그건 test/receipt-ocr.test.js 와 진짜
// 사진 120장 측정이 맡는다(사장님 장부가 들어가므로 저장소에 사진을 안 넣는다).
// 여기서 재는 것은 **읽은 뒤에 사장님이 보시는 것**이다:
//
//   · 읽은 값이 실제로 칸에 들어가는가
//   · 확실치 않은 줄이 **노랗게** 보이는가 — 「틀린 값을 표시 없이 넣지 않는다」
//   · 종이에서 잘라낸 **그림이 숫자 옆에** 뜨는가 (숫자 하나를 88% 로 읽으니
//     세 자리 금액은 68% 다. 그림이 없으면 사장님은 종이를 다시 찾아 짚어야 한다)
//   · 금액을 다시 셈해서 덮어쓰지 않는가 (종이에 적힌 금액이 맞다)
//   · 저장이 그 값으로 가는가
//   · 표를 못 찾은 사진을 **조용히 넘기지 않는가**
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};
process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "e2e-receipt-photo";
process.env.ADMIN_PASSWORD = "ownerpass123";

const { launchBrowser } = require("./browser");
const app = require("../server");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

// 1×1 투명 PNG. 사진을 고르는 길만 지나가게 하려는 것이고, 읽는 것은 아래에서
// 값을 정해 놓고 부른다.
const TINY = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const tinyFile = (name) => ({ name, mimeType: "image/png", buffer: Buffer.from(TINY, "base64") });

(async () => {
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "ownerpass123" }),
    });
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  out.push("[읽는 코드가 화면에 붙어 있다]");
  {
    const got = await page.evaluate(() => ({
      ocr: !!(window.HG_RECEIPT && window.HG_RECEIPT.readRow && window.HG_RECEIPT.labelColumns),
      digits: !!(window.HG_RECEIPT_DIGITS && window.HG_RECEIPT_DIGITS.classify),
      count: window.HG_RECEIPT_DIGITS ? window.HG_RECEIPT_DIGITS.count : 0,
      read: !!(window.HG_RECEIPT_READ && window.HG_RECEIPT_READ.readPhoto),
    }));
    check("표 찾는 코드가 실려 있다", got.ocr, JSON.stringify(got));
    check("★ 영수증 글씨 판별기가 실려 있다 (견본 400개)", got.digits && got.count === 400, `${got.count}`);
    check("사진 읽는 코드가 실려 있다", got.read, "");
  }

  const tab = page.locator('.admin-tabs button[data-tab="ingredients"]');
  check("사장님 화면에 식자재 탭", await tab.isVisible(), "");
  await tab.click();
  await page.waitForTimeout(600);

  out.push("\n[📷 로 고르거나 끌어다 놓는다]");
  check("📷 영수증 사진 단추가 있다", await page.locator("#ingPhotoBtn").isVisible(), "");
  check(
    "사진 고르는 칸은 여러 장을 받는다",
    await page.locator("#ingPhotoFile").evaluate((el) => el.multiple && /image/.test(el.accept)),
    ""
  );
  {
    // 2026-10-04 사장님: "급여에서 사진 선택 말고도 드래그로 할 수 있게 해줘"
    const hint = await page.locator('#tab-ingredients [data-i18n="ingPhotoHint"]').innerText();
    check("★ 끌어다 놓을 수 있다고 적혀 있다", /끌어다 놓/.test(hint), hint);
    check("★★ 사진이 기기 밖으로 안 나간다고 적혀 있다", /기기 밖으로 나가지 않/.test(hint), hint);
  }

  out.push("\n[읽은 값이 칸에 들어간다]");
  // 읽는 코드 자체는 유닛 시험이 재므로, 여기서는 **읽은 뒤**를 재려고 값을
  // 정해 놓고 부른다. 한 줄은 「확실하다」, 한 줄은 「확실치 않다」.
  await page.evaluate((px) => {
    window.HG_RECEIPT_READ.readPhoto = async () => ({
      receipts: [{
        rows: [
          { qty: 3, price: 25, amount: 75, ok: true, fixed: false, certainty: 0.97,
            pic: { name: px, qty: px, price: px, amount: px } },
          { qty: 0.5, price: 90, amount: 45, ok: false, fixed: true, certainty: 0.46,
            pic: { name: px, qty: px, price: px, amount: px } },
        ],
      }],
      note: "",
    });
  }, `data:image/png;base64,${TINY}`);
  await page.setInputFiles("#ingPhotoFile", tinyFile("receipt.png"));
  await page.waitForTimeout(700);
  {
    const lines = page.locator("#ingEntryLines .ing-line[data-i]");
    check("★★ 두 줄이 들어왔다", (await lines.count()) === 2, `${await lines.count()}`);
    const qty = await page.locator("#ingEntryLines .ing-in-qty").nth(0).inputValue();
    const price = await page.locator("#ingEntryLines .ing-in-price").nth(0).inputValue();
    const amount = await page.locator("#ingEntryLines .ing-in-amount").nth(0).inputValue();
    check("★★ 수량·단가·금액이 채워졌다 (3 · 25 · 75)",
      qty === "3" && price === "25" && amount === "75", `${qty}/${price}/${amount}`);
    // 종이에는 0.5 를 「半斤」이라고 한자로 쓴다 — 금액 ÷ 단가로 구한 값이다
    const q2 = await page.locator("#ingEntryLines .ing-in-qty").nth(1).inputValue();
    check("★★ 반 근(0.5)도 들어간다 — 금액 ÷ 단가로 구한 값", q2 === "0.5", q2);
    // 금액을 다시 셈해서 덮지 않는다. 수량을 2 로 바꿔도 종이의 45 가 남아야 한다.
    await page.fill("#ingEntryLines .ing-in-qty >> nth=1", "2");
    await page.dispatchEvent("#ingEntryLines .ing-in-qty >> nth=1", "change");
    await page.waitForTimeout(300);
    const after = await page.locator("#ingEntryLines .ing-in-amount").nth(1).inputValue();
    check("★★ 종이에 적힌 금액을 다시 셈해서 덮지 않는다", String(after) === "45", after);
  }

  out.push("\n[확실치 않은 줄은 노랗다]");
  {
    const cls0 = await page.locator("#ingEntryLines .ing-line[data-i]").nth(0).getAttribute("class");
    const cls1 = await page.locator("#ingEntryLines .ing-line[data-i]").nth(1).getAttribute("class");
    check("★★ 확실한 줄은 그냥 흰 줄", !/ing-line-unsure/.test(cls0), cls0);
    check("★★ 확실치 않은 줄은 노란 줄", /ing-line-unsure/.test(cls1), cls1);
    const bg = await page.locator("#ingEntryLines .ing-line-unsure").first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    check("★ 노란 줄은 실제로 색이 다르다", bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent", bg);
  }

  out.push("\n[종이에서 잘라낸 그림이 숫자 옆에 뜬다]");
  {
    const pics = page.locator("#ingEntryLines .ing-pic");
    check("★★ 줄마다 품명·수량·단가·금액 네 칸의 그림 (2줄 × 4 = 8)",
      (await pics.count()) === 8, `${await pics.count()}`);
    const h = await pics.first().evaluate((el) => el.getBoundingClientRect().height);
    check("★ 그림이 눈에 보일 만큼 크다 (20점 이상)", h >= 20, `${h}`);
    const near = await page.locator("#ingEntryLines .ing-line[data-i]").nth(0).evaluate((el) => {
      const inp = el.querySelector(".ing-in-price");
      const img = inp && inp.parentElement.querySelector(".ing-pic");
      if (!inp || !img) return null;
      const a = inp.getBoundingClientRect(), b = img.getBoundingClientRect();
      return { gap: b.top - a.bottom, sameCol: Math.abs(a.left - b.left) < 30 };
    });
    check("★★ 단가 그림이 단가 칸 바로 밑에 있다",
      near && near.sameCol && near.gap >= 0 && near.gap < 20, JSON.stringify(near));
  }

  out.push("\n[읽은 줄 수를 말해준다]");
  {
    const log = await page.locator("#ingImportLog").innerText();
    check("★ 몇 줄 채웠고 몇 줄이 확실치 않은지 적는다", /2줄/.test(log) && /1줄/.test(log), log.slice(0, 160));
  }

  out.push("\n[표를 못 찾으면 조용히 넘기지 않는다]");
  {
    // 2026-09-10 에 자동 인쇄가 조용히 아무 일도 안 해서 세 번 헤맸다. 같은
    // 잘못을 안 하도록, 못 읽은 사진은 **말을 해야** 한다.
    await page.evaluate(() => {
      window.HG_RECEIPT_READ.readPhoto = async () => ({ receipts: [], note: "no-table" });
    });
    await page.setInputFiles("#ingPhotoFile", tinyFile("blurry.png"));
    await page.waitForTimeout(600);
    const log = await page.locator("#ingImportLog").innerText();
    check("★★ 못 읽었다고 말한다", /표를 못 찾/.test(log), log.slice(0, 200));
    check("★ 어떻게 하면 되는지도 말한다 (스캐너)", /스캐너/.test(log), log.slice(0, 200));
  }

  out.push("\n[저장은 읽은 값 그대로]");
  {
    await page.fill("#ingEntryVendor", "房信菓菜行");
    await page.dispatchEvent("#ingEntryVendor", "change");
    await page.fill("#ingEntryDate", "2026-10-05");
    await page.waitForTimeout(400);
    // 품명은 읽지 않는다(한자 손글씨) — 사장님이 고르신다
    await page.fill("#ingEntryLines .ing-in-name >> nth=0", "紅蘿蔔");
    await page.dispatchEvent("#ingEntryLines .ing-in-name >> nth=0", "change");
    await page.waitForTimeout(300);
    const sent = await page.evaluate(async () => {
      let body = null;
      const real = window.fetch;
      window.fetch = async (u, o) => {
        if (String(u).includes("/api/ingredients/rows") && o && o.method === "POST") {
          body = JSON.parse(o.body);
          return new Response(JSON.stringify({ saved: 1 }), { status: 200 });
        }
        return real(u, o);
      };
      document.getElementById("ingEntrySave").click();
      await new Promise((r) => setTimeout(r, 700));
      window.fetch = real;
      return body;
    });
    const l = sent && sent.lines && sent.lines[0];
    check("★★ 읽은 수량·단가·금액이 그대로 저장된다",
      !!l && String(l.qty) === "3" && String(l.price) === "25" && String(l.amount) === "75", JSON.stringify(l));
    check("★ 날짜·업체도 같이 간다",
      !!sent && sent.date === "2026-10-05" && sent.vendor === "房信菓菜行",
      JSON.stringify(sent && { d: sent.date, v: sent.vendor }));
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})();
