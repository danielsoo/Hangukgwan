// 영수증 숫자를 읽는 망을 학습시킨다. 밖에 아무것도 안 보내고 여기서 돈다.
//
// 두 가지를 같이 만들어 **재서 고른다**:
//   mlp  — 196(14×14) → h → 10.  급여 카드의 timecard-handdigits.js 와 같은 꼴.
//   cnn  — 14×14 → 3×3 필터 c개 → 2×2 묶기 → h → 10.
//
// 시험은 **치우치지 않은 정답(big-paired)으로만**, 사진을 묶음으로 나눠
// 돌려가며 한다. 같은 사진의 글씨로 배우고 그 사진을 맞히면 잘 되는 것처럼
// 보인다. 배울 때는 big-boot 도 쓰지만 **시험 사진의 것은 뺀다.**
const fs = require("fs");
const path = require("path");

function load(name) {
  const p = path.join(__dirname, name + ".bin");
  if (!fs.existsSync(p)) return [];
  const b = fs.readFileSync(p);
  const photos = JSON.parse(fs.readFileSync(path.join(__dirname, name + "-photos.json"), "utf8"));
  const out = [];
  for (let i = 0; i < Math.floor(b.length / 787); i++) {
    const o = i * 787;
    const img = new Float32Array(784);
    for (let j = 0; j < 784; j++) img[j] = b[o + 3 + j] / 255;
    out.push({ d: b[o], photo: photos[b.readUInt16LE(o + 1)] || "?", img });
  }
  return out;
}

/** 28×28 → 14×14 (한 점 흐리게 한 뒤 반으로). receipt-digits.js 와 같은 모양. */
function feat14(img) {
  const bl = new Float32Array(784);
  for (let y = 0; y < 28; y++) {
    for (let x = 0; x < 28; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= 28) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= 28) continue;
          s += img[yy * 28 + xx]; n++;
        }
      }
      bl[y * 28 + x] = n ? s / n : 0;
    }
  }
  const f = new Float32Array(196);
  for (let y = 0; y < 14; y++) {
    for (let x = 0; x < 14; x++) {
      f[y * 14 + x] = (bl[y * 2 * 28 + x * 2] + bl[y * 2 * 28 + x * 2 + 1]
        + bl[(y * 2 + 1) * 28 + x * 2] + bl[(y * 2 + 1) * 28 + x * 2 + 1]) / 4;
    }
  }
  return f;
}

// ── 흔들어서 배운다 (자료를 늘리는 대신)
//
// 같은 숫자를 조금 기울이고 옮기고 크기를 바꿔 보여 주면 처음 보는 글씨에도
// 덜 흔들린다. 급여 카드 망도 그렇게 배웠다.
function jitter(img, rnd) {
  const sh = (rnd() - 0.5) * 0.3;
  const dx = (rnd() - 0.5) * 3;
  const dy = (rnd() - 0.5) * 3;
  const sc = 1 + (rnd() - 0.5) * 0.18;
  const out = new Float32Array(784);
  for (let y = 0; y < 28; y++) {
    for (let x = 0; x < 28; x++) {
      const yc = (y - 14 - dy) / sc, xc = (x - 14 - dx) / sc;
      const sx = xc + sh * yc + 14, sy = yc + 14;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 + 1 >= 28 || y0 + 1 >= 28) continue;
      const fx = sx - x0, fy = sy - y0;
      out[y * 28 + x] =
        img[y0 * 28 + x0] * (1 - fx) * (1 - fy) + img[y0 * 28 + x0 + 1] * fx * (1 - fy) +
        img[(y0 + 1) * 28 + x0] * (1 - fx) * fy + img[(y0 + 1) * 28 + x0 + 1] * fx * fy;
    }
  }
  return out;
}

const rngOf = (seed) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

// ── 망 두 가지. 손으로 적은 역전파다 — 의존성을 안 늘린다(Vercel 빌드에 큰
//    꾸러미를 더하지 않는다).

function makeMlp(hidden, rnd) {
  const I = 196, H = hidden, O = 10;
  const w1 = new Float32Array(I * H), b1 = new Float32Array(H);
  const w2 = new Float32Array(H * O), b2 = new Float32Array(O);
  const g = () => (rnd() * 2 - 1);
  for (let i = 0; i < w1.length; i++) w1[i] = g() * Math.sqrt(2 / I);
  for (let i = 0; i < w2.length; i++) w2[i] = g() * Math.sqrt(2 / H);
  const h = new Float32Array(H), o = new Float32Array(O), dh = new Float32Array(H);
  return {
    kind: `mlp${H}`,
    shape: { I, H, O },
    weights: () => ({ w1, b1, w2, b2 }),
    forward(f) {
      for (let j = 0; j < H; j++) {
        let s = b1[j];
        for (let i = 0; i < I; i++) s += f[i] * w1[i * H + j];
        h[j] = s > 0 ? s : 0;
      }
      let mx = -1e9;
      for (let k = 0; k < O; k++) {
        let s = b2[k];
        for (let j = 0; j < H; j++) s += h[j] * w2[j * O + k];
        o[k] = s; if (s > mx) mx = s;
      }
      let sum = 0;
      for (let k = 0; k < O; k++) { o[k] = Math.exp(o[k] - mx); sum += o[k]; }
      for (let k = 0; k < O; k++) o[k] /= sum;
      return o;
    },
    backward(f, label, lr) {
      dh.fill(0);
      for (let k = 0; k < O; k++) {
        const d = o[k] - (k === label ? 1 : 0);
        if (d === 0) continue;
        for (let j = 0; j < H; j++) { dh[j] += d * w2[j * O + k]; w2[j * O + k] -= lr * d * h[j]; }
        b2[k] -= lr * d;
      }
      for (let j = 0; j < H; j++) {
        if (h[j] <= 0) continue;
        const d = dh[j];
        if (d === 0) continue;
        for (let i = 0; i < I; i++) if (f[i] !== 0) w1[i * H + j] -= lr * d * f[i];
        b1[j] -= lr * d;
      }
    },
  };
}

function makeCnn(C, H, rnd) {
  // 14×14 → 3×3 필터 C개 (12×12) → 2×2 최대 묶기 (6×6) → H → 10
  const K = 3, OUT = 12, P = 6, F = C * P * P, O = 10;
  const kw = new Float32Array(C * K * K), kb = new Float32Array(C);
  const w1 = new Float32Array(F * H), b1 = new Float32Array(H);
  const w2 = new Float32Array(H * O), b2 = new Float32Array(O);
  const g = () => (rnd() * 2 - 1);
  for (let i = 0; i < kw.length; i++) kw[i] = g() * Math.sqrt(2 / (K * K));
  for (let i = 0; i < w1.length; i++) w1[i] = g() * Math.sqrt(2 / F);
  for (let i = 0; i < w2.length; i++) w2[i] = g() * Math.sqrt(2 / H);
  const conv = new Float32Array(C * OUT * OUT);
  const pool = new Float32Array(F), pickX = new Int16Array(F), pickY = new Int16Array(F);
  const h = new Float32Array(H), o = new Float32Array(O);
  const dh = new Float32Array(H), dp = new Float32Array(F);
  return {
    kind: `cnn${C}x${H}`,
    shape: { C, H, K, OUT, P, F, O },
    weights: () => ({ kw, kb, w1, b1, w2, b2 }),
    forward(f) {
      for (let c = 0; c < C; c++) {
        const ko = c * K * K, co = c * OUT * OUT;
        for (let y = 0; y < OUT; y++) {
          for (let x = 0; x < OUT; x++) {
            let s = kb[c];
            for (let ky = 0; ky < K; ky++) for (let kx = 0; kx < K; kx++) s += f[(y + ky) * 14 + x + kx] * kw[ko + ky * K + kx];
            conv[co + y * OUT + x] = s > 0 ? s : 0;
          }
        }
      }
      for (let c = 0; c < C; c++) {
        const co = c * OUT * OUT;
        for (let y = 0; y < P; y++) {
          for (let x = 0; x < P; x++) {
            let best = -1e9, bx = 0, by = 0;
            for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
              const v = conv[co + (y * 2 + dy) * OUT + x * 2 + dx];
              if (v > best) { best = v; bx = x * 2 + dx; by = y * 2 + dy; }
            }
            const i = c * P * P + y * P + x;
            pool[i] = best; pickX[i] = bx; pickY[i] = by;
          }
        }
      }
      for (let j = 0; j < H; j++) {
        let s = b1[j];
        for (let i = 0; i < F; i++) s += pool[i] * w1[i * H + j];
        h[j] = s > 0 ? s : 0;
      }
      let mx = -1e9;
      for (let k = 0; k < O; k++) {
        let s = b2[k];
        for (let j = 0; j < H; j++) s += h[j] * w2[j * O + k];
        o[k] = s; if (s > mx) mx = s;
      }
      let sum = 0;
      for (let k = 0; k < O; k++) { o[k] = Math.exp(o[k] - mx); sum += o[k]; }
      for (let k = 0; k < O; k++) o[k] /= sum;
      return o;
    },
    backward(f, label, lr) {
      dh.fill(0); dp.fill(0);
      for (let k = 0; k < O; k++) {
        const d = o[k] - (k === label ? 1 : 0);
        if (d === 0) continue;
        for (let j = 0; j < H; j++) { dh[j] += d * w2[j * O + k]; w2[j * O + k] -= lr * d * h[j]; }
        b2[k] -= lr * d;
      }
      for (let j = 0; j < H; j++) {
        if (h[j] <= 0 || dh[j] === 0) continue;
        const d = dh[j];
        for (let i = 0; i < F; i++) { dp[i] += d * w1[i * H + j]; w1[i * H + j] -= lr * d * pool[i]; }
        b1[j] -= lr * d;
      }
      // 묶기를 거꾸로 — 고른 자리에만 돌려준다
      for (let c = 0; c < C; c++) {
        const ko = c * K * K;
        for (let i = c * P * P; i < (c + 1) * P * P; i++) {
          const d = dp[i];
          if (d === 0 || pool[i] <= 0) continue;
          const y = pickY[i], x = pickX[i];
          for (let ky = 0; ky < K; ky++) for (let kx = 0; kx < K; kx++) kw[ko + ky * K + kx] -= lr * d * f[(y + ky) * 14 + x + kx];
          kb[c] -= lr * d;
        }
      }
    },
  };
}

function netOf(kind, rnd) {
  if (/^cnn/.test(kind)) {
    const [c, h] = kind.slice(3).split("x").map(Number);
    return makeCnn(c, h, rnd);
  }
  return makeMlp(Number(kind.slice(3)), rnd);
}

function train(net, data, opts) {
  const o = Object.assign({ epochs: 14, lr: 0.03, jit: true, seed: 7, decay: 0.88 }, opts || {});
  const rnd = rngOf(o.seed);
  const idx = data.map((_, i) => i);
  for (let ep = 0; ep < o.epochs; ep++) {
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
    const lr = o.lr * Math.pow(o.decay, ep);
    for (const i of idx) {
      const s = data[i];
      const f = o.jit && ep > 0 ? feat14(jitter(s.img, rnd)) : (s.f || (s.f = feat14(s.img)));
      net.forward(f);
      net.backward(f, s.d, lr);
    }
  }
  return net;
}

function accOf(net, test) {
  let ok = 0;
  const per = {};
  for (const s of test) {
    const p = net.forward(s.f || (s.f = feat14(s.img)));
    let d = 0;
    for (let k = 1; k < 10; k++) if (p[k] > p[d]) d = k;
    per[s.d] = per[s.d] || [0, 0];
    per[s.d][0]++;
    if (d === s.d) { ok++; per[s.d][1]++; }
  }
  return { acc: ok / Math.max(test.length, 1), ok, n: test.length, per };
}

if (require.main === module) {
  const P = load(process.env.PAIRED || "big-paired");
  const B = load(process.env.BOOT || "big-boot");
  if (!P.length) { console.log("정답 파일이 없습니다 (harvest.js 를 먼저)"); process.exit(0); }
  for (const s of P) s.f = feat14(s.img);
  const photos = [...new Set(P.map((s) => s.photo))];
  const fold = new Map(photos.map((p, i) => [p, i % 5]));
  console.log(`치우치지 않은 정답 ${P.length}자 (사진 ${photos.length}장) · 배우기용 ${B.length}자`);

  const FOLDS = Number(process.env.FOLDS || 2);
  const EPOCHS = Number(process.env.EPOCHS || 14);
  const results = [];
  for (const kind of (process.env.NETS || "mlp96,mlp192,cnn8x64,cnn16x96").split(",")) {
    let ok = 0, n = 0;
    const per = {};
    const t0 = Date.now();
    for (let g = 0; g < FOLDS; g++) {
      const test = P.filter((s) => fold.get(s.photo) === g);
      const tr = P.filter((s) => fold.get(s.photo) !== g)
        .concat(B.filter((s) => !fold.has(s.photo) || fold.get(s.photo) !== g));
      if (!test.length || !tr.length) continue;
      const net = netOf(kind, rngOf(11 + g));
      train(net, tr, { epochs: EPOCHS, lr: 0.03 });
      const a = accOf(net, test);
      ok += a.ok; n += a.n;
      for (const d of Object.keys(a.per)) {
        per[d] = per[d] || [0, 0];
        per[d][0] += a.per[d][0]; per[d][1] += a.per[d][1];
      }
    }
    console.log(`${kind.padEnd(10)} ${ok}/${n} = ${((ok / Math.max(n, 1)) * 100).toFixed(1)}%   (${((Date.now() - t0) / 1000).toFixed(0)}초)`);
    console.log(`           숫자별: ${Object.keys(per).sort().map((d) => `${d} ${per[d][1]}/${per[d][0]}`).join(" ")}`);
    results.push({ kind, acc: ok / Math.max(n, 1) });
  }
  results.sort((a, b) => b.acc - a.acc);
  console.log(`\n제일 나은 것: ${results[0].kind} ${(results[0].acc * 100).toFixed(1)}%`);
  fs.writeFileSync(path.join(__dirname, "train-result.json"), JSON.stringify(results, null, 1));
}

module.exports = { load, feat14, makeMlp, makeCnn, netOf, train, accOf, jitter, rngOf };
