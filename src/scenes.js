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

function sceneType(ctx, t, f) {
  // neutral grey paper, shading darker toward the left edge
  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(0, 0, W, H);
  const pg = ctx.createLinearGradient(0, 0, 760, 0);
  pg.addColorStop(0, 'rgba(70,66,70,0.17)');
  pg.addColorStop(1, 'rgba(70,66,70,0)');
  ctx.fillStyle = pg;
  ctx.fillRect(0, 0, W, H);
  const x0 = kf(t, [[0.68, 100], [0.8, 72, 'outCubic'], [1.96, 42, 'linear']]);
  const y0 = 540;
  const [sx, sy] = shake(t, 2.5, 1, 4);

  // ghost cursive, out of focus, drifting right across the top
  if (t > 0.73 && t < 1.06) {
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
  // long pen stroke down the left edge
  if (t > 0.77 && t < 0.815) fx.strokePartial(ctx, [[88, 380], [92, 600], [96, 850], [100, 1080]], 0, 1, 4, '#3a3634');
  if (t > 0.815 && t < 0.855) fx.strokePartial(ctx, [[90, 980], [96, 1030], [104, 1080]], 0, 1, 4, '#3a3634');
  // handwritten signature below the line
  if (t > 0.74 && t < 1.06) {
    const sh = inv(0.92, 1.0, t);
    const pts = SIGNATURE.map(([a, b]) => [a * 1.15 + 190 + sh * 100, b * 1.35 + 760 - sh * 40]);
    const col = mixHex('#5f5957', '#4a2a22', sh);
    fx.strokePartial(ctx, pts, Math.max(0, inv(1.0, 1.06, t)), inv(0.74, 0.79, t), 3.8, col);
  }
  if (t > 0.81 && t < 0.855) fx.strokePartial(ctx, [[604, 206], [560, 360], [524, 500]], 0, 1, 4, '#2e2a28');
  // long brown arc on the right with a little tail (one frame), then a big J loop
  if (t > 1.065 && t < 1.105) {
    const arc = [];
    for (let i = 0; i <= 40; i++) {
      const u = i / 40;
      arc.push([960 + Math.sin(u * Math.PI * 0.9) * 95 - u * 70, lerp(0, 700, u)]);
    }
    fx.strokePartial(ctx, [...arc, ...smoothPts([[930, 715], [880, 722], [850, 735], [820, 724], [790, 745], [770, 760]], 6)], 0, 1, 3.6, PEN);
    penPath(ctx, [[722, 60], [716, 140], [730, 220], [748, 250]], 3.4, PEN);
  }
  if (t > 1.105 && t < 1.147) {
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
  if (t > 1.2 && t < 1.42) {
    const xa = wordX(4);
    const xb = wordX(6) - 12;
    const fade = inv(1.36, 1.42, t);
    const loop = fx.loopPoints(5, 150, 50, 0.85).map(([a, b]) => [a + wordX(5) + 80, b + 548]);
    fx.strokePartial(ctx, loop, fade, inv(1.2, 1.27, t), 4.2, PEN);
    fx.strokePartial(ctx, [[xb + 30, 560], [xb - 20, 640], [xb - 70, 720]], fade, inv(1.28, 1.36, t), 3.4, PEN);
  }
  // single-frame pen gestures: open loop round "you're", a long rule over the line, a drop, a tick
  if (t > 1.4 && t < 1.44) penPath(ctx, [[675, 472], [760, 462], [880, 470], [967, 520], [940, 575], [820, 580], [720, 560]], 4, PEN);
  if (t > 1.44 && t < 1.48) penPath(ctx, [[112, 500], [104, 480], [118, 470], [300, 468], [520, 466], [742, 472]], 4, PEN);
  if (t > 1.48 && t < 1.52) penPath(ctx, [[121, 0], [121, 200], [122, 400], [124, 468], [136, 478]], 4.5, PEN);
  if (t > 1.52 && t < 1.56) penPath(ctx, [[112, 22], [114, 60], [116, 92]], 4, PEN);
  ctx.restore();
  composite(ctx0, lc, { blur: defocus });
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
  [3.0, -70, 505, [-0.78, 0.71, 2.2, 3.0], [900, 760, 500, 500], 0.035],
  [3.5, -70, 505, [-0.76, 0.825, 2.3, 3.0], [900, 820, 500, 500], 0.03],
  [3.71, -70, 505, [-0.75, 0.84, 2.3, 3.0], [900, 820, 500, 500], 0.03],
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
  const m = kf(t, [[2.064, 0.35], [2.25, 0.72], [2.5, 1], [3.0, 1], [3.5, 0.85]]);
  const g = ctx.createRadialGradient(-100, 540, 0, -100, 540, 1500);
  [[0, 1], [400, 0.87], [600, 0.68], [800, 0.4], [1000, 0.24], [1200, 0.12], [1500, 0]].forEach(([d, a]) => g.addColorStop(d / 1500, `rgba(30,22,22,${a * m})`));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const v = kf(t, [[2.064, 0.08], [2.25, 0.18], [2.5, 0.25], [3.0, 0.34], [3.5, 0.45], [3.62, 0.55]]);
  const tg = ctx.createLinearGradient(0, 0, 0, H);
  tg.addColorStop(0, `rgba(30,22,22,${v})`);
  tg.addColorStop(0.35, 'rgba(30,22,22,0)');
  tg.addColorStop(0.65, 'rgba(30,22,22,0)');
  tg.addColorStop(1, `rgba(30,22,22,${v})`);
  ctx.fillStyle = tg;
  ctx.fillRect(0, 0, W, H);
  const rc = kf(t, [[3.0, 0], [3.5, 1], [3.62, 1.1]]);
  if (rc > 0) {
    ctx.save();
    ctx.translate(850, 500);
    ctx.scale(1.2, 1);
    const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, 760);
    sg.addColorStop(0, 'rgba(30,22,22,0)');
    sg.addColorStop(0.55, 'rgba(30,22,22,0)');
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
  // [t, cx, cy, radius, centre colour] measured from the source
  const wk = [
    [3.6, 900, 470, 950, '#e0d8d4'],
    [3.67, 850, 480, 850, '#dab1a1'],
    [3.71, 720, 580, 620, '#c77b60'],
    [3.75, 520, 560, 520, '#c75731'],
    [3.79, 400, 560, 330, '#c42418'],
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
  const dark = '#161212';
  ctx.fillStyle = dark;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1.05, 1);
  const lg = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  lg.addColorStop(0, col);
  lg.addColorStop(0.3, col);
  lg.addColorStop(0.65, mixHex(col, dark, 0.45));
  lg.addColorStop(1, dark);
  ctx.fillStyle = lg;
  ctx.fillRect(-r * 1.1, -r * 1.1, r * 2.2, r * 2.2);
  ctx.restore();
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
  if (t < 3.6 && t >= 2.064) sparkleShade(ctx, t);
  if (t >= 3.6) warmLight(ctx, t);

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
  x2.shadowBlur = 22 * S;
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
  x2.lineWidth = rim > 0 ? 10 : t > 3.68 ? 2.5 : 5;
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
    const out = ease.inQuad(inv(3.2, 3.27, t));
    const ib = kf(t, [[2.064, 1.5], [2.2, 4], [2.3, 3], [2.45, 0]]);
    const [ic, ix] = off(0);
    FLOATERS.forEach(([n, w, r, ph]) => {
      const [x, y] = floatPos(n, t);
      const dx = noise1(t * 1.6, ph) * 6;
      const dy = noise1(t * 1.3, ph + 5) * 6;
      drawSprite(ix, n, x + dx, y + dy, w * (1 - out), r + Math.sin(t * 5 + ph * 2) * 0.12);
    });
    composite(ctx, ic, { blur: ib });
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
  const heat = traced ? thermalImage(`head${traced.f}`, traced.mask, { depth: 34, base: 0.3, gain: 0.42, hotMask: traced.hot, hotGain: 0.55, front: 0.12, hot: [[0.62, 0.18, 190, 0.12]] }) : thermal('head', 'heat');
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
    else if (t < 4.9) x.filter = `hue-rotate(${-16 * (1 - inv(4.35, 4.9, t))}deg) saturate(${1 + 0.15 * (1 - inv(4.35, 4.9, t))}) brightness(${lerp(0.94, 1, inv(4.35, 4.9, t))})`;
    else if (traced) {
      const bri = kf(t, [[4.35, 0.87], [5.5, 0.87], [5.85, 0.55], [6.0, 0.45], [6.05, 0.4], [6.13, 0.33]]);
      const sep = kf(t, [[5.5, 0], [5.85, 0.35], [6.0, 0.55], [6.13, 0.7]]);
      const sat = kf(t, [[4.35, 1.15], [5.5, 1.15], [5.85, 1.2], [6.0, 1.0], [6.13, 0.8]]);
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
    const wash = traced ? 0.45 * (1 - inv(4.3, 4.75, t)) * clamp((t - 3.9) / 0.15) : 0;
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
        x.globalAlpha = (wash / 0.45) * 0.85;
        x.filter = `blur(${6 * S}px)`;
        x.drawImage(silhouette(traced.hot, '#f6efe2'), 0, 0, W, H);
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
  composite(ctx, c, { blur: (1 - settle) * 16 });

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
  // red contour rings over the blurred head during the intro
  if (t > 3.93 && t < 4.2) {
    ctx.save();
    ctx.filter = `blur(${4 * S}px)`;
    ctx.filter = `blur(${14 * S}px)`;
    ctx.strokeStyle = `rgba(160,24,24,${0.45 * Math.sin(Math.PI * inv(3.93, 4.2, t))})`;
    ctx.lineWidth = 40;
    ctx.lineWidth = 10;
    [[0.6, 1], [0.8, 0.8], [1, 0.6]].forEach(([k]) => {
      ctx.beginPath();
      ctx.ellipse(hx + 360, hy + 320, 230 * k, 260 * k, 0.2, 0, 7);
      ctx.stroke();
    });
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
  // amber comet streak during the intro
  if (t < 4.12) {
    const q = inv(3.82, 4.1, t);
    const [c3, x3] = off(2);
    x3.strokeStyle = 'rgba(255,160,60,0.8)';
    x3.lineWidth = 16;
    x3.beginPath();
    x3.moveTo(lerp(380, 300, q), lerp(540, 120, q));
    x3.lineTo(lerp(700, 560, q), lerp(540, 240, q));
    x3.stroke();
    composite(ctx, c3, { blur: 12, alpha: 1 - inv(4.0, 4.12, t) });
  }
  // thermal hotspot dot early, short orbit, then short thick white strokes behind the head
  if (t > 3.95 && t < 4.3) dot(ctx, 1100 + drift * 0.2, 400, 9, '#ffd84a');
  if (t > 3.9 && t < 4.14) {
    ctx.save();
    ctx.filter = `blur(${18 * S}px)`;
    dot(ctx, 410, 186, 75, `rgba(192,128,32,${Math.sin(Math.PI * inv(3.9, 4.14, t))})`);
    ctx.restore();
  }
  if (t > 4.34 && t < 4.46) {
    const q = ease.outCubic(inv(4.34, 4.4, t));
    const q2 = ease.inCubic(inv(4.4, 4.46, t));
    ctx.save();
    ctx.strokeStyle = 'rgba(250,248,244,0.95)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(960 + drift, 430, 370, 92, -0.3, Math.PI * 2 * q2, Math.PI * 2 * q);
    ctx.stroke();
    ctx.restore();
  }
  if (t > 4.55 && t < 4.9) {
    const a0 = inv(4.82, 4.9, t);
    fx.strokePartial(ctx, fx.loopPoints(71, 26, 60, 0.55).map(([a, b]) => [a + 1165, b + 420]), a0, inv(4.6, 4.66, t), 7, CREAM);
    fx.strokePartial(ctx, fx.loopPoints(72, 100, 44, 1.0).map(([a, b]) => [a + 1150, b + 686]), a0, inv(4.62, 4.72, t), 7, CREAM);
  }
  if (t > 4.45 && t < 4.6) dot(ctx, 888, 738, 5, '#fff');
  if (t > 4.85 && t < 5.25) dot(ctx, 1074, 384, 5, '#fff');
  ctx.restore();

  // text
  const intro = inv(3.82, 4.0, t);
  let parts;
  if (t < 5.22) parts = [{ t: 'you', c: CREAM }, { t: 'dont.', c: CREAM }];
  else if (t < 5.36) parts = [{ t: 'you', c: CREAM }];
  else if (t < 5.7) parts = [{ t: 'you', c: CREAM }, { t: 'just', c: mixHex(CREAM, '#cfc8c4', inv(5.56, 5.7, t)) }];
  else if (t < 5.97) {
    const g = inv(5.7, 5.92, t);
    const base = mixHex('#d8d0cc', '#8f8786', g);
    parts = [{ t: 'you', c: base }, { t: 'just', c: base }, { t: 'show', c: mixHex('#a09694', '#6a6260', g) }];
  } else {
    const tc = mixHex('#4e4a48', '#3d2620', inv(6.0, 6.15, t));
    parts = [{ t: 'you', c: tc }, { t: 'just', c: tc }, { t: 'show', c: tc }, { t: 'it.', c: tc }];
  }
  fx.words(ctx, parts, 200, 538, BODY, { blur: (1 - intro) * 9 });
  if (t < 5.2 && blinkOn(t - 3.82, 0.42)) fx.cursor(ctx, 640, 540, 44, 'rgba(160,156,150,0.8)', 3);
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

function sceneRing(ctx, t, f) {
  // 6.30-6.38: grey gradient, then fire wipe rising from the bottom
  if (t < 6.32) {
    ctx.fillStyle = '#c9c8c8';
    ctx.fillRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, 'rgba(255,255,255,0.7)');
    g.addColorStop(0.6, 'rgba(120,118,118,0.2)');
    g.addColorStop(1, 'rgba(30,28,28,0.9)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    return;
  }
  if (t < 6.37) {
    ctx.fillStyle = '#121112';
    ctx.fillRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, 600, 0, H);
    g.addColorStop(0, 'rgba(18,17,18,0)');
    g.addColorStop(0.375, '#8a0a0a');
    g.addColorStop(0.625, '#ff6a10');
    g.addColorStop(0.833, '#ffd070');
    g.addColorStop(1, '#fff4e0');
    ctx.fillStyle = g;
    ctx.fillRect(0, 600, W, H - 600);
    return;
  }
  if (!BALL) BALL = ballKeys();
  flat(ctx, '#e2e1df', 'rgba(80,76,74,0.18)', W, H);
  const zoom = kf(t, [
    [6.37, 1.7],
    [6.9, 1.0, 'outCubic'],
    [8.0, 1.06, 'inOutQuad'],
    [8.3, 2.4, 'inExpo'],
  ]);
  const camX = kf(t, [[8.0, 0], [8.3, -560, 'inExpo']]);
  const camR = kf(t, [[6.37, 0.35], [6.9, 0, 'outCubic']]);
  const [sx, sy] = shake(t, 3, 1, 33);

  const [c, x] = off(0);
  x.save();
  camera(x, { x: sx + camX - 180 * (1 - inv(6.5, 7.0, t)), y: sy - 60 * (1 - inv(6.5, 7.0, t)), z: zoom, r: camR, cx: 770, cy: 600 });
  const items = ringAt(t);
  const hitAmt = (name) => {
    let a = 0;
    HITS.forEach(([ht, n]) => {
      if (n === name) a = Math.max(a, 1 - Math.abs(t - ht - 0.03) / (n === 'heart' || n === 'cap' ? 0.1 : 0.06));
    });
    return clamp(a);
  };
  items
    .slice()
    .sort((a, b) => b.z - a.z)
    .forEach((it) => {
      const w = RING_W[it.name] * it.s;
      const hit = hitAmt(it.name);
      const rot = noise1(t * 2 + it.i, it.i) * 0.06 + (it.name === 'skateboard' ? -0.45 : 0);
      drawSprite(x, it.name, it.x, it.y, w * (1 + hit * 0.1), rot);
      if (hit > 0) drawSprite(x, it.name, it.x, it.y, w * (1 + hit * 0.1), rot, hit * 0.8, { silhouette: '#ff7a20' });
    });
  HITS.forEach(([ht, n], k) => {
    const [px, py] = iconPos(ht, n);
    flash(x, px, py, 1 - Math.abs(t - ht - 0.02) / 0.07, k + 3);
  });
  // black ink scribble dragged across the heart after its hit
  if (t > 7.3 && t < 7.52) {
    const [hx, hy] = iconPos(7.31, 'heart');
    const pts = [];
    for (let i = 0; i <= 40; i++) pts.push([hx - 190 + i * 9.5, hy - 85 + Math.sin(i * 0.55) * 22]);
    fx.strokePartial(x, pts, inv(7.46, 7.52, t), inv(7.3, 7.33, t), 60, '#141010', true);
  }
  if (t > 6.8 && t < 7.28) {
    const arc = [];
    for (let i = 0; i <= 40; i++) {
      const u = i / 40;
      arc.push([lerp(580, 1060, u), 450 - Math.sin(u * Math.PI) * 60]);
    }
    fx.strokePartial(x, arc, inv(7.2, 7.28, t), inv(6.8, 6.98, t), 18, 'rgba(26,22,22,0.85)', true);
  }
  if (t > 7.42 && t < 7.85) {
    const arc = [];
    for (let i = 0; i <= 50; i++) {
      const u = i / 50;
      arc.push([lerp(430, 1120, u), 330 - Math.sin(u * Math.PI) * 120]);
    }
    const [ac, ax] = off(3);
    fx.strokePartial(ax, arc, inv(7.65, 7.85, t), inv(7.42, 7.6, t), 30, 'rgba(30,28,28,0.6)', true);
    x.save();
    x.setTransform(S, 0, 0, S, 0, 0);
    composite(x, ac, { blur: 5 });
    x.restore();
  }
  if (t > 7.48 && t < 7.6) {
    const [cx2, cy2] = iconPos(7.5, 'cash');
    const r = rng(17);
    x.save();
    x.strokeStyle = '#1a1414';
    x.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const an = -1.2 + r() * 1.4;
      x.lineWidth = 6 + r() * 4;
      x.beginPath();
      x.moveTo(cx2 + 120 + Math.cos(an) * 40, cy2 + Math.sin(an) * 40);
      x.lineTo(cx2 + 120 + Math.cos(an) * 170, cy2 + Math.sin(an) * 170);
      x.stroke();
    }
    x.restore();
  }
  if (t > 7.55 && t < 7.85) {
    const [cx2, cy2] = iconPos(7.75, 'cash');
    flash(x, cx2, cy2, 0.6 * (1 - inv(7.7, 7.85, t)), 99);
  }
  if (t > 6.5) {
    const pos = kf(t, BALL);
    const trail = [];
    for (let i = 0; i <= 10; i++) trail.push(kf(t - i * 0.022, BALL));
    inkBall(x, pos[0], pos[1], 26, trail);
  }
  x.restore();
  const tr = inv(6.37, 6.5, t);
  if (tr < 1) {
    ctx.fillStyle = '#2a2827';
    ctx.fillRect(0, 0, W, H);
    mosaic(ctx, c, lerp(40, 8, tr), { blur: lerp(24, 4, tr), alpha: lerp(0.8, 1, tr) });
    return;
  }
  composite(ctx, c, { blur: t > 8.15 ? (t - 8.15) * 60 : 0 });
}

// =====================================================================
// 6. Word cards: action. / intention. / curiosity. (dark)
// =====================================================================
function typed(ctx, word, t0, t, x, y, curX, hold = 0) {
  if (t < t0) return;
  const wFull = fx.measure(ctx, word, CARD);
  if (t < t0 + 0.05) {
    // solid white selection block first
    ctx.fillStyle = CREAM;
    ctx.fillRect(x - 96, y - 45, wFull + 70, 90);
    return;
  }
  const p = inv(t0 + 0.05 + hold, t0 + 0.16 + hold, t);
  fx.text(ctx, word, x, y, CARD, CREAM, { blur: p < 0.3 && !hold ? 2.5 : 0, glow: 'rgba(243,239,232,0.35)', glowBlur: 6 });
  // trailing block shrinks into the caret, which stays bright
  const cw = lerp(120, 12, ease.outCubic(p));
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
  const q = t - 8.3;
  const pos = kf(t, [[8.3, [640, 430]], [8.4, [612, 458]], [8.45, [580, 490], 'outCubic'], [8.55, [532, 525]], [8.75, [512, 470], 'inOutCubic'], [9.0, [375, 590], 'inOutCubic'], [9.13, [360, 600]]]);
  const rot = kf(t, [[8.3, -0.05], [8.45, -0.15, 'outCubic'], [8.55, -0.12], [8.75, 1.88, 'inOutCubic'], [9.0, -0.35, 'inOutCubic'], [9.13, -0.38]]);
  const width = kf(t, [[8.3, 450], [8.55, 405], [8.75, 700], [9.0, 900], [9.13, 940]]);
  const sy = kf(t, [[8.3, 1], [8.8, 1], [8.95, 0.24, 'inOutCubic'], [9.13, 0.22]]);
  const blur = kf(t, [[8.3, 10], [8.4, 2], [8.48, 0], [8.65, 0], [8.72, 3], [8.78, 0], [8.88, 3], [8.95, 0]]);
  const [c, x] = off(0);
  x.save();
  x.filter = 'saturate(0.6) brightness(0.95)';
  drawSprite(x, 'camera', pos[0], pos[1], width, rot, 1, { sy });
  x.globalCompositeOperation = 'screen';
  drawSprite(x, 'camera', pos[0], pos[1], width, rot, 0.32, { sy, silhouette: '#9a9a9a' });
  x.restore();
  // white zigzag + red slashes at the cut
  if (q < 0.14) {
    const zz = [[880, 420], [1000, 540], [890, 640], [1000, 760], [895, 870], [990, 1000]];
    fx.strokePartial(x, zz, inv(8.38, 8.44, t), inv(8.3, 8.33, t), 12, CREAM);
    x.save();
    x.lineWidth = 12;
    burst(x, 760, 600, q / 0.3, 8, ['#e8231d']);
    burst(x, 760, 600, q / 0.3, 18, ['#e8231d']);
    x.restore();
  }
  const st = kf(t, [[8.3, 1.0], [8.4, 0.85, 'outBack'], [8.6, 0.85], [8.75, 2.3], [9.13, 0.8]]);
  const sxs = kf(t, [[8.6, 1], [8.75, 0.36, 'outCubic'], [8.85, 0.36], [8.95, 2.6, 'outCubic']]);
  x.save();
  const anchor = kf(t, [[8.3, [650, 380]], [8.55, [650, 420]], [8.75, [540, 170]], [9.0, [600, 200]], [9.13, [610, 195]]]);
  x.translate(anchor[0], anchor[1]);
  x.rotate(kf(t, [[8.3, 0.3], [8.6, 0.1], [8.75, 0], [9.0, -0.36]]));
  x.scale(sxs, 1 / Math.sqrt(sxs));
  fx.starPath(x, 0, 0, 170 * st, 0, 0.1);
  x.fillStyle = '#e8231d';
  x.shadowColor = 'rgba(255,40,30,0.6)';
  x.shadowBlur = 20 * S;
  x.fill();
  x.restore();
  composite(ctx, c, { blur });
  if (t > 8.95) fx.strokePartial(ctx, [[760, 485], [960, 478]], 0, inv(8.95, 9.02, t), 4, CREAM);
  sparks(ctx, t, 2, 7);
  typed(ctx, 'action.', 8.3, t, 966, 540, 1300);
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

function sceneStripA(ctx, t, f) {
  flat(ctx, '#e3e2e0', 'rgba(80,76,74,0.15)', W, H);
  const ox = kf(t, [[9.13, 420], [9.6, 250, 'linear'], [9.75, -350, 'inQuad'], [9.84, -700]]);
  const [c, x] = off(0);
  row(x, ROW_A, ox, 560, t);
  composite(ctx, c, { blur: t > 9.62 ? (t - 9.62) * 60 : t < 9.2 ? (9.2 - t) * 60 : 0 });
  if (t > 9.65) speedLines(ctx, t, 7, 8);
}

function sceneIntention(ctx, t, f) {
  fx.dark(ctx, '#141313');
  const [c, x] = off(1);
  // ribbon: thin tail from bottom-left into the book; small wedge first, then a wide beam to the top
  const spine = (u) => {
    const p0 = [-60, 1000];
    const p1 = [300, 640];
    const p2 = [1250, -200];
    const a = (1 - u) * (1 - u);
    const b = 2 * (1 - u) * u;
    const cc = u * u;
    return [a * p0[0] + b * p1[0] + cc * p2[0], a * p0[1] + b * p1[1] + cc * p2[1]];
  };
  const u1 = kf(t, [[9.84, 0.3], [10.0, 0.62, 'outCubic'], [10.18, 0.66], [10.28, 1.0, 'inOutCubic']]);
  const u0 = lerp(0, 0.2, ease.inCubic(inv(10.1, 10.51, t)));
  const wmax = kf(t, [[9.84, 60], [10.0, 200], [10.18, 220], [10.28, 900, 'inOutCubic']]);
  x.fillStyle = '#e2211b';
  x.beginPath();
  const N = 50;
  const wAt = (k) => lerp(36, wmax, Math.pow(k, 1.6));
  for (let i = 0; i <= N; i++) {
    const k = i / N;
    const [px, py] = spine(lerp(u0, u1, k));
    const w = wAt(k);
    if (i === 0) x.moveTo(px - w * 0.55, py - w * 0.35);
    else x.lineTo(px - w * 0.55, py - w * 0.35);
  }
  for (let i = N; i >= 0; i--) {
    const k = i / N;
    const [px, py] = spine(lerp(u0, u1, k));
    const w = wAt(k);
    x.lineTo(px + w * 0.25, py + w * 0.15);
  }
  x.closePath();
  x.shadowColor = 'rgba(255,40,30,0.45)';
  x.shadowBlur = 25 * S;
  x.fill();
  x.shadowBlur = 0;
  const bp = kf(t, [[9.84, [730, 525]], [9.9, [700, 520]], [10.0, [440, 500], 'outCubic'], [10.51, [425, 505]]]);
  const bw = kf(t, [[9.84, 470], [10.1, 500], [10.51, 520]]);
  if (t < 9.98) x.filter = 'brightness(0.7)';
  drawSprite(x, 'book', bp[0], bp[1], bw, kf(t, [[9.84, -0.25], [10.0, -0.06]]) + noise1(t * 2, 4) * 0.04, 1, { shadow: 'rgba(255,40,30,0.25)', shadowBlur: 30 });
  x.filter = 'none';
  composite(ctx, c, { blur: (1 - ease.outCubic(inv(9.84, 9.98, t))) * 25 });
  if (t < 9.97) {
    // grainy red band sweeping in from the top right + bold slash at the bottom
    const a = 1 - inv(9.92, 9.97, t);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.filter = `blur(${10 * S}px)`;
    ctx.beginPath();
    ctx.moveTo(960, 0);
    ctx.lineTo(1440, 0);
    ctx.lineTo(260, 1080);
    ctx.lineTo(0, 1080);
    ctx.lineTo(0, 700);
    ctx.closePath();
    ctx.fillStyle = 'rgba(200,26,20,0.35)';
    ctx.fill();
    ctx.filter = 'none';
    ctx.clip();
    fx.grain(ctx, f + 11, 0.8);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = '#e2211b';
    ctx.beginPath();
    [[594, 1080], [1074, 672], [990, 760], [1050, 742], [960, 840], [1010, 830], [880, 940], [700, 1080]].forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)));
    ctx.fill();
    ctx.beginPath();
    fx.strokePartial(ctx, Array.from({ length: 16 }, (_, i) => [lerp(774, 1014, i / 15), lerp(372, 252, i / 15)]), 0, 1, 10, '#e2211b', true);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    fx.grain(ctx, f + 5, 0.3);
  }
  sparks(ctx, t, 4, 6);
  typed(ctx, 'intention.', 9.95, t, 834, 540, 1322);
}

const ROW_B = [
  ['heart', -1000, 0, 320, 2],
  ['cap', -700, -10, 330, 3],
  ['controller', -320, 0, 340, 4],
  ['coin', 0, 0, 380, 5],
];

function sceneStripB(ctx, t, f) {
  flat(ctx, '#e3e2e0', 'rgba(80,76,74,0.15)', W, H);
  const ox = kf(t, [[10.51, 1000], [10.58, 985], [10.75, 624, 'inOutCubic'], [11.01, 300, 'inCubic']]);
  const [c, x] = off(0);
  const catRel = kf(t, [[10.51, 100], [10.75, 466]]);
  const camRel = kf(t, [[10.51, 900], [10.75, 610]]);
  drawSprite(x, 'camera', ox + camRel, 540, 330, 0);
  drawSprite(x, 'cat', ox + catRel, 560, 520, -0.15, 1, { sy: 0.75 });
  row(x, ROW_B, ox, 560, t);
  composite(ctx, c, { blur: t < 10.56 ? 6 : t > 10.92 ? (t - 10.92) * 50 : 0 });
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
  if (t > 11.72) {
    // dim greyscale negative of the icon row before the cut
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
  const pan = kf(t, [[11.55, 0], [11.72, -200, 'inCubic']]);
  ctx.save();
  ctx.translate(pan, 0);
  const vin = ease.outBack(inv(11.01, 11.15, t));
  const vx = kf(t, [[11.01, 500], [11.08, 496], [11.25, 430, 'outCubic']]);
  drawSprite(ctx, 'vinyl', vx, 545, 400 * lerp(0.85, 1, vin), noise1(t, 9) * 0.05);
  if (t < 11.16) {
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
  if (t > 11.1) note(ctx, 'quarter', 1044, 800, pop(11.1) * 1.7, 0.12 + noise1(t, 1) * 0.08);
  if (t > 11.35) note(ctx, 'beam', 750, 270, pop(11.35) * 1.9, -0.12 + noise1(t, 2) * 0.08);
  if (t > 11.42) note(ctx, 'eighth', 630, 815, pop(11.42) * 1.9, 0.15 + noise1(t, 3) * 0.08);
  ctx.restore();
  sparks(ctx, t, 6, 5);
  typed(ctx, 'curiosity.', 10.9, t, 804 + pan, 536, 1323 + pan, 0.17);
}

// =====================================================================
// 7. Ring again (top view) then the ink scatter.
// =====================================================================
const TOP_W = { clapper: 200, skateboard: 230, vinyl: 190, book: 190, camera: 190, cat: 170, coin: 210, controller: 210, cap: 210, heart: 255, cash: 260, plant: 190 };
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
  plant: [150, 420, 80, 0],
};
const SIL = { heart: 12.45, skateboard: 12.7 };

function sceneScatter(ctx, t, f) {
  flat(ctx, '#e0dfdd', 'rgba(60,56,56,0.18)', W, H);
  const spin = inv(11.85, 12.0, t);
  const phi = kf(t, [[11.85, -1.6], [12.0, 0, 'outCubic'], [12.25, 0.26, 'linear'], [12.42, 0.36, 'linear']]);
  const burstP = ease.outCubic(inv(12.38, 12.58, t));
  const z = kf(t, [[12.5, 1], [13.76, 1.06, 'linear']]);
  const [c, x] = off(0);
  x.save();
  camera(x, { z, x: kf(t, [[12.25, 0], [12.4, 30]]) });
  const ring = ringLayout(phi - 0.21, { tilt: 0.4, R: 405, cx: 760, cy: 545, F: 4000 });
  ring
    .slice()
    .sort((a, b) => b.z - a.z)
    .forEach((it) => {
      if (it.name === 'cat' && t > 12.4) return; // cat is reborn from the ink blot
      if (it.name === 'coin' && t > 12.92) return; // coin turns into the blot
      const tgt = SCATTER[it.name];
      let px = lerp(it.x, tgt[0], burstP);
      let py = lerp(it.y, tgt[1], burstP);
      if (it.name === 'controller') {
        const m = kf(t, [[13.0, [0, 0]], [13.25, [-48, 36]], [13.5, [-207, 132]], [13.76, [-300, 180]]]);
        px += m[0];
        py += m[1];
      }
      const w = lerp(TOP_W[it.name], tgt[2], burstP);
      const sil = SIL[it.name] && t > SIL[it.name];
      const r = burstP * tgt[3] * noise1(t * 1.5 + it.i, it.i) * 0.45;
      if (it.name === 'cash' && t > 13.2) {
        // money smears into a black dab
        const q = inv(13.2, 13.35, t);
        x.save();
        x.filter = `blur(${3 * S}px)`;
        const dab = kf(t, [[13.2, [250, 895]], [13.5, [219, 735]], [13.76, [210, 680]]]);
        drawSprite(x, 'cash', lerp(px, dab[0], q), lerp(py, dab[1], q), w * lerp(1, 1.0, q), lerp(r, -0.3, q), 1, { silhouette: '#121010' });
        x.restore();
        return;
      }
      drawSprite(x, it.name, px, py, w, r, 1, sil ? { silhouette: '#121010' } : {});
    });
  if (t < 12.45) {
    const keys = [[11.9, [640, 400]], [12.05, [740, 545]], [12.45, [750, 545]]];
    const trail = [];
    for (let i = 0; i <= 6; i++) trail.push(kf(t - i * 0.02, keys));
    inkBall(x, trail[0][0], trail[0][1], 50, trail, 15);
  }
  if (t > 12.85) {
    const br = kf(t, [[12.85, 20], [13.0, 68, 'outBack'], [13.76, 80]]);
    x.save();
    x.filter = `blur(${3 * S}px)`;
    x.fillStyle = '#0e0d0d';
    x.beginPath();
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const rr = br * (1 + noise1(a * 3 + t * 4, 7) * 0.08);
      x.lineTo(1080 + Math.cos(a) * rr, kf(t, [[13.0, 670], [13.25, 650], [13.5, 735]]) + Math.sin(a) * rr * 1.1);
    }
    x.fill();
    if (t > 13.3) {
      x.save();
      x.beginPath();
      x.rect(900, 520, 400, 205);
      x.clip();
      drawSprite(x, 'cat', 1090, 720, lerp(120, 190, ease.outBack(inv(13.3, 13.5, t))), 0, 1, { silhouette: '#0e0d0d' });
      x.restore();
    }
    x.restore();
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
    [[110, 580, 360, 880, 0], [90, 640, 300, 900, 1]].forEach(([x0, y0, x1, y1, k]) => {
      const pts = [];
      for (let i = 0; i <= 80; i++) {
        const u = i / 80;
        const bx = lerp(x0, x1, u);
        const by = lerp(y0, y1, u);
        const a = u * Math.PI * (5 + k);
        pts.push([bx + Math.cos(a) * 34 - Math.sin(u * 7) * 20, by + Math.sin(a) * 26]);
      }
      fx.strokePartial(x, pts, e, p, 16, '#1c1414', false);
    });
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
  // extra ink: blob top right, fuzzy dots, shards
  x.save();
  x.filter = `blur(${3 * S}px)`;
  if (t > 12.62 && t < 12.95) {
    x.beginPath();
    for (let i = 0; i <= 30; i++) {
      const a = (i / 30) * Math.PI * 2;
      const rr = 64 * ease.outBack(inv(12.62, 12.72, t)) * (1 + noise1(a * 3, 9) * 0.18);
      x.lineTo(1140 + Math.cos(a) * rr, 185 + Math.sin(a) * rr);
    }
    x.fillStyle = '#0e0d0d';
    x.fill();
  }
  if (t > 13.2) dot(x, 130, 70, 22, '#141212');
  x.filter = `blur(${8 * S}px)`;
  x.filter = `blur(${6 * S}px)`;
  if (t > 13.15 && t < 13.4) dot(x, 354, 180, 22, '#141212');
  if (t > 12.95 && t < 13.12) dot(x, 795, 800, 22, '#141212');
  x.restore();
  if (t > 12.7 && t < 13.0) fx.strokePartial(x, [[814, 322], [826, 334], [834, 326], [842, 334], [856, 320]], 0, 1, 4, '#141212');
  if (t > 12.6 && t < 13.0) fx.strokePartial(x, fx.scribblePoints(321, 120, 60, 3, 50).map(([a, b]) => [a + 60, b + 260]), 0, inv(12.6, 12.7, t), 8, '#1c1414');
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
  if (t > 13.45) {
    fx.text(x, 'through', 440, 545, 34, '#1d1a18');
    x.fillStyle = '#0e0d0d';
    x.fillRect(582, 524, lerp(0, 200, ease.outExpo(inv(13.45, 13.52, t))), 44);
  }
  x.restore();
  composite(ctx, c, { blur: spin < 1 ? (1 - spin) * 14 : 0 });
  fx.vignette(ctx, lerp(0.3, 0.5, inv(12.5, 13.7, t)), '24,20,20', 0.55, W / 2, H / 2, 0.8);
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
const headMasks = {};
const headHot = {};
// Image decoding is async in @napi-rs/canvas, so masks are preloaded before rendering.
async function preload() {
  const { loadImage } = require('@napi-rs/canvas');
  for (const [dir, into] of [[HAND_DIR, handMasks], [HEAD_DIR, headMasks]]) {
    if (!fsMod.existsSync(dir)) continue;
    for (const name of fsMod.readdirSync(dir)) {
      const m = /^(f|hot)_(\d+)\.png$/.exec(name);
      if (m) (m[1] === 'hot' ? headHot : into)[Number(m[2])] = await loadImage(fsMod.readFileSync(pathMod.join(dir, name)));
    }
  }
}
function handMask(t) {
  return handMasks[Math.round(t * C.FPS)] || null;
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
const IRON = [[0, [70, 6, 10]], [0.22, [176, 24, 14]], [0.42, [228, 70, 18]], [0.6, [240, 118, 32]], [0.76, [246, 160, 54]], [0.88, [252, 214, 140]], [1, [255, 252, 246]]];
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
function thermalImage(key, mask, { depth = 28, base = 0.24, gain = 0.5, hot = [], warm = null, hotMask = null, hotGain = 0.6, front = 0 } = {}) {
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
  const spots = hot.map(([u, v, r, a]) => [x0 + u * bw, y0 + v * bh, r, a]);
  let hd = null;
  if (hotMask) {
    const hc = createCanvas(W, H);
    const hx = hc.getContext('2d');
    hx.filter = 'blur(10px)';
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
      let h = base + gain * Math.pow(e, 0.7) + (warm ? warm[2] * wy2 : 0);
      if (hd) h += hotGain * (hd[i + 3] / 255);
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
function burnImage(key, mask, thr) {
  const k = `${key}:${thr.toFixed(3)}`;
  if (thermalCache.has(k)) return thermalCache.get(k);
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

// Thermal shading inside a traced silhouette (screen space).
function tracedHand(ctx, mask, filter, tint = 0) {
  const [c, x] = off(0);
  x.drawImage(mask, 0, 0, W, H);
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
  if (tint > 0) {
    // intro: crimson body with violet toward the lower right
    x.fillStyle = `rgba(160,24,40,${0.95 * tint})`;
    x.fillRect(0, 0, W, H);
    const v = x.createRadialGradient(900, 1000, 10, 900, 1000, 360);
    v.addColorStop(0, `rgba(80,40,160,${0.7 * tint})`);
    v.addColorStop(1, 'rgba(80,40,160,0)');
    x.fillStyle = v;
    x.fillRect(0, 0, W, H);
  }
  x.globalCompositeOperation = 'source-over';
  composite(ctx, c, { filter: filter || undefined });
}
function sceneHand(ctx, t, f) {
  const bg = bgRamp(t, [[13.76, '#141313'], [15.4, '#141313'], [15.55, '#2c1517'], [15.66, '#3a2a2c'], [15.8, '#5b4e51'], [15.89, '#625658']]);
  fx.dark(ctx, bg);
  const fallP = inv(15.6, 15.89, t);
  if (fallP > 0) {
    const bandG = ctx.createLinearGradient(440, 0, 1150, 0);
    bandG.addColorStop(0, 'rgba(255,255,255,0)');
    bandG.addColorStop(0.2, `rgba(255,255,255,${0.08 * fallP})`);
    bandG.addColorStop(0.8, `rgba(255,255,255,${0.08 * fallP})`);
    bandG.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = bandG;
    ctx.fillRect(440, 0, 710, H);
  }
  const settle = ease.inOutCubic(inv(13.76, 14.32, t));
  const fall = ease.inOutCubic(fallP);
  let pose;
  if (t < 14.25) pose = blendPose('curl', 'open', settle);
  else if (t < 15.0) pose = blendPose('open', 'open', 0);
  else if (t < 15.6) pose = blendPose('open', 'curl', ease.inOutCubic(inv(15.38, 15.56, t)));
  else pose = blendPose('curl', 'fist', fall);
  const traced = t < 15.62 ? handMask(t) : null;
  if (traced) {
    let filt = '';
    if (settle < 1) filt = `brightness(${lerp(0.66, 1, settle)}) blur(${(1 - settle) * 10 * S}px)`;
    else if (fall > 0) filt = `saturate(${1 - fall * 0.85}) brightness(${1 - fall * 0.08})`;
    tracedHand(ctx, traced, filt, settle < 1 ? 1 - settle : 0);
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
    fx.strokePartial(ctx, [[800, 1080], [805, 880], [780, 700]], 0, 1, 46, '#5030a0', false);
    ctx.restore();
  }
  // white swirl arcs during the intro
  if (t < 14.25) {
    const q = inv(13.76, 14.2, t);
    for (let k = 0; k < 2; k++) {
      const cx = k === 0 ? 360 : 690;
      const pts = [];
      for (let i = 0; i <= 40; i++) pts.push([cx + Math.sin((i / 40) * Math.PI) * (k ? 70 : -30), 420 + i * 8.25]);
      ctx.save();
      ctx.filter = `blur(${3 * S}px)`;
      fx.strokePartial(ctx, pts, inv(0.6, 1, q), Math.min(1, q * 8), 7, 'rgba(240,236,230,0.75)');
      ctx.restore();
    }
  }
  // thick blurred comet streaks converging left as the hand drops away
  if (fall > 0) {
    ctx.save();
    ctx.filter = `blur(${11 * S}px)`;
    const r = rng(90);
    for (let i = 0; i < 5; i++) {
      const y = 320 + r() * 160;
      const x0 = 24 + r() * 300 + (1 - fall) * 200;
      const g = ctx.createLinearGradient(x0, 0, x0 + 520, 0);
      g.addColorStop(0, `rgba(245,240,236,${0.8 * fall})`);
      g.addColorStop(1, 'rgba(245,240,236,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x0, y, 520, 8 + r() * 10);
    }
    ctx.restore();
  }
  // a few long streaky specks drifting down
  [[510, 366], [660, 399], [786, 270], [700, 220]].forEach(([px, py], i) => {
    ctx.save();
    ctx.translate(px + noise1(t, i) * 10, py + ((t * 40 + i * 30) % 90));
    ctx.rotate(0.35);
    ctx.fillStyle = 'rgba(240,236,230,0.85)';
    ctx.fillRect(-2, -10, 4, 20);
    ctx.restore();
  });
  // text (drifts left with a horizontal smear at the end)
  const ti = inv(13.82, 14.0, t);
  const grey = inv(15.5, 15.75, t);
  const col = mixHex(CREAM, '#a09898', grey);
  const dx = -235 * ease.inCubic(fallP);
  const glow = { glow: 'rgba(243,239,232,0.3)', glowBlur: 6 };
  fx.text(ctx, t < 13.95 ? 'through' : 'through ones', 215 + dx, 545, BODY, col, { blur: (1 - ti) * 8 + fallP * 3, ...glow });
  if (t > 14.2) {
    const word = t < 14.45 ? 'own' : t < 15.7 ? 'own ability' : 'own ability to';
    fx.text(ctx, word, 950 + dx, 545, BODY, col, { blur: fallP * 3, ...glow });
    if (t < 14.45) {
      const w = fx.measure(ctx, word, BODY);
      ctx.fillStyle = CREAM;
      ctx.fillRect(950 + w + 60, 522, 8, 46);
    }
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
    const w = kf(t, [[15.89, 290], [16.08, 312], [16.2, 470, 'inQuad']]);
    const crush = inv(16.1, 16.18, t);
    if (crush > 0) {
      fx.vignette(ctx, crush * 0.97, '28,26,26', lerp(0.6, 0.12, crush), W / 2, H / 2, 0.6);
      fx.grain(ctx, f + 1, 0.3 * crush);
    }
    ctx.save();
    ctx.filter = `blur(${20 * S}px)`;
    ctx.fillStyle = 'rgba(40,30,30,0.5)';
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
    const glow = inv(16.33, 16.42, t);
    if (glow > 0) {
      const g = ctx.createRadialGradient(729, 545, 0, 729, 545, 170);
      g.addColorStop(0, `rgba(230,20,20,${glow})`);
      g.addColorStop(1, 'rgba(200,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    drawSprite(ctx, 'camera', 729, 540, kf(t, [[16.2, 340], [16.5, 345]]), noise1(t, 3) * 0.04);
    letter(ctx, 'L', LX[0], LY, LSIZE, CREAM);
    letter(ctx, 'O', LX[1], LY, LSIZE, CREAM);
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
    return;
  }
  if (t < 17.18) {
    fx.dark(ctx, '#141313');
    const q = ease.outCubic(inv(16.86, 17.0, t));
    ctx.save();
    ctx.filter = `blur(${1.2 * S}px)`;
    drawSprite(ctx, 'vinyl', 729, 540, lerp(330, 350, q), 0, 1, { sx: lerp(0.38, 1, q), shadow: 'rgba(220,220,235,0.35)', shadowBlur: 26 });
    ctx.restore();
    if (q < 0.7) dot(ctx, 729, 540, 12, '#e0303c');
    const lo = t > 16.92 ? '#3fb7d9' : CREAM;
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
const FIN = {
  L: [[17.25, [684, 624, -160]], [17.5, [684, 624, -160]], [17.75, [498, 846, 0]], [18.0, [444, 885, -110]], [18.25, [440, 895, -180]], [18.5, [438, 906, -140]], [18.75, [440, 900, -100]], [19.0, [444, 891, -50]], [19.25, [446, 880, -5]], [19.5, [447, 873, 0]], [19.75, [468, 843, 0]], [20.0, [513, 792, 0]], [20.46, [513, 792, 0]]],
  O: [[17.25, [1422, 402, 0]], [17.5, [1422, 402, 0]], [17.75, [1104, 336, 0]], [18.0, [942, 288, 0]], [18.5, [825, 264, 0]], [19.0, [807, 255, 0]], [19.5, [801, 273, 0]], [19.75, [798, 282, 0]], [20.0, [792, 330, 0]], [20.46, [792, 330, 0]]],
  V: [[17.25, [666, 369, 150]], [17.5, [666, 369, 150]], [17.75, [813, 45, 0]], [18.0, [573, 150, 180]], [18.25, [450, 205, 190]], [18.5, [354, 249, 270]], [18.75, [338, 252, 285]], [19.0, [330, 255, 300]], [19.25, [340, 262, 345]], [19.5, [348, 267, 360]], [19.75, [369, 276, 360]], [20.0, [429, 324, 360]], [20.46, [429, 324, 360]]],
  E: [[17.25, [537, 264, 180]], [17.5, [537, 264, 180]], [17.75, [888, 609, 0]], [18.0, [1053, 759, 120]], [18.25, [1134, 834, 170]], [18.5, [1173, 870, 170]], [18.75, [1185, 880, 150]], [19.0, [1188, 885, 50]], [19.25, [1176, 878, 40]], [19.5, [1164, 873, 0]], [19.75, [1149, 843, 0]], [20.0, [1101, 810, 0]], [20.46, [1101, 810, 0]]],
};
const DOTS = [
  // keyframes, radius
  [[[17.25, [159, 348]], [17.75, [165, 405]], [18.0, [747, 327]], [18.5, [735, 306]], [19.5, [702, 273]], [19.75, [672, 279]], [20.0, [657, 381]]], 11, 6],
  [[[17.25, [822, 609]], [17.75, [750, 333]], [18.0, [1284, 645]], [18.5, [1224, 390]], [19.5, [1218, 282]], [19.75, [1227, 261]], [20.0, [1146, 360]]], 8, 10],
  [[[17.25, [1311, 675]], [17.75, [1299, 672]], [18.0, [243, 717]], [18.5, [240, 696]], [19.5, [213, 702]], [19.75, [213, 672]], [20.0, [360, 579]]], 7, 7],
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

function sceneFinale(ctx, t, f) {
  ctx.fillStyle = '#dededd';
  ctx.fillRect(0, 0, W, H);
  const gg = ctx.createLinearGradient(0, 0, W, H);
  gg.addColorStop(0, 'rgba(255,255,255,0.12)');
  gg.addColorStop(1, 'rgba(120,120,135,0.18)');
  ctx.fillStyle = gg;
  ctx.fillRect(0, 0, W, H);
  // huge motion-blurred ink strokes at the cut, collapsing into the letters
  if (t < 17.44) {
    const q = inv(17.2, 17.44, t);
    const sh = ease.inOutCubic(inv(17.26, 17.32, t));
    const fade = 1 - inv(17.38, 17.44, t);
    const [haloC, halo] = off(1);
    const [coreC, core] = off(2);
    [[0, 160, 120, 324, 222, 640, 2.4], [1, 520, 560, 969, 507, 560, 1.6], [2, 900, 160, 1293, 822, 520, 2.0], [3, 980, 820, 1299, 72, 420, 1.8]].forEach(([k, ox, oy, tx2, ty2, len, curl]) => {
      const big = fx.wanderPoints(500 + k, len, curl, 60);
      const L2 = k === 3 ? 80 : 115;
      const rot2 = k * 1.3 + 0.4;
      const pts = big.map(([a, b], i) => {
        const u = i / (big.length - 1);
        // S-shaped short stroke at the target position
        let sxp = (u - 0.5) * L2;
        let syp = Math.sin(u * Math.PI * 2) * L2 * 0.16;
        if (k === 0 || k === 1) {
          // '?' hook: a curl that drops into a short tail
          const a = Math.PI * (1.1 - u * 1.6);
          sxp = u < 0.65 ? Math.cos(a) * L2 * 0.35 : (u - 0.65) * L2 * 0.2;
          syp = u < 0.65 ? -Math.sin(a) * L2 * 0.35 : (u - 0.65) * L2 * 2.0;
        }
        const tx3 = tx2 + sxp * Math.cos(rot2) - syp * Math.sin(rot2);
        const ty3 = ty2 + sxp * Math.sin(rot2) + syp * Math.cos(rot2);
        return [lerp(a + ox, tx3, sh), lerp(b + oy, ty3, sh)];
      });
      // draw unfiltered into layers, then blur each layer once (per-segment filters are far too slow at 4K)
      fx.strokePartial(halo, pts, q * 0.3, 0.7 + q * 0.3, lerp(70, 18, sh), 'rgba(60,58,58,0.45)');
      fx.strokePartial(core, pts, q * 0.3 * (1 - sh), 0.7 + q * 0.3 + sh, lerp(32, 12, sh), sh > 0.5 ? '#505050' : '#1a1818', true);
    });
    composite(ctx, haloC, { blur: lerp(16, 8, sh), alpha: fade * lerp(1, 0.4, sh) });
    composite(ctx, coreC, { blur: lerp(5, 10, sh), alpha: fade * lerp(1, 0.7, sh) });
    if (sh > 0) {
      [[114, 717, 60, 40], [654, 732, 40, 75], [744, 957, 50, 30]].forEach(([a, b, rx, ry], k) => {
        const pts = fx.loopPoints(700 + k, rx, ry, 2.6, 200).map(([u, v], i) => [u + a + noise1(i * 0.2, k) * 14, v + b + noise1(i * 0.2, k + 5) * 14]);
        fx.strokePartial(ctx, pts, 0, sh, 1.6, `rgba(224,64,46,${0.7 * fade})`);
      });
    }
  }
  const grow = ease.inOutCubic(inv(19.75, 20.05, t));
  const size = lerp(56, 74, grow);
  const pos = {};
  Object.keys(FIN).forEach((ch) => {
    const keys = [];
    FIN[ch].forEach(([tt, v], i) => {
      keys.push([tt, v, 'inOutCubic']);
      if (tt < 18.0 && i < FIN[ch].length - 1) keys.push([tt + 0.09, v, 'linear']);
    });
    const [x, y, r] = kf(t, keys);
    pos[ch] = [x, y];
    letter(ctx, ch, x, y - 13 * grow, size, '#3a1a16', r * D);
  });
  DOTS.forEach(([k, r0, r1]) => {
    if (t > 18.9 && t < 19.2) return;
    const hk = [];
    k.forEach(([tt, v], i) => {
      hk.push([tt, v, 'inOutCubic']);
      if (tt < 18.0 && i < k.length - 1) hk.push([tt + 0.09, v, 'linear']);
    });
    const [x, y] = kf(t, hk);
    const r = t < 17.9 ? 4 : r0 === 11 ? kf(t, [[18.0, 11], [18.4, 4], [18.75, 7], [19.5, 6], [20.0, 7]]) : r0 === 8 ? kf(t, [[18.0, 8], [18.25, 4], [18.5, 10], [18.75, 4], [19.5, 6], [19.8, 9]]) : lerp(r0, r1, inv(19.2, 19.7, t));
    dot(ctx, x, y, r * (t > 19.2 && t < 19.4 ? 0.5 : 1) * lerp(1, 1.1, grow), '#2a1714');
  });
  LOOPS.forEach(([ch, s, d, rx, ry, seed, turns, dx, dy]) => {
    if (t < s || t > s + d + 0.28) return;
    const [ax, ay] = pos[ch];
    const messy = s < 18 || ch === 'V' || (s > 19.6 && ch === 'E');
    const pts = (messy ? fx.loopPoints(seed, rx * (s < 18 ? 0.8 : ch === 'V' ? 0.95 : 1.15), ry * (s < 18 ? 0.8 : ch === 'V' ? 0.95 : 1.15), 2.6, 200).map(([a, b], i) => [a + noise1(i * 0.2, seed) * 10, b + noise1(i * 0.2, seed + 4) * 10]) : smoothLoop(rx * 1.7, ry * 1.7, turns, seed)).map(([a, b]) => [a + ax + dx, b + ay + dy]);
    fx.strokePartial(ctx, pts, inv(s + d + 0.12, s + d + 0.28, t), inv(s, s + d, t), messy ? 1.3 : 1.6, '#e0402e');
  });
  if (t > 19.95) {
    FINAL_LOOPS.forEach(([ch, rx, ry, seed, turns, dx, dy]) => {
      const [ax, ay] = pos[ch];
      const pts = smoothLoop(rx, ry, turns, seed).map(([a, b]) => [a + ax + dx, b + ay + dy]);
      fx.strokePartial(ctx, pts, 0, inv(19.95, 20.1, t), 1.6, '#e0402e');
    });
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
  [3.82, 6.3, sceneProfile],
  [6.3, 8.3, sceneRing],
  [8.3, 9.13, sceneAction],
  [9.13, 9.84, sceneStripA],
  [9.84, 10.51, sceneIntention],
  [10.51, 11.01, sceneStripB],
  [11.01, 11.85, sceneCuriosity],
  [11.85, 13.76, sceneScatter],
  [13.76, 15.89, sceneHand],
  [15.89, 17.23, sceneLove],
  [17.23, 99, sceneFinale],
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
