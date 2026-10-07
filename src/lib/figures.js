// Original figure artwork: a head-and-shoulders profile and a reaching hand,
// rendered with a thermal-camera style gradient (or a flat backlit silhouette).
const { createCanvas } = require('@napi-rs/canvas');
const { rng, noise1, lerp } = require('./core');

// Profile facing left, in a 760x900 local box (top of hair at y≈0).
function headPath(ctx, seed = 3) {
  // face: forehead, brow, nose, lips, chin, then a slender neck angled forward
  // profile tuned to measured proportions (local px; nose tip ~ (59,312), chin ~ (65,480))
  const face = [
    [128, 905], [168, 800], [196, 700], [212, 640], [198, 600], [194, 572], [189, 555], [150, 540],
    [100, 528], [77, 512], [66, 492], [65, 472], [72, 452], [75, 432], [68, 412], [70, 392],
    [74, 372], [76, 352], [66, 335], [59, 312], [80, 290], [100, 268], [111, 232], [117, 200],
    [105, 175], [91, 152], [81, 120], [96, 100],
  ];
  // soft tousled hair: low-frequency irregular edge, with a quiff over the forehead
  const r = rng(seed);
  const hair = [];
  const n = 48;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const a = Math.PI * (1.2 + u * 0.9);
    const tuft = Math.abs(noise1(u * 9, seed)) * 0.09 + Math.abs(noise1(u * 26, seed + 4)) * 0.04 + (r() - 0.5) * 0.02;
    const quiff = u < 0.22 ? Math.pow(Math.sin((u / 0.22) * Math.PI), 0.7) * 0.24 + Math.abs(noise1(u * 60, seed + 9)) * 0.06 : 0;
    const backTuft = u > 0.55 && u < 0.92 ? Math.max(0, Math.sin(u * Math.PI * 14)) * 0.07 : 0;
    const rx = u > 0.45 ? lerp(250, 228, Math.min(1, (u - 0.45) / 0.3)) : 250; // rounder, smaller back crown
    hair.push([330 + Math.cos(a) * rx * (1 + tuft + quiff + backTuft), 222 + Math.sin(a) * 210 * (1 + tuft + quiff * 0.4 + backTuft)]);
  }
  // back of skull, nape, neck, then a shorter sloping shoulder
  const back = [
    [586, 310], [578, 372], [556, 430], [520, 482], [478, 540], [478, 590], [490, 640],
    [522, 690], [556, 740], [592, 800], [612, 905],
  ];
  const pts = [...face, ...hair, ...back];
  ctx.beginPath();
  ctx.moveTo(...pts[0]);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  ctx.lineTo(...pts[pts.length - 1]);
  ctx.closePath();
}

// Hand poses (local = screen - (250,250)). Each finger: [base, ctrl, tip], w0, w1.
const PALM = [[372, 970], [370, 820], [372, 700], [368, 600], [400, 500], [406, 410], [440, 335], [515, 300], [584, 308], [622, 360], [618, 460], [588, 540], [568, 600], [560, 700], [570, 820], [576, 970]];
const POSES = {
  // natural spread: thumb low and left, index diagonal up-left, middle up, ring up-right
  open: {
    palm: PALM,
    f: [
      [[[455, 470], [365, 455], [282, 440]], 66, 42],
      [[[455, 350], [370, 290], [295, 240]], 64, 40],
      [[[525, 325], [526, 220], [520, 118]], 66, 40],
      [[[580, 335], [635, 245], [670, 152]], 59, 36],
      [[[592, 395], [615, 372], [628, 350]], 40, 30],
    ],
  },
  // fingers curling in
  curl: {
    palm: PALM,
    f: [
      [[[430, 450], [370, 445], [312, 452]], 68, 47],
      [[[455, 350], [400, 296], [352, 306]], 64, 47],
      [[[525, 325], [590, 240], [665, 150]], 66, 42],
      [[[580, 330], [622, 258], [650, 220]], 59, 44],
      [[[595, 390], [626, 360], [642, 332]], 47, 37],
    ],
  },
  // loose fist with the index pointing left
  fist: {
    palm: PALM,
    f: [
      [[[440, 420], [420, 398], [404, 392]], 60, 50],
      [[[455, 360], [395, 348], [345, 342]], 50, 38],
      [[[520, 345], [512, 336], [505, 342]], 50, 44],
      [[[570, 352], [560, 344], [552, 350]], 48, 42],
      [[[598, 400], [590, 390], [582, 394]], 42, 38],
    ],
  },
};

function blendPose(a, b, t) {
  const A = POSES[a];
  const B = POSES[b];
  return {
    fist: b === 'fist' && t > 0.3,
    palm: A.palm.map((p, i) => [lerp(p[0], B.palm[i][0], t), lerp(p[1], B.palm[i][1], t)]),
    f: A.f.map(([pts, w0, w1], i) => [pts.map((p, j) => [lerp(p[0], B.f[i][0][j][0], t), lerp(p[1], B.f[i][0][j][1], t)]), lerp(w0, B.f[i][1], t), lerp(w1, B.f[i][2], t)]),
  };
}

// ---- realistic hand: tapered jointed fingers, cylinder shading, overlap shadows ----
function quad(pts, u) {
  const [a, b, c] = pts;
  return [
    (1 - u) * (1 - u) * a[0] + 2 * (1 - u) * u * b[0] + u * u * c[0],
    (1 - u) * (1 - u) * a[1] + 2 * (1 - u) * u * b[1] + u * u * c[1],
  ];
}

// extend a finger's base back into the palm so it grows out of it (no seam)
function rooted(pts, by = 50) {
  const [a, b, c] = pts;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  return [[a[0] - (dx / l) * by, a[1] - (dy / l) * by], b, c];
}

// Outline polygon of a finger: tapering width, slight knuckle bulges, rounded tip.
function fingerOutline(pts, w0, w1, u0 = 0) {
  const n = 28;
  const L = [];
  const R = [];
  const centre = [];
  for (let i = 0; i <= n; i++) {
    const u = u0 + (1 - u0) * (i / n);
    const p = quad(pts, u);
    const q = quad(pts, Math.min(1, u + 0.01));
    const p0 = quad(pts, Math.max(0, u - 0.01));
    const tx = q[0] - p0[0];
    const ty = q[1] - p0[1];
    const tl = Math.hypot(tx, ty) || 1;
    const nx = -ty / tl;
    const ny = tx / tl;
    const knuckle = 1 + 0.07 * Math.exp(-(((u - 0.4) / 0.06) ** 2)) + 0.05 * Math.exp(-(((u - 0.72) / 0.05) ** 2));
    const hw = (lerp(w0, w1, u) / 2) * knuckle;
    centre.push({ p, nx, ny, hw, tx: tx / tl, ty: ty / tl });
    L.push([p[0] + nx * hw, p[1] + ny * hw]);
    R.push([p[0] - nx * hw, p[1] - ny * hw]);
  }
  // rounded fingertip cap
  const end = centre[centre.length - 1];
  const cap = [];
  for (let k = 1; k < 10; k++) {
    const a = (k / 10) * Math.PI;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    cap.push([end.p[0] + end.nx * end.hw * ca + end.tx * end.hw * 0.95 * sa, end.p[1] + end.ny * end.hw * ca + end.ty * end.hw * 0.95 * sa]);
  }
  return { poly: [...L, ...cap, ...R.reverse()], centre };
}

function smoothPoly(ctx, P, closed = true) {
  ctx.beginPath();
  ctx.moveTo((P[0][0] + P[1][0]) / 2, (P[0][1] + P[1][1]) / 2);
  for (let i = 1; i < P.length; i++) {
    const a = P[i];
    const b = P[(i + 1) % P.length];
    ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  }
  if (closed) ctx.closePath();
}

function palmPath(ctx, P) {
  ctx.beginPath();
  ctx.moveTo(...P[0]);
  for (let i = 1; i < P.length - 1; i++) ctx.quadraticCurveTo(P[i][0], P[i][1], (P[i][0] + P[i + 1][0]) / 2, (P[i][1] + P[i + 1][1]) / 2);
  ctx.lineTo(...P[P.length - 1]);
  ctx.closePath();
}

// silhouette only (used by the static thermal('hand') cache)
function handShape(ctx, pose = POSES.open) {
  palmPath(ctx, pose.palm);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(455, 480, 70, 58, -0.5, 0, Math.PI * 2);
  ctx.fill();
  pose.f.forEach(([pts, w0, w1]) => {
    smoothPoly(ctx, fingerOutline(rooted(pts), w0 * 1.08, w1).poly);
    ctx.fill();
  });
}

// thermal colouring shared by every part of the hand (same gradients => seamless joins)
function paintThermal(x, w, h) {
  x.globalCompositeOperation = 'source-in';
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#f26422');
  g.addColorStop(0.45, '#f6862e');
  g.addColorStop(0.8, '#ffb442');
  g.addColorStop(1, '#ffc650');
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  x.globalCompositeOperation = 'source-atop';
  const r = x.createLinearGradient(270, 0, 700, 0);
  r.addColorStop(0, 'rgba(255,236,190,0.85)');
  r.addColorStop(0.3, 'rgba(255,214,150,0.55)');
  r.addColorStop(0.5, 'rgba(240,120,40,0.08)');
  r.addColorStop(0.65, 'rgba(255,110,30,0.15)');
  r.addColorStop(0.74, 'rgba(184,48,16,0.75)');
  r.addColorStop(1, 'rgba(170,36,16,0.85)');
  x.fillStyle = r;
  x.fillRect(0, 0, w, h);
  const fa = x.createRadialGradient(380, 860, 0, 380, 860, 300);
  fa.addColorStop(0, 'rgba(255,216,144,0.6)');
  fa.addColorStop(1, 'rgba(255,214,110,0)');
  x.fillStyle = fa;
  x.fillRect(0, 0, w, h);
  x.globalCompositeOperation = 'source-over';
}

// Per-frame thermal hand (pose changes every frame, so no cache).
function thermalHand(pose) {
  const w = 800;
  const h = 980;
  const c = createCanvas(w, h);
  const x = c.getContext('2d');
  const layer = createCanvas(w, h);
  const lx = layer.getContext('2d');

  // palm + thumb-base bulge
  lx.fillStyle = '#fff';
  palmPath(lx, pose.palm);
  lx.fill();
  lx.beginPath();
  lx.ellipse(448, 475, 86, 70, -0.5, 0, Math.PI * 2);
  lx.fill();
  paintThermal(lx, w, h);
  lx.globalCompositeOperation = 'source-atop';
  const ph = lx.createRadialGradient(460, 520, 0, 460, 520, 130);
  ph.addColorStop(0, 'rgba(248,192,112,0.55)');
  ph.addColorStop(1, 'rgba(248,192,112,0)');
  lx.fillStyle = ph;
  lx.fillRect(0, 0, w, h);
  // darker right edge of the palm / forearm (turning away from the light)
  lx.filter = 'blur(12px)';
  const edge = (pts, col, lw) => {
    lx.strokeStyle = col;
    lx.lineWidth = lw;
    lx.beginPath();
    pts.forEach(([a, b], i) => (i ? lx.lineTo(a, b) : lx.moveTo(a, b)));
    lx.stroke();
  };
  const P = pose.palm;
  const half = Math.floor(P.length / 2);
  edge(P.slice(half).map(([a, b]) => [a + 6, b]), 'rgba(196,52,16,0.6)', 50);
  edge(P.slice(0, half).map(([a, b]) => [a - 6, b]), 'rgba(220,90,30,0.35)', 36);
  lx.filter = 'none';
  lx.globalCompositeOperation = 'source-over';
  x.drawImage(layer, 0, 0);

  // fingers back to front: pinky, ring, middle, index, thumb
  const order = [4, 3, 2, 1, 0];
  order.forEach((fi) => {
    const [pts0, w0, w1] = pose.f[fi];
    const pts = rooted(pts0);
    const { poly } = fingerOutline(pts, w0 * 1.2, w1 * 1.1);
    const free = fingerOutline(pts, w0 * 1.2, w1 * 1.1, 0.3); // visible part beyond the knuckle
    lx.setTransform(1, 0, 0, 1, 0, 0);
    lx.globalCompositeOperation = 'source-over';
    lx.filter = 'none';
    lx.clearRect(0, 0, w, h);
    lx.fillStyle = '#fff';
    smoothPoly(lx, poly);
    lx.fill();
    paintThermal(lx, w, h);
    // cylinder shading only along the free part of the finger (fades into the palm)
    lx.save();
    smoothPoly(lx, free.poly);
    lx.clip();
    lx.filter = 'blur(7px)';
    lx.strokeStyle = 'rgba(150,34,12,0.2)';
    lx.lineWidth = w0 * 0.5;
    smoothPoly(lx, free.poly);
    lx.stroke();
    lx.strokeStyle = 'rgba(255,238,200,0.0)';
    lx.lineWidth = w0 * 0.22;
    lx.lineCap = 'round';
    lx.beginPath();
    free.centre.forEach((cc, i) => {
      const px = cc.p[0] + cc.nx * cc.hw * 0.25;
      const py = cc.p[1] + cc.ny * cc.hw * 0.25;
      if (i === 0) lx.moveTo(px, py);
      else lx.lineTo(px, py);
    });
    lx.stroke();
    lx.filter = 'blur(2px)';
    lx.strokeStyle = 'rgba(150,40,16,0.16)';
    lx.lineWidth = 3;
    [0.45, 0.75].forEach((u) => {
      const cc = free.centre[Math.round(u * (free.centre.length - 1))];
      lx.beginPath();
      lx.moveTo(cc.p[0] + cc.nx * cc.hw * 0.7, cc.p[1] + cc.ny * cc.hw * 0.7);
      lx.lineTo(cc.p[0] - cc.nx * cc.hw * 0.7, cc.p[1] - cc.ny * cc.hw * 0.7);
      lx.stroke();
    });
    lx.restore();
    // fade the root in, so the part buried in the palm blends instead of showing a cut edge
    const r0 = quad(pts, 0.02);
    const r1 = quad(pts, 0.26);
    const fade = lx.createLinearGradient(r0[0], r0[1], r1[0], r1[1]);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(0,0,0,1)');
    lx.globalCompositeOperation = 'destination-in';
    lx.fillStyle = fade;
    lx.fillRect(0, 0, w, h);
    lx.globalCompositeOperation = 'source-over';
    // soft occlusion only where this finger crosses a finger behind it (not on the palm)
    x.save();
    x.globalCompositeOperation = 'source-atop';
    x.filter = 'blur(10px)';
    x.globalAlpha = fi === 4 ? 0 : 0.3;
    x.fillStyle = '#5a0e04';
    smoothPoly(x, free.poly.map(([a2, b2]) => [a2 + 5, b2 + 7]));
    x.fill();
    x.restore();
    x.drawImage(layer, 0, 0);
  });

  const s = createCanvas(w, h);
  const sx = s.getContext('2d');
  sx.filter = 'blur(8px)';
  sx.globalAlpha = 0.2;
  sx.drawImage(c, 0, 0);
  sx.globalAlpha = 1;
  sx.filter = 'blur(2.6px)';
  sx.drawImage(c, 0, 0);
  return s;
}

const cache = {};

// Build a thermal-gradient rendering of a shape. palette: 'heat' | 'shadow'.
function thermal(kind, palette = 'heat') {
  const key = kind + palette;
  if (cache[key]) return cache[key];
  const w = 800;
  const h = kind === 'head' ? 940 : 860;
  const c = createCanvas(w, h);
  const x = c.getContext('2d');
  x.fillStyle = '#fff';
  if (kind === 'head') headPath(x);
  else handShape(x, POSES.open);
  x.fill();
  x.globalCompositeOperation = 'source-in';
  if (palette === 'heat') {
    const g = x.createLinearGradient(0, 0, 0, h);
    if (kind === 'head') {
      g.addColorStop(0, '#f09828');
      g.addColorStop(0.22, '#ec8228');
      g.addColorStop(0.4, '#e86c20');
      g.addColorStop(0.6, '#ea7022');
      g.addColorStop(0.75, '#f49c3a');
      g.addColorStop(0.86, '#fde2a0');
      g.addColorStop(1, '#fff7ea');
    } else {
      g.addColorStop(0, '#ff7a24');
      g.addColorStop(0.45, '#ff9a34');
      g.addColorStop(0.8, '#ffb442');
      g.addColorStop(1, '#ffc650');
    }
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = 'source-atop';
    if (kind === 'head') {
      // yellow crown at the back of the head, deep red at the face edge
      const r = x.createRadialGradient(430, 170, 10, 430, 170, 260);
      r.addColorStop(0, 'rgba(255,190,70,0.75)');
      r.addColorStop(1, 'rgba(255,150,50,0)');
      x.fillStyle = r;
      x.fillRect(0, 0, w, h);
      // red-orange face and front of neck, fading back toward the yellow crown
      const f = x.createLinearGradient(30, 0, 380, 0);
      f.addColorStop(0, 'rgba(226,44,14,0.95)');
      f.addColorStop(0.4, 'rgba(232,70,18,0.55)');
      f.addColorStop(1, 'rgba(236,80,22,0)');
      x.fillStyle = f;
      x.fillRect(0, 0, w, h);
      const crown = x.createRadialGradient(200, 80, 10, 200, 80, 240);
      crown.addColorStop(0, 'rgba(250,180,70,0.45)');
      crown.addColorStop(1, 'rgba(255,196,80,0)');
      x.fillStyle = crown;
      x.fillRect(0, 0, w, 360);
      // white/pink shirt on the shoulders
      const shirt = x.createLinearGradient(0, 700, 0, 940);
      shirt.addColorStop(0, 'rgba(255,216,96,0.0)');
      shirt.addColorStop(0.3, 'rgba(255,232,170,0.8)');
      shirt.addColorStop(1, 'rgba(252,250,246,1)');
      x.fillStyle = shirt;
      x.beginPath();
      x.moveTo(110, 940);
      x.bezierCurveTo(180, 790, 330, 728, 470, 722);
      x.bezierCurveTo(600, 722, 700, 800, 780, 940);
      x.closePath();
      x.filter = 'blur(40px)';
      x.fill();
      x.filter = 'none';
      // bright glow rising from the shoulders into the neck
      x.globalCompositeOperation = 'source-atop';
      const sg = x.createRadialGradient(450, 960, 20, 450, 900, 330);
      sg.addColorStop(0, 'rgba(255,242,192,0.95)');
      sg.addColorStop(0.55, 'rgba(255,230,160,0.45)');
      sg.addColorStop(1, 'rgba(255,220,140,0)');
      x.fillStyle = sg;
      x.fillRect(0, 0, w, h);
      // red edge burn around the outline
      x.globalCompositeOperation = 'source-atop';
      x.save();
      x.filter = 'blur(8px)';
      x.strokeStyle = 'rgba(196,40,16,0.8)';
      x.lineWidth = 48;
      x.beginPath();
      x.rect(0, 250, 300, 700); // face, chin, front of neck
      x.rect(440, 380, 360, 560); // back of neck
      x.clip();
      headPath(x);
      x.stroke();
      x.restore();
      x.save();
      x.filter = 'blur(6px)';
      x.strokeStyle = 'rgba(210,60,20,0.35)';
      x.lineWidth = 14;
      headPath(x);
      x.stroke();
      x.restore();
    } else {
      // lit left side (cream) vs. deep orange-red right side
      const r = x.createLinearGradient(150, 0, 750, 0);
      r.addColorStop(0, 'rgba(255,226,180,0.85)');
      r.addColorStop(0.4, 'rgba(255,200,130,0.35)');
      r.addColorStop(0.7, 'rgba(255,90,20,0.2)');
      r.addColorStop(1, 'rgba(230,40,12,0.75)');
      x.fillStyle = r;
      x.fillRect(0, 0, w, h);
    }
    // mottling
    const rr = rng(kind.length * 17);
    for (let i = 0; i < 26; i++) {
      const px = rr() * w;
      const py = rr() * h * 0.8;
      const gg = x.createRadialGradient(px, py, 0, px, py, 90 + rr() * 120);
      const hot = rr() > 0.5;
      gg.addColorStop(0, hot ? 'rgba(255,200,80,0.14)' : 'rgba(230,50,10,0.14)');
      gg.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = gg;
      x.fillRect(0, 0, w, h);
    }
  } else {
    // backlit silhouette: dark warm grey with slight rim
    x.fillStyle = '#3a3531';
    x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = 'source-atop';
    const g = x.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(90,82,70,0.5)');
    g.addColorStop(0.4, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
  }
  // soften edges
  const s = createCanvas(w, h);
  const sx = s.getContext('2d');
  sx.filter = palette === 'heat' ? 'blur(1.6px)' : 'blur(1.2px)';
  sx.drawImage(c, 0, 0);
  cache[key] = s;
  return s;
}

module.exports = { headPath, handShape, thermal, thermalHand, blendPose, POSES };
