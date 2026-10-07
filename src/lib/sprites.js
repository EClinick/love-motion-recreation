// Original pixel-art icons, rasterised on an integer grid so every edge is crisp.
// Each sprite is built from simple primitives (rects, ellipses, polygons) and then
// given an optional 1px outline, the same way a pixel artist would block them in.
const { createCanvas } = require('@napi-rs/canvas');
const { state } = require('./core');

class Grid {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.d = new Array(w * h).fill(null);
  }
  px(x, y, c) {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.d[y * this.w + x] = c;
  }
  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    return this.d[y * this.w + x];
  }
  rect(x, y, w, h, c) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.px(i, j, c);
  }
  // fill pixels whose centre satisfies the predicate
  fill(pred, c) {
    for (let j = 0; j < this.h; j++)
      for (let i = 0; i < this.w; i++) if (pred(i + 0.5, j + 0.5)) this.px(i, j, c);
  }
  ellipse(cx, cy, rx, ry, c) {
    this.fill((x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1, c);
  }
  circle(cx, cy, r, c) {
    this.ellipse(cx, cy, r, r, c);
  }
  poly(pts, c) {
    this.fill((x, y) => {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    }, c);
  }
  line(x0, y0, x1, y1, c) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 + 1;
    for (let i = 0; i <= n; i++) this.px(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c);
  }
  // recolor only already-filled pixels matching the predicate
  tint(pred, c) {
    for (let j = 0; j < this.h; j++)
      for (let i = 0; i < this.w; i++) if (this.d[j * this.w + i] && pred(i + 0.5, j + 0.5)) this.d[j * this.w + i] = c;
  }
  outline(c, diag = false) {
    const add = [];
    for (let j = 0; j < this.h; j++)
      for (let i = 0; i < this.w; i++) {
        if (this.get(i, j)) continue;
        const n = [this.get(i - 1, j), this.get(i + 1, j), this.get(i, j - 1), this.get(i, j + 1)];
        if (diag) n.push(this.get(i - 1, j - 1), this.get(i + 1, j + 1), this.get(i + 1, j - 1), this.get(i - 1, j + 1));
        if (n.some((v) => v && v !== c)) add.push([i, j]);
      }
    add.forEach(([i, j]) => this.px(i, j, c));
  }
  // inner edge shading: pixels on the bottom/right border get a darker tone
  edgeShade(from, to, dirs = [[1, 0], [0, 1]]) {
    const hits = [];
    for (let j = 0; j < this.h; j++)
      for (let i = 0; i < this.w; i++) {
        if (this.get(i, j) !== from) continue;
        if (dirs.some(([dx, dy]) => this.get(i + dx, j + dy) !== from && this.get(i + dx, j + dy) !== to)) hits.push([i, j]);
      }
    hits.forEach(([i, j]) => this.px(i, j, to));
  }
  toCanvas() {
    const cv = createCanvas(this.w, this.h);
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(this.w, this.h);
    for (let k = 0; k < this.d.length; k++) {
      const c = this.d[k];
      if (!c) continue;
      const n = parseInt(c.slice(1), 16);
      img.data[k * 4] = (n >> 16) & 255;
      img.data[k * 4 + 1] = (n >> 8) & 255;
      img.data[k * 4 + 2] = n & 255;
      img.data[k * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }
}

const OUT = '#141218';

const builders = {
  heart() {
    const g = new Grid(26, 23);
    const c = '#e1151c';
    g.circle(7, 7.2, 6.4, c);
    g.circle(19, 7.2, 6.4, c);
    g.poly([[0.8, 8.5], [25.2, 8.5], [13, 21.5]], c);
    g.rect(7, 3, 12, 8, c);
    g.edgeShade(c, '#b50d16', [[1, 0], [0, 1], [1, 1]]);
    // salmon highlight block on the upper-left lobe
    g.tint((x, y) => x > 1.5 && x < 10 && y > 1.5 && y < 9 && x + y < 15, '#f06a3c');
    g.tint((x, y) => x > 3 && x < 7 && y > 2.5 && y < 5.5, '#f68a4a');
    return g;
  },
  coin() {
    const g = new Grid(24, 30);
    g.ellipse(12, 15, 10.2, 13.6, OUT);
    g.ellipse(12, 15, 8.4, 11.8, '#f4c21c');
    g.tint((x, y) => x > 15.5, '#d99a0c');
    g.tint((x, y) => x < 7 && y < 18, '#fbe07a');
    // vertical slot
    g.rect(9, 6, 5, 18, OUT);
    g.rect(10, 7, 3, 16, '#fff7d8');
    g.rect(12, 7, 1, 16, '#e8d79a');
    return g;
  },
  controller() {
    // chunky gamepad: two round lobes, grips hanging below, d-pad and a diamond of buttons
    const g = new Grid(31, 18);
    const body = '#f2f1ec';
    g.ellipse(8, 7, 7.5, 6.5, body);
    g.ellipse(23, 7, 7.5, 6.5, body);
    g.rect(8, 1, 15, 11, body);
    g.poly([[1, 8], [11, 9], [9, 17], [3, 16]], body);
    g.poly([[20, 9], [30, 8], [28, 16], [22, 17]], body);
    g.tint((x, y) => y > 11.5, '#d8d6d0');
    g.tint((x, y) => y > 9.5 && y < 11.5 && x > 10 && x < 21, '#e2e0da');
    g.outline(OUT);
    // d-pad
    g.rect(4, 6, 8, 2, OUT);
    g.rect(7, 3, 2, 8, OUT);
    // select / start
    g.rect(13, 6, 2, 1, OUT);
    g.rect(17, 6, 2, 1, OUT);
    // face buttons: blue top, green left, red right, yellow bottom
    g.rect(22, 2, 2, 2, '#3aa7e0');
    g.rect(20, 5, 2, 2, '#43b648');
    g.rect(25, 5, 2, 2, '#e3282c');
    g.rect(22, 8, 2, 2, '#f0d81e');
    return g;
  },

  cap() {
    // baseball cap in side view: round crown on the right, long brim reaching left
    const g = new Grid(32, 22);
    const c = '#f6f4ec';
    g.fill((x, y) => y < 15.5 && ((x - 19) / 11) ** 2 + ((y - 15) / 13.5) ** 2 <= 1, c);
    g.poly([[16, 12], [9, 13], [1, 18], [3, 20], [14, 19], [23, 16]], c);
    g.tint((x, y) => y > 15.5 && x < 20, '#e3e0d4');
    g.tint((x, y) => y > 18 && x < 15, '#d2cebf');
    g.tint((x, y) => x > 25 && y > 6, '#e6e3d8');
    g.outline(OUT);
    // panel seams + button
    g.line(19, 2, 14, 13, '#c4bfae');
    g.line(21, 2, 25, 13, '#c4bfae');
    g.rect(19, 1, 2, 1, '#a59f8a');
    return g;
  },

  cat() {
    // blocky black cat: big square head with tall white eyes, short legs
    const g = new Grid(28, 28);
    const k = '#121114';
    g.rect(4, 5, 17, 12, k);
    g.poly([[4, 6], [5, 0], [10, 5]], k);
    g.poly([[15, 5], [20, 0], [21, 6]], k);
    g.ellipse(15, 19, 11, 6, k);
    g.rect(5, 21, 4, 6, k);
    g.rect(11, 22, 3, 5, k);
    g.rect(17, 22, 3, 5, k);
    g.rect(22, 20, 4, 7, k);
    // short tail up at the back
    g.rect(24, 10, 2, 8, k);
    g.rect(25, 8, 2, 3, k);
    g.tint((x, y) => y < 4 && (x < 8 || x > 17), '#2a282e');
    // eyes
    g.rect(8, 9, 2, 3, '#f2f0e6');
    g.rect(15, 9, 2, 3, '#f2f0e6');
    return g;
  },

  camera() {
    const g = new Grid(34, 25);
    // silver top plate
    g.rect(2, 5, 30, 6, '#a4a4a8');
    g.rect(5, 2, 7, 3, '#8e8e93');
    g.rect(22, 3, 6, 2, '#8e8e93');
    // black leatherette body (taller)
    g.rect(2, 11, 30, 12, '#2a2b2e');
    g.tint((x, y) => y > 21, '#1b1c1e');
    g.tint((x, y) => y < 7, '#c8c8cc');
    g.tint((x, y) => y > 11 && y < 13, '#3a3b3f');
    g.outline(OUT);
    // lens
    g.circle(17, 14.5, 7.6, OUT);
    g.circle(17, 14.5, 6.6, '#8d8d92');
    g.circle(17, 14.5, 5.4, '#5e5e64');
    g.circle(17, 14.5, 4.2, '#24242a');
    g.circle(17, 14.5, 2.6, '#40485a');
    g.rect(15, 12, 2, 2, '#a8b8d0');
    // viewfinder window + red dot + shutter
    g.rect(24, 6, 5, 3, '#2e2e34');
    g.rect(25, 6, 2, 1, '#8e9aa8');
    g.rect(6, 7, 2, 2, '#c8262e');
    g.rect(7, 3, 3, 1, '#d8d8dc');
    return g;
  },
  book() {
    const g = new Grid(34, 21);
    // cover (top face, slanted)
    const cover = [[1, 9], [20, 1], [33, 7], [14, 16]];
    g.poly(cover, '#9e2228');
    g.tint((x, y) => x + y * 2 < 24, '#b02a2e');
    // page block (front-right face)
    g.poly([[14, 16], [33, 7], [33, 11], [14, 20]], '#efe5cc');
    // spine (front-left face)
    g.poly([[1, 9], [14, 16], [14, 20], [1, 13]], '#7a161c');
    g.outline(OUT);
    // label on cover
    g.poly([[9, 8], [18, 4], [24, 7], [15, 11]], '#86ab62');
    g.poly([[11, 8], [18, 5], [21, 7], [15, 10]], '#9cc072');
    // page lines and stickers
    for (let i = 0; i < 2; i++) g.line(16, 18 - i, 31, 11 - i, '#d8cba8');
    g.rect(24, 12, 2, 2, '#d23aa0');
    g.rect(28, 10, 2, 2, '#9ce04a');
    // bookmark band
    g.poly([[6, 12], [9, 13.5], [9, 17.5], [6, 16]], '#c99a6a');
    return g;
  },
  vinyl() {
    const g = new Grid(40, 40);
    const c = 20;
    g.circle(c, c, 18.6, '#1c1e24');
    g.circle(c, c, 17.2, '#2c3038');
    // smooth curved sheen wedges, upper-left and lower-right
    const wedge = (lo, hi, a0, half, col) =>
      g.tint((x, y) => {
        const a = Math.atan2(y - c, x - c);
        const r = Math.hypot(x - c, y - c);
        const d = Math.abs(Math.atan2(Math.sin(a - a0), Math.cos(a - a0)));
        return r > lo && r < hi && d < half;
      }, col);
    [-2.3, 0.84].forEach((a0) => {
      wedge(7.5, 16.5, a0, 0.36, '#7c7488');
      wedge(9, 15, a0, 0.2, '#968fa6');
    });
    g.circle(c, c, 6.4, '#e0303c');
    g.circle(c, c, 4.4, '#cc2430');
    g.px(c, c, '#f6e8ea');
    g.px(c - 1, c, '#f6e8ea');
    g.px(c, c - 1, '#f6e8ea');
    return g;
  },
  skateboard() {
    // deck seen from three-quarters above: dark grip with bolts, wooden side edge, red wheels
    const g = new Grid(40, 17);
    const grip = '#30343c';
    g.ellipse(6, 6.5, 5.5, 5.5, grip);
    g.ellipse(34, 6.5, 5.5, 5.5, grip);
    g.rect(6, 1, 28, 11, grip);
    g.tint((x, y) => y < 3.5, '#3c414b');
    g.poly([[2, 10], [38, 10], [36, 13], [4, 13]], '#cbbd94');
    g.tint((x, y) => y > 12, '#a8986e');
    g.outline(OUT);
    [[8, 4], [11, 6], [8, 8], [29, 4], [32, 6], [29, 8]].forEach(([x, y]) => g.rect(x, y, 2, 2, '#8e9098'));
    g.rect(6, 14, 5, 3, '#d93a34');
    g.rect(29, 14, 5, 3, '#d93a34');
    return g;
  },

  clapper() {
    const g = new Grid(32, 30);
    // board body
    g.rect(2, 12, 28, 16, '#262c86');
    g.rect(4, 15, 24, 1, '#5560c8');
    g.rect(4, 20, 24, 1, '#5560c8');
    g.rect(4, 15, 1, 11, '#5560c8');
    g.rect(16, 21, 1, 5, '#5560c8');
    // bottom stripe band
    g.rect(2, 9, 28, 3, '#f2f2f6');
    // hinged clapper stick (tilted)
    g.poly([[2, 9], [27, 1], [28, 5], [3, 12]], '#f2f2f6');
    g.outline(OUT);
    // diagonal stripes on the hinged stick and the lower band
    g.tint((x, y) => y < 12.5 && Math.floor((x + (12 - y) * 0.9) / 3) % 2 === 0, '#3a4ed6');
    g.rect(5, 23, 3, 2, '#e8873a');
    return g;
  },
  plant() {
    // leafy pothos in a slate pot
    const g = new Grid(28, 31);
    const leaf = (cx, cy, a, L, w, c) => {
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      g.poly([[cx + dx * L, cy + dy * L], [cx - dy * w, cy + dx * w], [cx - dx * L * 0.5, cy - dy * L * 0.5], [cx + dy * w, cy - dx * w]], c);
    };
    const d2 = Math.PI / 180;
    g.ellipse(14, 11, 8, 5, '#24583c');
    leaf(14, 9, -90 * d2, 7, 4.5, '#3f8a46');
    leaf(5, 13, 195 * d2, 5, 3, '#2f6e4a');
    leaf(23, 13, -15 * d2, 5, 3, '#2f6e4a');
    leaf(8, 9, 215 * d2, 6, 3.5, '#3f8a46');
    leaf(20, 9, -35 * d2, 6, 3.5, '#3f8a46');
    leaf(11, 6, 245 * d2, 6, 3.5, '#4f9e48');
    leaf(17, 6, -65 * d2, 6, 3.5, '#4f9e48');
    leaf(14, 5, -90 * d2, 5, 3, '#5aac4c');
    leaf(10, 12, 200 * d2, 4, 2.5, '#2a6040');
    leaf(18, 12, -20 * d2, 4, 2.5, '#2a6040');
    g.tint((x, y) => (x * 1.3 + y * 0.7) % 5 < 1.2 && y < 14, '#9fcb5a');
    g.tint((x, y) => (x * 0.9 + y * 1.7) % 11 < 1.1 && y < 12, '#d4e070');
    g.rect(13, 13, 2, 5, '#1e4a34');
    // pot
    g.poly([[6, 18], [22, 18], [20, 30], [8, 30]], '#8ea2c8');
    g.rect(5, 17, 18, 3, '#c8d2ea');
    g.tint((x, y) => x > 16 && y > 20, '#6f84ac');
    g.tint((x, y) => x < 10 && y > 20, '#b4c4e2');
    g.outline('#1b2240');
    return g;
  },

  cash() {
    const g = new Grid(40, 26);
    // isometric bill stack
    const top = [[1, 10], [24, 1], [39, 9], [16, 19]];
    g.poly(top, '#6ab43c');
    g.poly([[1, 10], [16, 19], [16, 24], [1, 15]], '#3c7a28');
    g.poly([[16, 19], [39, 9], [39, 14], [16, 24]], '#4d9330');
    g.outline('#1e3a14');
    // stacked edges
    for (let i = 0; i < 3; i++) {
      g.line(2, 12 + i * 1.3, 15, 20 + i * 1.3, '#8fcf5a');
      g.line(17, 21 + i * 1.3, 38, 11 + i * 1.3, '#9ad866');
    }
    // band
    g.poly([[11, 6], [16, 4], [31, 12], [26, 15]], '#d6c7a2');
    g.poly([[26, 15], [31, 12], [31, 17], [26, 20]], '#b8a982');
    // $ glyphs on the top bill
    const dollar = (x, y) => {
      g.rect(x, y, 3, 1, '#3d7d26');
      g.px(x, y + 1, '#3d7d26');
      g.rect(x, y + 2, 3, 1, '#3d7d26');
      g.px(x + 2, y + 3, '#3d7d26');
      g.rect(x, y + 4, 3, 1, '#3d7d26');
      g.px(x + 1, y - 1, '#3d7d26');
      g.px(x + 1, y + 5, '#3d7d26');
    };
    dollar(7, 7);
    dollar(30, 6);
    return g;
  },
};

const cache = {};
function sprite(name) {
  if (!cache[name]) cache[name] = builders[name]().toCanvas();
  return cache[name];
}

// Draw a sprite centred at (x,y) with a given on-screen width (in px) and rotation.
function drawSprite(ctx, name, x, y, width, rot = 0, alpha = 1, opts = {}) {
  const s = sprite(name);
  const scale = width / s.width;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(x, y);
  ctx.rotate(rot);
  if (opts.sx || opts.sy) ctx.scale(opts.sx ?? 1, opts.sy ?? 1);
  if (opts.skew) ctx.transform(1, opts.skew[1] || 0, opts.skew[0] || 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  if (opts.shadow) {
    ctx.shadowColor = opts.shadow;
    ctx.shadowBlur = (opts.shadowBlur ?? 30) * state.S;
    ctx.shadowOffsetY = (opts.shadowY ?? 0) * state.S;
  }
  if (opts.silhouette) {
    // flat black silhouette version (used during the ink scatter)
    const t = silhouette(name, opts.silhouette);
    ctx.drawImage(t, (-s.width * scale) / 2, (-s.height * scale) / 2, s.width * scale, s.height * scale);
  } else {
    ctx.drawImage(s, (-s.width * scale) / 2, (-s.height * scale) / 2, s.width * scale, s.height * scale);
  }
  ctx.restore();
}

const silCache = {};
function silhouette(name, color) {
  const key = name + color;
  if (!silCache[key]) {
    const s = sprite(name);
    const c = createCanvas(s.width, s.height);
    const x = c.getContext('2d');
    x.drawImage(s, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color;
    x.fillRect(0, 0, s.width, s.height);
    silCache[key] = c;
  }
  return silCache[key];
}

const ICONS = Object.keys(builders);
module.exports = { sprite, drawSprite, ICONS, Grid };
