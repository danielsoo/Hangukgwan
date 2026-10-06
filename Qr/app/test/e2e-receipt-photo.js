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

/**
 * 사진을 **그 자리에서 읽는 길**을 부른다.
 *
 * 2026-10-06 부터 📷 단추와 끌어다 놓기는 **대기함에 올린다**(사장님이 받아서
 * Claude 에게 읽히고 결과를 붙여넣는 길로 바뀌었다 — test/e2e-receipt-inbox.js).
 * 읽는 코드 자체는 그대로 남아 있으므로, 여기서는 화면 단추 대신 그 함수를
 * 직접 불러서 **읽은 뒤에 사장님이 보시는 것**을 잰다.
 */
async function readOne(page, b64, name) {
  await page.evaluate(async ({ b64, name }) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await window.HG_INGREDIENTS.readPhotos([new File([bin], name, { type: "image/png" })]);
  }, { b64, name });
}

// 64×64 흰 PNG. 1×1 은 브라우저가 그림으로 못 열어서(createImageBitmap 실패)
// **Claude 에게 보내는 길을 아예 안 탄다** — 머리를 읽는 자리를 재려면
// 그림으로 열리는 사진이어야 한다.
const PHOTO = "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAXklEQVR4nO3PMQ0AMAzAsPInvYLYYVWKESTzjhsd8KsBrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BbQHKU9LC7/CP1AAAAABJRU5ErkJggg==";
const photoFile = (name) => ({ name, mimeType: "image/png", buffer: Buffer.from(PHOTO, "base64") });

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
      kind: window.HG_RECEIPT_DIGITS ? window.HG_RECEIPT_DIGITS.kind : "",
      held: window.HG_RECEIPT_DIGITS ? window.HG_RECEIPT_DIGITS.heldOut : 0,
      read: !!(window.HG_RECEIPT_READ && window.HG_RECEIPT_READ.readPhoto),
    }));
    check("표 찾는 코드가 실려 있다", got.ocr, JSON.stringify(got));
    // 사장님 영수증 글씨로 학습한 망이다(MNIST 망은 66% 밖에 못 읽었다).
    // 떼어 둔 사진에서 몇 % 였는지를 파일이 들고 있다 — 바꿀 때 눈에 띄게.
    check("★ 영수증 글씨로 학습한 망이 실려 있다", got.digits && /^cnn|^mlp/.test(got.kind || ""), `${got.kind}`);
    check("★ 얼마나 맞는지 파일에 적혀 있다 (0.85 이상)", got.held >= 0.85, `${got.held}`);
    check("사진 읽는 코드가 실려 있다", got.read, "");
  }

  const tab = page.locator('.admin-tabs button[data-tab="ingredients"]');
  check("사장님 화면에 식자재 탭", await tab.isVisible(), "");
  await tab.click();
  await page.waitForTimeout(600);

  out.push("\n[📷 로 고르거나 끌어다 놓는다]");
  check("📷 영수증 사진 단추가 있다", await page.locator("#ingPhotoBtn").isVisible(), "");
  // 2026-10-06: 이 단추로 고른 사진은 **대기함에 올라간다**(그 자리에서 읽지 않는다).
  check("★ 📷 로 고른 사진은 대기함으로 간다", await page.locator(".ing-inbox").isVisible(), "");
  check(
    "사진 고르는 칸은 여러 장을 받는다",
    await page.locator("#ingPhotoFile").evaluate((el) => el.multiple && /image/.test(el.accept)),
    ""
  );
  {
    // 2026-10-04 사장님: "급여에서 사진 선택 말고도 드래그로 할 수 있게 해줘"
    const hint = await page.locator('#tab-ingredients [data-i18n="ingPhotoHint"]').innerText();
    check("★ 끌어다 놓을 수 있다고 적혀 있다", /끌어다 놓/.test(hint), hint);
    // 2026-10-06: 대기함을 만들며 사진이 **가게 서버**로 간다(아빠가 올리고
    // 사장님이 받아 보셔야 하므로). 그래서 「기기 밖으로 안 나간다」가 아니라
    // **어디에 있고 언제 지워지는지**를 적는다. 급여 출근 카드는 그대로 기기 안이다.
    check("★★ 사진이 어디에 있고 언제 지워지는지 적혀 있다",
      /가게 서버에만 있고/.test(hint) && /저장하면 지워져요/.test(hint), hint);
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
  await readOne(page, TINY, "receipt.png");
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
    await readOne(page, TINY, "blurry.png");
    await page.waitForTimeout(600);
    const log = await page.locator("#ingImportLog").innerText();
    check("★★ 못 읽었다고 말한다", /표를 못 찾/.test(log), log.slice(0, 200));
    check("★ 어떻게 하면 되는지도 말한다 (스캐너)", /스캐너/.test(log), log.slice(0, 200));
  }

  out.push("\n[업체·날짜·지점을 종이에서 읽는다]");
  {
    // 2026-10-05 사장님: "아빠가 파일 이름에 저런 정보를 안 넣으면 넌 그걸
    // 인식 못해?" — 영수증 12장을 파일 이름 없이 읽어 업체 10 · 날짜 8 ·
    // 지점 12 를 맞혔다(src/receiptHeader.js). 여기서 재는 것은 **읽은 뒤 화면**이다.
    await page.evaluate(() => {
      window.__hgSent = null;
      const real = window.fetch;
      window.__hgHead = {
        vendor: "房信菓菜行", vendor_text: "房信菓菜行", vendor_sure: true,
        date: "2026-09-30", store: "branch3",
      };
      window.fetch = async (u, o) => {
        if (String(u).includes("/api/ingredients/read-photo")) {
          window.__hgSent = JSON.parse(o.body);
          return new Response(JSON.stringify({
            rows: [{ name: "紅蘿蔔", qty: 2, price: 30, amount: 60, sure: true }],
            head: window.__hgHead,
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return real(u, o);
      };
      window.__hgRestoreFetch = () => { window.fetch = real; };
    });
    await readOne(page, PHOTO, "head.png");
    await page.waitForTimeout(900);
    const sent = await page.evaluate(() => window.__hgSent);
    check("★ 사진을 보낼 때 「머리 사진이 붙어 있나」도 같이 간다",
      !!sent && typeof sent.headerPiece === "boolean", JSON.stringify(sent && Object.keys(sent)));
    const v = await page.locator("#ingEntryVendor").inputValue();
    const d = await page.locator("#ingEntryDate").inputValue();
    const st = await page.locator("#ingEntryStore").inputValue();
    check("★★ 업체가 저절로 채워진다", v === "房信菓菜行", v);
    check("★★ 지점이 저절로 골라진다", st === "branch3", st);
    // 날짜 칸은 열 때 오늘로 채워 두므로 「적혀 있다」만으로는 못 가린다 —
    // 손을 대지 않으셨으면 종이 날짜로 바꾼다.
    check("★★ 손 안 댄 날짜는 종이 날짜로 바뀐다", d === "2026-09-30", d);
    const log = await page.locator("#ingImportLog").innerText();
    check("★ 어디서 읽었는지 말해준다", /영수증 머리에서 읽었/.test(log), log.slice(0, 200));
  }

  out.push("\n[사장님이 적으신 날짜는 덮지 않는다]");
  {
    // 사장님(2026-10-05): "장부날짜는 구매 날짜고 사진 날짜는 찍은 날짜일거야
    // 구매 날짜가 더 중요하지". 12장 중 2장이 종이 날짜와 장부 날짜가 달랐다
    // (주문서에 4/29 인데 물건은 5/1 에 왔다).
    await page.fill("#ingEntryDate", "2026-10-02");
    await page.dispatchEvent("#ingEntryDate", "input");
    await readOne(page, PHOTO, "head2.png");
    await page.waitForTimeout(900);
    const d = await page.locator("#ingEntryDate").inputValue();
    check("★★ 적어 두신 날짜가 그대로 남는다", d === "2026-10-02", d);
    const log = await page.locator("#ingImportLog").innerText();
    check("★★ 종이 날짜가 다르면 말해준다", /종이에 적힌 날짜는 2026-09-30/.test(log), log.slice(-240));
    await page.evaluate(() => window.__hgRestoreFetch && window.__hgRestoreFetch());
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
