// 찾은 선을 사진 위에 그려 **눈으로 본다.** 숫자만 보고 고치려니 어디가
// 틀렸는지 알 수가 없었다(업체 19곳이 0% 인데 까닭을 못 짚었다).
//
// 가로선 파랑 · 세로선 빨강 · 고른 금액 칸 초록 테두리.
const fs = require("fs");
const path = require("path");
const http = require("http");
const T = require("./truth.js");
const { launchBrowser } = require("../test/browser");

const DIR = process.env.HG_PIX || path.join(__dirname, "allpix");
const APP = path.join(__dirname, "..", "public", "js");
const VENDORS = (process.env.VENDORS || "").split(",").filter(Boolean);
const N = Number(process.env.N || 6);
const CELL = Number(process.env.CELL || 300);

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

async function draw(arg) {
  const { names, cell } = arg;
  const R = window.HG_RECEIPT;
  const RR = window.HG_RECEIPT_READ;
  const cols = Math.min(names.length, 6);
  const rows = Math.ceil(names.length / cols);
  const cv = document.createElement("canvas");
  cv.width = cols * cell;
  cv.height = rows * (cell + 18);
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#222";
  ctx.fillRect(0, 0, cv.width, cv.height);
  const notes = [];
  for (let i = 0; i < names.length; i++) {
    const ox = (i % cols) * cell, oy = Math.floor(i / cols) * (cell + 18);
    let g;
    try {
      const blob = await (await fetch("/pix/" + encodeURIComponent(names[i]))).blob();
      g = await RR.toGray(new File([blob], names[i], { type: "image/jpeg" }));
    } catch (e) { notes.push("decode"); continue; }
    const sc = Math.min(cell / g.w, cell / g.h);
    // 회색 사진을 그린다
    const tmp = document.createElement("canvas");
    tmp.width = g.w; tmp.height = g.h;
    const tctx = tmp.getContext("2d");
    const im = tctx.createImageData(g.w, g.h);
    for (let j = 0; j < g.gray.length; j++) {
      const o = j * 4;
      im.data[o] = im.data[o + 1] = im.data[o + 2] = g.gray[j];
      im.data[o + 3] = 255;
    }
    tctx.putImageData(im, 0, 0);
    const dw = Math.round(g.w * sc), dh = Math.round(g.h * sc);
    ctx.drawImage(tmp, ox, oy, dw, dh);

    let found = [];
    try { found = R.findReceipts(g.gray, g.w, g.h); } catch (e) { /* 아래에서 적는다 */ }
    if (!found.length) {
      ctx.fillStyle = "rgba(255,0,0,.25)";
      ctx.fillRect(ox, oy, dw, dh);
      notes.push("표 못 찾음");
    } else {
      for (const { grid } of found) {
        const cs = R.cells(grid);
        const L = R.labelColumns(cs);
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(40,120,255,.9)";
        for (const y of grid.hLines) {
          ctx.beginPath(); ctx.moveTo(ox, oy + y * sc); ctx.lineTo(ox + dw, oy + y * sc); ctx.stroke();
        }
        ctx.strokeStyle = "rgba(255,40,40,.9)";
        for (const x of grid.vLines) {
          ctx.beginPath(); ctx.moveTo(ox + x * sc, oy); ctx.lineTo(ox + x * sc, oy + dh); ctx.stroke();
        }
        if (L) {
          const paint = (col, color) => {
            const c0 = cs.find((c) => c.col === col);
            if (!c0) return;
            const x0 = Math.min(...cs.filter((c) => c.col === col).map((c) => c.x0));
            const x1 = Math.max(...cs.filter((c) => c.col === col).map((c) => c.x1));
            ctx.fillStyle = color;
            ctx.fillRect(ox + x0 * sc, oy, (x1 - x0) * sc, dh);
          };
          paint(L.amount, "rgba(0,255,0,.18)");
          paint(L.price, "rgba(255,255,0,.14)");
        }
        notes.push(`${grid.hLines.length}줄 ${grid.vLines.length - 1}칸${L ? "" : " (칸 못 가림)"}`);
      }
    }
    ctx.fillStyle = "#fff";
    ctx.font = "12px monospace";
    ctx.fillText(notes[notes.length - 1] || "?", ox + 3, oy + dh + 13);
  }
  return { png: cv.toDataURL("image/png"), notes };
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
    byVendor.get(v).push(name);
  }
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await launchBrowser();
  const page = await (await browser.newContext({ viewport: { width: 1900, height: 1100 } })).newPage();
  await page.goto(base + "/", { waitUntil: "load" });

  const pick = VENDORS.length ? VENDORS : [...byVendor.keys()];
  for (const v of pick) {
    const list = byVendor.get(v);
    if (!list) { console.log(`${v}: 사진 없음`); continue; }
    const step = Math.max(1, Math.floor(list.length / N));
    const names = [];
    for (let i = 0; i < list.length && names.length < N; i += step) names.push(list[i]);
    const got = await page.evaluate(draw, { names, cell: CELL });
    const out = path.join(__dirname, `grid-${v}.png`);
    fs.writeFileSync(out, Buffer.from(got.png.split(",")[1], "base64"));
    console.log(`${v.padEnd(18)} ${got.notes.join(" · ")}`);
  }
  await browser.close();
  srv.close();
})();
