// 한 업체의 영수증 몇 장을 「읽은 값 vs 엑셀」로 나란히 찍어 본다.
const fs = require("fs");
const path = require("path");
const http = require("http");
const T = require("./truth.js");
const { launchBrowser } = require("../test/browser");

const DIR = process.env.HG_PIX || path.join(__dirname, "allpix");
const APP = path.join(__dirname, "..", "public", "js");
const VENDOR = process.env.VENDOR || "阿麵製麵";
const N = Number(process.env.N || 5);

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
  const out = { name: job.name, note: "", cols: null, lines: [], widths: null };
  let g;
  try {
    const blob = await (await fetch("/pix/" + encodeURIComponent(job.name))).blob();
    g = await RR.toGray(new File([blob], job.name, { type: "image/jpeg" }));
  } catch (e) { out.note = "decode"; return out; }
  const found = R.findReceipts(g.gray, g.w, g.h);
  if (!found.length) { out.note = "표 못 찾음"; return out; }
  const grid = found[0].grid;
  const cs = R.cells(grid);
  const cols = [...new Set(cs.map((c) => c.col))].sort((a, b) => a - b);
  out.widths = cols.map((c) => Math.max(...cs.filter((x) => x.col === c).map((x) => x.w)));
  const picked = R.pickColumns(grid, cs);
  const L = picked || R.labelColumns(cs);
  if (!L) { out.note = "칸 못 가림"; return out; }
  out.cols = { name: L.name, qty: L.qty, price: L.price, amount: L.amount, picked: !!picked, hit: L.hit, rows: L.rows };
  const used = R.usedRows(grid, cs, L.amount);
  // 칸마다 날것으로 읽은 값도 같이 본다
  out.raw = {};
  for (const c of cols) {
    out.raw[c] = used.slice(0, 6).map((r) => {
      const cell = cs.find((x) => x.row === r && x.col === c);
      if (!cell) return "-";
      if (R.inkOf(grid.gray, grid.w, cell, grid.threshold) <= 0.05) return ".";
      const rd = R.readNumber(grid.gray, grid.w, cell, grid.threshold);
      return rd ? rd.text : "?";
    }).join(" ");
  }
  used.forEach((r, i) => {
    const rr = R.readRow(grid, cs, L, r);
    const e = job.want[i];
    out.lines.push({
      got: [rr.value.qty, rr.value.price, rr.value.amount],
      want: e ? [e.qty, Math.round(e.price), Math.round(e.amount)] : null,
      ok: rr.ok,
    });
  });
  out.paper = used.length;
  out.excel = job.want.length;
  return out;
}

(async () => {
  const truth = await T.load();
  const all = fs.readdirSync(DIR).filter((f) => /\.(jpg|jpeg|png)$/i.test(f));
  const list = [];
  for (const name of all) {
    const k = T.keyOf(name.replace(/\.(jpg|jpeg|png)$/i, ""));
    if (!k) continue;
    const want = truth.get(k.key);
    if (!want) continue;
    if (k.key.split("|")[1] !== VENDOR) continue;
    list.push({ name, want: want.map((e) => ({ price: e.price, amount: e.amount, qty: e.qty })) });
  }
  const step = Math.max(1, Math.floor(list.length / N));
  const jobs = [];
  for (let i = 0; i < list.length && jobs.length < N; i += step) jobs.push(list[i]);

  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await launchBrowser();
  const page = await (await browser.newContext()).newPage();
  await page.goto(base + "/", { waitUntil: "load" });
  for (const j of jobs) {
    const r = await page.evaluate(look, j);
    console.log(`\n== ${r.name}`);
    if (r.note) { console.log(`   ${r.note}`); continue; }
    console.log(`   칸 너비 ${r.widths.join(" ")} · 고른 칸 품명${r.cols.name} 수량${r.cols.qty} 단가${r.cols.price} 금액${r.cols.amount}` +
      (r.cols.picked ? ` (셈으로, ${r.cols.hit}/${r.cols.rows}줄)` : " (너비로)"));
    console.log(`   종이 ${r.paper}줄 / 엑셀 ${r.excel}줄`);
    for (const [c, v] of Object.entries(r.raw)) console.log(`     칸${c} 날것: ${v}`);
    for (const l of r.lines.slice(0, 8)) {
      const w = l.want ? `${l.want[0]} × ${l.want[1]} = ${l.want[2]}` : "(엑셀 줄 없음)";
      const got = `${l.got[0]} × ${l.got[1]} = ${l.got[2]}`;
      const same = l.want && String(l.got[1]) === String(l.want[1]) && String(l.got[2]) === String(l.want[2]);
      console.log(`     ${l.ok ? "흰" : "노랑"}  읽음 ${got.padEnd(24)} 엑셀 ${w.padEnd(22)} ${same ? "✔" : "✗"}`);
    }
  }
  await browser.close();
  srv.close();
})();
