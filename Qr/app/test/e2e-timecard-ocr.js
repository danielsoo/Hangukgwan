// 출근 카드 사진을 AI 없이 읽는다 (public/js/timecard-ocr.js).
//
// 2026-10-03 사장님: "사진 렌더해서 인식하는 걸 꼭 에이아이가 있어야 하냐고" → "그렇게
// 해줘 손글씨로 인식이 되면 직접 채워 넣어야 한다는 걸 표시해줘."
//
// 사장님이 보내신 6월 카드 두 장(이름 칸은 지웠다 — test/fixtures/timecard-*.webp)을
// 진짜 브라우저에서 읽고, 손으로 옮긴 시각표와 맞춘다. 재는 것:
//   · 찍힌 시각을 맞게 읽는가 — 그리고 **틀린 값을 표시 없이 넣지 않는가**(틀릴 바엔
//     「확실치 않음」이어야 급여가 조용히 틀리지 않는다)
//   · 손글씨 칸(3일 오전 퇴근 「14:05」, 30일 오후 출근 「16」 고쳐 씀)을 손글씨로 알아보는가
//   · 별(★) 카드를 알아보는가
//   · 휴대폰처럼 기울고(2.5°) 작고(60%) 누런 사진에서도 틀린 값을 넣지 않는가
const path = require("path");
const fs = require("fs");
const { launchBrowser } = require("./browser");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

// test/payroll.test.js 와 같은 카드 — 손으로 옮긴 답.
const NORMAL = [[2,"09:11","14:00","16:04","21:00"],[3,"09:19","14:05","16:08","21:00"],[4,"09:06","14:00","16:05","21:01"],[5,"09:08","13:57","16:05","21:06"],[7,"09:02","14:26","16:14","21:23"],[9,"09:00","14:16","16:15","21:09"],[10,"09:03","14:00","16:14","21:01"],[11,"09:00","14:02","16:12","21:00"],[13,"08:58","14:07","16:10","21:14"],[14,"09:06","14:04","16:11","21:11"],[16,"09:01","13:58","16:12","21:32"],[17,"09:08","14:09","16:00","21:00"],[18,"09:05","14:00","16:12","21:11"],[20,"09:13","14:01","16:04","21:11"],[21,"09:02","14:07","16:12","21:30"],[23,"09:06","14:01","16:13","21:25"],[24,"09:13","14:00","16:11","21:00"],[26,"09:04","14:00","16:08","20:55"],[27,"09:00","14:14","16:12","21:03"],[28,"09:02","14:38","16:07","23:12"],[30,"09:06","14:00","16:05","21:00"]];
const STAR = [[6,"09:11","14:02","16:10","21:00"],[12,"09:04","14:00","16:11","21:08"],[19,"09:00","14:07","16:07","21:06"],[25,"09:11","14:00","16:14","20:58"]];
const SL = ["am_in", "am_out", "pm_in", "pm_out"];
const truthOf = (rows) => Object.fromEntries(rows.map(([d, ...t]) => [d, t]));

function grade(cards, truth) {
  let ok = 0, flagged = 0, wrong = [], total = 0, hand = [];
  for (const c of cards) {
    for (const h of c.handwritten) hand.push(`${h.day}${h.slot}`);
    const unclear = new Set(c.unclear.map((u) => `${u.day}|${u.slot}`));
    for (const [day, row] of Object.entries(c.days)) {
      for (const [slot, time] of Object.entries(row)) {
        const t = truth[day];
        const want = t && SL.includes(slot) ? t[SL.indexOf(slot)] : null;
        if (!want) { wrong.push(`${day}${slot} 없는데 ${time}`); continue; }
        if (time === want) { if (!unclear.has(`${day}|${slot}`)) ok++; else flagged++; }
        else if (unclear.has(`${day}|${slot}`)) flagged++;
        else wrong.push(`${day}${slot} ${time}≠${want}`);
      }
    }
  }
  for (const t of Object.values(truth)) total += t.length;
  return { ok, flagged, wrong, total, hand };
}

(async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setContent("<html><body></body></html>");
  const pub = path.join(__dirname, "../public/js");
  await page.addScriptTag({ content: fs.readFileSync(path.join(pub, "timecard-templates.js"), "utf8") });
  await page.addScriptTag({ content: fs.readFileSync(path.join(pub, "timecard-ocr.js"), "utf8") });
  const b64 = (f) => "data:image/webp;base64," + fs.readFileSync(path.join(__dirname, "fixtures", f)).toString("base64");

  // 브라우저에서 사진을 그리고(필요하면 돌리고 줄이고 누렇게) 읽는다 — 화면이 하는 그대로.
  const read = (src, opt = {}) => page.evaluate(async ([src, opt]) => {
    const img = new Image();
    await new Promise((r) => { img.onload = r; img.src = src; });
    const k = opt.scale || 1;
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ebe8e1";
    ctx.fillRect(0, 0, c.width, c.height);
    if (opt.rotate) { ctx.translate(c.width / 2, c.height / 2); ctx.rotate((opt.rotate * Math.PI) / 180); ctx.translate(-c.width / 2, -c.height / 2); }
    if (opt.filter) ctx.filter = opt.filter;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const data = ctx.getImageData(0, 0, c.width, c.height);
    // 전등 아래 사진처럼 — 채널마다 어둡고 누렇게(파랑이 가장 많이 준다).
    if (opt.tint) for (let i = 0; i < data.data.length; i += 4) for (let ch = 0; ch < 3; ch++) data.data[i + ch] *= opt.tint[ch];
    const t0 = performance.now();
    const r = window.HG_TIMECARD.readTimecards(data);
    return { ...r, ms: Math.round(performance.now() - t0) };
  }, [src, opt]);

  out.push("[별 없는 카드 — 원본 스캔]");
  const n = await read(b64("timecard-normal.webp"));
  check("카드 두 면(1~15일 파랑, 16~31일 주황)을 찾는다", n.cards.length === 2 && n.cards.map((c) => c.color).join() === "blue,orange", JSON.stringify(n.cards.map((c) => c.color)));
  check("★ 별 없는 카드는 별이 아니다", n.cards.every((c) => !c.star), "");
  const gn = grade(n.cards, truthOf(NORMAL));
  check(`★★ 찍힌 시각 대부분을 맞게 읽는다 (${gn.ok}/${gn.total - 2}, 확인 필요 ${gn.flagged})`, gn.ok >= 70, "");
  check("★★ 틀린 값을 표시 없이 넣지 않는다", gn.wrong.length === 0, gn.wrong.join(" "));
  check("★★ 손글씨 칸 — 3일 오전 퇴근(14:05), 30일 오후 출근(16 고쳐 씀)", gn.hand.sort().join() === "30pm_in,3am_out", gn.hand.join());
  check("손글씨 칸에는 값을 넣지 않는다", !(n.cards[0].days["3"] || {}).am_out && !(n.cards[1].days["30"] || {}).pm_in, "");
  check("밑줄(파란 펜)은 손글씨로 치지 않는다 — 7·16·21·23·28일", !gn.hand.some((h) => /^(7|16|21|23|28)/.test(h)), gn.hand.join());
  check("빨간 메모(0.5 · 1)는 시각으로 읽지 않는다 — 연장 칸이 비어 있다", n.cards.every((c) => Object.values(c.days).every((d) => !d.ot_in && !d.ot_out)), "");
  check(`읽는 데 3초 안 (${n.ms}ms)`, n.ms < 3000, `${n.ms}ms`);

  out.push("\n[★ 카드]");
  const st = await read(b64("timecard-star.webp"));
  check("★★ 별 카드를 알아본다", st.cards.length === 2 && st.cards.every((c) => c.star), JSON.stringify(st.cards.map((c) => c.star)));
  const gs = grade(st.cards, truthOf(STAR));
  check(`★ 4일 16칸 (${gs.ok}/16)`, gs.ok >= 15 && gs.wrong.length === 0, gs.wrong.join(" "));

  out.push("\n[휴대폰처럼 — 틀린 값은 넣지 않는다]");
  for (const [name, opt] of [
    ["2.5° 기울임", { rotate: 2.5 }],
    ["60% 크기", { scale: 0.6 }],
    ["누렇고 어둡게", { tint: [0.84, 0.78, 0.64] }],
    ["기울고 줄고 누렇고 흐리게", { rotate: -1.5, scale: 0.75, tint: [0.86, 0.82, 0.72], filter: "blur(0.5px)" }],
  ]) {
    const r = await read(b64("timecard-normal.webp"), opt);
    const g = grade(r.cards, truthOf(NORMAL));
    check(`${name}: 카드 둘 · 손글씨 둘 · 틀림 0 (맞음 ${g.ok}, 확인 필요 ${g.flagged}, 기울기 ${r.skew}°)`, r.cards.length === 2 && g.hand.length === 2 && g.wrong.length === 0 && g.ok >= 40, g.wrong.join(" ") + " hand " + g.hand.join());
  }

  out.push("\n[카드가 아닌 사진]");
  const blank = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 800; c.height = 600;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 800, 600);
    ctx.fillStyle = "#333"; ctx.font = "40px sans-serif"; ctx.fillText("hello 12:34", 100, 300);
    return window.HG_TIMECARD.readTimecards(ctx.getImageData(0, 0, 800, 600));
  });
  check("★ 카드가 없으면 아무것도 지어내지 않는다", blank.cards.length === 0, JSON.stringify(blank));

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
