// 칸 종류를 **글자 모양으로** 가릴 수 있나.
//
// 지금은 너비로 가린다(품명이 제일 넓고 금액이 그 다음) — 房信 전표에 맞춘
// 규칙이라 다른 업체에서 어긋난다. 전표의 칸 차례는 어디나 비슷하다:
//
//     品名  …  數量  單價  金額  [備考]
//
// 그러니 **어느 칸이 숫자 칸인가**만 알면 된다. 금액은 제일 오른쪽 숫자 칸,
// 단가는 그 왼쪽, 수량은 또 그 왼쪽이다.
//
// 숫자와 한자는 모양이 다르다 — 숫자는 홀쭉하고(가로/세로 0.4~0.8) 한자는
// 네모지다(0.8~1.2). 그게 실제로 갈리는지 잰다.
const fs = require("fs");
const path = require("path");
const http = require("http");
const T = require("./truth.js");
const { launchBrowser } = require("../test/browser");

const DIR = process.env.HG_PIX || path.join(__dirname, "allpix");
const APP = path.join(__dirname, "..", "public", "js");
const PER = Number(process.env.PER || 40);
const TABS = Number(process.env.TABS || 6);

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

async function probe(job) {
  const R = window.HG_RECEIPT;
  const RR = window.HG_RECEIPT_READ;
  const out = { vendor: job.vendor, nCols: 0, cols: [] };
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
  const rowNos = [...new Set(cs.map((c) => c.row))].sort((a, b) => a - b);
  const body = rowNos.slice(1);
  for (const c of cols) {
    const asp = [], per = [];
    let inked = 0;
    let wid = 0;
    for (const r of body) {
      const cell = cs.find((x) => x.row === r && x.col === c);
      if (!cell) continue;
      wid = Math.max(wid, cell.w);
      if (R.inkOf(grid.gray, grid.w, cell, grid.threshold) <= 0.05) continue;
      inked++;
      const gs = R.glyphs(grid.gray, grid.w, cell, grid.threshold);
      per.push(gs.length);
      for (const gl of gs) {
        const gw = gl.x1 - gl.x0, gh = gl.y1 - gl.y0;
        if (gh > 4) asp.push(gw / gh);
      }
    }
    const med = (a) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
    out.cols.push({
      col: c, w: wid, inked, rows: body.length,
      aspect: med(asp), glyphs: med(per),
    });
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
    if (!truth.get(k.key)) continue;
    const v = k.key.split("|")[1];
    if (!byVendor.has(v)) byVendor.set(v, []);
    byVendor.get(v).push({ name, vendor: v });
  }
  const only = (process.env.VENDORS || "").split(",").filter(Boolean);
  const jobs = [];
  for (const [v, list] of byVendor) {
    if (only.length && !only.includes(v)) continue;
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
  const acc = new Map();   // "vendor|nCols" → col → {n, asp, gl, inked, rows, w}
  let next = 0;
  async function worker(page) {
    for (;;) {
      const i = next++;
      if (i >= jobs.length) return;
      let r;
      try { r = await page.evaluate(probe, jobs[i]); } catch (e) { r = null; }
      if (!r || !r.nCols) continue;
      const key = `${r.vendor}|${r.nCols}`;
      const t = acc.get(key) || { photos: 0, cols: {} };
      t.photos++;
      for (const c of r.cols) {
        const a = t.cols[c.col] || { n: 0, asp: 0, aspN: 0, gl: 0, glN: 0, inked: 0, rows: 0, w: 0 };
        a.n++;
        if (c.aspect != null) { a.asp += c.aspect; a.aspN++; }
        if (c.glyphs != null) { a.gl += c.glyphs; a.glN++; }
        a.inked += c.inked; a.rows += c.rows; a.w += c.w;
        t.cols[c.col] = a;
      }
      acc.set(key, t);
    }
  }
  await Promise.all(pages.map(worker));

  console.log("업체|칸수            사진  칸마다: 너비 · 가로세로비 · 글자수 · 쓴줄%");
  for (const [key, t] of [...acc.entries()].sort((a, b) => b[1].photos - a[1].photos)) {
    if (t.photos < 10) continue;
    const parts = Object.keys(t.cols).map(Number).sort((a, b) => a - b).map((c) => {
      const a = t.cols[c];
      const asp = a.aspN ? (a.asp / a.aspN).toFixed(2) : " -  ";
      const gl = a.glN ? (a.gl / a.glN).toFixed(1) : "-";
      const fill = a.rows ? Math.round((a.inked / a.rows) * 100) : 0;
      return `${c}:${Math.round(a.w / a.n)}/${asp}/${gl}/${fill}%`;
    });
    console.log(`${key.padEnd(24)} ${String(t.photos).padStart(4)}  ${parts.join("  ")}`);
  }
  await browser.close();
  srv.close();
})();
