#!/usr/bin/env node
// Rotoscope the red pen scribbles of the finale from the user's source video, one alpha matte
// per frame. The pen is keyed on redness (r - max(g, b)); dark letter/dot pixels are excluded so
// only the pen line survives. Colour is applied in code. Mattes are derived media:
// ref/derived/pen/p_####.bin (gzip, 8-bit alpha, 1440x1080).
//   node scripts/trace-pen.js [n0=413] [n1=487]
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const W = 1440;
const H = 1080;
const n0 = Number(process.argv[2] ?? 413);
const n1 = Number(process.argv[3] ?? 487);
const outDir = path.join(ROOT, 'ref', 'derived', 'pen');
fs.mkdirSync(outDir, { recursive: true });

for (let n = n0; n <= n1; n++) {
  const rgb = execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(ROOT, 'ref', 'reference.mp4'), '-vf', `select='eq(n\\,${n})',scale=${W}:${H}:flags=area`, '-frames:v', '1', '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 26 });
  const a = Buffer.alloc(W * H);
  let sum = 0;
  for (let i = 0; i < W * H; i++) {
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    // pen core measures about (209, 64, 50): redness ~145; paper ~0; letters/dots ~20-35 but dark
    if ((r + g + b) / 3 < 80) continue;
    const v = Math.max(0, Math.min(1, (r - Math.max(g, b) - 22) / 125));
    a[i] = Math.round(v * 255);
    sum += a[i];
  }
  // drop weak specks (antialiased letter edges register faintly): keep 8-connected components
  // whose strongest pixel is a real pen core
  const lab = new Int32Array(W * H);
  const st = [];
  let next = 1;
  sum = 0;
  for (let i = 0; i < W * H; i++) {
    if (!a[i] || lab[i]) continue;
    const pix = [];
    let mx = 0;
    lab[i] = next;
    st.push(i);
    while (st.length) {
      const k = st.pop();
      pix.push(k);
      mx = Math.max(mx, a[k]);
      const kx = k % W;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const j = k + dy * W + dx;
          if (j < 0 || j >= W * H || (dx < 0 && kx === 0) || (dx > 0 && kx === W - 1)) continue;
          if (a[j] && !lab[j]) { lab[j] = next; st.push(j); }
        }
      }
    }
    if (mx < 90) pix.forEach((k) => (a[k] = 0));
    else pix.forEach((k) => (sum += a[k]));
    next++;
  }
  fs.writeFileSync(path.join(outDir, `p_${String(n).padStart(4, '0')}.bin`), zlib.gzipSync(a));
  process.stdout.write(`${n}:${Math.round(sum / 255)} `);
}
console.log(`\nmattes -> ${outDir}`);
