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
    const g = new Grid(38, 22);
    const body = '#f3f0e8';
    g.ellipse(7, 9, 6.5, 6.8, body);
    g.ellipse(31, 9, 6.5, 6.8, body);
    g.rect(7, 3, 24, 12, body);
    g.poly([[3, 12], [10, 12], [9, 19], [4, 18]], body);
    g.poly([[28, 12], [35, 12], [34, 18], [29, 19]], body);
    g.tint((x, y) => y > 14, '#d9d4c8');
    g.outline(OUT);
    // d-pad
    g.rect(5, 8, 7, 2, OUT);
    g.rect(7, 6, 2, 6, OUT);
    // select / start
    g.rect(15, 8, 3, 1, '#4a4a4a');
    g.rect(20, 8, 3, 1, '#4a4a4a');
    // face buttons
    g.rect(30, 5, 2, 2, '#e8c22a');
    g.rect(27, 8, 2, 2, '#3c62e8');
    g.rect(33, 8, 2, 2, '#e23a2c');
    g.rect(30, 11, 2, 2, '#3fb44a');
    return g;
  },
  cap() {
    const g = new Grid(32, 24);
    const c = '#f1eee4';
    g.fill((x, y) => y < 16 && ((x - 13) / 11.5) ** 2 + ((y - 16) / 13) ** 2 <= 1, c);
    // brim sweeping out to the right
    g.poly([[13, 14], [30, 13], [31, 17], [24, 21], [12, 18]], c);
    g.tint((x, y) => y > 16.5 && x > 12, '#cfc8b4');
    g.tint((x, y) => x < 6 && y > 9, '#d8d2c0');
    g.outline(OUT);
    // panel seams + button
    g.line(13, 4, 9, 15, '#b9b29c');
    g.line(17, 4, 19, 14, '#b9b29c');
    g.rect(14, 3, 2, 1, '#9f977f');
    g.tint((x, y) => x > 20 && x < 25 && y > 7 && y < 10, '#e4dfd0');
    return g;
  },
  cat() {
    const g = new Grid(30, 28);
    const k = '#121114';
    // body
    g.ellipse(13, 18, 9, 6, k);
    // head
    g.ellipse(21, 9, 6, 5.2, k);
    g.poly([[16, 6], [17, 0], [20, 4]], k);
    g.poly([[22, 4], [26, 0], [26, 6]], k);
    // legs
    g.rect(5, 20, 3, 7, k);
    g.rect(10, 21, 3, 6, k);
    g.rect(16, 21, 3, 6, k);
    g.rect(20, 19, 3, 8, k);
    // tail curling up
    g.line(5, 16, 2, 11, k);
    g.line(4, 16, 1, 11, k);
    g.line(1, 11, 2, 5, k);
    g.line(2, 11, 3, 5, k);
    g.line(3, 5, 5, 3, k);
    g.tint((x, y) => y < 14 && x > 8 && x < 18, '#26242a');
    // eyes
    g.px(19, 8, '#f2f0e6');
    g.px(23, 8, '#f2f0e6');
    return g;
  },
  camera() {
    const g = new Grid(34, 22);
    // top plate (silver)
    g.rect(2, 4, 30, 6, '#c9c9cb');
    g.rect(5, 2, 7, 2, '#b2b2b5');
    g.rect(22, 2, 6, 2, '#b2b2b5');
    // leatherette body
    g.rect(2, 10, 30, 10, '#2c2b2e');
    g.tint((x, y) => y > 18, '#1d1c1f');
    g.tint((x, y) => y < 6, '#e6e6e8');
    g.outline(OUT);
    // lens
    g.circle(17, 12.5, 7.2, OUT);
    g.circle(17, 12.5, 6.2, '#8d8d92');
    g.circle(17, 12.5, 4.6, '#2a2a30');
    g.circle(17, 12.5, 3, '#4c5468');
    g.rect(15, 10, 2, 2, '#9fb0c8');
    // viewfinder window + red dot
    g.rect(24, 5, 5, 3, '#3a3a40');
    g.rect(25, 5, 2, 1, '#8e9aa8');
    g.rect(6, 6, 2, 2, '#d8262e');
    return g;
  },
  book() {
    const g = new Grid(34, 24);
    // cover (top face, slanted)
    const cover = [[1, 9], [20, 1], [33, 7], [14, 16]];
    g.poly(cover, '#b8262c');
    // page block (front-right face)
    g.poly([[14, 16], [33, 7], [33, 13], [14, 22]], '#efe5cc');
    // spine (front-left face)
    g.poly([[1, 9], [14, 16], [14, 22], [1, 15]], '#8c1a20');
    g.outline(OUT);
    // label on cover
    g.poly([[9, 8], [18, 4], [24, 7], [15, 11]], '#86ab62');
    g.poly([[11, 8], [18, 5], [21, 7], [15, 10]], '#9cc072');
    // page lines and stickers
    for (let i = 0; i < 4; i++) g.line(16, 19 - i, 31, 12 - i, '#d8cba8');
    g.rect(24, 13, 2, 2, '#d23aa0');
    g.rect(28, 11, 2, 2, '#9ce04a');
    // bookmark band
    g.poly([[6, 12], [9, 13.5], [9, 19.5], [6, 18]], '#c99a6a');
    return g;
  },
  vinyl() {
    const g = new Grid(28, 28);
    g.circle(14, 14, 13, '#1a1c2a');
    g.circle(14, 14, 12, '#272a3e');
    // sheen wedges
    g.tint((x, y) => {
      const a = Math.atan2(y - 14, x - 14);
      const r = Math.hypot(x - 14, y - 14);
      return r > 5.5 && r < 11.5 && (Math.abs(a + 2.2) < 0.45 || Math.abs(a - 0.94) < 0.45);
    }, '#8a83a6');
    g.tint((x, y) => {
      const a = Math.atan2(y - 14, x - 14);
      const r = Math.hypot(x - 14, y - 14);
      return r > 6.5 && r < 10.5 && (Math.abs(a + 2.2) < 0.2 || Math.abs(a - 0.94) < 0.2);
    }, '#a9a2c4');
    g.circle(14, 14, 4.6, '#e0303c');
    g.circle(14, 14, 3.2, '#c4202c');
    g.rect(13, 13, 2, 2, '#f6e8ea');
    return g;
  },
  skateboard() {
    const g = new Grid(40, 14);
    g.ellipse(5, 5, 4.5, 3.6, '#2e2d33');
    g.ellipse(35, 5, 4.5, 3.6, '#2e2d33');
    g.rect(5, 2, 30, 6, '#2e2d33');
    g.tint((x, y) => y < 4, '#47464e');
    g.outline(OUT);
    g.rect(8, 9, 6, 1, '#8b8b90');
    g.rect(26, 9, 6, 1, '#8b8b90');
    g.rect(8, 10, 3, 3, '#d93a34');
    g.rect(29, 10, 3, 3, '#d93a34');
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
    const g = new Grid(28, 32);
    const leaf = (cx, cy, rx, ry, c) => g.ellipse(cx, cy, rx, ry, c);
    leaf(14, 9, 6, 7, '#3e8a3c');
    leaf(7, 12, 6, 4, '#3e8a3c');
    leaf(21, 12, 6, 4, '#3e8a3c');
    leaf(9, 6, 4, 4, '#4f9e42');
    leaf(19, 6, 4, 4, '#4f9e42');
    leaf(14, 3, 3, 3, '#5fb046');
    g.tint((x, y) => (x + y * 1.3) % 6 < 2, '#6fbe4e');
    g.tint((x, y) => (x * 1.7 + y) % 9 < 1.5 && y < 13, '#c9dc6a');
    // stems
    g.rect(13, 14, 2, 5, '#2e6a2e');
    // pot
    g.poly([[5, 18], [23, 18], [21, 30], [7, 30]], '#9dbbe6');
    g.rect(4, 17, 20, 3, '#c6dcf6');
    g.tint((x, y) => x > 16 && y > 20, '#7898cc');
    g.tint((x, y) => x < 9 && y > 20, '#b6d0f2');
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
