// Shared drawing effects: film grain, vignettes, sparkle stars, scribbles, typography.
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const { W, H, rng, lerp, clamp, noise1 } = require('./core');

const FONT_DIR = path.join(__dirname, '..', '..', 'fonts');
GlobalFonts.registerFromPath(path.join(FONT_DIR, 'Satoshi-500.woff2'), 'Satoshi');
GlobalFonts.registerFromPath(path.join(FONT_DIR, 'Satoshi-700.woff2'), 'Satoshi');
GlobalFonts.registerFromPath(path.join(FONT_DIR, 'Satoshi-900.woff2'), 'Satoshi');

// ---------------------------------------------------------------- grain
const GRAIN = [];
for (let k = 0; k < 6; k++) {
  const c = createCanvas(512, 512);
  const x = c.getContext('2d');
  const img = x.createImageData(512, 512);
  const r = rng(1000 + k);
  for (let i = 0; i < 512 * 512; i++) {
    // roughly gaussian luminance noise
    const v = (r() + r() + r()) / 3;
    const g = Math.round(v * 255);
    img.data[i * 4] = g;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = g;
    img.data[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  GRAIN.push(c);
}

function grain(ctx, frame, amount = 0.14) {
  const g = GRAIN[frame % GRAIN.length];
  const r = rng(frame * 7 + 3);
  const ox = -Math.floor(r() * 512);
  const oy = -Math.floor(r() * 512);
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = amount;
  for (let y = oy; y < H; y += 512) for (let x = ox; x < W; x += 512) ctx.drawImage(g, x, y);
  ctx.restore();
}

// ---------------------------------------------------------------- vignette
function vignette(ctx, strength = 0.35, color = '0,0,0', inner = 0.45, cx = W / 2, cy = H / 2, outer = 0.85) {
  const g = ctx.createRadialGradient(cx, cy, W * inner * 0.5, cx, cy, W * outer);
  g.addColorStop(0, `rgba(${color},0)`);
  g.addColorStop(1, `rgba(${color},${strength})`);
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// paper-ish light background with soft falloff, like the reference's off-white
function paper(ctx, base = '#e6e5e2', dark = 'rgba(120,118,115,0.35)', cx = W * 0.45, cy = H * 0.4) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(cx, cy, 100, cx, cy, W * 0.95);
  g.addColorStop(0, 'rgba(255,255,255,0.12)');
  g.addColorStop(0.5, 'rgba(255,255,255,0)');
  g.addColorStop(1, dark);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function dark(ctx, base = '#151415') {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W * 0.5, H * 0.45, 50, W * 0.5, H * 0.5, W * 0.8);
  g.addColorStop(0, 'rgba(40,38,38,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

// ---------------------------------------------------------------- sparkle star
// Concave 4-point star; `k` controls how pinched the sides are.
function starPath(ctx, cx, cy, r, rot = 0, k = 0.12, arms = 4) {
  ctx.beginPath();
  for (let i = 0; i < arms; i++) {
    const a0 = rot + (i * Math.PI * 2) / arms;
    const a1 = rot + ((i + 1) * Math.PI * 2) / arms;
    const am = (a0 + a1) / 2;
    const p0 = [cx + Math.cos(a0) * r, cy + Math.sin(a0) * r];
    const p1 = [cx + Math.cos(a1) * r, cy + Math.sin(a1) * r];
    const c = [cx + Math.cos(am) * r * k, cy + Math.sin(am) * r * k];
    if (i === 0) ctx.moveTo(...p0);
    ctx.bezierCurveTo(lerp(p0[0], c[0], 0.85), lerp(p0[1], c[1], 0.85), lerp(p1[0], c[0], 0.85), lerp(p1[1], c[1], 0.85), ...p1);
  }
  ctx.closePath();
}

// ---------------------------------------------------------------- scribbles
// A looping cursive "signature" stroke. Returns an array of points.
function scribblePoints(seed, w, h, loops = 7, n = 260) {
  const r = rng(seed);
  const pts = [];
  const ph = r() * 6;
  const amp = Array.from({ length: loops + 1 }, () => {
    const k = r();
    return k > 0.82 ? 1.9 : k < 0.15 ? -1.5 : 0.55 + r() * 0.5;
  });
  const wid = Array.from({ length: loops + 1 }, () => 0.5 + r() * 0.9);
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const k = Math.min(loops - 1, Math.floor(u * loops));
    const fu = u * loops - k;
    const a = lerp(amp[k], amp[k + 1], fu * fu * (3 - 2 * fu));
    const ang = u * loops * Math.PI * 2 + ph;
    const x = u * w + Math.cos(ang) * h * 0.16 * wid[k];
    const yv = -Math.sin(ang) * h * 0.4 * Math.abs(a);
    const y = (a < 0 ? Math.max(yv, -h * 0.25) * -1 : yv) + noise1(u * 3, seed + 2) * h * 0.12;
    pts.push([x, y]);
  }
  return pts;
}

// Generic smooth wandering path (for ink smears, red loops etc.)
function wanderPoints(seed, len, curl = 1, n = 120) {
  const r = rng(seed);
  let a = r() * Math.PI * 2;
  let x = 0;
  let y = 0;
  const pts = [[0, 0]];
  const step = len / n;
  for (let i = 0; i < n; i++) {
    a += noise1(i * 0.08 * curl, seed) * 0.35 * curl;
    x += Math.cos(a) * step;
    y += Math.sin(a) * step;
    pts.push([x, y]);
  }
  return pts;
}

// loop around a point (red pen circles around letters in the finale)
function loopPoints(seed, rx, ry, turns = 1.4, n = 140) {
  const r = rng(seed);
  const pts = [];
  const a0 = r() * Math.PI * 2;
  const tilt = (r() - 0.5) * 1.2;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const a = a0 + u * turns * Math.PI * 2;
    const jx = 1 + noise1(u * 6, seed) * 0.25;
    const jy = 1 + noise1(u * 6, seed + 9) * 0.25;
    const px = Math.cos(a) * rx * jx;
    const py = Math.sin(a) * ry * jy;
    pts.push([px * Math.cos(tilt) - py * Math.sin(tilt), px * Math.sin(tilt) + py * Math.cos(tilt)]);
  }
  return pts;
}

// Draw a polyline partially: from p0 to p1 fraction (0..1), with taper option.
function strokePartial(ctx, pts, p0, p1, width, color, taper = false) {
  const n = pts.length - 1;
  const i0 = Math.floor(clamp(p0) * n);
  const i1 = Math.ceil(clamp(p1) * n);
  if (i1 - i0 < 1) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (!taper) {
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(...pts[i0]);
    for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(...pts[i]);
    ctx.stroke();
  } else {
    for (let i = i0 + 1; i <= i1; i++) {
      const u = (i - i0) / (i1 - i0);
      ctx.lineWidth = width * Math.sin(Math.PI * clamp(u * 0.9 + 0.05));
      ctx.beginPath();
      ctx.moveTo(...pts[i - 1]);
      ctx.lineTo(...pts[i]);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------- type
function font(size, weight = 700) {
  return `${weight} ${size}px Satoshi`;
}

function text(ctx, str, x, y, size, color, opts = {}) {
  ctx.save();
  ctx.font = font(size, opts.weight ?? 700);
  ctx.letterSpacing = `${(opts.tracking ?? -0.03) * size}px`;
  ctx.textAlign = opts.align ?? 'left';
  ctx.textBaseline = opts.baseline ?? 'middle';
  ctx.fillStyle = color;
  if (opts.blur) ctx.filter = `blur(${opts.blur}px)`;
  if (opts.glow) {
    ctx.shadowColor = opts.glow;
    ctx.shadowBlur = opts.glowBlur ?? 18;
  }
  ctx.globalAlpha *= opts.alpha ?? 1;
  ctx.fillText(str, x, y);
  ctx.restore();
}

function measure(ctx, str, size, weight = 700, tracking = -0.03) {
  ctx.save();
  ctx.font = font(size, weight);
  ctx.letterSpacing = `${tracking * size}px`;
  const w = ctx.measureText(str).width;
  ctx.restore();
  return w;
}

// Render a sequence of words, each with its own colour, starting at x.
function words(ctx, parts, x, y, size, opts = {}) {
  let cx = x;
  const space = measure(ctx, ' ', size, opts.weight);
  parts.forEach((p) => {
    const w = measure(ctx, p.t, size, p.weight ?? opts.weight);
    text(ctx, p.t, cx, y, size, p.c, { ...opts, ...p.o, weight: p.weight ?? opts.weight });
    cx += w + space;
  });
  return cx - space;
}

// Typing cursor bar.
function cursor(ctx, x, y, h, color = '#f2efe9', w = 4) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.fillRect(x, y - h / 2, w, h);
  ctx.restore();
}

// Draw something onto an offscreen layer and composite with blur/blend.
function layer(ctx, draw, opts = {}) {
  const c = createCanvas(W, H);
  const x = c.getContext('2d');
  draw(x);
  ctx.save();
  if (opts.blur) ctx.filter = `blur(${opts.blur}px)`;
  if (opts.op) ctx.globalCompositeOperation = opts.op;
  ctx.globalAlpha = opts.alpha ?? 1;
  ctx.drawImage(c, 0, 0);
  ctx.restore();
  return c;
}

module.exports = {
  grain,
  vignette,
  paper,
  dark,
  starPath,
  scribblePoints,
  wanderPoints,
  loopPoints,
  strokePartial,
  font,
  text,
  measure,
  words,
  cursor,
  layer,
};
