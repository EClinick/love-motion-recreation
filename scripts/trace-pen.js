#!/usr/bin/env node
// Rotoscope the red pen scribbles of the finale from the user's source video, one alpha matte
// per frame. The pen is keyed on redness (r - max(g, b)); dark letter/dot pixels are excluded so
// only the pen line survives. Colour is applied in code. Mattes are derived media:
// ref/derived/pen/p_####.bin (gzip, 8-bit alpha, 1440x1080).
//   node scripts/trace-pen.js [n0=413] [n1=487] [pen|dark]
// `dark` keys the black ink instead (the final collapsed letter block, frame 487) -> k_####.bin
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const W = 1440;
const H = 1080;
const n0 = Number(process.argv[2] ?? 413);
const n1 = Number(process.argv[3] ?? 487);
const MODE = process.argv[4] ?? 'pen';
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
    let v;
    if (MODE === 'dark') {
      // black ink (~#1a1212) on paper (~#d8d8d8); red pen pixels are excluded by their redness
      const l = (r + g + b) / 3;
      v = r - Math.max(g, b) > 60 ? 0 : Math.max(0, Math.min(1, (200 - l) / 165));
    } else {
      // pen core measures about (209, 64, 50): redness ~145; paper ~0; letters/dots ~20-35 but dark
      if ((r + g + b) / 3 < 80 && r - Math.max(g, b) < 60) continue; // dark ink, not deep-red pen
      v = Math.max(0, Math.min(1, (r - Math.max(g, b) - 22) / 125));
    }
    a[i] = Math.round(v * 255);
    sum += a[i];
  }
  if (MODE === 'dark') {
    // where the red pen crosses the black ink the key drops out: fill pen pixels that have solid
    // ink on both sides (horizontally or vertically) within a few pixels
    // pen pixels (red, or mid-tone where the line is thin) - never bright paper
    const red = (i) => (rgb[i * 3] + rgb[i * 3 + 1] + rgb[i * 3 + 2]) / 3 < 185 || rgb[i * 3] - Math.max(rgb[i * 3 + 1], rgb[i * 3 + 2]) > 40;
    const fill = [];
    for (let y = 5; y < H - 5; y++) {
      for (let x = 5; x < W - 5; x++) {
        const i = y * W + x;
        if (a[i] > 200 || !red(i)) continue;
        const solid = (dx, dy) => {
          for (let k = 1; k <= 5; k++) if (a[i + dy * k * W + dx * k] > 200) return true;
          return false;
        };
        if ((solid(-1, 0) && solid(1, 0)) || (solid(0, -1) && solid(0, 1))) fill.push(i);
      }
    }
    fill.forEach((i) => (a[i] = 255));
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
  fs.writeFileSync(path.join(outDir, `${MODE === 'dark' ? 'k' : 'p'}_${String(n).padStart(4, '0')}.bin`), zlib.gzipSync(a));
  process.stdout.write(`${n}:${Math.round(sum / 255)} `);
}
console.log(`\nmattes -> ${outDir}`);
