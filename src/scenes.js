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
  flat(ctx, '#e6e5e3', 'rgba(70,66,66,0.18)', 0, 0);
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
    const pts = SIGNATURE.map(([a, b]) => [a * 1.15 + 190, b * 1.35 + 760]);
    ctx.save();
    ctx.filter = `blur(${6 * S}px)`;
    ctx.globalAlpha = 0.35;
    fx.strokePartial(ctx, pts.map(([a, b]) => [a + 6, b + 4]), Math.max(0, inv(0.9, 0.98, t)), inv(0.64, 0.78, t), 6, '#77716f');
    ctx.restore();
    fx.strokePartial(ctx, pts, Math.max(0, inv(0.9, 0.98, t)), inv(0.64, 0.78, t), 3.8, '#5f5957');
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
    const loop = fx.loopPoints(5, 150, 50, 0.85).map(([a, b]) => [a + wordX(5) + 80, b + 548]);
    fx.strokePartial(ctx, loop, fade, inv(1.2, 1.27, t), 4.2, PEN);
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
    [[1, 708, 190, 1040, 430, '#d8241c', 12], [2, 954, 732, 1233, 612, '#d8241c', 12], [3, 1338, 672, 1203, 822, '#d8241c', 9], [4, 270, 100, 420, 30, 'rgba(50,46,46,0.75)', 5], [5, 960, 350, 1290, 190, 'rgba(50,46,46,0.75)', 5], [6, 480, 830, 810, 770, 'rgba(50,46,46,0.7)', 4], [7, 930, 930, 1110, 870, 'rgba(50,46,46,0.7)', 4]].forEach(([k2, ox, oy, ex, ey, col, lw]) => {
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
  const slide = 36 * (1 - ease.outCubic(inv(t0 + 0.05, t0 + 0.3 + hold, t)));
  x -= slide;
  curX -= slide * 0.3;
  fx.text(ctx, word, x, y, CARD, CREAM, { blur: p < 0.3 && !hold ? 2.5 : 0, glow: 'rgba(243,239,232,0.35)', glowBlur: 6 });
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
  const pos = kf(t, [[8.3, [575, 520]], [8.342, [567, 513]], [8.383, [553, 540]], [8.425, [540, 540]], [8.467, [527, 527]], [8.59, [513, 527]], [8.675, [527, 473], 'inOutCubic'], [8.84, [520, 473]], [8.93, [486, 513], 'inOutCubic'], [9.05, [472, 540]], [9.13, [465, 545]]]);
  const rot = kf(t, [[8.3, -0.12], [8.383, -0.15], [8.59, -0.2], [8.675, 1.85, 'inOutCubic'], [8.84, 1.85], [8.93, -0.18, 'inOutCubic'], [9.13, -0.22]]);
  const width = kf(t, [[8.3, 392], [8.59, 400], [8.675, 640, 'inOutCubic'], [8.84, 640], [8.93, 880, 'inOutCubic'], [9.13, 860]]);
  const sy = kf(t, [[8.3, 1], [8.84, 1], [8.93, 0.24, 'inOutCubic'], [9.13, 0.22]]);
  const blur = kf(t, [[8.3, 3], [8.36, 1.5], [8.383, 0.5], [8.405, 3], [8.425, 4], [8.467, 3], [8.5, 1.5], [8.55, 0.5], [8.59, 1], [8.63, 0], [8.65, 3], [8.675, 0], [8.88, 0], [8.9, 3], [8.93, 0]]);
  const [c, x] = off(0);
  x.save();
  x.filter = 'saturate(0.8)';
  drawSprite(x, 'camera', pos[0], pos[1], width, rot, 1, { sy });
  x.restore();
  const st = kf(t, [[8.3, 0.9], [8.4, 0.85], [8.6, 0.85], [8.675, 2.0, 'outCubic'], [8.84, 2.0], [8.93, 1.3], [9.13, 1.1]]);
  const sxs = kf(t, [[8.59, 1], [8.675, 0.36, 'outCubic'], [8.84, 0.36], [8.93, 2.2, 'outCubic'], [9.13, 2.2]]);
  x.save();
  const anchor = kf(t, [[8.3, [634, 405]], [8.383, [648, 330]], [8.59, [590, 350]], [8.675, [540, 230], 'inOutCubic'], [8.84, [540, 230]], [8.93, [880, 345], 'inOutCubic'], [9.05, [840, 272]], [9.13, [830, 260]]]);
  x.translate(anchor[0], anchor[1]);
  x.rotate(kf(t, [[8.3, 0.3], [8.6, 0.1], [8.75, 0], [8.93, -0.3], [9.13, -0.36]]));
  x.scale(sxs, 1 / Math.sqrt(sxs));
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
  if (t > 8.95) fx.strokePartial(ctx, [[900, 456], [990, 452]], 0, inv(8.95, 9.02, t), 4, CREAM);
  sparks(ctx, t, 2, 7);
  typed(ctx, 'action.', 8.32, t, 966, 530, 1300);
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
  x.save();
  // the ribbon rides in attached to the book
  x.translate(kf(t, [[9.84, 270], [9.926, 0, 'outCubic']]), kf(t, [[9.84, -40], [9.926, 0]]));
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
  x.restore();
  const bp = kf(t, [[9.84, [720, 560]], [9.885, [500, 580]], [9.926, [445, 575], 'outCubic'], [10.51, [425, 570]]]);
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
  const pan = 0;
  ctx.save();
  const vin = ease.outBack(inv(11.01, 11.15, t));
  const vx = kf(t, [[11.01, 500], [11.08, 496], [11.25, 430, 'outCubic'], [11.6, 410], [11.81, 250, 'inQuad']]);
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
  const nd = ease.inQuad(inv(11.6, 11.81, t));
  if (t > 11.1) note(ctx, 'quarter', 1044 - 130 * nd, 800, pop(11.1) * 1.7, 0.12 - 0.9 * nd + noise1(t, 1) * 0.08);
  if (t > 11.35) note(ctx, 'beam', 750 - 120 * nd, 270 - 30 * nd, pop(11.35) * 1.9, -0.12 + 0.6 * nd + noise1(t, 2) * 0.08);
  if (t > 11.42) note(ctx, 'eighth', 630 - 140 * nd, 815, pop(11.42) * 1.9, 0.15 + 0.1 * nd + noise1(t, 3) * 0.08);
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
const SIL = { heart: 12.45, skateboard: 12.7 };

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
  const n = Math.round(r * 9);
  for (let i = 0; i < n; i++) {
    const a = g() * Math.PI * 2;
    const d = r * (0.8 + Math.pow(g(), 2) * 0.45);
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
  [[[140, 290], [175, 225], [215, 240], [240, 170], [300, 120], [345, 140], [300, 190], [262, 150]], 12.76, 12.79, 12.83, 12.87],
  [[[745, 285], [770, 180], [800, 95], [860, 70], [905, 110], [880, 180], [810, 230]], 12.76, 12.8, 12.83, 12.87],
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
  ctx.fillStyle = '#e2e2e2';
  ctx.fillRect(0, 0, W, H);
  const spin = inv(11.85, 12.03, t);
  const phi = kf(t, [[11.85, -1.9], [11.887, -1.55], [11.928, -0.85], [11.97, -0.35], [12.012, -0.1], [12.054, 0], [12.25, 0.26, 'linear'], [12.42, 0.36, 'linear']]);
  const burstP = ease.inOutCubic(inv(12.43, 12.56, t));
  const z = kf(t, [[12.6, 1], [13.47, 0.95, 'linear'], [13.68, 0.88, 'inQuad'], [13.722, 0.7], [13.76, 0.62]]);
  const turn = kf(t, [[12.6, 0], [13.47, 0.21, 'linear'], [13.68, 0.65, 'inQuad'], [13.722, 1.0, 'inQuad'], [13.76, 1.3]]);
  const [c, x] = off(0);
  x.save();
  camera(x, { z, cx: 700, cy: 560, x: kf(t, [[12.25, 0], [12.4, 30]]) });
  let heartAt = null;
  // the layout orbits clockwise about (700, 560); icons themselves stay upright
  const ca = Math.cos(turn);
  const sa = Math.sin(turn);
  const orbit = (px, py) => [700 + (px - 700) * ca - (py - 560) * sa, 560 + (px - 700) * sa + (py - 560) * ca];
  const ring = ringLayout(phi - 0.21, { tilt: 0.4, R: 385, cx: 715, cy: 511, F: 4000 });
  const RING_ROT = { skateboard: -0.5, cash: 0.4, cap: -0.15, book: 0.12 };
  ring
    .slice()
    .sort((a, b) => (burstP > 0.5 ? (a.name === 'plant' ? -1 : b.name === 'plant' ? 1 : b.z - a.z) : b.z - a.z))
    .forEach((it) => {
      if (it.name === 'cat' && t > 12.4) return; // cat is reborn from the ink blot
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
    const keys = [[11.85, [1300, 560]], [11.887, [664, 564]], [11.928, [330, 650]], [11.97, [240, 760]], [12.012, [460, 290]], [12.054, [700, 500]], [12.1, [740, 540]], [12.45, [750, 545]]];
    const trail = [];
    for (let i = 0; i <= 12; i++) trail.push(kf(Math.max(11.85, t - i * 0.006), keys));
    inkBall(x, trail[0][0], trail[0][1], 50, trail, 15);
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
    if (t > a && t < d) ribbon(x, pts, inv(c2, d, t), inv(a, b, t), 14);
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
    const sx0 = 700 + (hx - 700) * z + kf(t, [[12.25, 0], [12.4, 30]]);
    const sy0 = 560 + (hy - 560) * z;
    drawSprite(x, 'heart', lerp(sx0, tgt[0], k), lerp(sy0, tgt[1], k), hw * z, hr, 1, { silhouette: '#121010' });
    x.restore();
  }
  x.restore();
  // motion-blur flashes on the ink hits, then the whip into the hand shot
  const flashBlur = kf(t, [[12.73, 0], [12.76, 4], [12.79, 0], [12.97, 0], [13.01, 8], [13.05, 0], [13.7, 0], [13.722, 1.5], [13.76, 4]]);
  composite(ctx, c, { blur: spin < 1 ? (1 - spin) * 14 : flashBlur });
  if (t > 13.69) {
    // thin black speed arcs sweeping with the turn
    const k = inv(13.69, 13.76, t);
    [[560, 620, 330, 240, 3.0, 4.3], [620, 660, 430, 330, 1.75, 2.85], [780, 600, 380, 230, -0.35, 0.6], [470, 440, 120, 160, 3.5, 4.6]].forEach(([cx, cy, rx, ry, a0, a1]) =>
      ribbon(ctx, arcPts(cx, cy, rx, ry, a0 + k * 0.4, a1 + k * 0.4), 0, Math.min(1, k * 3), 8, 'rgba(20,18,18,0.9)', 1.2));
  }
  // symmetric vignette that deepens through the shot (corners #a3 -> #83 -> #58)
  const va = kf(t, [[11.85, 0.26], [12.6, 0.28], [13.47, 0.42], [13.68, 0.61], [13.722, 0.78], [13.76, 0.85]]);
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
