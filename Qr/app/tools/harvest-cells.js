// 칸을 **통째로** 배우려고 「칸 그림 + 그 칸의 숫자」를 모은다.
//
// 지금은 글자를 하나씩 쪼개서 배운다. 그런데 재보니 쪼개기에서 **53.6%** 를
// 잃고 판별기에서는 11.5% 밖에 안 잃는다(tools/segloss.js). 쪼개는 단계를
// 아예 없애는 것이 제일 큰 몫이다.
//
// 모으는 것도 쉬워진다. 글자 수가 자리 수와 맞아야 정답을 붙일 수 있던
// 제약이 사라지므로 **짝지은 칸을 전부** 쓴다(46% → 100%).
//
// 칸 그림은 높이 32에 맞춰 눕히고 가로는 최대 160까지 담는다. 비율을 지켜
// 줄이므로 자리 수가 많은 칸은 가로가 길다.
const fs = require("fs");
const path = require("path");
const http = require("http");
const T = require("./truth.js");
const { launchBrowser } = require("../test/browser");

const DIR = process.env.HG_PIX || path.join(__dirname, "allpix");
const APP = path.join(__dirname, "..", "public", "js");
const TABS = Number(process.env.TABS || 8);
const H = 32, W = 160;

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
  const out = { name: job.name, cells: [], note: "" };
  let g;
  try {
    const blob = await (await fetch("/pix/" + encodeURIComponent(job.name))).blob();
    g = await RR.toGray(new File([blob], job.name, { type: "image/jpeg" }));
  } catch (e) { out.note = "decode"; return out; }
  let found;
  try { found = R.findReceipts(g.gray, g.w, g.h); } catch (e) { out.note = "ocr"; return out; }
  if (found.length !== 1) { out.note = "panels"; return out; }
  const grid = found[0].grid;
  const cs = R.cells(grid);
  const L = R.pickColumns(grid, cs) || R.labelColumns(cs);
  if (!L) { out.note = "no-columns"; return out; }
  const used = R.usedRows(grid, cs, L.amount);
  if (used.length !== job.want.length) { out.note = "rows"; return out; }

  const H = 32, W = 160;
  /** 칸을 높이 32 에 맞춰 눕힌 그림으로. 0 바탕 1 잉크. */
  function strip(cell) {
    const sc = H / cell.h;
    const tw = Math.min(W, Math.max(4, Math.round(cell.w * sc)));
    const img = new Uint8Array(H * W);     // 오른쪽은 0(바탕)으로 남는다
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < tw; x++) {
        // 원본에서 그 자리에 해당하는 네모를 평균낸다
        const sx0 = cell.x0 + Math.floor((x * cell.w) / tw);
        const sx1 = Math.max(sx0 + 1, cell.x0 + Math.floor(((x + 1) * cell.w) / tw));
        const sy0 = cell.y0 + Math.floor((y * cell.h) / H);
        const sy1 = Math.max(sy0 + 1, cell.y0 + Math.floor(((y + 1) * cell.h) / H));
        let n = 0, hit = 0;
        for (let yy = sy0; yy < sy1; yy++) {
          for (let xx = sx0; xx < sx1; xx++) { n++; if (grid.gray[yy * grid.w + xx] < grid.threshold) hit++; }
        }
        img[y * W + x] = n ? Math.round((hit / n) * 255) : 0;
      }
    }
    return { img, tw };
  }
  const pack = (u8) => {
    let s = "";
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s);
  };

  used.forEach((r, i) => {
    const e = job.want[i];
    for (const [col, v] of [[L.price, e.price], [L.amount, e.amount]]) {
      const cell = cs.find((x) => x.row === r && x.col === col);
      if (!cell || cell.h < 8 || cell.w < 8) continue;
      const text = String(Math.round(v));
      if (!/^\d{1,7}$/.test(text)) continue;
      const st = strip(cell);
      out.cells.push({ t: text, w: st.tw, b: pack(st.img) });
    }
  });
  return out;
}

(async () => {
  const truth = await T.load();
  const all = fs.readdirSync(DIR).filter((f) => /\.(jpg|jpeg|png)$/i.test(f)).sort();
  const jobs = [];
  for (const name of all) {
    const k = T.keyOf(name.replace(/\.(jpg|jpeg|png)$/i, ""));
    if (!k) continue;
    const want = truth.get(k.key);
    if (!want) continue;
    jobs.push({ name, want: want.map((e) => ({ price: e.price, amount: e.amount, qty: e.qty })) });
  }
  console.log(`사진 ${jobs.length}장 · 탭 ${TABS}개`);
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await launchBrowser();
  const pages = [];
  for (let i = 0; i < TABS; i++) {
    const p = await (await browser.newContext()).newPage();
    await p.goto(base + "/", { waitUntil: "load" });
    pages.push(p);
  }
  const stream = fs.createWriteStream(path.join(__dirname, "cells.bin"));
  const photos = [];
  const index = [];
  let done = 0, n = 0;
  const notes = {};
  const t0 = Date.now();
  let next = 0;
  async function worker(page) {
    for (;;) {
      const i = next++;
      if (i >= jobs.length) return;
      let got;
      try { got = await page.evaluate(inPage, jobs[i]); }
      catch (e) { got = { name: jobs[i].name, cells: [], note: "throw" }; }
      done++;
      if (got.note) notes[got.note] = (notes[got.note] || 0) + 1;
      if (got.cells.length) {
        let id = photos.indexOf(got.name);
        if (id < 0) { photos.push(got.name); id = photos.length - 1; }
        for (const c of got.cells) {
          // 머리: 사진 번호(2) · 글자 수(1) · 숫자(7, 남는 자리는 0xff) · 쓴 너비(1)
          const head = Buffer.alloc(11);
          head.writeUInt16LE(id & 0xffff, 0);
          head[2] = c.t.length;
          for (let j = 0; j < 7; j++) head[3 + j] = j < c.t.length ? +c.t[j] : 0xff;
          head[10] = Math.min(255, c.w);
          stream.write(head);
          stream.write(Buffer.from(c.b, "base64"));
          n++;
        }
      }
      if (done % 500 === 0) {
        const s = (Date.now() - t0) / 1000;
        console.log(`  ${done}/${jobs.length} (${(done / s).toFixed(1)}장/초) 칸 ${n}`);
      }
    }
  }
  await Promise.all(pages.map(worker));
  await new Promise((r) => stream.end(r));
  fs.writeFileSync(path.join(__dirname, "cells-photos.json"), JSON.stringify(photos));
  console.log(`\n끝. ${((Date.now() - t0) / 60000).toFixed(1)}분`);
  console.log(`칸 ${n}개 (사진 ${photos.length}장) → cells.bin`);
  console.log(`못 쓴 까닭: ${Object.entries(notes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  await browser.close();
  srv.close();
})();
