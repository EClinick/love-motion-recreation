#!/usr/bin/env node
// Rotoscope a figure silhouette (hand or head) from the user's source video, one mask
// per frame. Masks are derived media: written to ref/derived/<name>/ (gitignored).
//   node scripts/trace-hand.js [hand|head] [t0] [t1]
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const ROOT = path.join(__dirname, '..');
const FPS = 24000 / 1001;
const W = 1440;
const H = 1080;
const NAME = process.argv[2] ?? 'hand';
const DEF = { hand: [13.76, 15.89], head: [3.82, 6.3] }[NAME];
const t0 = Number(process.argv[3] ?? DEF[0]);
const t1 = Number(process.argv[4] ?? DEF[1]);
const fLast = NAME === 'hand' ? 380 : Infinity; // frame 381 is already the white heart shot
const outDir = path.join(ROOT, 'ref', 'derived', NAME);
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

let lastHot = null; // the shirt fades to grey late in the head shot: carry its last clear shape
(async () => {
  const f0 = Math.round(t0 * FPS);
  const f1 = Math.round(t1 * FPS);
  for (let f = f0; f <= Math.min(f1, fLast); f++) {
    const t = f / FPS;
    const buf = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t - 0.02), '-i', path.join(ROOT, 'ref', 'reference.mp4'), '-frames:v', '1', '-vf', `scale=${W}:${H}`, '-f', 'image2pipe', '-vcodec', 'png', '-'], { maxBuffer: 1 << 27 });
    const img = await loadImage(buf);
    const c = createCanvas(W, H);
    const x = c.getContext('2d');
    x.filter = 'blur(2px)'; // suppress film grain before thresholding
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, W, H).data;
    const pale = NAME === 'hand' && t > 15.6; // pale desaturated fist on a grey wall
    const darkOnLight = NAME === 'head' && t > 6.04; // backlit dark silhouette on a pale wall
    if (NAME === 'head' && t > 5.86 && t <= 6.04) {
      process.stdout.write(` [skip f${f} tan/grey transition]`);
      continue;
    }
    const m = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const r = d[i * 4];
      const g = d[i * 4 + 1];
      const b = d[i * 4 + 2];
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      // the head has a dim red glow in front of the face: only count properly lit pixels
      const warm = NAME === 'head' ? mx > 140 && mx - mn > 60 : mx > 70 && mx - mn > 45;
      const cream = mx > 170 && r >= b && mx - mn > 18; // pale lit skin (text is greyer)
      const white = NAME === 'head' && (r + g + b) / 3 > 150; // blown-out shirt / shoulder
      // hand: the white-lit thumb (14.1-14.35 s); skip the typing-cursor block to its right
      const px = i % W;
      const py = (i / W) | 0;
      // dark violet fingers in the crimson intro (too dark for the warm rule)
      const violet = NAME === 'hand' && t < 14.0 && b > 35 && b > r + 8 && b > g + 14;
      const whiteHand = NAME === 'hand' && !pale && (r + g + b) / 3 > 190 && !(px > 860 && px < 1220 && py > 500 && py < 590);
      m[i] = darkOnLight ? ((r + g + b) / 3 < 120 && i % W > 560 ? 1 : 0) : pale ? (warm || ((r + g + b) / 3 > 105 && !(px > 880 && py > 505 && py < 590 && mx - mn < 40)) ? 1 : 0) : warm || cream || white || whiteHand || violet ? 1 : 0;
    }
    largestComponent(m);
    // fill interior holes: anything the outside background can't reach is inside the hand
    const out = new Uint8Array(W * H);
    const st = [];
    // the head's body runs off the bottom edge, so only the hand seeds from the bottom row
    for (let xx = 0; xx < W; xx++) { st.push(xx); if (NAME !== 'head') st.push((H - 1) * W + xx); }
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
    // fill only SMALL interior holes (specular highlights); keep real gaps between digits
    const holeLab = new Int32Array(W * H);
    let hl = 1;
    const hs = [];
    for (let i = 0; i < W * H; i++) {
      if (out[i] || m[i] || holeLab[i]) continue;
      const pix = [];
      holeLab[i] = hl;
      hs.push(i);
      while (hs.length) {
        const k = hs.pop();
        pix.push(k);
        const kx = k % W;
        for (const j of [k - 1, k + 1, k - W, k + W]) {
          if (j < 0 || j >= W * H) continue;
          if ((j === k - 1 && kx === 0) || (j === k + 1 && kx === W - 1)) continue;
          if (!out[j] && !m[j] && !holeLab[j]) { holeLab[j] = hl; hs.push(j); }
        }
      }
      if (pix.length < 2500) pix.forEach((k) => (m[k] = 1));
      hl++;
    }
    let area = 0;
    let bx0 = W, bx1 = 0, by0 = H, by1 = 0;
    for (let i = 0; i < W * H; i++) {
      area += m[i];
      if (m[i]) {
        const xx = i % W;
        const yy = (i / W) | 0;
        bx0 = Math.min(bx0, xx); bx1 = Math.max(bx1, xx); by0 = Math.min(by0, yy); by1 = Math.max(by1, yy);
      }
    }
    if (NAME === 'head' && (bx1 - bx0 > 760 || by1 - by0 < 500 || by0 > 400)) {
      process.stdout.write(` [skip f${f} implausible head bbox]`);
      continue;
    }
    if (area < (NAME === 'hand' && t > 15.5 ? 6000 : 20000)) {
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
    sx.filter = NAME === 'head' ? 'blur(1.2px)' : 'blur(2.5px)'; // keep the head's curls crisp
    sx.drawImage(mc, 0, 0);
    fs.writeFileSync(path.join(outDir, `f_${String(f).padStart(4, '0')}.png`), sm.toBuffer('image/png'));
    if (NAME === 'head') {
      // white-hot region (the shirt / shoulder blows out to near white in the thermal look)
      const hi = mx2.createImageData(W, H);
      const cur = new Uint8Array(W * H);
      let n = 0;
      let nLast = 0;
      for (let i = 0; i < W * H; i++) {
        const r = d[i * 4];
        const g = d[i * 4 + 1];
        const b = d[i * 4 + 2];
        cur[i] = !darkOnLight && m[i] && (r + g + b) / 3 > 200 && Math.max(r, g, b) - Math.min(r, g, b) < 80 ? 1 : 0;
        n += cur[i];
        if (lastHot) nLast += lastHot[i];
      }
      const use = lastHot && n < 0.6 * nLast ? lastHot : cur;
      if (use === cur && n > 5000) lastHot = cur;
      for (let i = 0; i < W * H; i++) {
        hi.data[i * 4] = hi.data[i * 4 + 1] = hi.data[i * 4 + 2] = 255;
        hi.data[i * 4 + 3] = use[i] ? 255 : 0;
      }
      mx2.putImageData(hi, 0, 0);
      sx.clearRect(0, 0, W, H);
      sx.filter = 'blur(4px)';
      sx.drawImage(mc, 0, 0);
      fs.writeFileSync(path.join(outDir, `hot_${String(f).padStart(4, '0')}.png`), sm.toBuffer('image/png'));
    }
    if (NAME === 'hand') {
      // tone map: the hand's thermal index (g/r, plus b/r for the crimson/violet intro) averaged
      // over the silhouette with a small blur, so it carries colour regions rather than grain.
      // The renderer maps it through a palette measured from the source.
      const tc = createCanvas(W, H);
      const tx = tc.getContext('2d');
      const ti = tx.createImageData(W, H);
      for (let i = 0; i < W * H; i++) {
        if (!m[i]) continue;
        const r = Math.max(30, d[i * 4]);
        ti.data[i * 4] = Math.round(Math.min(1, d[i * 4 + 1] / r) * 255);
        ti.data[i * 4 + 1] = Math.round(Math.min(1, d[i * 4 + 2] / r / 2) * 255);
        ti.data[i * 4 + 3] = 255;
      }
      tx.putImageData(ti, 0, 0);
      const tb = createCanvas(W, H);
      const tbx = tb.getContext('2d');
      tbx.filter = 'blur(4px)';
      tbx.drawImage(tc, 0, 0);
      const bd = tbx.getImageData(0, 0, W, H);
      for (let i = 0; i < W * H; i++) bd.data[i * 4 + 3] = m[i] ? 255 : 0;
      tbx.putImageData(bd, 0, 0);
      fs.writeFileSync(path.join(outDir, `tone_${String(f).padStart(4, '0')}.png`), tb.toBuffer('image/png'));
    }
    if (NAME === 'hand' && !pale) {
      // white-hot highlights on the hand (the lit thumb / finger early in the shot)
      const hi = mx2.createImageData(W, H);
      let n = 0;
      for (let i = 0; i < W * H; i++) {
        const r = d[i * 4];
        const g = d[i * 4 + 1];
        const b = d[i * 4 + 2];
        const hot = m[i] && (r + g + b) / 3 > 200 && Math.max(r, g, b) - Math.min(r, g, b) < 70;
        n += hot ? 1 : 0;
        hi.data[i * 4] = hi.data[i * 4 + 1] = hi.data[i * 4 + 2] = 255;
        hi.data[i * 4 + 3] = hot ? 255 : 0;
      }
      if (n > 400) {
        mx2.putImageData(hi, 0, 0);
        sx.clearRect(0, 0, W, H);
        sx.filter = 'blur(3px)';
        sx.drawImage(mc, 0, 0);
        fs.writeFileSync(path.join(outDir, `hot_${String(f).padStart(4, '0')}.png`), sm.toBuffer('image/png'));
      }
    }
    process.stdout.write(`\r${f - f0 + 1}/${f1 - f0 + 1}`);
  }
  console.log(`\nmasks -> ${outDir}`);
})();
