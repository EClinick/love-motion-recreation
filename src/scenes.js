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
const TYPE_T = [0, 0, 0, 0, 0.875, 1.25, 1.5, 1.75, 1.875, 1.96];

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
    [0.27, 0, 'inQuad'],
    [0.33, -700, 'linear'],
    [0.4, -1150, 'linear'],
    [0.46, -1330, 'outQuad'],
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
  if (t > 0.2 && t < 0.31) {
    const p = ease.outExpo(inv(0.2, 0.24, t));
    x.fillStyle = '#0d0c0c';
    x.fillRect(lerp(1440, 880, p), 384, 480, 246);
    const pts = fx.scribblePoints(41, 520, 60, 3, 90).map(([a, b]) => [a + 745, b + 655]);
    fx.strokePartial(x, pts, 0, inv(0.22, 0.3, t), 3, '#2a1a10');
  }
  // selection handles
  if (t > 0.48) {
    x.fillStyle = '#2a2624';
    [444, 504, 564, 624].forEach((yy) => x.fillRect(1100, yy, 10, 10));
  }
  if (zp > 0.05 && zp < 1) {
    // the whip reads as a crisp pixel-dot smear, not a gaussian blur
    mosaic(ctx, c, lerp(2, 9, Math.sin(Math.PI * zp)), {});
  } else composite(ctx, c, { blur: t > 0.25 && t < 0.4 ? 2.5 : 0 });
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
    const pts = fx.scribblePoints(11, 560, 170, 6, 320).map(([a, b]) => [a + 110, b + 630]);
    fx.strokePartial(ctx, pts, Math.max(0, inv(0.86, 0.98, t)), inv(0.64, 0.84, t), 3.4, PEN);
  }
  if (t > 0.7 && t < 0.95) fx.strokePartial(ctx, [[530, 330], [524, 420], [516, 512]], 0, inv(0.7, 0.78, t), 3.4, PEN);
  // long brown arc on the right with a little tail
  if (t > 0.92 && t < 1.16) {
    const arc = [];
    for (let i = 0; i <= 60; i++) {
      const u = i / 60;
      arc.push([lerp(980, 1070, Math.sin(u * Math.PI * 0.9)) - u * 30, lerp(0, 720, u)]);
    }
    const tail = fx.scribblePoints(15, 230, 60, 4, 80).map(([a, b]) => [1010 - a, b + 730]);
    fx.strokePartial(ctx, [...arc, ...tail], Math.max(0, inv(1.06, 1.16, t)), inv(0.92, 1.04, t), 3.6, PEN);
    fx.strokePartial(ctx, [[735, 240], [728, 290], [745, 330], [760, 310]], 0, inv(0.95, 1.0, t), 3.4, PEN);
  }
  // strike + loop round "that you're", then a tail flick
  if (t > 1.2 && t < 1.42) {
    const xa = wordX(4);
    const xb = wordX(6) - 12;
    const fade = inv(1.36, 1.42, t);
    const loop = fx.loopPoints(5, (xb - xa) / 2 + 20, 24, 1.05).map(([a, b]) => [a + (xa + xb) / 2 + 20, b + 548]);
    fx.strokePartial(ctx, [[xa - 10, 548], [xb + 40, 544]], fade, inv(1.2, 1.3, t), 3.4, PEN);
    fx.strokePartial(ctx, loop, fade, inv(1.24, 1.34, t), 3.4, PEN);
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
  const g = ctx.createRadialGradient(990, 545, lerp(150, 230, spot), 990, 560, lerp(900, 640, spot));
  g.addColorStop(0, C.hex(warmCol, Math.min(1, lerp(0.05, 0.42, spot) + warm * 0.5)));
  g.addColorStop(0.45, C.hex(warmCol, lerp(0, 0.12, spot) + warm * 0.3));
  g.addColorStop(0.78, `rgba(36,20,20,${0.55 * vs})`);
  g.addColorStop(1, `rgba(26,15,16,${0.97 * vs})`);
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
  const scx = -70;
  const scy = 505;
  const R = kf(t, [[2.0, 1150], [2.18, 880, 'outExpo'], [2.5, 770], [3.0, 690], [3.8, 670]]);
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
  x2.strokeStyle = 'rgba(31,106,90,0.8)';
  x2.lineWidth = 4;
  x2.filter = `blur(${2 * S}px)`;
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
  if (t < 2.4) {
    const q = inv(1.96, 2.3, t);
    [[1, 700, 460, 380, 0.6, '#d8241c', 10], [2, 140, 760, 300, 1.2, '#2a2422', 6], [3, 300, 900, 260, 1.4, '#2a2422', 5], [4, 1080, 260, 200, 1.0, '#d8241c', 6]].forEach(([k2, ox, oy, len, curl, col, lw]) => {
      const pts = fx.wanderPoints(600 + k2, len, curl, 40).map(([a, b]) => [a + ox, b + oy]);
      fx.strokePartial(ctx, pts, Math.max(0, q * 1.4 - 0.4), Math.min(1, q * 1.4), lw, col, true);
    });
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

  const settle = ease.outCubic(inv(3.82, 4.15, t));
  const z = lerp(1, 1.04, inv(4.1, 6.2, t));
  const [sx, sy] = shake(t, 2.2, 0.8, 21);
  ctx.save();
  camera(ctx, { x: sx, y: sy, z, cx: 900, cy: 600 });

  const drift = kf(t, [[4.1, 0], [5.0, 70, 'linear'], [5.6, 105, 'linear'], [6.3, 125]]);
  const toTan = ease.inOutQuad(inv(5.6, 5.85, t));
  const toShadow = ease.inOutQuad(inv(6.02, 6.12, t));
  const shrink = lerp(1, 0.92, ease.inOutQuad(inv(5.85, 6.0, t)));
  const hx = 600 + drift + (1 - settle) * 160 + (1 - shrink) * 300;
  const hy = 225 + (1 - settle) * 240 - (1 - shrink) * 700;
  const hz = (1 + (1 - settle) * 0.12) * shrink;
  const [c, x] = off(1);
  x.save();
  x.translate(hx, hy);
  x.scale(hz, hz);
  const heat = thermal('head', 'heat');
  if (toShadow < 1) {
    x.globalAlpha = 1 - toShadow;
    if (settle < 1) x.filter = `hue-rotate(${-70 * (1 - settle)}deg) saturate(${1 + (1 - settle) * 0.6}) brightness(${lerp(0.75, 1, settle)})`;
    else if (toTan > 0) x.filter = `saturate(${lerp(1, 0.5, toTan)}) brightness(${lerp(1, 0.8, toTan)}) sepia(${toTan * 0.7})`;
    x.drawImage(heat, 0, 0);
    x.filter = 'none';
    if (toTan > 0.5) {
      // dark ring "burn" in the hair
      x.save();
      x.globalAlpha = (1 - toShadow) * clamp((toTan - 0.5) * 2);
      x.strokeStyle = '#2a1a0c';
      x.lineWidth = 34;
      x.filter = `blur(${3 * S}px)`;
      x.beginPath();
      x.ellipse(390, 220, 110, 130, 0.3, 0, 7);
      x.stroke();
      x.fillStyle = '#6a5a2a';
      x.fill();
      x.restore();
    }
  }
  if (toShadow > 0) {
    x.globalAlpha = toShadow;
    x.drawImage(thermal('head', 'shadow'), 0, 0);
  }
  x.restore();
  composite(ctx, c, { blur: (1 - settle) * 40 });

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
  if (t > 4.32 && t < 4.5) {
    const q = ease.outCubic(inv(4.32, 4.42, t));
    const q2 = ease.inCubic(inv(4.42, 4.5, t));
    ctx.save();
    ctx.strokeStyle = 'rgba(250,248,244,0.95)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(960 + drift, 430, 370, 92, -0.3, Math.PI * 2 * q2, Math.PI * 2 * q);
    ctx.stroke();
    ctx.restore();
  }
  if (t > 4.55 && t < 4.85) {
    const a0 = inv(4.75, 4.85, t);
    fx.strokePartial(ctx, fx.loopPoints(71, 22, 50, 0.6).map(([a, b]) => [a + 1165 + drift, b + 420]), a0, inv(4.55, 4.62, t), 6, CREAM);
    fx.strokePartial(ctx, fx.loopPoints(72, 100, 40, 0.9).map(([a, b]) => [a + 1150 + drift, b + 690]), a0, inv(4.6, 4.7, t), 6, CREAM);
  }
  if (t > 4.85 && t < 5.25) dot(ctx, 1074, 384, 5, '#fff');
  ctx.restore();

  // text
  const intro = inv(3.82, 4.0, t);
  let parts;
  if (t < 5.22) parts = [{ t: 'you', c: CREAM }, { t: 'dont.', c: CREAM }];
  else if (t < 5.36) parts = [{ t: 'you', c: CREAM }];
  else if (t < 5.56) parts = [{ t: 'you', c: CREAM }, { t: 'just', c: CREAM }];
  else if (t < 5.97) {
    const g = inv(5.56, 5.9, t);
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
const RING_W = { clapper: 240, skateboard: 260, vinyl: 200, book: 200, camera: 200, cat: 180, coin: 190, controller: 240, cap: 250, heart: 350, cash: 350, plant: 240 };

function ringLayout(phi, { cx = 770, cy = 600, R = 600, tilt = 0.99, F = 3000 } = {}) {
  return RING.map((name, i) => {
    const a = Math.PI + (i / RING.length) * Math.PI * 2 + phi;
    const X = Math.cos(a) * R;
    const Z = -Math.sin(a) * R;
    const y = -Z * Math.cos(tilt);
    const zc = Z * Math.sin(tilt);
    const s = F / (F + zc);
    return { name, x: cx + X * s, y: cy + y * s, s, z: zc, i };
  });
}

const ringPhi = (t) =>
  kf(t, [
    [6.38, -2.4],
    [6.95, -0.05, 'outCubic'],
    [8.0, 0.32, 'linear'],
    [8.3, 0.6, 'inQuad'],
  ]);
const ringAt = (t) => ringLayout(ringPhi(t));
const iconPos = (t, name) => {
  const it = ringAt(t).find((o) => o.name === name);
  return [it.x, it.y];
};

const HITS = [
  [7.125, 'cap'],
  [7.25, 'heart'],
  [7.5, 'cash'],
  [7.75, 'plant'],
];

function ballKeys() {
  const k = [
    [6.5, [760, 600]],
    [6.7, [700, 560], 'outQuad'],
    [6.98, [800, 330], 'inOutQuad'],
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
  const g = ctx.createRadialGradient(x, y, 0, x, y, 200);
  g.addColorStop(0, `rgba(255,190,70,${0.9 * a})`);
  g.addColorStop(0.4, `rgba(255,150,40,${0.5 * a})`);
  g.addColorStop(1, 'rgba(255,140,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - 220, y - 220, 440, 440);
  const r = rng(seed);
  ctx.strokeStyle = `rgba(240,160,30,${a})`;
  ctx.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    const an = r() * Math.PI * 2;
    const r0 = 120 + r() * 40;
    const r1 = r0 + 60 + r() * 70;
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
    const top = H * 0.62;
    const g = ctx.createLinearGradient(0, top, 0, H);
    g.addColorStop(0, 'rgba(60,0,0,0)');
    g.addColorStop(0.45, '#8a0a0a');
    g.addColorStop(0.75, '#ff7a10');
    g.addColorStop(1, '#fff2d0');
    ctx.fillStyle = g;
    ctx.fillRect(0, top, W, H - top);
    return;
  }
  if (!BALL) BALL = ballKeys();
  flat(ctx, '#e2e1df', 'rgba(80,76,74,0.18)', W, H);
  const zoom = kf(t, [
    [6.37, 1.7],
    [6.9, 1.0, 'outCubic'],
    [8.0, 1.02, 'linear'],
    [8.3, 2.4, 'inExpo'],
  ]);
  const camX = kf(t, [[8.0, 0], [8.3, -560, 'inExpo']]);
  const camR = kf(t, [[6.37, 0.35], [6.9, 0, 'outCubic']]);
  const [sx, sy] = shake(t, 3, 1, 33);

  const [c, x] = off(0);
  x.save();
  camera(x, { x: sx + camX, y: sy, z: zoom, r: camR, cx: 770, cy: 600 });
  const items = ringAt(t);
  const hitAmt = (name) => {
    let a = 0;
    HITS.forEach(([ht, n]) => {
      if (n === name) a = Math.max(a, 1 - Math.abs(t - ht - 0.03) / 0.11);
    });
    return clamp(a);
  };
  items
    .slice()
    .sort((a, b) => b.z - a.z)
    .forEach((it) => {
      const w = RING_W[it.name] * it.s;
      const hit = hitAmt(it.name);
      const rot = noise1(t * 2 + it.i, it.i) * 0.06;
      drawSprite(x, it.name, it.x, it.y, w * (1 + hit * 0.1), rot);
      if (hit > 0) drawSprite(x, it.name, it.x, it.y, w * (1 + hit * 0.1), rot, hit * 0.75, { silhouette: '#f39a2a' });
    });
  HITS.forEach(([ht, n], k) => {
    const [px, py] = iconPos(ht, n);
    flash(x, px, py, 1 - Math.abs(t - ht - 0.03) / 0.1, k + 3);
  });
  // black ink scribble dragged across the heart after its hit
  if (t > 7.25 && t < 7.45) {
    const [hx, hy] = iconPos(7.25, 'heart');
    const pts = fx.wanderPoints(88, 380, 0.8, 50).map(([a, b]) => [a * 0.9 + hx - 190, b * 0.3 + hy - 40]);
    fx.strokePartial(x, pts, inv(7.37, 7.45, t), inv(7.25, 7.32, t), 22, '#141010', true);
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
function typed(ctx, word, t0, t, x, y, curX) {
  const wFull = fx.measure(ctx, word, CARD);
  if (t < t0 + 0.07) {
    // solid white selection block first
    ctx.fillStyle = CREAM;
    ctx.fillRect(x - 6, y - CARD * 0.36, wFull + 12, CARD * 0.74);
    return;
  }
  const p = inv(t0 + 0.07, t0 + 0.22, t);
  const n = Math.ceil(lerp(word.length - 3, word.length, p));
  const shown = word.slice(0, n);
  const w = fx.measure(ctx, shown, CARD);
  fx.text(ctx, shown, x, y, CARD, CREAM, { blur: p < 0.3 ? 2.5 : 0, glow: 'rgba(243,239,232,0.35)', glowBlur: 6 });
  const blk = 1 - ease.outCubic(p);
  if (blk > 0.02) {
    ctx.fillStyle = CREAM;
    ctx.fillRect(x + w + 8, y - CARD * 0.36, lerp(30, 200, blk), CARD * 0.72);
  }
  if (p >= 1) {
    const q = inv(t0 + 0.22, t0 + 0.4, t);
    const cw = lerp(35, 12, ease.outCubic(q));
    const on = q < 1 || blinkOn(t - t0, 0.36);
    ctx.fillStyle = on ? CREAM : 'rgba(243,239,232,0.3)';
    ctx.fillRect(curX - cw / 2, y - 45, cw, 90);
  }
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
  const pos = kf(t, [[8.3, [560, 560]], [8.45, [540, 420], 'outCubic'], [8.55, [532, 395]], [8.75, [512, 435], 'inOutCubic'], [9.0, [330, 800], 'inOutCubic'], [9.13, [320, 810]]]);
  const rot = kf(t, [[8.3, -0.05], [8.45, -0.15, 'outCubic'], [8.55, -0.12], [8.75, 1.62, 'inOutCubic'], [9.0, -0.35, 'inOutCubic'], [9.13, -0.38]]);
  const width = kf(t, [[8.3, 450], [8.55, 405], [8.75, 620], [9.0, 900], [9.13, 940]]);
  const sy = kf(t, [[8.3, 1], [8.8, 1], [8.95, 0.24, 'inOutCubic'], [9.13, 0.22]]);
  const blur = kf(t, [[8.3, 10], [8.4, 2], [8.48, 0], [8.65, 0], [8.72, 3], [8.78, 0], [8.88, 3], [8.95, 0]]);
  const [c, x] = off(0);
  drawSprite(x, 'camera', pos[0], pos[1], width, rot, 1, { sy });
  // white zigzag + red slashes at the cut
  if (q < 0.14) {
    const zz = [[850, 380], [960, 460], [880, 540], [1010, 600], [930, 680], [1100, 740]];
    fx.strokePartial(x, zz, inv(8.36, 8.44, t), inv(8.3, 8.34, t), 6, CREAM);
    burst(x, 700, 540, q / 0.14, 8, ['#e8231d']);
  }
  const st = kf(t, [[8.3, 0.6], [8.4, 1, 'outBack'], [8.6, 1.2], [8.75, 1.45], [9.13, 1.0]]);
  const sxs = kf(t, [[8.8, 1], [8.95, 2.6, 'outCubic']]);
  x.save();
  const anchor = kf(t, [[8.3, [650, 480]], [8.55, [640, 290]], [8.75, [560, 130]], [9.0, [560, 420]], [9.13, [570, 410]]]);
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
  ['skateboard', -620, 0, 280, 1],
  ['clapper', -380, -10, 290, 1],
  ['plant', -160, 0, 250, 2],
  ['cash', 130, 10, 340, 3],
  ['camera', 330, -40, 200, 0],
  ['heart', 480, 0, 320, 4],
  ['cap', 770, -10, 290, 3],
  ['controller', 1040, 0, 300, 2],
  ['coin', 1320, 0, 260, 3],
  ['cat', 1560, 0, 250, 1],
];

function sceneStripA(ctx, t, f) {
  flat(ctx, '#e3e2e0', 'rgba(80,76,74,0.15)', W, H);
  const ox = kf(t, [[9.13, 560], [9.6, 320, 'linear'], [9.75, -450, 'inQuad'], [9.84, -800]]);
  const [c, x] = off(0);
  row(x, ROW_A, ox, 560, t);
  composite(ctx, c, { blur: t > 9.62 ? (t - 9.62) * 60 : t < 9.2 ? (9.2 - t) * 60 : 0 });
  speedLines(ctx, t, 7, t > 9.65 ? 8 : 2);
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
  const wmax = kf(t, [[9.84, 60], [10.0, 200], [10.18, 220], [10.28, 420, 'inOutCubic']]);
  x.fillStyle = '#e2211b';
  x.beginPath();
  const N = 50;
  const wAt = (k) => lerp(18, wmax, Math.pow(k, 1.6));
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
  const bp = kf(t, [[9.84, [470, 520]], [10.0, [440, 500], 'outCubic'], [10.51, [425, 505]]]);
  const bw = kf(t, [[9.84, 470], [10.1, 500], [10.51, 520]]);
  drawSprite(x, 'book', bp[0], bp[1], bw, kf(t, [[9.84, -0.25], [10.0, -0.06]]) + noise1(t * 2, 4) * 0.04, 1, { shadow: 'rgba(255,40,30,0.35)', shadowBlur: 30 });
  composite(ctx, c, { blur: (1 - ease.outCubic(inv(9.84, 9.98, t))) * 25 });
  if (t < 10.0) fx.grain(ctx, f + 5, 0.25);
  sparks(ctx, t, 4, 6);
  if (t > 9.95) typed(ctx, 'intention.', 9.95, t, 834, 540, 1308);
}

const ROW_B = [
  ['heart', -700, 0, 300, 2],
  ['cap', -480, -10, 290, 3],
  ['controller', -250, 0, 300, 4],
  ['coin', 0, 0, 350, 5],
  ['cat', 230, 10, 380, 1],
  ['camera', 470, -20, 330, 0],
  ['book', 700, 0, 280, 1],
];

function sceneStripB(ctx, t, f) {
  flat(ctx, '#e3e2e0', 'rgba(80,76,74,0.15)', W, H);
  const ox = kf(t, [[10.51, 990], [10.75, 625, 'outCubic'], [11.01, 300, 'inCubic']]);
  const [c, x] = off(0);
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
    [['cash', 380, 560, 360], ['heart', 760, 555, 330], ['cap', 1130, 545, 330]].forEach(([n, px, py, w]) => {
      drawSprite(ctx, n, px, py, w * 1.04, 0, 0.9, { silhouette: '#cfcfcf' });
      ctx.save();
      ctx.filter = 'grayscale(1) brightness(0.5) contrast(0.85)';
      drawSprite(ctx, n, px, py, w, 0);
      ctx.restore();
    });
    return;
  }
  const pan = kf(t, [[11.55, 0], [11.72, -200, 'inCubic']]);
  ctx.save();
  ctx.translate(pan, 0);
  const vin = ease.outBack(inv(11.01, 11.15, t));
  drawSprite(ctx, 'vinyl', 425, 545, 375 * lerp(0.75, 1, vin), noise1(t, 9) * 0.05);
  if (t < 11.16) burst(ctx, 425, 545, inv(11.01, 11.16, t), 61);
  const pop = (t0) => ease.outBack(inv(t0, t0 + 0.12, t), 2.2);
  if (t > 11.1) note(ctx, 'quarter', 1044, 800, pop(11.1) * 1.7, 0.12 + noise1(t, 1) * 0.08);
  if (t > 11.35) note(ctx, 'beam', 750, 270, pop(11.35) * 1.9, -0.12 + noise1(t, 2) * 0.08);
  if (t > 11.58) note(ctx, 'eighth', 640, 820, pop(11.58) * 2.4, 0.15 + noise1(t, 3) * 0.08);
  ctx.restore();
  sparks(ctx, t, 6, 5);
  typed(ctx, 'curiosity.', 11.01, t, 804 + pan, 536, 1323 + pan);
}

// =====================================================================
// 7. Ring again (top view) then the ink scatter.
// =====================================================================
const TOP_W = { clapper: 200, skateboard: 230, vinyl: 190, book: 190, camera: 190, cat: 170, coin: 175, controller: 210, cap: 210, heart: 255, cash: 260, plant: 190 };
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
  const phi = kf(t, [[11.85, -1.6], [12.0, 0, 'outCubic'], [12.42, 0.18, 'linear']]);
  const burstP = ease.outCubic(inv(12.38, 12.58, t));
  const z = kf(t, [[12.5, 1], [13.76, 1.06, 'linear']]);
  const [c, x] = off(0);
  x.save();
  camera(x, { z, x: kf(t, [[12.25, 0], [12.4, 30]]) });
  const ring = ringLayout(phi, { tilt: 0.12, R: 430, cx: 750, cy: 545, F: 4000 });
  ring
    .slice()
    .sort((a, b) => b.z - a.z)
    .forEach((it) => {
      if (it.name === 'cat' && t > 12.4) return; // cat is reborn from the ink blot
      if (it.name === 'coin' && t > 12.92) return; // coin turns into the blot
      const tgt = SCATTER[it.name];
      const px = lerp(it.x, tgt[0], burstP);
      const py = lerp(it.y, tgt[1], burstP);
      const w = lerp(TOP_W[it.name], tgt[2], burstP);
      const sil = SIL[it.name] && t > SIL[it.name];
      const r = burstP * tgt[3] * noise1(t * 1.5 + it.i, it.i) * 0.45;
      if (it.name === 'cash' && t > 13.2) {
        // money smears into a black dab
        const q = inv(13.2, 13.35, t);
        x.save();
        x.filter = `blur(${3 * S}px)`;
        drawSprite(x, 'cash', lerp(px, 210, q), lerp(py, 995, q), w * lerp(1, 0.7, q), lerp(r, -0.3, q), 1, { silhouette: '#121010' });
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
    const br = kf(t, [[12.85, 20], [13.0, 85, 'outBack'], [13.76, 92]]);
    x.save();
    x.filter = `blur(${3 * S}px)`;
    x.fillStyle = '#0e0d0d';
    x.beginPath();
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const rr = br * (1 + noise1(a * 3 + t * 4, 7) * 0.08);
      x.lineTo(1110 + Math.cos(a) * rr, 640 + Math.sin(a) * rr * 1.1);
    }
    x.fill();
    if (t > 13.3) drawSprite(x, 'cat', 1150, 640, lerp(120, 190, ease.outBack(inv(13.3, 13.5, t))), 0, 1, { silhouette: '#0e0d0d' });
    x.restore();
  }
  if (t > 12.4) {
    // thick calligraphic swirls and grey brush strokes
    [[0, 12.42, 0.3, 110, 640, 300, 2.4, 13], [1, 12.5, 0.3, 200, 780, 260, 2.8, 12], [2, 12.45, 0.35, 680, 790, 260, 0.9, 0], [3, 13.0, 0.35, 760, 900, 420, 1.6, 0]].forEach(([k, s, d, ox, oy, len, curl, ink]) => {
      if (t < s || t > s + d + 0.2) return;
      const pts = fx.wanderPoints(200 + k, len, curl, 80).map(([a, b]) => [a + ox, b + oy]);
      const p = inv(s, s + d, t);
      if (ink) {
        fx.strokePartial(x, pts, Math.max(0, p - 0.6), p, ink, '#1c1414', true);
      } else {
        x.save();
        x.filter = `blur(${6 * S}px)`;
        fx.strokePartial(x, pts, Math.max(0, p - 0.5), p, 46, 'rgba(40,38,38,0.42)');
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
  if (t > 13.45) {
    fx.text(x, 'through', 470, 545, 34, '#1d1a18');
    x.fillStyle = '#0e0d0d';
    x.fillRect(612, 524, lerp(0, 200, ease.outExpo(inv(13.45, 13.52, t))), 44);
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
    ctx.fillStyle = `rgba(150,140,142,${0.35 * fallP})`;
    ctx.fillRect(520, 0, 555, H);
  }
  const settle = ease.outCubic(inv(13.76, 14.25, t));
  const fall = ease.inOutCubic(fallP);
  let pose;
  if (t < 14.25) pose = blendPose('curl', 'open', settle);
  else if (t < 15.0) pose = blendPose('open', 'open', 0);
  else if (t < 15.6) pose = blendPose('open', 'curl', ease.inOutCubic(inv(15.0, 15.5, t)));
  else pose = blendPose('curl', 'fist', fall);
  const hand = thermalHand(pose);
  const [c, x] = off(0);
  x.save();
  const sway = noise1(t * 0.8, 6) * 0.02 + Math.sin(t * 2.2) * 0.01;
  x.translate(740, 1110);
  x.rotate(sway + (1 - settle) * -0.5 + fall * -0.25);
  x.translate(-740 + (1 - settle) * -160 + fall * -320, -1110 + (1 - settle) * 120 + fall * 230);
  if (settle < 1) x.filter = `hue-rotate(${-50 * (1 - settle)}deg) saturate(${1 + (1 - settle) * 0.8}) brightness(${lerp(0.7, 1, settle)})`;
  else if (fall > 0) x.filter = `saturate(${1 - fall * 0.85}) brightness(${1 + fall * 0.25})`;
  x.drawImage(hand, 250, 250);
  x.restore();
  composite(ctx, c, { blur: (1 - settle) * 40 + fall * 4, alpha: 1 - fall * 0.1 });
  // white swirl arcs during the intro
  if (t < 14.25) {
    const q = inv(13.76, 14.2, t);
    for (let k = 0; k < 3; k++) {
      const pts = fx.loopPoints(400 + k, 160 + k * 40, 340, 0.7).map(([a, b]) => [a + 560 + k * 50, b + 640]);
      ctx.save();
      ctx.filter = `blur(${3 * S}px)`;
      fx.strokePartial(ctx, pts, q * 0.7, 0.3 + q * 0.7, 7, 'rgba(240,236,230,0.7)');
      ctx.restore();
    }
  }
  // thick blurred comet streaks converging left as the hand drops away
  if (fall > 0) {
    ctx.save();
    ctx.filter = `blur(${7 * S}px)`;
    const r = rng(90);
    for (let i = 0; i < 5; i++) {
      const y = 320 + r() * 160;
      const x0 = 80 + r() * 420 + (1 - fall) * 300;
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
  const dx = -175 * ease.inCubic(fallP);
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
    const w = kf(t, [[15.89, 290], [16.04, 312], [16.2, 470, 'inQuad']]);
    const crush = inv(16.06, 16.16, t);
    if (crush > 0) {
      fx.vignette(ctx, crush * 0.97, '28,26,26', lerp(0.6, 0.12, crush), W / 2, H / 2, 0.6);
      fx.grain(ctx, f + 1, 0.3 * crush);
    }
    drawSprite(ctx, 'heart', 728, 545, w, 0, 1, { shadow: 'rgba(40,20,20,0.5)', shadowBlur: 22, shadowY: -14 });
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
    drawSprite(ctx, 'camera', 729, 540, kf(t, [[16.2, 290], [16.5, 305]]), noise1(t, 3) * 0.04);
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
    const q = ease.outCubic(inv(16.79, 16.95, t));
    drawSprite(ctx, 'vinyl', 729, 540, lerp(250, 285, q), 0, 1, { sx: lerp(0.22, 1, q), shadow: 'rgba(200,200,220,0.25)', shadowBlur: 30 });
    letter(ctx, 'L', LX[0], LY, LSIZE, CREAM);
    letter(ctx, 'O', LX[1], LY, LSIZE, CREAM);
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
  L: [[17.25, [684, 624, -160]], [17.5, [684, 624, -160]], [17.75, [498, 846, 0]], [18.0, [444, 885, -165]], [18.25, [440, 895, -180]], [18.5, [438, 906, -140]], [18.75, [440, 900, -100]], [19.0, [444, 891, -50]], [19.25, [446, 880, -5]], [19.5, [447, 873, 0]], [19.75, [468, 843, 0]], [20.0, [513, 792, 0]], [20.46, [513, 792, 0]]],
  O: [[17.25, [1422, 402, 0]], [17.5, [1422, 402, 0]], [17.75, [1104, 336, 0]], [18.0, [942, 288, 0]], [18.5, [825, 264, 0]], [19.0, [807, 255, 0]], [19.5, [801, 273, 0]], [19.75, [798, 282, 0]], [20.0, [792, 330, 0]], [20.46, [792, 330, 0]]],
  V: [[17.25, [666, 369, 150]], [17.5, [666, 369, 150]], [17.75, [813, 45, 0]], [18.0, [558, 156, 180]], [18.25, [450, 205, 190]], [18.5, [354, 249, 270]], [18.75, [338, 252, 285]], [19.0, [330, 255, 300]], [19.25, [340, 262, 345]], [19.5, [348, 267, 360]], [19.75, [369, 276, 360]], [20.0, [429, 324, 360]], [20.46, [429, 324, 360]]],
  E: [[17.25, [537, 264, 180]], [17.5, [537, 264, 180]], [17.75, [888, 609, 0]], [18.0, [1053, 759, 120]], [18.25, [1134, 834, 170]], [18.5, [1173, 870, 145]], [18.75, [1185, 880, 100]], [19.0, [1188, 885, 50]], [19.25, [1176, 878, 0]], [19.5, [1164, 873, 0]], [19.75, [1149, 843, 0]], [20.0, [1101, 810, 0]], [20.46, [1101, 810, 0]]],
};
const DOTS = [
  // keyframes, radius
  [[[17.25, [159, 348]], [17.75, [165, 405]], [18.0, [747, 481]], [18.5, [735, 306]], [19.5, [702, 273]], [19.75, [672, 279]], [20.0, [657, 381]]], 11],
  [[[17.25, [822, 609]], [17.75, [750, 333]], [18.0, [1284, 645]], [18.5, [1224, 390]], [19.5, [1218, 282]], [19.75, [1227, 261]], [20.0, [1146, 360]]], 8],
  [[[17.25, [1311, 675]], [17.75, [1299, 672]], [18.0, [243, 717]], [18.5, [240, 696]], [19.5, [213, 702]], [19.75, [213, 672]], [20.0, [360, 579]]], 7],
];
const LOOPS = [
  // letter, start, dur, rx, ry, seed, turns, dx, dy
  ['V', 17.3, 0.14, 40, 30, 1, 2.2, 0, 0],
  ['L', 17.33, 0.14, 34, 40, 2, 2.0, 0, 0],
  ['E', 17.35, 0.12, 30, 34, 3, 1.8, 0, 0],
  ['O', 17.36, 0.12, 12, 110, 21, 1.0, 0, -40],
  ['V', 19.2, 0.25, 34, 90, 4, 1.6, 10, -50],
  ['O', 19.22, 0.25, 14, 60, 5, 1.2, 0, -40],
  ['L', 19.24, 0.25, 22, 90, 6, 1.3, -6, 50],
  ['E', 19.26, 0.25, 40, 34, 7, 1.8, 0, 0],
  ['V', 19.45, 0.25, 50, 40, 8, 2.0, 10, 0],
  ['L', 19.47, 0.25, 80, 34, 10, 1.6, -20, 20],
  ['E', 19.5, 0.25, 34, 30, 11, 1.8, 0, 0],
  ['V', 19.7, 0.25, 44, 60, 12, 2.2, 0, -20],
  ['O', 19.7, 0.25, 14, 105, 13, 1.1, 2, -60],
  ['L', 19.72, 0.25, 60, 30, 14, 1.6, -10, 0],
  ['E', 19.74, 0.25, 36, 40, 15, 1.7, 0, 0],
];
const FINAL_LOOPS = [
  ['O', 12, 70, 31, 1.0, 4, -30],
  ['L', 70, 30, 32, 1.1, -50, -24],
  ['E', 44, 26, 33, 1.6, 0, 0],
  ['V', 26, 18, 34, 1.2, 0, 0],
];

function sceneFinale(ctx, t, f) {
  ctx.fillStyle = '#dededd';
  ctx.fillRect(0, 0, W, H);
  const gg = ctx.createLinearGradient(0, 0, W, H);
  gg.addColorStop(0, 'rgba(255,255,255,0.12)');
  gg.addColorStop(1, 'rgba(120,120,135,0.18)');
  ctx.fillStyle = gg;
  ctx.fillRect(0, 0, W, H);
  // huge motion-blurred ink strokes at the cut, collapsing into the letters
  if (t < 17.42) {
    const q = inv(17.2, 17.42, t);
    const shrink = 1 - ease.inCubic(inv(17.32, 17.42, t));
    [[0, 160, 120, 640, 2.4], [1, 520, 560, 560, 1.6], [2, 900, 160, 520, 2.0], [3, 980, 820, 420, 1.8]].forEach(([k, ox, oy, len, curl]) => {
      const pts = fx.wanderPoints(500 + k, len * shrink, curl, 60).map(([a, b]) => [a + ox, b + oy]);
      ctx.save();
      ctx.filter = `blur(${16 * S}px)`;
      fx.strokePartial(ctx, pts, q * 0.4, 0.6 + q * 0.4, 70 * shrink, 'rgba(60,58,58,0.45)');
      ctx.restore();
      ctx.save();
      ctx.filter = `blur(${5 * S}px)`;
      fx.strokePartial(ctx, pts, q * 0.4, 0.6 + q * 0.4, 30 * shrink + 2, '#1a1818', true);
      ctx.restore();
    });
  }
  const grow = ease.inOutCubic(inv(19.75, 20.05, t));
  const size = lerp(56, 74, grow);
  const pos = {};
  Object.keys(FIN).forEach((ch) => {
    const [x, y, r] = kf(t, FIN[ch].map(([tt, v]) => [tt, v, 'inOutQuad']));
    pos[ch] = [x, y];
    letter(ctx, ch, x, y, size, '#3a1a16', r * D);
  });
  DOTS.forEach(([k, r]) => {
    if (t > 18.9 && t < 19.2) return;
    const [x, y] = kf(t, k);
    dot(ctx, x, y, r * (t > 19.2 && t < 19.6 ? 0.5 : 1) * lerp(1, 1.1, grow), '#2a1714');
  });
  LOOPS.forEach(([ch, s, d, rx, ry, seed, turns, dx, dy]) => {
    if (t < s || t > s + d + 0.16) return;
    const [ax, ay] = pos[ch];
    const pts = fx.loopPoints(seed, rx, ry, turns, 200).map(([a, b]) => [a + ax + dx, b + ay + dy]);
    fx.strokePartial(ctx, pts, inv(s + d, s + d + 0.16, t), inv(s, s + d, t), 1.6, '#e0402e');
  });
  if (t > 19.95) {
    FINAL_LOOPS.forEach(([ch, rx, ry, seed, turns, dx, dy]) => {
      const [ax, ay] = pos[ch];
      const pts = fx.loopPoints(seed, rx, ry, turns, 200).map(([a, b]) => [a + ax + dx, b + ay + dy]);
      fx.strokePartial(ctx, pts, 0, inv(19.95, 20.1, t), 1.6, '#e0402e');
    });
  }
  // black hook strokes
  if (t > 17.58 && t < 17.72) {
    const pts = [];
    for (let i = 0; i <= 30; i++) pts.push([830 + Math.sin((i / 30) * Math.PI) * 30, 300 + i * 3.4]);
    fx.strokePartial(ctx, pts, inv(17.66, 17.72, t), inv(17.58, 17.64, t), 7, '#141212', true);
  }
  if (t > 17.82 && t < 17.98) {
    const pts = [];
    for (let i = 0; i <= 40; i++) pts.push([150 + Math.sin((i / 40) * Math.PI * 1.2) * 50, 420 + i * 5.5]);
    fx.strokePartial(ctx, pts, inv(17.9, 17.98, t), inv(17.82, 17.88, t), 8, '#141212', true);
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
