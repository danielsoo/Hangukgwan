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

out.push("\n[쓴 줄과 빈 줄을 가린다]");
{
  // 2026-10-05: 칸을 자를 때 여백을 **2점으로 못 박았더니** 칸마다 선이
  // 딸려 들어와서, 아무것도 안 쓴 줄에도 잉크가 4~7% 나왔다 — 칸 높이 73점에
  // 위아래 선이 2점씩이면 꼭 그만큼이다. 그래서 「이 줄은 썼나」를 가릴 수가
  // 없었고, 영수증마다 종이 줄 수가 엑셀보다 5~11줄 많게 세어졌다.
  //
  // 여백을 칸 크기에 맞춰 잡으니 빈 줄 0~3%, 쓴 줄 5~27% 로 갈렸다.
  const w = 700, h = 1200, rows = 12, cols = 4;
  // 위 6줄만 쓴 영수증을 그린다
  const g = drawReceipt({ w, h, rows, cols, ink: false });
  const m = Math.round(w * 0.06);
  const x0 = m, x1 = w - m, y0 = Math.round(h * 0.25), y1 = h - m;
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = Math.round(x0 + ((x1 - x0) * (c + 0.4)) / cols);
      const cy = Math.round(y0 + ((y1 - y0) * (r + 0.5)) / rows);
      for (let dy = -6; dy <= 6; dy++) for (let dx = -14; dx <= 14; dx++) {
        const yy = cy + dy, xx = cx + dx;
        if (xx >= 0 && xx < w && yy >= 0 && yy < h) g[yy * w + xx] = PEN;
      }
    }
  }
  const grid = R.findGrid(g, w, h);
  const cs = R.cells(grid);
  const inked = new Set();
  for (const c of cs) if (R.inkOf(g, w, c, grid.threshold) > 0.05) inked.add(c.row);
  check("★★ 쓴 줄만 센다 (6줄)", inked.size === 6, `${inked.size}: ${[...inked].sort((a, b) => a - b).join(",")}`);
  check("★ 위 6줄이다", [...inked].sort((a, b) => a - b).join(",") === "0,1,2,3,4,5", [...inked].sort((a, b) => a - b).join(","));

  // 여백이 좁으면 **빈 칸에 선 번짐이 남는다.** 그게 실제로 났던 일이다 —
  // 빈 줄에도 잉크가 4~7% 나와서 「이 줄은 썼나」를 가릴 수가 없었다.
  const emptyCell = (list) => list.find((c) => c.row === 10 && c.col === 1);
  const inkWide = R.inkOf(g, w, emptyCell(cs), grid.threshold);
  const inkTight = R.inkOf(g, w, emptyCell(R.cells(grid, { pad: 1 })), grid.threshold);
  check("★★ 빈 칸은 거의 깨끗하다", inkWide < 0.01, `${(inkWide * 100).toFixed(1)}%`);
  check(
    "★★ 여백을 좁히면 선 번짐이 남는다 — 그래서 칸 크기에 맞춰 잡는다",
    inkTight > inkWide * 3,
    `좁게 ${(inkTight * 100).toFixed(1)}% vs 넉넉히 ${(inkWide * 100).toFixed(1)}%`
  );
}


out.push("\n[기울어진 영수증 — 여기서 제일 많이 깨졌다]");
{
  // 2026-10-05: 처음에는 y 만 되돌려서 가로선은 찾는데 세로선이 0~2개였다.
  // 기울기 1.6°, 표 높이 1,324점이면 세로선의 x 가 36점 밀린다.
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
  check("★★ 두 조각으로 가른다", panels.length === 2, `${panels.length}`);
  const found = R.findReceipts(g, w, h);
  check("★★ 영수증 둘을 따로 찾는다", found.length === 2, `${found.length}`);
  if (found.length === 2) {
    check("★ 왼쪽은 세로선 6줄", found[0].grid.vLines.length === 6, `${found[0].grid.vLines.length}`);
    check("★ 오른쪽은 세로선 5줄 — 따로 본 것이다", found[1].grid.vLines.length === 5, `${found[1].grid.vLines.length}`);
  }
}

out.push("\n[없는 표를 지어내지 않는다]");
{
  const w = 500, h = 800;
  const blank = new Uint8Array(w * h).fill(PAPER);
  check("★★ 빈 종이에서는 표를 못 찾았다고 한다", !R.findGridAuto(blank, w, h), "");
  const noisy = new Uint8Array(w * h).fill(PAPER);
  for (let i = 0; i < 4000; i++) noisy[Math.floor(Math.random() * noisy.length)] = PEN;
  check("★★ 글씨만 있는 종이에서도 표를 지어내지 않는다", !R.findGridAuto(noisy, w, h), "");
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


out.push("\n[줄 간격이 일정하다는 것을 쓴다]");
{
  // 2026-10-05: 선을 하나하나 찾기만 하니 두 가지로 어긋났다. 옅게 인쇄된
  // 선은 못 찾고(한 사진에서 19줄 중 8줄), 손글씨 획이 길게 그어진 자리는
  // 선으로 셌다(세로선 18개 중 14개가 글씨). 줄 간격은 일정하므로 그걸 쓴다.
  const even = [100, 150, 200, 250, 300, 350];
  const r0 = R.combLines(even);
  check("고른 간격은 그대로 둔다", r0.lines.length === 6 && Math.round(r0.pitch) === 50, `${r0.lines.length}줄 간격 ${r0.pitch}`);

  // 가운데 한 줄이 글씨에 덮여 안 보인 경우 — 채워 넣는다
  const hole = [100, 150, 250, 300, 350];
  const r1 = R.combLines(hole);
  check("★ 빠진 줄을 채운다", r1.lines.length === 6 && r1.lines.includes(200), r1.lines.join(" "));
  check("★ 채운 줄 수를 알려준다", r1.added === 1 && r1.kept === 5, `채움 ${r1.added} 그대로 ${r1.kept}`);

  // 빗에서 벗어난 것 — 글씨 획이 선으로 세어진 경우
  const stray = [100, 150, 177, 200, 250, 300, 350];
  const r2 = R.combLines(stray);
  check("★ 빗에서 벗어난 선은 버린다", !r2.lines.includes(177) && r2.lines.length === 6, r2.lines.join(" "));

  // 선이 절반도 안 앉으면 빗이 아니다 — 함부로 고치지 않는다
  // 간격을 작게 잡으면 어떤 선이든 「거의」 격자에 앉는다. 그런 빗으로
  // 표를 지어내면 안 된다 — 빈 칸이 많은 빗은 버린다.
  const messy = [100, 115, 131, 299, 712, 1501];
  const r3 = R.combLines(messy);
  check("★ 빗이 아닌 것은 손대지 않는다", r3.lines.length === messy.length && r3.pitch === 0, `${r3.lines.length}줄`);
}

out.push("\n[종이 끝과 머리글을 표로 보지 않는다]");
{
  // 2026-10-05: **종이의 위아래 끝선**이 우연히 빗에 앉아서(100%·63%)
  // 머리글과 아래 여백까지 표가 됐다 — 9줄 영수증이 28줄로 세어졌다.
  // 표의 줄은 끊기지 않고 이어진다는 것으로 가른다.
  //
  // 아래 그림: 종이 끝(k=0) · 머리글 두 줄(k=1,2) · 빈 자리(k=3,4) ·
  // 표 여섯 줄(k=5~10) · 빈 자리 · 종이 아래 끝.
  const pitch = 50;
  const strength = { 0: 1.0, 1: 0.3, 2: 0.28, 5: 0.9, 6: 0.9, 7: 0.9, 8: 0.9, 9: 0.9, 10: 0.9, 14: 0.7 };
  const at = (y) => {
    const k = Math.round((y - 100) / pitch);
    return Math.abs(y - (100 + k * pitch)) <= 1 ? strength[k] || 0 : 0;
  };
  const seen = Object.keys(strength).filter((k) => strength[k] >= 0.45).map((k) => 100 + +k * pitch).sort((a, b) => a - b);
  const r = R.combLines(seen, { probe: at, probeMin: 0.45, probeSlack: 2, extent: 900 });
  check("★★ 이어지는 여섯 줄만 표로 본다", r.lines.length === 6, r.lines.join(" "));
  check("★ 종이 위 끝선을 표에 넣지 않는다", !r.lines.includes(100), r.lines.join(" "));
  check("★ 종이 아래 끝선을 표에 넣지 않는다", !r.lines.includes(800), r.lines.join(" "));
}

out.push("\n[빈 줄만 있는 영수증을 토막내지 않는다]");
{
  // 2026-10-05: **아무것도 안 쓴 표 줄**은 글자 기준으로 「비어 있다」(잉크
  // 1.2% 밑). 그 줄이 20~26개씩 이어지니, 아래가 빈 영수증은 통째로 잘려
  // 나갔다 — 19줄 중 8줄만 남았다. 선이 보이는 느슨한 문턱값으로 보면
  // 빈 줄에도 **세로 칸선이 남아** 어둡다. 진짜 틈은 0% 다.
  const w = 700, h = 1200;
  // 아래 7줄은 아무것도 안 쓴 영수증
  const g = drawReceipt({ w, h, rows: 12, cols: 4, ink: false });
  const m = Math.round(w * 0.06);
  const x0 = m, x1 = w - m, y0 = Math.round(h * 0.25), y1 = h - m;
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 4; c++) {
      const cx = Math.round(x0 + ((x1 - x0) * (c + 0.4)) / 4);
      const cy = Math.round(y0 + ((y1 - y0) * (r + 0.5)) / 12);
      for (let dy = -3; dy <= 3; dy++) for (let dx = -6; dx <= 6; dx++) g[(cy + dy) * w + cx + dx] = PEN;
    }
  }
  const panels = R.splitPanels(g, w, h);
  check("★★ 빈 줄에서 가르지 않는다 (한 장이다)", panels.length === 1, `${panels.length}조각`);
  const grid = R.findGridAuto(g, w, h);
  check("★★ 표의 아래까지 다 찾는다 (13줄)", !!grid && grid.hLines.length === 13, grid ? `${grid.hLines.length}` : "못 찾음");
}

out.push("\n[칸에서 숫자를 떼어낸다]");
{
  // 손글씨 숫자 판별기(timecard-handdigits.js)는 **28×28 한 글자**를 받는다.
  // 칸 하나에 「70」이 적혀 있으면 두 글자로 갈라 줘야 한다.
  const w = 200, h = 80;
  const g = new Uint8Array(w * h).fill(PAPER);
  // 7 과 0 을 대충 그린다 — 두 덩이로 떨어져 있다
  for (let x = 30; x < 60; x++) g[20 * w + x] = PEN;
  for (let i = 0; i < 30; i++) g[(20 + i) * w + (58 - i)] = PEN;
  for (let i = 0; i < 28; i++) { g[(20 + i) * w + 90] = PEN; g[(20 + i) * w + 115] = PEN; }
  for (let x = 90; x <= 115; x++) { g[20 * w + x] = PEN; g[48 * w + x] = PEN; }
  const cell = { x0: 10, y0: 5, x1: 190, y1: 75, w: 180, h: 70, row: 0, col: 0 };
  const th = R.otsu(g);
  const gs = R.glyphs(g, w, cell, th);
  check("★★ 「70」을 두 글자로 가른다", gs.length === 2, `${gs.length}개`);
  check("★ 왼쪽 글자가 먼저 나온다", gs.length === 2 && gs[0].x0 < gs[1].x0, "");

  // 스캔 잡티 한 점은 글자가 아니다 — 금액에 없는 자리가 붙으면 안 된다
  g[60 * w + 150] = PEN;
  g[61 * w + 150] = PEN;
  check("★★ 잡티를 글자로 세지 않는다", R.glyphs(g, w, cell, th).length === 2, `${R.glyphs(g, w, cell, th).length}개`);

  const img = R.toGlyphImage(g, w, gs[1], th);
  check("28×28 로 만든다", img.length === 28 * 28, `${img.length}`);
  let sx = 0, sy = 0, m2 = 0;
  for (let y = 0; y < 28; y++) for (let x = 0; x < 28; x++) { const v = img[y * 28 + x]; sx += x * v; sy += y * v; m2 += v; }
  check("★ 무게중심을 가운데로 옮긴다 (판별기가 그렇게 배웠다)", m2 > 0 && Math.abs(sx / m2 - 13.5) < 2.5 && Math.abs(sy / m2 - 13.5) < 2.5, `${(sx / m2).toFixed(1)},${(sy / m2).toFixed(1)}`);

  // 자리 수가 너무 많으면 읽지 않는다 — 품명 칸을 금액으로 읽으면 장부가 틀어진다
  const many = R.readNumber(g, w, cell, th, () => ({ digit: 1, p: 0.9 }), { maxDigits: 1 });
  check("★★ 자리 수가 너무 많으면 안 읽는다", many === null, `${many && many.text}`);
  const two = R.readNumber(g, w, cell, th, (im) => ({ digit: im === null ? 0 : 7, p: 0.8 }));
  check("★ 글자마다 판별기에 넘긴다", two && two.text === "77" && two.digits === 2, two ? two.text : "null");
  check("★ 제일 흐린 글자의 확신을 쓴다", two && two.p === 0.8, two ? `${two.p}` : "");
}


out.push("\n[표의 양 끝 테두리가 안 보여도 칸을 잃지 않는다]");
{
  // 2026-10-05: 영수증의 맨 왼쪽·맨 오른쪽 테두리는 종이 접힌 자리나 스캔
  // 여백에 묻혀 「길게 이어지는 세로선」으로 안 잡히는 일이 많다. 그러면
  // **제일 넓은 품명 칸이 통째로 사라진다** — 진짜 사진에서 칸이 5개여야
  // 하는데 3개만 나왔고, 품명 칸이 없어서 품목을 아예 못 집었다.
  //
  // 가로선은 표의 왼쪽 끝에서 오른쪽 끝까지 그어져 있다. 그 끝으로 찾는다.
  const w = 700, h = 1200, cols = 5;
  const g = drawReceipt({ w, h, rows: 12, cols });
  const m = Math.round(w * 0.06);
  const y0 = Math.round(h * 0.25), y1 = h - m;
  // 양쪽 테두리 세로선만 지운다 (가로선은 그대로 둔다)
  for (let y = y0 + 4; y <= y1 - 4; y++) {
    for (const bx of [m, w - m]) {
      for (let d = -1; d <= 2; d++) if (bx + d >= 0 && bx + d < w) g[y * w + bx + d] = PAPER;
    }
  }
  const grid = R.findGrid(g, w, h);
  check("★★ 테두리가 없어도 칸 수는 그대로다 (6줄)", grid.vLines.length === cols + 1, `${grid.vLines.length} → ${grid.vLines.join(" ")}`);
  check("★ 제일 왼쪽 칸(품명)을 되살린다", grid.vLines.length >= 2 && Math.abs(grid.vLines[0] - m) <= 6, `${grid.vLines[0]} (${m} 이어야)`);
  check("★ 제일 오른쪽 테두리도 찾는다", grid.vLines.length >= 2 && Math.abs(grid.vLines[grid.vLines.length - 1] - (w - m)) <= 6, `${grid.vLines[grid.vLines.length - 1]}`);
  const cs = R.cells(grid);
  check("★ 칸이 12×5 = 60개", cs.length === 60, `${cs.length}`);
}


out.push("\n[기울기를 칸 자리에 반영한다]");
{
  // 2026-10-05: **이것 하나가 숫자 읽기를 통째로 막고 있었다.**
  //
  // 선을 찾을 때는 기운 만큼 되돌려 보므로 선 번호는 「표 가운데에서의」
  // 자리다. 칸을 그냥 네모로 자르면 가운데에서 먼 줄일수록 선이 칸 안으로
  // 들어온다 — 기울기 1.6°, 표 높이 1,846점이면 세로선 x 가 25점 밀리는데
  // 여백은 13점뿐이었다. 맨 위·아래 줄에서는 세로선이 통째로 칸에 들어와
  // **글자 하나로 세어졌고**, 수량 「3」이 글자 3개로 읽혔다.
  const w = 700, h = 1400, rows = 14, cols = 5;
  const g = drawReceipt({ w, h, rows, cols, skew: 0.028, ink: false });
  const grid = R.findGrid(g, w, h);
  const cs = R.cells(grid);
  check("기운 종이에서도 칸이 다 나온다", cs.length === rows * cols, `${cs.length}`);
  // 아무것도 안 썼으니 **어느 칸에도 잉크가 없어야** 한다. 선이 들어오면
  // 거기서 잉크가 나온다.
  let worst = 0, worstAt = "";
  for (const c of cs) {
    const ink = R.inkOf(g, w, c, grid.threshold);
    if (ink > worst) { worst = ink; worstAt = `줄${c.row} 칸${c.col}`; }
  }
  check("★★ 빈 칸에 선이 안 들어온다 (잉크 3% 밑)", worst < 0.03, `제일 심한 곳 ${worstAt} ${(worst * 100).toFixed(1)}%`);
  let glyphy = 0;
  for (const c of cs) glyphy += R.glyphs(g, w, c, grid.threshold).length;
  check("★★ 빈 칸에서 글자를 찾지 않는다", glyphy === 0, `${glyphy}개`);
}

out.push("\n[수량 × 단가 = 금액 으로 서로 고친다]");
{
  // 사장님 장부 154,563줄에서 99.2% 가 이 셈을 지킨다. 숫자 하나를 88% 로
  // 읽으면 세 자리 금액은 68% 뿐이라, 이 셈이 없으면 세 줄에 한 줄이 틀린
  // 채로 장부에 들어간다.
  //
  // 수량은 **종이에서 읽지 않는다** — 0.5 를 「半斤」이라고 한자로 쓴다
  // (사장님 영수증, 수량의 12.7% 가 소수다). 금액 ÷ 단가 로 구한다.
  check("정수 수량을 제일 그럴듯하게 본다", R.qtyPlausibility(3) > R.qtyPlausibility(0.5), "");
  check("★ 반(0.5)도 흔하다 — 4분의1보다 그럴듯하다", R.qtyPlausibility(0.5) > R.qtyPlausibility(0.25), "");
  check("★ 2.73 같은 수량은 읽기를 잘못한 쪽으로 본다", R.qtyPlausibility(2.73) < R.qtyPlausibility(0.25), `${R.qtyPlausibility(2.73)}`);
  check("★ 말이 안 되는 수량은 아예 뺀다", R.qtyPlausibility(40000) <= -9 && R.qtyPlausibility(0) <= -9, "");

  // 셈이 서로를 고치는지 잰다.
  //
  // 종이에 단가 ?00 · 금액 900 이 적혀 있고, 단가 첫 글자가 2 와 3 사이에서
  // 갈린다고 하자(2 쪽이 조금 더 그럴듯하다고 나왔다 치자). 글자만 보면
  // 「200」을 고르지만, 900 ÷ 200 = 4.5 이고 900 ÷ 300 = 3 이다. 정수 수량이
  // 훨씬 흔하므로(87.2%) 3 으로 풀려야 한다.
  const w = 700, h = 1200, cols = 5;
  // 房信 전표 비율로 그린다 — 품명이 넓고 금액이 그 다음이다
  const g = drawReceipt({ w, h, rows: 12, cols, ink: false, widths: [37, 13, 13, 21, 11] });
  const grid = R.findGrid(g, w, h);
  const cs = R.cells(grid);
  const L = R.labelColumns(cs);
  check("칸을 너비로 가린다 (품명 0 · 수량 1 · 단가 2 · 금액 3)",
    !!L && L.name === 0 && L.qty === 1 && L.price === 2 && L.amount === 3,
    L ? JSON.stringify(L) : "못 가림");
  const row = 3;
  // 칸에 글자 세 개씩 그린다. 모양(가로세로 비)으로 어느 글자인지 알아보게.
  function paint(col, shapes) {
    const cell = cs.find((c) => c.row === row && c.col === col);
    const step = Math.floor(cell.w / shapes.length);
    shapes.forEach((kind, i) => {
      const cx = cell.x0 + step * i + Math.floor(step / 2);
      const cy = Math.floor((cell.y0 + cell.y1) / 2);
      const halfW = kind === "wide" ? 9 : kind === "mid" ? 5 : 2;
      const halfH = Math.min(11, Math.floor(cell.h / 2) - 3);
      for (let dy = -halfH; dy <= halfH; dy++) {
        for (let dx = -halfW; dx <= halfW; dx++) {
          const x = cx + dx, y = cy + dy;
          if (x > cell.x0 && x < cell.x1 - 1 && y > cell.y0 && y < cell.y1 - 1) g[y * w + x] = PEN;
        }
      }
    });
  }
  paint(L.price, ["mid", "wide", "wide"]);     // ?00
  paint(L.amount, ["thin", "wide", "wide"]);   // 900
  const probsOf = (m) => { const p = new Array(10).fill(0.0002); for (const k of Object.keys(m)) p[+k] = m[k]; return p; };
  // 28×28 에 잉크가 얼마나 차 있나로 모양을 가린다
  function fakeClassify(img) {
    let ink = 0;
    for (let i = 0; i < img.length; i++) ink += img[i];
    if (ink > 230) return { digit: 0, p: 0.97, probs: probsOf({ 0: 0.97 }) };          // 넓적한 것 = 0
    if (ink < 110) return { digit: 9, p: 0.96, probs: probsOf({ 9: 0.96 }) };          // 가는 것 = 9
    return { digit: 2, p: 0.5, probs: probsOf({ 2: 0.5, 3: 0.45 }) };                  // 가운데 = 2 나 3
  }
  const naivePrice = R.readNumber(g, w, cs.find((c) => c.row === row && c.col === L.price), grid.threshold, fakeClassify);
  check("글자만 보면 단가를 200 으로 읽는다", naivePrice && naivePrice.text === "200", naivePrice ? naivePrice.text : "null");
  const rr = R.readRow(grid, cs, L, row, { classify: fakeClassify });
  check("★★ 셈에 맞춰 단가를 300 으로 고친다", rr.value.price === 300, `${rr.value.price}`);
  check("★★ 금액은 900 그대로", rr.value.amount === 900, `${rr.value.amount}`);
  check("★★ 수량은 금액 ÷ 단가 = 3", rr.value.qty === 3, `${rr.value.qty}`);
  check("★ 고쳤다고 알려준다", rr.fixed === true, `${rr.fixed}`);
  // **고쳐 넣었어도 흰 칸은 아니다.** 저 3 은 글자만 보면 2 와 거의 반반
  // (0.45 대 0.5)이었다. 셈으로 풀었다는 것은 「아마 300」이라는 뜻이고,
  // 그걸 흰 칸으로 내보내면 사장님이 안 보고 넘긴다. 진짜 사진 318줄로
  // 재보니 글자 또렷함을 안 보면 흰 칸의 맞는 비율이 91% → 75% 로 떨어졌다.
  check("★★ 글자가 반반이었으면 고쳐 넣되 노란 칸으로 둔다",
    rr.ok === false && rr.value.price === 300, `ok=${rr.ok} 또렷함=${rr.certainty}`);
  // 글자가 또렷하고 두 번째 후보와 벌어졌으면 흰 칸이다.
  //
  // 기준값은 **판별기에 딸려 있다**(2026-10-05). 신경망의 확신은 가까운
  // 이웃의 표보다 또렷해서, 예전 기준(0.8)을 그대로 두면 흰 칸이 세 배로
  // 늘고 맞는 비율이 93% → 80% 로 떨어졌다. 그래서 이 시험은 **기준을
  // 넘겼을 때 흰 칸이 되는가**만 잰다 — 기준값 자체는 진짜 사진으로 잰다.
  const clear = R.readRow(grid, cs, L, row, { classify: fakeClassify, minDigitP: 0.4, margin: 0.5 });
  check("★ 글자가 또렷하면 흰 칸", clear.ok === true, `ok=${clear.ok} 여유=${clear.margin}`);
  check("★★ 기준은 판별기에 맞춰 둔다 (기본은 또렷함 0.95 · 여유 2)",
    /minDigitP: 0.95/.test(require("fs").readFileSync(require("path").join(__dirname, "..", "public/js/receipt-ocr.js"), "utf8"))
    && /margin: 2,/.test(require("fs").readFileSync(require("path").join(__dirname, "..", "public/js/receipt-ocr.js"), "utf8")), "");
}


console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
