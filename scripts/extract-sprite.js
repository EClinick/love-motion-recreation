#!/usr/bin/env node
// Measure a pixel-art icon in a source frame: find its pixel pitch and phase, sample each
// cell, quantise to a small palette and print the grid (for redrawing sprites at the
// source's native resolution). Writes a side-by-side preview PNG.
//   node scripts/extract-sprite.js <frame.png> x y w h [k=10] [pitch] [out=out/sprite.png]
// x y w h are in 1440x1080 coordinates; the frame may be any size (it is scaled).
const fs = require('fs');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const [file, X, Y, Wd, Ht, Karg, Parg, outArg] = process.argv.slice(2);
const K = Number(Karg || 10);
const out = outArg || 'out/sprite.png';

(async () => {
  const img = await loadImage(fs.readFileSync(file));
  const f = img.width / 1440;
  const x0 = Math.round(Number(X) * f);
  const y0 = Math.round(Number(Y) * f);
  const w = Math.round(Number(Wd) * f);
  const h = Math.round(Number(Ht) * f);
  const c = createCanvas(w, h);
  const cx = c.getContext('2d');
  cx.drawImage(img, x0, y0, w, h, 0, 0, w, h);
  const d = cx.getImageData(0, 0, w, h).data;
  const at = (i, j) => [d[(j * w + i) * 4], d[(j * w + i) * 4 + 1], d[(j * w + i) * 4 + 2]];

  // edge energy per column / row
  const ex = new Float64Array(w);
  const ey = new Float64Array(h);
  for (let j = 1; j < h; j++)
    for (let i = 1; i < w; i++) {
      const a = at(i, j);
      const l = at(i - 1, j);
      const u = at(i, j - 1);
      ex[i] += Math.abs(a[0] - l[0]) + Math.abs(a[1] - l[1]) + Math.abs(a[2] - l[2]);
      ey[j] += Math.abs(a[0] - u[0]) + Math.abs(a[1] - u[1]) + Math.abs(a[2] - u[2]);
    }
  // pitch: comb score over fractional pitches, best phase for each
  const comb = (sig, p) => {
    let best = -1;
    let bo = 0;
    for (let o = 0; o < p; o += 0.25) {
      let s = 0;
      let n = 0;
      for (let k = o; k < sig.length; k += p) {
        const i = Math.round(k);
        if (i > 0 && i < sig.length) {
          s += Math.max(sig[i], sig[i - 1] || 0, sig[i + 1] || 0);
          n++;
        }
      }
      const v = s / Math.max(1, n);
      if (v > best) {
        best = v;
        bo = o;
      }
    }
    return [best, bo];
  };
  let pitch = Number(String(Parg).replace('~', '')) * f; // given in 1440 coords
  const refine = String(Parg).endsWith('~');
  if (!pitch || refine) {
    // with the right pitch and phase each cell's interior is one flat colour; half the pitch
    // is just as flat, twice the pitch is not. Take the largest pitch whose interiors are
    // within 25% of the flattest.
    const flat = (p) => {
      let best = 1e18;
      for (let oy0 = 0; oy0 < p; oy0 += p / 6)
        for (let ox0 = 0; ox0 < p; ox0 += p / 6) {
          let v = 0;
          let n = 0;
          for (let cy = oy0; cy + p <= h; cy += p)
            for (let cx2 = ox0; cx2 + p <= w; cx2 += p) {
              const m = [0, 0, 0];
              const q = [];
              for (let j = Math.round(cy + p * 0.25); j < cy + p * 0.75; j += 2)
                for (let i = Math.round(cx2 + p * 0.25); i < cx2 + p * 0.75; i += 2) q.push(at(i, j));
              q.forEach((c2) => { m[0] += c2[0]; m[1] += c2[1]; m[2] += c2[2]; });
              m.forEach((_, k) => (m[k] /= q.length));
              q.forEach((c2) => { v += (c2[0] - m[0]) ** 2 + (c2[1] - m[1]) ** 2 + (c2[2] - m[2]) ** 2; n++; });
            }
          best = Math.min(best, v / Math.max(1, n));
        }
      return best;
    };
    const sc = [];
    if (refine) for (let p = pitch * 0.88; p <= pitch * 1.12; p += 0.05 * f) sc.push([p, flat(p)]);
    else for (let p = 6 * f; p <= 30 * f; p += 0.25 * f) sc.push([p, flat(p)]);
    const lo = Math.min(...sc.map((v) => v[1]));
    pitch = refine ? sc.find((v) => v[1] === lo)[0] : sc.filter((v) => v[1] <= lo * 1.25).pop()[0];
  }
  // phase: the offset whose cell interiors are flattest
  let ox = 0;
  let oy = 0;
  {
    let best = 1e18;
    for (let oy0 = 0; oy0 < pitch; oy0 += pitch / 10)
      for (let ox0 = 0; ox0 < pitch; ox0 += pitch / 10) {
        let v = 0;
        let n = 0;
        for (let cy = oy0; cy + pitch <= h; cy += pitch)
          for (let cx2 = ox0; cx2 + pitch <= w; cx2 += pitch) {
            const q = [];
            for (let j = Math.round(cy + pitch * 0.2); j < cy + pitch * 0.8; j += 2)
              for (let i = Math.round(cx2 + pitch * 0.2); i < cx2 + pitch * 0.8; i += 2) q.push(at(i, j));
            const m = [0, 1, 2].map((k) => q.reduce((a2, c2) => a2 + c2[k], 0) / q.length);
            q.forEach((c2) => { v += (c2[0] - m[0]) ** 2 + (c2[1] - m[1]) ** 2 + (c2[2] - m[2]) ** 2; n++; });
          }
        if (v / n < best) { best = v / n; ox = ox0; oy = oy0; }
      }
  }
  const cols = Math.floor((w - ox) / pitch);
  const rows = Math.floor((h - oy) / pitch);

  // background = median of the crop border
  const border = [];
  for (let i = 0; i < w; i += 3) border.push(at(i, 0), at(i, h - 1));
  for (let j = 0; j < h; j += 3) border.push(at(0, j), at(w - 1, j));
  const med = [0, 1, 2].map((k) => border.map((p) => p[k]).sort((a, b) => a - b)[border.length >> 1]);

  const cells = [];
  for (let r = 0; r < rows; r++)
    for (let q = 0; q < cols; q++) {
      const cx0 = ox + q * pitch;
      const cy0 = oy + r * pitch;
      const s = [0, 0, 0];
      let n = 0;
      for (let j = Math.round(cy0 + pitch * 0.3); j < cy0 + pitch * 0.7; j++)
        for (let i = Math.round(cx0 + pitch * 0.3); i < cx0 + pitch * 0.7; i++) {
          const p = at(i, j);
          s[0] += p[0];
          s[1] += p[1];
          s[2] += p[2];
          n++;
        }
      const col = s.map((v) => v / n);
      const bgd = Math.hypot(col[0] - med[0], col[1] - med[1], col[2] - med[2]);
      cells.push({ r, q, col, bg: bgd < 11 });
    }
  // k-means on the non-background cells
  const fg = cells.filter((e) => !e.bg);
  let cent = [];
  for (let k = 0; k < K && k < fg.length; k++) cent.push(fg[Math.floor((k * fg.length) / K)].col.slice());
  for (let it = 0; it < 30; it++) {
    const acc = cent.map(() => [0, 0, 0, 0]);
    fg.forEach((e) => {
      let bi = 0;
      let bd = 1e9;
      cent.forEach((m, i) => {
        const dd = (e.col[0] - m[0]) ** 2 + (e.col[1] - m[1]) ** 2 + (e.col[2] - m[2]) ** 2;
        if (dd < bd) {
          bd = dd;
          bi = i;
        }
      });
      e.k = bi;
      acc[bi][0] += e.col[0];
      acc[bi][1] += e.col[1];
      acc[bi][2] += e.col[2];
      acc[bi][3]++;
    });
    cent = cent.map((m, i) => (acc[i][3] ? [acc[i][0] / acc[i][3], acc[i][1] / acc[i][3], acc[i][2] / acc[i][3]] : m));
  }
  const hex = (v) => '#' + v.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  console.log(`pitch ${(pitch / f).toFixed(2)} px (1440 coords), phase ${(ox / f).toFixed(1)},${(oy / f).toFixed(1)}, grid ${cols}x${rows}`);
  console.log('palette ' + JSON.stringify(Object.fromEntries(cent.map((m, i) => [chars[i], hex(m)]))));
  for (let r = 0; r < rows; r++) console.log(cells.filter((e) => e.r === r).map((e) => (e.bg ? '.' : chars[e.k])).join(''));

  // preview: crop | reconstruction
  const pv = createCanvas(w * 2 + 10, h);
  const px = pv.getContext('2d');
  px.fillStyle = hex(med);
  px.fillRect(0, 0, pv.width, h);
  px.drawImage(c, 0, 0);
  cells.forEach((e) => {
    if (e.bg) return;
    px.fillStyle = hex(cent[e.k]);
    px.fillRect(w + 10 + ox + e.q * pitch, oy + e.r * pitch, Math.ceil(pitch), Math.ceil(pitch));
  });
  fs.writeFileSync(out, pv.toBuffer('image/png'));
})();
