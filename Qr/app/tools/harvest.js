// 사진 13,777장을 브라우저에서 읽어 **정답 붙은 숫자 그림**을 모은다.
//
// node 에 JPEG 디코더가 없고, 어차피 사장님 화면이 브라우저이므로 같은 길로
// 돌리는 것이 맞다. 탭 여러 개로 나눠 돈다.
//
// 두 가지로 모은다 (eval.js 와 같은 구분):
//  (가) paired — 종이 줄 수가 엑셀 줄 수와 **맞은** 영수증에서, 칸의 글자 수가
//       엑셀 자리 수와 같을 때. 지금 판별기가 뭐라 읽었는지와 상관없이 모인다.
//       **시험은 이것으로만** 한다.
//  (나) boot — 읽은 (단가, 금액) 짝이 그 영수증의 엑셀 줄과 똑같을 때. 정답은
//       맞지만 지금 판별기가 맞힌 것만 모인다. 배우는 데만 쓴다.
const fs = require("fs");
const path = require("path");
const http = require("http");
const T = require("./truth.js");
const { launchBrowser } = require("../test/browser");

// 압축 파일에서 꺼낸 사진이 있는 자리(저장소에 안 들어간다).
//   HG_PIX=D:/영수증사진  node tools/harvest.js
const DIR = process.env.HG_PIX || path.join(__dirname, "allpix");
const APP = path.join(__dirname, "..", "public", "js");
const TABS = Number(process.env.TABS || 6);
const LIMIT = Number(process.env.LIMIT || 0);

const PAGE = `<!doctype html><meta charset="utf-8"><title>harvest</title>
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

// 페이지 안에서 도는 몸통. 사진 하나를 읽고 정답을 붙인다.
async function inPage(job) {
  const R = window.HG_RECEIPT;
  const RR = window.HG_RECEIPT_READ;
  const out = { name: job.name, paired: [], boot: [], note: "", rows: 0, want: job.want.length };
  let gray, w, h;
  try {
    const blob = await (await fetch("/pix/" + encodeURIComponent(job.name))).blob();
    const got = await RR.toGray(new File([blob], job.name, { type: "image/jpeg" }));
    gray = got.gray; w = got.w; h = got.h;
  } catch (e) { out.note = "decode"; return out; }
  let found;
  try { found = R.findReceipts(gray, w, h); } catch (e) { out.note = "ocr"; return out; }
  if (!found.length) { out.note = "no-table"; return out; }

  // 28×28 Float32 → base64 (한 점 한 바이트)
  const pack = (img) => {
    let s = "";
    for (let i = 0; i < 784; i++) s += String.fromCharCode(Math.round(Math.max(0, Math.min(1, img[i])) * 255));
    return btoa(s);
  };
  const idx = new Map();
  for (const e of job.want) {
    const k = Math.round(e.price) + "|" + Math.round(e.amount);
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k).push(e);
  }

  for (const { grid } of found) {
    const cs = R.cells(grid);
    const L = R.labelColumns(cs);
    if (!L) { out.note = out.note || "no-columns"; continue; }
    const rowNos = [...new Set(cs.map((c) => c.row))].sort((a, b) => a - b);
    const used = rowNos.filter((r) => {
      if (r === rowNos[0]) return false;
      const c = cs.find((x) => x.row === r && x.col === L.amount);
      return c && R.inkOf(grid.gray, grid.w, c, grid.threshold) > 0.05;
    });
    out.rows += used.length;

    // (가) 줄 수가 맞은 영수증
    if (found.length === 1 && used.length === job.want.length) {
      used.forEach((r, i) => {
        const e = job.want[i];
        for (const [col, v] of [[L.price, e.price], [L.amount, e.amount]]) {
          const cell = cs.find((x) => x.row === r && x.col === col);
          if (!cell) continue;
          const text = String(Math.round(v));
          const gs = R.glyphs(grid.gray, grid.w, cell, grid.threshold);
          if (gs.length !== text.length) continue;
          gs.forEach((g, j) => out.paired.push({ d: +text[j], b: pack(R.toGlyphImage(grid.gray, grid.w, g, grid.threshold)) }));
        }
      });
    }

    // (나) 읽은 짝이 엑셀에 있는 줄
    for (const r of used) {
      const pc = cs.find((x) => x.row === r && x.col === L.price);
      const am = cs.find((x) => x.row === r && x.col === L.amount);
      if (!pc || !am) continue;
      const P = R.readNumber(grid.gray, grid.w, pc, grid.threshold);
      const A = R.readNumber(grid.gray, grid.w, am, grid.threshold);
      if (!P || !A || !(P.value > 0) || !(A.value > 0)) continue;
      const cand = idx.get(P.value + "|" + A.value);
      if (!cand || !cand.some((e) => Math.abs(e.qty - A.value / P.value) < 0.005)) continue;
      for (const rd of [P, A]) {
        rd.each.forEach((g, j) => out.boot.push({ d: +rd.text[j], b: pack(R.toGlyphImage(grid.gray, grid.w, g.box, grid.threshold)) }));
      }
    }
  }
  return out;
}

(async () => {
  const truth = await T.load();
  let names = fs.readdirSync(DIR).filter((f) => /\.(jpg|jpeg|png)$/i.test(f)).sort();
  if (LIMIT) names = names.filter((_, i) => i % Math.ceil(names.length / LIMIT) === 0);
  const jobs = [];
  for (const name of names) {
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

  const pairedF = fs.createWriteStream(path.join(__dirname, "big-paired.bin"));
  const bootF = fs.createWriteStream(path.join(__dirname, "big-boot.bin"));
  const pairedPhotos = [], bootPhotos = [];
  let done = 0, nPaired = 0, nBoot = 0;
  const notes = {};
  const t0 = Date.now();

  let next = 0;
  async function worker(page) {
    for (;;) {
      const i = next++;
      if (i >= jobs.length) return;
      let got;
      try { got = await page.evaluate(inPage, jobs[i]); }
      catch (e) { got = { name: jobs[i].name, paired: [], boot: [], note: "throw" }; }
      done++;
      if (got.note) notes[got.note] = (notes[got.note] || 0) + 1;
      const write = (stream, items, list) => {
        if (!items.length) return 0;
        let id = list.indexOf(got.name);
        if (id < 0) { list.push(got.name); id = list.length - 1; }
        const buf = Buffer.alloc(items.length * 787);
        items.forEach((it, j) => {
          const o = j * 787;
          buf[o] = it.d;
          buf.writeUInt16LE(id & 0xffff, o + 1);
          Buffer.from(it.b, "base64").copy(buf, o + 3);
        });
        stream.write(buf);
        return items.length;
      };
      nPaired += write(pairedF, got.paired, pairedPhotos);
      nBoot += write(bootF, got.boot, bootPhotos);
      if (done % 250 === 0) {
        const s = (Date.now() - t0) / 1000;
        console.log(`  ${done}/${jobs.length}  (${(done / s).toFixed(1)}장/초, 남은 ${Math.round((jobs.length - done) / (done / s) / 60)}분)  정답 ${nPaired} + ${nBoot}`);
      }
    }
  }
  await Promise.all(pages.map(worker));
  await new Promise((r) => pairedF.end(r));
  await new Promise((r) => bootF.end(r));
  fs.writeFileSync(path.join(__dirname, "big-paired-photos.json"), JSON.stringify(pairedPhotos));
  fs.writeFileSync(path.join(__dirname, "big-boot-photos.json"), JSON.stringify(bootPhotos));
  console.log(`\n끝. ${((Date.now() - t0) / 60000).toFixed(1)}분`);
  console.log(`치우치지 않은 정답 ${nPaired}자 (사진 ${pairedPhotos.length}장)`);
  console.log(`배우기용 정답     ${nBoot}자 (사진 ${bootPhotos.length}장)`);
  console.log(`못 읽은 까닭: ${Object.entries(notes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  await browser.close();
  srv.close();
})();
