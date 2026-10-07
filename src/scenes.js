// Scene timeline. Every function is pure in `t` (seconds) so frames render in any order.
const { createCanvas } = require('@napi-rs/canvas');
const C = require('./lib/core');
const { W, H, kf, inv, lerp, clamp, ease, rng, noise1, shake, mixHex, state } = C;
const fx = require('./lib/fx');
const { drawSprite } = require('./lib/sprites');
const { thermal, thermalHand, blendPose } = require('./lib/figures');

const INK = '#3a1f1a'; // warm brown-black used for type on paper
const CREAM = '#f3efe8';
const BODY = 49; // body copy size (weight 900, matched to reference widths)
const CARD = 87; // "action." / "intention." / "curiosity."
const D = Math.PI / 180;

// Output scale (1 = 1440x1080, 2 = 2880x2160). Offscreen layers match it so nothing softens.
let S = 1;
function setScale(s) {
  S = s;
  state.S = s;
  scratch.length = 0;
}

// Offscreen helper: draw into a scratch canvas then composite (for blur / mosaic).
const scratch = [];
function off(i = 0) {
  if (!scratch[i]) scratch[i] = createCanvas(W * S, H * S);
  const c = scratch[i];
  const x = c.getContext('2d');
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';
  x.filter = 'none';
  x.clearRect(0, 0, W * S, H * S);
  x.setTransform(S, 0, 0, S, 0, 0);
  return [c, x];
}

function composite(ctx, c, opts = {}) {
  ctx.save();
  if (opts.blur && opts.blur > 0.3) ctx.filter = `blur(${opts.blur * S}px)`;
  if (opts.filter) ctx.filter = opts.filter;
  ctx.globalAlpha = opts.alpha ?? 1;
  if (opts.op) ctx.globalCompositeOperation = opts.op;
  ctx.drawImage(c, 0, 0, W, H);
  ctx.restore();
}

function camera(ctx, { x = 0, y = 0, z = 1, r = 0, cx = W / 2, cy = H / 2 } = {}) {
  ctx.translate(cx + x, cy + y);
  ctx.rotate(r);
  ctx.scale(z, z);
  ctx.translate(-cx, -cy);
}

// Mosaic (pixelate) a canvas: used in the blob transitions.
function mosaic(ctx, src, block, opts = {}) {
  const sw = Math.max(1, Math.round(W / block));
  const sh = Math.max(1, Math.round(H / block));
  const s = createCanvas(sw, sh);
  const sx = s.getContext('2d');
  sx.drawImage(src, 0, 0, sw, sh);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (opts.blur) ctx.filter = `blur(${opts.blur * S}px)`;
  ctx.globalAlpha = opts.alpha ?? 1;
  ctx.drawImage(s, 0, 0, W, H);
  ctx.restore();
}

function dashLine(ctx, x0, x1, y, color, lw = 3, dash = [26, 20]) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  ctx.restore();
}

const blinkOn = (t, period = 0.5) => Math.floor(t / period) % 2 === 0;

function dot(ctx, x, y, r, color = '#1a1716') {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 7);
  ctx.fill();
}

function bgRamp(t, keys) {
  let bg = keys[0][1];
  for (let i = 1; i < keys.length; i++) if (t >= keys[i - 1][0]) bg = mixHex(keys[i - 1][1], keys[i][1], inv(keys[i - 1][0], keys[i][0], t));
  return bg;
}

// flat light paper with a soft darker corner (reference look: no centre hotspot)
function flat(ctx, base = '#dfdedc', corner = 'rgba(70,66,66,0.28)', cx = 0, cy = 0) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.9);
  g.addColorStop(0, corner);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

// =====================================================================
// 1. Kinetic opener: "how do you" huge, panning, then whip-zoom out.
// =====================================================================
const BIG = 340;
const SENT = ['how', 'do', 'you', 'communicate', 'that', 'you’re', 'going', 'through', 'a', 'change?'];
const TYPE_T = [0, 0, 0, 0, 0.8, 1.25, 1.52, 1.69, 1.86, 1.96];

// Text drawn as chunky pixels (a low-res render, thresholded and scaled up with hard edges).
function pixelText(ctx, str, x, base, size, block, color, opts = {}) {
  const fs = size / block;
  const tmp = createCanvas(8, 8);
  const w = Math.ceil(fx.measure(tmp.getContext('2d'), str, fs, 900, opts.tracking ?? 0.02)) + 4;
  const h = Math.ceil(fs * 1.4);
  const c = createCanvas(w, h);
  const cx = c.getContext('2d');
  fx.text(cx, str, 2, Math.round(fs * 1.05), fs, '#000', { baseline: 'alphabetic', tracking: opts.tracking ?? 0.02 });
  const d = cx.getImageData(0, 0, w, h).data;
  ctx.save();
  ctx.fillStyle = color;
  const y0 = base - fs * 1.05 * block;
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) if (d[(j * w + i) * 4 + 3] > (opts.thr ?? 120)) ctx.fillRect(x + (i - 2) * block, y0 + j * block, block + 0.5, block + 0.5);
  ctx.restore();
}

// Catmull-Rom smoothing of a hand-placed polyline
function smoothPts(P, k = 8) {
  const out = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)];
    const p1 = P[i];
    const p2 = P[i + 1];
    const p3 = P[Math.min(P.length - 1, i + 2)];
    for (let j = 0; j < k; j++) {
      const u = j / k;
      const u2 = u * u;
      const u3 = u2 * u;
      out.push([0, 1].map((d) => 0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * u + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * u2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * u3)));
    }
  }
  out.push(P[P.length - 1]);
  return out;
}
// one hand-drawn pen line
function penPath(ctx, pts, lw, color) {
  fx.strokePartial(ctx, smoothPts(pts), 0, 1, lw, color);
}

function sceneOpen(ctx, t, f) {
  if (t < 0.02) {
    // frame 0: red card, a faint dark-red "how" behind a towering, squashed black "how"
    ctx.fillStyle = '#c40f18';
    ctx.fillRect(0, 0, W, H);
    fx.text(ctx, 'how', 560, 660, 300, 'rgba(110,8,16,0.75)', { baseline: 'alphabetic' });
    ctx.save();
    ctx.translate(432, 1150);
    ctx.scale(0.97, 5);
    fx.text(ctx, 'how', 0, 0, 340, '#121010', { baseline: 'alphabetic' });
    ctx.restore();
    dashLine(ctx, 0, W, 1070, '#3a1a12', 3, [26, 20]);
    return;
  }
  if (t < 0.083) {
    ctx.fillStyle = '#ddb019';
    ctx.fillRect(0, 0, W, H);
    dashLine(ctx, 0, W, 104, '#2a1a08', 6, [34, 22]);
    dashLine(ctx, 0, W, 955, '#2a1a08', 6, [34, 22]);
    fx.text(ctx, 'how', 745, 520, 340, '#3a2914', { align: 'center' });
    return;
  }
  // grey gradient paper, darker toward the right
  ctx.fillStyle = '#e2e1df';
  ctx.fillRect(0, 0, W, H);
  const gg = ctx.createLinearGradient(0, 0, W, 0);
  gg.addColorStop(0, 'rgba(255,255,255,0.1)');
  gg.addColorStop(0.5, 'rgba(160,158,156,0)');
  gg.addColorStop(1, `rgba(120,118,118,${lerp(0.55, 0.2, inv(0.1, 0.3, t))})`);
  ctx.fillStyle = gg;
  ctx.fillRect(0, 0, W, H);

  if (t >= 0.48) {
    // the line collapses: chunky pixel type, tiny blurred pixel type, then dashes
    if (t < 0.521) {
      pixelText(ctx, 'do.you.communicate', 0, 622, 272, 15, '#141010', { thr: 90 });
    } else if (t < 0.563) {
      const [c, x] = off(0);
      pixelText(x, 'how.do.you.communicate', 220, 556, 64, 8, '#1e1a1a', { thr: 60 });
      x.fillStyle = '#141010';
      x.fillRect(640, 536, 160, 12);
      composite(ctx, c, { blur: 6 });
    } else {
      const k = t < 0.605 ? 0 : t < 0.646 ? 1 : 2;
      const [c, x] = off(0);
      const r = rng(23 + k);
      x.fillStyle = 'rgba(30,24,22,0.92)';
      const xs = [[140, 780, 536, 12], [180, 742, 531, 7], [112, 720, 540, 6]][k];
      let px = xs[0];
      while (px < xs[1]) {
        const w = 10 + Math.floor(r() * 4) * 12;
        if (r() > 0.3) x.fillRect(px, xs[2] - xs[3] / 2, w, xs[3]);
        px += w + 12;
      }
      const hx = [1104, 900, 801][k];
      for (let yy = 444; yy <= 620; yy += 44) x.fillRect(hx - (k ? 3 : 7), yy, k ? 6 : 14, k ? 22 : 14);
      composite(ctx, c, { blur: [1, 1.5, 3][k] });
    }
    return;
  }

  // pan along "how do you" (measured from the source, frame by frame)
  const hx = kf(t, [
    [0.083, 427],
    [0.167, 415, 'linear'],
    [0.209, 382, 'linear'],
    [0.25, -140, 'outCubic'],
    [0.334, -200, 'linear'],
    [0.375, -518, 'inQuad'],
    [0.417, -720, 'outQuad'],
    [0.47, -735, 'linear'],
  ]);
  const BASE = 616;
  const [c, x] = off(0);
  x.save();
  x.translate(hx, BASE);
  dashLine(x, -4000, 12000, -174, '#6a2a14', 3, [26, 20]);
  dashLine(x, -4000, 12000, 0, '#6a2a14', 3, [26, 20]);
  let cx = 0;
  const sp = fx.measure(x, ' ', BIG);
  const wx = [];
  SENT.slice(0, 3).forEach((w, i) => {
    wx.push(cx);
    const a = i === 1 ? (t >= 0.15 ? 1 : 0) : i === 2 ? (t >= 0.32 ? 1 : 0) : 1;
    const col = i === 1 ? mixHex('#4a4744', '#141210', inv(0.19, 0.23, t)) : i === 2 ? mixHex('#4a4744', '#141210', inv(0.34, 0.37, t)) : '#141210';
    if (a > 0) fx.text(x, w, cx, 0, BIG, col, { baseline: 'alphabetic' });
    cx += fx.measure(x, w, BIG) + sp;
  });
  x.restore();
  const PENC = '#2a170c';
  // thick tapered pen swoosh under "how"
  if (t >= 0.19 && t < 0.23) {
    x.fillStyle = PENC;
    x.beginPath();
    x.moveTo(0, 662);
    x.lineTo(675, 640);
    x.lineTo(0, 684);
    x.closePath();
    x.fill();
  }
  // hand-drawn box round "do", then a black block over the next word
  if (t >= 0.23 && t < 0.27) {
    penPath(x, [[630, 380], [800, 368], [1040, 356], [1046, 450], [1052, 596], [1060, 604], [900, 618], [600, 640], [270, 662]], 7, PENC);
  }
  if (t >= 0.27 && t < 0.313) {
    penPath(x, [[470, 372], [452, 520], [460, 735], [700, 712], [1000, 696], [1440, 690]], 4, PENC);
    x.fillStyle = '#0d0c0c';
    x.fillRect(472, 373, 968, 248);
  }
  if (t >= 0.313 && t < 0.355) {
    penPath(x, [[690, 680], [900, 664], [1150, 652], [1440, 640]], 4, PENC);
    penPath(x, [[1352, 205], [1345, 240], [1336, 300], [1328, 380], [1326, 430], [1340, 436]], 3, PENC);
    x.fillStyle = '#0d0c0c';
    x.fillRect(880, 370, 476, 260);
  }
  // typing cursor after "you"
  if (t >= 0.355 && t < 0.396) {
    x.fillStyle = '#2a2624';
    x.fillRect(1244, 380, 5, 250);
  }
  composite(ctx, c, { blur: t > 0.25 && t < 0.4 ? 1.2 : 0 });
}

// =====================================================================
// 2. Typing line with handwritten scribbles.
// =====================================================================
function sentenceParts(t, darkCol = INK, fresh = '#9a8f8a') {
  const parts = [];
  SENT.forEach((w, i) => {
    if (t < TYPE_T[i]) return;
    parts.push({ t: w, c: i < 4 ? darkCol : mixHex(fresh, darkCol, clamp((t - TYPE_T[i]) / 0.14)) });
  });
  return parts;
}

const PEN = '#4a2020';

// An original hand-drawn style signature, smoothed with Catmull-Rom.
const SIG_KEYS = [
  [0, 0], [-12, -30], [5, -62], [35, -58], [30, -40], [10, -20], [25, 0], [55, 5], [75, -25], [70, -40], [60, -25],
  [75, 0], [95, -2], [110, -30], [105, -42], [95, -28], [110, 0], [135, -5], [150, -35], [160, -20], [165, 0],
  [185, -15], [195, -40], [200, -15], [215, 2], [240, -10], [255, -95], [262, -110], [258, -80], [265, 0], [290, -5],
  [310, -40], [300, -55], [290, -35], [305, 0], [340, 8], [380, -5], [420, -30], [440, -60], [450, -120], [455, -60],
  [445, 30], [440, 70], [460, 40], [520, -10],
];
const SIGNATURE = (() => {
  const out = [];
  const P = SIG_KEYS;
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)];
    const p1 = P[i];
    const p2 = P[i + 1];
    const p3 = P[Math.min(P.length - 1, i + 2)];
    for (let k = 0; k < 8; k++) {
      const u = k / 8;
      const u2 = u * u;
      const u3 = u2 * u;
      out.push([0, 1].map((j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * u + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * u2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * u3)));
    }
  }
  out.push(P[P.length - 1]);
  return out;
})();

// Rotoscoped pen ink for the handwriting frames (scripts/trace-ink.js -> ref/derived/ink/i_####.bin,
// zlib-compressed 8-bit alpha at 1440x1080). Loaded synchronously and cached per frame.
const INK_DIR = require('path').join(__dirname, '..', 'ref', 'derived', 'ink');
const inkCache = {};
function inkMatte(fr, color) {
  const key = fr + color;
  if (key in inkCache) return inkCache[key];
  const file = pathMod.join(INK_DIR, `i_${String(fr).padStart(4, '0')}.bin`);
  if (process.env.NOSIG || !fsMod.existsSync(file)) return (inkCache[key] = null);
  const a = require('zlib').gunzipSync(fsMod.readFileSync(file));
  const c = createCanvas(W, H);
  const x = c.getContext('2d');
  const id = x.createImageData(W, H);
  const [r, g, b] = [1, 3, 5].map((k) => parseInt(color.slice(k, k + 2), 16));
  for (let i = 0; i < W * H; i++) {
    id.data[i * 4] = r;
    id.data[i * 4 + 1] = g;
    id.data[i * 4 + 2] = b;
    id.data[i * 4 + 3] = a[i];
  }
  x.putImageData(id, 0, 0);
  return (inkCache[key] = c);
}

function sceneType(ctx, t, f) {
  const frI = Math.round(t * C.FPS);
  const matte = inkMatte(frI, '#2c2422');
  const strokes = !matte && !process.env.NOSIG;
  // neutral grey paper; the shade on the left (and a little at the bottom) deepens over the shot
  ctx.fillStyle = '#e7e7e8';
  ctx.fillRect(0, 0, W, H);
  const dk = lerp(14, 36, inv(0.8, 1.95, t)) / 224;
  const pg = ctx.createLinearGradient(0, 0, 1080, 0);
  pg.addColorStop(0, `rgba(0,0,0,${dk})`);
  pg.addColorStop(0.65, `rgba(0,0,0,${dk * 0.55})`);
  pg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = pg;
  ctx.fillRect(0, 0, W, H);
  const bg2 = ctx.createLinearGradient(0, 600, 0, H);
  bg2.addColorStop(0, 'rgba(0,0,0,0)');
  bg2.addColorStop(1, `rgba(0,0,0,${dk * 0.15})`);
  ctx.fillStyle = bg2;
  ctx.fillRect(0, 600, W, H - 600);
  const x0 = kf(t, [[0.68, 100], [0.8, 72, 'outCubic'], [1.96, 42, 'linear']]);
  const y0 = 540;
  const [sx, sy] = shake(t, 2.5, 1, 4);

  // ghost cursive, out of focus, drifting right across the top
  if (strokes && t > 0.73 && t < 1.06) {
    const [c, x] = off(1);
    const gx = lerp(280, 820, inv(0.79, 1.0, t));
    const pts = SIGNATURE.map(([a, b]) => [a * 1.75 + gx, b * 1.3 + 300]);
    fx.strokePartial(x, pts, 0, 1, 20, 'rgba(70,68,66,0.42)');
    composite(ctx, c, { blur: 18, alpha: inv(0.73, 0.77, t) * (1 - inv(1.0, 1.06, t)) });
  }
  // the camera racks focus on the line as it lands
  const defocus = kf(t, [[0.68, 6], [0.75, 4.5], [0.79, 1.2], [0.83, 2.6], [0.87, 1.2], [0.95, 0]]);
  const [lc, lx] = off(2);
  const ctx0 = ctx;
  ctx = lx;
  ctx.save();
  ctx.translate(sx, sy);
  if (matte) ctx.globalAlpha = 0; // the traced frames carry the line and its box
  const end = fx.words(ctx, sentenceParts(t), x0, y0, BODY);
  const wordX = (i) => x0 + fx.measure(ctx, SENT.slice(0, i).join(' ') + (i ? ' ' : ''), BODY);

  // selection box with I-beam end handles while the phrase lands (and once more at 0.876)
  if (t < 0.81 || (t > 0.855 && t < 0.897)) {
    const bx0 = x0 - 64;
    const bx1 = end + 50;
    ctx.save();
    ctx.strokeStyle = 'rgba(40,36,34,0.8)';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(bx0, 438, bx1 - bx0, 186);
    ctx.setLineDash([]);
    ctx.fillStyle = '#2a2624';
    [bx0, bx1].forEach((bx) => {
      ctx.fillRect(bx - 3, 432, 6, 198);
      ctx.fillRect(bx - 10, 430, 20, 5);
      ctx.fillRect(bx - 10, 625, 20, 5);
    });
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  // long pen stroke down the left edge
  if (strokes && t > 0.77 && t < 0.815) fx.strokePartial(ctx, [[88, 380], [92, 600], [96, 850], [100, 1080]], 0, 1, 4, '#3a3634');
  if (strokes && t > 0.815 && t < 0.855) fx.strokePartial(ctx, [[90, 980], [96, 1030], [104, 1080]], 0, 1, 4, '#3a3634');
  // handwritten signature below the line
  if (strokes && t > 0.74 && t < 1.06) {
    const sh = inv(0.92, 1.0, t);
    const pts = SIGNATURE.map(([a, b]) => [a * 1.15 + 190 + sh * 100, b * 1.35 + 760 - sh * 40]);
    const col = mixHex('#5f5957', '#4a2a22', sh);
    fx.strokePartial(ctx, pts, Math.max(0, inv(1.0, 1.06, t)), inv(0.74, 0.79, t), 3.8, col);
  }
  if (strokes && t > 0.81 && t < 0.855) fx.strokePartial(ctx, [[604, 206], [560, 360], [524, 500]], 0, 1, 4, '#2e2a28');
  // long brown arc on the right with a little tail (one frame), then a big J loop
  if (strokes && t > 1.065 && t < 1.105) {
    const arc = [];
    for (let i = 0; i <= 40; i++) {
      const u = i / 40;
      arc.push([960 + Math.sin(u * Math.PI * 0.9) * 95 - u * 70, lerp(0, 700, u)]);
    }
    fx.strokePartial(ctx, [...arc, ...smoothPts([[930, 715], [880, 722], [850, 735], [820, 724], [790, 745], [770, 760]], 6)], 0, 1, 3.6, PEN);
    penPath(ctx, [[722, 60], [716, 140], [730, 220], [748, 250]], 3.4, PEN);
  }
  if (strokes && t > 1.105 && t < 1.147) {
    const loop = [[750, 230], [800, 300], [930, 345], [1100, 410], [1230, 500], [1272, 620], [1240, 760], [1150, 840], [1060, 790], [990, 690], [900, 610], [840, 570], [800, 548], [758, 556]];
    penPath(ctx, loop, 3.6, PEN);
  }
  if (false) {
    const arc = [];
    for (let i = 0; i <= 60; i++) {
      const u = i / 60;
      arc.push([lerp(960, 1080, Math.sin(u * Math.PI * 0.85)) - u * 80, lerp(0, 960, u)]);
    }
    const tail = fx.scribblePoints(15, 230, 60, 4, 80).map(([a, b]) => [900 - a, b + 975]);
    fx.strokePartial(ctx, [...arc, ...tail], Math.max(0, inv(1.08, 1.16, t)), inv(0.9, 0.98, t), 3.6, PEN);
    fx.strokePartial(ctx, [[735, 240], [728, 290], [745, 330], [760, 310]], 0, inv(0.95, 1.0, t), 3.4, PEN);
  }
  // strike + loop round "that you're", then a tail flick
  if (strokes && t > 1.2 && t < 1.42) {
    const xa = wordX(4);
    const xb = wordX(6) - 12;
    const fade = inv(1.36, 1.42, t);
    const loop = fx.loopPoints(5, 150, 50, 0.85).map(([a, b]) => [a + wordX(5) + 80, b + 548]);
    fx.strokePartial(ctx, loop, fade, inv(1.2, 1.27, t), 4.2, PEN);
    fx.strokePartial(ctx, [[xb + 30, 560], [xb - 20, 640], [xb - 70, 720]], fade, inv(1.28, 1.36, t), 3.4, PEN);
  }
  // single-frame pen gestures: open loop round "you're", a long rule over the line, a drop, a tick
  if (strokes && t > 1.4 && t < 1.44) penPath(ctx, [[675, 472], [760, 462], [880, 470], [967, 520], [940, 575], [820, 580], [720, 560]], 4, PEN);
  if (strokes && t > 1.44 && t < 1.48) penPath(ctx, [[112, 500], [104, 480], [118, 470], [300, 468], [520, 466], [742, 472]], 4, PEN);
  if (strokes && t > 1.48 && t < 1.52) penPath(ctx, [[121, 0], [121, 200], [122, 400], [124, 468], [136, 478]], 4.5, PEN);
  if (strokes && t > 1.52 && t < 1.56) penPath(ctx, [[112, 22], [114, 60], [116, 92]], 4, PEN);
  ctx.restore();
  composite(ctx0, lc, { blur: defocus });
  // traced ink already carries the source's focus blur
  if (matte) ctx0.drawImage(matte, 0, 0, W, H);
}

function speedStreaks(ctx, a, seed) {
  const r = rng(seed);
  ctx.save();
  for (let i = 0; i < 9; i++) {
    const y = r() * H;
    const x = r() * W;
    const len = 200 + r() * 320;
    ctx.strokeStyle = i % 3 === 0 ? `rgba(216,36,28,${0.9 * a})` : `rgba(40,36,36,${0.55 * a})`;
    ctx.lineWidth = 2 + r() * 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y - len * 0.28);
    ctx.stroke();
  }
  ctx.restore();
}

// =====================================================================
// 3. Full sentence with the giant sparkle and floating icons.
// =====================================================================
function starColors(t) {
  const p = inv(2.3, 3.4, t);
  const purple = inv(3.63, 3.71, t);
  const red = inv(3.71, 3.755, t);
  const deep = (c) => mixHex(mixHex(c, '#5020b0', purple), '#a8183c', red);
  return {
    edge: deep(mixHex(mixHex('#c8f2ec', '#46f2e2', inv(2.06, 2.2, t)), '#3fd8f0', ease.inOutQuad(p))),
    mid: deep(mixHex(mixHex('#b4ece6', '#3ee6dc', inv(2.06, 2.2, t)), mixHex('#2a8af2', '#2a4af0', p), inv(2.3, 2.6, t))),
    core: deep(mixHex(mixHex('#a8e8e2', '#3ee0da', inv(2.06, 2.2, t)), mixHex('#1a64ff', '#2a2ad8', p), inv(2.3, 2.6, t))),
  };
}

// Four-arm sparkle with independent arm angles and lengths (the source star is skewed).
function armStar(ctx, cx, cy, angs, lens, k) {
  const tips = angs.map((a, i) => [cx + Math.cos(a) * lens[i], cy + Math.sin(a) * lens[i]]);
  const avg = lens.reduce((q, v) => q + v, 0) / lens.length;
  ctx.beginPath();
  ctx.moveTo(...tips[0]);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    let a0 = angs[i];
    let a1 = angs[j];
    if (a1 < a0) a1 += Math.PI * 2;
    const am = (a0 + a1) / 2;
    const c = [cx + Math.cos(am) * avg * k, cy + Math.sin(am) * avg * k];
    ctx.bezierCurveTo(lerp(tips[i][0], c[0], 0.85), lerp(tips[i][1], c[1], 0.85), lerp(tips[j][0], c[0], 0.85), lerp(tips[j][1], c[1], 0.85), ...tips[j]);
  }
  ctx.closePath();
}
// star pose keyframes measured from the source: centre, arm angles (up, right, down, left), lengths, pinch
const STAR_KEYS = [
  [2.064, 90, 480, [-1.77, -0.09, 0.92, 3.0], [500, 520, 560, 300], 0.04],
  [2.25, 40, 420, [-1.2, 0.18, 1.52, 3.0], [450, 380, 660, 400], 0.04],
  [2.5, -70, 505, [-0.8, 0.57, 2.0, 3.0], [820, 800, 520, 600], 0.04],
  [3.0, -95, 505, [-0.71, 0.65, 2.2, 3.0], [925, 785, 500, 500], 0.02],
  [3.5, -100, 505, [-0.67, 0.73, 2.3, 3.0], [930, 850, 500, 500], 0.018],
  [3.71, -100, 505, [-0.66, 0.75, 2.3, 3.0], [930, 850, 500, 500], 0.018],
  [3.79, -80, 540, [-0.55, 0.58, 2.3, 3.0], [740, 700, 500, 500], 0.06],
  [3.83, -80, 540, [-0.55, 0.58, 2.3, 3.0], [740, 700, 500, 500], 0.06],
];
function starPose(t) {
  let i = 0;
  while (i < STAR_KEYS.length - 2 && t > STAR_KEYS[i + 1][0]) i++;
  const A = STAR_KEYS[i];
  const B = STAR_KEYS[i + 1];
  const u = ease.inOutQuad(inv(A[0], B[0], t));
  return { cx: lerp(A[1], B[1], u), cy: lerp(A[2], B[2], u), angs: A[3].map((v, j) => lerp(v, B[3][j], u)), lens: A[4].map((v, j) => lerp(v, B[4][j], u)), k: lerp(A[5], B[5], u) };
}

// icon drift measured from the source (frame 50 -> 3.0 s)
const FLOAT_KEYS = {
  book: [[2.064, 832, 382], [2.25, 765, 360], [2.5, 742, 349], [3.0, 731, 344]],
  clapper: [[2.064, 1091, 393], [2.25, 1069, 371], [2.5, 1057, 360], [3.0, 1053, 360]],
  coin: [[2.064, 1001, 630], [2.25, 979, 641], [2.5, 963, 652], [3.0, 956, 652]],
  camera: [[2.064, 1136, 787], [2.25, 1125, 832], [2.5, 1118, 850], [3.0, 1118, 855]],
};
const FLOATERS = [
  ['book', 96, -0.35, 0],
  ['clapper', 100, 0.38, 1],
  ['coin', 84, 0, 2],
  ['camera', 100, 0.08, 3],
];
const floatPos = (n, t) => [kf(t, FLOAT_KEYS[n].map(([a, x]) => [a, x, 'outCubic'])), kf(t, FLOAT_KEYS[n].map(([a, , y]) => [a, y, 'outCubic']))];

// darkness falling off from the star side (left), plus top/bottom, plus the closing spotlight
function sparkleShade(ctx, t) {
  const m = kf(t, [[2.064, 0.35], [2.25, 0.72], [2.5, 1], [3.0, 1], [3.5, 1]]);
  const g = ctx.createRadialGradient(-100, 540, 0, -100, 540, 1500);
  [[0, 1], [400, 0.95], [600, 0.66], [800, 0.36], [1000, 0.15], [1200, 0.05], [1500, 0]].forEach(([d, a]) => g.addColorStop(d / 1500, `rgba(40,26,24,${a * m})`));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const v = kf(t, [[2.064, 0.1], [2.25, 0.24], [2.5, 0.36], [3.0, 0.48], [3.5, 0.56], [3.62, 0.62]]);
  const tg = ctx.createLinearGradient(0, 0, 0, H);
  tg.addColorStop(0, `rgba(30,22,22,${v})`);
  tg.addColorStop(0.35, 'rgba(30,22,22,0)');
  tg.addColorStop(0.65, 'rgba(30,22,22,0)');
  tg.addColorStop(1, `rgba(30,22,22,${v})`);
  ctx.fillStyle = tg;
  ctx.fillRect(0, 0, W, H);
  const rc = kf(t, [[3.0, 0], [3.5, 1], [3.545, 1.1], [3.587, 1.3], [3.63, 1.7]]);
  if (rc > 0) {
    ctx.save();
    ctx.translate(800, 500);
    ctx.scale(1.15, 1);
    const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, 760);
    sg.addColorStop(0, 'rgba(30,22,22,0)');
    sg.addColorStop(lerp(0.55, 0.36, inv(3.5, 3.63, t)), 'rgba(30,22,22,0)');
    sg.addColorStop(0.85, `rgba(30,22,22,${Math.min(1, 0.45 * rc)})`);
    sg.addColorStop(1, `rgba(30,22,22,${Math.min(1, 0.72 * rc)})`);
    ctx.fillStyle = sg;
    ctx.fillRect(-1000, -800, 2000, 1600);
    ctx.restore();
  }
}

function globe(ctx, x, y, r) {
  ctx.save();
  ctx.fillStyle = '#3a8ee8';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 7);
  ctx.fill();
  ctx.strokeStyle = '#d8f0ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(x, y, r * 0.45, r, 0, 0, 7);
  ctx.moveTo(x - r, y);
  ctx.lineTo(x + r, y);
  ctx.stroke();
  ctx.restore();
}

// per-frame doodle bursts after the flash (frames 50-58), from the source
const DOODLES = [
  [2.064, 2.106, [
    [[[709, 191], [800, 250], [900, 330], [1035, 450]], 10, '#d8241c'],
    [[[990, 205], [1010, 230], [1040, 248]], 6, '#d8241c'],
    [[[1100, 150], [1115, 130], [1102, 175], [1118, 190]], 5, '#d8241c'],
    [[[956, 731], [1050, 690], [1150, 640], [1226, 596]], 12, '#d8241c'],
    [[[1350, 585], [1280, 690], [1250, 760], [1192, 877]], 6, '#d8241c'],
    [[[1330, 760], [1340, 820], [1360, 790]], 5, '#d8241c'],
    [[[945, 124], [1100, 210], [1294, 337]], 5, 'rgba(40,36,36,0.8)'],
    [[[461, 967], [640, 905], [821, 843]], 4, 'rgba(40,36,36,0.8)'],
    [[[911, 1001], [1010, 950], [1125, 900]], 4, 'rgba(40,36,36,0.8)'],
    [[[700, 140], [780, 175]], 4, 'rgba(40,36,36,0.8)'],
  ]],
  [2.106, 2.148, [
    [[[330, 300], [520, 340], [700, 380]], 3, '#d8241c'],
    [[[690, 470], [700, 360], [780, 330], [880, 380], [920, 410]], 7, '#2a2624'],
    [[[540, 610], [700, 560], [800, 530]], 3, 'rgba(40,36,36,0.8)'],
    [[[180, 980], [260, 960]], 3, 'rgba(40,36,36,0.8)'],
  ]],
  [2.148, 2.19, [
    [[[300, 140], [330, 120], [370, 130], [400, 150], [380, 165]], 7, '#d8241c'],
    [[[470, 1050], [450, 800], [520, 650], [560, 760], [540, 900]], 3, 'rgba(40,36,36,0.75)'],
    [[[1000, 360], [1150, 330], [1300, 400]], 4, 'rgba(40,36,36,0.75)'],
    [[[640, 980], [720, 960], [800, 945]], 3, 'rgba(40,36,36,0.75)'],
  ]],
  [2.19, 2.232, [
    [[[150, 310], [140, 290], [150, 270]], 4, '#2a2624'],
    [[[880, 410], [860, 370], [880, 340], [920, 330]], 6, '#2a2624'],
    [[[160, 1010], [190, 990], [220, 1000]], 4, '#2a2624'],
  ]],
  [2.232, 2.275, [
    [[[304, 225], [600, 160], [900, 150], [1180, 165], [1215, 190], [1181, 236]], 8, '#d8241c'],
    [[[460, 326], [470, 316]], 5, '#2a2624'],
    [[[505, 877], [490, 840], [510, 810], [520, 860]], 5, '#2a2624'],
    [[[700, 420], [760, 430], [800, 425]], 4, 'rgba(40,36,36,0.7)'],
  ]],
  [2.275, 2.36, [
    [[[1170, 70], [1190, 110], [1160, 150]], 5, '#d8241c'],
    [[[400, 950], [420, 930]], 4, '#2a2624'],
  ]],
];

// the light warms and closes in: rose -> salmon -> orange -> a red glow on the left
function warmLight(ctx, t) {
  // [t, cx, cy, radius, centre colour, edge colour] measured from the source (frames 88-91)
  const wk = [
    [3.67, 860, 470, 650, '#dcb6a4', '#3c2224', '#9a6a64'],
    [3.712, 720, 470, 600, '#d0845f', '#40121a', '#a8302a'],
    [3.754, 640, 480, 520, '#c45427', '#220c12', '#9a1a1c'],
    [3.795, 380, 540, 360, '#b8201a', '#181414', '#b01c18'],
  ];
  let i = 0;
  while (i < wk.length - 2 && t > wk[i + 1][0]) i++;
  const A = wk[i];
  const B = wk[i + 1];
  const u = clamp(inv(A[0], B[0], t));
  const cx = lerp(A[1], B[1], u);
  const cy = lerp(A[2], B[2], u);
  const r = lerp(A[3], B[3], u);
  const col = mixHex(A[4], B[4], u);
  const dark = mixHex(A[5], B[5], u);
  ctx.fillStyle = dark;
  ctx.fillRect(0, 0, W, H);
  const lg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  lg.addColorStop(0, col);
  lg.addColorStop(0.25, col);
  lg.addColorStop(0.6, mixHex(A[6], B[6], u));
  lg.addColorStop(1, dark);
  ctx.fillStyle = lg;
  ctx.fillRect(0, 0, W, H);
}

function sceneSparkle(ctx, t, f) {
  if (t < 1.98) {
    // frame 47: red flash, gold vertical flare, white zigzags, the end of the line stood on end
    ctx.fillStyle = '#c41018';
    ctx.fillRect(0, 0, W, H);
    fx.words(ctx, sentenceParts(1.9, '#2a1010', '#2a1010').slice(0, 8), 45, 531, BODY);
    const [c, x] = off(0);
    x.fillStyle = '#e8b424';
    armStar(x, 1290, 531, [-Math.PI / 2, 0, Math.PI / 2, Math.PI], [600, 200, 600, 230], 0.12);
    x.fill();
    composite(ctx, c, { filter: `drop-shadow(0 0 ${14 * S}px rgba(255,200,60,0.8))` });
    [[[940, 551], [990, 280], [1030, 450], [1075, 243], [1110, 420], [1150, 300], [1232, 500]], [[827, 810], [900, 640], [960, 760], [1020, 600], [1080, 720], [1140, 560], [1232, 600]]].forEach((pts) => fx.strokePartial(ctx, pts, 0, 1, 5, '#f4efe6', false));
    ctx.save();
    ctx.translate(1300, 270);
    ctx.rotate(Math.PI / 2);
    ctx.scale(1, 0.55);
    fx.text(ctx, 'change?', 0, 0, 150, '#121010', { baseline: 'middle' });
    ctx.restore();
    ctx.strokeStyle = '#121010';
    ctx.lineWidth = 3;
    [225, 832].forEach((yy) => {
      ctx.beginPath();
      ctx.moveTo(1215, yy);
      ctx.lineTo(1431, yy);
      ctx.moveTo(1431, yy - 14);
      ctx.lineTo(1431, yy + 14);
      ctx.stroke();
    });
    globe(ctx, 1215, 531, 22);
    return;
  }
  if (t < 2.022) {
    // frame 48: yellow flash with a big defocused star, streaks and icons
    ctx.fillStyle = '#dea51a';
    ctx.fillRect(0, 0, W, H);
    const [c, x] = off(0);
    fx.words(x, sentenceParts(1.9, '#3a2410', '#3a2410').slice(0, 8), 20, 540, BODY);
    x.fillStyle = '#f2f23c';
    armStar(x, 616, 444, [-1.26, 0.04, 1.72, 3.22], [410, 390, 560, 616], 0.06);
    x.fill();
    [[180, 202, 1080, 315], [500, 120, 1000, 260], [430, 860, 1250, 640], [650, 1000, 1300, 760]].forEach(([a, b, c2, d]) => fx.strokePartial(x, [[a, b], [c2, d]], 0, 1, 12, 'rgba(250,244,230,0.85)', false));
    [['book', 945, 416, 70, -0.3], ['clapper', 1113, 427, 70, 0.3], ['coin', 1068, 607, 60, 0], ['camera', 1158, 720, 70, 0.4]].forEach(([n, a, b, w, r]) => drawSprite(x, n, a, b, w, r));
    x.fillStyle = '#2a1a10';
    for (let yy = 210; yy < 860; yy += 70) x.fillRect(1237 + ((yy / 70) % 2) * 20, yy, 110, 46);
    composite(ctx, c, { blur: 16 });
    return;
  }

  const [sx, sy] = shake(t, 3, 1.2, 8);
  ctx.fillStyle = '#f2f2f4';
  ctx.fillRect(0, 0, W, H);
  // warm progression of the light 3.6 -> 3.78
  if (t < 3.65 && t >= 2.064) sparkleShade(ctx, t);
  if (t >= 3.65) warmLight(ctx, t);

  // the sentence (blurred while the frame settles), star in front of it
  const parts = SENT.map((w, i) => ({
    t: w,
    c: i === 2 && t > 3.5 ? '#ffffff' : '#2a1a16',
    o: i === 2 && t > 3.5 ? { glow: 'rgba(255,255,255,0.8)', glowBlur: 14 } : {},
  }));
  const [tc, tx] = off(2);
  fx.words(tx, parts, 40, 538, BODY);
  const tBlur = kf(t, [[2.022, 7], [2.064, 3], [2.106, 2], [2.27, 1.5], [2.45, 0]]);

  if (t < 2.064) {
    // frame 49: everything defocused on bare paper, dark streaks
    composite(ctx, tc, { blur: 7, alpha: 0.6 });
    const [c, x] = off(0);
    [['book', 877, 405, 80, -0.3], ['clapper', 1102, 405, 80, 0.3], ['coin', 1035, 607, 70, 0], ['camera', 1147, 765, 80, 0.3]].forEach(([n, a, b, w, r]) => drawSprite(x, n, a, b, w, r));
    [[180, 135, 1000, 420], [940, 190, 1130, 260], [240, 1010, 900, 820], [1150, 690, 1300, 600], [60, 920, 230, 860]].forEach(([a, b, c2, d]) => fx.strokePartial(x, [[a, b], [c2, d]], 0, 1, 9, 'rgba(50,46,46,0.7)', false));
    x.strokeStyle = 'rgba(60,50,46,0.6)';
    x.setLineDash([5, 4]);
    x.lineWidth = 2;
    x.strokeRect(1215, 450, 200, 180);
    composite(ctx, c, { blur: 6 });
    return;
  }
  const sc = starColors(t);
  const P = starPose(t);
  const [c2, x2] = off(1);
  armStar(x2, P.cx, P.cy, P.angs, P.lens, P.k);
  const rg = x2.createRadialGradient(P.cx, P.cy, 30, P.cx, P.cy, 520);
  rg.addColorStop(0, sc.core);
  rg.addColorStop(0.35, sc.core);
  rg.addColorStop(0.65, sc.mid);
  rg.addColorStop(1, sc.edge);
  const rim = inv(3.755, 3.79, t);
  x2.fillStyle = rg;
  x2.shadowColor = sc.edge;
  x2.shadowBlur = 12 * S;
  x2.globalAlpha = 1 - 0.7 * rim;
  x2.fill();
  x2.globalAlpha = 1;
  x2.shadowBlur = 0;
  // halftone dots in the deep blue body late on
  const ht = inv(3.3, 3.5, t);
  if (ht > 0) {
    x2.save();
    x2.clip();
    x2.fillStyle = `rgba(16,16,90,${0.35 * ht})`;
    for (let yy = 0; yy < H; yy += 9) for (let xx = 0; xx < 520; xx += 9) {
      x2.beginPath();
      x2.arc(xx + ((yy / 9) % 2) * 4.5, yy, 1.8, 0, 7);
      x2.fill();
    }
    x2.restore();
  }
  x2.strokeStyle = rim > 0 ? `rgba(240,40,30,${rim})` : t > 3.68 ? `rgba(255,240,240,${inv(3.68, 3.71, t) * 0.8})` : `rgba(31,106,90,${inv(2.25, 2.45, t)})`;
  x2.lineWidth = rim > 0 ? 10 : t > 3.68 ? 2.5 : 3;
  armStar(x2, P.cx, P.cy, P.angs, P.lens, P.k);
  if (rim > 0) {
    x2.shadowColor = 'rgba(255,40,30,0.9)';
    x2.shadowBlur = 24 * S;
  }
  x2.stroke();
  x2.shadowBlur = 0;
  composite(ctx, c2, { blur: t < 2.15 ? 1.5 : 0 });
  composite(ctx, tc, { blur: tBlur });
  fx.grain(ctx, f + 3, 0.12);

  ctx.save();
  ctx.translate(sx, sy);
  // floating icons, wobbling
  if (t < 3.27) {
    // the icons break up into coarse pixel blocks before vanishing (frames 76-78)
    const out = 0;
    const mos = inv(3.09, 3.255, t);
    const ib = kf(t, [[2.064, 1.5], [2.2, 4], [2.3, 3], [2.45, 0]]);
    const [ic, ix] = off(0);
    FLOATERS.forEach(([n, w, r, ph]) => {
      const [x, y] = floatPos(n, t);
      const dx = noise1(t * 1.6, ph) * 6;
      const dy = noise1(t * 1.3, ph + 5) * 6;
      drawSprite(ix, n, x + dx, y + dy, w * (1 - out), r + Math.sin(t * 5 + ph * 2) * 0.12);
    });
    if (mos > 0) mosaic(ctx, ic, Math.round(lerp(3, 15, mos * mos)), { blur: 0.6 });
    else composite(ctx, ic, { blur: ib });
    dot(ctx, 406, 322, 4);
    dot(ctx, 821, 382, 3);
    ctx.fillStyle = '#d8241c';
    ctx.beginPath();
    ctx.ellipse(1125, 213, 5, 7, 0.4, 0, 7);
    ctx.fill();
  }
  DOODLES.forEach(([a, b, strokes]) => {
    if (t < a || t >= b) return;
    strokes.forEach(([pts, lw, col]) => fx.strokePartial(ctx, smoothPts(pts, 6), 0, 1, lw, col));
  });
  ctx.restore();

  if (t >= 3.6) {
    if (t > 3.66 && t < 3.735) {
      const k2 = t < 3.69 ? 0.6 : 1;
      fx.strokePartial(ctx, smoothPts([[450, 270], [520, 110], [750, 95], [900, 180], [975, 330], [990, 380], [960, 400], [975, 320]], 8), 0, k2, 7, '#d8201a');
      if (t > 3.69) fx.strokePartial(ctx, smoothPts([[470, 730], [440, 820], [405, 920]], 6), 0, 1, 5, '#1a1010');
    }
    if (t >= 3.735 && t < 3.775) {
      const el = [];
      for (let j = 0; j <= 48; j++) {
        const a = (j / 48) * Math.PI * 2;
        el.push([452 + Math.cos(a) * 180 + Math.sin(a) * 30, 540 + Math.sin(a) * 300]);
      }
      fx.strokePartial(ctx, el, 0, 1, 7, '#e0201a');
      fx.strokePartial(ctx, smoothPts([[283, 445], [380, 280], [470, 243], [480, 500], [470, 823]], 8), 0, 1, 4, '#1a1010');
    }
  }
}

// =====================================================================
// 4. "you dont." — thermal profile, white strokes, then backlit silhouette.
// =====================================================================
function sceneProfile(ctx, t, f) {
  const bg = bgRamp(t, [
    [3.82, '#151314'],
    [5.45, '#151314'],
    [5.6, '#2c1d20'],
    [5.75, '#3a2c30'],
    [5.85, '#54464b'],
    [6.0, '#7c7175'],
    [6.13, '#ada7a9'],
    [6.17, '#bdbabb'],
    [6.21, '#e4e5e5'],
  ]);
  fx.dark(ctx, bg);
  const wall = inv(5.45, 5.75, t);
  if (wall > 0) {
    ctx.globalAlpha = wall;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }
  if (t > 5.4 && t < 5.66) {
    const g = ctx.createRadialGradient(0, 1080, 0, 0, 1080, 700);
    g.addColorStop(0, `rgba(160,20,20,${0.5 * Math.sin(Math.PI * inv(5.4, 5.66, t))})`);
    g.addColorStop(1, 'rgba(120,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  const lit = 0.25 * inv(6.05, 6.2, t);
  if (lit > 0) {
    const g = ctx.createLinearGradient(0, 0, 700, 0);
    g.addColorStop(0, `rgba(255,255,255,${0.9 * lit})`);
    g.addColorStop(0.55, `rgba(255,255,255,${0.35 * lit})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  const settle = ease.inOutCubic(inv(3.82, 4.35, t));
  const traced = headMask(t);
  // a traced head already carries the source's own camera motion
  const z = traced ? 1 : lerp(1, 1.04, inv(4.1, 6.2, t));
  const [sx, sy] = traced ? [0, 0] : shake(t, 2.2, 0.8, 21);
  ctx.save();
  camera(ctx, { x: sx, y: sy, z, cx: 900, cy: 600 });

  const drift = kf(t, [[4.1, 0], [5.0, 70, 'linear'], [5.6, 105, 'linear'], [6.3, 125]]);
  const toTan = ease.inOutQuad(inv(5.84, 6.02, t));
  const toShadow = ease.inOutQuad(inv(6.06, 6.16, t));
  const shrink = lerp(1, 0.92, ease.inOutQuad(inv(5.85, 6.0, t)));
  const hx = 600 + drift + (1 - settle) * 160 + (1 - shrink) * 300;
  const hy = 225 + (1 - settle) * 295 - (1 - shrink) * 700;
  const hz = (1 + (1 - settle) * 0.12) * shrink;
  const [c, x] = off(1);
  x.save();
  x.translate(hx, hy);
  x.scale(hz, hz);
  const heat = traced ? thermalImage(`head${traced.f}`, traced.mask, { depth: 34, base: 0.3, gain: 0.42, hotMask: traced.hot, front: kf(t, [[5.5, 0.3], [5.85, 0.08]]), rimBack: 0.35, mottle: 0.1, floor: 0.37, hotBlur: 40, hotGain: 0.5, hot: [[0.62, 0.18, 190, 0.12]] }) : thermal('head', 'heat');
  // traced images are screen-space: undo the head transform while drawing them
  const drawHead = (img, ox = 0) => {
    if (!traced) return x.drawImage(img, 0, 0);
    x.save();
    x.setTransform(S, 0, 0, S, 0, 0);
    x.drawImage(img, ox, 0, W, H);
    x.restore();
  };
  if (toShadow < 1 || traced) {
    x.globalAlpha = traced ? 1 : 1 - toShadow;
    if (settle < 1) x.filter = `hue-rotate(${-125 * Math.pow(1 - settle, 3.5) - (traced ? 6 : 16) * settle}deg) saturate(${lerp(0.9, 1.25, settle)}) brightness(${lerp(0.3, 0.92, settle * settle)})`;
    else if (t < 4.9 && !traced) x.filter = `hue-rotate(${-16 * (1 - inv(4.35, 4.9, t))}deg) saturate(${1 + 0.15 * (1 - inv(4.35, 4.9, t))}) brightness(${lerp(0.94, 1, inv(4.35, 4.9, t))})`;
    else if (traced) {
      const bri = kf(t, [[4.35, 0.8], [4.5, 0.8], [4.8, 0.87], [5.5, 0.87], [5.85, 0.55], [6.0, 0.45], [6.05, 0.4], [6.13, 0.33]]);
      const sep = kf(t, [[5.5, 0], [5.85, 0.35], [6.0, 0.55], [6.13, 0.7]]);
      const sat = kf(t, [[4.35, 1.15], [5.5, 1.15], [5.85, 1.35], [6.0, 1.3], [6.13, 0.9]]);
      const hue = kf(t, [[4.35, -6], [4.9, 0]]);
      x.filter = `hue-rotate(${hue}deg) sepia(${sep}) saturate(${sat}) brightness(${bri})`;
    } else if (toTan > 0 && traced) x.filter = `sepia(${lerp(0.3, 0.55, toTan)}) saturate(${lerp(1.2, 1.45, toTan)}) brightness(${lerp(0.92, 0.9, toTan)})`;
    else if (toTan > 0) x.filter = `sepia(${lerp(0.45, 0.85, toTan)}) saturate(${lerp(1.25, 0.9, toTan)}) brightness(${lerp(0.82, 0.55, toTan)})`;
    else if (t > 5.55) x.filter = `sepia(${0.45 * inv(5.55, 5.84, t)}) saturate(${lerp(1, 1.25, inv(5.55, 5.84, t))}) brightness(${lerp(1, 0.82, inv(5.55, 5.84, t))})`;
    const ghost = traced ? Math.sin(Math.PI * inv(5.9, 6.12, t)) : 0;
    if (ghost > 0.02) {
      // RGB-split ghosts trailing the head on the left during the switch to the backlit wall
      const f0 = x.filter;
      x.filter = 'none';
      x.save();
      x.setTransform(S, 0, 0, S, 0, 0);
      x.globalAlpha = 0.8 * ghost;
      x.drawImage(silhouette(traced.mask, '#c47a74'), -18 * ghost, 4, W, H);
      x.globalAlpha = ghost;
      x.drawImage(silhouette(traced.mask, '#1b1414'), 0, 0, W, H);
      x.restore();
      x.filter = f0;
    }
    drawHead(heat, 30 * ghost);
    x.filter = 'none';
    const wash = traced ? 0.5 * (1 - inv(4.5, 4.8, t)) * clamp((t - 3.9) / 0.15) : 0;
    if (wash > 0) {
      // the head reads red, not orange, as it settles
      x.save();
      x.setTransform(S, 0, 0, S, 0, 0);
      x.globalCompositeOperation = 'source-atop';
      x.fillStyle = `rgba(213,40,0,${wash})`;
      x.fillRect(0, 0, W, H);
      x.restore();
      if (traced.hot) {
        // keep the shirt white-hot under the wash
        x.save();
        x.setTransform(S, 0, 0, S, 0, 0);
        x.globalAlpha = Math.min(1, wash / 0.15) * 0.9;
        x.filter = `blur(${6 * S}px)`;
        x.drawImage(silhouette(traced.hot, '#e9ebef'), 0, 0, W, H);
        x.restore();
      }
    }
    if (settle < 0.45) {
      // 3.75: lit crimson core fading to purple, blue patch toward the lower right
      const e = 1 - settle / 0.45;
      x.save();
      x.globalCompositeOperation = 'source-atop';
      const core = x.createRadialGradient(330, 360, 20, 330, 380, 380);
      core.addColorStop(0, `rgba(170,24,96,${0.75 * e})`);
      core.addColorStop(0.45, `rgba(120,18,90,${0.5 * e})`);
      core.addColorStop(1, `rgba(58,26,106,${0.6 * e})`);
      x.fillStyle = core;
      x.fillRect(-100, -100, 1000, 1100);
      const blue = x.createRadialGradient(620, 820, 10, 620, 820, 260);
      blue.addColorStop(0, `rgba(42,42,138,${0.7 * e})`);
      blue.addColorStop(1, 'rgba(42,42,138,0)');
      x.fillStyle = blue;
      x.fillRect(-100, -100, 1000, 1100);
      x.restore();
    }
    if (settle > 0.25 && settle < 0.9) {
      // 4.0: soft orange contour bands inside a crimson rim
      const k = Math.sin(Math.PI * inv(0.25, 0.9, settle));
      x.save();
      x.globalCompositeOperation = 'source-atop';
      x.filter = `blur(${8 * S}px)`;
      x.strokeStyle = `rgba(236,96,32,${0.8 * k})`;
      x.lineWidth = 14;
      [0.55, 0.78].forEach((m) => {
        x.beginPath();
        x.ellipse(340, 380, 260 * m, 300 * m, 0.15, 0, 7);
        x.stroke();
      });
      x.restore();
    }
    if (settle < 1) {
      x.save();
      x.globalCompositeOperation = 'source-atop';
      const cr = x.createRadialGradient(330, 330, 40, 330, 360, 420);
      const ck = Math.min(1, settle * 2.4) * (1 - settle);
      cr.addColorStop(0, `rgba(184,90,32,${0.6 * ck})`);
      cr.addColorStop(0.6, `rgba(170,30,26,${0.55 * ck})`);
      cr.addColorStop(1, `rgba(160,24,24,${0.9 * ck})`);
      x.fillStyle = cr;
      x.fillRect(-100, -100, 1000, 1100);
      x.restore();
    }
    if (toTan > 0.5 && !traced) {
      // irregular dark burn ring around an olive patch in the hair
      x.save();
      x.globalAlpha = (1 - toShadow) * clamp((toTan - 0.5) * 2);
      x.beginPath();
      for (let i = 0; i <= 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        const rr = 1 + noise1(a * 3.5, 13) * 0.3 + (i % 4 === 0 ? 0.08 : 0);
        x.lineTo(320 + Math.cos(a) * 140 * rr, 232 + Math.sin(a) * 182 * rr);
      }
      x.closePath();
      x.fillStyle = '#7a6a40';
      x.filter = `blur(${2 * S}px)`;
      x.fill();
      x.strokeStyle = '#1e170a';
      x.lineWidth = 34;
      x.stroke();
      // darker, narrower torso
      const tg = x.createLinearGradient(0, 640, 0, 940);
      tg.addColorStop(0, 'rgba(58,48,40,0)');
      tg.addColorStop(0.3, 'rgba(58,48,40,0.97)');
      tg.addColorStop(1, 'rgba(58,48,40,0.95)');
      x.filter = 'none';
      x.globalCompositeOperation = 'source-atop';
      x.fillStyle = tg;
      x.fillRect(0, 640, 800, 300);
      x.restore();
    }
  }
  if (traced && traced.hot && t > 5.6) {
    // the shirt goes neutral grey and darkens as the wall lights up
    x.globalAlpha = 1;
    x.filter = 'none';
    const shc = kf(t, [[5.6, 0], [5.85, 1]]);
    const col = t < 5.85 ? '#cfcac0' : t < 6.0 ? mixHex('#7f7770', '#534e4d', inv(5.85, 6.0, t)) : t < 6.13 ? mixHex('#534e4d', '#201e1c', inv(6.0, 6.13, t)) : t < 6.21 ? '#1c1b1b' : mixHex('#1c1b1b', '#2f2d2d', inv(6.21, 6.25, t));
    x.globalAlpha = t < 5.85 ? shc : 1;
    if (t >= 6.15) {
      // drawn after the silhouette below
    } else drawHead(silhouette(traced.hot, t < 5.85 ? mixHex('#d8d4ca', '#7f7770', shc) : col));
    x.globalAlpha = 1;
  }
  const thr = traced ? kf(t, [[6.01, -0.3], [6.048, 0.26], [6.089, 0.7], [6.131, 1.0], [6.15, 1.2]]) : 0;
  if (traced && thr > -0.15 && t < 6.15) {
    x.globalAlpha = 1;
    x.filter = `blur(${2.5 * S}px)`;
    drawHead(burnImage(`head${traced.f}`, traced.mask, thr));
    x.filter = 'none';
  }
  if (traced && t >= 6.15) {
    x.globalAlpha = 1;
    const sc = t < 6.17 ? mixHex('#443a28', '#38322a', inv(6.15, 6.17, t)) : t < 6.21 ? mixHex('#38322a', '#3a3a3a', inv(6.17, 6.21, t)) : mixHex('#3a3a3a', '#8b898a', inv(6.21, 6.25, t));
    drawHead(silhouette(traced.mask, sc));
    if (traced.hot) drawHead(silhouette(traced.hot, t < 6.21 ? '#1c1b1b' : mixHex('#1c1b1b', '#2f2d2d', inv(6.21, 6.25, t))));
  } else if (toShadow > 0 && !traced) {
    x.globalAlpha = toShadow;
    drawHead(thermal('head', 'shadow'));
    if (false) {
      // small dark burn spot in the hair
      x.save();
      x.setTransform(S, 0, 0, S, 0, 0);
      x.filter = `blur(${2 * S}px)`;
      x.fillStyle = '#100c0c';
      x.beginPath();
      for (let i = 0; i <= 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const rr = 1 + noise1(a * 2.5, 31) * 0.35;
        x.lineTo(1062 + Math.cos(a) * 26 * rr, 380 + Math.sin(a) * 36 * rr);
      }
      x.fill();
      x.restore();
    }
  }
  x.restore();
  // the source head stays soft-focus until about 4.85 s
  composite(ctx, c, { blur: traced ? Math.max((1 - settle) * 16, kf(t, [[4.35, 7], [4.6, 5], [4.85, 0]])) : (1 - settle) * 16 });

  if (settle < 0.6) {
    const cg = ctx.createRadialGradient(hx + 330, hy + 380, 0, hx + 330, hy + 380, 260);
    cg.addColorStop(0, `rgba(170,20,80,${0.65 * (1 - settle / 0.6)})`);
    cg.addColorStop(1, 'rgba(120,10,60,0)');
    ctx.save();
    ctx.filter = `blur(${20 * S}px)`;
    ctx.fillStyle = cg;
    ctx.fillRect(hx - 100, hy, 900, 900);
    ctx.restore();
  }
  if (t < 3.97) {
    ctx.save();
    ctx.filter = `blur(${8 * S}px)`;
    ctx.fillStyle = 'rgba(245,242,238,0.9)';
    ctx.fillRect(200, 520, 260, 30);
    ctx.restore();
  }
  if (t < 3.95) {
    ctx.save();
    ctx.filter = `blur(${40 * S}px)`;
    ctx.globalAlpha = 1 - inv(3.88, 3.95, t);
    ctx.fillStyle = '#7a1460';
    ctx.beginPath();
    ctx.ellipse(1330, 990, 170, 120, -0.5, 0, 7);
    ctx.fill();
    ctx.restore();
  }
  if (t < 3.98) {
    const g = ctx.createRadialGradient(1440, 1080, 0, 1440, 1080, 160);
    g.addColorStop(0, 'rgba(220,30,30,0.9)');
    g.addColorStop(1, 'rgba(220,30,30,0)');
    ctx.fillStyle = g;
    ctx.fillRect(1200, 840, 240, 240);
  }
  // one-frame accents measured from the source, by frame number
  const fr = Math.round(t * C.FPS);
  const glowStroke = (pts, lw, col, blur = 3) => {
    ctx.save();
    ctx.filter = `blur(${blur * S}px)`;
    fx.strokePartial(ctx, smoothPts(pts, 8), 0, 1, lw, col);
    ctx.restore();
  };
  const softDot = (x, y, r, col, blur = 4) => {
    ctx.save();
    ctx.filter = `blur(${blur * S}px)`;
    dot(ctx, x, y, r, col);
    ctx.restore();
  };
  const orbit = (cx, cy, rx, ry, rot, a0, a1, lw, col) => {
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const a = lerp(a0, a1, i / 40);
      const ex = Math.cos(a) * rx;
      const ey = Math.sin(a) * ry;
      pts.push([cx + ex * Math.cos(rot) - ey * Math.sin(rot), cy + ex * Math.sin(rot) + ey * Math.cos(rot)]);
    }
    fx.strokePartial(ctx, pts, 0, 1, lw, col);
  };
  const AMBER = 'rgba(240,150,50,0.9)';
  if (fr === 92) glowStroke([[450, 540], [600, 536], [742, 532]], 14, AMBER, 4);
  if (fr === 93) glowStroke([[607, 530], [900, 527], [1215, 520]], 12, AMBER, 3);
  if (fr === 94) {
    glowStroke([[990, 566], [1110, 560], [1237, 552]], 8, AMBER, 2);
    softDot(1350, 675, 22, 'rgba(236,160,40,0.9)', 6);
    softDot(877, 427, 10, 'rgba(200,90,30,0.9)', 2);
  }
  if (fr === 95) {
    ctx.save();
    ctx.filter = `blur(${3 * S}px)`;
    orbit(967, 573, 360, 140, -0.12, 0, Math.PI * 2, 14, AMBER);
    ctx.restore();
    softDot(630, 337, 30, 'rgba(236,160,40,0.85)', 8);
  }
  if (fr === 96) {
    glowStroke([[810, 360], [860, 200], [980, 130], [1125, 112]], 22, 'rgba(200,24,24,0.9)', 4);
    glowStroke([[742, 540], [900, 560], [1080, 585]], 10, AMBER, 2);
    softDot(1080, 585, 14, '#ffd84a', 2);
    glowStroke([[1215, 180], [1320, 260], [1350, 405]], 12, AMBER, 5);
  }
  if (fr === 97) {
    glowStroke([[450, 180], [650, 270], [855, 360]], 14, AMBER, 4);
    softDot(607, 810, 30, 'rgba(200,24,24,0.8)', 8);
    softDot(1080, 585, 12, '#ffd84a', 2);
  }
  if (fr >= 98 && fr <= 103) {
    const k = (fr - 98) / 5;
    softDot(lerp(405, 270, k), 180, lerp(30, 22, k), `rgba(236,150,40,${lerp(0.9, 0.35, k)})`, 8);
    softDot(585, lerp(877, 922, k), 16, `rgba(170,20,20,${lerp(0.8, 0.3, k)})`, 6);
    if (fr <= 102) softDot(1102, 585, lerp(12, 5, k), '#ffd84a', 1.5);
  }
  if (fr === 105) orbit(900, 472, 400, 130, -0.45, 2.3, 3.3, 4, '#f6f2ec');
  if (fr === 106) {
    orbit(900, 472, 400, 130, -0.45, 0, Math.PI * 2, 4, '#f6f2ec');
    dot(ctx, 832, 711, 6, '#fff');
  }
  if (fr === 107) {
    orbit(900, 472, 400, 130, -0.45, -1.35, -0.9, 4, '#f6f2ec');
    fx.strokePartial(ctx, [[870, 690], [886, 684]], 0, 1, 5, '#fff');
  }
  if (fr >= 108 && fr <= 111) dot(ctx, 877, 697, 4, '#fff');
  if (fr === 114) orbit(700, 175, 80, 30, 0.5, 3.2, 5.6, 4, '#f6f2ec');
  if (fr === 115) {
    orbit(945, 461, 360, 60, 0.78, 0, Math.PI * 2, 4, '#f6f2ec');
    orbit(1080, 450, 90, 60, 0.3, 0.2, 2.2, 3, '#f6f2ec');
  }
  if (fr === 116) {
    orbit(1170, 427, 40, 50, 0.2, -1.2, 1.0, 4, '#f6f2ec');
    orbit(1150, 675, 100, 40, 0.3, -0.5, 2.6, 5, '#f6f2ec');
  }
  if (fr === 117) fx.strokePartial(ctx, [[1120, 352], [1130, 364]], 0, 1, 4, '#f6f2ec');
  if (fr >= 118 && fr <= 123) dot(ctx, 1102, 360, 3, 'rgba(255,255,255,0.8)');
  ctx.restore();

  // text
  const intro = inv(3.82, 4.0, t);
  let parts;
  if (t < 5.28) parts = [{ t: 'you', c: CREAM }, { t: 'dont.', c: CREAM }];
  else if (t < 5.36) parts = [{ t: 'you', c: CREAM }];
  else if (t < 5.66) parts = [{ t: 'you', c: CREAM }, { t: 'just', c: mixHex(CREAM, '#cfc8c4', inv(5.56, 5.66, t)) }];
  else if (t < 5.97) {
    const g = inv(5.66, 5.92, t);
    const base = mixHex('#d8d0cc', '#8f8786', g);
    parts = [{ t: 'you', c: base }, { t: 'just', c: base }, { t: 'show', c: mixHex('#a09694', '#6a6260', g) }];
  } else {
    const tc = mixHex('#4e4a48', '#3d2620', inv(6.0, 6.15, t));
    parts = [{ t: 'you', c: tc }, { t: 'just', c: tc }, { t: 'show', c: tc }, { t: 'it.', c: tc }];
  }
  fx.words(ctx, parts, 200, 538, BODY, { blur: (1 - intro) * 9 });
  if (t < 4.36) fx.cursor(ctx, 640, 540, 44, 'rgba(160,156,150,0.8)', 3);
}

// =====================================================================
// 5. The pixel icon ring.
// =====================================================================
const RING = ['clapper', 'skateboard', 'vinyl', 'book', 'camera', 'cat', 'coin', 'controller', 'cap', 'heart', 'cash', 'plant'];
const RING_W = { clapper: 260, skateboard: 285, vinyl: 220, book: 220, camera: 220, cat: 195, coin: 205, controller: 260, cap: 275, heart: 380, cash: 380, plant: 260 };

function ringLayout(phi, { cx = 770, cy = 605, R = 480, tilt = 0.96, F = 4500, xs = 1, roll = 0 } = {}) {
  return RING.map((name, i) => {
    const a = Math.PI + (i / RING.length) * Math.PI * 2 + phi;
    const X = Math.cos(a) * R * xs;
    const Z = -Math.sin(a) * R;
    const y = -Z * Math.cos(tilt);
    const zc = Z * Math.sin(tilt);
    const s = F / (F + zc);
    const px = X * s;
    const py = y * s;
    return { name, x: cx + px * Math.cos(roll) - py * Math.sin(roll), y: cy + px * Math.sin(roll) + py * Math.cos(roll), s, z: zc, i };
  });
}

const ringPhi = (t) =>
  kf(t, [
    [6.38, -3.2],
    [6.75, -1.57, 'outCubic'],
    [7.0, -0.5, 'linear'],
    [7.27, 0, 'outQuad'],
    [7.5, 0.04, 'linear'],
    [8.0, 0.45, 'inQuad'],
    [8.3, 1.3, 'inQuad'],
  ]);
const ringAt = (t) => ringLayout(ringPhi(t), { xs: 0.8, R: 470, tilt: kf(t, [[7.5, 0.96], [8.0, 1.11]]), cy: kf(t, [[7.5, 490], [8.0, 530]]), cx: kf(t, [[7.5, 770], [8.0, 700]]), roll: kf(t, [[7.5, -0.06], [8.0, -0.16]]) });
const iconPos = (t, name) => {
  const it = ringAt(t).find((o) => o.name === name);
  return [it.x, it.y];
};

const HITS = [
  [7.22, 'cap'],
  [7.31, 'heart'],
  [7.5, 'cash'],
  [7.75, 'plant'],
];

function ballKeys() {
  const k = [
    [6.5, [760, 600]],
    [6.7, [700, 560], 'outQuad'],
    [6.8, [600, 450], 'inOutQuad'],
    [6.92, [800, 395], 'linear'],
    [7.02, [1000, 450], 'linear'],
  ];
  HITS.forEach(([ht, n], i) => {
    k.push([ht, iconPos(ht, n), 'inQuad']);
    if (i === 2) k.push([7.62, [760, 560], 'outQuad']);
  });
  k.push([7.95, [760, 560], 'outQuad'], [8.3, [770, 590], 'inOutQuad']);
  return k;
}
let BALL = null;

function flash(ctx, x, y, a, seed) {
  if (a <= 0) return;
  ctx.save();
  const g = ctx.createRadialGradient(x, y, 0, x, y, 330);
  g.addColorStop(0, `rgba(255,154,32,${0.95 * a})`);
  g.addColorStop(0.4, `rgba(255,150,40,${0.5 * a})`);
  g.addColorStop(1, 'rgba(255,140,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - 340, y - 340, 680, 680);
  const r = rng(seed);
  ctx.strokeStyle = `rgba(240,160,30,${a})`;
  ctx.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    const an = r() * Math.PI * 2;
    const r0 = 130 + r() * 40;
    const r1 = r0 + 110 + r() * 60;
    ctx.lineWidth = 3 + r() * 5;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(an) * r0, y + Math.sin(an) * r0);
    ctx.lineTo(x + Math.cos(an) * r1, y + Math.sin(an) * r1);
    ctx.stroke();
  }
  ctx.restore();
}

function inkBall(ctx, x, y, r, trail = [], soft = 2.5) {
  if (trail.length > 1) {
    ctx.save();
    ctx.filter = `blur(${10 * S}px)`;
    ctx.strokeStyle = 'rgba(40,38,38,0.32)';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = r * 2.2;
    ctx.beginPath();
    ctx.moveTo(...trail[0]);
    trail.forEach((p) => ctx.lineTo(...p));
    ctx.stroke();
    ctx.restore();
  }
  ctx.save();
  ctx.filter = `blur(${soft * S}px)`;
  ctx.fillStyle = '#0c0b0b';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 7);
  ctx.fill();
  ctx.restore();
}

// Perspective ring fitted to the source (frame 167): centre, radii, depth k; icons scale with depth.
const RING_BASE = { clapper: 173, skateboard: 190, vinyl: 224, book: 214, camera: 230, cat: 176, coin: 166, controller: 220, cap: 182, heart: 205, cash: 215, plant: 168 };
const RING_ROT = { skateboard: -0.45, cash: 0.42 };
const ringSpin = (t) =>
  kf(t, [
    [6.38, -0.6],
    [6.548, 0.55, 'linear'],
    [6.673, 1.571, 'linear'],
    [6.756, 2.23, 'linear'],
    [6.84, 2.62, 'outQuad'],
    [6.965, 2.788, 'linear'],
    [7.17, 2.95, 'linear'],
    [7.76, 3.2, 'linear'],
    [8.13, 3.67, 'inQuad'],
    [8.175, 4.03, 'linear'],
    [8.217, 4.4, 'linear'],
    [8.258, 4.82, 'linear'],
    [8.3, 5.22, 'linear'],
  ]);
function ring2(t) {
  const base = ringSpin(t);
  const cx = kf(t, [[6.548, 700], [6.965, 709]]);
  const cy = kf(t, [[6.548, 470], [6.756, 425], [6.965, 402], [7.76, 402], [8.13, 400], [8.217, 440], [8.3, 465]]);
  const R = kf(t, [[6.548, 470], [6.965, 433], [7.76, 433], [8.13, 480]]);
  const Ry = kf(t, [[6.965, 190], [7.76, 195], [8.13, 140], [8.217, 72], [8.3, 50]]);
  const grow = kf(t, [[8.13, 1], [8.258, 1.12]]);
  const k = 0.495;
  return RING.map((name, i) => {
    const a = base + (i * Math.PI) / 6;
    const s = 1 / (1 - k * Math.sin(a));
    return { name, i, x: cx + R * Math.cos(a) * s, y: cy + Ry * Math.sin(a) * s, s, w: 1.25 * grow * RING_BASE[name] * Math.pow(s, 0.8) };
  });
}
const ring2Pos = (t, name) => {
  const it = ring2(t).find((o) => o.name === name);
  return [it.x, it.y];
};
const HITS2 = [
  [7.132, 'cap'],
  [7.341, 'heart'],
  [7.549, 'cash'],
  [7.799, 'plant'],
];

function drawRing2(x, t, tint = null) {
  const hitAmt = (name) => {
    let a = 0;
    HITS2.forEach(([ht, n]) => {
      if (n === name && t > ht - 0.02) a = Math.max(a, 1 - (t - ht) / 0.19);
    });
    return clamp(a);
  };
  ring2(t)
    .sort((a, b) => a.s - b.s)
    .forEach((it) => {
      const rot = noise1(t * 2 + it.i, it.i) * 0.04 + (RING_ROT[it.name] || 0);
      drawSprite(x, it.name, it.x, it.y, it.w, rot);
      const hit = tint ? 0 : hitAmt(it.name);
      if (hit > 0) drawSprite(x, it.name, it.x, it.y, it.w, rot, hit * 0.75, { silhouette: '#f0a030' });
    });
}

// soft, sprayed ink blob
function inkBlob(ctx, x, y, rx, ry, rot = 0, soft = 3) {
  ctx.save();
  ctx.filter = `blur(${soft * S}px)`;
  ctx.fillStyle = '#0e0c0c';
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, 7);
  ctx.fill();
  ctx.restore();
}
function inkTrail(ctx, pts, lw, alpha = 0.55, blur = 10) {
  ctx.save();
  ctx.filter = `blur(${blur * S}px)`;
  fx.strokePartial(ctx, smoothPts(pts, 8), 0, 1, lw, `rgba(40,36,36,${alpha})`, false);
  ctx.restore();
}
function inkStroke(ctx, pts, lw) {
  ctx.save();
  ctx.filter = `blur(${1.5 * S}px)`;
  fx.strokePartial(ctx, smoothPts(pts, 8), 0, 1, lw, '#0e0c0c');
  ctx.restore();
}
function spikes(ctx, x, y, seed, n = 6, col = '#e8a020') {
  const r = rng(seed);
  ctx.save();
  ctx.fillStyle = col;
  for (let i = 0; i < n; i++) {
    const an = r() * Math.PI * 2;
    const d0 = 90 + r() * 60;
    const d1 = d0 + 50 + r() * 90;
    const wd = 4 + r() * 5;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(an) * d0 + Math.cos(an + 1.57) * wd, y + Math.sin(an) * d0 + Math.sin(an + 1.57) * wd);
    ctx.lineTo(x + Math.cos(an) * d1, y + Math.sin(an) * d1);
    ctx.lineTo(x + Math.cos(an) * d0 - Math.cos(an + 1.57) * wd, y + Math.sin(an) * d0 - Math.sin(an + 1.57) * wd);
    ctx.fill();
  }
  ctx.restore();
}

// Depth-pass arrival (frames 154-156): the ring as smooth depth-shaded silhouettes at a coarse
// mosaic, coloured thermal on dark (154-155), then a grey ramp on light grey (156).
const ARRIVE_BOX = { 154: [260, 427, 1180, 980], 155: [214, 360, 1271, 980], 156: [146, 292, 1305, 900] };
function depthRing(ctx, t, fr) {
  const items = ring2(t);
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  items.forEach((it) => {
    x0 = Math.min(x0, it.x - it.w / 2); x1 = Math.max(x1, it.x + it.w / 2);
    y0 = Math.min(y0, it.y - it.w * 0.38); y1 = Math.max(y1, it.y + it.w * 0.38);
  });
  const [bx0, by0, bx1, by1] = ARRIVE_BOX[fr];
  const sxk = (bx1 - bx0) / (x1 - x0);
  const syk = (by1 - by0) / (y1 - y0);
  const smin = Math.min(...items.map((it) => it.s));
  const smax = Math.max(...items.map((it) => it.s));
  const L = createCanvas(W, H);
  const lx = L.getContext('2d');
  const near = items.reduce((a, b) => (b.s > a.s ? b : a));
  items
    .slice()
    .sort((a, b) => a.s - b.s)
    .forEach((it) => {
      const v = (it.s - smin) / (smax - smin || 1);
      const px = bx0 + (it.x - x0) * sxk;
      const py = by0 + (it.y - y0) * syk;
      const w = it.w * (sxk + syk) * 0.5 * 1.3;
      // grey = depth; a soft dome of extra light inside each shape
      const g = Math.round(40 + v * 190);
      const tmp = createCanvas(W, H);
      const tx = tmp.getContext('2d');
      drawSprite(tx, it.name, px, py, w, RING_ROT[it.name] || 0, 1, { silhouette: `rgb(${g},${g},${g})` });
      tx.globalCompositeOperation = 'source-atop';
      const rg = tx.createRadialGradient(px - w * 0.1, py - w * 0.15, 0, px, py, w * 0.6);
      rg.addColorStop(0, 'rgba(255,255,255,0.16)');
      rg.addColorStop(1, 'rgba(0,0,0,0.12)');
      tx.fillStyle = rg;
      tx.fillRect(0, 0, W, H);
      lx.filter = 'blur(5px)';
      lx.drawImage(tmp, 0, 0);
      lx.filter = 'none';
      if (it === near) near.px = [px, py, w];
    });
  // coarse mosaic, then colour by depth
  const block = 12;
  const sw = Math.round(W / block);
  const sh = Math.round(H / block);
  const sm = createCanvas(sw, sh);
  const smx = sm.getContext('2d');
  smx.drawImage(L, 0, 0, sw, sh);
  const id = smx.getImageData(0, 0, sw, sh);
  const d = id.data;
  const thermalPass = fr < 156;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    if (a < 0.45) { d[i + 3] = 0; continue; }
    const v = clamp((d[i] - 40) / 190);
    if (thermalPass) {
      const k = Math.min(255, Math.round((0.03 + 0.95 * Math.pow(v, 1.9)) * 255)) * 3;
      d[i] = ironLut[k]; d[i + 1] = ironLut[k + 1]; d[i + 2] = ironLut[k + 2];
      d[i + 3] = Math.round(255 * (0.55 + 0.45 * v));
    } else {
      const gv = Math.round(lerp(0x8e, 0x4a, v));
      d[i] = gv; d[i + 1] = gv - 4; d[i + 2] = gv - 2;
      d[i + 3] = 255;
    }
  }
  smx.putImageData(id, 0, 0);
  // background
  if (fr === 154) {
    ctx.fillStyle = '#2b2a2a';
    ctx.fillRect(0, 0, W, H);
  } else if (fr === 155) {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#4c4848');
    bg.addColorStop(1, '#575557');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = '#9a9898';
    ctx.fillRect(0, 0, W, H);
  }
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.filter = `blur(${1.2 * S}px)`;
  ctx.drawImage(sm, 0, 0, W, H);
  ctx.restore();
  if (fr === 156 && near.px) {
    // the nearest item renders dark maroon, with a small yellow triangle low in its centre
    const [px, py, w] = near.px;
    const nc = createCanvas(W, H);
    const nx = nc.getContext('2d');
    drawSprite(nx, near.name, px, py, w, RING_ROT[near.name] || 0, 1, { silhouette: '#3a1a1c' });
    const ns = createCanvas(sw, sh);
    const nsx = ns.getContext('2d');
    nsx.drawImage(nc, 0, 0, sw, sh);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.filter = `blur(${1.2 * S}px)`;
    ctx.drawImage(ns, 0, 0, W, H);
    ctx.filter = 'none';
    ctx.fillStyle = '#857a26';
    ctx.beginPath();
    ctx.moveTo(px - w * 0.09, py + w * 0.1);
    ctx.lineTo(px + w * 0.09, py + w * 0.1);
    ctx.lineTo(px, py + w * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

// frame 153: the first, heavily blurred depth blob low in the frame (bright capsule in front)
function depthBlob(ctx) {
  ctx.fillStyle = '#131313';
  ctx.fillRect(0, 0, W, H);
  const [c, x] = off(0);
  x.fillStyle = 'rgba(70,20,20,0.85)';
  x.beginPath();
  x.arc(560, 920, 165, 0, 7);
  x.fill();
  x.fillStyle = 'rgba(58,18,18,0.85)';
  x.fillRect(720, 720, 270, 300);
  x.fillStyle = 'rgba(150,30,20,0.8)';
  x.fillRect(880, 900, 40, 60);
  x.fillRect(640, 1000, 50, 60);
  // capsule: red rim, orange body, cream core
  x.save();
  x.translate(690, 925);
  x.rotate(-0.42);
  [[205, 62, '#c43414'], [190, 50, '#f0a040'], [160, 34, '#fbe8bc']].forEach(([hw, hh, col]) => {
    x.fillStyle = col;
    x.beginPath();
    x.ellipse(0, 0, hw, hh, 0, 0, 7);
    x.fill();
  });
  x.restore();
  composite(ctx, c, { blur: 3 });
}

// frames 157-166: the ink ball inside the ring (comma crescent, comet, then a fuzzy donut)
const BALL_EARLY = {
  159: [717, 413, 40, 36], 160: [710, 413, 40, 40], 161: [710, 420, 34, 30], 162: [730, 413, 34, 30],
  163: [717, 413, 42, 36], 164: [710, 420, 32, 32], 165: [716, 426, 26, 25], 166: [713, 425, 24, 24],
};
function inkDonut(x, cx, cy, rx, ry) {
  x.save();
  x.filter = `blur(${2.5 * S}px)`;
  x.fillStyle = '#0d0b0b';
  x.beginPath();
  x.ellipse(cx, cy, rx, ry, 0, 0, 7);
  x.fill();
  x.filter = `blur(${3 * S}px)`;
  x.fillStyle = 'rgba(70,64,64,0.55)';
  x.beginPath();
  x.ellipse(cx + rx * 0.05, cy - ry * 0.05, rx * 0.38, ry * 0.36, 0, 0, 7);
  x.fill();
  x.restore();
}
// tapered ink crescent through points (radius r0 -> peak -> r1)
function inkCrescent(x, pts, r0, rm, r1, soft = 2) {
  const sp = smoothPts(pts, 10);
  x.save();
  x.filter = `blur(${soft * S}px)`;
  x.fillStyle = '#0d0b0b';
  x.beginPath();
  sp.forEach(([a, b], i) => {
    const u = i / (sp.length - 1);
    const r = u < 0.5 ? lerp(r0, rm, u * 2) : lerp(rm, r1, (u - 0.5) * 2);
    x.moveTo(a + r, b);
    x.arc(a, b, r, 0, 7);
  });
  x.fill();
  x.restore();
}
function inkBallEarly(x, fr) {
  if (fr === 157) {
    // thick comma: round head upper right, tail sweeping down-left
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const u = i / 24;
      pts.push([lerp(786, 668, u) + Math.sin(u * Math.PI) * 26, lerp(388, 506, u) + Math.sin(u * Math.PI) * 18]);
    }
    x.save();
    x.filter = `blur(${2 * S}px)`;
    x.fillStyle = '#0d0b0b';
    x.beginPath();
    pts.forEach(([a, b], i) => {
      const r = lerp(30, 5, i / 24);
      x.moveTo(a + r, b);
      x.arc(a, b, r, 0, 7);
    });
    x.fill();
    x.restore();
  } else if (fr === 158) {
    inkDonut(x, 730, 413, 52, 33);
    x.save();
    x.filter = `blur(${2 * S}px)`;
    fx.strokePartial(x, [[770, 400], [800, 392], [826, 388]], 0, 1, 10, '#0d0b0b');
    x.restore();
  } else if (BALL_EARLY[fr]) inkDonut(x, ...BALL_EARLY[fr]);
}

function sceneRing(ctx, t, f) {
  const fr = Math.round(t * C.FPS);
  // frame 151: grey zoom, dark top left to light bottom right, a dark dome rising at the bottom
  if (t < 6.32) {
    const g = ctx.createLinearGradient(0, 0, 600, 1272);
    [[0, '#141414'], [0.3375, '#555556'], [0.466, '#79797a'], [0.594, '#9c9c9b'], [0.723, '#b8b8b8'], [0.833, '#cccece'], [1, '#dfe1e3']].forEach(([o, col]) => g.addColorStop(o, col));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.filter = `blur(${6 * S}px)`;
    ctx.fillStyle = '#5e6062';
    ctx.beginPath();
    ctx.ellipse(1098, 1080, 165, 112, 0, 0, 7);
    ctx.fill();
    ctx.restore();
    return;
  }
  // frame 152: fire band rising from the bottom (measured stops)
  if (t < 6.36) {
    ctx.fillStyle = '#141414';
    ctx.fillRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, 450, 0, 1065);
    [[0, '#161615'], [0.163, '#1d1616'], [0.325, '#3a1115'], [0.488, '#550e16'], [0.65, '#8b0716'], [0.813, '#c83617'], [0.9, '#d98a3a'], [0.976, '#e0d59d'], [1, '#e6dcaa']].forEach(([o, col]) => g.addColorStop(o, col));
    ctx.fillStyle = g;
    ctx.fillRect(0, 450, W, H - 450);
    return;
  }
  if (fr === 153) return depthBlob(ctx);
  if (t < 6.52) return depthRing(ctx, t, fr);

  flat(ctx, '#e4e3e3', 'rgba(80,76,74,0.14)', W, H);
  // push in on the controller and coin at the end
  // the end is a whip of the ring itself (front icons swell with perspective), not a camera push
  const zoom = 1;
  const [sx, sy] = shake(t, 3, 0.8, 33);
  const [c, x] = off(0);
  x.save();
  camera(x, { x: sx, y: sy, z: zoom, cx: 1040, cy: 560 });
  drawRing2(x, t);
  inkBallEarly(x, fr);

  // hits: orange glow, sparks and a splat of ink on the struck icon
  HITS2.forEach(([ht, n], k2) => {
    const a = 1 - (t - ht) / 0.12;
    if (t < ht - 0.02 || a <= 0) return;
    const [px, py] = ring2Pos(ht, n);
    const g = x.createRadialGradient(px, py, 0, px, py, 220);
    g.addColorStop(0, `rgba(255,170,50,${0.75 * a})`);
    g.addColorStop(1, 'rgba(255,160,50,0)');
    x.fillStyle = g;
    x.fillRect(px - 240, py - 240, 480, 480);
    if (t < ht + 0.065) spikes(x, px, py, k2 * 7 + 3, 6, n === 'cash' ? '#141010' : '#e8a020');
  });
  const hitPos = (n) => ring2Pos(HITS2.find((h) => h[1] === n)[0], n);

  // the ink ball, frame by frame as in the source
  if (fr === 167) inkCrescent(x, [[732, 412], [724, 450], [690, 476], [660, 484]], 18, 16, 4);
  if (fr === 168) inkCrescent(x, [[642, 420], [668, 480], [712, 500], [752, 474], [778, 436]], 6, 22, 5);
  if (fr === 169) {
    inkTrail(x, [[770, 100], [860, 40], [960, 0]], 30, 0.35, 12);
    inkCrescent(x, [[772, 96], [722, 200], [712, 330], [740, 450], [800, 505], [886, 512]], 7, 24, 8, 2.5);
  }
  if (fr === 170) {
    inkTrail(x, [[630, 202], [700, 140], [855, 112], [980, 220], [1060, 430]], 26, 0.5, 8);
    inkStroke(x, [[980, 300], [1040, 400], [1070, 470]], 18);
  }
  if (fr === 171) {
    const [px, py] = hitPos('cap');
    inkStroke(x, [[px - 110, py - 40], [px - 60, py - 10], [px - 20, py + 5]], 30);
  }
  if (fr === 172) {
    // a hollow grey ring left behind at top left, and a long grey trail down to the cap
    x.save();
    x.filter = `blur(${3 * S}px)`;
    x.strokeStyle = 'rgba(60,56,56,0.75)';
    x.lineWidth = 12;
    x.beginPath();
    x.arc(502, 182, 20, 0, 7);
    x.stroke();
    x.restore();
    inkTrail(x, [[520, 220], [640, 335], [800, 430], [960, 482], [1050, 505]], 22, 0.55, 7);
    inkCrescent(x, [[960, 492], [1010, 506], [1062, 512]], 4, 10, 6, 2);
  }
  if (fr === 173) inkBlob(x, 678, 111, 60, 46, 0.2, 4);
  if (fr === 174) inkBlob(x, 729, 109, 44, 38, 0, 4);
  if (fr === 175) {
    inkTrail(x, [[800, 160], [806, 450], [810, 760]], 30, 0.45, 14);
    inkStroke(x, [[787, 90], [800, 140], [810, 200]], 26);
  }
  if (fr === 176) {
    const [px, py] = hitPos('heart');
    const pts = [];
    for (let i = 0; i <= 30; i++) pts.push([px - 150 + i * 10, py - 150 + Math.sin(i * 0.6) * 16]);
    inkStroke(x, pts, 40);
  }
  if (fr === 177) {
    const [px, py] = hitPos('heart');
    inkTrail(x, [[180, 90], [450, 330], [px, py - 60]], 30, 0.5, 10);
    inkStroke(x, [[px - 60, py - 140], [px - 20, py - 90]], 10);
  }
  if (fr === 178) inkBlob(x, 367, 107, 76, 40, 0.1, 4);
  if (fr === 179) inkBlob(x, 425, 94, 62, 44, 0.2, 4);
  if (fr === 180) {
    inkTrail(x, [[607, 90], [520, 200], [450, 400], [400, 520]], 28, 0.5, 10);
    inkStroke(x, [[560, 120], [500, 220], [470, 300]], 14);
  }
  if (fr === 181) {
    const [px, py] = hitPos('cash');
    inkBlob(x, px - 20, py - 20, 34, 26, 0.3, 3);
  }
  if (fr === 182) {
    const [px, py] = hitPos('cash');
    inkTrail(x, [[px, py - 30], [px + 120, py - 200], [px + 200, py - 320]], 24, 0.45, 10);
    inkStroke(x, [[px + 40, py - 60], [px + 110, py - 180]], 10);
  }
  if (fr === 183) inkBlob(x, 1049, 134, 66, 48, 0.3, 4);
  if (fr === 184) inkBlob(x, 1073, 166, 36, 35, 0.3, 4);
  if (fr === 185) inkBlob(x, 1055, 177, 38, 46, 0.3, 4);
  if (fr === 186) {
    inkTrail(x, [[1046, 180], [800, 300], [600, 380], [405, 450]], 30, 0.45, 12);
    inkStroke(x, [[1040, 130], [1050, 180], [1040, 230]], 22);
  }
  if (fr === 187) {
    const [px, py] = hitPos('plant');
    inkBlob(x, px + 30, py - 10, 34, 40, 0.2, 3);
  }
  if (fr === 188) {
    const [px, py] = hitPos('plant');
    inkTrail(x, [[px + 40, py - 20], [px + 300, py - 120], [px + 420, py - 100]], 26, 0.45, 10);
    inkStroke(x, [[px + 60, py - 40], [px + 120, py - 140]], 10);
  }
  if (fr === 189) {
    inkTrail(x, [[560, 470], [720, 495]], 20, 0.4, 8);
    inkBlob(x, 720, 495, 20, 20, 0, 2);
  }
  if (fr === 190) inkBlob(x, 720, 495, 22, 22, 0, 2);
  if (fr >= 191 && fr <= 195) {
    const r = lerp(28, 66, (fr - 191) / 4);
    inkBlob(x, lerp(675, 675, (fr - 191) / 4), lerp(450, 495, (fr - 191) / 4), r, r, 0, 4);
  }
  if (fr >= 196) inkBlob(x, 900, 450, 70, 70, 0, 6);
  x.restore();
  composite(ctx, c);
}

// =====================================================================
// 6. Word cards: action. / intention. / curiosity. (dark)
// =====================================================================
function typed(ctx, word, t0, t, x, y, curX, hold = 0, soft = 0) {
  if (t < t0) return;
  const wFull = fx.measure(ctx, word, CARD);
  if (t < t0 + 0.05) {
    // solid white selection block first
    ctx.fillStyle = CREAM;
    ctx.fillRect(x - 96, y - 45, wFull + 70, 90);
    return;
  }
  const p = inv(t0 + 0.05 + hold, t0 + 0.16 + hold, t);
  const slide = 36 * (1 - ease.outCubic(inv(t0 + 0.05, t0 + 0.3 + hold, t)));
  x -= slide;
  curX -= slide * 0.3;
  fx.text(ctx, word, x, y, CARD, CREAM, { blur: (p < 0.3 && !hold ? 2.5 : 0.8) + soft, glow: 'rgba(243,239,232,0.35)', glowBlur: 6 });
  // trailing block shrinks into the caret, which stays bright
  // block collapses to a fat caret, holds, then thins
  const cw = lerp(lerp(120, 30, ease.outCubic(p)), 12, ease.inOutQuad(inv(t0 + 0.32 + hold, t0 + 0.55 + hold, t)));
  const cx = lerp(x + wFull + (hold ? 30 : 70), curX - 6, ease.outCubic(p));
  ctx.fillStyle = CREAM;
  ctx.fillRect(cx, y - 45, cw, 90);
}

function sparks(ctx, t, seed, n = 6, color = '#e52a20') {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const x = r() * W;
    const y = r() * H;
    const ph = r();
    if (Math.sin((t * 3 + ph) * Math.PI) <= 0.2) continue;
    dot(ctx, x + noise1(t * 2, i) * 20, y + noise1(t * 2, i + 4) * 20, 2.5 + r() * 2, i % 3 === 0 ? 'rgba(240,236,230,0.8)' : color);
  }
}

function burst(ctx, cx, cy, q, seed, colors = ['#ece8e2', '#e8231d']) {
  const r = rng(seed);
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < 9; i++) {
    const an = r() * Math.PI * 2;
    const d0 = 120 + r() * 120 + q * 260;
    const len = 50 + r() * 140;
    ctx.strokeStyle = colors[i % colors.length];
    ctx.globalAlpha = 1 - q;
    ctx.lineWidth = 2 + r() * 6;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(an) * d0, cy + Math.sin(an) * d0);
    ctx.lineTo(cx + Math.cos(an) * (d0 + len), cy + Math.sin(an) * (d0 + len));
    ctx.stroke();
  }
  ctx.restore();
}

function sceneAction(ctx, t, f) {
  fx.dark(ctx, '#141313');
  const pos = kf(t, [[8.3, [575, 520]], [8.342, [567, 513]], [8.383, [553, 540]], [8.425, [540, 540]], [8.467, [527, 527]], [8.655, [513, 527]], [8.675, [527, 473], 'inOutCubic'], [8.895, [520, 473]], [8.915, [486, 513], 'inOutCubic'], [9.05, [478, 552]], [9.0924, [405, 575], 'inQuad'], [9.13, [400, 580]]]);
  const rot = kf(t, [[8.3, -0.12], [8.383, -0.15], [8.655, -0.2], [8.675, -1.29, 'inOutCubic'], [8.895, -1.29], [8.915, -0.18, 'inOutCubic'], [9.05, -0.19], [9.0924, -0.28, 'inQuad'], [9.13, -0.3]]);
  const width = kf(t, [[8.3, 392], [8.655, 400], [8.675, 680, 'inOutCubic'], [8.895, 680], [8.915, 880, 'inOutCubic'], [9.13, 860]]);
  const sy = kf(t, [[8.3, 1], [8.655, 1], [8.675, 0.78], [8.895, 0.78], [8.915, 0.24, 'inOutCubic'], [9.13, 0.22]]);
  const blur = kf(t, [[8.3, 3], [8.36, 1.5], [8.383, 0.5], [8.405, 6], [8.425, 9], [8.467, 8], [8.5, 4], [8.55, 0.5], [8.59, 1], [8.63, 0], [8.65, 3], [8.675, 0], [8.893, 0], [8.905, 3], [8.915, 0]]);
  const [c, x] = off(0);
  x.save();
  x.filter = 'saturate(0.8)';
  drawSprite(x, 'camera', pos[0], pos[1], width, rot, 1, { sy });
  x.restore();
  const st = kf(t, [[8.3, 0.9], [8.4, 0.85], [8.655, 0.85], [8.675, 2.0, 'outCubic'], [8.895, 2.0], [8.915, 1.3], [9.13, 1.1]]);
  const sxs = kf(t, [[8.655, 1], [8.675, 0.36, 'outCubic'], [8.895, 0.36], [8.915, 2.0, 'outCubic'], [9.13, 2.0]]);
  const ysq = kf(t, [[8.895, 1], [8.915, 0.62]]);
  x.save();
  const anchor = kf(t, [[8.3, [634, 405]], [8.383, [648, 330]], [8.655, [590, 350]], [8.675, [540, 230], 'inOutCubic'], [8.895, [540, 230]], [8.915, [880, 345], 'inOutCubic'], [9.0, [900, 315]], [9.05, [898, 312]], [9.0924, [510, 225], 'inQuad'], [9.13, [480, 215]]]);
  x.translate(anchor[0], anchor[1]);
  x.rotate(kf(t, [[8.3, 0.3], [8.6, 0.1], [8.75, 0], [8.915, -0.3], [9.05, -0.3], [9.0924, -0.5, 'inQuad'], [9.13, -0.55]]));
  x.scale(sxs, ysq / Math.sqrt(sxs));
  fx.starPath(x, 0, 0, 170 * st, 0, 0.1);
  x.fillStyle = '#e8231d';
  x.shadowColor = 'rgba(255,40,30,0.6)';
  x.shadowBlur = 20 * S;
  x.fill();
  x.restore();
  composite(ctx, c, { blur });
  // the cut: a white lightning scribble and thick red dabs, then thin flicks, a curl, drifting red dots
  const dab = (pts, w) => {
    ctx.save();
    ctx.filter = `blur(${2 * S}px)`;
    fx.strokePartial(ctx, pts, 0, 1, w, '#e2211b');
    ctx.restore();
  };
  const white = (pts, w, b = 1.5) => {
    ctx.save();
    ctx.filter = `blur(${b * S}px)`;
    fx.strokePartial(ctx, pts, 0, 1, w, 'rgba(236,232,226,0.9)');
    ctx.restore();
  };
  if (t < 8.362) {
    white([[756, 260], [800, 250], [850, 280], [900, 240], [1000, 262], [930, 330], [860, 430], [800, 560], [780, 640], [840, 700], [930, 740], [975, 790]], 7, 2);
    [[[735, 265], [820, 70]], [[935, 430], [1115, 260]], [[745, 805], [805, 760]], [[965, 650], [1195, 850]]].forEach((p) => dab(p, 16));
  } else if (t < 8.404) {
    white([[742, 256], [891, 40]], 5);
    white([[1148, 270], [1323, 121]], 5);
    white([[1040, 702], [1180, 880], [1269, 1026], [1180, 990]], 5);
    [[[837, 10], [860, 50]], [[1205, 185], [1280, 110]], [[880, 870], [900, 900]], [[1272, 905], [1360, 995]]].forEach((p) => dab(p, 18));
  } else if (t < 8.446) {
    white([[985, 445], [1080, 300], [1150, 200], [1175, 189], [1130, 230]], 6, 3);
  }
  if (t > 8.404 && t < 8.6) {
    const a = 1 - inv(8.5, 8.6, t);
    const d = (t - 8.404) * 60;
    [[1283, 81], [940, 918], [1377, 999]].forEach(([px, py]) => dot(ctx, px + d * 0.2, py + d * 0.4, 10, `rgba(226,33,27,${a})`));
  }
  // white streak above the star as the camera tips away
  if (t > 9.03 && t < 9.072) fx.strokePartial(ctx, [[924, 218], [1005, 214]], 0, 1, 5, CREAM);
  else if (t >= 9.072) fx.strokePartial(ctx, [[690, 228], [945, 222]], 0, 1, 6, CREAM);
  sparks(ctx, t, 2, 7);
  const soft = kf(t, [[8.39, 0], [8.425, 6], [8.467, 5], [8.51, 0]]);
  ctx.save();
  if (soft > 0.3) ctx.filter = `blur(${soft * S}px)`;
  typed(ctx, 'action.', 8.32, t, 966, 530, 1300, 0, soft);
  ctx.restore();
}

// Rows of overlapping icons (light shots between the cards). Items: [name, relX, dy, width, z]
function row(ctx, items, ox, y, t) {
  items
    .slice()
    .sort((a, b) => a[4] - b[4])
    .forEach(([n, rx, dy, w], i) => {
      const px = ox + rx;
      if (px > -400 && px < W + 400) drawSprite(ctx, n, px, y + dy, w, Math.sin(rx * 0.01) * 0.06 + noise1(t * 2, i) * 0.03);
    });
}

function speedLines(ctx, t, seed, n = 8, color = 'rgba(225,40,32,0.85)') {
  const r = rng(seed + Math.floor(t * 24));
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const y = r() * H;
    const x = r() * W;
    const len = 30 + r() * 220;
    ctx.lineWidth = 2 + r() * 3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y - 4 + r() * 8);
    ctx.stroke();
  }
  ctx.restore();
}

const ROW_A = [
  ['plant', 40, -10, 260, 1],
  ['cash', 270, 15, 476, 3],
  ['camera', 450, -60, 280, 0],
  ['heart', 590, 0, 450, 4],
  ['cap', 860, -10, 400, 5],
  ['controller', 1500, 0, 420, 3],
  ['coin', 1820, 0, 360, 4],
  ['cat', 2080, 0, 350, 1],
];

// The light strips are the icon ring seen edge-on and spinning: front items big and packed,
// side items compressed, back items small and higher, peeking out behind.
const BELT = ['plant', 'cash', 'heart', 'cap', 'controller', 'coin', 'cat', 'camera', 'book', 'vinyl', 'skateboard', 'clapper'];
const BELT_W = { plant: 270, cash: 430, heart: 420, cap: 400, controller: 390, coin: 360, cat: 420, camera: 330, book: 330, vinyl: 310, skateboard: 430, clapper: 350 };
const BELT_DY = { plant: -15, cash: 0, heart: 10, cap: 5, controller: 0, coin: 5, cat: 10, camera: -5, book: 0, vinyl: -10, skateboard: 5, clapper: 5 };
const BELT_R = { skateboard: -0.25, cash: 0.12, cap: -0.05 };
function belt(ctx, heartDeg, t) {
  const items = BELT.map((name, i) => {
    const th = ((heartDeg + (i - 2) * 30) * Math.PI) / 180;
    const c = Math.cos(th);
    const sc = c >= 0 ? 1.15 * (0.9 + 0.1 * c) : 0.32 + 0.4 * (1 + c);
    return { name, i, c, x: 735 + 590 * Math.sin(th) * (c >= 0 ? 1 : 0.75), y: 515 + c * 25 + (c < 0 ? -60 * -c : 0) + BELT_DY[name], sc };
  });
  items
    .sort((a, b) => a.c - b.c)
    .forEach((it) => {
      // only the front arc (about +-66 deg) and the back half are visible; the sides are hidden
      if (it.c >= 0 && it.c < 0.4) return;
      if (it.c < 0 && it.c > -0.5) return;
      if (it.x < -300 || it.x > W + 300) return;
      drawSprite(ctx, it.name, it.x, it.y, BELT_W[it.name] * it.sc, (BELT_R[it.name] || 0) + noise1(t * 2, it.i) * 0.03);
    });
}

function sceneStripA(ctx, t, f) {
  flat(ctx, '#e3e2e0', 'rgba(80,76,74,0.15)', W, H);
  const hd = kf(t, [[9.134, 93], [9.259, 41.4, 'outCubic'], [9.426, 19.8], [9.676, -9.2], [9.718, -19.6, 'inQuad'], [9.76, -37.5, 'inQuad'], [9.8, -75], [9.843, -115]]);
  const [c, x] = off(0);
  belt(x, hd, t);
  composite(ctx, c, { blur: kf(t, [[9.13, 3], [9.2, 0], [9.74, 0], [9.8, 6], [9.84, 12]]) });
  if (t > 9.7) speedLines(ctx, t, 7, 8);
}

function sceneIntention(ctx, t, f) {
  fx.dark(ctx, '#141313');
  const [c, x] = off(1);
  // red shapes riding with the book (measured on frames 237-250): a thin tail from the book's
  // lower left to the bottom-left edge, a short flag behind its top (242-246), then a wide band
  // from the book to the top-right corner (247 on)
  const bp = kf(t, [[9.84, [720, 560]], [9.885, [500, 560]], [9.926, [440, 548], 'outCubic'], [10.18, [422, 532]], [10.51, [410, 528]]]);
  const shape = (pts) => {
    x.beginPath();
    pts.forEach(([a, b], i) => (i ? x.lineTo(bp[0] + a, bp[1] + b) : x.moveTo(bp[0] + a, bp[1] + b)));
    x.closePath();
    x.fill();
  };
  x.save();
  x.translate(kf(t, [[9.84, 270], [9.926, 0, 'outCubic']]), kf(t, [[9.84, -40], [9.926, 0]]));
  x.fillStyle = '#e2211b';
  x.shadowColor = 'rgba(255,40,30,0.45)';
  x.shadowBlur = 25 * S;
  shape([[-110, 94], [-340, 200], [-460, 320], [-460, 380], [-310, 240], [-80, 140]]);
  if (t > 10.073 && t < 10.28) shape([[-40, -130], [104, -280], [270, -110], [180, -74]]);
  if (t >= 10.28) shape([[-30, -200], [460, -560], [1100, -560], [1100, -470], [190, -110]]);
  x.shadowBlur = 0;
  x.restore();
  const bw = kf(t, [[9.84, 470], [10.1, 500], [10.51, 520]]);
  if (t < 9.87) x.filter = 'brightness(0.85)';
  drawSprite(x, 'book', bp[0], bp[1], bw, kf(t, [[9.84, -0.25], [10.0, -0.06]]) + noise1(t * 2, 4) * 0.04, 1, { shadow: 'rgba(255,40,30,0.25)', shadowBlur: 30 });
  x.filter = 'none';
  composite(ctx, c, { blur: kf(t, [[9.84, 16], [9.885, 4], [9.926, 0]]) });
  if (t < 9.88) {
    // first frame: grainy dark-red glow over the top left, thin red slashes
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(1250, 0);
    ctx.lineTo(0, 1080);
    ctx.closePath();
    ctx.filter = `blur(${30 * S}px)`;
    ctx.fillStyle = 'rgba(150,22,22,0.45)';
    ctx.fill();
    ctx.filter = 'none';
    ctx.clip();
    fx.grain(ctx, f + 11, 0.7);
    ctx.restore();
    ctx.save();
    ctx.filter = `blur(${3 * S}px)`;
    [[[930, 190], [1070, 90]], [[930, 860], [1190, 790]]].forEach((seg) => fx.strokePartial(ctx, seg, 0, 1, 9, '#e2211b'));
    ctx.restore();
  }
  // thin white scribbles flicking out as the word types
  if (t > 9.865 && t < 10.0) {
    const k = inv(9.865, 10.0, t);
    ctx.save();
    ctx.filter = `blur(${1.5 * S}px)`;
    const sc = [
      [[640, 380], [700, 250], [740, 360], [800, 270], [900, 300], [1150, 250]],
      [[730, 660], [900, 700], [1100, 780], [1340, 830], [1250, 790]],
      [[760, 720], [820, 790], [770, 850], [840, 900]],
    ];
    sc.forEach((pts) => fx.strokePartial(ctx, pts.map(([a, b]) => [a + k * 120, b]), inv(0.35, 1, k), Math.min(1, k * 4), 4, 'rgba(236,232,226,0.85)'));
    ctx.restore();
  }
  sparks(ctx, t, 4, 6);
  typed(ctx, 'intention.', 9.87, t, 834, 530, 1322);
}

const ROW_B = [
  ['heart', -1000, 0, 320, 2],
  ['cap', -700, -10, 330, 3],
  ['controller', -320, 0, 340, 4],
  ['coin', 0, 0, 380, 5],
];

function sceneStripB(ctx, t, f) {
  flat(ctx, '#e3e2e0', 'rgba(80,76,74,0.15)', W, H);
  const hd = kf(t, [[10.51, -13.6], [10.594, -67, 'outQuad'], [10.677, -85, 'outQuad'], [10.76, -92], [10.844, -93.5], [10.9, -97], [10.969, -171, 'inCubic'], [11.01, -215]]);
  const [c, x] = off(0);
  belt(x, hd, t);
  composite(ctx, c, { blur: kf(t, [[10.51, 2], [10.55, 0], [10.9, 0], [10.95, 10], [10.97, 16], [11.01, 22]]) });
  if (t < 10.56 || t > 10.92) speedLines(ctx, t, 9, 4);
}

function note(ctx, kind, x, y, s, rot = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(s, s);
  ctx.fillStyle = '#e2211b';
  ctx.strokeStyle = '#e2211b';
  ctx.shadowColor = 'rgba(255,40,30,0.45)';
  ctx.shadowBlur = 14 * S;
  const head = (hx, hy) => {
    ctx.beginPath();
    ctx.ellipse(hx, hy, 22, 16, -0.4, 0, 7);
    ctx.fill();
  };
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  if (kind === 'beam') {
    head(-30, 50);
    head(40, 40);
    ctx.beginPath();
    ctx.moveTo(-12, 46);
    ctx.lineTo(-8, -60);
    ctx.moveTo(58, 36);
    ctx.lineTo(62, -70);
    ctx.stroke();
    [[-60, -44], [-32, -24]].forEach(([a, b]) => {
      ctx.beginPath();
      ctx.moveTo(-10, a);
      ctx.lineTo(64, a - 12);
      ctx.lineTo(64, b - 12);
      ctx.lineTo(-10, b);
      ctx.closePath();
      ctx.fill();
    });
  } else {
    head(0, 50);
    ctx.beginPath();
    ctx.moveTo(18, 45);
    ctx.lineTo(20, -60);
    ctx.stroke();
    if (kind === 'eighth') {
      ctx.beginPath();
      ctx.moveTo(20, -60);
      ctx.bezierCurveTo(30, -30, 58, -20, 40, 10);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function sceneCuriosity(ctx, t, f) {
  fx.dark(ctx, '#141313');
  if (t > 11.825) {
    // one frame: dim greyscale negative of the icon row before the cut
    fx.dark(ctx, '#121112');
    drawSprite(ctx, 'heart', 750, 555, 430, 0, 1, { silhouette: '#c0c0c0' });
    ctx.save();
    ctx.filter = 'grayscale(1) brightness(0.85)';
    drawSprite(ctx, 'cash', 400, 575, 470, 0);
    ctx.restore();
    ctx.save();
    ctx.filter = 'invert(1) grayscale(1) brightness(0.9)';
    drawSprite(ctx, 'cap', 1110, 545, 470, 0);
    ctx.restore();
    return;
  }
  if (t < 11.032) {
    // frame 264: a grainy crimson ring around the centred record, caret block only
    const [c, x] = off(0);
    drawSprite(x, 'vinyl', 720, 532, 461, -0.15);
    x.fillStyle = CREAM;
    x.fillRect(912, 490, 74, 90);
    x.fillStyle = '#141313';
    x.fillRect(944, 516, 16, 14);
    composite(ctx, c, { blur: 2.5 });
    const r = rng(264);
    ctx.save();
    ctx.filter = `blur(${2 * S}px)`;
    ctx.strokeStyle = 'rgba(130,12,26,0.55)';
    ctx.lineWidth = 30;
    ctx.beginPath();
    ctx.arc(722, 530, 672, 0, 7);
    ctx.stroke();
    ctx.restore();
    // speckle the ring so it reads as grainy spray
    ctx.fillStyle = '#c21a2c';
    for (let i = 0; i < 2600; i++) {
      const a = r() * Math.PI * 2;
      const d = 672 + (r() + r() - 1) * 22;
      ctx.globalAlpha = 0.35 + r() * 0.5;
      ctx.fillRect(722 + Math.cos(a) * d, 530 + Math.sin(a) * d, 3, 3);
    }
    ctx.globalAlpha = 1;
    return;
  }
  if (t < 11.073) {
    // frame 265: record slides left, "curiosi" under a wide selection block, scribbled zigzags
    const [c, x] = off(0);
    drawSprite(x, 'vinyl', 500, 540, 468, 0.1);
    composite(ctx, c, { blur: 1.5 });
    fx.text(ctx, 'curiosity.', 774, 558, CARD, CREAM, { glow: 'rgba(243,239,232,0.35)', glowBlur: 6 });
    ctx.fillStyle = CREAM;
    ctx.fillRect(1034, 486, 326, 98);
    const P = (pts) => pts.map(([a, b]) => [(a - 720) * 2, b * 2]);
    [
      [[1025, 155], [1140, 88], [1092, 168], [1298, 84], [1262, 110]],
      [[1120, 310], [1302, 398], [1160, 402]],
      [[1052, 362], [1068, 390], [1042, 404], [1072, 514], [986, 425]],
      [[1132, 216], [1150, 210], [1162, 222], [1178, 218]],
    ].forEach((pts) => fx.strokePartial(ctx, P(pts), 0, 1, 7, '#ecE8e2', false));
    [
      [[1070, 190], [1285, 140], 11],
      [[1045, 355], [1185, 404], 10],
      [[1104, 286], [1130, 283], 5],
    ].forEach(([a, b, w]) => {
      const [p0, p1] = P([a, b]);
      const mx = (p0[0] + p1[0]) / 2;
      const my = (p0[1] + p1[1]) / 2;
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(Math.atan2(p1[1] - p0[1], p1[0] - p0[0]));
      ctx.fillStyle = '#d8141e';
      ctx.beginPath();
      ctx.ellipse(0, 0, Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / 2, w, 0, 0, 7);
      ctx.fill();
      ctx.restore();
    });
    return;
  }
  const pan = 0;
  ctx.save();
  const vin = ease.outBack(inv(11.01, 11.15, t));
  const vx = kf(t, [[11.01, 500], [11.08, 496], [11.25, 430, 'outCubic'], [11.6, 410], [11.81, 250, 'inQuad']]);
  drawSprite(ctx, 'vinyl', vx, 545, 456 * lerp(0.9, 1, vin), noise1(t, 9) * 0.05 - 1.5 * Math.max(0, t - 11.26));
  if (t < 11.115) {
    const q = inv(11.01, 11.16, t);
    const drift = q * 40;
    [[660, 330, 1050, 150], [720, 300, 940, 210], [900, 765, 1275, 675], [610, 930, 650, 900]].forEach(([a, b, c, d]) => {
      const seg = Array.from({ length: 16 }, (_, i) => [lerp(a, c, i / 15) + drift, lerp(b, d, i / 15)]);
      fx.strokePartial(ctx, seg, 0, 1, 8 * (1 - q * 0.4), '#f4f0ea', true);
    });
    [[1245, 240, -0.4], [1335, 531, 0.2], [1074, 846, 0.6]].forEach(([a, b, r]) => {
      ctx.save();
      ctx.translate(a, b);
      ctx.rotate(r);
      ctx.fillStyle = '#e2211b';
      ctx.beginPath();
      ctx.ellipse(0, 0, 14, 24, 0, 0, 7);
      ctx.fill();
      ctx.restore();
    });
  }
  const pop = (t0) => ease.outBack(inv(t0, t0 + 0.12, t), 2.2);
  const nd = ease.inQuad(inv(11.6, 11.81, t));
  // white pen flick above the text: a loop that tightens to a crescent, then a shrinking tick
  const FL = [
    [11.115, 11.157, 'loop', 945, 215, 62],
    [11.157, 11.199, 'cres', 945, 203, 26],
    [11.199, 11.24, 'tick', 945, 140, 14],
    [11.24, 11.282, 'cres', 900, 138, 12],
    [11.282, 11.365, 'dot', 815, 150, 5],
    [11.45, 11.49, 'arc', 965, 205, 120],
    [11.49, 11.532, 'cres', 1035, 292, 22],
    [11.532, 11.574, 'dot', 990, 315, 4],
  ];
  FL.forEach(([a, b, kind, fx0, fy0, r]) => {
    if (t < a || t >= b) return;
    ctx.save();
    ctx.strokeStyle = '#ece8e2';
    ctx.fillStyle = '#ece8e2';
    ctx.lineCap = 'round';
    ctx.lineWidth = kind === 'arc' ? 3 : 4;
    ctx.beginPath();
    if (kind === 'loop') ctx.ellipse(fx0, fy0, r * 0.55, r * 0.4, -0.5, 0.4, 6.0);
    else if (kind === 'cres') ctx.arc(fx0, fy0, r, 0.3, 2.4);
    else if (kind === 'tick') { ctx.moveTo(fx0, fy0 - r); ctx.quadraticCurveTo(fx0 + r * 0.6, fy0, fx0 + r * 0.2, fy0 + r); }
    else if (kind === 'arc') ctx.arc(fx0, fy0 + r, r, -1.75, 0.35);
    else { ctx.arc(fx0, fy0, r, 0, 7); ctx.fill(); }
    if (kind !== 'dot') ctx.stroke();
    ctx.restore();
  });
  if (t > 11.1) note(ctx, 'quarter', 955 - 130 * nd, 800, pop(11.1) * 1.7, -0.33 - 0.3 * nd + noise1(t, 1) * 0.08);
  if (t > 11.39) note(ctx, 'beam', 710 - 120 * nd, 270 - 30 * nd, pop(11.39) * 1.75, -0.12 - 0.5 * (1 - inv(11.43, 11.47, t)) + 0.6 * nd + noise1(t, 2) * 0.08);
  if (t > 11.57) note(ctx, 'eighth', 630 - 140 * nd, 790, pop(11.57) * 1.9, 0.15 + 0.1 * nd + noise1(t, 3) * 0.08);
  ctx.restore();
  sparks(ctx, t, 6, 5);
  typed(ctx, 'curiosity.', 10.9, t, 804 + pan, 526, 1323 + pan, 0.17);
}

// =====================================================================
// 7. Ring again (top view) then the ink scatter.
// =====================================================================
const TOP_W = { clapper: 225, skateboard: 255, vinyl: 210, book: 210, camera: 210, cat: 200, coin: 235, controller: 235, cap: 235, heart: 285, cash: 290, plant: 210 };
const SCATTER = {
  vinyl: [600, 171, 135, 0],
  clapper: [174, 470, 210, 0],
  skateboard: [450, 489, 160, 1],
  heart: [555, 630, 140, 1],
  book: [714, 429, 130, 1],
  cap: [876, 504, 150, 1],
  camera: [945, 339, 115, 0],
  coin: [1116, 615, 150, 0],
  controller: [1260, 800, 210, 0],
  cash: [300, 960, 210, 1],
  cat: [1080, 735, 180, 0],
  plant: [215, 395, 110, 0],
};
const SIL = { heart: 12.575, skateboard: 12.7 };

// Spray-paint ink blot: soft dense core with a stippled, speckled rim.
function sprayBlob(ctx, cx, cy, r, seed, sy = 1) {
  if (r <= 1) return;
  ctx.save();
  ctx.fillStyle = '#0e0d0d';
  ctx.filter = `blur(${1.5 * S}px)`;
  ctx.beginPath();
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const rr = r * 0.9 * (1 + noise1(a * 3, seed) * 0.1);
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * sy);
  }
  ctx.fill();
  ctx.filter = 'none';
  const g = rng(seed);
  const n = Math.round(r * 5);
  for (let i = 0; i < n; i++) {
    const a = g() * Math.PI * 2;
    const d = r * (0.84 + Math.pow(g(), 2) * 0.24);
    const sz = 1.5 + g() * 3.5;
    ctx.globalAlpha = 0.5 + g() * 0.5;
    ctx.fillRect(cx + Math.cos(a) * d - sz / 2, cy + Math.sin(a) * d * sy - sz / 2, sz, sz);
  }
  ctx.restore();
}

// Calligraphic ink ribbon: a broad nib held at an angle, so width follows the stroke direction.
function ribbon(ctx, pts, p0, p1, w, color = '#1c1414', nib = 0.6) {
  const sm = [];
  // Catmull-Rom densify for smooth curves
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[i];
    const c = pts[i + 1];
    const d = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < 12; k++) {
      const u = k / 12;
      const u2 = u * u;
      const u3 = u2 * u;
      sm.push([0, 1].map((j) => 0.5 * (2 * b[j] + (-a[j] + c[j]) * u + (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * u2 + (-a[j] + 3 * b[j] - 3 * c[j] + d[j]) * u3)));
    }
  }
  sm.push(pts[pts.length - 1]);
  const n = sm.length - 1;
  const i0 = Math.floor(clamp(p0) * n);
  const i1 = Math.ceil(clamp(p1) * n);
  if (i1 - i0 < 2) return;
  const L = [];
  const R = [];
  for (let i = i0; i <= i1; i++) {
    const [x0, y0] = sm[Math.max(i0, i - 1)];
    const [x1, y1] = sm[Math.min(i1, i + 1)];
    const ang = Math.atan2(y1 - y0, x1 - x0);
    const end = Math.min(1, (i - i0) / 6, (i1 - i) / 6);
    const hw = (w / 2) * (0.18 + 0.82 * Math.abs(Math.sin(ang - nib))) * (0.3 + 0.7 * end);
    const nx = -Math.sin(ang);
    const ny = Math.cos(ang);
    L.push([sm[i][0] + nx * hw, sm[i][1] + ny * hw]);
    R.push([sm[i][0] - nx * hw, sm[i][1] - ny * hw]);
  }
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  L.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)));
  R.reverse().forEach(([a, b]) => ctx.lineTo(a, b));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
// [path, t in, t fully drawn, t erase start, t gone]
const RIBBONS = [
  [[[90, 790], [120, 700], [175, 650], [245, 650], [300, 600], [330, 555], [300, 535]], 12.53, 12.57, 12.6, 12.65],
  [[[150, 830], [205, 800], [262, 838], [228, 885], [292, 905], [336, 870]], 12.54, 12.58, 12.6, 12.65],
  [[[140, 290], [175, 225], [215, 240], [240, 170], [300, 120], [345, 140], [300, 190], [262, 150]], 12.77, 12.79, 12.81, 12.84],
  [[[745, 285], [770, 180], [800, 95], [860, 70], [905, 110], [880, 180], [810, 230]], 12.77, 12.79, 12.81, 12.84],
  [[[1300, 470], [1350, 520], [1320, 570], [1380, 610], [1350, 650]], 12.98, 13.0, 13.05, 13.09],
  [[[890, 1010], [940, 960], [980, 1010], [1030, 955], [1070, 1010], [1105, 965]], 12.98, 13.0, 13.05, 13.09],
  [[[60, 690], [120, 640], [200, 620], [255, 640], [220, 660]], 13.22, 13.25, 13.29, 13.33],
  [[[100, 870], [55, 900], [50, 950], [90, 960]], 13.22, 13.25, 13.29, 13.33],
  [[[520, 1040], [490, 960], [550, 900], [640, 920], [610, 990], [560, 960], [620, 940], [675, 1040]], 13.22, 13.25, 13.29, 13.33],
];

// Grey motion trail of the ink ball: a broad soft arc that sweeps in and fades.
function inkArc(ctx, pts, t, s, d, w = 34) {
  if (t < s || t > s + d) return;
  const k = inv(s, s + d, t);
  ctx.save();
  ctx.filter = `blur(${7 * S}px)`;
  ctx.globalAlpha = Math.sin(Math.PI * k) * 0.75;
  fx.strokePartial(ctx, pts, Math.max(0, k * 1.6 - 0.6), Math.min(1, k * 2), w, 'rgba(40,38,38,0.85)', true);
  ctx.restore();
}
const arcPts = (cx, cy, rx, ry, a0, a1, rot = 0) =>
  Array.from({ length: 40 }, (_, i) => {
    const a = lerp(a0, a1, i / 39);
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    return [cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)];
  });

function sceneScatter(ctx, t, f) {
  ctx.fillStyle = '#ededed';
  ctx.fillRect(0, 0, W, H);
  const spin = inv(11.85, 12.03, t);
  const phi = kf(t, [[11.85, -1.9], [11.887, -1.55], [11.928, -0.85], [11.97, -0.35], [12.012, -0.1], [12.054, 0], [12.25, 0.26, 'linear'], [12.388, 0.36, 'linear'], [12.45, 0.75, 'inQuad'], [12.49, 1.9, 'inQuad']]);
  const burstP = ease.inOutCubic(inv(12.49, 12.555, t));
  const z = kf(t, [[12.6, 1], [13.47, 0.95, 'linear'], [13.68, 0.88, 'inQuad'], [13.722, 0.7], [13.76, 0.62]]);
  const turn = kf(t, [[12.6, 0], [13.47, 0.21, 'linear'], [13.68, 0.65, 'inQuad'], [13.722, 1.0, 'inQuad'], [13.76, 1.3]]);
  const [c, x] = off(0);
  x.save();
  // zoom compresses positions only; the icons keep their size
  camera(x, { cx: 700, cy: 560, x: kf(t, [[12.25, 0], [12.4, 30]]) });
  let heartAt = null;
  // the layout orbits clockwise about (700, 560); icons themselves stay upright
  const ca = Math.cos(turn);
  const sa = Math.sin(turn);
  const orbit = (px, py) => [700 + z * ((px - 700) * ca - (py - 560) * sa), 560 + z * ((px - 700) * sa + (py - 560) * ca)];
  const ring = ringLayout(phi - 0.21, { tilt: 0.4, R: 385, cx: 715, cy: 511, F: 4000, xs: 0.9 });
  const RING_ROT = { skateboard: -0.5, cash: 0.4, cap: -0.15, book: 0.12 };
  ring
    .slice()
    .sort((a, b) => (burstP > 0.5 ? (a.name === 'plant' ? -1 : b.name === 'plant' ? 1 : b.z - a.z) : b.z - a.z))
    .forEach((it) => {
      if (it.name === 'cat' && t > 12.53) return; // cat is reborn from the ink blot
      if (it.name === 'coin' && t > 12.92) return; // coin turns into the blot
      const tgt = SCATTER[it.name];
      let px = lerp(it.x, tgt[0], burstP);
      let py = lerp(it.y, tgt[1], burstP);
      if (it.name === 'controller') {
        const m = kf(t, [[13.4, [0, 0]], [13.68, [-60, -60]]]);
        px += m[0];
        py += m[1];
      }
      if (it.name === 'plant') {
        // tucked behind the clapper, then slides out to its left
        const m = kf(t, [[13.5, [0, 0]], [13.68, [-120, -10]]]);
        px += m[0];
        py += m[1];
      }
      [px, py] = orbit(px, py);
      if (it.name === 'cap') {
        // the cap creeps in toward the heart
        const m = kf(t, [[12.6, [0, 0]], [13.26, [-87, -27]], [13.47, [-127, -27]], [13.55, [-181, -27]], [13.6, [-208, -41]], [13.68, [-262, -108]], [13.76, [-300, -160]]]);
        px += m[0];
        py += m[1];
      }
      const w = lerp(TOP_W[it.name], tgt[2], burstP);
      const sil = SIL[it.name] && t > SIL[it.name];
      const r = burstP * tgt[3] * noise1(t * 1.5 + it.i, it.i) * 0.45 + (1 - burstP) * (RING_ROT[it.name] || 0);
      if (it.name === 'cash' && t > 13.2) {
        // money smears into a black dab
        const q = inv(13.2, 13.35, t);
        x.save();
        x.filter = `blur(${3 * S}px)`;
        const dab = orbit(...kf(t, [[13.2, [250, 895]], [13.76, [250, 895]]]));
        drawSprite(x, 'cash', lerp(px, dab[0], q), lerp(py, dab[1], q), w * lerp(1, 1.0, q), lerp(r, -0.3, q), 1, { silhouette: '#121010' });
        x.restore();
        return;
      }
      if (it.name === 'heart' && t > 13.4) {
        heartAt = [px, py, w, r];
        return; // drawn last, over the text
      }
      drawSprite(x, it.name, px, py, w, r, 1, sil ? { silhouette: '#121010' } : {});
    });
  if (t < 12.45) {
    const keys = [[11.85, [1300, 560]], [11.887, [664, 564]], [11.928, [330, 650]], [11.97, [240, 760]], [12.012, [460, 290]], [12.054, [700, 500]], [12.095, [697, 480]], [12.25, [730, 520]], [12.45, [750, 545]]];
    if (t < 12.075) {
      const trail = [];
      for (let i = 0; i <= 12; i++) trail.push(kf(Math.max(11.85, t - i * 0.006), keys));
      inkBall(x, trail[0][0], trail[0][1], 50, trail, 15);
    } else {
      // once parked the ball is a crisp ink drop with a sprayed rim
      const [bx, by] = kf(t, keys);
      x.save();
      if (t > 12.11) x.filter = `blur(${2 * S}px)`;
      sprayBlob(x, bx, by, t < 12.11 ? 54 : 40, 3, 0.95);
      x.restore();
    }
  }
  if (t > 12.93) {
    // the blot drops from the top right onto the coin and swallows it
    const br = kf(t, [[12.93, 30], [13.0, 78, 'outBack'], [13.76, 84]]);
    const by = kf(t, [[12.93, 420], [12.99, 600, 'inQuad']]);
    if (t < 13.0) {
      x.save();
      x.filter = `blur(${8 * S}px)`;
      fx.strokePartial(x, [[1140, 170], [1120, 300], [1100, by]], 0, 1, 50, 'rgba(20,18,18,0.8)');
      x.restore();
    }
    const [bx, bby] = t < 13.0 ? [1100, by] : orbit(1100, 600);
    sprayBlob(x, bx, bby, br, 7, 1.1);
    if (t > 13.33) {
      x.save();
      x.beginPath();
      x.rect(bx - 120, bby - 160, 300, 180);
      x.clip();
      drawSprite(x, 'cat', bx + 30, bby, lerp(120, 190, ease.outBack(inv(13.33, 13.5, t))), 0, 1, { silhouette: '#0e0d0d' });
      x.restore();
    }
  }
  if (t > 12.4) {
    // thick calligraphic swirls and grey brush strokes
    [].forEach(([k, s, d, ox, oy, len, curl, ink]) => {
      if (t < s || t > s + d + 0.2) return;
      const pts = fx.wanderPoints(200 + k, len, curl, 80).map(([a, b]) => [a * (ink ? 0.7 : 1) + ox, b * (ink ? 2.6 : 1) + oy]);
      const p = inv(s, s + d, t);
      if (ink) {
        fx.strokePartial(x, pts, inv(s + d, s + d + 0.2, t), p, ink, '#1c1414', true);
      } else {
        x.save();
        x.filter = `blur(${6 * S}px)`;
        fx.strokePartial(x, pts, inv(12.85, 13.0, t), p, 50, 'rgba(40,38,38,0.6)');
        x.restore();
      }
    });
    const r = rng(77);
    for (let i = 0; i < 22; i++) {
      const px = r() * W;
      const py = r() * H;
      if (Math.hypot(px - 900, py - 795) < 90) continue;
      x.fillStyle = '#1a1818';
      x.fillRect(px + noise1(t * 3, i) * 12, py + noise1(t * 3, i + 40) * 12, 3 + r() * 4, 2 + r() * 4);
    }
  }
  if (t > 12.4 && t < 12.85) {
    const p = inv(12.4, 12.5, t);
    const e = inv(12.7, 12.85, t);

    const arc = [];
    for (let i = 0; i <= 40; i++) {
      const u = i / 40;
      const ax = lerp(-150, 150, u);
      const ay = Math.sin(u * Math.PI) * 80;
      arc.push([735 + ax * 0.906 - ay * -0.423, 790 + ax * -0.423 * -1 + ay * 0.906 - 60]);
    }
    x.save();
    x.filter = `blur(${5 * S}px)`;
    x.globalAlpha = (1 - e) * (1 - e) * (t < 12.8 ? 1 : 0);
    fx.strokePartial(x, arc, 0, p, 32, '#2a2a2a', true);
    x.restore();
  }
  // grey trails of the ink ball whipping between icons
  inkArc(x, arcPts(780, 380, 560, 210, Math.PI * 1.05, Math.PI * 2.1, 0.15), t, 12.46, 0.12, 30);
  inkArc(x, arcPts(860, 430, 340, 380, 2.79, -0.61), t, 12.75, 0.1, 30);
  inkArc(x, arcPts(720, 560, 330, 300, 3.49, 5.76), t, 12.97, 0.1, 30);
  inkArc(x, arcPts(470, 620, 210, 420, Math.PI * 0.6, Math.PI * 1.45), t, 13.17, 0.1, 30);
  // extra ink: blob top right, fuzzy dots, shards
  x.save();
  x.filter = `blur(${3 * S}px)`;
  x.filter = 'none';
  if (t > 12.83 && t < 12.95) sprayBlob(x, 1140, 165, 42 * ease.outBack(inv(12.83, 12.87, t)), 9);
  // the ball parks top left, fuzzy, and fades
  if (t > 13.24 && t < 13.45) {
    x.save();
    x.filter = `blur(${4 * S}px)`;
    sprayBlob(x, 370, 195, lerp(38, 22, inv(13.24, 13.45, t)), 11, 0.8);
    x.restore();
  }
  x.filter = `blur(${6 * S}px)`;
  if (t > 12.95 && t < 13.12) dot(x, 795, 800, 22, '#141212');
  x.restore();
  if (t > 12.7 && t < 13.0) fx.strokePartial(x, [[814, 322], [826, 334], [834, 326], [842, 334], [856, 320]], 0, 1, 4, '#141212');
  RIBBONS.forEach(([pts, a, b, c2, d]) => {
    if (t > a && t < d) ribbon(x, pts, inv(c2, d, t), inv(a, b, t), 20);
  });
  if (t > 12.95) {
    x.fillStyle = '#141212';
    [[1320, 510, 0.5], [1245, 605, -0.4], [675, 715, 0.9]].forEach(([a, b, r]) => {
      x.save();
      x.translate(a, b);
      x.rotate(r);
      x.beginPath();
      x.moveTo(-14, -4);
      x.lineTo(16, -2);
      x.lineTo(-4, 9);
      x.closePath();
      x.fill();
      x.restore();
    });
  }
  if (t > 13.52) {
    x.save();
    x.setTransform(S, 0, 0, S, 0, 0);
    fx.text(x, 'through', 318, 548, 38, '#1d1a18');
    const b0 = kf(t, [[13.52, 380], [13.6, 600], [13.64, 660], [13.68, 680]]);
    const b1 = kf(t, [[13.52, 640], [13.6, 800], [13.64, 720], [13.68, 720]]);
    x.fillStyle = '#0e0d0d';
    x.fillRect(b0, 522, b1 - b0, 44);
    x.restore();
  }
  if (heartAt) {
    // the heart breaks from the drift and slides over the word
    const [hx, hy, hw, hr] = heartAt;
    const k = inv(13.4, 13.5, t);
    const tgt = kf(t, [[13.47, [480, 600]], [13.51, [460, 600]], [13.55, [440, 560]], [13.6, [400, 540]], [13.64, [395, 530]], [13.68, [380, 430]], [13.76, [360, 330]]]);
    x.save();
    x.setTransform(S, 0, 0, S, 0, 0);
    // screen position of the drifting heart
    // heartAt is already orbited; apply the layer zoom
    const sx0 = hx + kf(t, [[12.25, 0], [12.4, 30]]);
    const sy0 = hy;
    drawSprite(x, 'heart', lerp(sx0, tgt[0], k), lerp(sy0, tgt[1], k), hw, hr, 1, { silhouette: '#121010' });
    x.restore();
  }
  x.restore();
  // motion-blur flashes on the ink hits, then the whip into the hand shot
  const flashBlur = kf(t, [[12.5, 0], [12.535, 6], [12.575, 0], [12.73, 0], [12.76, 4], [12.79, 0], [12.97, 0], [13.01, 8], [13.05, 0], [13.7, 0], [13.722, 1.5], [13.76, 4]]);
  const cutBlur = kf(t, [[11.85, 2], [11.887, 2], [11.928, 5], [11.97, 2], [12.012, 0]]);
  composite(ctx, c, { blur: spin < 1 ? cutBlur : flashBlur });
  if (t > 13.69) {
    // thin black speed arcs sweeping with the turn
    const k = inv(13.69, 13.76, t);
    [[560, 620, 330, 240, 3.0, 4.3], [620, 660, 430, 330, 1.75, 2.85], [780, 600, 380, 230, -0.35, 0.6], [470, 440, 120, 160, 3.5, 4.6]].forEach(([cx, cy, rx, ry, a0, a1]) =>
      ribbon(ctx, arcPts(cx, cy, rx, ry, a0 + k * 0.4, a1 + k * 0.4), 0, Math.min(1, k * 3), 8, 'rgba(20,18,18,0.9)', 1.2));
  }
  // symmetric vignette: none while the ring settles, then deepening (measured corners #e3 -> #c5 -> #a9 -> #97 -> #85 -> #58)
  const va = kf(t, [[11.85, 0], [12.035, 0], [12.137, 0.16], [12.262, 0.22], [12.387, 0.265], [12.512, 0.28], [12.763, 0.33], [13.013, 0.37], [13.263, 0.4], [13.513, 0.45], [13.68, 0.61], [13.722, 0.78], [13.76, 0.85]]);
  const vg = ctx.createRadialGradient(W / 2, H / 2, 260, W / 2, H / 2, 900);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(0.5, `rgba(0,0,0,${va * 0.32})`);
  vg.addColorStop(1, `rgba(0,0,0,${va})`);
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

// =====================================================================
// 8. Hand: "through ones own ability to"
// =====================================================================
// Rotoscoped hand silhouettes (scripts/trace-hand.js -> ref/derived/hand/f_####.png).
const fsMod = require('fs');
const pathMod = require('path');
const HAND_DIR = pathMod.join(__dirname, '..', 'ref', 'derived', 'hand');
const HEAD_DIR = pathMod.join(__dirname, '..', 'ref', 'derived', 'head');
const handMasks = {};
const handHot = {};
const headMasks = {};
const headHot = {};
// Image decoding is async in @napi-rs/canvas, so masks are preloaded before rendering.
async function preload() {
  const { loadImage } = require('@napi-rs/canvas');
  for (const [dir, into, hotInto] of [[HAND_DIR, handMasks, handHot], [HEAD_DIR, headMasks, headHot]]) {
    if (!fsMod.existsSync(dir)) continue;
    for (const name of fsMod.readdirSync(dir)) {
      const m = /^(f|hot)_(\d+)\.png$/.exec(name);
      if (m) (m[1] === 'hot' ? hotInto : into)[Number(m[2])] = await loadImage(fsMod.readFileSync(pathMod.join(dir, name)));
    }
  }
}
function handMask(t) {
  return handMasks[Math.round(t * C.FPS)] || null;
}
function handHotMask(t) {
  return handHot[Math.round(t * C.FPS)] || null;
}
// nearest traced head frame (the tracer skips a few blurred / mid-transition frames)
function headMask(t) {
  const f = Math.round(t * C.FPS);
  for (let d = 0; d <= 6; d++) {
    const m = headMasks[f - d] || headMasks[f + d];
    if (m) {
      const k = headMasks[f - d] ? f - d : f + d;
      return { f: k, mask: m, hot: headHot[k] || null };
    }
  }
  return null;
}

// Thermal-camera colouring of a traced silhouette: a heat field (distance inside the outline,
// plus hot spots) mapped through an iron colormap. Computed at 1440x1080, cached per frame.
const IRON = [[0, [70, 6, 10]], [0.22, [176, 24, 14]], [0.42, [214, 52, 22]], [0.6, [240, 118, 32]], [0.76, [246, 160, 54]], [0.88, [252, 214, 140]], [1, [250, 252, 255]]];
const ironLut = (() => {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    let k = 1;
    while (k < IRON.length - 1 && IRON[k][0] < v) k++;
    const [a, ca] = IRON[k - 1];
    const [b, cb] = IRON[k];
    const u = clamp((v - a) / (b - a));
    for (let j = 0; j < 3; j++) lut[i * 3 + j] = Math.round(ca[j] + (cb[j] - ca[j]) * u);
  }
  return lut;
})();
const thermalCache = new Map();
function thermalImage(key, mask, { depth = 28, base = 0.24, gain = 0.5, hot = [], warm = null, hotMask = null, hotGain = 0.6, front = 0, rimBack = 1, mottle = 0, floor = 0, hotBlur = 10 } = {}) {
  if (thermalCache.has(key)) return thermalCache.get(key);
  const m = createCanvas(W, H);
  const mx = m.getContext('2d');
  mx.drawImage(mask, 0, 0, W, H);
  const b = createCanvas(W, H);
  const bx = b.getContext('2d');
  bx.filter = `blur(${depth}px)`;
  bx.drawImage(mask, 0, 0, W, H);
  const md = mx.getImageData(0, 0, W, H);
  const bd = bx.getImageData(0, 0, W, H).data;
  const d = md.data;
  // bounding box of the silhouette, so hot spots follow the figure
  let x0 = W, x1 = 0, y0 = H, y1 = 0;
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (d[(y * W + x) * 4 + 3] > 128) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const bw = Math.max(1, x1 - x0);
  const bh = Math.max(1, y1 - y0);
  const nz = mottle ? noiseField() : null;
  const spots = hot.map(([u, v, r, a]) => [x0 + u * bw, y0 + v * bh, r, a]);
  let hd = null;
  if (hotMask) {
    const hc = createCanvas(W, H);
    const hx = hc.getContext('2d');
    hx.filter = `blur(${hotBlur}px)`;
    hx.drawImage(hotMask, 0, 0, W, H);
    hd = hx.getImageData(0, 0, W, H).data;
  }
  for (let y = 0; y < H; y++) {
    const wy = warm ? clamp((y - warm[0]) / (warm[1] - warm[0])) : 0;
    const wy2 = wy * wy * (3 - 2 * wy);
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (!d[i + 3]) continue;
      const e = clamp((bd[i + 3] / 255 - 0.5) * 2);
      // the dark rim is strongest on the front (left) edge; rimBack < 1 weakens it toward the back
      // only the lower back (neck / shoulder) loses its rim; the top of the hair keeps it
      const back = clamp((x - x0) / bw) * clamp(((y - y0) / bh - 0.35) * 3);
      const ee = Math.pow(e, 0.7);
      let h = base + gain * (ee + (1 - ee) * (1 - rimBack) * back) + (warm ? warm[2] * wy2 : 0);
      if (hd) h += hotGain * (hd[i + 3] / 255);
      if (mottle) h += mottle * (nz[i] / 255 - 0.5);
      if (floor) h = Math.max(h, floor);
      if (front) h -= front * clamp(1 - (x - x0) / (0.35 * bw));
      for (const [hx, hy, hr, ha] of spots) {
        const q = ((x - hx) ** 2 + (y - hy) ** 2) / (hr * hr);
        if (q < 4) h += ha * Math.exp(-q);
      }
      const v = Math.max(0, Math.min(255, Math.round(h * 255))) * 3;
      d[i] = ironLut[v];
      d[i + 1] = ironLut[v + 1];
      d[i + 2] = ironLut[v + 2];
    }
  }
  mx.putImageData(md, 0, 0);
  if (thermalCache.size > 6) thermalCache.delete(thermalCache.keys().next().value);
  thermalCache.set(key, m);
  return m;
}
// Burn-through: dark spreads inward from the outline (a black rim at the front) until only a
// small spot is left. `thr` is how far in the burn has reached (0 = edge, 1 = core).
let burnNoise = null;
function noiseField() {
  if (!burnNoise) {
    const r = rng(77);
    const small = createCanvas(48, 36);
    const sx = small.getContext('2d');
    const id = sx.createImageData(48, 36);
    for (let i = 0; i < 48 * 36; i++) {
      id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = Math.round(r() * 255);
      id.data[i * 4 + 3] = 255;
    }
    sx.putImageData(id, 0, 0);
    const big = createCanvas(W, H);
    const bx = big.getContext('2d');
    bx.filter = 'blur(10px)';
    bx.drawImage(small, 0, 0, W, H);
    burnNoise = bx.getImageData(0, 0, W, H).data;
  }
  return burnNoise;
}
function burnImage(key, mask, thr) {
  const k = `${key}:${thr.toFixed(3)}`;
  if (thermalCache.has(k)) return thermalCache.get(k);
  noiseField();
  const m = createCanvas(W, H);
  const mx = m.getContext('2d');
  mx.drawImage(mask, 0, 0, W, H);
  const b = createCanvas(W, H);
  const bx = b.getContext('2d');
  bx.filter = 'blur(70px)';
  bx.drawImage(mask, 0, 0, W, H);
  const md = mx.getImageData(0, 0, W, H);
  const bd = bx.getImageData(0, 0, W, H).data;
  const d = md.data;
  for (let i = 0; i < W * H * 4; i += 4) {
    if (!d[i + 3]) continue;
    const y = (i / 4 / W) | 0;
    const v = clamp((bd[i + 3] / 255 - 0.5) * 2) + (burnNoise[i] / 255 - 0.5) * 0.3 - 0.9 * clamp((y - 380) / 450);
    if (v > thr + 0.07) {
      d[i + 3] = 0; // not yet burned
    } else if (v > thr - 0.05) {
      d[i] = 18; d[i + 1] = 13; d[i + 2] = 9; // burning rim
    } else {
      d[i] = 74; d[i + 1] = 62; d[i + 2] = 42;
    }
  }
  mx.putImageData(md, 0, 0);
  thermalCache.set(k, m);
  return m;
}
// flat-filled silhouette (backlit shadow)
function silhouette(mask, color) {
  const c = createCanvas(W, H);
  const x = c.getContext('2d');
  x.drawImage(mask, 0, 0, W, H);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color;
  x.fillRect(0, 0, W, H);
  return c;
}

// Hand colouring measured from the reference: lit from the left (pale yellow on the back of the
// hand), yellow-orange toward the wrist, red along the right edge. Crisp outline. Per mask, cached.
const HAND_PAL = [[0, [96, 12, 6]], [0.2, [184, 36, 16]], [0.38, [212, 80, 26]], [0.55, [218, 138, 36]], [0.7, [219, 168, 52]], [0.85, [220, 194, 104]], [1, [224, 206, 128]]];
const handLut = (() => {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    let k = 1;
    while (k < HAND_PAL.length - 1 && HAND_PAL[k][0] < v) k++;
    const [a, ca] = HAND_PAL[k - 1];
    const [b, cb] = HAND_PAL[k];
    const u = clamp((v - a) / (b - a));
    for (let j = 0; j < 3; j++) lut[i * 3 + j] = Math.round(ca[j] + (cb[j] - ca[j]) * u);
  }
  return lut;
})();
const handCache = new Map();
function handShade(mask) {
  if (handCache.has(mask)) return handCache.get(mask);
  const m = createCanvas(W, H);
  const mx = m.getContext('2d');
  mx.drawImage(mask, 0, 0, W, H);
  const blurred = (r) => {
    // extend the bottom rows past the frame so the wrist isn't read as an edge
    const ext = createCanvas(W, H + 100);
    const ex = ext.getContext('2d');
    ex.drawImage(mask, 0, 0, W, H);
    ex.drawImage(mask, 0, H - 2, W, 2, 0, H - 2, W, 102);
    const b = createCanvas(W, H + 100);
    const bx = b.getContext('2d');
    bx.filter = `blur(${r}px)`;
    bx.drawImage(ext, 0, 0);
    return bx.getImageData(0, 0, W, H).data;
  };
  const b16 = blurred(16);
  const b8 = blurred(8);
  const md = mx.getImageData(0, 0, W, H);
  const d = md.data;
  let x0 = W, x1 = 0, y0 = H, y1 = 0;
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (d[(y * W + x) * 4 + 3] > 128) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const bw = Math.max(1, x1 - x0);
  const bh = Math.max(1, y1 - y0);
  const hx = x0 + 0.42 * bw;
  const hy = y0 + 0.62 * bh;
  const hr = 0.28 * bh;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const a = d[i + 3];
      if (!a) continue;
      d[i + 3] = Math.max(0, Math.min(255, (a - 128) * 3 + 128)); // crisp edge
      const e = clamp((b16[i + 3] / 255 - 0.5) * 2);
      // red only where the silhouette ends to the right / lower right (not on top or left edges)
      const j1 = (Math.min(H - 1, y + 16) * W + Math.min(W - 1, x + 16)) * 4;
      const j2 = (Math.min(H - 1, y + 30) * W + Math.min(W - 1, x + 44)) * 4;
      const right = clamp(((b8[i + 3] - b8[j1 + 3]) / 255) * 1.6);
      const right2 = clamp(((b16[i + 3] - b16[j2 + 3]) / 255) * 1.3);
      const u = (x - x0) / bw;
      const vv = (y - y0) / bh;
      const q = ((x - hx) ** 2 + (y - hy) ** 2) / (hr * hr);
      let h = 0.6 + 0.05 * Math.sqrt(e) + 0.3 * Math.exp(-q) - 0.7 * Math.max(0, u - 0.6) - 0.38 * right - 0.08 * right2 + 0.14 * clamp(1 - vv / 0.3) - 0.14 * clamp((vv - 0.72) / 0.28);
      const v = Math.max(0, Math.min(255, Math.round(h * 255))) * 3;
      d[i] = handLut[v];
      d[i + 1] = handLut[v + 1];
      d[i + 2] = handLut[v + 2];
    }
  }
  mx.putImageData(md, 0, 0);
  if (handCache.size > 8) handCache.delete(handCache.keys().next().value);
  handCache.set(mask, m);
  return m;
}

// Thermal shading inside a traced silhouette (screen space).
function tracedHand(ctx, mask, filter, tint = 0, hot = null, pale = 0) {
  const [c, x] = off(0);
  x.drawImage(handShade(mask), 0, 0, W, H);
  if (pale > 0) {
    // the hand drains to a pale grey, keeping a thin orange rim on its right edge
    const pc = createCanvas(W, H);
    const px = pc.getContext('2d');
    px.filter = 'blur(16px)';
    px.drawImage(mask, -5, -4, W, H);
    px.filter = 'none';
    px.globalCompositeOperation = 'source-in';
    px.fillStyle = '#d3cdc7';
    px.fillRect(0, 0, W, H);
    x.save();
    x.globalCompositeOperation = 'source-atop';
    x.globalAlpha = pale * 0.9;
    x.drawImage(pc, 0, 0, W, H);
    x.drawImage(pc, 0, 0, W, H);
    x.restore();
  }
  if (hot) {
    // white-hot highlights (lit thumb / finger)
    const hc = createCanvas(W, H);
    const hx = hc.getContext('2d');
    hx.drawImage(hot, 0, 0, W, H);
    hx.globalCompositeOperation = 'source-in';
    hx.fillStyle = '#e4e3d6';
    hx.fillRect(0, 0, W, H);
    x.save();
    x.globalCompositeOperation = 'source-atop';
    x.drawImage(hc, 0, 0, W, H);
    x.restore();
  }
  if (tint <= 0) {
    composite(ctx, c, { filter: filter || undefined });
    return;
  }
  x.globalCompositeOperation = 'source-atop';
  if (false) {
  x.globalCompositeOperation = 'source-in';
  const g = x.createLinearGradient(0, 330, 0, H);
  g.addColorStop(0, '#ee6020');
  g.addColorStop(0.45, '#f07e26');
  g.addColorStop(0.8, '#e8902a');
  g.addColorStop(1, '#d88a22');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  x.globalCompositeOperation = 'source-atop';
  const r = x.createLinearGradient(470, 0, 980, 0);
  r.addColorStop(0, 'rgba(255,242,204,0.95)');
  r.addColorStop(0.35, 'rgba(255,222,156,0.7)');
  r.addColorStop(0.6, 'rgba(245,130,40,0.1)');
  r.addColorStop(0.8, 'rgba(200,50,16,0.7)');
  r.addColorStop(1, 'rgba(176,36,16,0.9)');
  x.fillStyle = r;
  x.fillRect(0, 0, W, H);
  // soft darker band just inside the outline (rounded, lit-from-inside look)
  const [ec, ex] = off(3);
  ex.drawImage(mask, 0, 0, W, H);
  ex.globalCompositeOperation = 'source-in';
  ex.fillStyle = 'rgba(160,36,14,0.5)';
  ex.fillRect(0, 0, W, H);
  ex.globalCompositeOperation = 'destination-out';
  ex.filter = `blur(${14 * S}px)`;
  ex.drawImage(mask, 0, 0, W, H);
  ex.filter = 'none';
  x.drawImage(ec, 0, 0, W, H);
  // yellow-white highlights on the back of the hand and the thumb
  [[650, 780, 110], [560, 690, 70]].forEach(([hx, hy, hr]) => {
    const hg = x.createRadialGradient(hx, hy, 0, hx, hy, hr);
    hg.addColorStop(0, 'rgba(255,216,144,0.6)');
    hg.addColorStop(1, 'rgba(255,216,144,0)');
    x.fillStyle = hg;
    x.fillRect(0, 0, W, H);
  });
  // deep red-brown band along the right edge (index side to wrist)
  const [rc, rx] = off(4);
  rx.drawImage(ec, 0, 0, W, H);
  rx.globalCompositeOperation = 'source-in';
  rx.fillStyle = 'rgba(122,42,20,0.9)';
  rx.fillRect(0, 0, W, H);
  rx.globalCompositeOperation = 'destination-in';
  const side = rx.createLinearGradient(720, 0, 860, 0);
  side.addColorStop(0, 'rgba(0,0,0,0)');
  side.addColorStop(1, 'rgba(0,0,0,1)');
  rx.fillStyle = side;
  rx.fillRect(0, 0, W, H);
  x.drawImage(rc, 0, 0, W, H);
  }
  if (tint > 0) {
    // intro: crimson body with violet toward the lower right
    x.fillStyle = `rgba(214,20,38,${0.92 * tint})`;
    x.fillRect(0, 0, W, H);
    const pv = 0.8 * clamp((tint - 0.55) / 0.45);
    const v = x.createRadialGradient(730, 720, 10, 730, 720, 240);
    v.addColorStop(0, `rgba(112,30,150,${pv})`);
    v.addColorStop(1, 'rgba(112,30,150,0)');
    x.fillStyle = v;
    x.fillRect(0, 0, W, H);
  }
  x.globalCompositeOperation = 'source-over';
  composite(ctx, c, { filter: filter || undefined });
}
function sceneHand(ctx, t, f) {
  // background warms to red-brown then mauve-grey as the hand closes (measured per frame)
  const bg = bgRamp(t, [[13.76, '#141313'], [15.47, '#151414'], [15.557, '#221417'], [15.599, '#251619'], [15.641, '#2a191b'], [15.682, '#2e1c1e'], [15.724, '#362426'], [15.766, '#3f2c2f'], [15.808, '#463437'], [15.849, '#4d3d41'], [15.89, '#524347']]);
  fx.dark(ctx, bg);
  const fallP = inv(15.6, 15.89, t);
  const settle = ease.inOutCubic(inv(13.76, 14.32, t));
  const fall = ease.inOutCubic(fallP);
  let pose;
  if (t < 14.25) pose = blendPose('curl', 'open', settle);
  else if (t < 15.0) pose = blendPose('open', 'open', 0);
  else if (t < 15.6) pose = blendPose('open', 'curl', ease.inOutCubic(inv(15.38, 15.56, t)));
  else pose = blendPose('curl', 'fist', fall);
  const traced = handMask(t);
  if (traced) {
    let filt = '';
    if (settle < 1) filt = `brightness(${lerp(0.92, 1, settle)}) blur(${(1 - settle) * 10 * S}px)`;
    else if (t > 15.64) filt = `saturate(${kf(t, [[15.64, 1], [15.77, 0.85]])}) brightness(${kf(t, [[15.64, 1], [15.77, 0.92], [15.81, 0.97]])})`;
    tracedHand(ctx, traced, filt, settle < 1 ? 1 - settle : 0, handHotMask(t), kf(t, [[15.77, 0], [15.8, 1]]));
  }
  const hand = traced ? null : thermalHand(pose);
  const [c, x] = traced ? [null, null] : off(0);
  if (!traced) {
  x.save();
  const sway = noise1(t * 0.8, 6) * 0.02 + Math.sin(t * 2.2) * 0.01;
  x.translate(700, 1110);
  x.rotate(sway + (1 - settle) * -0.3 + fall * -0.25);
  x.scale(lerp(0.65, 1, settle), 1);
  x.translate(-710 + (1 - settle) * 15 + fall * -290, -1110 + (1 - settle) * 140 + fall * 30);
  if (settle < 1) x.filter = `hue-rotate(${-30 * (1 - settle)}deg) saturate(${1 + (1 - settle) * 0.6}) brightness(${lerp(0.55, 0.88, settle)})`;
  else if (fall > 0) x.filter = `saturate(${1 - fall * 0.85}) brightness(${1 - fall * 0.25})`;
  if (fall > 0) {
    // wider fist with an orange rim on its right edge
    x.translate(520, 900);
    x.scale(1 + fall * 0.45, 1);
    x.translate(-520, -900);
    const rim = createCanvas(hand.width, hand.height);
    const rx = rim.getContext('2d');
    rx.drawImage(hand, 0, 0);
    rx.globalCompositeOperation = 'source-in';
    rx.fillStyle = '#e0782a';
    rx.fillRect(0, 0, hand.width, hand.height);
    const f2 = x.filter;
    x.filter = 'none';
    x.globalAlpha = fall;
    x.filter = `blur(${3 * S}px)`;
    x.drawImage(rim, 260, 250);
    x.filter = 'none';
    x.globalAlpha = 1;
    x.filter = f2;
  }
  x.drawImage(hand, 250, 250);
  x.restore();
  composite(ctx, c, { blur: (1 - settle) * 34 + fall * 4, alpha: 1 - fall * 0.1 });
  }
  if (settle < 1) {
    ctx.save();
    ctx.filter = `blur(${16 * S}px)`;
    ctx.globalAlpha = 0.75 * (1 - settle) * (1 - settle);
    if (!traced) fx.strokePartial(ctx, [[800, 1080], [805, 880], [780, 700]], 0, 1, 46, '#5030a0', false);
    ctx.restore();
  }
  // white swirl arcs during the intro
  // thin white orbit arcs spinning around the hand, shortening to dashes
  if (t < 14.15) {
    const q = inv(13.76, 14.1, t);
    const span = lerp(0.75, 0.1, q);
    const [ac, ax] = off(5);
    ax.strokeStyle = `rgba(240,238,234,${0.75 * (1 - inv(14.05, 14.15, t))})`;
    ax.lineCap = 'round';
    ax.lineWidth = 5;
    [[0, 1], [1.4, 0.92], [2.6, 1.05], [3.7, 0.88], [5.0, 0.97]].forEach(([a0, rk], k) => {
      const a = a0 + t * 7 + k * 0.3;
      ax.beginPath();
      ax.ellipse(lerp(600, 640, q), lerp(660, 520, q), lerp(250, 200, q) * rk, lerp(400, 230, q) * rk, -0.35, a, a + span);
      ax.stroke();
    });
    composite(ctx, ac, { blur: lerp(4, 2, q) });
  }
  // smoky white swooshes curling off the pinch (15.66-15.72)
  if (t > 15.65 && t < 15.74) {
    const a = Math.sin(Math.PI * inv(15.65, 15.74, t));
    const [sc, sx] = off(5);
    sx.strokeStyle = `rgba(236,232,228,${0.75 * a})`;
    sx.lineCap = 'round';
    [[[618, 445], [700, 452], [760, 430]], [[700, 420], [780, 395], [860, 365]], [[760, 372], [830, 352], [900, 340]]].forEach((pts, k) => {
      sx.lineWidth = [7, 4, 3][k];
      sx.beginPath();
      sx.moveTo(...pts[0]);
      sx.quadraticCurveTo(...pts[1], ...pts[2]);
      sx.stroke();
    });
    composite(ctx, sc, { blur: 2.5 });
  }
  // thin bright motion streaks shooting left as the hand drops away (15.79-15.89)
  if (t > 15.785) {
    const q = inv(15.79, 15.86, t);
    const [sc, sx] = off(5);
    [[362, 3, 860], [384, 2, 820], [404, 4, 880], [428, 2, 840], [452, 3, 780]].forEach(([y, w, xr], k) => {
      const xl = lerp(xr - 220, k % 2 ? 60 : 0, q);
      const g = sx.createLinearGradient(xl, 0, xr, 0);
      g.addColorStop(0, 'rgba(240,240,240,0.15)');
      g.addColorStop(0.6, 'rgba(244,244,244,0.85)');
      g.addColorStop(1, 'rgba(250,250,250,0.95)');
      sx.fillStyle = g;
      sx.fillRect(xl, y, xr - xl, w);
    });
    composite(ctx, sc, { blur: 1 });
    // soft haze trailing on the left
    const [hc, hx] = off(6);
    hx.fillStyle = `rgba(230,228,226,${0.35 * q})`;
    hx.fillRect(0, 330, 420 * q + 80, 150);
    composite(ctx, hc, { blur: 30 });
  }
  // small white flecks (measured): three hanging in the air, one catching light on the index finger
  if (t > 14.15 && t < 15.79) {
    const u = inv(14.25, 15.45, t);
    [[512, 368, 512, 366, -0.25, 13], [625, 400, 650, 398, 0.2, 10], [803, 304, 772, 263, -0.35, 12], [821, 574, 828, 574, 0.15, 14]].forEach(([ax, ay, bx2, by2, rot, len], i) => {
      ctx.save();
      ctx.translate(lerp(ax, bx2, u) + noise1(t * 2, i + 7) * 3, lerp(ay, by2, u) + noise1(t * 2, i + 11) * 3);
      ctx.rotate(rot + noise1(t, i + 3) * 0.2);
      ctx.shadowColor = 'rgba(255,255,255,0.6)';
      ctx.shadowBlur = 4 * S;
      ctx.fillStyle = 'rgba(248,246,242,0.95)';
      ctx.beginPath();
      ctx.ellipse(0, 0, 2.2, len / 2, 0, 0, 7);
      ctx.fill();
      ctx.restore();
    });
  }
  // text (drifts left with a horizontal smear at the end)
  const ti = ease.inQuad(inv(13.85, 14.17, t));
  const grey = inv(15.5, 15.75, t);
  const col = mixHex(CREAM, '#a09898', grey);
  const dx = -235 * ease.inCubic(fallP);
  const glow = { glow: 'rgba(243,239,232,0.3)', glowBlur: 6 };
  fx.text(ctx, t < 13.87 ? 'through' : 'through ones', 215 + dx, 545, BODY, col, { blur: (1 - ti) * 8 + fallP * 3, ...glow });
  // typing cursor (measured per frame): wide block, then "own", block shrinking to a bar
  ctx.fillStyle = '#efe9e4';
  if (t > 14.2 && t < 14.243) ctx.fillRect(880, 520, 166, 46);
  else if (t >= 14.243 && t < 14.285) ctx.fillRect(1052, 520, 150, 46);
  else if (t >= 14.285 && t < 14.327) ctx.fillRect(1110, 520, 30, 46);
  else if (t >= 14.327 && t < 14.41) ctx.fillRect(1130, 520, 7, 46);
  if (t >= 14.243) {
    const word = t < 14.49 ? 'own' : t < 15.665 ? 'own ability' : 'own ability to';
    fx.text(ctx, word, 950 + dx, 545, BODY, col, { blur: fallP * 3 + (t > 14.44 && t < 14.49 ? 4 : 0), ...glow });
  }
}

// =====================================================================
// 9. L-O-V-E build.
// =====================================================================
const LSIZE = 62;
function letter(ctx, ch, x, y, size, color, rot = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  fx.text(ctx, ch, 0, 0, size, color, { align: 'center', tracking: 0 });
  ctx.restore();
}

function sceneLove(ctx, t, f) {
  const LX = [129, 522, 918, 1317];
  const LY = 540;
  if (t < 16.2) {
    ctx.fillStyle = '#e3e3e3';
    ctx.fillRect(0, 0, W, H);
    if (t < 15.91) {
      // first frame: the heart flies in as a tiny tilted red streak
      ctx.save();
      ctx.filter = `blur(${2 * S}px)`;
      ctx.translate(662, 505);
      ctx.rotate(-0.95);
      ctx.fillStyle = 'rgba(40,24,24,0.55)';
      ctx.beginPath();
      ctx.ellipse(-6, 6, 38, 14, 0, 0, 7);
      ctx.fill();
      ctx.fillStyle = '#d0141a';
      ctx.beginPath();
      ctx.ellipse(0, 0, 40, 9, 0, 0, 7);
      ctx.fill();
      ctx.restore();
      return;
    }
    const w = kf(t, [[15.91, 280], [16.08, 292], [16.14, 337, 'inQuad'], [16.19, 460, 'inQuad']]);
    const crush = inv(16.11, 16.17, t);
    if (crush > 0) {
      fx.vignette(ctx, crush * 0.97, '28,26,26', lerp(0.6, 0.12, crush), W / 2, H / 2, 0.6);
      fx.grain(ctx, f + 1, 0.3 * crush);
    }
    ctx.save();
    ctx.filter = `blur(${20 * S}px)`;
    ctx.fillStyle = `rgba(40,30,30,${0.5 * inv(16.06, 16.1, t)})`;
    ctx.beginPath();
    ctx.ellipse(735, 425, w * 0.4, w * 0.14, 0, 0, 7);
    ctx.fill();
    ctx.restore();
    drawSprite(ctx, 'heart', 728, 545, w, 0, 1, { shadow: 'rgba(30,16,16,0.35)', shadowBlur: 14, shadowY: -8 });
    letter(ctx, 'L', LX[0], LY, LSIZE, mixHex('#3b1d18', '#8a8888', crush));
    return;
  }
  if (t < 16.52) {
    fx.dark(ctx, '#141313');
    const glow = inv(16.33, 16.44, t);
    if (glow > 0) {
      // big soft red halo behind the camera
      const g = ctx.createRadialGradient(729, 545, 0, 729, 545, 360);
      g.addColorStop(0, `rgba(236,16,22,${glow})`);
      g.addColorStop(0.55, `rgba(214,10,18,${0.85 * glow})`);
      g.addColorStop(1, 'rgba(160,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    drawSprite(ctx, 'camera', 729, 540, kf(t, [[16.2, 340], [16.5, 345]]), noise1(t, 3) * 0.04);
    letter(ctx, 'L', LX[0], LY, LSIZE, CREAM);
    letter(ctx, 'O', LX[1], LY, LSIZE, t > 16.46 ? '#3fb7d9' : CREAM);
    return;
  }
  if (t < 16.77) {
    ctx.fillStyle = '#d41b16';
    ctx.fillRect(0, 0, W, H);
    fx.vignette(ctx, 0.2, '120,0,0', 0.4);
    fx.grain(ctx, f + 2, 0.35);
    const q = ease.outCubic(inv(16.56, 16.64, t));
    const blue = '#2fb2e6';
    letter(ctx, 'L', LX[0], LY, LSIZE, blue);
    letter(ctx, 'O', LX[1], LY, LSIZE, blue);
    if (t > 16.6) letter(ctx, 'V', LX[2], LY, LSIZE, blue);
    drawSprite(ctx, 'book', 735, 546, lerp(120, 330, q), lerp(-0.4, 0.28, q), 1, { sy: 1.15, shadow: 'rgba(60,0,0,0.6)', shadowBlur: 40 });
    const dk = inv(16.71, 16.77, t);
    if (dk > 0) {
      // the red closes in to black around the book
      const g = ctx.createRadialGradient(735, 546, lerp(700, 180, dk), 735, 546, lerp(1100, 520, dk));
      g.addColorStop(0, 'rgba(20,18,18,0)');
      g.addColorStop(1, `rgba(20,18,18,${0.95 * dk})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    return;
  }
  if (t < 17.18) {
    fx.dark(ctx, '#141313');
    const q = ease.outCubic(inv(16.79, 16.9, t));
    const bloom = inv(17.08, 17.16, t);
    if (bloom > 0) {
      // white glow blooming out from behind the record before the cut to paper
      const g = ctx.createRadialGradient(729, 540, 120, 729, 540, lerp(170, 380, bloom));
      g.addColorStop(0, `rgba(236,236,236,${Math.min(1, bloom * 2)})`);
      g.addColorStop(1, 'rgba(236,236,236,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    drawSprite(ctx, 'vinyl', 729, 540, lerp(270, 290, q), 0, 1, { sx: lerp(0.18, 1, q) });
    const lo = CREAM;
    letter(ctx, 'L', LX[0], LY, LSIZE, lo);
    letter(ctx, 'O', LX[1], LY, LSIZE, lo);
    letter(ctx, 'V', LX[2], LY, LSIZE, CREAM);
    if (t > 16.86) letter(ctx, 'E', LX[3], LY, LSIZE, CREAM);
    return;
  }
  ctx.fillStyle = '#dededd';
  ctx.fillRect(0, 0, W, H);
  fx.vignette(ctx, 0.5, '30,28,28', 0.3);
  drawSprite(ctx, 'vinyl', 720, 540, 450, 0);
  ['L', 'O', 'V', 'E'].forEach((ch, i) => letter(ctx, ch, LX[i], LY, LSIZE, '#3b1d18'));
}

// Finale: letters scattered, then spinning back upright and converging. Measured from the reference.
// Finale: letters tumble in, scatter, then spin back upright and converge. Measured per frame
// from the reference (exact frame times; 17.31-18.1 s re-measured for v15).
const FIN = {
  L: [[17.35, [650, 770, 40]], [17.47, [903, 400, -30]], [17.56, [745, 566, 0]], [17.64, [648, 680, -90]], [17.77, [542, 788, -30]], [17.93, [464, 860, 45]], [18.02, [454, 881, -90]], [18.1, [443, 886, -150]], [18.25, [440, 895, -180]], [18.5, [438, 906, -140]], [18.75, [440, 900, -100]], [19.0, [444, 891, -50]], [19.25, [446, 880, -5]], [19.5, [447, 873, 0]], [19.75, [468, 843, 0]], [20.0, [513, 792, 0]], [20.15, [513, 792, 0]], [20.187, [524, 736, 0]], [20.229, [540, 690, 0]], [20.27, [580, 640, 0]], [20.3, [640, 580, 0]]],
  O: [[17.31, [530, 950, 0]], [17.35, [750, 970, 0]], [17.39, [929, 821, 0]], [17.47, [1190, 611, 0]], [17.56, [1372, 460, 0]], [17.64, [1372, 384, 0]], [17.77, [1190, 346, 0]], [17.93, [1035, 309, 0]], [18.02, [983, 298, 0]], [18.1, [940, 287, 0]], [18.5, [825, 264, 0]], [19.0, [807, 255, 0]], [19.5, [801, 273, 0]], [19.75, [798, 282, 0]], [20.0, [792, 330, 0]], [20.15, [792, 330, 0]], [20.187, [770, 350, 0]], [20.229, [760, 370, 0]], [20.27, [740, 410, 0]], [20.3, [760, 520, 0]]],
  V: [[17.35, [140, 730, -120]], [17.47, [417, 745, -200]], [17.56, [588, 475, 10]], [17.64, [719, 281, 180]], [17.77, [855, 43, 110]], [17.93, [713, 80, 60]], [18.02, [626, 119, 90]], [18.1, [562, 151, 150]], [18.25, [450, 205, 190]], [18.5, [354, 249, 270]], [18.75, [338, 252, 285]], [19.0, [330, 255, 300]], [19.25, [340, 262, 345]], [19.5, [348, 267, 360]], [19.75, [369, 276, 360]], [20.0, [429, 324, 360]], [20.15, [429, 324, 360]], [20.187, [460, 340, 360]], [20.229, [490, 360, 360]], [20.27, [550, 400, 360]], [20.3, [690, 500, 360]]],
  E: [[17.31, [700, 1000, 200]], [17.47, [313, 76, 300]], [17.56, [447, 162, 90]], [17.64, [620, 339, -90]], [17.77, [799, 518, -60]], [17.93, [955, 659, -50]], [18.02, [1009, 713, 90]], [18.1, [1050, 756, 120]], [18.25, [1134, 834, 170]], [18.5, [1173, 870, 170]], [18.75, [1185, 880, 150]], [19.0, [1188, 885, 50]], [19.25, [1176, 878, 40]], [19.5, [1164, 873, 0]], [19.75, [1149, 843, 0]], [20.0, [1101, 810, 0]], [20.15, [1101, 810, 0]], [20.187, [1040, 770, 0]], [20.229, [1000, 730, 0]], [20.27, [930, 670, 0]], [20.3, [800, 560, 0]]],
};
const DOTS = [
  // keyframes, radius
  [[[17.47, [864, 579]], [17.56, [836, 616]], [17.64, [821, 609]], [17.8, [790, 470]], [17.93, [750, 326]], [18.02, [741, 324]], [18.5, [735, 306]], [19.5, [702, 273]], [19.75, [672, 279]], [20.0, [657, 381]], [20.15, [657, 381]], [20.187, [666, 396]], [20.229, [660, 416]], [20.27, [650, 436]]], 11, 6],
  [[[17.47, [1307, 706]], [17.56, [1311, 680]], [17.64, [1307, 670]], [17.77, [1302, 654]], [17.93, [1294, 659]], [18.02, [1290, 650]], [18.1, [1281, 644]], [18.5, [1224, 390]], [19.5, [1218, 282]], [19.75, [1227, 261]], [20.0, [1146, 360]], [20.15, [1146, 360]], [20.187, [1116, 372]], [20.229, [1080, 392]], [20.27, [990, 340]]], 8, 10],
  [[[17.47, [173, 287]], [17.56, [166, 335]], [17.64, [158, 356]], [17.77, [156, 389]], [17.9, [200, 600]], [18.02, [233, 750]], [18.1, [242, 717]], [18.5, [240, 696]], [19.5, [213, 702]], [19.75, [213, 672]], [20.0, [360, 579]], [20.15, [360, 579]], [20.187, [390, 566]], [20.229, [420, 554]], [20.27, [426, 526]]], 7, 7],
];
const LOOPS = [
  // letter, start, dur, rx, ry, seed, turns, dx, dy
  ['V', 17.44, 0.14, 40, 30, 1, 2.2, 0, 0],
  ['L', 17.46, 0.14, 34, 40, 2, 2.0, 0, 0],
  ['E', 17.46, 0.12, 30, 34, 3, 1.8, 0, 0],
  ['O', 17.47, 0.12, 12, 110, 21, 1.0, 0, -40],
  ['L', 17.72, 0.12, 30, 22, 22, 1.4, 0, 0],
  ['V', 19.2, 0.25, 30, 80, 4, 1.2, -15, -40],
  ['O', 19.22, 0.25, 14, 50, 5, 1.1, 0, -30],
  ['L', 19.24, 0.15, 14, 38, 6, 1.1, -20, 44],
  ['E', 19.26, 0.25, 34, 26, 7, 1.3, -10, -10],
  ['V', 19.45, 0.25, 40, 30, 8, 1.3, 10, 0],
  ['L', 19.4, 0.25, 34, 18, -35, 1.05, -30, 30],
  ['E', 19.5, 0.25, 34, 26, 11, 1.3, 0, 0],
  ['V', 19.7, 0.25, 44, 52, 12, 2.2, 0, -20],
  ['O', 19.7, 0.25, 12, 52, 13, 1.1, 2, -50],
  ['L', 19.6, 0.15, 30, 18, -35, 1.05, -30, 25],
  ['E', 19.74, 0.25, 34, 30, 15, 1.3, 0, 0],
];
// Red pen loops, measured: [letter, start, end, angle deg, length, width]. Single elongated loops
// and flicks leaving each letter (not scribbled circles).
const FIN_PEN = [
  ['E', 17.43, 17.6, -120, 70, 34], ['L', 17.43, 17.52, -40, 115, 26], ['V', 17.43, 17.52, 110, 115, 8], ['O', 17.44, 17.52, 130, 95, 6],
  ['V', 17.52, 17.6, 180, 32, 26], ['L', 17.52, 17.6, -20, 42, 20], ['O', 17.53, 17.6, 180, 22, 22],
  ['V', 17.6, 17.7, -80, 62, 30], ['E', 17.6, 17.68, -170, 60, 6], ['O', 17.6, 17.7, 140, 62, 20], ['L', 17.6, 17.68, 0, 42, 16],
  ['V', 17.72, 17.82, 190, 62, 20], ['E', 17.72, 17.82, -150, 52, 40], ['O', 17.72, 17.82, -90, 72, 15], ['L', 17.72, 17.82, -95, 72, 15],
  ['V', 19.2, 19.32, 0, 52, 26], ['O', 19.2, 19.34, -95, 125, 4], ['O', 19.22, 19.34, 60, 62, 30], ['E', 19.22, 19.32, 110, 62, 6], ['L', 19.22, 19.32, -120, 32, 20],
  ['V', 19.44, 19.58, -60, 42, 26], ['O', 19.44, 19.58, -110, 36, 20], ['L', 19.44, 19.58, -50, 32, 20], ['E', 19.42, 19.6, -40, 82, 40],
  ['V', 19.68, 19.84, 150, 62, 20], ['O', 19.7, 19.84, 95, 72, 25], ['L', 19.68, 19.86, 120, 100, 30], ['E', 19.66, 19.86, -150, 170, 110], ['E', 19.72, 19.84, 40, 40, 20],
  ['V', 19.88, 20.0, 10, 42, 32], ['O', 19.88, 20.0, -88, 95, 30], ['L', 19.88, 20.0, 118, 160, 40], ['E', 19.88, 20.0, 0, 40, 26],
  ['O', 20.03, 20.16, 100, 62, 8], ['E', 20.03, 20.16, 180, 82, 30], ['V', 20.05, 20.16, 0, 40, 20],
];
const FINAL_LOOPS = [
  ['O', 6, 80, -2, 1.0, 2, -10],
  ['E', 64, 30, 33, 1.2, -50, -36],
  ['V', 26, 18, 34, 1.2, 0, 0],
];

function smoothLoop(rx, ry, turns, seed, n = 160) {
  const r = rng(Math.abs(seed) + 50);
  const tilt = seed < 0 ? seed * D : (r() - 0.5) * 0.6;
  const a0 = r() * Math.PI * 2;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const a = a0 + u * turns * Math.PI * 2;
    const g = 1 + u * 0.12; // slight spiral so overlapping passes separate
    const px = Math.cos(a) * rx * g;
    const py = Math.sin(a) * ry * g;
    pts.push([px * Math.cos(tilt) - py * Math.sin(tilt), px * Math.sin(tilt) + py * Math.cos(tilt)]);
  }
  return pts;
}

// Catmull-Rom through control points -> dense polyline
function spline(ctrl, n = 18) {
  const out = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)];
    const p1 = ctrl[i];
    const p2 = ctrl[i + 1];
    const p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    for (let k = 0; k < n; k++) {
      const u = k / n;
      const u2 = u * u;
      const u3 = u2 * u;
      out.push([0, 1].map((j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * u + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * u2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * u3)));
    }
  }
  out.push(ctrl[ctrl.length - 1]);
  return out;
}
const BRUSH = [
  // [until t, core strokes [ctrl, width], grey halo strokes [ctrl, width], core blur, halo blur, halo offset]
  [17.246, [
    [[[510, -20], [445, 300], [380, 600]], 34],
    [[[510, -20], [780, 510], [990, 960], [1440, 660]], 36],
    [[[280, 1040], [530, 780], [780, 510]], 30],
  ], [
    [[[60, 340], [160, 270], [260, 285]], 44],
    [[[1120, 160], [1200, 300], [1100, 420], [900, 460]], 40],
    [[[540, 480], [600, 470], [660, 475]], 30],
    [[[360, 600], [380, 620]], 40],
  ], 10, 14, [0, 0]],
  [17.288, [
    [[[460, 390], [260, 480], [140, 660], [190, 880], [320, 920], [460, 840]], 12],
    [[[350, 780], [540, 80], [640, 240], [700, 300]], 11],
    [[[840, 830], [1280, 80], [1420, 660]], 12],
    [[[820, 190], [940, 300], [860, 520]], 10],
    [[[120, 470], [300, 400], [470, 385]], 26],
  ], [
    [[[200, 300], [700, 180], [1200, 120], [1400, 200]], 44],
    [[[220, 960], [600, 900], [900, 560]], 40],
    [[[1180, 200], [1300, 500], [1250, 860]], 40],
  ], 2.5, 12, [14, 10]],
  [17.33, [
    [[[410, 260], [540, 330], [410, 460], [560, 680]], 7],
    [[[830, 220], [940, 330], [1140, 380], [1120, 500], [1020, 450]], 7],
    [[[770, 730], [1000, 700], [1120, 840], [1280, 950], [1380, 880]], 7],
  ], [
    [[[360, 190], [220, 130], [160, 220], [220, 340], [80, 400]], 34],
    [[[380, 250], [510, 320], [380, 450], [530, 670]], 34],
    [[[800, 200], [910, 310], [1110, 360], [1090, 480]], 34],
    [[[750, 700], [980, 670], [1100, 810], [1260, 920]], 34],
  ], 0.8, 6, [-22, -16]],
  [17.372, [
    [[[300, 200], [340, 215], [320, 250], [350, 290]], 7],
    [[[940, 470], [975, 450], [1000, 462]], 6],
    [[[1280, 800], [1300, 830], [1318, 840]], 6],
    [[[140, 1010], [160, 990]], 5],
  ], [], 1.2, 0, [0, 0]],
];
function brushCut(ctx, t) {
  const fr = BRUSH.find(([until]) => t < until);
  if (!fr) return;
  const [, cores, halos, cb, hb, [ox, oy]] = fr;
  if (halos.length) {
    const [hc, hx] = off(1);
    halos.forEach(([ctrl, w]) => fx.strokePartial(hx, spline(ctrl).map(([a, b]) => [a + ox, b + oy]), 0, 1, w, 'rgba(70,68,68,0.32)', true));
    composite(ctx, hc, { blur: hb });
  }
  const [cc, cx] = off(2);
  cores.forEach(([ctrl, w]) => fx.strokePartial(cx, spline(ctrl), 0, 1, w, '#151313', cb < 5));
  composite(ctx, cc, { blur: cb });
}

// Pen 'petal' loop: an elongated loop leaving (ax, ay) at angle `ang` and coming back, drawn twice.
function petal(ax, ay, ang, len, wid, seed) {
  const pts = [];
  const r = rng(seed + 300);
  const w2 = 0.8 + r() * 0.4;
  for (let i = 0; i <= 120; i++) {
    const a = (i / 120) * Math.PI * 2.15;
    const lx = (len * (1 - Math.cos(a))) / 2;
    const ly = (wid / 2) * Math.sin(a) * (i > 60 ? w2 : 1) + noise1(i * 0.15, seed) * wid * 0.12;
    pts.push([ax + lx * Math.cos(ang) - ly * Math.sin(ang), ay + lx * Math.sin(ang) + ly * Math.cos(ang)]);
  }
  return pts;
}
// Measured per frame (484-486): each frame shows a fresh set of big pen loops around the letters.
const PETALS = [
  [20.207, [['V', -95, 260, 170], ['O', 88, 330, 50], ['L', -60, 260, 60], ['E', -92, 250, 50], ['E', 95, 170, 45]]],
  [20.249, [['O', -90, 220, 40], ['V', 55, 330, 70], ['L', -80, 220, 50], ['E', -128, 290, 10], ['L', 100, 90, 70]]],
  [20.29, [['V', 185, 300, 60], ['O', -82, 260, 90], ['O', -30, 400, 70], ['E', -12, 360, 75], ['L', 95, 300, 190], ['O', 60, 300, 30], ['V', -120, 140, 40]]],
];
function finalePetals(ctx, t, pos) {
  const set = PETALS.find(([until]) => t < until);
  if (!set) return;
  set[1].forEach(([ch, ang, len, wid], k) => {
    const [ax, ay] = pos[ch];
    fx.strokePartial(ctx, petal(ax, ay, ang * D, len, wid, k + Math.round(set[0] * 100)), 0, 1, 2, '#e0402e');
  });
}
// Last frame: the letters slam together into a black block with thick ink hooks and big loops.
function finaleCollapse(ctx) {
  [[-125, 400, 130], [-95, 420, 70], [-15, 440, 120], [40, 400, 110], [95, 260, 80], [-150, 260, 60]].forEach(([ang, len, wid], k) => {
    fx.strokePartial(ctx, petal(700, 500, ang * D, len, wid, 90 + k), 0, 1, 2, '#e0402e');
  });
  ctx.fillStyle = '#141010';
  ctx.fillRect(630, 430, 150, 140);
  [['L', 655, 565, -0.05], ['V', 680, 485, 0.08], ['E', 760, 560, -0.06], ['O', 722, 515, 0]].forEach(([ch, x, y, r]) => letter(ctx, ch, x, y, 150, '#141010', r));
  fx.strokePartial(ctx, spline([[675, 315], [600, 300], [535, 340], [510, 430], [485, 520], [462, 535]], 10), 0, 1, 22, '#141010');
  fx.strokePartial(ctx, spline([[832, 664], [824, 520], [821, 380], [850, 325], [911, 315], [945, 360]], 10), 0, 1, 22, '#141010');
  [[690, 470, 60, 30, 20], [760, 580, 70, 40, -30]].forEach(([x, y, rx, ry, a], k) => {
    fx.strokePartial(ctx, petal(x, y, a * D, rx * 2, ry, 120 + k), 0, 1, 2, '#e0402e');
  });
}

function sceneFinale(ctx, t, f) {
  ctx.fillStyle = '#dededd';
  ctx.fillRect(0, 0, W, H);
  const gg = ctx.createLinearGradient(0, 0, W, H);
  gg.addColorStop(0, 'rgba(255,255,255,0.2)');
  gg.addColorStop(1, 'rgba(120,120,135,0.18)');
  ctx.fillStyle = gg;
  ctx.fillRect(0, 0, W, H);
  // ink-brush strokes at the cut to paper (frames 413-416, measured): huge and blurred, then
  // sharpening and shrinking into small hooks as the letters scatter in
  if (t < 17.372) brushCut(ctx, t);
  const grow = ease.inOutCubic(inv(19.75, 20.05, t));
  const size = t < 20.15 ? lerp(56, 74, grow) : kf(t, [[20.15, 74], [20.187, 83], [20.229, 111], [20.27, 139], [20.3, 190]]);
  if (t >= 20.29) {
    finaleCollapse(ctx);
    return;
  }
  const pos = {};
  Object.keys(FIN).forEach((ch) => {
    const keys = [];
    FIN[ch].forEach(([tt, v]) => keys.push([tt, v, tt < 18.1 ? 'linear' : 'inOutCubic']));
    const [x, y, r] = kf(t, keys);
    pos[ch] = [x, y];
    if (t < FIN[ch][0][0] - 0.02) return;
    const fly = 1 - inv(17.42, 17.6, t);
    if (fly > 0) {
      ctx.save();
      ctx.filter = `blur(${3.5 * fly * S}px)`;
    }
    letter(ctx, ch, x, y - 13 * grow, size, '#3a1a16', r * D);
    if (fly > 0) ctx.restore();
  });
  DOTS.forEach(([k, r0, r1]) => {
    const hk = [];
    if (t < k[0][0] - 0.03) return;
    k.forEach(([tt, v]) => hk.push([tt, v, tt < 18.1 ? 'linear' : 'inOutCubic']));
    const [x, y] = kf(t, hk);
    if (t > 20.25 && r0 !== 11) {
      // the outer dots smear into small black squiggles
      const sq = r0 === 8 ? [[x - 22, y + 4], [x - 8, y - 10], [x + 6, y + 6], [x + 22, y - 6], [x + 30, y + 10]] : [[x - 10, y - 2], [x - 2, y + 6], [x + 8, y - 4], [x + 12, y + 2]];
      fx.strokePartial(ctx, spline(sq, 8), 0, 1, r0 === 8 ? 9 : 6, '#1a1212', true);
      return;
    }
    const r = t < 17.9 ? 4 : r0 === 11 ? kf(t, [[18.0, 11], [18.4, 4], [18.75, 7], [19.5, 6], [20.0, 7]]) : r0 === 8 ? kf(t, [[18.0, 8], [18.25, 4], [18.5, 10], [18.75, 4], [19.5, 6], [19.8, 9]]) : lerp(r0, r1, inv(19.2, 19.7, t));
    dot(ctx, x, y, r * (t > 19.2 && t < 19.4 ? 0.5 : 1) * lerp(1, 1.1, grow), '#2a1714');
  });
  FIN_PEN.forEach(([ch, t0, t1, ang, len, wid], k) => {
    if (t < t0 || t > t1 + 0.05) return;
    const [ax, ay] = pos[ch];
    const d = len < 90 ? 0.04 : 0.07;
    fx.strokePartial(ctx, petal(ax, ay, ang * D, len, wid, k + 40), inv(t1, t1 + 0.05, t), inv(t0, t0 + d, t), 1.7, '#e0402e');
  });
  if (t > 20.165) finalePetals(ctx, t, pos);
  if (t > 19.95 && t < 20.165) {
    // diagonal pen tail from the upper left into the L
    const [lx, ly] = pos.L;
    const tail = Array.from({ length: 24 }, (_, i) => { const u = i / 23; return [lerp(lx - 140, lx + 4, u) + Math.sin(u * Math.PI) * 30, lerp(ly - 120, ly + 18, u)]; });
    fx.strokePartial(ctx, tail, 0, inv(19.95, 20.08, t), 1.6, '#e0402e');
    if (t > 20.0) {
      const [ex, ey] = pos.E;
      ctx.fillStyle = '#e0402e';
      ctx.beginPath();
      ctx.moveTo(ex + 22, ey - 8);
      ctx.lineTo(ex + 44, ey + 2);
      ctx.lineTo(ex + 24, ey + 14);
      ctx.closePath();
      ctx.fill();
    }
    fx.strokePartial(ctx, smoothLoop(12, 10, 1.2, 77).map(([a, b]) => [a + lx + 12, b + ly + 26]), 0, inv(20.05, 20.15, t), 1.6, '#e0402e');
  }
  // black hook strokes
  if (t > 17.63 && t < 17.77) {
    const pts = [];
    for (let i = 0; i <= 30; i++) pts.push([830 + Math.sin((i / 30) * Math.PI) * 30, 300 + i * 3.4]);
    fx.strokePartial(ctx, pts, inv(17.71, 17.77, t), inv(17.63, 17.69, t), 7, '#141212', true);
  }
  if (t > 17.86 && t < 18.02) {
    const pts = [];
    for (let i = 0; i <= 40; i++) pts.push([150 + Math.sin((i / 40) * Math.PI * 1.2) * 50, 420 + i * 5.5]);
    fx.strokePartial(ctx, pts, inv(17.94, 18.02, t), inv(17.86, 17.92, t), 8, '#141212', true);
  }
}

// ---------------------------------------------------------------------
const TIMELINE = [
  [0, 0.68, sceneOpen],
  [0.68, 1.96, sceneType],
  [1.96, 3.82, sceneSparkle],
  [3.82, 6.29, sceneProfile],
  [6.29, 8.3, sceneRing],
  [8.3, 9.13, sceneAction],
  [9.13, 9.84, sceneStripA],
  [9.84, 10.51, sceneIntention],
  [10.51, 11.01, sceneStripB],
  [11.01, 11.85, sceneCuriosity],
  [11.85, 13.76, sceneScatter],
  [13.76, 15.89, sceneHand],
  [15.89, 17.2, sceneLove],
  [17.2, 99, sceneFinale],
];

function renderFrame(ctx, t, f) {
  ctx.save();
  const sc = TIMELINE.find(([a, b]) => t >= a && t < b) || TIMELINE[TIMELINE.length - 1];
  sc[2](ctx, t, f);
  ctx.restore();
  const isDark = (t > 3.78 && t < 5.7) || (t > 8.3 && t < 9.13) || (t > 9.84 && t < 10.51) || (t > 11.01 && t < 11.85) || (t > 13.76 && t < 15.89) || (t > 16.2 && t < 16.52) || (t > 16.77 && t < 17.18);
  const figure = (t > 3.82 && t < 6.3) || (t > 13.76 && t < 15.89);
  fx.grain(ctx, f, t > 15.6 && t < 15.89 ? 0.07 : t > 5.9 && t < 6.3 ? 0.07 : figure ? 0.1 : isDark ? 0.15 : 0.1);
  if (isDark) fx.mottle(ctx, f, figure ? 0.5 : 1);
  fx.vignette(ctx, 0.1, '0,0,0', 0.6);
}

module.exports = { renderFrame, TIMELINE, setScale, preload };
