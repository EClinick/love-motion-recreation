#!/usr/bin/env node
// Quantitative silhouette comparison of a thermal figure (head or hand) between the
// reference video and our render at the same timestamp.
//   node scripts/shape-compare.js <t> [video=out/preview.mp4] [out=out/shape]
// Prints IoU, bounding boxes, width profile per band and landmarks; writes an overlay PNG
// (reference outline cyan, ours red, overlap white-ish).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const ROOT = path.join(__dirname, '..');
const t = Number(process.argv[2] ?? 5.0);
const video = process.argv[3] ?? 'out/preview.mp4';
const outDir = path.join(ROOT, process.argv[4] ?? 'out/shape');
fs.mkdirSync(outDir, { recursive: true });
const W = 1440;
const H = 1080;

function grab(src, name) {
  const p = path.join(outDir, name);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', path.join(ROOT, src), '-frames:v', '1', '-vf', `scale=${W}:${H}`, p]);
  return p;
}

// warm, bright pixels = the thermal figure (excludes cream text, grey bg, white specks)
function mask(img) {
  const c = createCanvas(W, H);
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0, W, H);
  // light blur so film grain doesn't fragment the mask
  const b = createCanvas(W, H);
  const bx = b.getContext('2d');
  bx.filter = 'blur(2px)';
  bx.drawImage(c, 0, 0);
  const d = bx.getImageData(0, 0, W, H).data;
  const m = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = d[i * 4];
    const g = d[i * 4 + 1];
    const bl = d[i * 4 + 2];
    m[i] = r > 110 && r - bl > 55 && r >= g ? 1 : 0;
  }
  // keep the largest connected component only
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
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = kx + dx;
        const ny = ky + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (m[j] && !lab[j]) {
          lab[j] = next;
          stack.push(j);
        }
      }
    }
    if (n > best) {
      best = n;
      bestLab = next;
    }
    next++;
  }
  for (let i = 0; i < W * H; i++) m[i] = lab[i] === bestLab ? 1 : 0;
  return m;
}

function stats(m) {
  let x0 = W, x1 = 0, y0 = H, y1 = 0, area = 0;
  const rows = [];
  for (let y = 0; y < H; y++) {
    let l = -1, r = -1, n = 0;
    for (let x = 0; x < W; x++) {
      if (!m[y * W + x]) continue;
      if (l < 0) l = x;
      r = x;
      n++;
    }
    rows.push(l < 0 ? null : { l, r, n });
    if (l >= 0) {
      area += n;
      x0 = Math.min(x0, l);
      x1 = Math.max(x1, r);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  return { bbox: [x0, y0, x1, y1], area, rows };
}

(async () => {
  const refImg = await loadImage(grab('ref/reference.mp4', `ref_${t}.png`));
  const ourImg = await loadImage(grab(video, `ours_${t}.png`));
  const A = mask(refImg);
  const B = mask(ourImg);
  let inter = 0, uni = 0;
  for (let i = 0; i < W * H; i++) {
    inter += A[i] & B[i];
    uni += A[i] | B[i];
  }
  const sa = stats(A);
  const sb = stats(B);
  const out = { t, iou: +(inter / uni).toFixed(3), ref: { bbox: sa.bbox, area: sa.area }, ours: { bbox: sb.bbox, area: sb.area }, bands: [] };
  // width profile in 40px bands across the union's vertical extent
  const top = Math.min(sa.bbox[1], sb.bbox[1]);
  for (let y = top; y < H; y += 40) {
    const ra = sa.rows[y];
    const rb = sb.rows[y];
    out.bands.push({ y, ref: ra ? [ra.l, ra.r, ra.r - ra.l] : null, ours: rb ? [rb.l, rb.r, rb.r - rb.l] : null });
  }
  // overlay of outlines
  const c = createCanvas(W, H);
  const x = c.getContext('2d');
  const img = x.createImageData(W, H);
  const edge = (m, i) => m[i] && (!m[i - 1] || !m[i + 1] || !m[i - W] || !m[i + W]);
  for (let i = W; i < W * (H - 1); i++) {
    const p = i * 4;
    img.data[p + 3] = 255;
    if (A[i] && B[i]) img.data[p] = img.data[p + 1] = img.data[p + 2] = 60;
    else if (A[i]) img.data[p + 2] = img.data[p + 1] = 70;
    else if (B[i]) img.data[p] = 90;
    if (edge(A, i)) { img.data[p] = 0; img.data[p + 1] = 255; img.data[p + 2] = 255; }
    if (edge(B, i)) { img.data[p] = 255; img.data[p + 1] = 40; img.data[p + 2] = 40; }
  }
  x.putImageData(img, 0, 0);
  const ov = path.join(outDir, `overlay_${t}.png`);
  fs.writeFileSync(ov, c.toBuffer('image/png'));
  out.overlay = ov;
  console.log(JSON.stringify(out));
})();
