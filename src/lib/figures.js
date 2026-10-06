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
  const n = 26;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const a = Math.PI * (1.08 + u * 1.02);
    const rx = 240;
    const ry = 195;
    const bump = 1 + Math.abs(noise1(u * 14, seed)) * 0.13 + (r() - 0.5) * 0.04;
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

// Hand reaching upward, fingers splayed like a claw; local = screen - (250,250).
function handShape(ctx) {
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
  // forearm + palm
  ctx.beginPath();
  ctx.moveTo(345, 860);
  ctx.bezierCurveTo(360, 760, 380, 680, 360, 590);
  ctx.bezierCurveTo(340, 510, 370, 440, 450, 420);
  ctx.bezierCurveTo(540, 405, 600, 460, 590, 540);
  ctx.bezierCurveTo(582, 620, 575, 700, 600, 860);
  ctx.closePath();
  ctx.fill();
  // thumb: out to the left
  finger([[400, 545], [300, 470], [215, 445]], 100, 58);
  // index: up and slightly left
  finger([[435, 455], [385, 310], [368, 150]], 88, 54);
  // middle: up-right, longest
  finger([[505, 440], [555, 290], [612, 135]], 88, 54);
  // ring: right
  finger([[550, 470], [630, 360], [700, 225]], 78, 50);
  // pinky
  finger([[575, 520], [635, 470], [685, 400]], 62, 40);
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
  else handShape(x);
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
      const b = x.createRadialGradient(470, 960, 30, 470, 960, 300);
      b.addColorStop(0, 'rgba(255,255,250,0.95)');
      b.addColorStop(1, 'rgba(255,230,160,0)');
      x.fillStyle = b;
      x.fillRect(0, 0, w, h);
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

module.exports = { headPath, handShape, thermal };
