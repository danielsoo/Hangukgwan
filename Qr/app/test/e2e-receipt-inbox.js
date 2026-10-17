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

  out.push("\n[전부 받기 — 한 파일로]");
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

  out.push("\n[사진의 그 줄을 숫자 밑에]");
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

  out.push("\n[줄 자리를 못 찾으면 — 지어내지 않는다]");
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
