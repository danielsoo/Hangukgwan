// 영수증을 **그린다** — 시험용.
//
// 진짜 사진은 사장님 장부라 저장소에 안 들어간다(receipt-ocr.test.js 머리말).
// 선과 글씨를 직접 그리면 기울기도 칸 너비도 마음대로 만들 수 있고, 무엇을
// 재는지가 코드에 그대로 보인다. 유닛 시험과 브라우저 시험이 **같은 종이**를
// 쓰도록 여기 한 곳에 둔다.
const PAPER = 232; // 노란 전표도 회색으로 바꾸면 이쯤 밝다
const LINE = 96;   // 인쇄된 파란 선
const PEN = 70;    // 손글씨
const HALO = 150;  // 선 가장자리. 스캔하면 선이 칼같지 않고 번진다 —
                   // 이 번짐 때문에 칸을 자를 때 여백을 넉넉히 둬야 한다.

/**
 * 영수증 한 장을 그린다.
 * @param o {w,h,rows,cols,skew,margin,ink}
 */
function drawReceipt(o) {
  const { w, h } = o;
  const g = new Uint8Array(w * h).fill(PAPER);
  const m = o.margin == null ? Math.round(w * 0.06) : o.margin;
  const skew = o.skew || 0;
  const x0 = m, x1 = w - m;
  const y0 = Math.round(h * 0.25), y1 = h - m; // 위쪽은 상호·전화번호 자리
  const put = (x, y, v) => {
    const yy = y + Math.round(skew * (x - w / 2));
    const xx = x;
    if (xx >= 0 && xx < w && yy >= 0 && yy < h) g[yy * w + xx] = v;
  };
  // 가로선
  for (let r = 0; r <= o.rows; r++) {
    const y = Math.round(y0 + ((y1 - y0) * r) / o.rows);
    for (let x = x0; x <= x1; x++) { put(x, y - 1, HALO); put(x, y, LINE); put(x, y + 1, LINE); put(x, y + 2, HALO); }
  }
  // 세로선 — 기운 종이에서는 x 가 아래로 갈수록 밀린다
  //
  // 칸 너비를 따로 줄 수 있다. 진짜 영수증은 품명 칸이 훨씬 넓고(房信 전표는
  // 374 · 131 · 131 · 205 · 113), 어느 칸이 금액인지는 그 비율로 가린다
  // (labelColumns). 다 같은 너비로 그리면 그 함수를 잴 수가 없다.
  const rel = o.widths && o.widths.length === o.cols ? o.widths : new Array(o.cols).fill(1);
  const relSum = rel.reduce((a2, b2) => a2 + b2, 0);
  const edgeAt = (c) => {
    let acc = 0;
    for (let i = 0; i < c; i++) acc += rel[i];
    return Math.round(x0 + ((x1 - x0) * acc) / relSum);
  };
  for (let c = 0; c <= o.cols; c++) {
    const bx = edgeAt(c);
    for (let y = y0; y <= y1; y++) {
      const x = bx - Math.round(skew * (y - h / 2));
      if (x >= 0 && x < w) {
        const yy = y + Math.round(skew * (x - w / 2));
        if (yy >= 0 && yy < h) {
          if (x - 1 >= 0) g[yy * w + x - 1] = HALO;
          g[yy * w + x] = LINE;
          if (x + 1 < w) g[yy * w + x + 1] = LINE;
          if (x + 2 < w) g[yy * w + x + 2] = HALO;
        }
      }
    }
  }
  // 칸마다 글씨 몇 점 — 선이 아니라 글씨라는 것을 알아보는지 보려고
  if (o.ink !== false) {
    for (let r = 0; r < o.rows; r++) {
      for (let c = 0; c < o.cols; c++) {
        const cx = Math.round(edgeAt(c) + (edgeAt(c + 1) - edgeAt(c)) * 0.4);
        const cy = Math.round(y0 + ((y1 - y0) * (r + 0.5)) / o.rows);
        // 글씨 크기. 칸 대비 잉크가 5% 를 넘어야 usedRows 가 「쓴 줄」로 센다 —
        // 줄이 적은 전표를 그릴 때는 키워야 한다(inkW·inkH).
        const iw = o.inkW == null ? 6 : o.inkW, ih = o.inkH == null ? 3 : o.inkH;
        for (let dy = -ih; dy <= ih; dy++) for (let dx = -iw; dx <= iw; dx++) put(cx + dx, cy + dy, PEN);
      }
    }
  }
  return g;
}

/**
 * 그린 회색 그림을 PNG 바이트로. 브라우저 시험이 진짜 사진처럼 올릴 때 쓴다.
 */
function grayToPng(g, w, h) {
  const { PNG } = require("pngjs");
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    const v = g[i];
    png.data[i * 4] = png.data[i * 4 + 1] = png.data[i * 4 + 2] = v;
    png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}

module.exports = { PAPER, LINE, PEN, HALO, drawReceipt, grayToPng };
