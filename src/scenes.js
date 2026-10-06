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
const TYPE_T = [0, 0, 0, 0, 0.8, 1.25, 1.5, 1.75, 1.875, 1.96];

function sceneOpen(ctx, t, f) {
  if (t < 0.083) {
    ctx.fillStyle = '#d9a623';
    ctx.fillRect(0, 0, W, H);
    dashLine(ctx, 0, W, 98, '#5a3a14', 4, [30, 22]);
    dashLine(ctx, 0, W, 952, '#5a3a14', 4, [30, 22]);
    fx.text(ctx, 'how', W / 2 - 5, 520, 300, '#3a2914', { align: 'center' });
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

  const hx = kf(t, [
    [0.083, 440],
    [0.2, 395, 'linear'],
    [0.33, -200, 'inOutQuad'],
    [0.38, -720, 'linear'],
    [0.44, -1000, 'outQuad'],
  ]);
  // whip-zoom down to body size
  const zp = ease.inOutCubic(inv(0.44, 0.68, t));
  const z = Math.exp(lerp(0, Math.log(BODY / BIG), zp));

  const [c, x] = off(0);
  x.save();
  x.translate(lerp(hx, 140, zp), lerp(630, 556, zp));
  x.scale(z, z);
  const lw = 3 / Math.max(z, 0.35);
  const dashA = 1 - inv(0.44, 0.52, t);
  if (dashA > 0) {
    x.globalAlpha = dashA;
    dashLine(x, -4000, 12000, -174, '#6a2a14', lw, [26, 20]);
    dashLine(x, -4000, 12000, 0, '#6a2a14', lw, [26, 20]);
    x.globalAlpha = 1;
  }
  let cx = 0;
  const sp = fx.measure(x, ' ', BIG);
  SENT.slice(0, 4).forEach((w, i) => {
    const a = i === 1 ? inv(0.11, 0.16, t) : i >= 2 ? inv(0.2, 0.26, t) : 1;
    const col = i === 1 ? mixHex('#4a4744', '#141210', inv(0.2, 0.3, t)) : zp > 0.5 ? INK : '#141210';
    if (a > 0) fx.text(x, w, cx, 0, BIG, col, { baseline: 'alphabetic', alpha: a });
    cx += fx.measure(x, w, BIG) + sp;
  });
  x.restore();

  // thick tapered pen swoosh under "how"
  if (t > 0.13 && t < 0.3) {
    const p = ease.outCubic(inv(0.13, 0.2, t));
    x.fillStyle = '#2a170c';
    x.beginPath();
    x.moveTo(0, 665);
    x.lineTo(lerp(0, 680, p), 642);
    x.lineTo(0, 688);
    x.closePath();
    x.fill();
  }
  // black box over "you" + quick scribble
  if (t > 0.24 && t < 0.36) {
    const p = ease.outExpo(inv(0.24, 0.28, t));
    x.fillStyle = '#0d0c0c';
    x.fillRect(lerp(1440, 880, p), 384, 480, 246);
    const pts = fx.scribblePoints(41, 520, 60, 3, 90).map(([a, b]) => [a + 745, b + 655]);
    fx.strokePartial(x, pts, 0, inv(0.26, 0.34, t), 3, '#2a1a10');
  }
  // selection handles
  if (t > 0.48) {
    x.fillStyle = '#2a2624';
    [444, 504, 564, 624].forEach((yy) => x.fillRect(1100, yy, 10, 10));
  }
  if (t > 0.47 && t < 0.6) {
    // mid-whip the line reads as chunky dark dashes plus the handle column
    const r = rng(23);
    ctx.fillStyle = 'rgba(30,24,22,0.9)';
    let px = 140;
    while (px < 780) {
      const w = 12 + Math.floor(r() * 4) * 12;
      if (r() > 0.25) ctx.fillRect(px, 528, w, 12);
      px += w + 12;
    }
    [444, 504, 564, 624].forEach((yy) => ctx.fillRect(1104, yy, 18, 18));
  } else composite(ctx, c, { blur: t >= 0.6 ? lerp(10, 2, inv(0.6, 0.68, t)) : t > 0.25 && t < 0.4 ? 2.5 : 0 });
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
  flat(ctx, '#e0dfdd', 'rgba(70,66,66,0.3)', 0, 0);
  const x0 = kf(t, [[0.68, 100], [0.8, 72, 'outCubic'], [1.96, 42, 'linear']]);
  const y0 = 540;
  const [sx, sy] = shake(t, 2.5, 1, 4);

  // ghost signature, huge & blurred, drifting at the top right
  if (t < 1.2) {
    const [c, x] = off(1);
    const pts = fx.scribblePoints(77, 760, 260, 6, 200).map(([a, b]) => [a + lerp(640, 520, inv(0.6, 1.2, t)), b + 190]);
    fx.strokePartial(x, pts, 0, inv(0.62, 0.85, t), 24, 'rgba(70,68,66,0.6)');
    composite(ctx, c, { blur: 16, alpha: 1 - inv(1.0, 1.2, t) });
  }
  ctx.save();
  ctx.translate(sx, sy);
  const end = fx.words(ctx, sentenceParts(t), x0, y0, BODY);
  const wordX = (i) => x0 + fx.measure(ctx, SENT.slice(0, i).join(' ') + (i ? ' ' : ''), BODY);

  // selection box around the first phrase while it lands
  if (t < 0.8) {
    ctx.save();
    ctx.strokeStyle = 'rgba(40,36,34,0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.strokeRect(x0 - 14, y0 - 34, end - x0 + 28, 68);
    ctx.setLineDash([]);
    ctx.fillStyle = '#2a2624';
    [[x0 - 14, y0 - 34], [end + 14, y0 - 34], [x0 - 14, y0 + 34], [end + 14, y0 + 34]].forEach(([a, b]) => ctx.fillRect(a - 4, b - 4, 8, 8));
    ctx.restore();
    ctx.fillStyle = '#2a2624';
    ctx.fillRect(x0 - 50, 290, 3, 520 * ease.outCubic(inv(0.6, 0.7, t)));
  }
  // handwritten signature below the line
  if (t > 0.64 && t < 0.98) {
    const pts = SIGNATURE.map(([a, b]) => [a * 1.05 + 110, b * 1.15 + 660]);
    fx.strokePartial(ctx, pts, Math.max(0, inv(0.88, 0.98, t)), inv(0.64, 0.8, t), 3.4, '#4a4644');
  }
  if (t > 0.7 && t < 0.95) fx.strokePartial(ctx, [[530, 330], [524, 420], [516, 512]], 0, inv(0.7, 0.78, t), 3.4, PEN);
  // long brown arc on the right with a little tail
  if (t > 0.92 && t < 1.16) {
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
    const loop = fx.loopPoints(5, 70, 34, 1.1).map(([a, b]) => [a + wordX(5) + 70, b + 548]);
    fx.strokePartial(ctx, loop, fade, inv(1.2, 1.27, t), 3.4, PEN);
    fx.strokePartial(ctx, [[xb + 30, 560], [xb - 20, 640], [xb - 70, 720]], fade, inv(1.28, 1.36, t), 3.4, PEN);
  }
  ctx.restore();
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
  const sat = ease.inOutCubic(inv(2.06, 2.26, t));
  const p = inv(2.3, 3.4, t);
  const purple = inv(3.6, 3.75, t);
  return {
    edge: mixHex('#b8f4ec', mixHex('#46f2e2', '#3fc8f0', ease.inOutQuad(p)), sat),
    mid: mixHex('#a8f0e8', mixHex(mixHex('#2ab8f2', '#2a5af2', p), '#5a2ad0', purple), sat),
    core: mixHex('#98e8e2', mixHex(mixHex('#1a64ff', '#2a2ad8', p), '#5020b0', purple), sat),
  };
}

const FLOATERS = [
  ['book', 837, 387, 96, -0.32, 0],
  ['clapper', 1060, 365, 100, 0.38, 1],
  ['coin', 965, 650, 84, 0, 2],
  ['camera', 1118, 850, 100, 0.05, 3],
];

function sceneSparkle(ctx, t, f) {
  const intro = inv(1.96, 2.1, t);
  flat(ctx, '#dcdbd9', 'rgba(60,40,40,0.2)', 0, 0);
  const spot = ease.inOutCubic(inv(3.2, 3.3, t));
  const vs = ease.outCubic(inv(2.12, 2.35, t));
  // warm progression of the spotlight 3.6 -> 3.76
  const warmCol = bgRamp(t, [
    [3.6, '#ffffff'],
    [3.67, '#f2c4b2'],
    [3.71, '#e88a52'],
    [3.76, '#d04420'],
  ]);
  const warm = inv(3.6, 3.76, t);
  const g = ctx.createRadialGradient(780, 545, lerp(80, 60, spot), 780, 560, lerp(900, 720, spot));
  g.addColorStop(0, C.hex(warm > 0 ? warmCol : '#e0e0e0', Math.min(1, lerp(0.05, 0.25, spot) + warm * 0.5)));
  g.addColorStop(0.5, C.hex(warm > 0 ? warmCol : '#e0e0e0', lerp(0, 0.08, spot) + warm * 0.3));
  g.addColorStop(0.72, `rgba(42,26,26,${0.6 * vs})`);
  g.addColorStop(1, `rgba(26,15,16,${0.98 * vs})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  if (warm > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = C.hex(warmCol, warm * 0.7);
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  const z = lerp(1, 1.04, inv(2.0, 3.8, t));
  const [sx, sy] = shake(t, 3, 1.2, 8);

  // sparkle star on the left; arms thin out between 2.5 and 3.0
  const sc = starColors(t);
  const sIn = ease.outExpo(inv(1.98, 2.16, t));
  const [c2, x2] = off(1);
  const scx = kf(t, [[1.96, 200], [2.2, -70, 'outCubic']]);
  const scy = kf(t, [[1.96, 540], [2.2, 505, 'outCubic']]);
  const R = kf(t, [[1.96, 720], [2.2, 880, 'outCubic'], [2.5, 770], [3.0, 690], [3.8, 670]]);
  const rot = kf(t, [[2.0, -1.2], [2.18, -1.02, 'outExpo'], [2.5, -1.03], [3.0, -0.98]]) + noise1(t * 0.7, 3) * 0.02;
  const k = kf(t, [[2.0, 0.09], [2.5, 0.075], [3.0, 0.05]]);
  fx.starPath(x2, scx, scy, R, rot, k);
  const rg = x2.createRadialGradient(scx, scy, 30, scx, scy, R * 0.6);
  rg.addColorStop(0, sc.core);
  rg.addColorStop(0.3, sc.core);
  rg.addColorStop(0.55, sc.mid);
  rg.addColorStop(1, sc.edge);
  x2.fillStyle = rg;
  x2.shadowColor = sc.edge;
  x2.shadowBlur = 22 * S;
  x2.fill();
  x2.shadowBlur = 0;
  x2.strokeStyle = `rgba(31,106,90,${inv(2.25, 2.45, t)})`;
  x2.lineWidth = 5;
  x2.filter = `blur(${1 * S}px)`;
  x2.stroke();
  x2.filter = 'none';
  composite(ctx, c2, { alpha: sIn });
  fx.grain(ctx, f + 3, 0.12);

  ctx.save();
  camera(ctx, { x: sx, y: sy, z });
  const parts = SENT.map((w, i) => ({
    t: w,
    c: i === 2 && t > 3.5 ? '#ffffff' : '#2a1a16',
    o: i === 2 && t > 3.5 ? { glow: 'rgba(255,255,255,0.8)', glowBlur: 14 } : {},
  }));
  const [tc, tx] = off(2);
  fx.words(tx, parts, 40, 538, BODY);
  composite(ctx, tc, { blur: intro < 1 ? (1 - intro) * 8 : 0 });
  if (t < 2.12) {
    ctx.save();
    ctx.strokeStyle = 'rgba(60,50,46,0.8)';
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 2;
    ctx.strokeRect(1240, 506, 170, 62);
    ctx.restore();
  }
  // floating icons, wobbling
  if (t < 3.27) {
    const out = ease.inQuad(inv(3.2, 3.27, t));
    FLOATERS.forEach(([n, x, y, w, r, ph]) => {
      const fly = 1 - ease.outCubic(intro);
      const dx = (x - 720) * fly * 1.8 + noise1(t * 1.6, ph) * 12;
      const dy = (y - 540) * fly * 1.8 + noise1(t * 1.3, ph + 5) * 12;
      const rr = r + Math.sin(t * 5 + ph * 2) * 0.3 + fly * 2;
      drawSprite(ctx, n, x + dx, y + dy, w * (1 - out), rr);
    });
    dot(ctx, 406, 322, 5);
    dot(ctx, 821, 382, 4);
    ctx.fillStyle = '#d8241c';
    ctx.beginPath();
    ctx.ellipse(1125, 213, 6, 8, 0.4, 0, 7);
    ctx.fill();
    const pts = fx.wanderPoints(19, 60, 2.5, 30).map(([a, b]) => [a + 322, b + 912]);
    fx.strokePartial(ctx, pts, 0, inv(2.0, 2.4, t), 4, '#2a2624');
  }
  // red slash + dark brush strokes during the transition
  if (t < 2.3) {
    const q = 1;
    ctx.globalAlpha = 1 - inv(2.12, 2.3, t);
    [[1, 708, 190, 1040, 430, '#d8241c', 12], [2, 950, 640, 1250, 730, '#d8241c', 10], [3, 1200, 770, 1380, 640, '#d8241c', 8], [4, 270, 100, 420, 30, 'rgba(50,46,46,0.75)', 5], [5, 960, 350, 1290, 190, 'rgba(50,46,46,0.75)', 5], [6, 480, 830, 810, 770, 'rgba(50,46,46,0.7)', 4], [7, 930, 930, 1110, 870, 'rgba(50,46,46,0.7)', 4]].forEach(([k2, ox, oy, ex, ey, col, lw]) => {
      fx.strokePartial(ctx, [[ox, oy], [(ox + ex) / 2, (oy + ey) / 2 - 10], [ex, ey]], 0, q, lw, col, false);
    });
    ctx.globalAlpha = 1;
  }
  if (intro < 1) speedStreaks(ctx, 1 - intro, 5);
  // big red loop and black stroke over the warm spotlight
  if (t > 3.65 && t < 3.79) {
    const loop = fx.loopPoints(42, 330, 150, 1.15).map(([a, b]) => [a + 860, b + 320]);
    fx.strokePartial(ctx, loop, inv(3.74, 3.79, t), inv(3.65, 3.72, t), 6, '#d8201a');
    fx.strokePartial(ctx, [[760, 230], [700, 520], [640, 900]], inv(3.74, 3.79, t), inv(3.68, 3.74, t), 4, '#1a1010');
  }
  ctx.restore();

  // 3.78: cut to dark, red sun + small line
  if (t >= 3.78) {
    fx.dark(ctx, '#151314');
    const rr = ctx.createRadialGradient(250, 545, 10, 250, 545, 260);
    rr.addColorStop(0, '#ff4a22');
    rr.addColorStop(0.55, '#e0201a');
    rr.addColorStop(0.8, 'rgba(160,10,10,0.6)');
    rr.addColorStop(1, 'rgba(60,0,0,0)');
    ctx.fillStyle = rr;
    ctx.fillRect(0, 0, W, H);
    fx.words(ctx, [
      { t: 'how', c: '#3a1410' },
      { t: 'do', c: '#3a1410' },
      { t: 'you', c: '#ffffff' },
      { t: 'communicate', c: '#4a1812' },
      { t: 'that', c: '#4a1812' },
    ], 18, 552, 34, { blur: 0.6 });
  }
}

// =====================================================================
// 4. "you dont." — thermal profile, white strokes, then backlit silhouette.
// =====================================================================
function sceneProfile(ctx, t, f) {
  const bg = bgRamp(t, [
    [3.82, '#151314'],
    [5.45, '#151314'],
    [5.56, '#2a1718'],
    [5.7, '#55494b'],
    [5.85, '#7d7273'],
    [5.97, '#c3bec1'],
    [6.1, '#d9d7d6'],
    [6.26, '#bdbbba'],
  ]);
  fx.dark(ctx, bg);
  if (t > 5.4 && t < 5.66) {
    const g = ctx.createRadialGradient(0, 1080, 0, 0, 1080, 700);
    g.addColorStop(0, `rgba(160,20,20,${0.5 * Math.sin(Math.PI * inv(5.4, 5.66, t))})`);
    g.addColorStop(1, 'rgba(120,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  const lit = inv(5.95, 6.12, t);
  if (lit > 0) {
    const g = ctx.createLinearGradient(0, 0, 700, 0);
    g.addColorStop(0, `rgba(255,255,255,${0.9 * lit})`);
    g.addColorStop(0.55, `rgba(255,255,255,${0.35 * lit})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  const settle = ease.inOutCubic(inv(3.82, 4.25, t));
  const z = lerp(1, 1.04, inv(4.1, 6.2, t));
  const [sx, sy] = shake(t, 2.2, 0.8, 21);
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
  const heat = thermal('head', 'heat');
  if (toShadow < 1) {
    x.globalAlpha = 1 - toShadow;
    if (settle < 1) x.filter = `hue-rotate(${-115 * (1 - settle) * (1 - settle)}deg) saturate(${lerp(0.8, 1.1, settle)}) brightness(${lerp(0.42, 1, settle)})`;
    else if (toTan > 0) x.filter = `saturate(${lerp(0.6, 0.3, toTan)}) brightness(${lerp(0.92, 0.6, toTan)}) sepia(${toTan * 0.8})`;
    else if (t > 5.6) x.filter = `sepia(${0.55 * inv(5.6, 5.84, t)}) saturate(${lerp(1, 0.85, inv(5.6, 5.84, t))}) brightness(${lerp(1, 0.85, inv(5.6, 5.84, t))})`;
    x.drawImage(heat, 0, 0);
    x.filter = 'none';
    if (toTan > 0.5) {
      // irregular dark burn ring around an olive patch in the hair
      x.save();
      x.globalAlpha = (1 - toShadow) * clamp((toTan - 0.5) * 2);
      x.beginPath();
      for (let i = 0; i <= 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        const rr = 1 + noise1(a * 3.5, 13) * 0.3 + (i % 4 === 0 ? 0.08 : 0);
        x.lineTo(320 + Math.cos(a) * 120 * rr, 232 + Math.sin(a) * 172 * rr);
      }
      x.closePath();
      x.fillStyle = '#8a7a30';
      x.filter = `blur(${2 * S}px)`;
      x.fill();
      x.strokeStyle = '#2a2010';
      x.lineWidth = 30;
      x.stroke();
      // darker, narrower torso
      const tg = x.createLinearGradient(0, 640, 0, 940);
      tg.addColorStop(0, 'rgba(58,48,40,0)');
      tg.addColorStop(0.4, 'rgba(58,48,40,0.9)');
      tg.addColorStop(1, 'rgba(58,48,40,0.95)');
      x.filter = 'none';
      x.globalCompositeOperation = 'source-atop';
      x.fillStyle = tg;
      x.fillRect(0, 640, 800, 300);
      x.restore();
    }
  }
  if (toShadow > 0) {
    x.globalAlpha = toShadow;
    x.drawImage(thermal('head', 'shadow'), 0, 0);
  }
  x.restore();
  composite(ctx, c, { blur: (1 - settle) * 40 });

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
  } else parts = [{ t: 'you', c: '#3c3836' }, { t: 'just', c: '#3c3836' }, { t: 'show', c: '#3c3836' }, { t: 'it.', c: '#3c3836' }];
  fx.words(ctx, parts, 200, 538, BODY, { blur: (1 - intro) * 9 });
  if (t < 5.2 && blinkOn(t - 3.82, 0.42)) fx.cursor(ctx, 640, 540, 44, 'rgba(160,156,150,0.8)', 3);
}

// =====================================================================
// 5. The pixel icon ring.
// =====================================================================
const RING = ['clapper', 'skateboard', 'vinyl', 'book', 'camera', 'cat', 'coin', 'controller', 'cap', 'heart', 'cash', 'plant'];
const RING_W = { clapper: 260, skateboard: 285, vinyl: 220, book: 220, camera: 220, cat: 195, coin: 205, controller: 260, cap: 275, heart: 380, cash: 380, plant: 260 };

function ringLayout(phi, { cx = 770, cy = 605, R = 480, tilt = 0.96, F = 3000, xs = 1, roll = 0 } = {}) {
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
    [7.5, 0.08, 'linear'],
    [8.0, 0.82, 'inQuad'],
    [8.3, 1.3, 'inQuad'],
  ]);
const ringAt = (t) => ringLayout(ringPhi(t), { xs: 0.86, R: 470, cy: 490, roll: -0.06 });
const iconPos = (t, name) => {
  const it = ringAt(t).find((o) => o.name === name);
  return [it.x, it.y];
};

const HITS = [
  [7.125, 'cap'],
  [7.36, 'heart'],
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
  const g = ctx.createRadialGradient(x, y, 0, x, y, 260);
  g.addColorStop(0, `rgba(255,154,32,${0.95 * a})`);
  g.addColorStop(0.4, `rgba(255,150,40,${0.5 * a})`);
  g.addColorStop(1, 'rgba(255,140,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - 220, y - 220, 440, 440);
  const r = rng(seed);
  ctx.strokeStyle = `rgba(240,160,30,${a})`;
  ctx.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    const an = r() * Math.PI * 2;
    const r0 = 130 + r() * 40;
    const r1 = r0 + 80 + r() * 50;
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
  camera(x, { x: sx + camX - 100 * (1 - inv(6.5, 6.9, t)), y: sy, z: zoom, r: camR, cx: 770, cy: 600 });
  const items = ringAt(t);
  const hitAmt = (name) => {
    let a = 0;
    HITS.forEach(([ht, n]) => {
      if (n === name) a = Math.max(a, 1 - Math.abs(t - ht - (n === 'cap' ? 0.07 : 0.02)) / (n === 'heart' || n === 'cap' ? 0.12 : 0.06));
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
  if (t > 7.36 && t < 7.56) {
    const [hx, hy] = iconPos(7.36, 'heart');
    const pts = [];
    for (let i = 0; i <= 40; i++) pts.push([hx - 190 + i * 9.5, hy - 85 + Math.sin(i * 0.55) * 22]);
    fx.strokePartial(x, pts, inv(7.5, 7.56, t), inv(7.35, 7.4, t), 50, '#141010', true);
  }
  if (t > 6.8 && t < 7.16) {
    const arc = [];
    for (let i = 0; i <= 40; i++) {
      const u = i / 40;
      arc.push([lerp(600, 1000, u), 450 - Math.sin(u * Math.PI) * 55]);
    }
    fx.strokePartial(x, arc, inv(7.08, 7.16, t), inv(6.8, 6.95, t), 16, 'rgba(26,22,22,0.85)', true);
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
  const pos = kf(t, [[8.3, [640, 430]], [8.45, [560, 500], 'outCubic'], [8.55, [532, 525]], [8.75, [512, 470], 'inOutCubic'], [9.0, [375, 590], 'inOutCubic'], [9.13, [360, 600]]]);
  const rot = kf(t, [[8.3, -0.05], [8.45, -0.15, 'outCubic'], [8.55, -0.12], [8.75, 1.88, 'inOutCubic'], [9.0, -0.35, 'inOutCubic'], [9.13, -0.38]]);
  const width = kf(t, [[8.3, 450], [8.55, 405], [8.75, 620], [9.0, 900], [9.13, 940]]);
  const sy = kf(t, [[8.3, 1], [8.8, 1], [8.95, 0.24, 'inOutCubic'], [9.13, 0.22]]);
  const blur = kf(t, [[8.3, 10], [8.4, 2], [8.48, 0], [8.65, 0], [8.72, 3], [8.78, 0], [8.88, 3], [8.95, 0]]);
  const [c, x] = off(0);
  x.save();
  x.filter = 'brightness(1.2) saturate(0.7)';
  drawSprite(x, 'camera', pos[0], pos[1], width, rot, 1, { sy });
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
  const st = kf(t, [[8.3, 1.0], [8.4, 0.85, 'outBack'], [8.6, 0.85], [8.75, 2.0], [9.13, 0.8]]);
  const sxs = kf(t, [[8.6, 1], [8.75, 0.5, 'outCubic'], [8.85, 0.5], [8.95, 2.6, 'outCubic']]);
  x.save();
  const anchor = kf(t, [[8.3, [650, 470]], [8.55, [650, 420]], [8.75, [540, 180]], [9.0, [600, 200]], [9.13, [610, 195]]]);
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
  ['plant', 20, -10, 320, 2],
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
  drawSprite(x, 'book', bp[0], bp[1], bw, kf(t, [[9.84, -0.25], [10.0, -0.06]]) + noise1(t * 2, 4) * 0.04, 1, { shadow: 'rgba(255,40,30,0.35)', shadowBlur: 30 });
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
    fx.strokePartial(ctx, [[624, 1062], [850, 870], [1074, 672]], 0, 1, 50, '#e2211b', false);
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
  const catRel = kf(t, [[10.51, 270], [10.75, 466]]);
  const camRel = kf(t, [[10.51, 900], [10.75, 640]]);
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
    drawSprite(ctx, 'heart', 740, 555, 400, 0, 1, { silhouette: '#c0c0c0' });
    ctx.save();
    ctx.filter = 'grayscale(1) brightness(0.85)';
    drawSprite(ctx, 'cash', 430, 575, 430, 0);
    ctx.restore();
    ctx.save();
    ctx.filter = 'invert(1) grayscale(1) brightness(0.9)';
    drawSprite(ctx, 'cap', 1080, 545, 440, 0);
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
    ctx.save();
    ctx.lineWidth = 7;
    burst(ctx, vx, 545, inv(11.01, 11.16, t), 61, ['#ece8e2']);
    ctx.restore();
    dot(ctx, 820, 330, 12, '#e2211b');
    dot(ctx, 760, 760, 10, '#e2211b');
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
      x.lineTo(1080 + Math.cos(a) * rr, kf(t, [[13.0, 670], [13.5, 735]]) + Math.sin(a) * rr * 1.1);
    }
    x.fill();
    if (t > 13.3) drawSprite(x, 'cat', 1090, 720, lerp(120, 190, ease.outBack(inv(13.3, 13.5, t))), 0, 1, { silhouette: '#0e0d0d' });
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
      fx.strokePartial(x, pts, e, p, 12, '#1c1414', false);
    });
    const arc = [];
    for (let i = 0; i <= 40; i++) {
      const u = i / 40;
      const ax = lerp(-150, 150, u);
      const ay = Math.sin(u * Math.PI) * 80;
      arc.push([735 + ax * 0.906 - ay * -0.423, 790 + ax * -0.423 * -1 + ay * 0.906 - 60]);
    }
    x.save();
    x.filter = `blur(${3 * S}px)`;
    fx.strokePartial(x, arc, e, p, 25, '#2a2a2a', true);
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
  if (t > 13.15 && t < 13.4) dot(x, 354, 180, 24, '#141212');
  if (t > 12.95 && t < 13.12) dot(x, 795, 800, 30, '#141212');
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
function sceneHand(ctx, t, f) {
  const bg = bgRamp(t, [[13.76, '#141313'], [15.4, '#141313'], [15.55, '#2c1517'], [15.66, '#3a2a2c'], [15.8, '#5b4e51'], [15.89, '#625658']]);
  fx.dark(ctx, bg);
  const fallP = inv(15.6, 15.89, t);
  if (fallP > 0) {
    ctx.save();
    ctx.filter = `blur(${80 * S}px)`;
    ctx.fillStyle = `rgba(165,155,158,${0.24 * fallP})`;
    ctx.fillRect(520, -100, 555, H + 200);
    ctx.restore();
  }
  const settle = ease.inOutCubic(inv(13.76, 14.32, t));
  const fall = ease.inOutCubic(fallP);
  let pose;
  if (t < 14.25) pose = blendPose('curl', 'open', settle);
  else if (t < 15.0) pose = blendPose('open', 'open', 0);
  else if (t < 15.6) pose = blendPose('open', 'curl', ease.inOutCubic(inv(15.38, 15.56, t)));
  else pose = blendPose('curl', 'fist', fall);
  const hand = thermalHand(pose);
  const [c, x] = off(0);
  x.save();
  const sway = noise1(t * 0.8, 6) * 0.02 + Math.sin(t * 2.2) * 0.01;
  x.translate(705, 1110);
  x.rotate(sway + (1 - settle) * -0.5 + fall * -0.25);
  x.scale(0.85, 0.92);
  x.translate(-740 + (1 - settle) * -35 + fall * -330, -1110 + (1 - settle) * 140 + fall * 30);
  if (settle < 1) x.filter = `hue-rotate(${-32 * (1 - settle)}deg) saturate(${1 + (1 - settle) * 0.9}) brightness(${lerp(0.8, 1, settle)})`;
  else if (fall > 0) x.filter = `saturate(${1 - fall * 0.85}) brightness(${1 + fall * 0.04})`;
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
    x.drawImage(rim, 262, 250);
    x.globalAlpha = 1;
    x.filter = f2;
  }
  x.drawImage(hand, 250, 250);
  x.restore();
  composite(ctx, c, { blur: (1 - settle) * 30 + fall * 4, alpha: 1 - fall * 0.1 });
  // white swirl arcs during the intro
  if (t < 14.25) {
    const q = inv(13.76, 14.2, t);
    for (let k = 0; k < 2; k++) {
      const cx = k === 0 ? 360 : 690;
      const pts = [];
      for (let i = 0; i <= 40; i++) pts.push([cx + Math.sin((i / 40) * Math.PI) * (k ? 70 : -30), 420 + i * 8.25]);
      ctx.save();
      ctx.filter = `blur(${3 * S}px)`;
      fx.strokePartial(ctx, pts, inv(0.6, 1, q), Math.min(1, q * 3), 7, 'rgba(240,236,230,0.75)');
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
    drawSprite(ctx, 'heart', 728, 545, w, 0, 1, { shadow: 'rgba(40,20,20,0.4)', shadowBlur: 22, shadowY: -10 });
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
    drawSprite(ctx, 'camera', 729, 540, kf(t, [[16.2, 340], [16.5, 345]]), noise1(t, 3) * 0.04, 1, { sy: 1.2 });
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
    drawSprite(ctx, 'vinyl', 729, 540, lerp(330, 350, q), 0, 1, { sx: lerp(0.38, 1, q), shadow: 'rgba(200,200,220,0.25)', shadowBlur: 30 });
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
  ['V', 19.2, 0.25, 26, 50, 4, 1.2, 15, -30],
  ['O', 19.22, 0.25, 14, 50, 5, 1.1, 0, -30],
  ['L', 19.24, 0.25, 22, 45, 6, 1.1, -30, 40],
  ['E', 19.26, 0.25, 34, 26, 7, 1.3, -10, -10],
  ['V', 19.45, 0.25, 40, 30, 8, 1.3, 10, 0],
  ['L', 19.47, 0.25, 60, 30, -35, 1.2, -12, 20],
  ['E', 19.5, 0.25, 34, 26, 11, 1.3, 0, 0],
  ['V', 19.7, 0.25, 34, 48, 12, 1.4, 0, -20],
  ['O', 19.7, 0.25, 12, 52, 13, 1.1, 2, -50],
  ['L', 19.72, 0.25, 50, 26, -30, 1.3, -10, 0],
  ['E', 19.74, 0.25, 34, 30, 15, 1.3, 0, 0],
];
const FINAL_LOOPS = [
  ['O', 6, 95, 31, 1.0, 2, -10],
  ['E', 60, 30, 33, 1.2, -45, -35],
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
      const L = lerp(len, k === 3 ? 160 : 280, sh);
      const pts = fx.wanderPoints(500 + k, L, lerp(curl, 0.3, sh), 60).map(([a, b]) => [a + lerp(ox, tx2, sh), b + lerp(oy, ty2, sh)]);
      // draw unfiltered into layers, then blur each layer once (per-segment filters are far too slow at 4K)
      fx.strokePartial(halo, pts, q * 0.3, 0.7 + q * 0.3, lerp(70, 18, sh), 'rgba(60,58,58,0.45)');
      fx.strokePartial(core, pts, q * 0.3 * (1 - sh), 0.7 + q * 0.3 + sh, lerp(32, 10, sh), '#1a1818', true);
    });
    composite(ctx, haloC, { blur: lerp(16, 8, sh), alpha: fade * lerp(1, 0.7, sh) });
    composite(ctx, coreC, { blur: lerp(5, 2, sh), alpha: fade * lerp(1, 0.7, sh) });
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
    const r = t < 17.9 ? 4 : lerp(r0, r1, inv(19.2, 19.7, t));
    dot(ctx, x, y, r * (t > 19.2 && t < 19.4 ? 0.5 : 1) * lerp(1, 1.1, grow), '#2a1714');
  });
  LOOPS.forEach(([ch, s, d, rx, ry, seed, turns, dx, dy]) => {
    if (t < s || t > s + d + 0.16) return;
    const [ax, ay] = pos[ch];
    const pts = (s < 18 ? fx.loopPoints(seed, rx * 0.8, ry * 0.8, 2.6, 200).map(([a, b], i) => [a + noise1(i * 0.2, seed) * 10, b + noise1(i * 0.2, seed + 4) * 10]) : smoothLoop(rx * 1.7, ry * 1.7, turns, seed)).map(([a, b]) => [a + ax + dx, b + ay + dy]);
    fx.strokePartial(ctx, pts, inv(s + d, s + d + 0.16, t), inv(s, s + d, t), s < 18 ? 1.3 : 1.6, '#e0402e');
  });
  if (t > 19.95) {
    FINAL_LOOPS.forEach(([ch, rx, ry, seed, turns, dx, dy]) => {
      const [ax, ay] = pos[ch];
      const pts = smoothLoop(rx, ry, turns, seed).map(([a, b]) => [a + ax + dx, b + ay + dy]);
      fx.strokePartial(ctx, pts, 0, inv(19.95, 20.1, t), 1.6, '#e0402e');
    });
    // diagonal pen tail from the upper left into the L
    const [lx, ly] = pos.L;
    fx.strokePartial(ctx, [[lx - 140, ly - 120], [lx - 70, ly - 50], [lx - 10, ly + 5]], 0, inv(19.95, 20.08, t), 1.6, '#e0402e');
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
  fx.grain(ctx, f, isDark ? 0.2 : 0.15);
  fx.vignette(ctx, 0.1, '0,0,0', 0.6);
}

module.exports = { renderFrame, TIMELINE, setScale };
