// Original figure artwork: a head-and-shoulders profile and a reaching hand,
// rendered with a thermal-camera style gradient (or a flat backlit silhouette).
const { createCanvas } = require('@napi-rs/canvas');
const { rng, noise1, lerp } = require('./core');

// Profile facing left, in a 760x900 local box (top of hair at y≈0).
function headPath(ctx, seed = 3) {
  // face: forehead, brow, nose, lips, chin, then a slender neck angled forward
  // profile tuned to measured proportions (local px; nose tip ~ (59,312), chin ~ (65,480))
  const face = [
    [128, 905], [168, 800], [190, 700], [205, 630], [200, 585], [189, 555], [150, 540],
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
    const quiff = u < 0.25 ? Math.sin((u / 0.25) * Math.PI) * 0.1 + Math.abs(noise1(u * 60, seed + 9)) * 0.06 : 0;
    const rx = u > 0.45 ? lerp(250, 228, Math.min(1, (u - 0.45) / 0.3)) : 250; // rounder, smaller back crown
    hair.push([330 + Math.cos(a) * rx * (1 + tuft + quiff), 222 + Math.sin(a) * 210 * (1 + tuft + quiff * 0.4)]);
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
const PALM = [[380, 830], [388, 700], [392, 600], [396, 500], [415, 410], [455, 365], [515, 352], [580, 355], [612, 385], [608, 460], [575, 540], [556, 600], [552, 700], [560, 830]];
const POSES = {
  // natural spread: thumb low and left, index diagonal up-left, middle up, ring up-right
  open: {
    palm: PALM,
    f: [
      [[[440, 470], [360, 455], [282, 440]], 66, 50],
      [[[455, 350], [370, 290], [295, 240]], 64, 44],
      [[[525, 325], [526, 220], [512, 118]], 66, 47],
      [[[580, 335], [650, 245], [705, 165]], 59, 43],
      [[[592, 395], [615, 372], [628, 350]], 40, 30],
    ],
  },
  // fingers curling in
  curl: {
    palm: PALM,
    f: [
      [[[430, 450], [370, 445], [312, 452]], 68, 47],
      [[[455, 350], [400, 296], [352, 306]], 64, 47],
      [[[525, 325], [520, 230], [488, 150]], 66, 50],
      [[[580, 330], [622, 258], [650, 220]], 59, 44],
      [[[595, 390], [626, 360], [642, 332]], 47, 37],
    ],
  },
  // loose fist with the index pointing left
  fist: {
    palm: PALM,
    f: [
      [[[430, 460], [402, 432], [382, 420]], 70, 54],
      [[[455, 360], [410, 336], [370, 326]], 56, 42],
      [[[525, 340], [500, 300], [470, 330]], 70, 57],
      [[[580, 350], [560, 300], [530, 330]], 66, 54],
      [[[595, 400], [580, 360], [555, 380]], 54, 44],
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
  g.addColorStop(0, '#f26422');
  g.addColorStop(0.45, '#f6862e');
  g.addColorStop(0.8, '#ffb442');
  g.addColorStop(1, '#ffc650');
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  x.globalCompositeOperation = 'source-atop';
  // lit left side (cream-yellow) vs deep red shadow side on the right
  const r = x.createLinearGradient(270, 0, 700, 0);
  r.addColorStop(0, 'rgba(255,240,192,0.8)');
  r.addColorStop(0.16, 'rgba(250,196,110,0.4)');
  r.addColorStop(0.34, 'rgba(240,120,40,0.12)');
  r.addColorStop(0.65, 'rgba(255,110,30,0.15)');
  r.addColorStop(0.74, 'rgba(200,36,14,0.65)');
  r.addColorStop(1, 'rgba(170,36,16,0.85)');
  x.fillStyle = r;
  x.fillRect(0, 0, w, h);
  // dark separations between adjacent finger bases
  x.save();
  x.globalCompositeOperation = 'source-atop';
  x.strokeStyle = 'rgba(130,24,10,0.55)';
  x.lineCap = 'round';
  x.lineWidth = 12;
  x.filter = 'blur(3px)';
  for (let i = 1; i < pose.f.length - 1; i++) {
    const a0 = pose.f[i][0][0];
    const b0 = pose.f[i + 1][0][0];
    const mx = (a0[0] + b0[0]) / 2;
    const my = (a0[1] + b0[1]) / 2;
    x.beginPath();
    x.moveTo(mx, my + 25);
    x.lineTo(mx, my - 30);
    x.stroke();
  }
  x.restore();
  // warm palm highlight
  const ph = x.createRadialGradient(430, 560, 0, 430, 560, 130);
  ph.addColorStop(0, 'rgba(255,240,192,0.5)');
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
      g.addColorStop(0.22, '#ef8a2c');
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
      const crown = x.createLinearGradient(0, 0, 0, 300);
      crown.addColorStop(0, 'rgba(255,200,84,0.7)');
      crown.addColorStop(0.55, 'rgba(255,196,80,0.3)');
      crown.addColorStop(1, 'rgba(255,196,80,0)');
      x.fillStyle = crown;
      x.fillRect(0, 0, w, 300);
      // white/pink shirt on the shoulders
      const shirt = x.createLinearGradient(0, 700, 0, 940);
      shirt.addColorStop(0, 'rgba(255,216,96,0.0)');
      shirt.addColorStop(0.3, 'rgba(255,232,170,0.8)');
      shirt.addColorStop(1, 'rgba(252,250,246,1)');
      x.fillStyle = shirt;
      x.beginPath();
      x.moveTo(200, 940);
      x.bezierCurveTo(250, 780, 360, 720, 480, 712);
      x.bezierCurveTo(580, 712, 650, 790, 700, 940);
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
      x.strokeStyle = 'rgba(196,40,16,0.85)';
      x.lineWidth = 46;
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
