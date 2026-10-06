// Original figure artwork: a head-and-shoulders profile and a reaching hand,
// rendered with a thermal-camera style gradient (or a flat backlit silhouette).
const { createCanvas } = require('@napi-rs/canvas');
const { rng, noise1, lerp } = require('./core');

// Profile facing left, in a 760x900 local box (top of hair at y≈0).
function headPath(ctx, seed = 3) {
  const P = [
    [120, 905], [160, 800], [200, 700], [215, 620], [205, 560], [175, 528], [130, 510],
    [105, 495], [98, 470], [90, 455], [95, 440], [82, 428], [75, 415], [85, 402], [78, 390],
    [62, 376], [40, 358], [34, 345], [52, 322], [70, 295], [78, 262], [74, 235], [90, 205], [105, 160],
  ];
  // messy hair crown, generated with noise so it reads as tousled
  const r = rng(seed);
  const hair = [];
  const n = 44;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const a = Math.PI * (1.08 + u * 1.02);
    const rx = 240;
    const ry = 195;
    const bump = 1 + Math.abs(noise1(u * 22, seed)) * 0.12 + (r() - 0.5) * 0.07 + (i % 3 === 0 ? 0.04 : 0);
    hair.push([335 + Math.cos(a) * rx * bump, 205 + Math.sin(a) * ry * bump]);
  }
  const back = [
    [575, 300], [565, 370], [540, 430], [505, 480], [490, 540], [500, 610], [545, 680],
    [640, 740], [730, 800], [770, 905],
  ];
  const pts = [...P, ...hair, ...back];
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
const POSES = {
  // thumb out left, four fingers bunched up and to the right
  open: {
    palm: [[408, 860], [418, 700], [425, 470], [440, 330], [520, 285], [650, 295], [700, 345], [660, 520], [595, 700], [573, 860]],
    f: [
      [[[460, 380], [375, 355], [305, 395]], 84, 56],
      [[[520, 320], [480, 240], [445, 165]], 56, 40],
      [[[580, 300], [590, 200], [590, 112]], 58, 40],
      [[[628, 315], [662, 225], [690, 135]], 54, 37],
      [[[662, 350], [698, 290], [720, 230]], 44, 32],
    ],
  },
  // fingers curling in, thumb sweeping forward
  curl: {
    palm: [[400, 860], [415, 700], [425, 470], [440, 330], [520, 290], [650, 300], [700, 350], [660, 520], [600, 700], [580, 860]],
    f: [
      [[[460, 360], [380, 300], [310, 270]], 82, 52],
      [[[525, 305], [520, 215], [495, 165]], 66, 46],
      [[[585, 300], [600, 205], [585, 150]], 66, 46],
      [[[635, 315], [655, 235], [640, 180]], 60, 42],
      [[[668, 350], [690, 285], [675, 245]], 50, 36],
    ],
  },
  // loose fist with the index pointing left
  fist: {
    palm: [[400, 860], [410, 700], [420, 470], [440, 340], [520, 300], [640, 310], [690, 360], [660, 520], [600, 700], [580, 860]],
    f: [
      [[[470, 380], [430, 360], [400, 340]], 78, 56],
      [[[520, 320], [420, 280], [320, 270]], 64, 44],
      [[[580, 320], [560, 270], [530, 290]], 66, 50],
      [[[630, 335], [615, 285], [590, 305]], 60, 46],
      [[[665, 370], [650, 320], [628, 340]], 50, 40],
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
  const r = x.createLinearGradient(240, 0, 720, 0);
  r.addColorStop(0, 'rgba(255,236,190,0.9)');
  r.addColorStop(0.35, 'rgba(255,214,140,0.45)');
  r.addColorStop(0.65, 'rgba(255,110,30,0.15)');
  r.addColorStop(0.85, 'rgba(200,36,14,0.6)');
  r.addColorStop(1, 'rgba(138,26,16,0.9)');
  x.fillStyle = r;
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
      g.addColorStop(0, '#ff8a26');
      g.addColorStop(0.25, '#ff5c16');
      g.addColorStop(0.5, '#ff3e10');
      g.addColorStop(0.64, '#ff4c12');
      g.addColorStop(0.76, '#ff801e');
      g.addColorStop(0.86, '#ffbc44');
      g.addColorStop(0.93, '#ffeaa6');
      g.addColorStop(1, '#fff9ef');
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
      const f = x.createLinearGradient(0, 0, 300, 0);
      f.addColorStop(0, 'rgba(225,30,12,0.55)');
      f.addColorStop(1, 'rgba(225,30,12,0)');
      x.fillStyle = f;
      x.fillRect(0, 0, w, 700);
      // white/pink shirt on the shoulders
      x.fillStyle = 'rgba(240,216,216,0.95)';
      x.beginPath();
      x.moveTo(250, 940);
      x.bezierCurveTo(300, 760, 420, 690, 560, 700);
      x.bezierCurveTo(660, 720, 740, 800, 800, 940);
      x.closePath();
      x.filter = 'blur(10px)';
      x.fill();
      x.filter = 'none';
      // red edge burn around the outline
      x.globalCompositeOperation = 'source-atop';
      x.strokeStyle = 'rgba(192,24,16,0.55)';
      x.lineWidth = 26;
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
  sx.filter = palette === 'heat' ? 'blur(3px)' : 'blur(1.2px)';
  sx.drawImage(c, 0, 0);
  cache[key] = s;
  return s;
}

module.exports = { headPath, handShape, thermal, thermalHand, blendPose, POSES };
