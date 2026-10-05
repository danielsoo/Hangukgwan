// 영수증 사진 한 장 → 「날짜·업체·줄들」. **기기 안에서** 읽는다.
//
// 2026-10-05 사장님: "영수증을 올리면 가격 품목 어디서 언제 샀는지를 내가
// 직접 타자로 쳐서 하나하나 입력하는 게 아니라 적용되도록." AI 없이 간다는
// 결정도 같은 날 하셨다("그대로 가"). 사진은 기기 밖으로 나가지 않는다.
//
// 표 찾기는 receipt-ocr.js, 숫자 읽기는 receipt-digits.js 가 한다. 여기는
// 그 둘을 사진에 붙이고 **사장님이 눈으로 맞춰 보실 그림을 같이 잘라낸다.**
//
// ── 왜 그림을 같이 돌려주는가
//
// 숫자 하나를 88% 로 읽으면 세 자리 금액은 68% 다. 진짜 사진 318줄에서 「믿을
// 수 있다」고 한 줄이 35% 였고 그 중 91% 가 맞았다. 그 91% 를 그냥 장부에
// 넣으면 열 줄에 한 줄이 **멀쩡해 보이는 채로** 틀린다.
//
// 그래서 숫자 옆에 그 칸을 잘라낸 그림을 붙인다. 종이를 다시 찾아 줄을 짚는
// 것보다 눈으로 한 번 보는 것이 훨씬 빠르다 — 사장님이 하실 일은 「치기」가
// 아니라 「보기」가 된다.
(function (root) {
  "use strict";

  const OCR = () => root.HG_RECEIPT || (typeof require === "function" ? require("./receipt-ocr") : null);

  /**
   * 사진을 회색 점으로 바꾼다.
   *
   * 긴 쪽을 1,600점으로 줄인다. 요즘 폰은 4,000점이 넘는데 표 찾기는 그만한
   * 해상도가 필요 없고(사장님 스캔이 720~1,100점이다), 큰 사진은 기울기를
   * 재는 데만 몇 초씩 걸린다. 너무 줄이면 한 점 굵기 선이 사라지므로 1,600
   * 아래로는 내리지 않는다.
   */
  async function toGray(file, opts) {
    const o = Object.assign({ maxSide: 1600 }, opts || {});
    const bmp = await loadBitmap(file);
    const scale = Math.min(1, o.maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const cv = makeCanvas(w, h);
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    const gray = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
      // 사람 눈에 맞춘 비율. 파란 펜과 하늘색 인쇄선을 같이 어둡게 보려면
      // 파랑을 너무 깎지 않는 편이 낫다.
      gray[i] = (px[j] * 77 + px[j + 1] * 151 + px[j + 2] * 28) >> 8;
    }
    if (bmp.close) bmp.close();
    return { gray, w, h };
  }

  function makeCanvas(w, h) {
    if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(w, h);
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    return cv;
  }

  async function loadBitmap(file) {
    if (typeof createImageBitmap === "function") {
      // 폰 사진은 EXIF 로 누워 있다 — 브라우저가 돌려 주게 맡긴다.
      try { return await createImageBitmap(file, { imageOrientation: "from-image" }); }
      catch (e) { return await createImageBitmap(file); }
    }
    return await new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("이미지를 못 읽었습니다")); };
      img.src = url;
    });
  }

  /** 그 칸을 잘라 작은 그림으로. 사장님이 눈으로 맞춰 보실 것. */
  function cropPng(grid, cell, opts) {
    const o = Object.assign({ height: 34, pad: 2 }, opts || {});
    if (!cell || typeof document === "undefined") return null;
    const x0 = Math.max(0, cell.x0 - o.pad), y0 = Math.max(0, cell.y0 - o.pad);
    const x1 = Math.min(grid.w, cell.x1 + o.pad), y1 = Math.min(grid.h, cell.y1 + o.pad);
    const cw = x1 - x0, ch = y1 - y0;
    if (cw < 2 || ch < 2) return null;
    const scale = o.height / ch;
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(cw * scale));
    cv.height = o.height;
    const ctx = cv.getContext("2d");
    const src = ctx.createImageData(cw, ch);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const v = grid.gray[(y0 + y) * grid.w + x0 + x];
        const i = (y * cw + x) * 4;
        src.data[i] = src.data[i + 1] = src.data[i + 2] = v;
        src.data[i + 3] = 255;
      }
    }
    const tmp = document.createElement("canvas");
    tmp.width = cw; tmp.height = ch;
    tmp.getContext("2d").putImageData(src, 0, 0);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(tmp, 0, 0, cv.width, cv.height);
    return cv.toDataURL("image/png");
  }

  /**
   * 사진 하나를 읽는다.
   *
   * @returns {{receipts: Array, note: string}} — 영수증마다
   *   `{rows: [{qty, price, amount, ok, fixed, pic:{name,qty,price,amount}}], warn}`
   */
  async function readPhoto(file, opts) {
    const o = Object.assign({ pics: true, priceSet: null }, opts || {});
    const R = OCR();
    if (!R) return { receipts: [], note: "ocr-missing" };
    const { gray, w, h } = await toGray(file, o);
    const found = R.findReceipts(gray, w, h);
    if (!found.length) return { receipts: [], note: "no-table" };

    const out = [];
    for (const { grid } of found) {
      const cs = R.cells(grid);
      const L = R.labelColumns(cs);
      if (!L) { out.push({ rows: [], warn: "no-columns" }); continue; }
      const rowNos = [...new Set(cs.map((c) => c.row))].sort((a, b) => a - b);
      const at = (r, col) => cs.find((x) => x.row === r && x.col === col);
      const rows = [];
      for (const r of rowNos) {
        // 맨 윗줄은 인쇄된 머리글(品名 數量 單價 金額)이다.
        if (r === rowNos[0]) continue;
        const am = at(r, L.amount);
        if (!am || R.inkOf(grid.gray, grid.w, am, grid.threshold) <= 0.05) continue;
        const rr = R.readRow(grid, cs, L, r, o);
        rows.push({
          row: r,
          qty: rr.value.qty,
          price: rr.value.price,
          amount: rr.value.amount,
          ok: rr.ok,
          fixed: rr.fixed,
          certainty: rr.certainty,
          pic: o.pics ? {
            name: cropPng(grid, at(r, L.name)),
            qty: cropPng(grid, at(r, L.qty)),
            price: cropPng(grid, at(r, L.price)),
            amount: cropPng(grid, at(r, L.amount)),
          } : null,
        });
      }
      out.push({ rows, cols: L, lines: grid.hLines.length });
    }
    return { receipts: out, note: "" };
  }

  const api = { readPhoto, toGray, cropPng };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.HG_RECEIPT_READ = api;
})(typeof window !== "undefined" ? window : globalThis);
