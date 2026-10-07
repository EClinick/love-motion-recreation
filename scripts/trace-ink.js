#!/usr/bin/env node
// Rotoscope the handwriting ink (signature, pen lines, out-of-focus ghost) from the user's
// source video, one alpha matte per frame. Paper shading is fitted and removed, leaving the ink
// (pen strokes, the out-of-focus ghost, the line and its selection box) with its focus blur.
// Mattes are derived media: ref/derived/ink/i_####.bin (zlib, 8-bit alpha, 1440x1080).
//   node scripts/trace-ink.js [n0=17] [n1=26]
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const W = 1440;
const H = 1080;
const FPS = 24000 / 1001;
const n0 = Number(process.argv[2] ?? 17);
const n1 = Number(process.argv[3] ?? 26);
const outDir = path.join(ROOT, 'ref', 'derived', 'ink');
fs.mkdirSync(outDir, { recursive: true });

const gray = (args) => execFileSync('ffmpeg', ['-v', 'error', ...args, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 26 });

// robust quadratic fit of the paper brightness (ignores anything darker than the fit)
function paperFit(L) {
  let keep = null;
  let coef = null;
  for (let it = 0; it < 3; it++) {
    const A = Array.from({ length: 6 }, () => new Float64Array(6));
    const bv = new Float64Array(6);
    for (let y = 0; y < H; y += 6) {
      for (let x = 0; x < W; x += 6) {
        const l = L[y * W + x];
        const u = x / W - 0.5;
        const v = y / H - 0.5;
        const f = [1, u, v, u * u, v * v, u * v];
        if (coef) {
          const p = f.reduce((s, q, k) => s + q * coef[k], 0);
          if (l < p - 6) continue;
        }
        for (let i = 0; i < 6; i++) {
          bv[i] += f[i] * l;
          for (let j = 0; j < 6; j++) A[i][j] += f[i] * f[j];
        }
      }
    }
    // solve A c = b (Gaussian elimination)
    const M = A.map((r, i) => [...r, bv[i]]);
    for (let i = 0; i < 6; i++) {
      let p = i;
      for (let r = i + 1; r < 6; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
      [M[i], M[p]] = [M[p], M[i]];
      for (let r = 0; r < 6; r++) {
        if (r === i) continue;
        const k = M[r][i] / M[i][i];
        for (let c = i; c < 7; c++) M[r][c] -= k * M[i][c];
      }
    }
    coef = M.map((r, i) => r[6] / r[i]);
  }
  keep = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W - 0.5;
      const v = y / H - 0.5;
      keep[y * W + x] = coef[0] + coef[1] * u + coef[2] * v + coef[3] * u * u + coef[4] * v * v + coef[5] * u * v;
    }
  }
  return keep;
}

for (let n = n0; n <= n1; n++) {
  const L = gray(['-i', path.join(ROOT, 'ref', 'reference.mp4'), '-vf', `select='eq(n\\,${n})',scale=${W}:${H}`, '-frames:v', '1', '-fps_mode', 'passthrough']);
  const P = paperFit(L);
  const a = Buffer.alloc(W * H);
  let sum = 0;
  for (let i = 0; i < W * H; i++) {
    const v = Math.max(0, Math.min(1, (P[i] - L[i] - 7) / 150));
    a[i] = Math.round(v * 255);
    sum += a[i];
  }
  fs.writeFileSync(path.join(outDir, `i_${String(n).padStart(4, '0')}.bin`), zlib.gzipSync(a));
  process.stdout.write(`${n}:${Math.round(sum / 255)} `);
}
console.log(`\nmattes -> ${outDir}`);
