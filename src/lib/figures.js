// Original figure artwork: a head-and-shoulders profile and a reaching hand,
// rendered with a thermal-camera style gradient (or a flat backlit silhouette).
const { createCanvas } = require('@napi-rs/canvas');
const { rng, noise1, lerp } = require('./core');

// Profile facing left, in a 760x900 local box (top of hair at y≈0).
function headPath(ctx, seed = 3) {
  // face: forehead, brow, nose, lips, chin, then a slender neck angled forward
  const face = [
    [170, 905], [205, 800], [232, 700], [244, 630], [236, 560], [214, 505], [186, 482],
    [148, 468], [108, 458], [86, 444], [76, 424], [80, 404], [68, 392], [74, 380], [64, 368],
    [70, 356], [58, 346], [40, 334], [44, 318], [62, 296], [70, 268], [68, 246], [80, 222],
    [88, 192], [96, 162],
  ];
  // tousled hair crown: an arc over the skull with noisy tufts
  const r = rng(seed);
  const hair = [];
  const n = 64;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const a = Math.PI * (1.1 + u * 0.98);
    const tuft = Math.abs(noise1(u * 30, seed)) * 0.09 + (i % 4 === 1 ? 0.05 : 0) + (r() - 0.5) * 0.05;
    const front = u < 0.15 ? (0.15 - u) * 0.6 : 0; // hair overhangs the forehead a little
    hair.push([330 + Math.cos(a) * 250 * (1 + tuft + front), 215 + Math.sin(a) * 205 * (1 + tuft)]);
  }
  // back of skull, nape, back of neck, then a low sloping shoulder
  const back = [
    [585, 300], [574, 372], [546, 428], [512, 462], [486, 520], [470, 590], [478, 650],
    [520, 700], [585, 750], [640, 815], [660, 905],
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
const PALM = [[358, 830], [364, 650], [380, 510], [398, 390], [445, 325], [510, 305], [578, 300], [612, 345], [604, 450], [572, 530], [548, 650], [538, 830]];
const POSES = {
  // natural spread: thumb low and left, index diagonal up-left, middle up, ring up-right
  open: {
    palm: PALM,
    f: [
      [[[430, 450], [350, 440], [280, 426]], 78, 54],
      [[[455, 350], [370, 290], [295, 240]], 73, 51],
      [[[525, 325], [530, 220], [522, 122]], 76, 54],
      [[[580, 330], [640, 230], [690, 152]], 68, 49],
      [[[595, 390], [640, 350], [665, 310]], 54, 40],
    ],
  },
  // fingers curling in
  curl: {
    palm: PALM,
    f: [
      [[[430, 450], [370, 445], [312, 452]], 78, 54],
      [[[455, 350], [400, 296], [352, 306]], 73, 54],
      [[[525, 325], [522, 238], [500, 182]], 76, 57],
      [[[580, 330], [622, 258], [650, 220]], 68, 51],
      [[[595, 390], [626, 360], [642, 332]], 54, 43],
    ],
  },
  // loose fist with the index pointing left
  fist: {
    palm: PALM,
    f: [
      [[[430, 460], [402, 432], [382, 420]], 81, 62],
      [[[455, 360], [330, 330], [205, 322]], 70, 51],
      [[[525, 340], [500, 300], [470, 330]], 81, 65],
      [[[580, 350], [560, 300], [530, 330]], 76, 62],
      [[[595, 400], [580, 360], [555, 380]], 62, 51],
    ],
  },
};

function blendPose(a, b, t) {
  const A = POSES[a];
  const B = POSES[b];
  return {
    palm: A.palm.map((p, i) => [lerp(p[0], B.palm[i][0], t), lerp(p[1], B.palm[i][1], t)]),
    f: A.f.map(([pts, w0, w1], i) => [pts.map((p, j) => [lerp(p[0], B.f[i][0][j][0], t), lerp(p[1], B.f[i][0][j][1], t)]), lerp(w0, B.f[i][1], t), lerp(w1, B.f[i][2], t)]),
  };
}

function handShape(ctx, pose = POSES.open) {
  const finger = (pts, w0, w1) => {
    const n = 48;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const [a, b, c] = pts;
      const x = (1 - u) * (1 - u) * a[0] + 2 * (1 - u) * u * b[0] + u * u * c[0];
      const y = (1 - u) * (1 - u) * a[1] + 2 * (1 - u) * u * b[1] + u * u * c[1];
      ctx.beginPath();
      ctx.arc(x, y, lerp(w0, w1, u) / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  const P = pose.palm;
  ctx.beginPath();
  ctx.moveTo(...P[0]);
  for (let i = 1; i < P.length - 1; i++) ctx.quadraticCurveTo(P[i][0], P[i][1], (P[i][0] + P[i + 1][0]) / 2, (P[i][1] + P[i + 1][1]) / 2);
  ctx.lineTo(...P[P.length - 1]);
  ctx.closePath();
  ctx.fill();
  pose.f.forEach(([pts, w0, w1]) => finger(pts, w0, w1));
}

// Per-frame thermal hand (pose changes every frame, so no cache).
function thermalHand(pose) {
  const w = 800;
  const h = 860;
  const c = createCanvas(w, h);
  const x = c.getContext('2d');
  x.fillStyle = '#fff';
  handShape(x, pose);
  x.globalCompositeOperation = 'source-in';
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#ff7a24');
  g.addColorStop(0.45, '#ff9a34');
  g.addColorStop(0.8, '#ffb442');
  g.addColorStop(1, '#ffc650');
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  x.globalCompositeOperation = 'source-atop';
  // lit left side (cream-yellow) vs deep red shadow side on the right
  const r = x.createLinearGradient(270, 0, 700, 0);
  r.addColorStop(0, 'rgba(255,236,190,0.9)');
  r.addColorStop(0.2, 'rgba(255,240,192,0.85)');
  r.addColorStop(0.38, 'rgba(255,214,140,0.45)');
  r.addColorStop(0.65, 'rgba(255,110,30,0.15)');
  r.addColorStop(0.74, 'rgba(200,36,14,0.65)');
  r.addColorStop(1, 'rgba(170,36,16,0.85)');
  x.fillStyle = r;
  x.fillRect(0, 0, w, h);
  // warm palm highlight
  const ph = x.createRadialGradient(470, 480, 0, 470, 480, 150);
  ph.addColorStop(0, 'rgba(255,214,110,0.55)');
  ph.addColorStop(1, 'rgba(255,214,110,0)');
  x.fillStyle = ph;
  x.fillRect(0, 0, w, h);
  const s = createCanvas(w, h);
  const sx = s.getContext('2d');
  sx.filter = 'blur(2.5px)';
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
      g.addColorStop(0, '#f6a83a');
      g.addColorStop(0.28, '#f29230');
      g.addColorStop(0.5, '#ee7a24');
      g.addColorStop(0.66, '#f0862a');
      g.addColorStop(0.78, '#f7b04a');
      g.addColorStop(0.88, '#fde2a0');
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
      const crown = x.createLinearGradient(0, 0, 0, 300);
      crown.addColorStop(0, 'rgba(255,200,84,0.7)');
      crown.addColorStop(0.55, 'rgba(255,196,80,0.3)');
      crown.addColorStop(1, 'rgba(255,196,80,0)');
      x.fillStyle = crown;
      x.fillRect(0, 0, w, 300);
      // white/pink shirt on the shoulders
      x.fillStyle = 'rgba(240,216,216,0.95)';
      x.beginPath();
      x.moveTo(200, 940);
      x.bezierCurveTo(250, 780, 360, 720, 480, 712);
      x.bezierCurveTo(580, 712, 650, 790, 700, 940);
      x.closePath();
      x.filter = 'blur(10px)';
      x.fill();
      x.filter = 'none';
      // red edge burn around the outline
      x.globalCompositeOperation = 'source-atop';
      x.strokeStyle = 'rgba(200,40,16,0.45)';
      x.lineWidth = 16;
      x.filter = 'blur(8px)';
      headPath(x);
      x.stroke();
      x.filter = 'none';
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
