// 학습한 망을 브라우저 파일로 굽는다 (public/js/receipt-digits.js).
//
// 가중치는 **int8** 로 담는다 — 층마다 제일 큰 값으로 나눠 -127~127 에 넣고,
// 쓸 때 그 배율을 곱한다. 급여 카드의 timecard-handdigits.js 와 같은 방식이다.
// float32 로 담으면 파일이 네 배가 되고, 재보니 맞는 비율은 그대로다.
const fs = require("fs");
const path = require("path");
const { load, feat14, netOf, train, accOf, rngOf } = require("./train.js");

const KIND = process.env.KIND || "cnn16x96";
const EPOCHS = Number(process.env.EPOCHS || 45);
const OUT = process.env.OUT || path.join(__dirname, "..", "public", "js", "receipt-digits.js");

function q8(arr) {
  let mx = 0;
  for (const v of arr) if (Math.abs(v) > mx) mx = Math.abs(v);
  const scale = mx / 127 || 1e-9;
  const out = Buffer.alloc(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = (Math.max(-127, Math.min(127, Math.round(arr[i] / scale))) + 128) & 0xff;
  return { b64: out.toString("base64"), scale };
}

(async () => {
  const P = load(process.env.PAIRED || "big-paired");
  const B = load(process.env.BOOT || "big-boot");
  if (!P.length) throw new Error("정답 파일이 없습니다");
  for (const s of P) s.f = feat14(s.img);
  console.log(`배울 자료 ${P.length + B.length}자 (치우치지 않은 ${P.length} + ${B.length})`);

  // 묶음 하나를 떼어 「배운 뒤 얼마나 맞나」를 적어 두려고
  const photos = [...new Set(P.map((s) => s.photo))];
  const fold = new Map(photos.map((p, i) => [p, i % 8]));
  const hold = P.filter((s) => fold.get(s.photo) === 0);
  const tr = P.filter((s) => fold.get(s.photo) !== 0)
    .concat(B.filter((s) => !fold.has(s.photo) || fold.get(s.photo) !== 0));

  const t0 = Date.now();
  const net = netOf(KIND, rngOf(2026));
  train(net, tr, { epochs: EPOCHS, lr: 0.03 });
  const a = accOf(net, hold);
  console.log(`${KIND} ${EPOCHS}번 돌림 (${((Date.now() - t0) / 1000).toFixed(0)}초) — 떼어 둔 사진에서 ${a.ok}/${a.n} = ${(a.acc * 100).toFixed(1)}%`);

  // 전부로 한 번 더 (실제로 쓸 것은 떼어 두지 않는다)
  const full = netOf(KIND, rngOf(2026));
  train(full, P.concat(B), { epochs: EPOCHS, lr: 0.03 });
  const W = full.weights();
  const S = full.shape;

  const packed = {};
  const scales = {};
  let bytes = 0;
  for (const [k, v] of Object.entries(W)) {
    const q = q8(v);
    packed[k] = q.b64;
    scales[k] = q.scale;
    bytes += v.length;
  }
  console.log(`가중치 ${bytes}개 → ${(bytes / 1024).toFixed(0)}KB (base64 ${(bytes * 4 / 3 / 1024).toFixed(0)}KB)`);

  const isCnn = /^cnn/.test(KIND);
  const header = `// 영수증에 손으로 쓴 숫자를 읽는다 — **기기 안에서.**
//
// 2026-10-05 사장님: "영수증을 올리면 가격 품목 어디서 언제 샀는지를 내가 직접
// 타자로 쳐서 하나하나 입력하는 게 아니라 적용되도록." 사진은 기기 밖으로
// 나가지 않는다. 사장님: "cnn 이나 그런 걸로 학습이 안되는건가?" — 된다.
// 이 파일이 그 망이고, 여기서 돈다.
//
// ── 정답표는 사장님 엑셀이다
//
// 사람이 정답을 하나도 적지 않았다. 종이에서 센 줄 수가 엑셀 줄 수와 맞은
// 영수증은 「종이 n째 줄 = 엑셀 n째 줄」이므로, 단가·금액 칸의 글자 수가 엑셀
// 자리 수와 같으면 글자마다 정답이 붙는다. 사장님 영수증 사진 13,777장
// (2022~2026, 업체 20곳)에서 그렇게 **${(P.length).toLocaleString()}자**를 모았다.
// 뽑는 길은 scratchpad 의 harvest.js → bake-net.js 다.
//
// ── 왜 가까운 이웃에서 망으로 바꿨는가
//
// 처음엔 1,165자뿐이어서 가까운 이웃(k-means 견본)이 제일 나았다. 자료가
// 15배가 되니 망이 이긴다. **같은 자료·같은 묶음**으로 재면:
//
//   가까운 이웃 (견본 40개/숫자)   79.3%   ← 예전 방식
//   가까운 이웃 (견본 120개/숫자)  81.8%
//   mlp 96                       86.0%
//   mlp 384                      87.1%
//   ${isCnn ? "**이 파일**" : "mlp"}                    ${"           ".slice(0, 2)}
//
// 자세한 숫자는 커밋 메시지에 적었다.
//
// ── 왜 급여 카드의 판별기를 그냥 쓰지 않는가
//
// timecard-handdigits.js 는 MNIST(서양 손글씨)로 배운 망이다. 급여 카드 머리의
// 「115 年 9 月份」은 32/32 로 읽는데 영수증 숫자는 66% 밖에 못 읽었다. 업체
// 분들이 쓰는 숫자는 모양이 다르다 — 0 을 길게 눌러 쓰고, 1 에 갈고리가 없고,
// 5 의 위 획이 떨어져 있다.
//
// ── 못 읽는 것은 못 읽는다고 한다
//
// 글자 하나가 ${(a.acc * 100).toFixed(0)}% 면 세 자리 금액은 ${Math.round(Math.pow(a.acc, 3) * 100)}% 다. 그래서 **확신(p)을 같이**
// 돌려주고, 부르는 쪽(receipt-ocr.js 의 readRow)이 수량 × 단가 = 금액 으로 한 번
// 더 본다. 틀린 값을 표시 없이 채우는 것이 제일 나쁘다.
//
// 입력은 timecard-handdigits.js 와 같다 — 28×28 Float32, 0 바탕 1 잉크,
// 무게중심이 가운데(receipt-ocr.js 의 toGlyphImage 가 만든다).
(function (root) {
  "use strict";

  // ${KIND}: 14×14 → ${isCnn ? `3×3 필터 ${S.C}개 → 2×2 묶기 → ${S.H} → 10` : `${S.H} → 10`}
  const KIND = ${JSON.stringify(KIND)};
  const SHAPE = ${JSON.stringify(S)};
  const SCALE = ${JSON.stringify(Object.fromEntries(Object.entries(scales).map(([k, v]) => [k, +v.toExponential(6)])))};
  const DATA = {
${Object.entries(packed).map(([k, v]) => `    ${k}: "${v}",`).join("\n")}
  };

  let W = null;
  function weights() {
    if (W) return W;
    W = {};
    for (const k of Object.keys(DATA)) {
      const bin = typeof atob === "function" ? atob(DATA[k]) : Buffer.from(DATA[k], "base64").toString("binary");
      const a = new Float32Array(bin.length);
      for (let i = 0; i < bin.length; i++) a[i] = (bin.charCodeAt(i) - 128) * SCALE[k];
      W[k] = a;
    }
    return W;
  }

  /**
   * 28×28 → 14×14. 한 점 흐리게 한 뒤 반으로 줄인다.
   *
   * 손글씨는 획 굵기와 한두 점 밀림이 늘 다른데, 흐리게 해 두면 그것에 덜
   * 흔들린다. 망도 이 모양으로 배웠으므로 **여기를 바꾸면 가중치를 다시
   * 구워야 한다.**
   */
  function featureOf(img) {
    const bl = new Float32Array(784);
    for (let y = 0; y < 28; y++) {
      for (let x = 0; x < 28; x++) {
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= 28) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= 28) continue;
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

  function softmax(o) {
    let mx = -Infinity;
    for (const v of o) if (v > mx) mx = v;
    let sum = 0;
    for (let i = 0; i < o.length; i++) { o[i] = Math.exp(o[i] - mx); sum += o[i]; }
    for (let i = 0; i < o.length; i++) o[i] /= sum;
    return o;
  }

${isCnn ? `  function run(f) {
    const w = weights();
    const { C, H, K, OUT: O2, P, F, O } = SHAPE;
    const pool = new Float32Array(F);
    for (let c = 0; c < C; c++) {
      const ko = c * K * K;
      // 3×3 을 거른 뒤 2×2 로 묶는다. 묶기까지 한 번에 — 중간 판을 안 만든다.
      for (let py = 0; py < P; py++) {
        for (let px = 0; px < P; px++) {
          let best = 0;
          for (let dy = 0; dy < 2; dy++) {
            for (let dx = 0; dx < 2; dx++) {
              const y = py * 2 + dy, x = px * 2 + dx;
              if (y >= O2 || x >= O2) continue;
              let s = w.kb[c];
              for (let ky = 0; ky < K; ky++) {
                for (let kx = 0; kx < K; kx++) s += f[(y + ky) * 14 + x + kx] * w.kw[ko + ky * K + kx];
              }
              if (s > best) best = s;   // ReLU + 최대 묶기
            }
          }
          pool[c * P * P + py * P + px] = best;
        }
      }
    }
    const h = new Float32Array(H);
    for (let j = 0; j < H; j++) {
      let s = w.b1[j];
      for (let i = 0; i < F; i++) s += pool[i] * w.w1[i * H + j];
      h[j] = s > 0 ? s : 0;
    }
    const o = new Float32Array(O);
    for (let k = 0; k < O; k++) {
      let s = w.b2[k];
      for (let j = 0; j < H; j++) s += h[j] * w.w2[j * O + k];
      o[k] = s;
    }
    return softmax(o);
  }` : `  function run(f) {
    const w = weights();
    const { I, H, O } = SHAPE;
    const h = new Float32Array(H);
    for (let j = 0; j < H; j++) {
      let s = w.b1[j];
      for (let i = 0; i < I; i++) s += f[i] * w.w1[i * H + j];
      h[j] = s > 0 ? s : 0;
    }
    const o = new Float32Array(O);
    for (let k = 0; k < O; k++) {
      let s = w.b2[k];
      for (let j = 0; j < H; j++) s += h[j] * w.w2[j * O + k];
      o[k] = s;
    }
    return softmax(o);
  }`}

  /**
   * 숫자 하나를 읽는다.
   * @param img 28×28 Float32 (0 바탕, 1 잉크, 무게중심 가운데)
   * @returns {digit, p, probs} — p 는 **이 숫자일 확신**.
   */
  function classify(img) {
    if (!img || img.length !== 784) return null;
    const probs = run(featureOf(img));
    let digit = 0;
    for (let d = 1; d < 10; d++) if (probs[d] > probs[digit]) digit = d;
    return { digit, p: probs[digit], probs: Array.from(probs) };
  }

  const api = { classify, featureOf, kind: KIND, heldOut: ${a.acc.toFixed(4)} };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HG_RECEIPT_DIGITS = api;
})(typeof window !== "undefined" ? window : globalThis);
`;
  fs.writeFileSync(OUT, header);
  console.log(`${OUT} 에 썼다 (${(fs.statSync(OUT).size / 1024).toFixed(0)}KB)`);

  // 구운 파일로 다시 재서 int8 로 눌러 담은 손해를 확인한다
  delete require.cache[require.resolve(OUT)];
  const baked = require(OUT);
  let ok = 0;
  for (const s of hold) {
    const r = baked.classify(s.img);
    if (r && r.digit === s.d) ok++;
  }
  console.log(`구운 파일로 떼어 둔 사진 다시 재기: ${ok}/${hold.length} = ${((ok / hold.length) * 100).toFixed(1)}% (학습 직후 ${(a.acc * 100).toFixed(1)}%)`);
})();
