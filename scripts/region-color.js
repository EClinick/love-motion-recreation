#!/usr/bin/env node
// Mean colour of the bright figure pixels in a region, reference vs render, at times t.
//   node scripts/region-color.js x0 y0 x1 y1 t1,t2,... [video]
const { execFileSync } = require('child_process');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const ROOT = path.join(__dirname, '..');
const [x0, y0, x1, y1] = process.argv.slice(2, 6).map(Number);
const times = process.argv[6].split(',').map(Number);
const video = process.argv[7] ?? 'out/preview.mp4';
async function mean(src, t) {
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', path.join(ROOT, src), '-frames:v', '1', '-vf', 'scale=1440:1080', '-f', 'image2pipe', '-vcodec', 'png', '-'], { maxBuffer: 1 << 26 });
  const img = await loadImage(buf);
  const c = createCanvas(1440, 1080);
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  const d = x.getImageData(x0, y0, x1 - x0, y1 - y0).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] + d[i + 1] + d[i + 2] < 120) continue; // skip dark background
    r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
  }
  const hx = (v) => Math.round(v / Math.max(n, 1)).toString(16).padStart(2, '0');
  return `#${hx(r)}${hx(g)}${hx(b)} (${n}px)`;
}
(async () => {
  for (const t of times) console.log(t, 'ref', await mean('ref/reference.mp4', t), ' ours', await mean(video, t));
})();
