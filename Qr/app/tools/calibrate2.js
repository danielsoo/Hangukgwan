// 업체마다 어느 칸이 수량·단가·금액인지 — **숫자를 읽지 않고** 알아낸다.
//
// 앞서 읽어서 맞춰 보려 했으나(calibrate.js) 房信 말고는 한 곳도 못 가렸다.
// 당연하다 — 판별기가 房信 글씨만 배웠으니 다른 업체 숫자는 읽히지 않는다.
// 그런데 칸을 모르면 정답을 못 붙이고, 정답이 없으면 못 배운다. 닭과 알이다.
//
// 읽지 않고 쓸 수 있는 단서가 둘 있다:
//
//  1. **금액 칸은 쓴 줄에만 적혀 있다.** 그 칸에 글씨가 있는 줄 수가 엑셀 줄
//     수와 같으면 그 칸이 금액(이나 단가)일 가망이 크다.
//  2. **글자 수는 자리 수와 같다.** 엑셀 단가가 세 자리면 단가 칸에 글자가
//     세 개다. 한 줄로는 약한 단서지만 사진 수백 장을 모으면 갈린다.
//
// 수량 칸은 단위(斤·把)가 같이 적혀 있어 글자가 하나 더 많을 수 있으므로
// 0 이나 +1 을 다 센다.
const fs = require("fs");
const path = require("path");
const http = require("http");
const T = require("./truth.js");
const { launchBrowser } = require("../test/browser");

// 압축 파일에서 꺼낸 사진이 있는 자리(저장소에 안 들어간다).
//   HG_PIX=D:/영수증사진  node tools/harvest.js
const DIR = process.env.HG_PIX || path.join(__dirname, "allpix");
const APP = path.join(__dirname, "..", "public", "js");
const TABS = Number(process.env.TABS || 8);
const PER = Number(process.env.PER || 400);

const PAGE = `<!doctype html><meta charset="utf-8">
<script src="/js/receipt-ocr.js"></script>
<script src="/js/receipt-read.js"></script>`;

function serve() {
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split("?")[0]);
    if (u === "/") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return res.end(PAGE); }
    if (u.startsWith("/js/")) {
      const p = path.join(APP, u.slice(4));
      if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(fs.readFileSync(p));
    }
    if (u.startsWith("/pix/")) {
      const p = path.join(DIR, u.slice(5));
      if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "no-store" });
      return res.end(fs.readFileSync(p));
    }
    res.writeHead(404); res.end();
  });
  return new Promise((r) => srv.listen(0, () => r(srv)));
}

async function inPage(job) {
  const R = window.HG_RECEIPT;
  const RR = window.HG_RECEIPT_READ;
  const out = { vendor: job.vendor, nCols: 0, widths: null, fit: [], votes: {} };
  let g;
  try {
    const blob = await (await fetch("/pix/" + encodeURIComponent(job.name))).blob();
    g = await RR.toGray(new File([blob], job.name, { type: "image/jpeg" }));
  } catch (e) { return out; }
  let found;
  try { found = R.findReceipts(g.gray, g.w, g.h); } catch (e) { return out; }
  if (found.length !== 1) return out;
  const grid = found[0].grid;
  const cs = R.cells(grid);
  const cols = [...new Set(cs.map((c) => c.col))].sort((a, b) => a - b);
  if (cols.length < 3) return out;
  out.nCols = cols.length;
  out.widths = cols.map((c) => Math.max(...cs.filter((x) => x.col === c).map((x) => x.w)));

  const rowNos = [...new Set(cs.map((c) => c.row))].sort((a, b) => a - b);
  const body = rowNos.slice(1);   // 맨 윗줄은 인쇄된 머리글

  // 칸마다 「글씨 있는 줄」과 그 줄의 글자 수
  const inked = {}, nglyph = {};
  for (const c of cols) {
    inked[c] = [];
    nglyph[c] = {};
    for (const r of body) {
      const cell = cs.find((x) => x.row === r && x.col === c);
      if (!cell) continue;
      if (R.inkOf(grid.gray, grid.w, cell, grid.threshold) <= 0.05) continue;
      inked[c].push(r);
      nglyph[c][r] = R.glyphs(grid.gray, grid.w, cell, grid.threshold).length;
    }
  }
  const digits = (v) => String(Math.round(v)).length;
  for (const c of cols) {
    // 1) 쓴 줄 수가 엑셀 줄 수와 같은가
    if (inked[c].length === job.want.length) out.fit.push(c);
    else continue;
    // 2) 글자 수가 자리 수와 맞나 (줄을 차례로 짝지어)
    const v = { qty: 0, price: 0, amount: 0, n: 0 };
    inked[c].forEach((r, i) => {
      const e = job.want[i];
      const n = nglyph[c][r] || 0;
      v.n++;
      // 수량은 단위가 같이 적혀 글자가 하나 더 많을 수 있다
      if (n === digits(e.qty) || n === digits(e.qty) + 1) v.qty++;
      if (n === digits(e.price)) v.price++;
      if (n === digits(e.amount)) v.amount++;
    });
    out.votes[c] = v;
  }
  return out;
}

(async () => {
  const truth = await T.load();
  const all = fs.readdirSync(DIR).filter((f) => /\.(jpg|jpeg|png)$/i.test(f));
  const byVendor = new Map();
  for (const name of all) {
    const k = T.keyOf(name.replace(/\.(jpg|jpeg|png)$/i, ""));
    if (!k) continue;
    const want = truth.get(k.key);
    if (!want) continue;
    const vendor = k.key.split("|")[1];
    if (!byVendor.has(vendor)) byVendor.set(vendor, []);
    byVendor.get(vendor).push({ name, vendor, want: want.map((e) => ({ price: e.price, amount: e.amount, qty: e.qty })) });
  }
  const jobs = [];
  for (const [, list] of byVendor) {
    const step = Math.max(1, Math.floor(list.length / PER));
    let n = 0;
    for (let i = 0; i < list.length && n < PER; i += step) { jobs.push(list[i]); n++; }
  }
  console.log(`업체 ${byVendor.size}곳 · 사진 ${jobs.length}장`);

  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await launchBrowser();
  const pages = [];
  for (let i = 0; i < TABS; i++) {
    const p = await (await browser.newContext()).newPage();
    await p.goto(base + "/", { waitUntil: "load" });
    pages.push(p);
  }

  const tally = new Map();   // "vendor|nCols" → {photos, cols:{c:{qty,price,amount,n,fit}}, widths}
  let done = 0, next = 0;
  async function worker(page) {
    for (;;) {
      const i = next++;
      if (i >= jobs.length) return;
      let r;
      try { r = await page.evaluate(inPage, jobs[i]); } catch (e) { r = null; }
      done++;
      if (done % 1000 === 0) console.log(`  ${done}/${jobs.length}`);
      if (!r || !r.nCols) continue;
      const key = `${r.vendor}|${r.nCols}`;
      const t = tally.get(key) || { photos: 0, cols: {}, wn: 0, wsum: null };
      t.photos++;
      if (r.widths) {
        if (!t.wsum) t.wsum = r.widths.map(() => 0);
        t.wn++;
        r.widths.forEach((x, j) => { t.wsum[j] += x; });
      }
      for (const c of r.fit) {
        t.cols[c] = t.cols[c] || { qty: 0, price: 0, amount: 0, n: 0, fit: 0 };
        t.cols[c].fit++;
      }
      for (const [c, v] of Object.entries(r.votes)) {
        const a = t.cols[c];
        a.qty += v.qty; a.price += v.price; a.amount += v.amount; a.n += v.n;
      }
      tally.set(key, t);
    }
  }
  await Promise.all(pages.map(worker));

  const forms = {};
  console.log("\n업체|칸수            사진  고른 칸 (수량/단가/금액)          칸 너비 평균");
  for (const [key, t] of [...tally.entries()].sort((a, b) => b[1].photos - a[1].photos)) {
    if (t.photos < 8) continue;
    const cols = Object.entries(t.cols).map(([c, v]) => ({ c: +c, ...v, rate: (f) => v.n ? v[f] / v.n : 0 }));
    if (cols.length < 2) { console.log(`${key.padEnd(24)} ${String(t.photos).padStart(4)}  (칸을 못 가림)`); continue; }
    const rate = (v, f) => (v.n ? v[f] / v.n : 0);
    // 금액 → 단가 → 수량 차례로 고른다. 금액이 제일 또렷한 단서다.
    const pick = (field, taken) => cols.filter((v) => !taken.includes(v.c))
      .sort((a, b) => rate(b, field) - rate(a, field))[0];
    const amount = pick("amount", []);
    const price = pick("price", [amount.c]);
    const qty = pick("qty", [amount.c, price.c]);
    const wid = t.wsum ? t.wsum.map((s) => Math.round(s / t.wn)).join(" ") : "";
    const show = (v, f) => v ? `${v.c}(${Math.round(rate(v, f) * 100)}%)` : "-";
    console.log(`${key.padEnd(24)} ${String(t.photos).padStart(4)}  ${show(qty, "qty").padEnd(9)}${show(price, "price").padEnd(9)}${show(amount, "amount").padEnd(9)}  ${wid}`);
    if (amount && price && rate(amount, "amount") >= 0.5 && rate(price, "price") >= 0.4) {
      forms[key] = {
        qty: qty ? qty.c : null, price: price.c, amount: amount.c,
        photos: t.photos,
        conf: { qty: qty ? +rate(qty, "qty").toFixed(2) : null, price: +rate(price, "price").toFixed(2), amount: +rate(amount, "amount").toFixed(2) },
        widths: t.wsum ? t.wsum.map((s) => Math.round(s / t.wn)) : null,
      };
    }
  }
  fs.writeFileSync(path.join(__dirname, "forms2.json"), JSON.stringify(forms, null, 1));
  console.log(`\nforms2.json 에 ${Object.keys(forms).length}가지 양식`);
  await browser.close();
  srv.close();
})();
