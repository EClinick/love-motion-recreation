#!/usr/bin/env node
// Rotoscope the hand silhouette from the user's source video, one mask per frame of
// the hand shot. Masks are derived media: written to ref/derived/hand/ (gitignored).
//   node scripts/trace-hand.js [t0=13.76] [t1=15.89]
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const ROOT = path.join(__dirname, '..');
const FPS = 24000 / 1001;
const W = 1440;
const H = 1080;
const t0 = Number(process.argv[2] ?? 13.76);
const t1 = Number(process.argv[3] ?? 15.89);
const outDir = path.join(ROOT, 'ref', 'derived', 'hand');
fs.mkdirSync(outDir, { recursive: true });

function largestComponent(m) {
  const lab = new Int32Array(W * H);
  let best = 0;
  let bestLab = 0;
  let next = 1;
  const stack = [];
  for (let i = 0; i < W * H; i++) {
    if (!m[i] || lab[i]) continue;
    let n = 0;
    lab[i] = next;
    stack.push(i);
    while (stack.length) {
      const k = stack.pop();
      n++;
      const kx = k % W;
      const ky = (k / W) | 0;
      if (kx > 0 && m[k - 1] && !lab[k - 1]) { lab[k - 1] = next; stack.push(k - 1); }
      if (kx < W - 1 && m[k + 1] && !lab[k + 1]) { lab[k + 1] = next; stack.push(k + 1); }
      if (ky > 0 && m[k - W] && !lab[k - W]) { lab[k - W] = next; stack.push(k - W); }
      if (ky < H - 1 && m[k + W] && !lab[k + W]) { lab[k + W] = next; stack.push(k + W); }
    }
    if (n > best) { best = n; bestLab = next; }
    next++;
  }
  for (let i = 0; i < W * H; i++) m[i] = lab[i] === bestLab ? 1 : 0;
  return m;
}

(async () => {
  const f0 = Math.round(t0 * FPS);
  const f1 = Math.round(t1 * FPS);
  for (let f = f0; f <= f1; f++) {
    const t = f / FPS;
    const buf = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', path.join(ROOT, 'ref', 'reference.mp4'), '-frames:v', '1', '-vf', `scale=${W}:${H}`, '-f', 'image2pipe', '-vcodec', 'png', '-'], { maxBuffer: 1 << 27 });
    const img = await loadImage(buf);
    const c = createCanvas(W, H);
    const x = c.getContext('2d');
    x.filter = 'blur(2px)'; // suppress film grain before thresholding
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, W, H).data;
    const pale = t > 15.6; // pale desaturated fist on a grey wall
    const m = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const r = d[i * 4];
      const g = d[i * 4 + 1];
      const b = d[i * 4 + 2];
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const warm = mx > 70 && mx - mn > 45;
      const cream = mx > 170 && r >= b && mx - mn > 18; // pale lit skin (text is greyer)
      m[i] = pale ? ((r + g + b) / 3 > 130 ? 1 : 0) : warm || cream ? 1 : 0;
    }
    largestComponent(m);
    // fill interior holes: anything the outside background can't reach is inside the hand
    const out = new Uint8Array(W * H);
    const st = [];
    for (let xx = 0; xx < W; xx++) { st.push(xx, (H - 1) * W + xx); }
    for (let yy = 0; yy < H; yy++) { st.push(yy * W, yy * W + W - 1); }
    while (st.length) {
      const k = st.pop();
      if (out[k] || m[k]) continue;
      out[k] = 1;
      const kx = k % W;
      const ky = (k / W) | 0;
      if (kx > 0) st.push(k - 1);
      if (kx < W - 1) st.push(k + 1);
      if (ky > 0) st.push(k - W);
      if (ky < H - 1) st.push(k + W);
    }
    let area = 0;
    for (let i = 0; i < W * H; i++) {
      if (!out[i]) m[i] = 1;
      area += m[i];
    }
    if (area < 20000) {
      // too little of the hand is visible (heavy blur): leave no mask, renderer falls back
      process.stdout.write(` [skip f${f} area ${area}]`);
      continue;
    }
    // smooth edges: blur the binary mask and re-threshold softly
    const mc = createCanvas(W, H);
    const mx2 = mc.getContext('2d');
    const mi = mx2.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      mi.data[i * 4] = mi.data[i * 4 + 1] = mi.data[i * 4 + 2] = 255;
      mi.data[i * 4 + 3] = m[i] ? 255 : 0;
    }
    mx2.putImageData(mi, 0, 0);
    const sm = createCanvas(W, H);
    const sx = sm.getContext('2d');
    sx.filter = 'blur(2.5px)';
    sx.drawImage(mc, 0, 0);
    fs.writeFileSync(path.join(outDir, `f_${String(f).padStart(4, '0')}.png`), sm.toBuffer('image/png'));
    process.stdout.write(`\r${f - f0 + 1}/${f1 - f0 + 1}`);
  }
  console.log(`\nmasks -> ${outDir}`);
})();
