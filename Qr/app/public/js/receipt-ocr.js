// 식자재 영수증 사진에서 **표를 찾는다.**
//
// 2026-10-05 사장님: "저 사진들을 급여처럼 올리면 인식해서 엑셀에 기입하고
// 우리 시스템에도 기입해서."
//
// ── 왜 표부터인가
//
// 글자를 읽기 전에 **어디가 어느 칸인지**를 알아야 한다. 품명 칸의 글씨를
// 단가로 읽으면 숫자가 멀쩡해 보이는 채로 장부가 틀어진다. 출근 카드 때도
// 선을 먼저 찾고 칸을 잘랐다(timecard-ocr.js).
//
// 다행히 이 영수증들은 **선이 인쇄돼 있다.** 그리고 스캔이라 평평하다
// (2026-10-05 확인: 가로세로비 가운데값 1.414 = A4). 출근 카드 때 한계였던
// 「휴대폰으로 비스듬히 찍은 것」이 여기서는 거의 없다.
//
// ── 선을 어떻게 가려내나
//
// 어두운 점을 세는 것만으로는 안 된다 — 손글씨도 어둡다. 선은 **길게
// 이어진다**는 것이 다르다. 그래서 줄마다 「가장 긴 연속 어두운 구간」을
// 보고, 그것이 종이 너비의 상당 부분을 차지할 때만 선으로 친다.
//
// 종이 색도 업체마다 다르다(노랑·분홍·하늘). 그래서 고정 문턱값 대신
// **그 사진의 밝기 분포**에서 문턱을 잡는다.
(function () {
  "use strict";

  /**
   * 밝기 문턱값. 종이가 노랗든 분홍이든 글씨는 종이보다 어둡다.
   *
   * Otsu 법 — 밝기 히스토그램을 두 무리로 갈랐을 때 무리 사이가 가장 벌어지는
   * 자리를 고른다. 종이 색이 무엇이든 「종이 / 잉크」로 갈린다.
   */
  function otsu(gray) {
    const hist = new Float64Array(256);
    for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
    const total = gray.length;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, bestVar = -1;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const v = wB * wF * (mB - mF) * (mB - mF);
      if (v > bestVar) { bestVar = v; best = t; }
    }
    // **한 칸 올려서** 돌려준다. 위 계산에서 best 는 「어두운 쪽에 들어가는
    // 마지막 밝기」라, 쓰는 쪽이 `v < th` 로 묻는 것과 한 칸 어긋난다.
    //
    // 실제 사진에서는 밝기가 촘촘해 티가 안 나지만, 선 색이 딱 그 값일 때
    // 선이 통째로 안 보인다 — 시험에서 그 일이 났다(선 96, 문턱 96).
    return best + 1;
  }

  /**
   * 한 줄(또는 한 칸)에서 **가장 긴 연속 어두운 구간**의 길이.
   *
   * 인쇄된 선은 끊김 없이 길게 간다. 손글씨는 길어야 글자 하나 너비다.
   * 스캔 잡티로 한두 점 끊기는 것은 이어진 것으로 본다(gap).
   */
  function longestRun(isDark, n, gap) {
    let best = 0, cur = 0, miss = 0;
    for (let i = 0; i < n; i++) {
      if (isDark(i)) { cur += miss + 1; miss = 0; }
      else if (cur && miss < gap) miss++;
      else { if (cur > best) best = cur; cur = 0; miss = 0; }
    }
    return Math.max(best, cur);
  }

  /** 붙어 있는 선 후보들을 하나로 묶는다. 인쇄선은 두세 점 두께다. */
  function mergeBands(hits, maxGap) {
    const out = [];
    let start = -1, prev = -1;
    for (const v of hits) {
      if (start < 0) { start = prev = v; continue; }
      if (v - prev <= maxGap) { prev = v; continue; }
      out.push(Math.round((start + prev) / 2));
      start = prev = v;
    }
    if (start >= 0) out.push(Math.round((start + prev) / 2));
    return out;
  }

  /**
   * 종이가 얼마나 기울었나. 라디안이 아니라 **기울기(tan)** 로 돌려준다.
   *
   * 스캐너에 반듯이 넣어도 0.5도쯤은 기운다. 가로 1,000점짜리 선이 0.5도
   * 기울면 끝과 끝의 높이가 9점 차이 난다 — 그러면 **어느 한 줄에도 선 전체가
   * 들어 있지 않아서** 「길게 이어진 어두운 구간」이 사라진다. 처음 재봤을 때
   * 120장 중 28장이 가로선을 하나도 못 찾았는데 그게 이것이었다.
   *
   * 재는 법: 기울기를 조금씩 바꿔가며 「그 기울기로 봤을 때의 줄별 어두운 점
   * 수」를 세고, 그 분포가 **가장 뾰족한** 기울기를 고른다. 선이 한 줄에
   * 모이면 그 줄만 값이 크게 튀기 때문이다.
   */
  function estimateSkew(gray, w, h, th, opts) {
    const o = Object.assign({ max: 0.035, steps: 29 }, opts || {});
    let best = 0, bestScore = -1;
    // 가로로 듬성듬성 본다 — 기울기를 재는 데 모든 점이 필요하지는 않다.
    const xStep = Math.max(1, Math.round(w / 400));
    for (let s = 0; s < o.steps; s++) {
      const slope = -o.max + (2 * o.max * s) / (o.steps - 1);
      const prof = new Float64Array(h);
      for (let x = 0; x < w; x += xStep) {
        const shift = Math.round(slope * (x - w / 2));
        for (let y = 0; y < h; y++) {
          if (gray[y * w + x] >= th) continue;
          const yy = y - shift;
          if (yy >= 0 && yy < h) prof[yy]++;
        }
      }
      // 뾰족함 = 이웃과의 차이. 선이 한 줄에 모이면 그 줄만 크게 튄다.
      let score = 0;
      for (let y = 1; y < h; y++) {
        const d = prof[y] - prof[y - 1];
        score += d * d;
      }
      if (score > bestScore) { bestScore = score; best = slope; }
    }
    return best;
  }

  /**
   * 사진에서 표의 가로선·세로선을 찾는다.
   *
   * @param gray Uint8Array (w*h), 0=검정
   * @returns { threshold, hLines, vLines, box } — 못 찾으면 hLines/vLines 가 짧다
   */
  function findGrid(gray, w, h, opts) {
    const o = Object.assign({ hMin: 0.45, vMin: 0.35, gap: 0.01, skew: null }, opts || {});
    const th = otsu(gray);
    // 선을 찾을 때만 쓰는 **느슨한 문턱값.**
    //
    // 인쇄된 표 선은 한 점 굵기다. 스캔을 줄이면 그 한 점이 종이색과 섞여
    // 흐려져서, 글자용 문턱값으로는 선이 아예 안 잡힌다. 처음 재봤을 때
    // 세로선이 평균 2.5개뿐이었는데 그게 이것이었다.
    //
    // 종이 쪽으로 조금 올려 잡는다. 글자가 더 걸려 들어오지만, 선은
    // 「길게 이어지는가」로 가리므로 글자는 어차피 떨어져 나간다.
    let paper = 0, nPaper = 0;
    for (let i = 0; i < gray.length; i += 7) if (gray[i] >= th) { paper += gray[i]; nPaper++; }
    paper = nPaper ? paper / nPaper : 255;
    const lineTh = Math.min(254, Math.round(th + (paper - th) * 0.45));

    // 기울기를 먼저 잡는다. 이게 없으면 조금만 기운 스캔에서 가로선이 통째로
    // 사라진다(estimateSkew 주석).
    const slope = o.skew == null ? estimateSkew(gray, w, h, lineTh) : o.skew;
    // 기운 만큼 되돌려 본다. 그림을 실제로 돌리지 않고 **보는 자리만** 옮긴다 —
    // 돌리면 글자가 뭉개지고, 나중에 칸을 자를 때 원본 좌표가 필요하다.
    const yAt = (x, y) => y + Math.round(slope * (x - w / 2));
    const dark = (x, y) => {
      const yy = yAt(x, y);
      return yy >= 0 && yy < h && gray[yy * w + x] < lineTh;
    };

    // 가로선: 그 줄에서 가장 긴 어두운 구간이 너비의 hMin 이상
    const hGap = Math.max(2, Math.round(w * o.gap));
    const hHits = [];
    for (let y = 0; y < h; y++) {
      const run = longestRun((x) => dark(x, y), w, hGap);
      if (run >= w * o.hMin) hHits.push(y);
    }
    const hLines = mergeBands(hHits, Math.max(2, Math.round(h * 0.004)));

    // 세로선은 **표 안에서만** 찾는다. 표 밖의 글(상호·전화번호)이 섞이면
    // 세로선이 엉뚱한 데 생긴다.
    const top = hLines.length ? hLines[0] : 0;
    const bottom = hLines.length ? hLines[hLines.length - 1] : h - 1;
    const band = Math.max(1, bottom - top);
    const vGap = Math.max(2, Math.round(band * o.gap));
    // 세로선은 **x 쪽으로** 되돌려 봐야 한다.
    //
    // 종이가 기울면 가로선은 y 가 밀리고 세로선은 x 가 밀린다. 처음에는 y 만
    // 고쳤더니 가로선은 다 찾는데 세로선이 0~2개였다. 기울기 1.6°, 표 높이
    // 1,324점이면 세로선의 x 가 위아래로 **36점** 밀린다 — 한 점 굵기 선이
    // 그만큼 밀리면 고정된 x 에서는 영영 안 이어진다.
    const xAt = (x, y) => x - Math.round(slope * (y - h / 2));
    const darkV = (x, y) => {
      const xx = xAt(x, y);
      return xx >= 0 && xx < w && gray[y * w + xx] < lineTh;
    };
    const vHits = [];
    for (let x = 0; x < w; x++) {
      const run = longestRun((i) => darkV(x, top + i), band, vGap);
      if (run >= band * o.vMin) vHits.push(x);
    }
    const vLines = mergeBands(vHits, Math.max(2, Math.round(w * 0.004)));

    return {
      threshold: th,
      lineThreshold: lineTh,
      slope,
      yAt,
      xAt,
      hLines,
      vLines,
      box: hLines.length && vLines.length
        ? { x0: vLines[0], y0: top, x1: vLines[vLines.length - 1], y1: bottom }
        : null,
    };
  }

  /**
   * 표를 칸으로 쪼갠다. 선과 선 사이가 한 칸이다.
   *
   * 선에 바짝 붙은 점은 버린다(pad) — 칸 가장자리의 선 조각이 글자로 읽히면
   * 숫자 하나가 통째로 달라진다.
   */
  function cells(grid, opts) {
    // 여백은 **칸 크기에 맞춰** 잡는다. 고정 2점으로 잘랐더니 칸마다 선이
    // 딸려 들어와서, 아무것도 안 쓴 줄에도 잉크가 4~7% 나왔다 — 칸 높이 73점에
    // 위아래 선 2점씩이면 꼭 그만큼이다. 그래서 「이 줄은 썼나」를 가릴 수가
    // 없었다(2026-10-05).
    const o = Object.assign({ padFrac: 0.1, padMin: 3, minW: 8, minH: 8 }, opts || {});
    const out = [];
    const { hLines: H, vLines: V } = grid;
    for (let r = 0; r + 1 < H.length; r++) {
      const padY = o.pad != null ? o.pad : Math.max(o.padMin, Math.round((H[r + 1] - H[r]) * o.padFrac));
      for (let c = 0; c + 1 < V.length; c++) {
        const padX = o.pad != null ? o.pad : Math.max(o.padMin, Math.round((V[c + 1] - V[c]) * o.padFrac));
        const x0 = V[c] + padX, x1 = V[c + 1] - padX;
        const y0 = H[r] + padY, y1 = H[r + 1] - padY;
        if (x1 - x0 < o.minW || y1 - y0 < o.minH) continue;
        out.push({ row: r, col: c, x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 });
      }
    }
    return out;
  }

  /** 그 칸에 뭔가 적혀 있나. 빈 칸에 대고 읽으면 없는 숫자가 생긴다. */
  function inkOf(gray, w, cell, threshold) {
    let n = 0;
    for (let y = cell.y0; y < cell.y1; y++) {
      for (let x = cell.x0; x < cell.x1; x++) if (gray[y * w + x] < threshold) n++;
    }
    return n / Math.max(1, (cell.x1 - cell.x0) * (cell.y1 - cell.y0));
  }

  /**
   * 한 장에 영수증이 여럿이면 **갈라 놓는다.**
   *
   * 2026-10-05: 사장님 스캔에는 작은 전표를 **두 장씩 나란히** 올린 것이 많다
   * (房信 20250115 처럼). 그러면 한 영수증의 가로선이 사진 너비의 절반밖에
   * 안 돼서 선으로 안 잡히고, 억지로 잡으면 두 영수증의 칸이 한 표로 섞인다 —
   * 왼쪽 영수증의 품명과 오른쪽 영수증의 금액이 한 줄이 되는 것이라 제일
   * 나쁜 종류의 고장이다.
   *
   * 가르는 자리는 **종이가 아닌 곳**이다. 스캐너 바탕은 종이보다 밝고 깨끗해서
   * 그 칸에는 잉크가 거의 없다. 그런 칸이 길게 이어지면 거기가 경계다.
   */
  function splitPanels(gray, w, h, opts) {
    const o = Object.assign({ minFrac: 0.12, inkMax: 0.012, bandMin: 0.012 }, opts || {});
    const th = otsu(gray);

    // 한 방향으로 갈라 본다. vertical=true 면 세로로 잘라 좌우로 나눈다.
    function cuts(vertical) {
      const n = vertical ? w : h;
      const m = vertical ? h : w;
      const ink = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let c = 0;
        for (let j = 0; j < m; j++) c += (vertical ? gray[j * w + i] : gray[i * w + j]) < th ? 1 : 0;
        ink[i] = c / m;
      }
      // 잉크가 거의 없는 칸이 길게 이어지면 그곳이 바탕이다.
      const bandMin = Math.max(4, Math.round(n * o.bandMin));
      const parts = [];
      let start = -1;
      for (let i = 0; i <= n; i++) {
        const blank = i === n || ink[i] <= o.inkMax;
        if (!blank && start < 0) start = i;
        else if (blank && start >= 0) {
          // 바탕이 충분히 길게 이어지는지 앞을 내다본다
          let k = i;
          while (k < n && ink[k] <= o.inkMax) k++;
          if (k - i >= bandMin || i === n) {
            if (i - start >= n * o.minFrac) parts.push([start, i]);
            start = -1;
            i = k - 1;
          }
        }
      }
      return parts;
    }

    let boxes = [{ x0: 0, y0: 0, x1: w, y1: h }];
    const byX = cuts(true);
    if (byX.length > 1) boxes = byX.map(([a, b]) => ({ x0: a, y0: 0, x1: b, y1: h }));
    // 좌우로 가른 뒤 위아래로 한 번 더 — 넉 장을 한 번에 올린 것도 있다.
    const out = [];
    for (const b of boxes) {
      const sub = [];
      const bw = b.x1 - b.x0;
      const ink = new Float64Array(h);
      for (let y = 0; y < h; y++) {
        let c = 0;
        for (let x = b.x0; x < b.x1; x++) c += gray[y * w + x] < th ? 1 : 0;
        ink[y] = c / bw;
      }
      const bandMin = Math.max(4, Math.round(h * o.bandMin));
      let start = -1;
      for (let y = 0; y <= h; y++) {
        const blank = y === h || ink[y] <= o.inkMax;
        if (!blank && start < 0) start = y;
        else if (blank && start >= 0) {
          let k = y;
          while (k < h && ink[k] <= o.inkMax) k++;
          if (k - y >= bandMin || y === h) {
            if (y - start >= h * o.minFrac) sub.push({ x0: b.x0, y0: start, x1: b.x1, y1: y });
            start = -1;
            y = k - 1;
          }
        }
      }
      out.push(...(sub.length ? sub : [b]));
    }
    return out;
  }

  /** 상자 하나를 떼어낸 작은 그림. */
  function crop(gray, w, box) {
    const cw = box.x1 - box.x0;
    const ch = box.y1 - box.y0;
    const out = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) {
      const src = (box.y0 + y) * w + box.x0;
      out.set(gray.subarray(src, src + cw), y * cw);
    }
    return { gray: out, w: cw, h: ch };
  }

  /** 시계방향 90도. 누워서 스캔된 종이를 세운다. */
  function rotate90(gray, w, h) {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) out[x * h + (h - 1 - y)] = gray[y * w + x];
    }
    return { gray: out, w: h, h: w };
  }

  /** 이 표가 얼마나 그럴듯한가. 칸이 많고 가로줄이 고르면 높다. */
  function gridScore(g) {
    if (!g.box || g.hLines.length < 5 || g.vLines.length < 3) return 0;
    const n = (g.hLines.length - 1) * (g.vLines.length - 1);
    // 줄 간격이 고른가 — 인쇄된 표는 칸 높이가 거의 같다. 글씨를 선으로
    // 잘못 본 경우에는 간격이 들쭉날쭉하다.
    const gaps = [];
    for (let i = 1; i < g.hLines.length; i++) gaps.push(g.hLines[i] - g.hLines[i - 1]);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const dev = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) * (b - mean), 0) / gaps.length);
    const even = mean > 0 ? Math.max(0, 1 - dev / mean) : 0;
    // 영수증은 **줄이 칸보다 많다.** 품목을 여러 줄 적고 칸은 품명·수량·단가·
    // 금액 정도다. 누운 사진을 돌려 볼 때 두 방향의 칸 수가 똑같이 나오는데
    // (10×4 와 4×10), 이 한 줄이 어느 쪽이 바로 선 것인지 가른다.
    const upright = g.hLines.length > g.vLines.length ? 1.25 : 1;
    return n * (0.4 + 0.6 * even) * upright;
  }

  /**
   * 표를 **여러 방법으로 찾아보고 제일 그럴듯한 것**을 고른다.
   *
   * 사장님 사진은 한 가지 모양이 아니다 — 업체마다 양식이 다르고, 누워서
   * 스캔된 것도 있고(가로가 더 긴 사진), 선이 흐린 것도 있다. 한 가지 설정만
   * 고집하면 그중 상당수를 통째로 못 읽는다.
   *
   * 못 찾으면 **못 찾았다고 한다.** 아무 표나 들이대고 읽으면 엉뚱한 칸을
   * 금액으로 적게 된다 — 그게 제일 나쁘다.
   */
  function findGridAuto(gray, w, h) {
    const tries = [];
    const views = [{ gray, w, h, rot: 0 }];
    // 세로보다 가로가 길면 누워 있을 수 있다. 영수증은 본래 세로가 길다.
    if (w > h * 0.95) {
      const r = rotate90(gray, w, h);
      views.push({ ...r, rot: 90 });
    }
    for (const v of views) {
      for (const vMin of [0.35, 0.22]) {
        const g = findGrid(v.gray, v.w, v.h, { vMin });
        tries.push({ g, view: v, score: gridScore(g) });
      }
    }
    tries.sort((a, b) => b.score - a.score);
    const best = tries[0];
    if (!best || !best.score) return null;
    return { ...best.g, rot: best.view.rot, w: best.view.w, h: best.view.h, gray: best.view.gray, score: best.score };
  }

    /**
   * 사진 한 장에서 **영수증마다** 표를 찾는다. 사장님이 두 장씩 올린 스캔이
   * 많아서, 가르지 않으면 두 영수증의 칸이 한 표로 섞인다.
   */
  function findReceipts(gray, w, h) {
    const panels = splitPanels(gray, w, h);
    const out = [];
    for (const box of panels) {
      const c = crop(gray, w, box);
      const g = findGridAuto(c.gray, c.w, c.h);
      if (g) out.push({ box, grid: g });
    }
    return out;
  }

  const api = { otsu, longestRun, mergeBands, estimateSkew, findGrid, findGridAuto, findReceipts, splitPanels, crop, rotate90, gridScore, cells, inkOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.HG_RECEIPT = api;
})();
