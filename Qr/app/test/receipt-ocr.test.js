// 영수증 사진에서 표를 찾는 것 (public/js/receipt-ocr.js).
//
// 2026-10-05 사장님: "저 사진들을 급여처럼 올리면 인식해서 엑셀에 기입하고
// 우리 시스템에도 기입해서."
//
// ── 글자보다 표가 먼저다
//
// 어디가 어느 칸인지 모르면 품명 칸의 글씨를 단가로 읽게 된다. 숫자가 멀쩡해
// 보이는 채로 장부가 틀어지는 것이라, 안 읽는 것보다 나쁘다.
//
// ── 재는 법: 영수증을 **그려서** 잰다
//
// 진짜 사진을 저장소에 넣지 않는다. 사장님 장부가 저장소에 들어가는 일이고,
// 바이너리라 안에 무엇이 있는지 아무도 못 본다. 대신 **선과 글씨를 직접
// 그려서** 넣는다 — 기울기도 두 장 나란히도 마음대로 만들 수 있고, 무엇을
// 재는지가 코드에 그대로 보인다.
//
// 진짜 사진 120장으로도 재봤다(2026-10-05, 房信菓菜行): 표를 찾은 사진
// 90.0%. 그 측정은 사진이 있어야 해서 여기 들어오지 못한다 — 여기서는
// **고쳐 놓은 것이 다시 깨지지 않는지**를 지킨다.
const R = require("../public/js/receipt-ocr");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const PAPER = 232; // 노란 전표도 회색으로 바꾸면 이쯤 밝다
const LINE = 96;   // 인쇄된 파란 선
const PEN = 70;    // 손글씨

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
    for (let x = x0; x <= x1; x++) { put(x, y, LINE); put(x, y + 1, LINE); }
  }
  // 세로선 — 기운 종이에서는 x 가 아래로 갈수록 밀린다
  for (let c = 0; c <= o.cols; c++) {
    const bx = Math.round(x0 + ((x1 - x0) * c) / o.cols);
    for (let y = y0; y <= y1; y++) {
      const x = bx - Math.round(skew * (y - h / 2));
      if (x >= 0 && x < w) {
        const yy = y + Math.round(skew * (x - w / 2));
        if (yy >= 0 && yy < h) { g[yy * w + x] = LINE; if (x + 1 < w) g[yy * w + x + 1] = LINE; }
      }
    }
  }
  // 칸마다 글씨 몇 점 — 선이 아니라 글씨라는 것을 알아보는지 보려고
  if (o.ink !== false) {
    for (let r = 0; r < o.rows; r++) {
      for (let c = 0; c < o.cols; c++) {
        const cx = Math.round(x0 + ((x1 - x0) * (c + 0.4)) / o.cols);
        const cy = Math.round(y0 + ((y1 - y0) * (r + 0.5)) / o.rows);
        for (let dy = -3; dy <= 3; dy++) for (let dx = -6; dx <= 6; dx++) put(cx + dx, cy + dy, PEN);
      }
    }
  }
  return g;
}

out.push("[문턱값]");
{
  const g = new Uint8Array(1000);
  g.fill(PAPER, 0, 700);
  g.fill(40, 700, 1000);
  const t = R.otsu(g);
  check("★ 종이와 잉크 사이에 선을 긋는다", t > 40 && t < PAPER, `${t}`);
}

out.push("\n[가장 긴 이어진 구간]");
{
  const d = [1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 0, 1];
  check("가장 긴 것을 센다", R.longestRun((i) => !!d[i], d.length, 0) === 5, `${R.longestRun((i) => !!d[i], d.length, 0)}`);
  check("★ 한두 점 끊긴 것은 이어진 것으로 본다 (스캔 잡티)", R.longestRun((i) => !!d[i], d.length, 2) === 12, `${R.longestRun((i) => !!d[i], d.length, 2)}`);
}

out.push("\n[반듯한 영수증]");
{
  const w = 700, h = 1200;
  const g = drawReceipt({ w, h, rows: 12, cols: 5 });
  const grid = R.findGrid(g, w, h);
  check("★ 가로선을 다 찾는다 (13줄)", grid.hLines.length === 13, `${grid.hLines.length}`);
  check("★ 세로선을 다 찾는다 (6줄)", grid.vLines.length === 6, `${grid.vLines.length}`);
  const cells = R.cells(grid);
  check("★ 칸이 12×5 = 60개", cells.length === 60, `${cells.length}`);
  check("표 상자가 잡힌다", !!grid.box, "");
  // 글씨가 있는 칸과 없는 칸을 가린다
  const withInk = cells.filter((c) => R.inkOf(g, w, c, grid.threshold) > 0.005).length;
  check("★ 글씨 있는 칸을 알아본다", withInk >= 55, `${withInk}`);
}

out.push("\n[기울어진 영수증 — 여기서 제일 많이 깨졌다]");
{
  // 2026-10-05: 처음에는 y 만 되돌려서 가로선은 찾는데 세로선이 0~2개였다.
  // 기울기 1.6°, 표 높이 1,300점이면 세로선의 x 가 36점 밀린다.
  const w = 700, h = 1200;
  for (const skew of [0.012, -0.012, 0.028]) {
    const g = drawReceipt({ w, h, rows: 12, cols: 5, skew });
    const grid = R.findGrid(g, w, h);
    check(`★ 기울기 ${skew} — 가로선 13줄`, grid.hLines.length === 13, `${grid.hLines.length}`);
    check(`★★ 기울기 ${skew} — 세로선 6줄 (x 도 되돌려야 한다)`, grid.vLines.length === 6, `${grid.vLines.length}`);
  }
  const g = drawReceipt({ w, h, rows: 12, cols: 5, skew: 0.02 });
  const est = R.estimateSkew(g, w, h, R.otsu(g) + 20);
  check("★ 기울기를 비슷하게 잰다", Math.abs(est - 0.02) < 0.01, `${est.toFixed(4)}`);
}

out.push("\n[한 장에 두 장 — 사장님 스캔에 많다]");
{
  // 2026-10-05: 房信 20250115 처럼 작은 전표를 나란히 두 장 올린 스캔이 많다.
  // 가르지 않으면 왼쪽 품명과 오른쪽 금액이 한 줄이 된다 — 제일 나쁜 고장이다.
  const pw = 600, ph = 1200, gapW = 90;
  const w = pw * 2 + gapW, h = ph;
  const g = new Uint8Array(w * h).fill(255); // 스캐너 바탕(흰색)
  for (const [ox, cols] of [[0, 5], [pw + gapW, 4]]) {
    const one = drawReceipt({ w: pw, h: ph, rows: 10, cols });
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) g[y * w + (ox + x)] = one[y * pw + x];
  }
  const panels = R.splitPanels(g, w, h);
  check("★★ 두 조각으로 가른다", panels.length === 2, `${panels.length}  ${JSON.stringify(panels)}`);
  const found = R.findReceipts(g, w, h);
  check("★★ 영수증 둘을 따로 찾는다", found.length === 2, `${found.length}`);
  if (found.length === 2) {
    const a = found[0].grid, b = found[1].grid;
    check("★ 왼쪽은 세로선 6줄", a.vLines.length === 6, `${a.vLines.length}`);
    check("★ 오른쪽은 세로선 5줄 — 따로 본 것이다", b.vLines.length === 5, `${b.vLines.length}`);
  }
}

out.push("\n[없는 표를 지어내지 않는다]");
{
  const w = 500, h = 800;
  const blank = new Uint8Array(w * h).fill(PAPER);
  const g1 = R.findGridAuto(blank, w, h);
  check("★★ 빈 종이에서는 표를 못 찾았다고 한다", !g1, JSON.stringify(g1 && { h: g1.hLines.length, v: g1.vLines.length }));
  // 글씨만 잔뜩 있고 선은 없는 종이
  const noisy = new Uint8Array(w * h).fill(PAPER);
  for (let i = 0; i < 4000; i++) noisy[Math.floor(Math.random() * noisy.length)] = PEN;
  const g2 = R.findGridAuto(noisy, w, h);
  check("★★ 글씨만 있는 종이에서도 표를 지어내지 않는다", !g2, JSON.stringify(g2 && { h: g2.hLines.length, v: g2.vLines.length }));
}

out.push("\n[누워서 스캔된 것]");
{
  const w = 700, h = 1200;
  const g = drawReceipt({ w, h, rows: 10, cols: 4 });
  const r = R.rotate90(g, w, h);
  check("돌리면 가로세로가 바뀐다", r.w === h && r.h === w, `${r.w}x${r.h}`);
  const grid = R.findGridAuto(r.gray, r.w, r.h);
  check("★ 누운 것도 세워서 찾는다", !!grid && grid.hLines.length === 11, grid ? `${grid.hLines.length}` : "못 찾음");
  check("★ 돌렸다고 알려준다", !!grid && grid.rot === 90, grid ? `${grid.rot}` : "");
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
