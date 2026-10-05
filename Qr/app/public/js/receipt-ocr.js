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
  /**
   * 표의 줄은 **일정한 간격**이다 — 그것을 쓴다.
   *
   * 선을 하나하나 찾기만 하면 두 가지로 어긋난다. 옅게 인쇄된 선은 아예
   * 못 찾고(사진 한 장에서 19줄 중 8줄만 찾았다), 손글씨 획이 길게 그어진
   * 자리는 선으로 센다(세로선 18개 중 14개가 글씨였다).
   *
   * 찾은 선들이 「얼마 간격의 빗」에 가장 많이 앉는지를 보고, 그 빗에서
   * 벗어난 것은 버리고 **빠진 칸은 채운다.** 바깥쪽으로 늘일 때는 종이에
   * 실제로 선이 있는지 한 번 더 확인하므로(probe), 표가 끝난 자리를 넘어
   * 가지는 않는다.
   */
  function combLines(lines, opts) {
    const o = Object.assign({ minPitch: 8, tol: 0.3, minLines: 4, probe: null, probeMin: 0.2, probeSlack: 3, maxExtend: 40, holeMax: 1, extent: null, emptyCost: 0.5 }, opts || {});
    const plain = () => ({ lines: lines.slice(), pitch: 0, kept: lines.length, added: 0, dropped: 0 });
    if (lines.length < o.minLines) return plain();

    const gaps = [];
    for (let i = 1; i < lines.length; i++) gaps.push(lines[i] - lines[i - 1]);
    const cands = [...new Set(gaps.filter((g) => g >= o.minPitch))].sort((a, b) => a - b);
    if (!cands.length) return plain();

    // 간격 후보 × 기준선 후보를 다 대보고 **가장 많이 앉는** 빗을 고른다.
    // 선이 수십 개뿐이라 전부 대보는 것이 제일 확실하다.
    let best = null;
    for (const p of cands) {
      for (const anchor of lines) {
        let hit = 0, err = 0;
        const ks = new Set();
        let kLo = Infinity, kHi = -Infinity;
        for (const v of lines) {
          const k = Math.round((v - anchor) / p);
          const d = Math.abs(v - (anchor + k * p));
          if (d > p * o.tol) continue;
          hit++; err += d / p; ks.add(k);
          if (k < kLo) kLo = k;
          if (k > kHi) kHi = k;
        }
        if (!hit) continue;
        // **빈 칸이 많은 빗은 빗이 아니다.**
        //
        // 간격만 작게 잡으면 어떤 선이든 「거의」 그 격자에 앉는다. 간격 15
        // 로 보면 1,400점 높이에 93줄이 생기고 그 중 5줄에만 선이 있다 —
        // 그런 빗이 제일 많이 앉은 것으로 뽑히면 표가 아니라 모래가 된다.
        // 그래서 **차 있는 칸**을 세고 빈 칸은 깐다.
        const slots = kHi - kLo + 1;
        const score = ks.size - err - (slots - ks.size) * o.emptyCost;
        if (!best || score > best.score) best = { p, anchor, hit, score };
      }
    }
    // 빗에 앉은 선이 절반도 안 되면 빗이 아니다 — 찾은 것을 그대로 쓴다.
    if (!best || best.hit < Math.max(o.minLines, lines.length * 0.5)) return plain();

    // 앉은 선들로 간격과 기준점을 다시 맞춘다(최소제곱). 빗을 멀리까지
    // 늘일 때 간격이 조금만 틀려도 끝에서 한 칸씩 밀린다.
    const inl = [];
    for (const v of lines) {
      const k = Math.round((v - best.anchor) / best.p);
      if (Math.abs(v - (best.anchor + k * best.p)) <= best.p * o.tol) inl.push({ k, v });
    }
    let sk = 0, sv = 0, skk = 0, skv = 0;
    for (const { k, v } of inl) { sk += k; sv += v; skk += k * k; skv += k * v; }
    const n = inl.length;
    const den = n * skk - sk * sk;
    const pitch = den ? (n * skv - sk * sv) / den : best.p;
    const base = den ? (sv - pitch * sk) / n : best.anchor;
    if (!(pitch >= o.minPitch)) return plain();

    const kMin = inl[0].k, kMax = inl[inl.length - 1].k;
    const tolPx = Math.max(2, pitch * o.tol);
    // 그 칸에 선이 있나. real=찾은 선 그대로, else=종이를 느슨하게 다시 본 것.
    const at = (k) => {
      const want = base + k * pitch;
      let near = null, bd = tolPx;
      for (const v of lines) { const d = Math.abs(v - want); if (d <= bd) { bd = d; near = v; } }
      if (near != null) return { v: near, real: true };
      if (!o.probe) return null;
      let bv = null, bs = o.probeMin;
      for (let d = -o.probeSlack; d <= o.probeSlack; d++) {
        const s = o.probe(Math.round(want) + d);
        if (s >= bs) { bs = s; bv = Math.round(want) + d; }
      }
      return bv == null ? null : { v: bv, real: false };
    };

    // 빗을 사진 끝까지 깔아 두고 **선이 이어지는 가장 긴 구간**만 표로 삼는다.
    //
    // 처음에는 찾은 선의 처음~끝을 전부 표로 보고 안쪽을 채웠다. 그런데
    // **종이의 위아래 끝선**이 우연히 빗에 앉으면(100%·63%) 머리글과 아래
    // 여백까지 통째로 표가 돼서, 9줄 영수증이 28줄로 세어졌다.
    //
    // 표의 줄은 끊기지 않고 이어진다. 머리글의 글자는 한두 자리에만 걸린다.
    // 그래서 「이어지는가」로 가른다 — 글씨가 선을 덮어 한 칸 빠지는 것은
    // 흔하므로 한 칸까지는 끊긴 것으로 보지 않는다.
    const span = o.extent == null ? Math.max(Math.abs(kMin), Math.abs(kMax)) + o.maxExtend : Math.ceil(o.extent / pitch) + 2;
    const k0 = Math.min(kMin, -span), k1 = Math.max(kMax, span);
    let run = null, cur = null, miss = 0;
    for (let k = k0; k <= k1; k++) {
      const r = at(k);
      if (r) {
        if (!cur) cur = { a: k, b: k, hit: 1 };
        else { cur.b = k; cur.hit++; }
        miss = 0;
      } else if (cur) {
        miss++;
        // 한 칸 빠진 것은 글씨가 선을 덮은 것으로 본다
        if (miss > o.holeMax) {
          if (!run || cur.hit > run.hit) run = cur;
          cur = null; miss = 0;
        }
      }
    }
    if (cur && (!run || cur.hit > run.hit)) run = cur;
    if (!run) return plain();

    const out = [];
    let kept = 0, added = 0;
    for (let k = run.a; k <= run.b; k++) {
      const r = at(k);
      out.push(r ? r.v : Math.round(base + k * pitch));
      if (r && r.real) kept++; else added++;
    }
    return { lines: out, pitch, kept, added, dropped: lines.length - kept };
  }

  function findGrid(gray, w, h, opts) {
    const o = Object.assign({ hMin: 0.45, vMin: 0.35, gap: 0.01, skew: null, colMinFrac: 0.03, probeFrac: 0.55 }, opts || {});
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
    /**
     * 가로선 하나가 어디서 시작해 어디서 끝나는가. 가장 긴 어두운 구간의
     * 양 끝을 돌려준다.
     */
    function runSpan(y) {
      const g = hGap;
      let bs = -1, bl = 0, s = -1, blank = 0;
      for (let x = 0; x <= w; x++) {
        const on = x < w && dark(x, y);
        if (on) { if (s < 0) s = x; blank = 0; }
        else if (s >= 0) {
          blank++;
          if (blank > g || x === w) {
            const len = x - blank + 1 - s;
            if (len > bl) { bl = len; bs = s; }
            s = -1; blank = 0;
          }
        }
      }
      return bl ? { x0: bs, x1: bs + bl - 1, len: bl } : null;
    }

    const hRaw = mergeBands(hHits, Math.max(2, Math.round(h * 0.004)));
    // 줄 간격이 일정하다는 것을 쓴다(combLines). 늘일 때 보는 눈은 느슨하게 —
    // 이미 「빗의 그 자리」라는 큰 단서가 있으므로 선이 반만 보여도 줄이다.
    const hComb = combLines(hRaw, {
      minPitch: Math.max(8, Math.round(h * 0.008)),
      probe: (y) => (y < 0 || y >= h ? 0 : longestRun((x) => dark(x, y), w, hGap) / w),
      probeMin: o.hMin * o.probeFrac,
      extent: h,
      probeSlack: Math.max(2, Math.round(h * 0.003)),
    });
    const hLines = hComb.lines;

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
    const vRaw = mergeBands(vHits, Math.max(2, Math.round(w * 0.004)));
    // 칸 너비는 일정하지 않다(品名 은 넓고 數量 은 좁다) — 빗을 쓸 수 없다.
    // 대신 **칸이 될 수 없는 너비**를 버린다. 손글씨 획이 세로선으로 세어져
    // 한 장에서 18개가 나오고 그 중 14개가 글씨였다.
    const vMinGap = Math.max(3, Math.round(w * o.colMinFrac));
    const vLines = [];
    for (const x of vRaw) {
      const prev = vLines.length ? vLines[vLines.length - 1] : null;
      if (prev == null) { vLines.push(x); continue; }
      if (x - prev >= vMinGap) { vLines.push(x); continue; }
      // 붙어 있으면 **더 길게 이어지는** 쪽만 남긴다
      const len = (c) => longestRun((i) => darkV(c, top + i), band, vGap);
      if (len(x) > len(prev)) vLines[vLines.length - 1] = x;
    }

    // **표의 양 끝 테두리는 가로선의 끝으로 찾는다.**
    //
    // 영수증의 맨 왼쪽·맨 오른쪽 테두리는 종이 접힌 자리나 스캔 여백에
    // 묻혀 「길게 이어지는 세로선」으로 안 잡히는 일이 많다. 그러면 가장
    // 넓은 품명 칸이 통째로 사라진다 — 한 사진에서 칸이 4개여야 하는데
    // 3개만 나왔고, 품명 칸이 없어서 품목을 아예 못 집었다.
    //
    // 가로선은 표의 왼쪽 끝에서 오른쪽 끝까지 그어져 있다. 그 **끝**을
    // 가운뎃값으로 모으면 그게 테두리다.
    if (hLines.length >= 3) {
      const spans = hLines.map(runSpan).filter(Boolean).sort((a2, b2) => b2.len - a2.len);
      // 긴 선들만 본다 — 짧게 끊긴 선의 끝은 테두리가 아니다
      const long = spans.filter((sp) => sp.len >= spans[0].len * 0.8);
      if (long.length) {
        const mid = (arr) => arr.slice().sort((p1, p2) => p1 - p2)[Math.floor(arr.length / 2)];
        const edgeTol = Math.max(4, Math.round(w * 0.02));
        for (const e of [mid(long.map((sp) => sp.x0)), mid(long.map((sp) => sp.x1))]) {
          if (!vLines.some((x) => Math.abs(x - e) <= edgeTol)) vLines.push(e);
        }
        vLines.sort((p1, p2) => p1 - p2);
      }
    }

    return {
      threshold: th,
      lineThreshold: lineTh,
      slope,
      yAt,
      xAt,
      hLines,
      vLines,
      pitch: hComb.pitch,
      hAdded: hComb.added,
      hDropped: hComb.dropped,
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

  /**
   * 칸 하나에서 **숫자 글자를 하나씩 떼어낸다.**
   *
   * 붙어 있는 잉크 덩어리를 하나의 글자로 본다. 손으로 쓴 숫자는 보통 서로
   * 떨어져 있고, 붙었더라도 「18」처럼 가로로 나란하다. 그래서 덩어리를
   * 찾은 뒤 **왼쪽부터** 차례로 내놓는다.
   *
   * 너무 작은 덩어리는 버린다 — 스캔 잡티와 펜이 스친 자국이 숫자로 읽히면
   * 금액에 없는 자리가 하나 붙는다.
   */
  function glyphs(gray, w, cell, threshold, opts) {
    const o = Object.assign({ minInk: 0.05, minPx: 6, minH: 0.25, joinGap: 0.06 }, opts || {});
    const cw = cell.x1 - cell.x0;
    const ch = cell.y1 - cell.y0;
    if (cw < 6 || ch < 6) return [];
    // 세로로 잉크를 세어 **글자 사이의 틈**을 찾는다. 가로로 나란한 숫자라
    // 이것만으로 거의 갈린다.
    const col = new Int32Array(cw);
    for (let y = cell.y0; y < cell.y1; y++) {
      const row = y * w;
      for (let x = 0; x < cw; x++) if (gray[row + cell.x0 + x] < threshold) col[x]++;
    }
    const gap = Math.max(1, Math.round(cw * o.joinGap));
    const spans = [];
    let s = -1, blank = 0;
    for (let x = 0; x <= cw; x++) {
      const ink = x < cw && col[x] > 0;
      if (ink) { if (s < 0) s = x; blank = 0; }
      else if (s >= 0) {
        blank++;
        if (blank >= gap || x === cw) { spans.push([s, x - blank + 1]); s = -1; blank = 0; }
      }
    }
    const out = [];
    for (const [a, b] of spans) {
      // 그 조각의 위아래 끝을 찾는다
      let top = ch, bot = -1, n = 0;
      for (let y = 0; y < ch; y++) {
        const row = (cell.y0 + y) * w;
        for (let x = a; x < b; x++) {
          if (gray[row + cell.x0 + x] >= threshold) continue;
          n++;
          if (y < top) top = y;
          if (y > bot) bot = y;
        }
      }
      if (bot < 0) continue;
      const gh = bot - top + 1;
      // 너무 옅거나 너무 납작한 것은 글자가 아니다(밑줄·잡티).
      //
      // 얼마나 옅은지는 **그 덩이 자신의 크기**로 잰다. 처음에는 칸 전체
      // 넓이로 쟀는데, 품명 칸처럼 넓은 칸에서는 멀쩡한 숫자도 「너무
      // 옅다」로 버려졌다 — 「70」이 한 글자도 안 남았다.
      if (n < Math.max(o.minPx, (b - a) * gh * o.minInk)) continue;
      if (gh < ch * o.minH) continue;
      out.push({ x0: cell.x0 + a, x1: cell.x0 + b, y0: cell.y0 + top, y1: cell.y0 + bot + 1 });
    }
    return out;
  }

  /**
   * 글자 하나를 28×28 로 만든다 — 손글씨 숫자 판별기가 받는 모양
   * (public/js/timecard-handdigits.js). 급여 카드 머리의 민국 연도를 읽는
   * 그 망을 그대로 쓴다.
   *
   * 긴 쪽을 20점에 맞춰 넣고 **무게중심을 가운데**로 옮긴다 — 학습할 때
   * 그렇게 맞춘 자료로 배웠으므로, 여기서 안 맞추면 엉뚱한 숫자가 나온다.
   */
  function toGlyphImage(gray, w, box, threshold) {
    const bw = box.x1 - box.x0;
    const bh = box.y1 - box.y0;
    const scale = 20 / Math.max(bw, bh);
    const tw = Math.max(1, Math.round(bw * scale));
    const thh = Math.max(1, Math.round(bh * scale));
    const small = new Float32Array(tw * thh);
    for (let y = 0; y < thh; y++) {
      for (let x = 0; x < tw; x++) {
        // 원본에서 그 자리에 해당하는 네모를 평균낸다
        const sx0 = box.x0 + Math.floor((x * bw) / tw);
        const sx1 = Math.max(sx0 + 1, box.x0 + Math.floor(((x + 1) * bw) / tw));
        const sy0 = box.y0 + Math.floor((y * bh) / thh);
        const sy1 = Math.max(sy0 + 1, box.y0 + Math.floor(((y + 1) * bh) / thh));
        let n = 0, hit = 0;
        for (let yy = sy0; yy < sy1; yy++) for (let xx = sx0; xx < sx1; xx++) { n++; if (gray[yy * w + xx] < threshold) hit++; }
        small[y * tw + x] = n ? hit / n : 0;
      }
    }
    // 무게중심
    let sx = 0, sy = 0, m = 0;
    for (let y = 0; y < thh; y++) for (let x = 0; x < tw; x++) { const v = small[y * tw + x]; sx += x * v; sy += y * v; m += v; }
    const cx = m ? sx / m : tw / 2;
    const cy = m ? sy / m : thh / 2;
    const img = new Float32Array(28 * 28);
    const offX = Math.round(14 - cx);
    const offY = Math.round(14 - cy);
    for (let y = 0; y < thh; y++) {
      const ty = y + offY;
      if (ty < 0 || ty >= 28) continue;
      for (let x = 0; x < tw; x++) {
        const tx = x + offX;
        if (tx < 0 || tx >= 28) continue;
        img[ty * 28 + tx] = small[y * tw + x];
      }
    }
    return img;
  }

  /**
   * 칸 하나를 숫자로 읽는다. 못 읽겠으면 null.
   *
   * 글자마다 확률이 돌아오는데, **제일 낮은 글자의 확률**을 그 칸의 확신으로
   * 삼는다 — 네 자리 중 하나만 흐려도 금액은 통째로 틀리기 때문이다.
   */
  function readNumber(gray, w, cell, threshold, classify, opts) {
    const o = Object.assign({ maxDigits: 7 }, opts || {});
    const gs = glyphs(gray, w, cell, threshold);
    if (!gs.length || gs.length > o.maxDigits) return null;
    let text = "";
    let worst = 1;
    for (const g of gs) {
      const r = classify(toGlyphImage(gray, w, g, threshold));
      if (!r) return null;
      text += String(r.digit);
      if (r.p < worst) worst = r.p;
    }
    return { text, value: Number(text), digits: gs.length, p: worst };
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
    const o = Object.assign({ minFrac: 0.12, inkMax: 0.004, bandMin: 0.016 }, opts || {});
    // **글자용 문턱값으로 가르면 영수증 한 장이 토막난다.**
    //
    // 아무것도 안 쓴 표 줄은 글자 기준으로는 「비어 있다」(잉크 1.2% 밑). 그
    // 줄이 20~26개씩 이어지니 빈 칸이 많은 영수증은 아래쪽이 통째로 잘려
    // 나갔다 — 사진 하나에서 19줄 중 8줄만 남았다.
    //
    // 선이 보이는 느슨한 문턱값으로 보면 그 줄들에도 **세로 칸선이 남아**
    // 1.5~3% 가 어둡다. 진짜 영수증 사이의 틈은 0% 다. 그래서 문턱값을
    // 느슨하게 하고 「빈 것」의 기준은 반대로 더 좁힌다(0.4%).
    const th0 = otsu(gray);
    let paper = 0, nPaper = 0;
    for (let i = 0; i < gray.length; i += 7) if (gray[i] >= th0) { paper += gray[i]; nPaper++; }
    const th = Math.min(254, Math.round(th0 + ((nPaper ? paper / nPaper : 255) - th0) * 0.45));

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

  const api = { otsu, longestRun, mergeBands, estimateSkew, findGrid, findGridAuto, findReceipts, splitPanels, crop, rotate90, gridScore, cells, inkOf, combLines, glyphs, toGlyphImage, readNumber };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.HG_RECEIPT = api;
})();
