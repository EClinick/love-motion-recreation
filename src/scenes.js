// Scene timeline. Every function is pure in `t` (seconds) so frames render in any order.
const { createCanvas } = require('@napi-rs/canvas');
const C = require('./lib/core');
const { W, H, kf, inv, lerp, clamp, ease, rng, noise1, shake, mixHex, state } = C;
const fx = require('./lib/fx');
const { drawSprite } = require('./lib/sprites');
const { thermal } = require('./lib/figures');

const INK = '#3b2019'; // warm brown-black used for type on paper
const CREAM = '#f3efe8';
const BODY = 50; // body copy size (matches reference measurements)
const CARD = 89; // "action." / "intention." / "curiosity."

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
  if (opts.blur && opts.blur > 0.3) ctx.filter = `blur(${(opts.blur) * state.S}px)`;
  if (opts.filter) ctx.filter = opts.filter;
  ctx.globalAlpha = opts.alpha ?? 1;
  if (opts.op) ctx.globalCompositeOperation = opts.op;
  ctx.drawImage(c, 0, 0, W, H);
  ctx.restore();
}

// Camera transform: zoom/rotate about (cx,cy), then translate.
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
  if (opts.blur) ctx.filter = `blur(${(opts.blur) * state.S}px)`;
  ctx.globalAlpha = opts.alpha ?? 1;
  ctx.drawImage(s, 0, 0, W, H);
  ctx.restore();
}

function dashLine(ctx, x0, x1, y, color, lw = 3, dash = [26, 20], offset = 0) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.setLineDash(dash);
  ctx.lineDashOffset = offset;
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  ctx.restore();
}

function blinkOn(t, period = 0.5) {
  return Math.floor(t / period) % 2 === 0;
}

function dot(ctx, x, y, r, color = '#1a1716') {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 7);
  ctx.fill();
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
    fx.text(ctx, 'how', W / 2 - 5, 520, 300, '#3a2914', { align: 'center', tracking: -0.04 });
    return;
  }
  fx.paper(ctx, '#e4e3e0', 'rgba(110,108,104,0.3)', W * 0.35, H * 0.45);

  // world: sentence at BIG size, baseline y=620. Camera pans then whips out.
  const hx = kf(t, [
    [0.083, 520],
    [0.2, 395, 'linear'],
    [0.3, -420, 'inQuad'],
    [0.38, -1150, 'linear'],
    [0.44, -1330, 'outQuad'],
  ]);
  // zoom out to the body size; heavy blur through the whip
  const zp = ease.inOutCubic(inv(0.4, 0.6, t));
  const z = Math.exp(lerp(0, Math.log(BODY / BIG), zp));
  const blur = Math.sin(Math.PI * clamp(inv(0.4, 0.66, t))) * 16 + (t > 0.25 && t < 0.4 ? 3 : 0);

  const [c, x] = off(0);
  x.save();
  const ox = lerp(hx, 150, zp);
  const oy = lerp(620, 556, zp);
  x.translate(ox, oy);
  x.scale(z, z);
  const lw = 3 / Math.max(z, 0.35);
  dashLine(x, -4000, 12000, -185, '#8a3a18', lw, [26, 20]);
  dashLine(x, -4000, 12000, 0, '#8a3a18', lw, [26, 20]);
  let cx = 0;
  const sp = fx.measure(x, ' ', BIG);
  SENT.slice(0, 4).forEach((w, i) => {
    const col = i === 1 ? mixHex('#4a4744', '#141210', inv(0.2, 0.33, t)) : zp > 0.5 ? INK : '#141210';
    fx.text(x, w, cx, 0, BIG, col, { baseline: 'alphabetic', tracking: -0.035 });
    cx += fx.measure(x, w, BIG) + sp;
  });
  x.restore();

  // thick tapered pen swoosh under "how"
  if (t > 0.13 && t < 0.3) {
    const p = ease.outCubic(inv(0.13, 0.2, t));
    x.save();
    x.fillStyle = '#2a170c';
    x.beginPath();
    x.moveTo(0, 655);
    x.lineTo(lerp(0, 680, p), 632);
    x.lineTo(0, 678);
    x.closePath();
    x.fill();
    x.restore();
  }
  // black redaction bar + quick scribble
  if (t > 0.24 && t < 0.33) {
    const p = ease.outExpo(inv(0.24, 0.27, t));
    x.fillStyle = '#0d0c0c';
    x.fillRect(lerp(1440, 760, p), 418, 900, 150);
    const pts = fx.scribblePoints(41, 520, 60, 3, 90).map(([a, b]) => [a + 745, b + 645]);
    fx.strokePartial(x, pts, 0, inv(0.24, 0.3, t), 3, '#2a1a10');
  }
  // selection-box handles appearing as the line lands
  if (t > 0.48) {
    x.fillStyle = '#2a2624';
    [500, 540, 580].forEach((yy) => x.fillRect(1108, yy, 10, 10));
  }
  composite(ctx, c, { blur });
}

// =====================================================================
// 2. Typing line with handwritten scribbles.
// =====================================================================
function sentenceParts(t, darkCol = INK, fresh = '#9a8f8a') {
  const parts = [];
  SENT.forEach((w, i) => {
    if (t < TYPE_T[i]) return;
    const age = t - TYPE_T[i];
    parts.push({ t: w, c: i < 4 ? darkCol : mixHex(fresh, darkCol, clamp(age / 0.14)) });
  });
  return parts;
}

function sceneType(ctx, t, f) {
  fx.paper(ctx, '#e3e2df', 'rgba(105,103,100,0.32)', W * 0.4, H * 0.5);
  const x0 = kf(t, [[0.6, 150], [0.8, 75, 'outCubic'], [1.96, 45, 'linear']]);
  const size = kf(t, [[0.6, BODY * 0.96], [1.96, BODY]]);
  const y0 = 540;
  const [sx, sy] = shake(t, 2.5, 1, 4);
  const blurIn = Math.max(0, 1 - inv(0.6, 0.72, t)) * 6;

  // ghost signature, huge & blurred, drifting at the top right
  if (t < 1.2) {
    const [c, x] = off(1);
    const pts = fx.scribblePoints(77, 760, 260, 6, 200).map(([a, b]) => [a + lerp(640, 520, inv(0.6, 1.2, t)), b + 190]);
    fx.strokePartial(x, pts, 0, inv(0.62, 0.85, t), 24, 'rgba(70,68,66,0.6)');
    composite(ctx, c, { blur: 16, alpha: 1 - inv(1.0, 1.2, t) });
  }
  ctx.save();
  ctx.translate(sx, sy);
  const [tc, tx] = off(2);
  const end = fx.words(tx, sentenceParts(t), x0, y0, size, { tracking: -0.035 });
  composite(ctx, tc, { blur: blurIn });
  const wordX = (i) => x0 + fx.measure(ctx, SENT.slice(0, i).join(' ') + (i ? ' ' : ''), size, 700, -0.035);

  // selection box around the first phrase while it lands
  if (t < 0.86) {
    ctx.save();
    ctx.strokeStyle = 'rgba(40,36,34,0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.strokeRect(x0 - 14, y0 - 34, end - x0 + 28, 68);
    ctx.setLineDash([]);
    ctx.fillStyle = '#2a2624';
    [[x0 - 14, y0 - 34], [end + 14, y0 - 34], [x0 - 14, y0 + 34], [end + 14, y0 + 34]].forEach(([a, b]) => ctx.fillRect(a - 4, b - 4, 8, 8));
    ctx.restore();
    // tall caret line through the left
    ctx.fillStyle = '#2a2624';
    ctx.fillRect(x0 - 50, 290, 3, 520 * ease.outCubic(inv(0.6, 0.7, t)));
  }
  // handwritten signature below the line
  if (t > 0.64 && t < 0.98) {
    const pts = fx.scribblePoints(11, 560, 150, 11, 320).map(([a, b]) => [a + 130, b + 640]);
    fx.strokePartial(ctx, pts, Math.max(0, inv(0.86, 0.98, t)), inv(0.64, 0.84, t), 3.2, '#3a3532');
  }
  // vertical pen tick above "communicate"
  if (t > 0.7 && t < 0.95) fx.strokePartial(ctx, [[560, 330], [552, 420], [538, 512]], 0, inv(0.7, 0.78, t), 3, '#2e2a28');
  // long arc on the right + little tail scribble
  if (t > 0.92 && t < 1.16) {
    const arc = [];
    for (let i = 0; i <= 60; i++) {
      const u = i / 60;
      arc.push([lerp(1020, 1110, Math.sin(u * Math.PI)) - u * 120, lerp(180, 960, u)]);
    }
    const tail = fx.scribblePoints(15, 230, 60, 4, 80).map(([a, b]) => [870 - a, b + 960]);
    fx.strokePartial(ctx, [...arc, ...tail], Math.max(0, inv(1.06, 1.16, t)), inv(0.92, 1.04, t), 3, '#3a2a26');
    fx.strokePartial(ctx, [[735, 240], [728, 290], [745, 330], [760, 310]], 0, inv(0.95, 1.0, t), 3, '#3a2a26');
  }
  // strike through "that you're", loop round it, diagonal flick
  if (t > 1.2 && t < 1.42) {
    const xa = wordX(4);
    const xb = wordX(6) - 12;
    const q = inv(1.2, 1.3, t);
    const fade = inv(1.36, 1.42, t);
    const loop = fx.loopPoints(5, (xb - xa) / 2 + 20, 24, 1.05).map(([a, b]) => [a + (xa + xb) / 2 + 20, b + 548]);
    const strike = [[xa - 10, 548], [xb + 40, 544]];
    fx.strokePartial(ctx, strike, fade, q, 3, '#3a2320');
    fx.strokePartial(ctx, loop, fade, inv(1.24, 1.34, t), 3, '#3a2320');
    fx.strokePartial(ctx, [[xb + 30, 560], [xb - 20, 640], [xb - 70, 720]], fade, inv(1.28, 1.36, t), 3, '#3a2320');
  }
  ctx.restore();

  // 1.9+: streaks begin, everything starts to blur into the sparkle shot
  if (t > 1.88) {
    const q = inv(1.88, 1.96, t);
    speedStreaks(ctx, q, 5);
  }
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
  return {
    edge: mixHex('#46f2e2', '#3fc8f0', ease.inOutQuad(p)),
    mid: mixHex('#2ab8f2', '#2a5af2', p),
    core: mixHex('#1a64ff', '#2a2ad8', p),
  };
}

const FLOATERS = [
  // icon, x, y, width, rot, phase
  ['book', 752, 352, 96, -0.32, 0],
  ['clapper', 1060, 365, 100, 0.38, 1],
  ['coin', 965, 650, 84, 0, 2],
  ['camera', 1118, 850, 100, 0.05, 3],
];

function sceneSparkle(ctx, t, f) {
  const intro = inv(1.96, 2.1, t);
  fx.paper(ctx, '#dcdbd8', 'rgba(90,88,86,0.2)', W * 0.62, H * 0.5);
  // dark warm vignette from the edges, which tightens into a spotlight at 3.25
  const spot = ease.inOutCubic(inv(3.18, 3.3, t));
  const warm = inv(3.56, 3.66, t);
  const vcx = lerp(960, 1000, spot);
  const vs = ease.outCubic(inv(2.0, 2.2, t));
  const g = ctx.createRadialGradient(vcx, 540, lerp(150, 260, spot), vcx, 560, lerp(900, 640, spot));
  g.addColorStop(0, `rgba(${warm > 0 ? '255,214,200' : '255,255,255'},${lerp(0.05, 0.6, spot)})`);
  g.addColorStop(0.4, `rgba(255,255,255,${lerp(0, 0.15, spot)})`);
  g.addColorStop(0.75, `rgba(40,30,30,${0.55 * vs})`);
  g.addColorStop(1, `rgba(${Math.round(lerp(22, 60, warm))},16,18,${0.97 * vs})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  if (warm > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgba(232,160,150,${warm * 0.75})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  const z = lerp(1, 1.04, inv(2.0, 3.7, t));
  const [sx, sy] = shake(t, 3, 1.2, 8);

  // sparkle star on the left
  const sc = starColors(t);
  const sIn = ease.outExpo(inv(1.98, 2.16, t));
  const [c2, x2] = off(1);
  const scx = -70;
  const scy = 505;
  const R = lerp(1300, 880, sIn);
  const rot = -0.98 + noise1(t * 0.7, 3) * 0.03 + lerp(-0.2, 0, sIn);
  fx.starPath(x2, scx, scy, R, rot, 0.07);
  const rg = x2.createRadialGradient(scx, scy, 30, scx, scy, R * 0.6);
  rg.addColorStop(0, sc.core);
  rg.addColorStop(0.3, sc.core);
  rg.addColorStop(0.55, sc.mid);
  rg.addColorStop(1, sc.edge);
  x2.fillStyle = rg;
  x2.shadowColor = sc.edge;
  x2.shadowBlur = (24) * state.S;
  x2.fill();
  x2.shadowBlur = 0;
  composite(ctx, c2, { alpha: sIn * (t < 2.05 ? 0.6 : 1), filter: t < 2.06 ? 'brightness(1.5) saturate(0.5)' : undefined });
  fx.grain(ctx, f + 3, 0.12);

  ctx.save();
  camera(ctx, { x: sx, y: sy, z });
  // sentence (part over the star is blurred, like the reference's lens glow)
  const [tc, tx] = off(2);
  const parts = SENT.map((w, i) => ({
    t: w,
    c: i === 2 && t > 3.37 ? '#ffffff' : '#241a16',
    o: i === 2 && t > 3.37 ? { glow: 'rgba(255,255,255,0.8)', glowBlur: 14 } : {},
  }));
  fx.words(tx, parts, 40, 538, BODY, { tracking: -0.035 });
  ctx.save();
  ctx.beginPath();
  ctx.rect(250, 0, W, H);
  ctx.clip();
  composite(ctx, tc, { blur: intro < 1 ? (1 - intro) * 8 : 0 });
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, 250, H);
  ctx.clip();
  composite(ctx, tc, { blur: 2.2 + (intro < 1 ? (1 - intro) * 8 : 0), alpha: 0.85 });
  ctx.restore();
  if (t < 2.12) {
    // dashed caret box around "change?" as it lands
    ctx.save();
    ctx.strokeStyle = 'rgba(60,50,46,0.8)';
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 2;
    ctx.strokeRect(1240, 506, 170, 62);
    ctx.restore();
  }

  // floating icons
  if (t < 3.27) {
    const out = ease.inQuad(inv(3.2, 3.27, t));
    FLOATERS.forEach(([n, x, y, w, r, ph]) => {
      const fly = 1 - ease.outCubic(intro);
      const dx = (x - 720) * fly * 1.8 + noise1(t * 1.6, ph) * 10;
      const dy = (y - 540) * fly * 1.8 + noise1(t * 1.3, ph + 5) * 10;
      const rr = r + noise1(t * 1.1, ph + 9) * 0.12 + fly * 2;
      drawSprite(ctx, n, x + dx, y + dy, w * (1 - out), rr, 1, n === 'camera' ? { } : {});
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
  // red flick strokes during the transition
  if (t < 2.45) {
    const q = inv(1.98, 2.3, t);
    [[1, 760, 300], [2, 1100, 800], [3, 180, 130]].forEach(([k, ox, oy]) => {
      const pts = fx.wanderPoints(600 + k, 260, 1.5, 40).map(([a, b]) => [a + ox, b + oy]);
      fx.strokePartial(ctx, pts, Math.max(0, q * 1.4 - 0.4), Math.min(1, q * 1.4), 7, '#d8241c', true);
    });
  }
  if (intro < 1) speedStreaks(ctx, 1 - intro, 5);
  ctx.restore();

  // 3.70: cut to dark, red sun + small line
  if (t >= 3.7) {
    fx.dark(ctx, '#151314');
    const sunX = 250;
    const rr = ctx.createRadialGradient(sunX, 545, 10, sunX, 545, 260);
    rr.addColorStop(0, '#ff4a22');
    rr.addColorStop(0.55, '#e0201a');
    rr.addColorStop(0.8, 'rgba(160,10,10,0.6)');
    rr.addColorStop(1, 'rgba(60,0,0,0)');
    ctx.fillStyle = rr;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,90,60,0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(sunX + 10, 540, 200, -1.2, 1.9);
    ctx.stroke();
    ctx.restore();
    fx.words(ctx, [
      { t: 'how', c: '#3a1410' },
      { t: 'do', c: '#3a1410' },
      { t: 'you', c: '#ffffff' },
      { t: 'communicate', c: '#4a1812' },
      { t: 'that', c: '#4a1812' },
    ], 18, 552, 34, { tracking: -0.035, blur: 0.6 });
  }
}

// =====================================================================
// 4. "you dont." — thermal profile, orbit ring, then backlit silhouette.
// =====================================================================
function bgRamp(t, keys) {
  let bg = keys[0][1];
  for (let i = 1; i < keys.length; i++) if (t >= keys[i - 1][0]) bg = mixHex(keys[i - 1][1], keys[i][1], inv(keys[i - 1][0], keys[i][0], t));
  return bg;
}

function sceneProfile(ctx, t, f) {
  const bg = bgRamp(t, [
    [3.76, '#151314'],
    [5.5, '#151314'],
    [5.6, '#2a1718'],
    [5.75, '#55494b'],
    [5.88, '#7d7273'],
    [6.0, '#c3bec1'],
    [6.12, '#d9d7d6'],
  ]);
  fx.dark(ctx, bg);
  if (t > 5.45 && t < 5.7) {
    // red glow creeping in from the lower left
    const g = ctx.createRadialGradient(0, 1080, 0, 0, 1080, 700);
    g.addColorStop(0, `rgba(160,20,20,${0.5 * Math.sin(Math.PI * inv(5.45, 5.7, t))})`);
    g.addColorStop(1, 'rgba(120,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  const lit = inv(5.95, 6.15, t);
  if (lit > 0) {
    const g = ctx.createLinearGradient(0, 0, 700, 0);
    g.addColorStop(0, `rgba(255,255,255,${0.9 * lit})`);
    g.addColorStop(0.55, `rgba(255,255,255,${0.35 * lit})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  const settle = ease.outCubic(inv(3.76, 4.12, t));
  const z = lerp(1, 1.04, inv(4.1, 6.2, t));
  const [sx, sy] = shake(t, 2.2, 0.8, 21);
  ctx.save();
  camera(ctx, { x: sx, y: sy, z, cx: 900, cy: 600 });

  // figure drifts right slowly (as in the reference)
  const drift = kf(t, [[4.1, 0], [5.6, 95, 'linear'], [6.3, 120]]);
  const hx = 600 + drift + (1 - settle) * 160;
  const hy = 225 + (1 - settle) * 150;
  const hz = 1 + (1 - settle) * 0.12;
  const toTan = ease.inOutQuad(inv(5.84, 6.0, t));
  const toShadow = ease.inOutQuad(inv(6.0, 6.12, t));
  const [c, x] = off(1);
  x.save();
  x.translate(hx, hy);
  x.scale(hz, hz);
  const heat = thermal('head', 'heat');
  if (toShadow < 1) {
    x.globalAlpha = 1 - toShadow;
    if (settle < 1) x.filter = `hue-rotate(${-45 * (1 - settle)}deg) saturate(${1 + (1 - settle)}) brightness(${lerp(0.8, 1, settle)})`;
    else if (toTan > 0) x.filter = `saturate(${lerp(0.9, 0.35, toTan)}) brightness(${lerp(0.95, 0.62, toTan)}) sepia(${toTan * 0.6})`;
    else x.filter = `saturate(${1 - inv(5.6, 5.84, t) * 0.15})`;
    x.drawImage(heat, 0, 0);
    x.filter = 'none';
    if (toTan > 0.3) {
      // posterised dark blotch in the hair (thermal threshold artefact)
      x.save();
      x.globalAlpha = (1 - toShadow) * clamp((toTan - 0.3) * 2);
      x.fillStyle = '#3a2410';
      x.filter = `blur(${2 * state.S}px)`;
      x.beginPath();
      x.ellipse(380, 210, 120, 140, 0.3, 0, 7);
      x.fill();
      x.restore();
    }
  }
  if (toShadow > 0) {
    x.globalAlpha = toShadow;
    x.drawImage(thermal('head', 'shadow'), 0, 0);
  }
  x.restore();
  composite(ctx, c, { blur: (1 - settle) * 26 });

  // comet streak during the intro
  if (t < 4.12) {
    const q = inv(3.76, 4.1, t);
    const [c3, x3] = off(2);
    const px = lerp(560, 300, q);
    const py = lerp(420, 120, q);
    const gg = x3.createRadialGradient(px, py, 0, px, py, 60);
    gg.addColorStop(0, 'rgba(255,190,90,0.95)');
    gg.addColorStop(1, 'rgba(255,120,30,0)');
    x3.fillStyle = gg;
    x3.fillRect(0, 0, W, H);
    x3.strokeStyle = 'rgba(255,150,60,0.6)';
    x3.lineWidth = 16;
    x3.beginPath();
    x3.moveTo(px, py);
    x3.lineTo(px + 300, py + 120);
    x3.stroke();
    composite(ctx, c3, { blur: 12, alpha: 1 - inv(4.0, 4.12, t) });
  }
  // orbit ring
  if (t > 4.28 && t < 4.95) {
    const draw = (rot, rx, ry, a0, a1) => {
      ctx.save();
      ctx.strokeStyle = 'rgba(250,248,244,0.95)';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.ellipse(950 + drift, 430, rx, ry, rot, a0, a1);
      ctx.stroke();
      ctx.restore();
    };
    if (t < 4.6) {
      const q = ease.outCubic(inv(4.28, 4.45, t));
      const q2 = ease.inCubic(inv(4.45, 4.6, t));
      draw(-0.3, 380, 95, Math.PI * 2 * q2, Math.PI * 2 * q);
    } else {
      const q = ease.outCubic(inv(4.6, 4.78, t));
      const q2 = ease.inCubic(inv(4.75, 4.95, t));
      draw(0.85, 400, 70, Math.PI * (0.9 + 1.1 * q2), Math.PI * (0.9 + 1.1 * q));
    }
  }
  if (t > 4.45 && t < 5.2) dot(ctx, 832 + drift, 752, 5, '#fff');
  ctx.restore();

  // text
  const intro = inv(3.76, 3.98, t);
  let parts;
  if (t < 5.22) parts = [{ t: 'you', c: CREAM }, { t: 'dont.', c: CREAM }];
  else if (t < 5.36) parts = [{ t: 'you', c: CREAM }];
  else if (t < 5.6) parts = [{ t: 'you', c: CREAM }, { t: 'just', c: CREAM }];
  else if (t < 5.98) {
    const g = inv(5.6, 5.95, t);
    const base = mixHex('#d8d0cc', '#8f8786', g);
    parts = [{ t: 'you', c: base }, { t: 'just', c: base }, { t: 'show', c: mixHex('#a09694', '#6a6260', g) }];
  } else parts = [{ t: 'you', c: '#3c3836' }, { t: 'just', c: '#3c3836' }, { t: 'show', c: '#3c3836' }, { t: 'it.', c: '#3c3836' }];
  fx.words(ctx, parts, 200, 538, BODY, { tracking: -0.04, blur: (1 - intro) * 7 });
  if (t < 5.2 && blinkOn(t - 3.76, 0.42)) fx.cursor(ctx, 640, 540, 44, 'rgba(160,156,150,0.8)', 3);

  // 6.2: wipe — dark frame with a heat gradient rising from the bottom
  if (t > 6.18) {
    const q = inv(6.18, 6.3, t);
    ctx.fillStyle = '#121112';
    ctx.fillRect(0, 0, W, H);
    const top = lerp(H, H * 0.45, ease.outCubic(q));
    const g = ctx.createLinearGradient(0, top, 0, H);
    g.addColorStop(0, 'rgba(60,0,0,0)');
    g.addColorStop(0.45, '#7a0a0a');
    g.addColorStop(0.7, '#d81e10');
    g.addColorStop(0.88, '#ff7a18');
    g.addColorStop(1, '#ffd84a');
    ctx.fillStyle = g;
    ctx.fillRect(0, top, W, H - top);
  }
}

// =====================================================================
// 5. The pixel icon ring.
// =====================================================================
const RING = ['clapper', 'skateboard', 'vinyl', 'book', 'camera', 'cat', 'coin', 'controller', 'cap', 'heart', 'cash', 'plant'];
const RING_W = { clapper: 250, skateboard: 290, vinyl: 220, book: 220, camera: 220, cat: 190, coin: 185, controller: 250, cap: 250, heart: 330, cash: 370, plant: 240 };

// 3D ring projection. phi: ring rotation; tilt: camera pitch.
function ringLayout(phi, { cx = 720, cy = 540, R = 500, tilt = 1.1, F = 1100, depth = 1 } = {}) {
  return RING.map((name, i) => {
    const a = Math.PI + (i / RING.length) * Math.PI * 2 + phi;
    const X = Math.cos(a) * R;
    const Z = -Math.sin(a) * R; // positive Z = towards back (top of screen)
    const y = -Z * Math.cos(tilt);
    const zc = Z * Math.sin(tilt) * depth;
    const s = F / (F + zc);
    return { name, x: cx + X * s, y: cy + y * s, s, z: zc, i };
  });
}

function drawRing(ctx, items, scale = 1, opts = {}) {
  items
    .slice()
    .sort((a, b) => b.z - a.z)
    .forEach((it) => {
      const w = RING_W[it.name] * it.s * scale;
      const hit = opts.hits ? opts.hits(it.name) : 0;
      const wob = opts.wobble ? noise1(opts.t * 2 + it.i, it.i) * 0.06 : 0;
      const rot = (opts.rot ? opts.rot(it) : 0) + wob;
      drawSprite(ctx, it.name, it.x, it.y, w * (1 + hit * 0.1), rot);
      if (hit > 0) drawSprite(ctx, it.name, it.x, it.y, w * (1 + hit * 0.1), rot, hit * 0.75, { silhouette: '#f39a2a' });
    });
}

const BALL = [
  [6.5, [700, 520]],
  [6.66, [690, 470], 'outQuad'],
  [6.82, [760, 600], 'inOutQuad'],
  [6.98, [930, 110], 'inQuad'],
  [7.1, [1190, 560], 'outQuad'],
  [7.18, [1000, 520], 'outQuad'],
  [7.27, [930, 690], 'inQuad'],
  [7.38, [700, 640], 'outQuad'],
  [7.5, [400, 700], 'inQuad'],
  [7.62, [600, 420], 'outQuad'],
  [7.75, [260, 560], 'inQuad'],
  [7.9, [640, 500], 'outQuad'],
  [8.1, [700, 500], 'inOutQuad'],
];
const HITS = [
  [7.1, 'cap', [1190, 560]],
  [7.27, 'heart', [930, 690]],
  [7.5, 'cash', [400, 700]],
  [7.75, 'plant', [260, 560]],
];

function flash(ctx, x, y, a, seed) {
  if (a <= 0) return;
  ctx.save();
  const g = ctx.createRadialGradient(x, y, 0, x, y, 190);
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
    const r0 = 110 + r() * 40;
    const r1 = r0 + 60 + r() * 60;
    ctx.lineWidth = 3 + r() * 4;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(an) * r0, y + Math.sin(an) * r0);
    ctx.lineTo(x + Math.cos(an) * r1, y + Math.sin(an) * r1);
    ctx.stroke();
  }
  ctx.restore();
}

function inkBall(ctx, x, y, r, trail = []) {
  if (trail.length > 1) {
    ctx.save();
    ctx.filter = `blur(${10 * state.S}px)`;
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
  ctx.filter = `blur(${2.5 * state.S}px)`;
  ctx.fillStyle = '#0c0b0b';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 7);
  ctx.fill();
  ctx.restore();
}

function sceneRing(ctx, t, f) {
  fx.paper(ctx, '#e4e3e1', 'rgba(120,118,115,0.25)', W * 0.5, H * 0.45);
  const phi = kf(t, [
    [6.3, -2.4],
    [6.95, -0.05, 'outCubic'],
    [7.8, 0.3, 'linear'],
    [8.3, 0.75, 'inQuad'],
  ]);
  const zoom = kf(t, [
    [6.3, 1.8],
    [6.9, 1.0, 'outCubic'],
    [7.8, 1.03, 'linear'],
    [8.02, 1.45, 'inOutCubic'],
    [8.3, 2.4, 'inExpo'],
  ]);
  const camX = kf(t, [[7.8, 0], [8.02, -150, 'inOutCubic'], [8.3, -620, 'inExpo']]);
  const camR = kf(t, [[6.3, 0.35], [6.9, 0, 'outCubic']]);
  const [sx, sy] = shake(t, 3, 1, 33);

  const [c, x] = off(0);
  x.save();
  camera(x, { x: sx + camX, y: sy, z: zoom, r: camR });
  const items = ringLayout(phi, { tilt: 1.12, R: 500, cy: 560 });
  const hitAmt = (name) => {
    let a = 0;
    HITS.forEach(([ht, n]) => {
      if (n === name) a = Math.max(a, 1 - Math.abs(t - ht - 0.02) / 0.1);
    });
    return clamp(a);
  };
  drawRing(x, items, 1, { hits: hitAmt, t, wobble: true });
  HITS.forEach(([ht, n, p], k) => flash(x, p[0], p[1], 1 - Math.abs(t - ht - 0.03) / 0.09, k + 3));
  if (t > 6.5) {
    const pos = kf(t, BALL);
    const trail = [];
    for (let i = 0; i <= 10; i++) trail.push(kf(t - i * 0.022, BALL));
    inkBall(x, pos[0], pos[1], 24, trail);
  }
  x.restore();
  const tr = inv(6.3, 6.5, t);
  if (tr < 1) {
    ctx.fillStyle = '#2a2827';
    ctx.fillRect(0, 0, W, H);
    mosaic(ctx, c, lerp(40, 8, tr), { blur: lerp(30, 6, tr), alpha: lerp(0.8, 1, tr) });
    return;
  }
  composite(ctx, c, { blur: t > 8.15 ? (t - 8.15) * 60 : 0 });
}

// =====================================================================
// 6. Word cards: action. / intention. / curiosity. (dark)
// =====================================================================
function typed(ctx, word, t0, t, x, y, curX) {
  // highlight-block reveal then blinking caret
  const p = inv(t0, t0 + 0.2, t);
  const n = Math.ceil(lerp(word.length - 3, word.length, p));
  const shown = word.slice(0, n);
  const w = fx.measure(ctx, shown, CARD, 700, -0.035);
  fx.text(ctx, shown, x, y, CARD, CREAM, { tracking: -0.035, blur: p < 0.3 ? 2.5 : 0 });
  const blk = 1 - ease.outCubic(p);
  if (blk > 0.02) {
    ctx.fillStyle = CREAM;
    ctx.fillRect(x + w + 8, y - CARD * 0.36, lerp(26, 210, blk), CARD * 0.72);
  }
  const on = blinkOn(t - t0, 0.36);
  if (p >= 1) fx.cursor(ctx, curX, y, CARD * 0.8, on ? CREAM : 'rgba(243,239,232,0.3)', 9);
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
  // short white/red slashes flying outward from (cx,cy)
  const r = rng(seed);
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < 9; i++) {
    const an = r() * Math.PI * 2;
    const d0 = 120 + r() * 120 + q * 260;
    const len = 50 + r() * 140;
    ctx.strokeStyle = colors[i % colors.length];
    ctx.globalAlpha = 1 - q;
    ctx.lineWidth = 2 + r() * 5;
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
  if (q < 0.12) {
    const [c, x] = off(1);
    fx.starPath(x, 1000, 540, lerp(900, 500, q / 0.12), 0.0, 0.1);
    x.fillStyle = '#6a0e0e';
    x.fill();
    composite(ctx, c, { blur: 6, alpha: 1 - q / 0.12 });
  }
  const pos = kf(t, [[8.3, [520, 560]], [8.45, [540, 560], 'outCubic'], [8.62, [520, 540]], [8.8, [380, 760]], [9.13, [330, 800], 'linear']]);
  const rot = kf(t, [[8.3, -0.08], [8.45, -0.2, 'outCubic'], [8.62, 1.75, 'inOutCubic'], [8.8, -0.42, 'inOutCubic'], [9.13, -0.46]]);
  const width = kf(t, [[8.3, 360], [8.45, 400], [8.62, 560], [8.8, 880], [9.13, 960]]);
  const sy = kf(t, [[8.3, 1], [8.64, 1], [8.78, 0.2, 'inOutCubic'], [9.13, 0.18]]);
  const blur = kf(t, [[8.3, 10], [8.4, 2], [8.48, 0], [8.7, 0], [8.76, 3], [8.82, 0]]);
  const [c, x] = off(0);
  drawSprite(x, 'camera', pos[0], pos[1], width, rot, 1, { sy });
  if (q < 0.12) burst(x, pos[0], pos[1], q / 0.12, 8);
  // red sparkle glued to the camera's top corner, stretching into a streak at the end
  const st = kf(t, [[8.3, 0.6], [8.4, 1, 'outBack'], [8.6, 1.4], [8.75, 1.1], [9.13, 1.0]]);
  const sxs = kf(t, [[8.7, 1], [8.8, 2.6, 'outCubic']]);
  x.save();
  const anchor = kf(t, [[8.3, [600, 470]], [8.45, [620, 470]], [8.62, [560, 290]], [8.78, [560, 520]], [9.13, [520, 540]]]);
  x.translate(anchor[0], anchor[1]);
  x.rotate(kf(t, [[8.3, 0.3], [8.6, -0.25], [8.78, -0.36]]));
  x.scale(sxs, 1 / Math.sqrt(sxs));
  fx.starPath(x, 0, 0, 170 * st, 0, 0.1);
  x.fillStyle = '#e8231d';
  x.shadowColor = 'rgba(255,40,30,0.6)';
  x.shadowBlur = (20) * state.S;
  x.fill();
  x.restore();
  composite(ctx, c, { blur });
  if (t > 8.95) fx.strokePartial(ctx, [[760, 485], [960, 478]], 0, inv(8.95, 9.02, t), 4, CREAM);
  sparks(ctx, t, 2, 7);
  typed(ctx, 'action.', 8.3, t, 966, 540, 1300);
}

// Horizontal pass along the ring's front row (light shots between cards).
const STRIP = ['skateboard', 'clapper', 'plant', 'cash', 'heart', 'cap', 'controller', 'coin', 'cat', 'camera', 'book', 'vinyl'];
const STRIP_W = { skateboard: 260, clapper: 270, plant: 230, cash: 300, heart: 300, cap: 260, controller: 290, coin: 230, cat: 220, camera: 230, book: 230, vinyl: 220 };
function strip(ctx, offset, y = 560, scale = 1, t = 0) {
  let x = 0;
  STRIP.forEach((n, i) => {
    const w = STRIP_W[n] * scale;
    const px = x + offset + w / 2;
    if (px > -400 && px < W + 400) drawSprite(ctx, n, px, y + Math.sin(i * 1.7) * 26 * scale, w, Math.sin(i * 2.3) * 0.08 + noise1(t * 2, i) * 0.03);
    x += w * 0.72;
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

function sceneStripA(ctx, t, f) {
  fx.paper(ctx, '#e6e5e3', 'rgba(110,108,105,0.25)');
  const off_ = kf(t, [[9.13, -300], [9.6, -760, 'outCubic'], [9.84, -1700, 'inCubic']]);
  const [c, x] = off(0);
  strip(x, off_, 560, 1.4, t);
  composite(ctx, c, { blur: t > 9.7 ? (t - 9.7) * 40 : t < 9.2 ? (9.2 - t) * 60 : 0 });
  speedLines(ctx, t, 7, t > 9.7 ? 10 : 3);
}

function sceneIntention(ctx, t, f) {
  fx.dark(ctx, '#141313');
  const q = inv(9.84, 10.3, t);
  const [c, x] = off(1);
  const grow = ease.outCubic(q);
  // ribbon: thin tail from bottom-left into the book, wide band out to the top right
  const spine = (u) => {
    const p0 = [-60, 1000];
    const p1 = [300, 640];
    const p2 = [1250, -200];
    const a = (1 - u) * (1 - u);
    const b = 2 * (1 - u) * u;
    const cc = u * u;
    return [a * p0[0] + b * p1[0] + cc * p2[0], a * p0[1] + b * p1[1] + cc * p2[1]];
  };
  const u1 = lerp(0.25, 1, grow);
  const u0 = lerp(0, 0.2, ease.inCubic(inv(10.1, 10.51, t)));
  const wmax = lerp(60, 420, ease.inOutCubic(inv(9.95, 10.25, t)));
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
  x.shadowBlur = (25) * state.S;
  x.fill();
  composite(ctx, c, { blur: t < 9.9 ? 3 : 0 });
  const bp = kf(t, [[9.84, [470, 520]], [10.0, [440, 500], 'outCubic'], [10.51, [425, 505]]]);
  const bw = kf(t, [[9.84, 470], [10.1, 500], [10.51, 520]]);
  drawSprite(ctx, 'book', bp[0], bp[1], bw, -0.06 + noise1(t * 2, 4) * 0.04, 1, { shadow: 'rgba(255,40,30,0.35)', shadowBlur: 30 });
  if (t < 10.0) burst(ctx, 640, 540, inv(9.84, 10.0, t), 9, ['#ece8e2']);
  sparks(ctx, t, 4, 6);
  typed(ctx, 'intention.', 9.84, t, 834, 540, 1308);
}

function sceneStripB(ctx, t, f) {
  fx.paper(ctx, '#e6e5e3', 'rgba(110,108,105,0.25)');
  const off_ = kf(t, [[10.51, -1386], [10.75, -1736, 'outCubic'], [11.01, -2050, 'inCubic']]);
  const [c, x] = off(0);
  strip(x, off_, 560, 1.6, t);
  composite(ctx, c, { blur: t < 10.56 ? 6 : t > 10.92 ? (t - 10.92) * 50 : 0 });
  speedLines(ctx, t, 11, 4);
}

function note(ctx, kind, x, y, s, rot = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(s, s);
  ctx.fillStyle = '#e2211b';
  ctx.strokeStyle = '#e2211b';
  ctx.shadowColor = 'rgba(255,40,30,0.45)';
  ctx.shadowBlur = (14) * state.S;
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
    ctx.beginPath();
    ctx.moveTo(-10, -60);
    ctx.lineTo(64, -72);
    ctx.lineTo(64, -56);
    ctx.lineTo(-10, -44);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-10, -32);
    ctx.lineTo(64, -44);
    ctx.lineTo(64, -36);
    ctx.lineTo(-10, -24);
    ctx.closePath();
    ctx.fill();
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
    // negative / greyscale flash of the icon row before the cut
    fx.dark(ctx, '#121112');
    const [c, x] = off(0);
    strip(x, kf(t, [[11.72, -620], [11.85, -760]]), 560, 1.5, t);
    composite(ctx, c, { filter: 'grayscale(1) brightness(1.15) contrast(1.3)' });
    return;
  }
  const pan = kf(t, [[11.55, 0], [11.72, -200, 'inCubic']]);
  ctx.save();
  ctx.translate(pan, 0);
  const vin = ease.outBack(inv(11.01, 11.15, t));
  drawSprite(ctx, 'vinyl', 480, 545, 360 * lerp(0.75, 1, vin), t * 1.2);
  if (t < 11.16) burst(ctx, 480, 545, inv(11.01, 11.16, t), 61);
  const pop = (t0) => ease.outBack(inv(t0, t0 + 0.12, t), 2.2);
  if (t > 11.1) note(ctx, 'quarter', 1044, 800, pop(11.1) * 1.7, 0.12 + noise1(t, 1) * 0.08);
  if (t > 11.35) note(ctx, 'beam', 750, 270, pop(11.35) * 1.9, -0.12 + noise1(t, 2) * 0.08);
  if (t > 11.58) note(ctx, 'eighth', 645, 820, pop(11.58) * 1.7, 0.15 + noise1(t, 3) * 0.08);
  ctx.restore();
  sparks(ctx, t, 6, 5);
  typed(ctx, 'curiosity.', 11.01, t, 804 + pan, 536, 1323 + pan);
}

// =====================================================================
// 7. Ring again (top view) then the ink scatter.
// =====================================================================
const SCATTER = {
  vinyl: [600, 171, 135],
  clapper: [174, 470, 210],
  skateboard: [450, 489, 160],
  heart: [555, 630, 140],
  book: [714, 429, 130],
  cap: [876, 504, 150],
  camera: [945, 339, 115],
  coin: [1116, 615, 150],
  controller: [1314, 816, 210],
  cash: [300, 960, 210],
  cat: [1080, 735, 180],
  plant: [215, 440, 120],
};
const SIL = { heart: 12.45, skateboard: 12.7 };

function sceneScatter(ctx, t, f) {
  fx.paper(ctx, '#e1e0de', 'rgba(70,68,66,0.45)', W * 0.5, H * 0.5);
  const spin = inv(11.85, 12.0, t);
  const phi = kf(t, [[11.85, -1.6], [12.0, 0, 'outCubic'], [12.42, 0.18, 'linear']]);
  const burstP = ease.outCubic(inv(12.38, 12.58, t));
  const z = kf(t, [[12.5, 1], [13.76, 1.06, 'linear']]);
  const [c, x] = off(0);
  x.save();
  camera(x, { z, x: kf(t, [[12.25, 0], [12.4, 30]]) });
  const ring = ringLayout(phi, { tilt: 0.12, R: 470, cx: 750, cy: 545, F: 4000 });
  ring
    .slice()
    .sort((a, b) => b.z - a.z)
    .forEach((it) => {
      if (it.name === 'cat' && t > 12.4 && t < 13.35) return; // cat is reborn from the blob
      if (it.name === 'coin' && t > 12.92) return; // coin turns into the ink blot
      const tgt = SCATTER[it.name];
      const px = lerp(it.x, tgt[0], burstP);
      const py = lerp(it.y, tgt[1], burstP);
      const w = lerp(RING_W[it.name] * 0.68, tgt[2], burstP);
      const sil = SIL[it.name] && t > SIL[it.name];
      const r = burstP * noise1(t * 1.5 + it.i, it.i) * 0.45;
      drawSprite(x, it.name, px, py, w, r, 1, sil ? { silhouette: '#121010' } : {});
    });
  // ink ball -> blot that swallows the coin and becomes the cat
  if (t < 12.45) {
    const trail = [];
    for (let i = 0; i <= 6; i++) trail.push(kf(t - i * 0.02, [[11.9, [640, 400]], [12.05, [740, 545]], [12.45, [750, 545]]]));
    inkBall(x, trail[0][0], trail[0][1], 34, trail);
  }
  if (t > 12.85) {
    const br = kf(t, [[12.85, 20], [13.0, 85, 'outBack'], [13.76, 92]]);
    const bx = kf(t, [[12.85, 1116], [13.4, 1110], [13.6, 1090]]);
    const by = kf(t, [[12.85, 615], [13.4, 620], [13.6, 700]]);
    x.save();
    x.filter = `blur(${3 * state.S}px)`;
    x.fillStyle = '#0e0d0d';
    x.beginPath();
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const rr = br * (1 + noise1(a * 3 + t * 4, 7) * 0.08);
      x.lineTo(bx + Math.cos(a) * rr, by + Math.sin(a) * rr * 1.1);
    }
    x.fill();
    x.restore();
    if (t > 13.35) drawSprite(x, 'cat', 1130, 690, lerp(120, 180, inv(13.35, 13.6, t)), 0, 1, { silhouette: '#0e0d0d' });
  }
  if (t > 12.4) {
    // brush smears and squiggles flying around
    [[0, 12.42, 0.3, 560, 640, 360, 1.4], [1, 12.6, 0.3, 300, 340, 460, 2.4], [2, 12.95, 0.35, 760, 900, 500, 1.6], [3, 13.2, 0.3, 120, 940, 420, 2.2]].forEach(([k, s, d, ox, oy, len, curl]) => {
      if (t < s || t > s + d + 0.15) return;
      const pts = fx.wanderPoints(200 + k, len, curl, 80).map(([a, b]) => [a + ox, b + oy]);
      const p = inv(s, s + d, t);
      x.save();
      x.filter = `blur(${6 * state.S}px)`;
      fx.strokePartial(x, pts, Math.max(0, p - 0.5), p, 46, 'rgba(40,38,38,0.42)');
      x.restore();
      fx.strokePartial(x, pts, Math.max(0, p - 0.35), p, 7, '#141212', true);
    });
    [[12.45, 120, 610], [12.5, 200, 760], [13.0, 1240, 860], [12.75, 1060, 250]].forEach(([s, ox, oy], k) => {
      if (t < s || t > s + 0.45) return;
      const pts = fx.scribblePoints(300 + k, 150, 70, 4, 70).map(([a, b]) => [a + ox, b + oy]);
      fx.strokePartial(x, pts, 0, inv(s, s + 0.14, t), 5, '#1c1414');
    });
    const r = rng(77);
    for (let i = 0; i < 26; i++) {
      const px = r() * W;
      const py = r() * H;
      x.fillStyle = '#1a1818';
      x.fillRect(px + noise1(t * 3, i) * 12, py + noise1(t * 3, i + 40) * 12, 3 + r() * 5, 2 + r() * 4);
    }
  }
  if (t > 13.45) {
    fx.text(x, 'through', 470, 545, 36, '#1d1a18', { tracking: -0.03 });
    x.fillStyle = '#0e0d0d';
    x.fillRect(612, 524, lerp(0, 200, ease.outExpo(inv(13.45, 13.52, t))), 44);
  }
  x.restore();
  composite(ctx, c, { blur: spin < 1 ? (1 - spin) * 14 : 0 });
  fx.vignette(ctx, lerp(0.3, 0.55, inv(12.5, 13.7, t)), '24,20,20', 0.55, W / 2, H / 2, 0.8);
}

// =====================================================================
// 8. Hand: "through ones own ability to"
// =====================================================================
function sceneHand(ctx, t, f) {
  const bg = bgRamp(t, [[13.76, '#141313'], [15.4, '#141313'], [15.55, '#2c1517'], [15.66, '#3a2a2c'], [15.8, '#5b4e51'], [15.89, '#625658']]);
  fx.dark(ctx, bg);
  const settle = ease.outCubic(inv(13.76, 14.08, t));
  const fall = ease.inOutCubic(inv(15.55, 15.89, t));
  const [c, x] = off(0);
  x.save();
  const sway = noise1(t * 0.8, 6) * 0.025 + Math.sin(t * 2.2) * 0.012;
  x.translate(725, 1110);
  x.rotate(sway + (1 - settle) * -0.4 - fall * 0.55);
  const s = 1.0 * (1 + (1 - settle) * 0.15);
  x.scale(s, s);
  x.translate(-725 + fall * -120, -1110 + (1 - settle) * 220 + fall * 260);
  if (settle < 1) x.filter = `hue-rotate(${-60 * (1 - settle)}deg) saturate(${1 + (1 - settle)})`;
  else if (fall > 0) x.filter = `saturate(${1 - fall * 0.85}) brightness(${1 + fall * 0.2})`;
  x.drawImage(thermal('hand', 'heat'), 250, 250);
  x.restore();
  composite(ctx, c, { blur: (1 - settle) * 18 + fall * 6, alpha: 1 - fall * 0.2 });
  // white streak curves at the start
  if (t < 14.08) {
    const q = inv(13.76, 14.08, t);
    for (let k = 0; k < 3; k++) {
      const pts = fx.wanderPoints(400 + k, 700, 1.2, 60).map(([a, b]) => [a * 0.6 + 560 + k * 70, b * 0.6 + 640]);
      ctx.save();
      ctx.filter = `blur(${3 * state.S}px)`;
      fx.strokePartial(ctx, pts, q * 0.7, 0.3 + q * 0.7, 7, 'rgba(240,236,230,0.75)');
      ctx.restore();
    }
  }
  // horizontal white light streaks as the hand drops away
  if (fall > 0) {
    ctx.save();
    ctx.filter = `blur(${4 * state.S}px)`;
    const r = rng(90);
    for (let i = 0; i < 6; i++) {
      const y = 280 + r() * 160;
      const x0 = r() * 500;
      ctx.fillStyle = `rgba(245,240,236,${0.6 * fall})`;
      ctx.fillRect(x0, y, 300 + r() * 400, 4 + r() * 6);
    }
    ctx.restore();
  }
  // falling specks near the fingertips
  const r = rng(51);
  for (let i = 0; i < 9; i++) {
    const x0 = 560 + r() * 380;
    const y0 = 200 + r() * 240;
    const sp = 30 + r() * 40;
    const yy = y0 + ((t * sp + r() * 100) % 120);
    ctx.save();
    ctx.translate(x0, yy);
    ctx.rotate(0.4 + r());
    ctx.fillStyle = 'rgba(240,236,230,0.85)';
    ctx.fillRect(-1.5, -6, 3, 12);
    ctx.restore();
  }
  // text
  const ti = inv(13.82, 14.0, t);
  const grey = inv(15.5, 15.75, t);
  const col = mixHex(CREAM, '#a09898', grey);
  fx.text(ctx, t < 13.95 ? 'through' : 'through ones', 207, 542, BODY, col, { tracking: -0.04, blur: (1 - ti) * 8 });
  if (t > 14.2) {
    const word = t < 14.45 ? 'own' : t < 15.7 ? 'own ability' : 'own ability to';
    fx.text(ctx, word, 942, 542, BODY, col, { tracking: -0.04 });
    if (t < 14.45) {
      const w = fx.measure(ctx, word, BODY, 700, -0.04);
      ctx.fillStyle = CREAM;
      ctx.fillRect(942 + w + 60, 520, 8, 46);
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
    fx.paper(ctx, '#e6e5e3', 'rgba(100,98,95,0.2)');
    const w = kf(t, [[15.89, 270], [16.04, 300], [16.2, 470, 'inQuad']]);
    const crush = inv(16.06, 16.16, t);
    if (crush > 0) {
      fx.vignette(ctx, crush * 0.97, '28,26,26', lerp(0.6, 0.12, crush), W / 2, H / 2, 0.6);
      fx.grain(ctx, f + 1, 0.3 * crush);
    }
    drawSprite(ctx, 'heart', 728, 545, w, 0, 1, { shadow: 'rgba(40,20,20,0.45)', shadowBlur: 26 });
    letter(ctx, 'L', LX[0], LY, LSIZE, mixHex('#3b1d18', '#8a8888', crush));
    return;
  }
  if (t < 16.52) {
    fx.dark(ctx, '#141313');
    const glow = inv(16.33, 16.42, t);
    if (glow > 0) {
      const g = ctx.createRadialGradient(735, 545, 0, 735, 545, 170);
      g.addColorStop(0, `rgba(230,20,20,${glow})`);
      g.addColorStop(1, 'rgba(200,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    drawSprite(ctx, 'camera', 735, 540, kf(t, [[16.2, 290], [16.5, 310]]), noise1(t, 3) * 0.04);
    letter(ctx, 'L', LX[0], LY, LSIZE, CREAM);
    letter(ctx, 'O', LX[1], LY, LSIZE, CREAM);
    return;
  }
  if (t < 16.77) {
    ctx.fillStyle = '#d41b16';
    ctx.fillRect(0, 0, W, H);
    fx.vignette(ctx, 0.2, '120,0,0', 0.4);
    fx.grain(ctx, f + 2, 0.35);
    const q = ease.outCubic(inv(16.52, 16.64, t));
    const blue = '#2fb2e6';
    letter(ctx, 'L', LX[0], LY, LSIZE, blue);
    letter(ctx, 'O', LX[1], LY, LSIZE, blue);
    if (t > 16.6) letter(ctx, 'V', LX[2], LY, LSIZE, blue);
    drawSprite(ctx, 'book', lerp(730, 735, q), 540, lerp(110, 330, q), lerp(-0.4, 0.28, q), 1, { shadow: 'rgba(60,0,0,0.6)', shadowBlur: 40 });
    return;
  }
  if (t < 17.18) {
    fx.dark(ctx, '#141313');
    const q = ease.outCubic(inv(16.77, 16.95, t));
    drawSprite(ctx, 'vinyl', 729, 540, lerp(230, 285, q), t * 1.5, 1, { sx: lerp(0.32, 1, q), shadow: 'rgba(200,200,220,0.25)', shadowBlur: 30 });
    letter(ctx, 'L', LX[0], LY, LSIZE, CREAM);
    letter(ctx, 'O', LX[1], LY, LSIZE, CREAM);
    letter(ctx, 'V', LX[2], LY, LSIZE, CREAM);
    if (t > 16.86) letter(ctx, 'E', LX[3], LY, LSIZE, CREAM);
    return;
  }
  // 17.18: flash to paper with the record large
  fx.paper(ctx, '#e3e2e0', 'rgba(60,58,56,0.6)');
  fx.vignette(ctx, 0.5, '30,28,28', 0.3);
  drawSprite(ctx, 'vinyl', 720, 540, 450, t * 1.5);
  ['L', 'O', 'V', 'E'].forEach((ch, i) => letter(ctx, ch, LX[i], LY, LSIZE, '#3b1d18'));
}

// Finale: letters scattered, then spinning back upright and converging. Values measured from the reference.
const D = Math.PI / 180;
const FIN = {
  L: [[17.25, [684, 624, -160 * D]], [17.5, [684, 624, -160 * D]], [17.75, [498, 846, 0]], [18.0, [444, 885, -165 * D]], [18.5, [438, 906, -110 * D]], [19.0, [444, 891, -45 * D]], [19.5, [447, 873, -15 * D]], [19.75, [468, 843, -5 * D]], [20.0, [498, 777, 0]], [20.46, [500, 775, 0]]],
  O: [[17.25, [1422, 402, 0]], [17.5, [1422, 402, 0]], [17.75, [1104, 336, 0]], [18.0, [942, 288, 0]], [18.5, [825, 264, 0]], [19.0, [807, 255, 0]], [19.5, [801, 273, 0]], [19.75, [798, 282, 0]], [20.0, [780, 318, 0]], [20.46, [780, 318, 0]]],
  V: [[17.25, [666, 369, 150 * D]], [17.5, [666, 369, 150 * D]], [17.75, [813, 45, 0]], [18.0, [558, 156, 200 * D]], [18.5, [354, 249, 90 * D]], [19.0, [330, 255, 60 * D]], [19.5, [348, 267, 20 * D]], [19.75, [369, 276, 5 * D]], [20.0, [417, 312, 0]], [20.46, [417, 312, 0]]],
  E: [[17.25, [537, 264, 180 * D]], [17.5, [537, 264, 180 * D]], [17.75, [888, 609, 0]], [18.0, [1053, 759, 120 * D]], [18.5, [1173, 870, 80 * D]], [19.0, [1188, 885, 50 * D]], [19.5, [1164, 873, 10 * D]], [19.75, [1149, 843, 0]], [20.0, [1089, 801, 0]], [20.46, [1089, 801, 0]]],
};
const DOTS = [
  [[17.25, [159, 348]], [17.75, [165, 405]], [18.0, [738, 327]], [18.5, [735, 306]], [19.5, [702, 273]], [19.75, [672, 279]], [20.0, [657, 381]], [20.46, [657, 381]]],
  [[17.25, [822, 609]], [17.75, [750, 333]], [18.0, [1284, 645]], [18.5, [1224, 390]], [19.5, [1218, 282]], [19.75, [1227, 261]], [20.0, [1146, 360]], [20.46, [1146, 360]]],
  [[17.25, [1311, 675]], [17.75, [1299, 672]], [18.0, [243, 717]], [18.5, [240, 696]], [19.5, [213, 702]], [19.75, [213, 672]], [20.0, [360, 579]], [20.46, [360, 579]]],
];
const LOOPS = [
  // letter anchor, start, dur, rx, ry, seed, turns, offset
  ['V', 17.3, 0.14, 30, 22, 1, 1.4],
  ['L', 17.34, 0.14, 26, 30, 2, 1.3],
  ['E', 17.36, 0.12, 22, 26, 3, 1.2],
  ['O', 17.38, 0.12, 10, 90, 21, 1.0],
  ['V', 19.22, 0.14, 26, 60, 4, 1.1],
  ['O', 19.25, 0.12, 14, 40, 5, 1.0],
  ['L', 19.26, 0.14, 16, 60, 6, 1.0],
  ['E', 19.28, 0.12, 22, 24, 7, 1.2],
  ['V', 19.45, 0.12, 34, 30, 8, 1.2],
  ['L', 19.48, 0.14, 56, 26, 10, 1.1],
  ['E', 19.5, 0.12, 22, 22, 11, 1.1],
  ['V', 19.7, 0.12, 30, 34, 12, 1.4],
  ['O', 19.7, 0.14, 12, 56, 13, 1.0],
  ['L', 19.72, 0.14, 30, 18, 14, 1.2],
  ['E', 19.74, 0.12, 20, 26, 15, 1.1],
];
const FINAL_LOOPS = [
  // persistent loops held at the end (letter, rx, ry, seed, turns, dx, dy)
  ['O', 10, 46, 31, 1.0, 4, -10],
  ['L', 50, 24, 32, 0.9, -40, -20],
  ['E', 34, 18, 33, 1.3, 0, 0],
  ['V', 20, 14, 34, 1.0, 0, 0],
];

function sceneFinale(ctx, t, f) {
  ctx.fillStyle = '#dededd';
  ctx.fillRect(0, 0, W, H);
  const gg = ctx.createLinearGradient(0, 0, W, H);
  gg.addColorStop(0, 'rgba(255,255,255,0.12)');
  gg.addColorStop(1, 'rgba(120,120,135,0.18)');
  ctx.fillStyle = gg;
  ctx.fillRect(0, 0, W, H);
  // blurred black brush squiggles at the cut
  if (t < 17.45) {
    const q = inv(17.2, 17.45, t);
    [[0, 260, 160, 240, 2.6], [1, 1180, 290, 160, 2.0], [2, 860, 700, 140, 1.6], [3, 1340, 900, 120, 1.8], [4, 300, 980, 120, 2.2]].forEach(([k, ox, oy, len, curl]) => {
      const pts = fx.wanderPoints(500 + k, len, curl, 50).map(([a, b]) => [a + ox, b + oy]);
      ctx.save();
      ctx.filter = `blur(${10 * state.S}px)`;
      fx.strokePartial(ctx, pts, q * 0.5, 0.5 + q * 0.5, 34, 'rgba(50,48,48,0.55)');
      ctx.restore();
      fx.strokePartial(ctx, pts, q * 0.5, 0.5 + q * 0.5, 6, '#1a1818', true);
    });
  }
  const grow = ease.inOutCubic(inv(19.75, 20.05, t));
  const size = lerp(56, 76, grow);
  const pos = {};
  Object.keys(FIN).forEach((ch) => {
    const [x, y, r] = kf(t, FIN[ch].map(([tt, v]) => [tt, v, 'inOutQuad']));
    pos[ch] = [x, y];
    letter(ctx, ch, x, y, size, '#3a1a16', r);
  });
  DOTS.forEach((k, i) => {
    const [x, y] = kf(t, k);
    dot(ctx, x, y, (i === 0 ? 8 : 5.5) * lerp(1, 1.3, grow), '#2a1714');
  });
  // red pen loops
  LOOPS.forEach(([ch, s, d, rx, ry, seed, turns]) => {
    if (t < s || t > s + d + 0.16) return;
    const [ax, ay] = pos[ch];
    const pts = fx.loopPoints(seed, rx, ry, turns).map(([a, b]) => [a + ax + rx * 0.3, b + ay - ry * 0.3]);
    fx.strokePartial(ctx, pts, inv(s + d, s + d + 0.16, t), inv(s, s + d, t), 1.8, '#e0402e');
  });
  if (t > 19.92) {
    FINAL_LOOPS.forEach(([ch, rx, ry, seed, turns, dx, dy]) => {
      const [ax, ay] = pos[ch];
      const pts = fx.loopPoints(seed, rx, ry, turns).map(([a, b]) => [a + ax + dx, b + ay + dy]);
      fx.strokePartial(ctx, pts, 0, inv(19.92, 20.05, t), 1.8, '#e0402e');
    });
  }
  if (t > 17.55 && t < 17.95) {
    const pts = fx.wanderPoints(808, 300, 2.2, 60).map(([a, b]) => [a + 980, b + 520]);
    const p = inv(17.55, 17.75, t);
    fx.strokePartial(ctx, pts, Math.max(0, p - 0.4), p, 6, '#141212', true);
  }
}

// ---------------------------------------------------------------------
const TIMELINE = [
  [0, 0.6, sceneOpen],
  [0.6, 1.96, sceneType],
  [1.96, 3.76, sceneSparkle],
  [3.76, 6.3, sceneProfile],
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
  // global film treatment
  const isDark = (t > 3.7 && t < 5.7) || (t > 8.3 && t < 9.13) || (t > 9.84 && t < 10.51) || (t > 11.01 && t < 11.85) || (t > 13.76 && t < 15.89) || (t > 16.2 && t < 16.52) || (t > 16.77 && t < 17.18);
  fx.grain(ctx, f, isDark ? 0.2 : 0.15);
  fx.vignette(ctx, 0.14, '0,0,0', 0.6);
}

module.exports = { renderFrame, TIMELINE, setScale };
