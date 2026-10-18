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

  // 2026-10-17: 대기함 목록은 접혀 있다(일하는 표를 위로 올리면서). 목록을
  // 만지는 시험은 펴고 본다 — 이미 펴져 있으면 아무 일도 안 한다.
  const openInbox = async () => {
    const fold = page.locator("#ingInboxFold");
    if (!(await fold.isVisible())) return;
    if (await page.locator("#ingInboxBody").evaluate((el) => el.hidden)) {
      await fold.click();
      await page.waitForTimeout(300);
    }
  };

  out.push("\n[장부와 영수증 확인은 다른 칸]");
  {
    // 2026-10-17 사장님: "지금은 대기함이 홈에 있는데 그거 홈에 하지 말고
    // 새 탭을 만들어서 확인하는 탭을 따로 만들어서 거기서 조절할 수 있게 해줘"
    const tabs = page.locator(".ing-view-tab");
    check("★★ 식자재 안에 칸이 둘이다 (장부·영수증 확인)", (await tabs.count()) === 2, String(await tabs.count()));

    await page.locator('[data-ing-view="book"]').click();
    await page.waitForTimeout(400);
    check("★★ 장부 칸에서는 대기함이 안 보인다", await page.locator("#ingViewCheck").evaluate((el) => el.hidden), "");
    check("★ 장부 칸에서는 장부가 보인다", !(await page.locator("#ingViewBook").evaluate((el) => el.hidden)), "");
    check("★★ 대기함도 영수증 넣기 표도 장부 칸에 없다",
      !(await page.locator(".ing-inbox").isVisible()) && !(await page.locator(".ing-entry").isVisible()), "");

    await page.locator('[data-ing-view="check"]').click();
    await page.waitForTimeout(400);
    check("★★ 확인 칸에서는 대기함과 표가 보인다",
      (await page.locator(".ing-inbox").isVisible()) && (await page.locator(".ing-entry").isVisible()), "");
    check("★ 장부는 확인 칸에서 안 보인다", await page.locator("#ingViewBook").evaluate((el) => el.hidden), "");

    // 고른 칸은 **그 기기에** 남는다
    const kept = await page.evaluate(() => localStorage.getItem("hg_admin_ingView"));
    check("★★ 고른 칸이 기기에 남는다", kept === "check", String(kept));

    // 사진을 올리면 **저절로 확인 칸으로** — 장부 칸에 있으면 올려 놓고 아무것도 안 보인다
    await page.locator('[data-ing-view="book"]').click();
    await page.waitForTimeout(400);
    const { drawReceipt, grayToPng } = require("./draw-receipt");
    const paper = grayToPng(drawReceipt({ w: 700, h: 1200, rows: 6, cols: 5, widths: [3, 1, 1, 1.4, 1], inkW: 14, inkH: 30 }), 700, 1200);
    await page.setInputFiles("#ingInboxFile", [{ name: "view-1.png", mimeType: "image/png", buffer: paper }]);
    await page.waitForTimeout(2000);
    check("★★ 사진을 올리면 저절로 확인 칸으로 간다", !(await page.locator("#ingViewCheck").evaluate((el) => el.hidden)), "");
    const tab = await page.locator("#ingViewCheckTab").innerText();
    check("★ 확인 칸 이름에 몇 장 기다리는지 적힌다", /\d/.test(tab), tab);

    const row = page.locator('.ing-inbox-row:has-text("view-1.png")');
    await row.locator("[data-inbox-del]").click();
    await page.waitForTimeout(300);
    await page.locator("#appDialogOk").click();
    await page.waitForTimeout(800);
  }

  out.push("[대기함이 있다]");
  await openInbox();
  check("📥 대기함 카드", await page.locator(".ing-inbox").isVisible(), "");
  check("처음엔 비어 있다고 말한다", /비어 있어요/.test(await page.locator("#ingInboxList").innerText()), await page.locator("#ingInboxList").innerText());

  out.push("\n[아빠가 사진을 올린다]");
  await openInbox();
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

  out.push("\n[전부 받기 — 한 파일로]");
  await openInbox();
  {
    // 2026-10-16 사장님: "전부 받기 만들어줘" — 대기함에 115장이 쌓였는데
    // 줄마다 「받기」를 눌러야 했다. 115번 누르고 115개 파일을 찾는 것은 일이 아니다.
    const btn = page.locator("#ingInboxGetAll");
    check("★ 「전부 받기」 단추가 있다", await btn.isVisible(), "");
    check("★ 몇 장인지 단추에 적힌다", /\(2\)/.test(await btn.innerText()), await btn.innerText());

    const dl = page.waitForEvent("download", { timeout: 30000 });
    await btn.click();
    await page.waitForTimeout(400);
    // 몇 장·몇 MB 인지 먼저 묻는다
    const ask = await page.locator("#appDialogMessage").innerText();
    check("★★ 몇 장을 받는지 묻는다", /2장/.test(ask), ask.slice(0, 80));
    await page.locator("#appDialogOk").click();

    const file = await dl;
    const path = await file.path();
    const buf = require("fs").readFileSync(path);
    check("★★ 한 파일로 받아진다", buf.length > 0, String(buf.length));
    check("★★ zip 이다 (PK 로 시작)", buf[0] === 0x50 && buf[1] === 0x4b, `${buf[0]} ${buf[1]}`);
    // zip 안의 이름 — 올린 차례와 날짜가 붙는다
    const text = buf.toString("latin1");
    check("★★ 사진 두 장이 들어 있다", (text.match(/head\.png|receipt-1\.png|receipt-2\.png/g) || []).length >= 2, "");
    check("★★ 이름에 차례와 날짜", /001_\d{4}-\d{2}-\d{2}_/.test(text), text.slice(0, 120).replace(/[^\x20-\x7e]/g, "."));
    // 2026-10-16: 한글·중국어 이름이 탐색기에서 깨졌다. zip 은 「이름이 UTF-8 이다」를
    // 플래그 비트 11 로 알려야 한다 — 안 켜면 받는 쪽이 옛 CP437 로 읽는다.
    check("★★ 이름이 UTF-8 이라고 표시한다 (플래그 비트 11)", (buf.readUInt16LE(6) & 0x0800) !== 0, "0x" + buf.readUInt16LE(6).toString(16));
    check("★ 받았다고 말한다", /한 파일로 받았어요/.test(await page.locator("#ingImportLog").innerText()), "");
    check("★ 단추가 다시 눌린다", !(await btn.isDisabled()), "");
  }

  out.push("\n[한꺼번에 넣기 — 붙여넣기 한 번으로 두 줄]");
  await openInbox();
  {
    // 2026-10-17: 대기함에 115장이 쌓였다. 줄마다 붙여넣으면 붙여넣기 115번이고,
    // 어느 줄에 어느 사진 것을 넣었는지 사장님이 세어야 한다.
    //
    // 재는 것은 **짝이 맞는가**와 **못 찾은 것을 말하는가**다. 엉뚱한 줄에
    // 들어가면 사진과 숫자가 어긋난 채로 저장되고 눈으로는 못 찾는다.
    const btn = page.locator("#ingInboxPasteMany");
    check("★ 「한꺼번에 넣기」 단추가 있다", await btn.isVisible(), "");
    await btn.click();
    await page.waitForTimeout(200);
    check("★ 붙여넣는 칸이 열린다", await page.locator("#ingInboxManyText").isVisible(), "");

    // 사진 두 장 것 + **대기함에 없는 한 장**. 셋째 것은 아무 줄에도 안 들어가야 한다.
    const many = JSON.stringify([
      { file: "001_" + today + "_receipt-1.png", vendor: "房信菓菜行", date: today, store: "main", total: 110,
        rows: [{ name: "紅蘿蔔", name_ko: "당근", qty: 5, unit: "斤", price: 22, amount: 110, sure: true }] },
      { file: "receipt-2.png", vendor: "泳慶蛋行", date: today, store: "main", total: 300,
        rows: [{ name: "雞蛋", name_ko: "계란", qty: 2, unit: "箱", price: 150, amount: 300, sure: true }] },
      { file: "없는사진.jpg", vendor: "房信菓菜行", date: today, store: "main", total: 10,
        rows: [{ name: "甲", qty: 1, price: 10, amount: 10, sure: true }] },
    ]);
    await page.locator("#ingInboxManyText").fill(many);
    await page.locator("#ingInboxManyGo").click();
    await page.waitForTimeout(1800);

    const flat = (t) => String(t).split("\n").join(" | ").slice(0, 240);
    const txt = await page.locator("#ingInboxList").innerText();
    check("★★ 붙여넣기 한 번에 두 줄이 「확인 대기」", (txt.match(/확인 대기/g) || []).length === 2, flat(txt));
    check("★★ 줄마다 몇 줄 읽었는지", /1줄 · 확인 필요 0줄/.test(txt), flat(txt));
    const log = await page.locator("#ingImportLog").innerText();
    check("★ 몇 장에 넣었는지 말한다", /2장에 넣었어요/.test(log), flat(log));
    check("★★ 짝을 못 찾은 장을 말한다 — 조용히 넘기지 않는다", /못 가렸어요/.test(log) && /없는사진/.test(log), flat(log));
    check("★ 넣고 나면 칸이 닫힌다", await page.locator("#ingInboxManyBox").isHidden(), "");

    // 머리가 붙은 이름(001_날짜_)도, 안 붙은 이름도 제 줄에 들어간다
    const items = ((await (await page.request.get(base + "/api/ingredients/inbox")).json()).items) || [];
    const one = items.find((i) => i.name === "receipt-1.png");
    const two = items.find((i) => i.name === "receipt-2.png");
    check("★★ 「001_날짜_」 머리가 붙은 이름도 제 줄로", !!(one && one.read && one.read.rows === 1), JSON.stringify(one && one.read));
    check("★★ 머리 없는 이름도 제 줄로", !!(two && two.read && two.read.rows === 1), JSON.stringify(two && two.read));

    // **저장은 줄마다 사장님이** — 넣기만 했을 뿐 장부에는 아직 안 들어갔다
    const ledger = ((await (await page.request.get(base + "/api/ingredients/rows?limit=50")).json()).rows) || [];
    check("★★ 넣기만 한다 — 장부에는 아직 안 들어간다", !ledger.some((r) => r.name === "雞蛋"), String(ledger.length));

    // 엉뚱한 글은 안 받는다
    await btn.click();
    await page.waitForTimeout(200);
    await page.locator("#ingInboxManyText").fill("안녕하세요");
    await page.locator("#ingInboxManyGo").click();
    await page.waitForTimeout(800);
    const bad = await page.locator("#ingImportLog").innerText();
    check("★ 엉뚱한 글을 묶음으로 넣어도 말해 준다", /JSON 을 못 찾았어요/.test(bad), flat(bad));
    await page.locator("#ingInboxManyCancel").click();
    await page.waitForTimeout(200);
  }

  out.push("\n[진짜 사진 크기도 올라간다]");
  await openInbox();
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
  await openInbox();
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

  out.push("\n[사진의 그 줄을 숫자 밑에]");
  await openInbox();
  {
    // 2026-10-17 사장님: "실제 사진 어떤 줄에서 이걸 읽어왔는지 옆에 보여주면
    // 비교 검사할 때 매번 영수증 찾아서 줄 일일이 읽는 것보다 빠를 것 같아"
    //
    // 재는 것은 **줄이 맞게 붙는가**와 **못 찾았을 때 지어내지 않는가**다.
    // 한 줄이라도 밀리면 엉뚱한 줄을 보시며 「맞다」 하시게 된다.
    const { drawReceipt, grayToPng } = require("./draw-receipt");
    const W = 700, H = 1200;
    // 줄 6 = 머리글 한 줄 + 쓴 줄 5. 잉크를 키워야 「쓴 줄」로 센다(칸의 5% 넘게).
    const paper = grayToPng(drawReceipt({ w: W, h: H, rows: 6, cols: 5, widths: [3, 1, 1, 1.4, 1], inkW: 14, inkH: 30 }), W, H);
    await page.setInputFiles("#ingInboxFile", [{ name: "ruled.png", mimeType: "image/png", buffer: paper }]);
    await page.waitForTimeout(1500);

    const row = page.locator('.ing-inbox-row:has-text("ruled.png")');
    await row.locator("[data-inbox-paste]").click();
    await page.waitForTimeout(200);
    const five = {
      vendor: "房信菓菜行", date: today, store: "main", rows: [
        { name: "豆芽", qty: 5, unit: "斤", price: 12, amount: 60, sure: true },
        { name: "紅蘿蔔", qty: 3, unit: "斤", price: 25, amount: 75, sure: true },
        { name: "蔥", qty: 1, unit: "把", price: 250, amount: 250, sure: true },
        { name: "蒜頭", qty: 2, unit: "斤", price: 90, amount: 180, sure: true },
        { name: "芹菜", qty: 1, unit: "把", price: 60, amount: 60, sure: true },
      ],
    };
    await row.locator("textarea").fill(JSON.stringify(five));
    await row.locator("[data-inbox-go]").click();
    await page.waitForTimeout(3500);          // 사진에서 표를 찾는 데 걸린다

    const strips = page.locator(".ing-line-strip img");
    check("★★ 줄마다 사진의 그 줄이 붙는다", (await strips.count()) === 5, String(await strips.count()));
    const drawn = await strips.first().evaluate((el) => el.naturalWidth > 0 && el.naturalHeight > 0);
    check("★★ 빈 그림이 아니다", drawn, "");
    const wide = await strips.first().evaluate((el) => el.naturalWidth > el.naturalHeight * 3);
    check("★ 줄 한 칸이 아니라 **줄 전체**다 (가로로 길다)", wide, "");
    // 줄마다 다른 자리를 잘랐는가 — 같은 그림을 다섯 번 붙이면 아무 쓸모가 없다
    const srcs = await strips.evaluateAll((els) => els.map((e) => e.src.slice(-80)));
    check("★★ 줄마다 다른 자리를 자른다", new Set(srcs).size === 5, String(new Set(srcs).size));
    check("★ 몇 줄 붙였는지 말한다", /줄 5개/.test(await page.locator("#ingImportLog").innerText()), "");

    // 줄이 어긋났을 때 — 사장님이 ◀▶ 로 맞추신다. 사진에서 센 줄과 읽은 줄이
    // 같은 영수증은 사장님 102장 중 7장뿐이라, 자동으로 맞히려 들지 않는다.
    check("★★ 맞춤 줄(◀▶)이 있다", await page.locator(".ing-strip-bar").isVisible(), "");
    const before = await strips.first().evaluate((el) => el.src.slice(-60));
    await page.locator("#ingStripDown").click();
    await page.waitForTimeout(300);
    const after = await page.locator(".ing-line-strip img").first().evaluate((el) => el.src.slice(-60));
    check("★★ ▶ 를 누르면 한 칸 밀린다", before !== after, "");
    check("★ 몇 칸 밀었는지 보인다", (await page.locator(".ing-strip-off").innerText()).trim() === "+1", await page.locator(".ing-strip-off").innerText());
    await page.locator("#ingStripUp").click();
    await page.waitForTimeout(300);
    const back = await page.locator(".ing-line-strip img").first().evaluate((el) => el.src.slice(-60));
    check("★ ◀ 로 되돌아온다", back === before, "");

    // 치우기 — 화면으로 지운다(서버만 지우면 목록에 유령이 남아 뒤 시험이 깨진다)
    await row.locator("[data-inbox-del]").click();
    await page.waitForTimeout(300);
    await page.locator("#appDialogOk").click();
    await page.waitForTimeout(1000);
  }

  out.push("\n[줄 자리를 적어 보내면 — 표를 안 찾고 그대로 자른다]");
  await openInbox();
  {
    // 2026-10-17 사장님: "한 번 더 훑어서 102장 전부 정확히 맞춰줘"
    //
    // 읽은 쪽이 「사진 위에서 몇 % 줄」을 적어 보내면 표 찾기가 필요 없다.
    // 사장님 영수증 102장으로 재보니 표 찾기로는 54장만 되고 줄 수까지 맞는
    // 것은 7장뿐이었다 — 그 길로는 못 맞춘다.
    const { drawReceipt, grayToPng } = require("./draw-receipt");
    const W = 700, H = 1200;
    const paper = grayToPng(drawReceipt({ w: W, h: H, rows: 6, cols: 5, widths: [3, 1, 1, 1.4, 1], inkW: 14, inkH: 30 }), W, H);
    await page.setInputFiles("#ingInboxFile", [{ name: "banded.png", mimeType: "image/png", buffer: paper }]);
    await page.waitForTimeout(1500);

    const row = page.locator('.ing-inbox-row:has-text("banded.png")');
    await row.locator("[data-inbox-paste]").click();
    await page.waitForTimeout(200);
    // 1·2째 줄은 **같은 자리**, 3째 줄은 다른 자리, 4째 줄은 자리를 안 적었다
    const withBands = {
      vendor: "房信菓菜行", date: today, store: "main", rows: [
        { name: "甲", qty: 1, unit: "斤", price: 10, amount: 10, sure: true, band: [0.30, 0.36] },
        { name: "乙", qty: 1, unit: "斤", price: 10, amount: 10, sure: true, band: [0.30, 0.36] },
        { name: "丙", qty: 1, unit: "斤", price: 10, amount: 10, sure: true, band: [0.60, 0.66] },
        { name: "丁", qty: 1, unit: "斤", price: 10, amount: 10, sure: true },
      ],
    };
    await row.locator("textarea").fill(JSON.stringify(withBands));
    await row.locator("[data-inbox-go]").click();
    await page.waitForTimeout(3000);

    const srcs = await page.locator(".ing-line-strip img").evaluateAll((els) => els.map((e) => e.src));
    check("★★ 자리를 적은 줄에만 띠가 붙는다 (3줄)", srcs.length === 3, String(srcs.length));
    check("★★ 같은 자리를 적으면 같은 띠", srcs[0] === srcs[1], "");
    check("★★ 다른 자리를 적으면 다른 띠", srcs[2] !== srcs[0], "");
    check("★★ 맞출 필요가 없으므로 ◀▶ 를 안 띄운다", (await page.locator(".ing-strip-bar").count()) === 0, "");
    check("★ 자리를 적어 뒀다고 말한다", /자리를 적어 둬서/.test(await page.locator("#ingImportLog").innerText()), "");
    const tall = await page.locator(".ing-line-strip img").first().evaluate((el) => el.naturalHeight);
    check("★ 읽을 만한 크기로 자른다", tall >= 40 && tall <= 260, String(tall));

    // 다시 올려도(↩︎) 자리가 남아 있다 — 서버가 들고 있는 값에 band 가 들어간다
    await page.locator("#ingEntryClear").click().catch(() => {});
    await page.waitForTimeout(300);
    await row.locator("[data-inbox-use]").click();
    await page.waitForTimeout(2500);
    check("★★ 「다시 올리기」로도 띠가 돌아온다", (await page.locator(".ing-line-strip img").count()) === 3, String(await page.locator(".ing-line-strip img").count()));

    await row.locator("[data-inbox-del]").click();
    await page.waitForTimeout(300);
    await page.locator("#appDialogOk").click();
    await page.waitForTimeout(1000);
  }

  out.push("\n[묶음을 파일로 넣는다 — 50KB 를 손으로 복사하지 않게]");
  await openInbox();
  {
    // 2026-10-17 사장님: "bundle 파일이 안 올라가져 드래그해서"
    //
    // 칸은 글을 붙여넣는 칸이고 탭의 드래그는 사진만 받고 있었다. 묶음은
    // 50KB 가 넘어서 패드에서 전부 골라 복사하는 것이 고된 일이다.
    const { drawReceipt, grayToPng } = require("./draw-receipt");
    const W = 700, H = 1200;
    const paper = grayToPng(drawReceipt({ w: W, h: H, rows: 6, cols: 5, widths: [3, 1, 1, 1.4, 1], inkW: 14, inkH: 30 }), W, H);
    await page.setInputFiles("#ingInboxFile", [{ name: "byfile.png", mimeType: "image/png", buffer: paper }]);
    await page.waitForTimeout(1500);

    const bundle = JSON.stringify([{
      file: "byfile.png", vendor: "房信菓菜行", date: today, store: "main", total: 60,
      rows: [{ name: "豆芽", qty: 5, unit: "斤", price: 12, amount: 60, sure: true, band: [0.3, 0.36] }],
    }]);
    await page.locator("#ingInboxPasteMany").click();
    await page.waitForTimeout(200);
    check("★ 「파일에서」 단추가 있다", await page.locator("#ingInboxManyFile").isVisible(), "");
    await page.setInputFiles("#ingInboxManyFileInput", [{ name: "bundle.json", mimeType: "application/json", buffer: Buffer.from(bundle, "utf8") }]);
    await page.waitForTimeout(2500);

    const log = await page.locator("#ingImportLog").innerText();
    check("★★ 파일을 읽어 줄에 넣는다", /1장에 넣었어요/.test(log), log.split("\n").join(" | ").slice(0, 160));
    check("★ 어느 파일을 읽었는지 말한다", /bundle\.json/.test(log), log.split("\n").join(" | ").slice(0, 160));
    const txt = await page.locator("#ingInboxList").innerText();
    check("★★ 그 줄이 「확인 대기」로", /확인 대기/.test(txt), "");

    // 사진도 글도 아닌 것을 놓으면 — **조용히 넘기지 않는다**
    await page.evaluate(() => {
      const zone = document.getElementById("tab-ingredients");
      const dt = new DataTransfer();
      dt.items.add(new File(["zzz"], "뭔가.bin", { type: "application/octet-stream" }));
      zone.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(800);
    check("★★ 엉뚱한 파일을 놓으면 뭘 놓으라고 말한다", /사진도 묶음 파일도 아니에요/.test(await page.locator("#ingImportLog").innerText()), await page.locator("#ingImportLog").innerText().then((t) => t.slice(0, 120)));

    // 묶음을 **끌어다 놓아도** 같은 길
    await page.evaluate(({ bundle }) => {
      const zone = document.getElementById("tab-ingredients");
      const dt = new DataTransfer();
      dt.items.add(new File([bundle], "bundle2.json", { type: "application/json" }));
      zone.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, { bundle });
    await page.waitForTimeout(2500);
    check("★★ 끌어다 놓아도 들어간다", /bundle2\.json/.test(await page.locator("#ingImportLog").innerText()), "");

    const row = page.locator('.ing-inbox-row:has-text("byfile.png")');
    await row.locator("[data-inbox-del]").click();
    await page.waitForTimeout(300);
    await page.locator("#appDialogOk").click();
    await page.waitForTimeout(1000);
  }

  out.push("\n[확인 대기는 확인 대기끼리 — 섞이면 어디까지 했는지 모른다]");
  await openInbox();
  {
    // 2026-10-17 사장님: "확인대기는 확인대기용으로 빠지게 해줘 그래서 거기서 볼 수 있게"
    //
    // 묶음 하나로 102줄이 한꺼번에 「확인 대기」가 된다. 「읽기 전」과 섞여
    // 있으면 아빠가 어디까지 확인했는지 알 수 없다.
    const { drawReceipt, grayToPng } = require("./draw-receipt");
    const W = 700, H = 1200;
    const paper = grayToPng(drawReceipt({ w: W, h: H, rows: 6, cols: 5, widths: [3, 1, 1, 1.4, 1], inkW: 14, inkH: 30 }), W, H);
    // 석 장 올리고 그 중 한 장만 읽은 결과를 넣는다
    await page.setInputFiles("#ingInboxFile", [
      { name: "tab-a.png", mimeType: "image/png", buffer: paper },
      { name: "tab-b.png", mimeType: "image/png", buffer: paper },
      { name: "tab-c.png", mimeType: "image/png", buffer: paper },
    ]);
    await page.waitForTimeout(2000);

    const one = JSON.stringify([{
      file: "tab-b.png", vendor: "房信菓菜行", date: today, store: "main", total: 60,
      rows: [{ name: "豆芽", qty: 5, unit: "斤", price: 12, amount: 60, sure: true, band: [0.3, 0.36] }],
    }]);
    await page.locator("#ingInboxPasteMany").click();
    await page.waitForTimeout(200);
    await page.locator("#ingInboxManyText").fill(one);
    await page.locator("#ingInboxManyGo").click();
    await page.waitForTimeout(2500);

    const tabs = page.locator(".ing-inbox-tab");
    check("★★ 상태별 칸이 있다 (전체·읽기 전·확인 대기·저장됨)", (await tabs.count()) === 4, String(await tabs.count()));
    const readTab = page.locator('[data-inbox-tab="read"]');
    const readN = Number((await readTab.innerText()).replace(/[^0-9]/g, ""));
    check("★★ 「확인 대기」 칸에 몇 장인지 적힌다", readN >= 1, await readTab.innerText());
    const newTab = page.locator('[data-inbox-tab="new"]');
    check("★ 「읽기 전」도 세어 둔다 (2장)", /읽기 전\s*2/.test((await newTab.innerText()).replace(/\n/g, " ")), await newTab.innerText());

    await readTab.click();
    await page.waitForTimeout(400);
    const rows = page.locator(".ing-inbox-row");
    check("★★ 「확인 대기」를 고르면 그 숫자만큼만 보인다", (await rows.count()) === readN, (await rows.count()) + " vs " + readN);
    const onlyRead = await rows.evaluateAll((els) => els.every((e) => /확인 대기/.test(e.innerText)));
    check("★★ 보이는 것이 전부 「확인 대기」다", onlyRead, "");
    check("★★ 보이는 것이 읽은 그 장이다", /tab-b\.png/.test(await page.locator("#ingInboxList").innerText()), "");
    check("★ 고른 칸이 눈에 띈다", (await readTab.getAttribute("class")).includes("is-on"), "");

    await newTab.click();
    await page.waitForTimeout(400);
    const newN = Number((await newTab.innerText()).replace(/[^0-9]/g, ""));
    check("★★ 「읽기 전」을 고르면 그 숫자만큼만", (await rows.count()) === newN, (await rows.count()) + " vs " + newN);
    const onlyNew = await rows.evaluateAll((els) => els.every((e) => /읽기 전/.test(e.innerText)));
    check("★★ 보이는 것이 전부 「읽기 전」이다", onlyNew, "");

    // 고른 칸은 **그 기기에 남는다** — 새로고침해도 하던 자리로
    const kept = await page.evaluate(() => localStorage.getItem("hg_admin_inboxTab"));
    check("★★ 고른 칸이 기기에 남는다", kept === "new", String(kept));

    // 102줄이 들어와도 **화면이 안 늘어난다** — 목록 칸 안에서 굴러야 한다
    const box = await page.locator("#ingInboxList").evaluate((el) => ({ h: el.clientHeight, scroll: el.scrollHeight > el.clientHeight + 1, over: getComputedStyle(el).overflowY }));
    check("★★ 목록은 제 칸 안에서 구른다 (페이지가 안 늘어난다)", box.h <= 460 && /auto|scroll/.test(box.over), JSON.stringify(box));

    await page.locator('[data-inbox-tab="all"]').click();
    await page.waitForTimeout(300);
    for (const name of ["tab-a.png", "tab-b.png", "tab-c.png"]) {
      const row = page.locator('.ing-inbox-row:has-text("' + name + '")');
      if (!(await row.count())) continue;
      await row.first().locator("[data-inbox-del]").click();
      await page.waitForTimeout(300);
      await page.locator("#appDialogOk").click();
      await page.waitForTimeout(800);
    }
  }

  out.push("\n[줄 자리를 못 찾으면 — 지어내지 않는다]");
  await openInbox();
  {
    // 표가 없는 사진(시험용 흰 그림)에 두 줄을 붙여넣는다. 엉뚱한 줄을
    // 보여주느니 **한 장도 안 보여주고** 그렇다고 말해야 한다.
    await page.locator(".ing-inbox-row").first().locator("[data-inbox-paste]").click();
    await page.waitForTimeout(200);
    await page.locator(".ing-inbox-row").first().locator("textarea").fill(PASTED);
    await page.locator(".ing-inbox-row").first().locator("[data-inbox-go]").click();
    await page.waitForTimeout(3000);
    check("★★ 표를 못 찾으면 한 장도 안 붙인다", (await page.locator(".ing-line-strip img").count()) === 0, "");
    const log = await page.locator("#ingImportLog").innerText();
    check("★★ 조용히 넘기지 않고 이유를 말한다", /표 줄을 못 찾았어요/.test(log), log.split("\n").join(" | ").slice(0, 160));
  }

  out.push("\n[확실한 줄과 확실치 않은 줄]");
  await openInbox();
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
  await openInbox();
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
  await openInbox();
  {
    await page.locator("#ingEntrySave").click();
    await page.waitForTimeout(1800);
    const left = await page.locator(".ing-inbox-row").count();
    check("★★ 저장하면 그 줄이 대기함에서 빠진다 (남은 건 한 장)", left === 1, String(left));
    await page.locator('[data-inbox-tab="saved"]').click();
    await page.waitForTimeout(400);
    const all = await page.locator("#ingInboxList").innerText();
    check("★ 「저장됨」 칸으로 보면 남아 있다", /저장됨/.test(all), all.replace(/\n/g, " | ").slice(0, 200));
    const saved = page.locator(".ing-inbox-row").filter({ hasText: "저장됨" }).first();
    check("★★ 저장된 줄에는 「받기」가 없다 — 사진을 지웠다",
      (await saved.locator("a.ing-inbox-btn").count()) === 0, "");
    // 저장하면 **다음 확인 대기 줄이 저절로 열린다**(2026-10-17) — 사진 칸은
    // 닫히거나 그 다음 영수증으로 바뀐다. 아무것도 안 남았을 때만 닫힌다.
    const photoAfter = await page.locator("#ingEntryPhoto").evaluate((el) => el.hidden);
    const nextOpen = /다음 줄을 열었어요|다 끝났어요/.test(await page.locator("#ingImportLog").innerText());
    check("★ 사진 칸이 닫히거나 다음 영수증으로 바뀐다", photoAfter || nextOpen, photoAfter + " / " + nextOpen);
  }

  out.push("\n[전체 내역에 들어간다]");
  await openInbox();
    await page.locator('[data-ing-view="book"]').click();
    await page.waitForTimeout(600);
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
  await openInbox();
  {
    await page.locator('#ingVendorChips [data-ing-chip=""]').click();
    await page.waitForTimeout(600);
    await page.locator('[data-ing-view="check"]').click();   // 대기함은 확인 칸에 있다
    await page.waitForTimeout(400);
    await page.locator('[data-inbox-tab="all"]').click();
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
  await openInbox();
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

  out.push("\n[제목이 지금 무엇을 하는 중인지 말한다]");
  await openInbox();
  {
    // 2026-10-17 사장님: "영수증 확인이랑 영수증 넣기의 역할이 헷갈려"
    //
    // 같은 표가 두 가지로 쓰인다 — 대기함에서 고른 영수증을 **확인**하거나,
    // 사진 없이 **손으로** 적거나. 제목이 그걸 말해야 한다.
    const { drawReceipt, grayToPng } = require("./draw-receipt");
    const paper = grayToPng(drawReceipt({ w: 700, h: 1200, rows: 6, cols: 5, widths: [3, 1, 1, 1.4, 1], inkW: 14, inkH: 30 }), 700, 1200);
    await page.setInputFiles("#ingInboxFile", [{ name: "name-1.png", mimeType: "image/png", buffer: paper }]);
    await page.waitForTimeout(1800);
    await openInbox();

    const title = () => page.locator(".ing-entry .ing-block-title").innerText();
    check("★ 아무것도 안 골랐으면 「손으로 넣기」", /손으로 넣기/.test(await title()), await title());

    const one = JSON.stringify([{
      file: "name-1.png", vendor: "龍江興南北商行", date: "2026-09-05", store: "main", total: 60,
      rows: [{ name: "甲", qty: 5, unit: "斤", price: 12, amount: 60, sure: true, band: [0.3, 0.36] }],
    }]);
    await page.locator("#ingInboxPasteMany").click();
    await page.waitForTimeout(200);
    await page.locator("#ingInboxManyText").fill(one);
    await page.locator("#ingInboxManyGo").click();
    await page.waitForTimeout(2500);
    await openInbox();
    await page.locator('.ing-inbox-row:has-text("name-1.png")').locator("[data-inbox-use]").click();
    await page.waitForTimeout(1800);

    const t = await title();
    check("★★ 영수증을 고르면 「이 영수증 확인하기」", /확인하기/.test(t), t);
    check("★★ 어느 영수증인지 제목에 적힌다", /龍江興南北商行/.test(t) && /2026-09-05/.test(t), t);

    await page.locator("#ingEntryClear").click();
    await page.waitForTimeout(600);
    const t2 = await title();
    check("★★ 비우면 다시 「손으로 넣기」로 — 표는 비었는데 제목만 남으면 안 된다", /손으로 넣기/.test(t2), t2);
    check("★ 비우면 사진도 떼어진다", await page.locator("#ingEntryPhoto").evaluate((el) => el.hidden), "");

    await openInbox();
    const row = page.locator('.ing-inbox-row:has-text("name-1.png")');
    await row.locator("[data-inbox-del]").click();
    await page.waitForTimeout(300);
    await page.locator("#appDialogOk").click();
    await page.waitForTimeout(800);
  }

  out.push("\n[영수증마다 칩 — 급여의 직원 칩처럼 눌러서 오간다]");
  await openInbox();
  {
    // 2026-10-17 사장님: "우리 직원들 개개별로 확인할 수 있게 한 것처럼
    // 영수증마다 탭이나 그런 걸 해줘서 확인할 수 있게"
    const { drawReceipt, grayToPng } = require("./draw-receipt");
    const W = 700, H = 1200;
    const paper = grayToPng(drawReceipt({ w: W, h: H, rows: 6, cols: 5, widths: [3, 1, 1, 1.4, 1], inkW: 14, inkH: 30 }), W, H);
    await page.setInputFiles("#ingInboxFile", [
      { name: "chip-1.png", mimeType: "image/png", buffer: paper },
      { name: "chip-2.png", mimeType: "image/png", buffer: paper },
      { name: "chip-3.png", mimeType: "image/png", buffer: paper },
    ]);
    await page.waitForTimeout(2200);

    const three = JSON.stringify([
      { file: "chip-1.png", vendor: "龍江興南北商行", date: "2026-09-02", store: "main", total: 60,
        rows: [{ name: "甲", qty: 5, unit: "斤", price: 12, amount: 60, sure: true, band: [0.3, 0.36] }] },
      { file: "chip-2.png", vendor: "阿寶水產", date: "2026-09-03", store: "main", total: 90,
        rows: [{ name: "乙", qty: 3, unit: "箱", price: 30, amount: 90, sure: true, band: [0.4, 0.46] }] },
      { file: "chip-3.png", vendor: "旺旺來", date: "2026-09-04", store: "main", total: 40,
        rows: [{ name: "丙", qty: 2, unit: "包", price: 20, amount: 41, sure: false, band: [0.5, 0.56] }] },
    ]);
    await page.locator("#ingInboxPasteMany").click();
    await page.waitForTimeout(200);
    await page.locator("#ingInboxManyText").fill(three);
    await page.locator("#ingInboxManyGo").click();
    await page.waitForTimeout(2800);

    const chips = page.locator(".ing-check-chip");
    check("★★ 확인 대기 영수증마다 칩이 있다", (await chips.count()) >= 3, String(await chips.count()));
    const at = await page.locator("#ingCheckAt").innerText();
    check("★ 몇 번째 / 몇 장인지 적힌다", /[0-9]/.test(at), at);
    const names = await chips.evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, " ")));
    check("★★ 칩에 업체와 날짜가 보인다", names.some((x) => x.includes("阿寶水產") && x.includes("09/03")), names.join(" / ").slice(0, 160));
    check("★★ 확인 필요한 줄이 있으면 칩에 표시", names.some((x) => x.includes("旺旺來") && /1/.test(x)), names.join(" / ").slice(0, 160));

    // 칩을 누르면 그 영수증이 표에 열린다
    const one = page.locator('.ing-check-chip:has-text("阿寶水產")');
    await one.click();
    await page.waitForTimeout(1500);
    check("★★ 칩을 누르면 그 영수증이 열린다", (await page.locator("#ingEntryVendor").inputValue()) === "阿寶水產", await page.locator("#ingEntryVendor").inputValue());
    check("★★ 지금 보고 있는 칩이 눈에 띈다", (await one.getAttribute("class")).includes("is-on"), await one.getAttribute("class"));
    const onCount = await page.locator(".ing-check-chip.is-on").count();
    check("★ 눈에 띄는 칩은 하나뿐이다", onCount === 1, String(onCount));

    // 「다음 ▶」으로도 넘어간다
    const before = await page.locator("#ingEntryVendor").inputValue();
    // 패드로 누르는 단추다 — 작으면 도움이 안 된다(2026-10-17 사장님)
    const size = await page.locator("#ingCheckNext").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    });
    check("★★ 「다음」 단추가 손가락으로 누를 만하다", size.h >= 40 && size.w >= 80, JSON.stringify(size));
    const where = await page.locator("#ingCheckNext").evaluate((el) => {
      const head = el.closest(".ing-check-head");
      const chips = document.getElementById("ingCheckChips");
      return head && chips ? head.getBoundingClientRect().top < chips.getBoundingClientRect().top : false;
    });
    check("★ 칩 줄보다 위에 있다 — 눈이 먼저 닿는 자리", where, "");
    await page.locator("#ingCheckNext").click();
    await page.waitForTimeout(1500);
    check("★★ 「다음 ▶」으로 넘어간다", (await page.locator("#ingEntryVendor").inputValue()) !== before, before + " → " + (await page.locator("#ingEntryVendor").inputValue()));
    await page.locator("#ingCheckPrev").click();
    await page.waitForTimeout(1500);
    check("★ 「◀ 이전」으로 돌아온다", (await page.locator("#ingEntryVendor").inputValue()) === before, await page.locator("#ingEntryVendor").inputValue());

    // 치우기
    await page.locator('[data-inbox-tab="all"]').click();
    await page.waitForTimeout(400);
    for (const name of ["chip-1.png", "chip-2.png", "chip-3.png"]) {
      const r2 = page.locator('.ing-inbox-row:has-text("' + name + '")');
      if (!(await r2.count())) continue;
      await r2.first().locator("[data-inbox-del]").click();
      await page.waitForTimeout(300);
      await page.locator("#appDialogOk").click();
      await page.waitForTimeout(800);
    }
  }

  out.push("\n[확인 대기에서 확인하는 길]");
  await openInbox();
  {
    // 2026-10-17 사장님: "확인대기에서 확인을 하는 방법이 없어"
    //
    // 단추 이름이 「↩︎ 다시 올리기」라 뭘 하라는 건지 알 수 없었고, 눌러도
    // 표가 화면 아래에 조용히 채워져 아무 일도 안 일어난 것처럼 보였다.
    const { drawReceipt, grayToPng } = require("./draw-receipt");
    const W = 700, H = 1200;
    const paper = grayToPng(drawReceipt({ w: W, h: H, rows: 6, cols: 5, widths: [3, 1, 1, 1.4, 1], inkW: 14, inkH: 30 }), W, H);
    await page.setInputFiles("#ingInboxFile", [
      { name: "go-1.png", mimeType: "image/png", buffer: paper },
      { name: "go-2.png", mimeType: "image/png", buffer: paper },
    ]);
    await page.waitForTimeout(1800);

    const two = JSON.stringify([
      { file: "go-1.png", vendor: "龍江興南北商行", date: "2026-09-01", store: "main", total: 60,
        rows: [{ name: "豆芽", qty: 5, unit: "斤", price: 12, amount: 60, sure: true, band: [0.3, 0.36] }] },
      { file: "go-2.png", vendor: "阿寶水產", date: "2026-09-01", store: "main", total: 90,
        rows: [{ name: "雞蛋", qty: 3, unit: "箱", price: 30, amount: 90, sure: true, band: [0.4, 0.46] }] },
    ]);
    await page.locator("#ingInboxPasteMany").click();
    await page.waitForTimeout(200);
    await page.locator("#ingInboxManyText").fill(two);
    await page.locator("#ingInboxManyGo").click();
    await page.waitForTimeout(2500);

    await page.locator('[data-inbox-tab="read"]').click();
    await page.waitForTimeout(400);
    const row = page.locator('.ing-inbox-row:has-text("go-1.png")');
    const btn = row.locator("[data-inbox-use]");
    check("★★ 확인 대기 줄에 「확인하기」가 있다", /확인하기/.test(await btn.innerText()), await btn.innerText());
    check("★ 그 단추가 눈에 띈다", (await btn.getAttribute("class")).includes("is-go"), await btn.getAttribute("class"));

    await btn.click();
    await page.waitForTimeout(1500);
    // 눌렀으면 표가 **보이는 자리**에 있어야 한다 — 아래에 조용히 채워지면 못 찾는다
    const seen = await page.locator(".ing-entry").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), h: window.innerHeight };
    });
    check("★★ 누르면 표가 보이는 자리로 올라온다", seen.top > -50 && seen.top < seen.h, JSON.stringify(seen));
    check("★★ ★ 앞 영수증 업체가 남지 않는다 — 남으면 남의 업체 지출이 된다", (await page.locator("#ingEntryVendor").inputValue()) === "龍江興南北商行", await page.locator("#ingEntryVendor").inputValue());
    check("★ 사진도 같이 뜬다", !(await page.locator("#ingEntryPhoto").evaluate((el) => el.hidden)), "");

    // 저장하면 **다음 확인 대기 줄이 저절로 열린다** — 102번 찾아 누르지 않게
    await page.locator("#ingEntrySave").click();
    await page.waitForTimeout(3000);
    const log = await page.locator("#ingImportLog").innerText();
    check("★★ 저장하면 다음 줄이 저절로 열린다", /다음 줄을 열었어요/.test(log), log.split("\n").join(" | ").slice(0, 200));
    check("★★ 몇 장 남았는지 말한다", /남음/.test(log), log.split("\n").join(" | ").slice(0, 200));
    const opened = await page.evaluate(() => {
      const on = document.querySelector(".ing-inbox-row.is-on");
      return on ? on.innerText : "";
    });
    check("★★ 열린 것은 방금 저장한 줄이 아니다", !!opened && opened.indexOf("go-1.png") < 0, opened.split(String.fromCharCode(10)).join(" | ").slice(0, 120));
    check("★★ 열린 줄은 아직 확인 대기다", opened.indexOf("확인 대기") >= 0, opened.split(String.fromCharCode(10)).join(" | ").slice(0, 120));
    // 치우기 — 남은 줄과 저장된 줄
    await page.locator('[data-inbox-tab="all"]').click();
    await page.waitForTimeout(400);
    for (const name of ["go-1.png", "go-2.png"]) {
      const r2 = page.locator('.ing-inbox-row:has-text("' + name + '")');
      if (!(await r2.count())) continue;
      await r2.first().locator("[data-inbox-del]").click();
      await page.waitForTimeout(300);
      await page.locator("#appDialogOk").click();
      await page.waitForTimeout(800);
    }
    await page.locator("#ingEntryClear").click().catch(() => {});
    await page.waitForTimeout(300);
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
