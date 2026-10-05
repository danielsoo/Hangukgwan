// 업체마다 전표 한 장씩을 모아 **사장님께 보여드릴 한 장**을 만든다.
// 지금 얼마나 읽히는지도 같이 적는다.
const fs = require("fs");
const path = require("path");
const http = require("http");
const T = require("./truth.js");
const { launchBrowser } = require("../test/browser");

const DIR = process.env.HG_PIX || path.join(__dirname, "allpix");
const APP = path.join(__dirname, "..", "public", "js");
const OUT = process.env.OUT || path.join(__dirname, "gallery.png");
const COLS = Number(process.env.COLS || 5);
const CELL = Number(process.env.CELL || 360);
const WHICH = process.env.WHICH || "ruled";

// 2026-10-05 측정: 표찾음 / 칸가림 / 한 줄 다 맞음
const STAT = {
  "房信菓菜行": [94, 86, 40], "韓濟": [91, 75, 34], "泳慶蛋行": [90, 80, 14],
  "台裕行": [98, 88, 6], "萬濱企業": [100, 96, 5], "億豊行": [99, 93, 3],
  "丸邱菓菜行": [96, 89, 0], "阿麵製麵": [99, 89, 0], "萬通水産食品行": [99, 93, 0],
  "鷄蛋": [97, 95, 0], "旺旺來商行": [79, 64, 0], "源香企業有限公司": [95, 63, 0],
  "新竹錦海産批發商": [94, 39, 0], "大川食品行": [86, 23, 0], "明楷蔬果行": [100, 100, 0],
  "千宇開發": [19, 9, 0], "思皓企業社": [25, 19, 0], "瑞騰國際": [16, 9, 0],
  "阿寶水産": [18, 1, 0], "龍江興南北商行": [19, 13, 0],
};
const RULED = ["房信菓菜行", "韓濟", "泳慶蛋行", "台裕行", "萬濱企業", "億豊行",
  "丸邱菓菜行", "阿麵製麵", "萬通水産食品行", "鷄蛋", "旺旺來商行", "源香企業有限公司",
  "新竹錦海産批發商", "大川食品行", "明楷蔬果行"];
const PRINTED = ["龍江興南北商行", "阿寶水産", "千宇開發", "思皓企業社", "瑞騰國際"];

const PAGE = `<!doctype html><meta charset="utf-8">
<style>body{margin:0}</style>
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

async function build(arg) {
  const { items, cell, cols, title } = arg;
  const rows = Math.ceil(items.length / cols);
  const HEAD = 56, FOOT = 56;
  const cv = document.createElement("canvas");
  cv.width = cols * cell;
  cv.height = HEAD + rows * (cell + FOOT);
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#15171a";
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 26px 'Noto Sans KR', sans-serif";
  ctx.fillText(title, 16, 36);

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const ox = (i % cols) * cell;
    const oy = HEAD + Math.floor(i / cols) * (cell + FOOT);
    try {
      const blob = await (await fetch("/pix/" + encodeURIComponent(it.name))).blob();
      const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
      const pad = 10;
      const box = cell - pad * 2;
      const sc = Math.min(box / bmp.width, box / bmp.height);
      const dw = Math.round(bmp.width * sc), dh = Math.round(bmp.height * sc);
      ctx.fillStyle = "#000";
      ctx.fillRect(ox + pad, oy + pad, box, box);
      ctx.drawImage(bmp, ox + pad + (box - dw) / 2, oy + pad + (box - dh) / 2, dw, dh);
      bmp.close && bmp.close();
    } catch (e) { /* 못 읽으면 빈칸 */ }
    // 이름과 숫자
    ctx.fillStyle = "#fff";
    ctx.font = "bold 20px 'Noto Sans TC', 'Noto Sans KR', sans-serif";
    ctx.fillText(it.vendor, ox + 12, oy + cell + 20);
    const s = it.stat;
    ctx.font = "15px 'Noto Sans KR', monospace";
    ctx.fillStyle = s[2] >= 30 ? "#7ddc7d" : s[2] > 0 ? "#e8d27a" : "#e88a8a";
    ctx.fillText(`사진 ${it.count}장 · 표 ${s[0]}% · 칸 ${s[1]}% · 줄 ${s[2]}%`, ox + 12, oy + cell + 42);
  }
  return cv.toDataURL("image/png");
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
  const want = WHICH === "printed" ? PRINTED : RULED;
  const items = [];
  for (const v of want) {
    const list = byVendor.get(v);
    if (!list || !list.length) continue;
    // 가운데쯤 한 장 — 첫 장은 흐린 경우가 많다
    items.push({ vendor: v, name: list[Math.floor(list.length / 2)], count: list.length, stat: STAT[v] || [0, 0, 0] });
  }
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await launchBrowser();
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.goto(base + "/", { waitUntil: "load" });
  const title = WHICH === "printed"
    ? "줄 친 표가 없는 전표 — 전산 출력 (다른 길이 필요합니다)"
    : "줄 친 표를 쓰는 업체 — 지금 읽고 있는 전표들";
  const png = await page.evaluate(build, { items, cell: CELL, cols: COLS, title });
  fs.writeFileSync(OUT, Buffer.from(png.split(",")[1], "base64"));
  console.log(`${OUT} (${items.length}곳)`);
  await browser.close();
  srv.close();
})();
