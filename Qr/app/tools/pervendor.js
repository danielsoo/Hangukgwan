// 업체마다 얼마나 읽히는가. 房信 로만 맞춰 놓은 것이 다른 양식에서 어떤지.
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
const PER = Number(process.env.PER || 60);
const ONLY = process.env.ONLY || "";
const READOPT = JSON.parse(process.env.READOPT || "{}");   // 업체마다 몇 장씩

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

async function inPage(job) {
  const R = window.HG_RECEIPT;
  const RR = window.HG_RECEIPT_READ;
  const o = { vendor: job.vendor, grid: 0, cols: 0, paired: 0, rows: 0, want: job.want.length, right: 0, white: 0, whiteRight: 0, nCols: 0 };
  let g;
  try {
    const blob = await (await fetch("/pix/" + encodeURIComponent(job.name))).blob();
    g = await RR.toGray(new File([blob], job.name, { type: "image/jpeg" }));
  } catch (e) { return o; }
  let found;
  try { found = R.findReceipts(g.gray, g.w, g.h); } catch (e) { return o; }
  if (!found.length) return o;
  o.grid = 1;
  const grid = found[0].grid;
  const cs = R.cells(grid);
  o.nCols = [...new Set(cs.map((c) => c.col))].length;
  const L = R.labelColumns(cs);
  if (!L) return o;
  o.cols = 1;
  const rowNos = [...new Set(cs.map((c) => c.row))].sort((a, b) => a - b);
  const used = rowNos.filter((r) => {
    if (r === rowNos[0]) return false;
    const c = cs.find((x) => x.row === r && x.col === L.amount);
    return c && R.inkOf(grid.gray, grid.w, c, grid.threshold) > 0.05;
  });
  o.rows = used.length;
  if (found.length !== 1 || used.length !== job.want.length) return o;
  o.paired = 1;
  used.forEach((r, i) => {
    const e = job.want[i];
    const row = R.readRow(grid, cs, L, r, job.opt);
    const ok = row.value.price === Math.round(e.price) && row.value.amount === Math.round(e.amount)
      && row.value.qty != null && Math.abs(row.value.qty - e.qty) < 0.005;
    if (ok) o.right++;
    if (row.ok) { o.white++; if (ok) o.whiteRight++; }
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
    const vendor = k.key.split("|")[1];
    if (!byVendor.has(vendor)) byVendor.set(vendor, []);
    byVendor.get(vendor).push({ name, vendor, opt: READOPT, want: want.map((e) => ({ price: e.price, amount: e.amount, qty: e.qty })) });
  }
  const jobs = [];
  for (const [v, list] of byVendor) {
    if (ONLY && v !== ONLY) continue;
    const step = Math.max(1, Math.floor(list.length / PER));
    for (let i = 0; i < list.length && jobs.filter((j) => j.vendor === v).length < PER; i += step) jobs.push(list[i]);
  }
  console.log(`업체 ${byVendor.size}곳 · 사진 ${jobs.length}장 (업체마다 최대 ${PER})\n`);

  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await launchBrowser();
  const pages = [];
  for (let i = 0; i < TABS; i++) {
    const p = await (await browser.newContext()).newPage();
    await p.goto(base + "/", { waitUntil: "load" });
    pages.push(p);
  }
  const acc = new Map();
  let next = 0;
  async function worker(page) {
    for (;;) {
      const i = next++;
      if (i >= jobs.length) return;
      let r;
      try { r = await page.evaluate(inPage, jobs[i]); } catch (e) { r = { vendor: jobs[i].vendor, grid: 0, cols: 0, paired: 0, rows: 0, want: 0, right: 0, white: 0, whiteRight: 0, nCols: 0 }; }
      const a = acc.get(r.vendor) || { n: 0, grid: 0, cols: 0, paired: 0, rows: 0, right: 0, white: 0, whiteRight: 0, colHist: {} };
      a.n++; a.grid += r.grid; a.cols += r.cols; a.paired += r.paired;
      a.rows += r.paired ? r.want : 0; a.right += r.right; a.white += r.white; a.whiteRight += r.whiteRight;
      if (r.grid) a.colHist[r.nCols] = (a.colHist[r.nCols] || 0) + 1;
      acc.set(r.vendor, a);
    }
  }
  await Promise.all(pages.map(worker));

  const rows = [...acc.entries()].sort((x, y) => y[1].n - x[1].n);
  const pc = (a, b) => (b ? Math.round((a / b) * 100) + "%" : "-");
  console.log("업체".padEnd(22) + "사진  표찾음  칸가림  줄맞음   줄   셋다맞음   흰칸 그중맞음  칸수");
  let tot = { n: 0, grid: 0, cols: 0, paired: 0, rows: 0, right: 0, white: 0, whiteRight: 0 };
  for (const [v, a] of rows) {
    for (const k of Object.keys(tot)) tot[k] += a[k] || 0;
    const top = Object.entries(a.colHist).sort((p, q) => q[1] - p[1]).slice(0, 2).map(([c, n]) => `${c}칸×${n}`).join(" ");
    console.log(
      v.padEnd(20) + String(a.n).padStart(5) + pc(a.grid, a.n).padStart(8) + pc(a.cols, a.n).padStart(8) +
      pc(a.paired, a.n).padStart(8) + String(a.rows).padStart(5) + pc(a.right, a.rows).padStart(9) +
      String(a.white).padStart(7) + pc(a.whiteRight, a.white).padStart(8) + "  " + top
    );
  }
  console.log("\n" + "전부".padEnd(20) + String(tot.n).padStart(5) + pc(tot.grid, tot.n).padStart(8) + pc(tot.cols, tot.n).padStart(8) +
    pc(tot.paired, tot.n).padStart(8) + String(tot.rows).padStart(5) + pc(tot.right, tot.rows).padStart(9) +
    String(tot.white).padStart(7) + pc(tot.whiteRight, tot.white).padStart(8));
  await browser.close();
  srv.close();
})();
