// 칸을 **쪼개지 않고 통째로** 읽는 망을 학습시킨다.
//
// 왜: 칸 4,609개로 재보니 글자를 자리 수대로 쪼개는 데서 **53.6%** 를 잃고
// 숫자를 알아보는 데서는 11.5% 밖에 안 잃었다(tools/segloss.js). 쪼개는
// 단계를 없애는 것이 제일 큰 몫이다.
//
// 어떻게: 칸 그림(높이 32 · 가로 최대 160)을 왼쪽에서 오른쪽으로 훑으며
// 자리마다 「0~9 아니면 빈칸」을 내놓고, **CTC** 로 글자 수를 맞춰 배운다.
// CTC 는 「어느 자리가 어느 글자인지」를 안 알려줘도 배울 수 있게 해 준다 —
// 우리에게 있는 정답은 「이 칸은 120」뿐이고 글자 자리는 모르기 때문이다.
//
// 망은 작게 간다(기기 안에서 돌고 파일로 박아야 한다):
//   32×W → 3×3 필터 C개 · 2×2 묶기 → 16×(W/2)
//        → 3×3 필터 D개 · 세로로만 4 묶기 → 4×(W/2)
//        → 자리마다 4·D 값을 11 갈래로
const fs = require("fs");
const path = require("path");

const H = 32, W = 160, BLANK = 10, NCLASS = 11;

function load(name) {
  const p = path.join(__dirname, (name || "cells") + ".bin");
  if (!fs.existsSync(p)) return [];
  const b = fs.readFileSync(p);
  const photos = JSON.parse(fs.readFileSync(path.join(__dirname, (name || "cells") + "-photos.json"), "utf8"));
  const REC = 11 + H * W;
  const out = [];
  for (let i = 0; i < Math.floor(b.length / REC); i++) {
    const o = i * REC;
    const len = b[o + 2];
    const label = [];
    for (let j = 0; j < len; j++) label.push(b[o + 3 + j]);
    const img = new Float32Array(H * W);
    for (let j = 0; j < H * W; j++) img[j] = b[o + 11 + j] / 255;
    out.push({ label, text: label.join(""), photo: photos[b.readUInt16LE(o)] || "?", used: b[o + 10], img });
  }
  return out;
}

const rngOf = (seed) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

/**
 * 훑어 읽는 망.
 *
 * 가로를 4분의 1로 줄여 자리(T)마다 11 갈래를 내놓는다. 160 이면 40자리 —
 * 일곱 자리 숫자에도 넉넉하다(CTC 는 자리가 글자보다 많아야 한다).
 */
function makeSeq(C, D, rnd) {
  const K = 3;
  const H1 = 16, W1 = W >> 1;          // 1층 뒤 (2×2 묶기)
  const H2 = 4, W2 = W >> 2;           // 2층 뒤 (세로 4 · 가로 2 묶기)
  const F = H2 * D;                    // 자리마다 들어오는 값
  const k1 = new Float32Array(C * K * K), b1 = new Float32Array(C);
  const k2 = new Float32Array(D * C * K * K), b2 = new Float32Array(D);
  const wo = new Float32Array(F * NCLASS), bo = new Float32Array(NCLASS);
  const g = () => (rnd() * 2 - 1);
  for (let i = 0; i < k1.length; i++) k1[i] = g() * Math.sqrt(2 / (K * K));
  for (let i = 0; i < k2.length; i++) k2[i] = g() * Math.sqrt(2 / (C * K * K));
  for (let i = 0; i < wo.length; i++) wo[i] = g() * Math.sqrt(2 / F);

  // 일하는 자리를 미리 잡아 둔다 (한 칸마다 새로 만들면 느리다)
  const a1 = new Float32Array(C * H1 * W1);
  const p1x = new Int16Array(C * H1 * W1), p1y = new Int16Array(C * H1 * W1);
  const a2 = new Float32Array(D * H2 * W2);
  const p2x = new Int16Array(D * H2 * W2), p2y = new Int16Array(D * H2 * W2);
  const logits = new Float32Array(W2 * NCLASS);
  const probs = new Float32Array(W2 * NCLASS);
  const dLog = new Float32Array(W2 * NCLASS);
  const dA2 = new Float32Array(D * H2 * W2);
  const dA1 = new Float32Array(C * H1 * W1);

  function forward(img, tw) {
    const T = Math.max(1, Math.min(W2, Math.ceil(tw / 4)));
    // 1층: 3×3 → ReLU → 2×2 최대 묶기
    a1.fill(0);
    for (let c = 0; c < C; c++) {
      const ko = c * K * K;
      for (let y = 0; y < H1; y++) {
        for (let x = 0; x < W1; x++) {
          let best = 0, bx = 0, by = 0;
          for (let dy = 0; dy < 2; dy++) {
            for (let dx = 0; dx < 2; dx++) {
              const iy = y * 2 + dy, ix = x * 2 + dx;
              if (iy + K > H || ix + K > W) continue;
              let s = b1[c];
              for (let ky = 0; ky < K; ky++) {
                for (let kx = 0; kx < K; kx++) s += img[(iy + ky) * W + ix + kx] * k1[ko + ky * K + kx];
              }
              if (s > best) { best = s; bx = ix; by = iy; }
            }
          }
          const i = c * H1 * W1 + y * W1 + x;
          a1[i] = best; p1x[i] = bx; p1y[i] = by;
        }
      }
    }
    // 2층: 3×3(채널 C) → ReLU → 세로 4 · 가로 2 묶기
    a2.fill(0);
    for (let d = 0; d < D; d++) {
      for (let y = 0; y < H2; y++) {
        for (let x = 0; x < T; x++) {
          let best = 0, bx = 0, by = 0;
          for (let dy = 0; dy < 4; dy++) {
            for (let dx = 0; dx < 2; dx++) {
              const iy = y * 4 + dy, ix = x * 2 + dx;
              if (iy + K > H1 || ix + K > W1) continue;
              let s = b2[d];
              for (let c = 0; c < C; c++) {
                const ko = (d * C + c) * K * K;
                for (let ky = 0; ky < K; ky++) {
                  for (let kx = 0; kx < K; kx++) s += a1[c * H1 * W1 + (iy + ky) * W1 + ix + kx] * k2[ko + ky * K + kx];
                }
              }
              if (s > best) { best = s; bx = ix; by = iy; }
            }
          }
          const i = d * H2 * W2 + y * W2 + x;
          a2[i] = best; p2x[i] = bx; p2y[i] = by;
        }
      }
    }
    // 자리마다 11 갈래
    for (let t = 0; t < T; t++) {
      let mx = -1e9;
      for (let k = 0; k < NCLASS; k++) {
        let s = bo[k];
        for (let d = 0; d < D; d++) {
          for (let y = 0; y < H2; y++) s += a2[d * H2 * W2 + y * W2 + t] * wo[(d * H2 + y) * NCLASS + k];
        }
        logits[t * NCLASS + k] = s;
        if (s > mx) mx = s;
      }
      let sum = 0;
      for (let k = 0; k < NCLASS; k++) { const e = Math.exp(logits[t * NCLASS + k] - mx); probs[t * NCLASS + k] = e; sum += e; }
      for (let k = 0; k < NCLASS; k++) probs[t * NCLASS + k] /= sum;
    }
    return T;
  }

  /** CTC — 자리별 확률과 정답 글자열로 「각 자리가 무엇이어야 하는지」를 센다. */
  function ctcGrad(T, label) {
    const L = label.length;
    const S = 2 * L + 1;                 // 글자 사이에 빈칸을 끼운 길이
    const ext = new Int32Array(S);
    for (let i = 0; i < S; i++) ext[i] = i % 2 === 0 ? BLANK : label[(i - 1) / 2];
    // 자리가 모자라면 못 배운다. 같은 글자가 붙어 있으면(「220」) 그 사이에
    // 빈칸이 하나 더 필요하다.
    let need = L;
    for (let i = 1; i < L; i++) if (label[i] === label[i - 1]) need++;
    if (T < need) return null;
    const NEG = -1e30;
    const lse = (a, b) => (a === NEG ? b : b === NEG ? a : Math.max(a, b) + Math.log1p(Math.exp(-Math.abs(a - b))));
    const lp = (t, k) => Math.log(Math.max(probs[t * NCLASS + k], 1e-12));
    const al = new Float64Array(T * S).fill(NEG);
    const be = new Float64Array(T * S).fill(NEG);
    al[0] = lp(0, ext[0]);
    if (S > 1) al[1] = lp(0, ext[1]);
    for (let t = 1; t < T; t++) {
      for (let s = 0; s < S; s++) {
        let v = al[(t - 1) * S + s];
        if (s > 0) v = lse(v, al[(t - 1) * S + s - 1]);
        if (s > 1 && ext[s] !== BLANK && ext[s] !== ext[s - 2]) v = lse(v, al[(t - 1) * S + s - 2]);
        al[t * S + s] = v === NEG ? NEG : v + lp(t, ext[s]);
      }
    }
    be[(T - 1) * S + S - 1] = 0;
    if (S > 1) be[(T - 1) * S + S - 2] = 0;
    for (let t = T - 2; t >= 0; t--) {
      for (let s = 0; s < S; s++) {
        let v = be[(t + 1) * S + s] === NEG ? NEG : be[(t + 1) * S + s] + lp(t + 1, ext[s]);
        if (s + 1 < S) {
          const u = be[(t + 1) * S + s + 1] === NEG ? NEG : be[(t + 1) * S + s + 1] + lp(t + 1, ext[s + 1]);
          v = lse(v, u);
        }
        if (s + 2 < S && ext[s + 2] !== BLANK && ext[s + 2] !== ext[s]) {
          const u = be[(t + 1) * S + s + 2] === NEG ? NEG : be[(t + 1) * S + s + 2] + lp(t + 1, ext[s + 2]);
          v = lse(v, u);
        }
        be[t * S + s] = v;
      }
    }
    let tot = lse(al[(T - 1) * S + S - 1], S > 1 ? al[(T - 1) * S + S - 2] : NEG);
    // NEG 는 -1e30 이라 isFinite 를 통과한다. 그대로 두면 손실이 1e30 으로
    // 터지고 가중치가 날아간다 — 처음에 그렇게 만들어서 0.3% 가 나왔다.
    if (!(tot > -1e20) || !isFinite(tot)) return null;
    // dL/dlogit = p - (그 자리에서 그 글자가 쓰일 확률)
    dLog.fill(0);
    for (let t = 0; t < T; t++) {
      const want = new Float64Array(NCLASS).fill(NEG);
      for (let s = 0; s < S; s++) {
        const v = al[t * S + s] === NEG || be[t * S + s] === NEG ? NEG : al[t * S + s] + be[t * S + s];
        if (v !== NEG) want[ext[s]] = lse(want[ext[s]], v);
      }
      for (let k = 0; k < NCLASS; k++) {
        const g2 = want[k] === NEG ? 0 : Math.exp(want[k] - tot);
        // **자리 수로 나눈다.** 자리가 40개면 같은 가중치에 40번 더해져서
        // 걸음이 40배가 되고 두 번째 돌 때 가중치가 NaN 으로 날아갔다.
        dLog[t * NCLASS + k] = (probs[t * NCLASS + k] - g2) / T;
      }
    }
    return -tot;
  }

  // **한 걸음의 크기를 묶는다.**
  //
  // 안 묶으면 걸음을 조금만 키워도(0.05 → 0.2) 가중치가 NaN 으로 날아가고
  // 그 다음부터 모든 칸이 「못 배움」이 된다. CTC 는 처음에 손실이 크고
  // 기울기가 들쭉날쭉해서 특히 그렇다.
  const CLIP = 0.01;
  const step = (v) => (v > CLIP ? CLIP : v < -CLIP ? -CLIP : v);

  function backward(img, T, lr) {
    dA2.fill(0); dA1.fill(0);
    for (let t = 0; t < T; t++) {
      for (let k = 0; k < NCLASS; k++) {
        const d = dLog[t * NCLASS + k];
        if (d === 0) continue;
        for (let dd = 0; dd < D; dd++) {
          for (let y = 0; y < H2; y++) {
            const i = dd * H2 * W2 + y * W2 + t;
            dA2[i] += d * wo[(dd * H2 + y) * NCLASS + k];
            wo[(dd * H2 + y) * NCLASS + k] -= step(lr * d * a2[i]);
          }
        }
        bo[k] -= step(lr * d);
      }
    }
    for (let d = 0; d < D; d++) {
      for (let y = 0; y < H2; y++) {
        for (let x = 0; x < T; x++) {
          const i = d * H2 * W2 + y * W2 + x;
          const gr = dA2[i];
          if (gr === 0 || a2[i] <= 0) continue;
          const iy = p2y[i], ix = p2x[i];
          for (let c = 0; c < C; c++) {
            const ko = (d * C + c) * K * K;
            for (let ky = 0; ky < K; ky++) {
              for (let kx = 0; kx < K; kx++) {
                const j = c * H1 * W1 + (iy + ky) * W1 + ix + kx;
                dA1[j] += gr * k2[ko + ky * K + kx];
                k2[ko + ky * K + kx] -= step(lr * gr * a1[j]);
              }
            }
          }
          b2[d] -= step(lr * gr);
        }
      }
    }
    for (let c = 0; c < C; c++) {
      const ko = c * K * K;
      for (let i = c * H1 * W1; i < (c + 1) * H1 * W1; i++) {
        const gr = dA1[i];
        if (gr === 0 || a1[i] <= 0) continue;
        const iy = p1y[i], ix = p1x[i];
        for (let ky = 0; ky < K; ky++) {
          for (let kx = 0; kx < K; kx++) k1[ko + ky * K + kx] -= step(lr * gr * img[(iy + ky) * W + ix + kx]);
        }
        b1[c] -= step(lr * gr);
      }
    }
  }

  /** 제일 그럴듯한 길을 따라 읽고 같은 글자·빈칸을 합친다. */
  function decode(T) {
    let outTxt = "", prev = -1, worst = 1;
    for (let t = 0; t < T; t++) {
      let k = 0;
      for (let j = 1; j < NCLASS; j++) if (probs[t * NCLASS + j] > probs[t * NCLASS + k]) k = j;
      if (k !== prev && k !== BLANK) {
        outTxt += String(k);
        if (probs[t * NCLASS + k] < worst) worst = probs[t * NCLASS + k];
      }
      prev = k;
    }
    return { text: outTxt, p: outTxt ? worst : 0 };
  }

  return {
    kind: `seq${C}x${D}`,
    shape: { C, D, K, H, W, H1, W1, H2, W2, F, NCLASS, BLANK },
    weights: () => ({ k1, b1, k2, b2, wo, bo }),
    forward, ctcGrad, backward, decode,
  };
}

function train(net, data, opts) {
  const o = Object.assign({ epochs: 8, lr: 0.05, seed: 5, decay: 0.85 }, opts || {});
  const rnd = rngOf(o.seed);
  const idx = data.map((_, i) => i);
  for (let ep = 0; ep < o.epochs; ep++) {
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
    const lr = o.lr * Math.pow(o.decay, ep);
    let loss = 0, n = 0, skipped = 0;
    for (const i of idx) {
      const s = data[i];
      const T = net.forward(s.img, s.used);
      const l = net.ctcGrad(T, s.label);
      if (l == null) { skipped++; continue; }
      loss += l; n++;
      net.backward(s.img, T, lr);
    }
    if (o.log) console.log(`  ${ep + 1}번째: 손실 ${(loss / Math.max(n, 1)).toFixed(3)} (배운 칸 ${n} · 건너뛴 칸 ${skipped})`);
  }
  return net;
}

function accOf(net, test) {
  let ok = 0;
  const byLen = {};
  for (const s of test) {
    const T = net.forward(s.img, s.used);
    const d = net.decode(T);
    const L = s.text.length;
    byLen[L] = byLen[L] || [0, 0];
    byLen[L][0]++;
    if (d.text === s.text) { ok++; byLen[L][1]++; }
  }
  return { acc: ok / Math.max(test.length, 1), ok, n: test.length, byLen };
}

if (require.main === module) {
  const all = load(process.env.CELLS || "cells");
  if (!all.length) { console.log("cells.bin 이 없습니다 (harvest-cells.js 를 먼저)"); process.exit(0); }
  const photos = [...new Set(all.map((s) => s.photo))];
  const fold = new Map(photos.map((p, i) => [p, i % 5]));
  console.log(`칸 ${all.length}개 · 사진 ${photos.length}장`);
  const lens = {};
  for (const s of all) lens[s.text.length] = (lens[s.text.length] || 0) + 1;
  console.log(`자리 수: ${Object.keys(lens).sort().map((k) => `${k}자리 ${lens[k]}`).join(" · ")}`);

  const FOLDS = Number(process.env.FOLDS || 1);
  const EPOCHS = Number(process.env.EPOCHS || 8);
  for (const kind of (process.env.NETS || "seq12x24").split(",")) {
    const [C, D] = kind.slice(3).split("x").map(Number);
    let ok = 0, n = 0;
    const byLen = {};
    const t0 = Date.now();
    for (let g = 0; g < FOLDS; g++) {
      const test = all.filter((s) => fold.get(s.photo) === g);
      const tr = all.filter((s) => fold.get(s.photo) !== g);
      if (!test.length || !tr.length) continue;
      const net = makeSeq(C, D, rngOf(31 + g));
      train(net, tr, { epochs: EPOCHS, lr: 0.01, log: !!process.env.LOG });
      const a = accOf(net, test);
      ok += a.ok; n += a.n;
      for (const k of Object.keys(a.byLen)) {
        byLen[k] = byLen[k] || [0, 0];
        byLen[k][0] += a.byLen[k][0]; byLen[k][1] += a.byLen[k][1];
      }
    }
    console.log(`${kind}  칸 통째로 맞은 것 ${ok}/${n} = ${((ok / Math.max(n, 1)) * 100).toFixed(1)}%  (${((Date.now() - t0) / 1000).toFixed(0)}초)`);
    console.log(`        자리 수별: ${Object.keys(byLen).sort().map((k) => `${k}자리 ${byLen[k][1]}/${byLen[k][0]}`).join(" · ")}`);
  }
}

module.exports = { load, makeSeq, train, accOf, rngOf, H, W, NCLASS, BLANK };
