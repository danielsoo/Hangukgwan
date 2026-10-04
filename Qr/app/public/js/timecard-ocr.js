// 출근 카드(考勤卡) 사진을 AI 없이 읽는다 (2026-10-03).
//
// 사장님: "사진 렌더해서 인식하는 걸 꼭 에이아이가 있어야 하냐고" → "그렇게 해줘
// 손글씨로 인식이 되면 직접 채워 넣어야 한다는 걸 표시해줘."
//
// 이 카드는 AI 없이 읽기 좋다:
//   · 양식이 늘 같다(微-3). 파란 면 = 1~15일(맨 위 한 줄은 빈 줄), 주황 면 = 16~31일.
//     몸통은 16줄, 세로 굵은 선 4개(날짜|오전|오후|연장|소계)로 칸이 정해진다.
//   · 시각은 출근 기계의 점 숫자 — 0~9 와 「:」 뿐이고 모양이 늘 같다. 견본 숫자
//     (아래 TEMPLATES, 사장님이 보내신 카드에서 뽑음)와 맞춰 본다.
//   · 색으로 가른다: 기계 잉크는 회색, 손글씨·밑줄은 파란 펜, 사장님 메모는 빨강,
//     카드 선은 하늘색/주황.
//
// 손글씨(파란 펜으로 쓴 시각, 찍힌 시각 위에 고쳐 쓴 숫자)는 **읽지 않는다.** 그 칸은
// handwritten 으로 돌려주고 화면이 「직접 채워 넣으세요」로 칠한다. 밑줄처럼 납작한 펜
// 자국은 손글씨가 아니다.
//
// 사진은 이 기기 밖으로 나가지 않는다 — 브라우저 안에서 다 한다.
(function (root) {
  "use strict";

  const SLOTS = ["am_in", "am_out", "pm_in", "pm_out", "ot_in", "ot_out"];
  const GW = 10; // 견본 크기(가로)
  const GH = 16; // 견본 크기(세로)

  // ---- 색 ----
  const lum = (r, g, b) => (r * 299 + g * 587 + b * 114) / 1000;
  function isInk(r, g, b) {
    // 기계 잉크: 회색(색이 거의 없음) + 바탕보다 어둡다.
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    return mx - mn < 26 && lum(r, g, b) < 212;
  }
  function isPen(r, g, b) {
    // 파란·보라 펜: 파랑이 빨강·초록보다 크고, 카드의 하늘색 선(초록이 높다)과는 다르다.
    return b - r >= 18 && b - g >= 14 && g - r < 22 && lum(r, g, b) < 190;
  }
  // 카드 선. 작게 줄이거나 흐린 사진에서는 가는 선이 옅어지므로 너무 빡빡하게 잡지 않는다
  // (봉우리는 늘 가장 센 것에 견줘 고른다).
  const isBlueLine = (r, g, b) => g - r > 18 && b - r > 26 && b > 140;
  const isOrangeLine = (r, g, b) => r - b > 34 && r - g > 14 && g > 95 && r > 160;
  const isBlueTint = (r, g, b) => b - r >= 14 && g - r >= 8 && r < 235;
  const isOrangeTint = (r, g, b) => r - b >= 22 && r - g >= 8 && g > 100;
  // 빨간 카드(微電腦音樂打卡鐘 의 16~31일 면, 2026-10-03 黃美花 카드). 선이 진한 분홍빛 빨강
  // (192,80,96) — 주황(초록 > 파랑)과 달리 파랑이 초록만큼 있다.
  const isRedLine = (r, g, b) => r > 150 && r - g > 60 && r - b > 45 && b >= g - 12 && g < 170;
  const isRedTint = (r, g, b) => r - g >= 20 && r - b >= 14 && b >= g - 10 && r > 150;
  // 빨간 별·사장님 빨간 펜. 주황 카드 머리띠(초록이 높다)와 헷갈리지 않게 초록·파랑이 둘 다 낮아야.
  const isRed = (r, g, b) => r > 170 && g < 95 && b < 105;

  // 휴대폰 사진은 어둡거나 누렇다 — 채널마다 종이 밝기(가장 흔한 밝은 값)를 250 으로
  // 맞춘다. 견본과 기준값은 종이가 250 인 스캔에서 정했다.
  function whiteGains(img) {
    const { width: W, height: H, data } = img;
    const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    const step = Math.max(1, Math.floor((W * H) / 200000));
    let n = 0;
    for (let i = 0; i < W * H; i += step) {
      hist[0][data[i * 4]]++;
      hist[1][data[i * 4 + 1]]++;
      hist[2][data[i * 4 + 2]]++;
      n++;
    }
    return hist.map((hh) => {
      let acc = 0;
      for (let v = 255; v >= 0; v--) {
        acc += hh[v];
        if (acc >= n * 0.4) return v > 60 ? Math.min(3, 250 / v) : 1;
      }
      return 1;
    });
  }

  // 기울어진 사진 — 카드 선 색 픽셀의 세로 투영이 가장 날카로운 각도를 찾는다(±6°).
  function findSkew(img, gains) {
    const { width: W, height: H, data } = img;
    const pts = [];
    const step = Math.max(1, Math.floor(Math.sqrt((W * H) / 400000)));
    for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) {
      const i = (y * W + x) * 4;
      const r = Math.min(255, data[i] * gains[0]);
      const g = Math.min(255, data[i + 1] * gains[1]);
      const b = Math.min(255, data[i + 2] * gains[2]);
      if (isBlueLine(r, g, b) || isOrangeLine(r, g, b)) pts.push(x, y);
    }
    if (pts.length < 200) return 0;
    let best = 0;
    let bestScore = -1;
    // 0.25° 로 훑고, 가장 좋은 곳 둘레를 0.05° 로 한 번 더(카드 높이 2000px 에서 0.25° 는 9px —
    // 가는 선이 두 줄로 갈라져 몸통 끝 선을 놓친다).
    const tryDeg = (deg) => {
      const t = Math.tan((deg * Math.PI) / 180);
      // 칸 폭 = 표본 간격. 1px 칸이면 0° 에서만 표본이 짝수 칸에 몰려 점수가 부풀었다.
      const bins = new Float64Array(Math.ceil((W + H) / step) + 2);
      for (let k = 0; k < pts.length; k += 2) {
        const xx = Math.round((pts[k] - pts[k + 1] * t + H * 0.5) / step);
        if (xx >= 0 && xx < bins.length) bins[xx]++;
      }
      let sc = 0;
      for (const v of bins) sc += v * v;
      if (sc > bestScore) {
        bestScore = sc;
        best = deg;
      }
    };
    for (let deg = -6; deg <= 6.001; deg += 0.25) tryDeg(deg);
    const coarse = best;
    for (let deg = coarse - 0.25; deg <= coarse + 0.2501; deg += 0.05) tryDeg(Math.round(deg * 100) / 100);
    return Math.round(best * 100) / 100;
  }

  function grabber(img, gains = [1, 1, 1], deg = 0) {
    const { width: W, height: H, data } = img;
    const t = (deg * Math.PI) / 180;
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    const cx = W / 2;
    const cy = H / 2;
    const at = (x, y) => {
      const i = (y * W + x) * 4;
      return [Math.min(255, data[i] * gains[0]), Math.min(255, data[i + 1] * gains[1]), Math.min(255, data[i + 2] * gains[2])];
    };
    if (!deg) return { W, H, rgb: at };
    return {
      W,
      H,
      // 반듯하게 편 좌표(x, y) → 원래 사진 좌표. 밖이면 흰 종이.
      rgb(x, y) {
        const dx = x - cx;
        const dy = y - cy;
        const fx = cx + dx * cos + dy * sin;
        const fy = cy - dx * sin + dy * cos;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        if (x0 < 0 || y0 < 0 || x0 + 1 >= W || y0 + 1 >= H) return [250, 250, 250];
        // 이웃 네 점을 섞는다 — 가장 가까운 한 점만 쓰면 점 숫자가 들쭉날쭉해진다.
        const ax = fx - x0;
        const ay = fy - y0;
        const p00 = at(x0, y0);
        const p10 = at(x0 + 1, y0);
        const p01 = at(x0, y0 + 1);
        const p11 = at(x0 + 1, y0 + 1);
        return [0, 1, 2].map((c) => (p00[c] * (1 - ax) + p10[c] * ax) * (1 - ay) + (p01[c] * (1 - ax) + p11[c] * ax) * ay);
      },
    };
  }

  function peaks(arr, min, from = 1, to = arr.length - 1) {
    const out = [];
    for (let i = Math.max(1, from); i < Math.min(arr.length - 1, to); i++) {
      if (arr[i] >= min && arr[i] >= arr[i - 1] && arr[i] > arr[i + 1]) out.push(i);
    }
    return out;
  }
  // 붙어 있는 봉우리(굵은 선)는 하나로.
  function merge(list, gap) {
    const out = [];
    for (const v of list) {
      if (out.length && v - out[out.length - 1].end <= gap) out[out.length - 1].end = v;
      else out.push({ start: v, end: v });
    }
    return out.map((g) => Math.round((g.start + g.end) / 2));
  }

  // ---- 카드 찾기 ----
  // 몸통의 세로선 7개(날짜|오전출근|오전퇴근|오후출근|오후퇴근|연장출근|연장퇴근|소계)가 같은
  // 간격으로 선다. 가는 선은 옅어서 빠질 수 있으니, 7개 중 5개 이상이 같은 간격에 서면
  // 카드 하나로 본다. 한 사진에 카드가 여럿이면(파란 면·주황 면) 차례로 찾는다.
  function findCards(G) {
    const cards = [];
    for (const [color, strict, tint] of [
      ["blue", isBlueLine, isBlueTint],
      ["orange", isOrangeLine, isOrangeTint],
      ["red", isRedLine, isRedTint],
    ]) {
      const col = new Array(G.W).fill(0);
      for (let x = 0; x < G.W; x++) for (let y = 0; y < G.H; y++) if (strict(...G.rgb(x, y))) col[x]++;
      const max = Math.max(...col);
      if (max < G.H * 0.12) continue;
      let cand = merge(peaks(col, max * 0.3), Math.max(3, G.W * 0.006)).map((x) => ({ x, v: col[x] }));
      for (let guard = 0; guard < 4; guard++) {
        const best = bestSeven(cand, G.W);
        if (!best) break;
        const card = layoutCard(G, color, best.lines, strict, tint);
        if (card) {
          card.strength = best.score % 1e9;
          card.hits = Math.floor(best.score / 1e9);
          cards.push(card);
        }
        cand = cand.filter((c) => c.x < best.lines[0] - best.s * 0.5 || c.x > best.lines[6] + best.s * 0.5);
      }
    }
    // 같은 자리에서 두 색으로 잡힌 카드(빨간 카드의 옅은 선이 주황으로도 잡힘 등)는 선이 더
    // 뚜렷한 쪽 하나만 남긴다.
    const keep = [];
    for (const c of cards.sort((a, b) => b.hits - a.hits || b.strength - a.strength)) {
      const overlap = keep.some((k) => Math.min(k.xs[3], c.xs[3]) - Math.max(k.xs[0], c.xs[0]) > (c.xs[3] - c.xs[0]) * 0.5);
      if (!overlap) keep.push(c);
    }
    // 주황 면인지 빨간 카드인지는 굵은 세로선의 색으로 마지막에 한 번 더 — 브라우저마다
    // 사진을 푸는 색이 조금 달라 두 색이 다 잡힐 때 엉뚱한 쪽이 남기도 했다. 빨강은 파랑이
    // 초록만큼 있고(192,80,96), 주황은 파랑이 초록보다 확 적다(224,176,144).
    for (const c of keep) {
      if (c.color !== "orange" && c.color !== "red") continue;
      let sum = 0;
      let n = 0;
      for (const x of c.xs) {
        for (let y = Math.round(c.ys[0]); y < c.ys[16]; y += 2) {
          for (let dx = -2; dx <= 2; dx++) {
            const [r, g, b] = G.rgb(Math.min(G.W - 1, Math.max(0, x + dx)), y);
            if (r - g > 40 && r > 140) {
              sum += b - g;
              n++;
            }
          }
        }
      }
      if (n > 20) c.color = sum / n > -12 ? "red" : "orange";
    }
    return keep.sort((a, b) => a.xs[0] - b.xs[0]);
  }

  function bestSeven(cand, W) {
    let best = null;
    for (let i = 0; i < cand.length; i++) {
      for (let j = i + 1; j < cand.length; j++) {
        const s = (cand[j].x - cand[i].x) / 6;
        if (s < W * 0.025) continue;
        const tol = s * 0.15;
        const lines = [];
        let hit = 0;
        let strength = 0;
        for (let k = 0; k <= 6; k++) {
          const want = cand[i].x + k * s;
          const m = cand.find((c) => Math.abs(c.x - want) <= tol);
          if (m) {
            hit++;
            strength += m.v;
            lines.push(m.x);
          } else lines.push(Math.round(want));
        }
        // 굵은 선 자리(0·2·4·6)는 꼭 있어야 한다.
        const thickOk = [0, 2, 4, 6].every((k) => cand.some((c) => Math.abs(c.x - (cand[i].x + k * s)) <= tol));
        if (!thickOk || hit < 5) continue;
        const score = hit * 1e9 + strength;
        if (!best || score > best.score) best = { lines, s, score };
      }
    }
    return best;
  }

  function layoutCard(G, color, lines7, strict, tint) {
    const xs = [lines7[0], lines7[2], lines7[4], lines7[6]];
    const x0 = xs[0];
    const x1 = xs[3];
    const w = x1 - x0;
    // 아래 굵은 가로선(몸통 끝) — 폭을 거의 다 채우는 맨 아래 선.
    const rowStrict = new Array(G.H).fill(0);
    const rowTint = new Array(G.H).fill(0);
    for (let y = 0; y < G.H; y++) {
      for (let x = x0; x < x1; x++) {
        const p = G.rgb(x, y);
        if (strict(...p)) rowStrict[y]++;
        if (tint(...p)) rowTint[y]++;
      }
    }
    // 줄 간격 — 가는 가로선들 사이의 가장 흔한 간격.
    const allLines = peaks(rowTint, w * 0.3);
    const diffs = [];
    for (let i = 1; i < allLines.length; i++) {
      const d = allLines[i] - allLines[i - 1];
      if (d > w * 0.05 && d < w * 0.14) diffs.push(d);
    }
    if (diffs.length < 4) return null;
    diffs.sort((a, b) => a - b);
    const pitch = diffs[Math.floor(diffs.length / 2)];
    // 몸통 맨 아래 굵은 선 — 폭을 거의 다 채우고, **몸통의 세로선이 그 선까지 내려와
    // 있는** 맨 아래 선. 그 밑의 서명 칸(長·覆核·管理) 선은 세로선 자리가 달라 걸러진다.
    // 남은 기울기로 선이 한두 줄에 걸쳐 갈라져도 잡히게, 위아래 2줄 안에 선 색이 있으면 센다.
    const near = (y) => {
      let n = 0;
      for (let x = x0; x < x1; x++) {
        for (let dy = -2; dy <= 2; dy++) {
          const yy = y + dy;
          if (yy >= 0 && yy < G.H && tint(...G.rgb(x, yy))) {
            n++;
            break;
          }
        }
      }
      return n;
    };
    const candRows = [];
    for (let y = 0; y < G.H; y++) if (rowTint[y] >= w * 0.3 && rowTint[y] >= (rowTint[y - 1] || 0) && rowTint[y] >= (rowTint[y + 1] || 0)) candRows.push(y);
    const fullRows = merge(candRows.filter((y) => rowStrict[y] >= w * 0.75 || near(y) >= w * 0.85), Math.max(2, Math.round(pitch * 0.15)));
    // 굵은 세로선 4개 중 3개 이상(빨간 카드는 오른쪽 끝 선이 바닥 근처에서 옅다).
    const vertAbove = (y) =>
      xs.filter((x) => {
        let n = 0;
        let t = 0;
        for (let yy = Math.round(y - pitch * 0.8); yy < y - pitch * 0.2; yy++) {
          if (yy < 0) continue;
          t++;
          for (let dx = -3; dx <= 3; dx++) {
            const xx = x + dx;
            if (xx >= 0 && xx < G.W && strict(...G.rgb(xx, yy))) {
              n++;
              break;
            }
          }
        }
        return t && n / t >= 0.5;
      }).length >= 3;
    let bottom = -1;
    for (let i = fullRows.length - 1; i >= 0; i--) {
      if (vertAbove(fullRows[i])) {
        bottom = fullRows[i];
        break;
      }
    }
    if (bottom < 0) return null;
    const lines = allLines.filter((y) => y <= bottom + 3);
    // 아래에서부터 16줄. 가까운 실제 선이 있으면 거기에 맞춘다.
    const ys = [bottom];
    for (let k = 1; k <= 16; k++) {
      const guess = ys[ys.length - 1] - pitch;
      const near = lines.filter((l) => Math.abs(l - guess) <= pitch * 0.25);
      ys.push(near.length ? near.reduce((a, b) => (Math.abs(b - guess) < Math.abs(a - guess) ? b : a)) : guess);
    }
    ys.reverse(); // ys[0] = 몸통 맨 위, ys[16] = 맨 아래
    const colX = lines7.slice();
    // 파란 면 = 1~15일(맨 위 빈 줄), 주황·빨간 면 = 16~31일.
    return { color, xs, colX, ys, pitch, bottom, firstDay: color === "blue" ? 0 : 16 };
  }

  // ---- 카드에 손으로 쓴 연도·월(파란 면 「115 年 9 月份」) ----
  // 2026-10-04 사장님: "연도랑 월 인식해서 다른 달이면 알려주는 것도 만들어줘 경고 같은 걸로" / "대만은 2026년
  // 이런식으로 안하고 자기 연도로 해서" — 민국 연도(115 = 2026). 펜 글씨라 기계 숫자 견본으로는 못 읽는다.
  // 표 바로 위 띠(「考勤表」 줄과 표 머리 사이)에서 펜 획만 모아 글자로 나누고, 손글씨 숫자 인식기
  // (timecard-handdigits.js — 공개 손글씨 숫자 모음으로 학습한 작은 신경망)로 읽는다. 확실치 않으면 말하지 않는다.
  function headerPenGlyphs(G, card) {
    if (card.color !== "blue") return null;
    // 보랏빛 펜(isPen)으로 먼저 — 글자가 셋 이상 나오면 그걸 쓴다. 모자라면(하늘빛 펜) 넓힌 색으로 다시.
    // 「연도 3자리 + 월 1~2자리」 꼴에 맞는 쪽을 고른다(어두운 남색 펜은 넓힌 색에서만 잡히고, 좁은 색은
    // 그때 엉뚱한 티끌 셋을 낼 수 있다 — 2026-10 사장님 카드 28).
    const shape = (r) => {
      if (!r || !r.groups || !r.groups.length) return 0;
      const gs = r.groups;
      const n = gs.reduce((a, g) => a + g.length, 0);
      return (gs.length === 2 && gs[0].length === 3 && gs[1].length <= 2 ? 100 : 0) + (gs.length === 2 ? 10 : 0) + n;
    };
    const strict = headerPenGlyphsWith(G, card, isPen);
    if (shape(strict) >= 100) return strict;
    const loose = headerPenGlyphsWith(G, card, (r, g, b) => isPen(r, g, b) || (b - g >= 19 && b - r >= 34 && lum(r, g, b) < 184));
    return shape(loose) > shape(strict) ? loose : strict;
  }
  function headerPenGlyphsWith(G, card, headerPen) {
    const x0 = Math.max(0, card.xs[0] - Math.round(card.pitch * 0.2));
    const x1 = Math.min(G.W - 1, card.xs[3]);
    // 표 머리(日期·上午…)의 맨 윗선 — 몸통 첫 줄 위 1~2.4줄 사이에서 폭을 가장 많이 채운 가로선. 연도·월은 그
    // 바로 위 한 줄에 쓴다(「考勤表」·「攷勤表」는 그보다 위라 뺀다). 「9」의 꼬리는 선 아래로 내려오기도 해서
    // 선 밑 0.4줄까지 본다.
    let topLine = -1;
    let topN = 0;
    for (let y = Math.round(card.ys[0] - card.pitch * 2.4); y <= Math.round(card.ys[0] - card.pitch * 0.9); y++) {
      if (y < 0) continue;
      let n = 0;
      for (let x = x0; x < x1; x += 2) if (isBlueTint(...G.rgb(x, y))) n++;
      if (n > topN) (topN = n), (topLine = y);
    }
    if (topLine < 0 || topN < (x1 - x0) / 2 * 0.5) topLine = Math.round(card.ys[0] - card.pitch * 1.4);
    const y0 = Math.max(0, Math.round(topLine - card.pitch * 1.75));
    const y1 = Math.min(G.H - 1, Math.round(topLine + card.pitch * 0.4));
    if (y1 - y0 < card.pitch) return null;
    const W = x1 - x0;
    const H = y1 - y0;
    const m = new Uint8Array(W * H);
    // 펜 색은 카드마다 다르다 — 보랏빛(isPen)도, 하늘빛에 가까운 파랑(2026-09 劉芷芸 카드, 134/165/189)도
    // 있다. 하늘빛 펜은 인쇄된 「年·月份」(밝기 ≈195, 파랑−초록 ≈15)보다 어둡고 더 파랗다(위 headerPenGlyphs).
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (headerPen(...G.rgb(x0 + x, y0 + y))) m[y * W + x] = 1;
    // 하늘빛 펜과 카드의 인쇄 선은 색이 가깝다 — 선은 모양으로 뺀다. 폭의 40% 넘게 칠해진 줄은 인쇄 선이 지나는
    // 줄이라 그 줄에서는 어두운(펜) 점만 남긴다 — 「5」의 아랫배가 선 위에 걸쳐 있어도(카드 30) 지워지지 않게.
    // 그래도 남은 줄기 중 줄 간격의 3배보다 긴 가로 줄기는 지운다. 아주 가는 세로 막대는 아래에서 버린다.
    for (let y = 0; y < H; y++) {
      let n = 0;
      for (let x = 0; x < W; x++) n += m[y * W + x];
      if (n > W * 0.4)
        for (let x = 0; x < W; x++) if (m[y * W + x] && lum(...G.rgb(x0 + x, y0 + y)) >= 128) m[y * W + x] = 0;
    }
    const maxRun = card.pitch * 3;
    for (let y = 0; y < H; y++) {
      let x = 0;
      while (x < W) {
        if (!m[y * W + x]) {
          x++;
          continue;
        }
        let e = x;
        while (e < W && m[y * W + e]) e++;
        if (e - x > maxRun) for (let k = x; k < e; k++) m[y * W + k] = 0;
        x = e;
      }
    }
    // 이어진 덩어리(8방향)
    const lab = new Int32Array(W * H).fill(-1);
    const comps = [];
    const stack = [];
    for (let i = 0; i < W * H; i++) {
      if (!m[i] || lab[i] >= 0) continue;
      const c = { x0: W, y0: H, x1: 0, y1: 0, n: 0, px: [] };
      lab[i] = comps.length;
      stack.push(i);
      while (stack.length) {
        const j = stack.pop();
        const x = j % W;
        const y = (j - x) / W;
        c.n++;
        c.px.push(j);
        if (x < c.x0) c.x0 = x;
        if (x > c.x1) c.x1 = x;
        if (y < c.y0) c.y0 = y;
        if (y > c.y1) c.y1 = y;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
            const k = yy * W + xx;
            if (m[k] && lab[k] < 0) {
              lab[k] = comps.length;
              stack.push(k);
            }
          }
      }
      comps.push(c);
    }
    // 티끌은 버린다. 글자 크기 ≈ 줄 간격 0.5~2배.
    const p = card.pitch;
    let big = comps.filter((c) => c.n >= p * 0.6 && c.y1 - c.y0 >= p * 0.25 && c.x1 - c.x0 + 1 >= (c.y1 - c.y0 + 1) * 0.125);
    if (!big.length) return { glyphs: [], groups: [] };
    // 인쇄된 작은 글자(「中華民國」·「年」 — 다른 기계 카드는 펜과 같은 남색)는 숫자보다 훨씬 작다 — 가장 큰 획의
    // 0.45 배보다 낮은 덩어리는 뺀다.
    const tallest = Math.max(...big.map((c) => c.y1 - c.y0 + 1));
    big = big.filter((c) => c.y1 - c.y0 + 1 >= tallest * 0.45);
    // 숫자들은 한 줄에 있다 — 가운데 높이가 그 줄에서 크게 벗어난 티끌·선 조각은 뺀다.
    const mids = big.map((c) => (c.y0 + c.y1) / 2).sort((a, b) => a - b);
    const midY = mids[Math.floor(mids.length / 2)];
    big = big.filter((c) => Math.abs((c.y0 + c.y1) / 2 - midY) <= p * 0.75);
    // 가로로 겹치는 덩어리는 한 글자(「5」의 윗획처럼 떨어진 획).
    big.sort((a, b) => a.x0 - b.x0);
    const glyphs = [];
    for (const c of big) {
      const g = glyphs[glyphs.length - 1];
      const ov = g && Math.min(g.x1, c.x1) - Math.max(g.x0, c.x0);
      if (g && ov > Math.min(g.x1 - g.x0, c.x1 - c.x0) * 0.35) {
        g.x0 = Math.min(g.x0, c.x0);
        g.x1 = Math.max(g.x1, c.x1);
        g.y0 = Math.min(g.y0, c.y0);
        g.y1 = Math.max(g.y1, c.y1);
        g.px = g.px.concat(c.px);
      } else glyphs.push({ x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1, px: c.px.slice() });
    }
    // 글자 사이가 크게 벌어진 곳(인쇄된 「年」 자리)에서 연도 · 월로 나눈다.
    const groups = [[glyphs[0]]];
    for (let i = 1; i < glyphs.length; i++) {
      const gap = glyphs[i].x0 - glyphs[i - 1].x1;
      if (gap > p * 1.1) groups.push([glyphs[i]]);
      else groups[groups.length - 1].push(glyphs[i]);
    }
    // 붙어 쓴 숫자(「15」가 한 덩어리 — 카드 30) — 연도 칸이 3자리가 안 되면 가장 넓은 글자를 잉크가 가장
    // 적은 세로줄에서 가른다.
    const split = (g, lo, hi) => {
      const w = g.x1 - g.x0 + 1;
      const col = new Array(w).fill(0);
      for (const j of g.px) col[(j % W) - g.x0]++;
      let best = -1;
      let bv = Infinity;
      for (let x = Math.round(w * lo); x <= Math.round(w * hi); x++) if (col[x] < bv) (bv = col[x]), (best = x);
      if (best <= 0) return null;
      const L = { x0: W, x1: 0, y0: H, y1: 0, px: [] };
      const R = { x0: W, x1: 0, y0: H, y1: 0, px: [] };
      for (const j of g.px) {
        const x = j % W;
        const y = (j - x) / W;
        const t = x - g.x0 < best ? L : R;
        t.px.push(j);
        if (x < t.x0) t.x0 = x;
        if (x > t.x1) t.x1 = x;
        if (y < t.y0) t.y0 = y;
        if (y > t.y1) t.y1 = y;
      }
      return L.px.length && R.px.length ? [L, R] : null;
    };
    if (groups.length >= 1 && groups[0].length === 2) {
      const yr = groups[0];
      const wi = yr[0].x1 - yr[0].x0 > yr[1].x1 - yr[1].x0 ? 0 : 1;
      const g = yr[wi];
      if ((g.x1 - g.x0 + 1) / (g.y1 - g.y0 + 1) > 0.7) {
        const parts = split(g, 0.2, 0.55);
        if (parts) yr.splice(wi, 1, ...parts);
      }
    }
    // 28×28 손글씨 숫자 꼴(가운데 20×20 칸, 무게중심 가운데)로.
    const toMnist = (g) => {
      const gw = g.x1 - g.x0 + 1;
      const gh = g.y1 - g.y0 + 1;
      const k = 20 / Math.max(gw, gh);
      const out = new Float32Array(28 * 28);
      const ow = Math.max(1, Math.round(gw * k));
      const oh = Math.max(1, Math.round(gh * k));
      const tmp = new Float32Array(ow * oh);
      for (const j of g.px) {
        const x = (j % W) - g.x0;
        const y = Math.floor(j / W) - g.y0;
        const tx = Math.min(ow - 1, Math.floor(x * k));
        const ty = Math.min(oh - 1, Math.floor(y * k));
        tmp[ty * ow + tx] += 1;
      }
      // 칸마다 덮인 정도 → 0~1, 획이 얇으면(스캔 펜 글씨) 한 번 굵게 해서 공개 손글씨 숫자 굵기에 맞춘다.
      const cover = 1 / Math.max(1, 1 / (k * k));
      let sx = 0;
      let sy = 0;
      let s = 0;
      const img = new Float32Array(ow * oh);
      for (let i = 0; i < ow * oh; i++) img[i] = Math.min(1, tmp[i] * cover * 1.5);
      const thick = new Float32Array(ow * oh);
      for (let y = 0; y < oh; y++)
        for (let x = 0; x < ow; x++) {
          let v = img[y * ow + x];
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              const yy = y + dy;
              if (xx >= 0 && yy >= 0 && xx < ow && yy < oh) v = Math.max(v, img[yy * ow + xx] * (dx && dy ? 0.6 : 0.85));
            }
          thick[y * ow + x] = v;
          sx += x * v;
          sy += y * v;
          s += v;
        }
      const cx = s ? sx / s : ow / 2;
      const cy = s ? sy / s : oh / 2;
      const ox = Math.round(14 - cx);
      const oy = Math.round(14 - cy);
      for (let y = 0; y < oh; y++)
        for (let x = 0; x < ow; x++) {
          const X = x + ox;
          const Y = y + oy;
          if (X >= 0 && Y >= 0 && X < 28 && Y < 28) out[Y * 28 + X] = thick[y * ow + x];
        }
      return out;
    };
    return {
      groups: groups.map((gr) => gr.map((g) => ({ box: [x0 + g.x0, y0 + g.y0, g.x1 - g.x0 + 1, g.y1 - g.y0 + 1], aspect: (g.x1 - g.x0 + 1) / (g.y1 - g.y0 + 1), img: toMnist(g) }))),
    };
  }

  // ---- 추가 카드 표시 — 「NO.」 옆 빨간 표시(★ · ○ · △) ----
  // 2026-10-03 사장님 카드들: 주 5일을 넘긴 날만 찍는 카드에 빨간 펜으로 ★ 를 그리기도
  // 하고 ○·△ 를 그리기도 한다. 모양은 가리지 않고 「그 자리에 빨간 표시가 있나」만 본다.
  // 빨강·분홍(파랑 ≥ 초록)만 — 주황 카드의 머리띠(초록 > 파랑)는 아니다.
  const isMarkRed = (r, g, b) => r > 150 && r - g > 80 && r - b > 40 && b >= g - 4;
  function hasStar(G, card) {
    // 빨간 카드는 머리띠·선이 표시와 같은 빨강이라 가릴 수 없다 — 표시 없음으로 본다.
    if (card.color === "red") return false;
    const p = card.pitch;
    const w = card.xs[3] - card.xs[0];
    const top = Math.max(0, Math.round(card.ys[0] - p * 12));
    const bot = Math.max(0, Math.round(card.ys[0] - p * 7));
    const left = Math.max(0, Math.round(card.xs[0] - w * 0.15));
    const right = Math.min(G.W, Math.round(card.xs[0] + w * 0.5));
    let n = 0;
    for (let y = top; y < bot; y++) for (let x = left; x < right; x++) if (isMarkRed(...G.rgb(x, y))) n++;
    return n > p * p * 0.2;
  }

  // ---- 한 칸 읽기 ----
  // 칸 = 세로 [colX[c], colX[c+1]], 가로줄 [ys[r], ys[r+1]] — 찍힌 글자가 선을 조금
  // 넘기도 해서 위아래로 줄 높이의 30% 를 더 본다(옆 줄 글자는 가운데로 가른다).
  function readCell(G, card, r, c, templates) {
    const xL = card.colX[c] + 3;
    const xR = card.colX[c + 1] - 3;
    const p = card.pitch;
    const yT = Math.round(card.ys[r] - p * 0.3);
    const yB = Math.round(card.ys[r + 1] + p * 0.3);
    const w = xR - xL;
    const h = yB - yT;
    const ink = new Uint8Array(w * h);
    const penMask = new Uint8Array(w * h);
    let pen = 0;
    let penTop = Infinity;
    let penBot = -Infinity;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [R, Gg, B] = G.rgb(xL + x, yT + y);
        if (isInk(R, Gg, B)) ink[y * w + x] = 1;
        else if (isPen(R, Gg, B)) {
          penMask[y * w + x] = 1;
          if (yT + y < card.ys[r] - p * 0.1 || yT + y > card.ys[r + 1] + p * 0.1) continue;
          pen++;
          if (y < penTop) penTop = y;
          if (y > penBot) penBot = y;
        }
      }
    }
    // 펜 자국 가장자리는 색이 옅어져 회색(잉크)처럼 보인다 — 펜 둘레 2px 은 잉크에서 뺀다.
    // 밑줄이 숫자들을 한 덩어리로 잇는 것을 막는다.
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!penMask[y * w + x]) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const yy = y + dy;
        const xx = x + dx;
        if (yy >= 0 && yy < h && xx >= 0 && xx < w) ink[yy * w + xx] = 0;
      }
    }
    // 손글씨 — 펜 자국이 키가 있으면(밑줄은 납작하다).
    const handwritten = pen > p * p * 0.06 && penBot - penTop > p * 0.45;
    // 글자 줄 찾기: 가로 투영 → 잉크가 있는 가장 긴 줄 덩어리 중 이 칸의 가운데에 가까운 것.
    const rowSum = new Array(h).fill(0);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rowSum[y] += ink[y * w + x];
    // 점 숫자는 줄 사이가 비어 덩어리가 끊긴다 — 작은 틈은 잇는다.
    const raw = [];
    let s = -1;
    for (let y = 0; y <= h; y++) {
      const on = y < h && rowSum[y] >= 2;
      if (on && s < 0) s = y;
      if (!on && s >= 0) {
        raw.push([s, y]);
        s = -1;
      }
    }
    const joinGap = Math.max(2, Math.round(p * 0.1));
    const runs = [];
    for (const rr of raw) {
      if (runs.length && rr[0] - runs[runs.length - 1][1] <= joinGap) runs[runs.length - 1][1] = rr[1];
      else runs.push(rr.slice());
    }
    for (let i = runs.length - 1; i >= 0; i--) if (runs[i][1] - runs[i][0] < p * 0.25) runs.splice(i, 1);
    const centerY = (card.ys[r] + card.ys[r + 1]) / 2 - yT;
    // 이 줄의 글자 = 가운데가 이 칸 안(위아래 선 사이)에 있는 덩어리.
    const run = runs
      .filter(([a, b]) => {
        const c2 = (a + b) / 2 + yT;
        return c2 >= card.ys[r] - p * 0.05 && c2 <= card.ys[r + 1] + p * 0.05;
      })
      .sort((a, b) => Math.abs((a[0] + a[1]) / 2 - centerY) - Math.abs((b[0] + b[1]) / 2 - centerY))[0];
    if (!run) return { time: null, handwritten, empty: !handwritten };
    const [ya, yb] = run;
    // 세로 투영 → 글자 조각. 점 숫자라 1~2px 틈은 잇는다.
    const colSum = new Array(w).fill(0);
    for (let y = ya; y < yb; y++) for (let x = 0; x < w; x++) colSum[x] += ink[y * w + x];
    const gl = [];
    s = -1;
    let gap = 0;
    const maxGap = Math.max(1, Math.round(p * 0.03));
    for (let x = 0; x <= w; x++) {
      const on = x < w && colSum[x] > 0;
      if (on) {
        if (s < 0) s = x;
        gap = 0;
      } else if (s >= 0) {
        gap++;
        if (gap > maxGap || x === w) {
          gl.push([s, x - gap + 1]);
          s = -1;
          gap = 0;
        }
      }
    }
    // 오른쪽부터: 숫자 숫자 「:」 숫자 숫자. 그 왼쪽(옆으로 누운 날짜)은 버린다.
    const glyphs = gl.filter(([a, b]) => b - a >= 1);
    const lineH = yb - ya;
    const dbg = { box: [xL, yT, w, h], run: [ya, yb], glyphs: glyphs.map((g) => g.slice()) };
    if (glyphs.length < 5) return { time: null, handwritten, unclear: !handwritten, empty: false, dbg };
    // 콜론: 좁은 조각. 오른쪽에서 세 번째여야 한다.
    const pick = glyphs.slice(-5).map((g) => g.slice());
    // 맨 왼쪽 숫자가 옆으로 누운 날짜와 붙어 넓게 잡히면 숫자 폭만큼 오른쪽만 쓴다.
    const dws = [pick[1], pick[3], pick[4]].map(([a, b]) => b - a).sort((a, b) => a - b);
    const dw = dws[1];
    if (pick[0][1] - pick[0][0] > dw * 1.5) pick[0][0] = pick[0][1] - dw;
    const colon = pick[2];
    if (colon[1] - colon[0] > lineH * 0.35) return { time: null, handwritten, unclear: !handwritten, empty: false, dbg };
    // 점 숫자는 키가 모두 같다. 밑줄을 지우느라 아래가 깎인 숫자도 있어서, 글자마다
    // 제 위·아래로 늘이지 않고 「가장 큰 키」로 같이 맞춘다.
    const boxes = [pick[0], pick[1], pick[3], pick[4]].map(([a, b]) => {
      let top = yb;
      let bot = ya;
      for (let y = ya; y < yb; y++) for (let x = a; x < b; x++) if (ink[y * w + x]) {
        if (y < top) top = y;
        if (y > bot) bot = y;
      }
      return { a, b, top, bot };
    });
    const tallest = Math.max(...boxes.map((bx) => bx.bot - bx.top + 1));
    const topLine = Math.min(...boxes.map((bx) => bx.top).sort((a, b) => a - b).slice(0, 2));
    const digits = boxes.map((bx) => matchDigit(ink, w, bx.a, bx.b, topLine, topLine + tallest, templates));
    const txt = `${digits[0].d}${digits[1].d}:${digits[2].d}${digits[3].d}`;
    const conf = Math.min(...digits.map((d) => d.score));
    const hh = Number(txt.slice(0, 2));
    const mm = Number(txt.slice(3));
    const valid = hh <= 23 && mm <= 59;
    return { time: valid ? txt : null, conf, handwritten, unclear: !valid || conf < 0.6, empty: false, glyphs: digits.map((d) => d.vec), dbg, digits: digits.map((d) => d.d + ":" + d.score.toFixed(2)) };
  }

  // 글자 하나를 GW×GH 회색 격자로.
  // ya..yb = 글자 줄의 위·아래(넷이 같이 쓴다).
  function glyphVector(ink, w, a, b, ya, yb) {
    const top = ya;
    const bot = yb - 1;
    let any = false;
    for (let y = ya; y < yb && !any; y++) for (let x = a; x < b; x++) if (ink[y * w + x]) {
      any = true;
      break;
    }
    if (!any) return null;
    const v = new Float32Array(GW * GH);
    const gw = b - a;
    const gh = bot - top + 1;
    for (let j = 0; j < GH; j++) {
      for (let i = 0; i < GW; i++) {
        const x0 = a + Math.floor((i * gw) / GW);
        const x1 = Math.max(x0 + 1, a + Math.floor(((i + 1) * gw) / GW));
        const y0 = top + Math.floor((j * gh) / GH);
        const y1 = Math.max(y0 + 1, top + Math.floor(((j + 1) * gh) / GH));
        let n = 0;
        let t = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          n += ink[y * w + x];
          t++;
        }
        v[j * GW + i] = n / t;
      }
    }
    return v;
  }

  function corr(a, b) {
    let ma = 0;
    let mb = 0;
    for (let i = 0; i < a.length; i++) {
      ma += a[i];
      mb += b[i];
    }
    ma /= a.length;
    mb /= b.length;
    let num = 0;
    let da = 0;
    let db = 0;
    for (let i = 0; i < a.length; i++) {
      num += (a[i] - ma) * (b[i] - mb);
      da += (a[i] - ma) ** 2;
      db += (b[i] - mb) ** 2;
    }
    return da && db ? num / Math.sqrt(da * db) : 0;
  }

  function matchDigit(ink, w, a, b, ya, yb, templates) {
    const vec = glyphVector(ink, w, a, b, ya, yb);
    if (!vec || !templates) return { d: "?", score: 0, vec };
    let best = { d: "?", score: -1 };
    let second = -1;
    for (const [d, list] of Object.entries(templates)) {
      for (const t of list) {
        const s = corr(vec, t);
        if (s > best.score) {
          if (best.d !== d) second = best.score;
          best = { d, score: s };
        } else if (s > second && d !== best.d) second = s;
      }
    }
    // 1등과 2등이 너무 비슷하면 확신이 없다.
    const margin = best.score - second;
    // 기준(2026-10-03, 사장님 카드 두 장 392 글자를 하나씩 빼고 맞춰 본 값): 틀린 글자는
    // 모두 점수 0.5 아래거나 2등과 0.06 안쪽이었다 → 그런 칸은 「확실치 않음」.
    let d = best.d;
    let score = margin < 0.06 ? Math.min(best.score, 0.4) : best.score;
    // 두 번째 의견 — 숫자마다 「평균 모양」(견본 목록의 첫 칸)과도 맞춰 본다. 가장 가까운
    // 한 견본이 우연히 비슷한 것일 때(2026-10-03 「09:07」 의 0 이 2 로) 평균은 다른 답을 낸다.
    // 둘이 어긋나면 「확실치 않음」.
    let meanBest = null;
    let meanScore = -2;
    for (const [dd, list] of Object.entries(templates)) {
      if (!list.length) continue;
      const sc = corr(vec, list[0]);
      if (sc > meanScore) {
        meanScore = sc;
        meanBest = dd;
      }
    }
    if (meanBest !== null && meanBest !== d) score = Math.min(score, 0.4);
    // 0 과 8 은 흐린 사진에서 헷갈린다 — 8 만 가운데 가로획이 있다. 그 획으로 한 번 더
    // 본다(0: 대개 0.45 아래, 8: 0.6 위). 둘이 어긋나거나 애매하면 「확실치 않음」.
    if (d === "0" || d === "8") {
      const f = centerBar(vec);
      const byBar = f < 0.45 ? "0" : f > 0.9 ? "8" : null;
      if (!byBar) score = Math.min(score, 0.4);
      else if (byBar !== d) {
        d = byBar;
        score = Math.min(score, 0.4);
      }
    }
    return { d, score, vec };
  }

  // 가운데 가로획의 진하기 ÷ 옆 세로획의 진하기.
  function centerBar(v) {
    let c = 0;
    let n = 0;
    let e = 0;
    let m = 0;
    for (let y = 6; y <= 9; y++) {
      for (let x = 3; x <= 6; x++) {
        c += v[y * GW + x];
        n++;
      }
      for (const x of [0, 1, GW - 2, GW - 1]) {
        e += v[y * GW + x];
        m++;
      }
    }
    return c / n / (e / m + 0.05);
  }

  function decodeTemplates(raw) {
    if (!raw) return null;
    const out = {};
    for (const [d, list] of Object.entries(raw)) {
      out[d] = list.map((s) => {
        const v = new Float32Array(GW * GH);
        for (let i = 0; i < v.length; i++) v[i] = (parseInt(s[i], 36) || 0) / 35;
        return v;
      });
    }
    return out;
  }

  let cachedTemplates = null;
  function defaultTemplates() {
    if (cachedTemplates) return cachedTemplates;
    let raw = root.HG_TIMECARD_TEMPLATES;
    if (!raw && typeof require === "function") {
      try {
        raw = require("./timecard-templates.js");
      } catch (e) {
        raw = null;
      }
    }
    cachedTemplates = decodeTemplates(raw);
    return cachedTemplates;
  }

  /**
   * 파란 면 머리의 「115 年 9 月份」 → { roc: 115, year: 2026, month: 9, p } / { unread: true } / null(파란 면 아님).
   * 연도는 민국 110~125 만, 월은 1~12 만 받는다. 숫자마다 확률이 0.6 아래면 「못 읽음」 — 틀린 달로
   * 경고하느니 말하지 않는다.
   */
  function readHeader(G, card, classify) {
    if (card.color !== "blue" || !classify) return null;
    let h = null;
    try {
      h = headerPenGlyphs(G, card);
    } catch (e) {
      h = null;
    }
    if (!h || !h.groups || !h.groups.length) return { unread: true };
    const read = h.groups.map((gr) => gr.map((g) => classify(g.img)));
    const num = (rs) => Number(rs.map((r) => r.digit).join(""));
    for (let i = 0; i + 1 < read.length; i++) {
      const y = read[i];
      const m = read[i + 1];
      if (y.length !== 3 || m.length < 1 || m.length > 2) continue;
      const roc = num(y);
      const month = num(m);
      if (roc < 110 || roc > 125 || month < 1 || month > 12) continue;
      const p = Math.min(...y.concat(m).map((r) => r.p));
      if (p < 0.6) return { unread: true, guess: { roc, month }, p };
      return { roc, year: roc + 1911, month, p };
    }
    return { unread: true };
  }

  /**
   * img: { width, height, data(RGBA) } — canvas 의 getImageData 그대로.
   * 돌려주는 값: { cards: [{ color, star, days: { "2": { am_in: "09:11", ... } },
   *   handwritten: [{day, slot}], unclear: [{day, slot}] }] }
   */
  function readTimecards(img, opts = {}) {
    const gains = whiteGains(img);
    const skew = findSkew(img, gains);
    const G = grabber(img, gains, skew);
    const templates = opts.templates || defaultTemplates();
    const cards = findCards(G);
    const out = [];
    for (const card of cards) {
      const res = { layout: { ys: card.ys, colX: card.colX, pitch: card.pitch }, color: card.color, star: hasStar(G, card), days: {}, handwritten: [], unclear: [], cells: [] };
      for (let r = 0; r < 16; r++) {
        const day = card.firstDay + r;
        if (day < 1 || day > 31) continue;
        for (let c = 0; c < 6; c++) {
          const cell = readCell(G, card, r, c, templates);
          const slot = SLOTS[c];
          if (opts.keepCells) res.cells.push({ day, slot, ...cell });
          if (cell.handwritten) {
            res.handwritten.push({ day, slot });
            continue;
          }
          if (cell.time) {
            (res.days[String(day)] = res.days[String(day)] || {})[slot] = cell.time;
            if (cell.unclear) res.unclear.push({ day, slot });
          } else if (cell.unclear) res.unclear.push({ day, slot });
        }
      }
      // 하루 안의 순서 — 오전 출근 < 오전 퇴근 < 오후 출근 < 오후 퇴근 < 연장(자정 넘김 제외).
      // 숫자 하나를 잘못 읽으면(13:57 → 18:57) 순서가 깨진다. 깨진 칸은 「확실치 않음」.
      const toM = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
      for (const [day, row] of Object.entries(res.days)) {
        const seq = SLOTS.filter((sl) => row[sl]).map((sl) => ({ sl, m: toM(row[sl]) }));
        for (let k = 0; k < seq.length; k++) {
          const prev = seq[k - 1];
          const next = seq[k + 1];
          const bad = (prev && seq[k].m < prev.m && !(seq[k].sl === "ot_out" && seq[k].m < 6 * 60)) || (next && next.m < seq[k].m && !(next.sl === "ot_out" && next.m < 6 * 60));
          if (bad && !res.unclear.some((u) => String(u.day) === day && u.slot === seq[k].sl)) res.unclear.push({ day: Number(day), slot: seq[k].sl });
        }
      }
      const header = readHeader(G, card, opts.classifyDigit || (root.HG_HANDDIGITS && root.HG_HANDDIGITS.classify));
      if (header) res.header = header;
      out.push(res);
    }
    return { cards: out, skew };
  }

  const api = { readTimecards, SLOTS, GW, GH, glyphVectorForTest: glyphVector, decodeTemplates, findSkew, whiteGains, _grabber: grabber, _bestSeven: bestSeven, _layoutCard: layoutCard, _headerPenGlyphs: headerPenGlyphs, _lines: { isBlueLine, isOrangeLine, isBlueTint, isOrangeTint, isRedLine, isRedTint } };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HG_TIMECARD = api;
})(typeof window !== "undefined" ? window : globalThis);
