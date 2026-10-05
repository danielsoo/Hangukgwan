// 칸 하나를 읽을 때 **어디서 얼마나 잃는가.**
//
//   (가) 글자를 자리 수대로 쪼갰나      — 쪼개기에서 잃는 몫
//   (나) 쪼갠 글자를 다 맞게 읽었나      — 판별기에서 잃는 몫
//   (다) 그래서 그 칸 숫자가 맞았나
//
// 줄 수가 엑셀과 맞은 영수증에서만 잰다(그래야 어느 칸이 무슨 값인지 안다).
const fs = require("fs");
const path = require("path");
const http = require("http");
const T = require("./truth.js");
const { launchBrowser } = require("../test/browser");

const DIR = process.env.HG_PIX || path.join(__dirname, "allpix");
const APP = path.join(__dirname, "..", "public", "js");
const PER = Number(process.env.PER || 250);
const TABS = Number(process.env.TABS || 7);

const PAGE = `<!doctype html><meta charset="utf-8">
<script src="/js/receipt-ocr.js"></script>
<script src="/js/receipt-digits.js"></script>
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

async function look(job) {
  const R = window.HG_RECEIPT;
  const RR = window.HG_RECEIPT_READ;
  const o = { cells: 0, segOk: 0, readOk: 0, digits: 0, digitOk: 0, fixOk: 0 };
  let g;
  try {
    const blob = await (await fetch("/pix/" + encodeURIComponent(job.name))).blob();
    g = await RR.toGray(new File([blob], job.name, { type: "image/jpeg" }));
  } catch (e) { return o; }
  let found;
  try { found = R.findReceipts(g.gray, g.w, g.h); } catch (e) { return o; }
  if (found.length !== 1) return o;
  const grid = found[0].grid;
  const cs = R.cells(grid);
  const L = R.pickColumns(grid, cs) || R.labelColumns(cs);
  if (!L) return o;
  const used = R.usedRows(grid, cs, L.amount);
  if (used.length !== job.want.length) return o;

  used.forEach((r, i) => {
    const e = job.want[i];
    for (const [col, v] of [[L.price, e.price], [L.amount, e.amount]]) {
      const cell = cs.find((x) => x.row === r && x.col === col);
      if (!cell) continue;
      const text = String(Math.round(v));
      o.cells++;
      const gs = R.glyphs(grid.gray, grid.w, cell, grid.threshold);
      if (gs.length !== text.length) continue;
      o.segOk++;
      // 쪼갠 글자를 하나씩 읽어 본다
      let all = true;
      gs.forEach((gl, j) => {
        const cl = window.HG_RECEIPT_DIGITS.classify(R.toGlyphImage(grid.gray, grid.w, gl, grid.threshold));
        o.digits++;
        if (cl && String(cl.digit) === text[j]) o.digitOk++; else all = false;
      });
      if (all) o.readOk++;
    }
    // 셈으로 고친 뒤 최종으로 맞았나
    const rr = R.readRow(grid, cs, L, r);
    if (rr.value.price === Math.round(e.price)) o.fixOk++;
    if (rr.value.amount === Math.round(e.amount)) o.fixOk++;
  });
  return o;
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
    const v = k.key.split("|")[1];
    if (!byVendor.has(v)) byVendor.set(v, []);
    byVendor.get(v).push({ name, want: want.map((e) => ({ price: e.price, amount: e.amount, qty: e.qty })) });
  }
  const jobs = [];
  for (const [, list] of byVendor) {
    const step = Math.max(1, Math.floor(list.length / PER));
    let n = 0;
    for (let i = 0; i < list.length && n < PER; i += step) { jobs.push(list[i]); n++; }
  }
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await launchBrowser();
  const pages = [];
  for (let i = 0; i < TABS; i++) {
    const p = await (await browser.newContext()).newPage();
    await p.goto(base + "/", { waitUntil: "load" });
    pages.push(p);
  }
  const tot = { cells: 0, segOk: 0, readOk: 0, digits: 0, digitOk: 0, fixOk: 0 };
  let next = 0;
  async function worker(page) {
    for (;;) {
      const i = next++;
      if (i >= jobs.length) return;
      let r;
      try { r = await page.evaluate(look, jobs[i]); } catch (e) { r = null; }
      if (!r) continue;
      for (const k of Object.keys(tot)) tot[k] += r[k];
    }
  }
  await Promise.all(pages.map(worker));
  const pc = (a, b) => (b ? ((a / b) * 100).toFixed(1) + "%" : "-");
  console.log(`\n짝지은 칸 ${tot.cells}개 (단가·금액)\n`);
  console.log(`  1) 글자를 자리 수대로 쪼갠 칸      ${tot.segOk}  ${pc(tot.segOk, tot.cells)}`);
  console.log(`  2) 그 중 글자를 다 맞게 읽은 칸    ${tot.readOk}  ${pc(tot.readOk, tot.segOk)} (쪼갠 것만 셈)`);
  console.log(`     글자 하나로 치면                ${tot.digitOk}/${tot.digits} = ${pc(tot.digitOk, tot.digits)}`);
  console.log(`  3) 셈으로 고친 뒤 **최종으로 맞은 칸** ${tot.fixOk}  ${pc(tot.fixOk, tot.cells)}`);
  console.log(`\n  쪼개기에서 잃는 몫  ${pc(tot.cells - tot.segOk, tot.cells)}`);
  console.log(`  판별기에서 잃는 몫  ${pc(tot.segOk - tot.readOk, tot.cells)}`);
  await browser.close();
  srv.close();
})();
