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
    // chunky classic pixel heart: dark-red border, flat red, one-tone orange highlight block
    const g = new Grid(15, 13);
    const c = '#d0121a';
    const rows = [[2, 5, 9, 12], [1, 6, 8, 13], [0, 14], [0, 14], [0, 14], [0, 14], [1, 13], [2, 12], [3, 11], [4, 10], [5, 9], [6, 8], [7, 7]];
    rows.forEach((r, y) => {
      for (let k = 0; k < r.length; k += 2) g.rect(r[k], y, r[k + 1] - r[k] + 1, 1, c);
    });
    const edge = [];
    for (let y = 0; y < 13; y++)
      for (let x = 0; x < 15; x++) if (g.get(x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !g.get(x + dx, y + dy))) edge.push([x, y]);
    edge.forEach(([x, y]) => g.px(x, y, '#a50d14'));
    g.rect(6, 2, 3, 1, '#a50d14');
    [[1, 1, 4], [0, 2, 5], [0, 3, 3], [0, 4, 2], [0, 5, 2]].forEach(([x, y, w]) => g.rect(x, y, w, 1, '#d9703a'));
    return g;
  },
  coin() {
    // upright gold coin: thick stepped black rim, flat gold, white highlight strip, slot lit top-left
    const g = new Grid(26, 30);
    g.ellipse(13, 15, 12.6, 14.6, OUT);
    g.ellipse(13, 15, 10.4, 12.5, '#e8b81c');
    // highlight strip down the left side
    g.tint((x, y) => x > 3.5 && x < 5.5 && y > 7 && y < 23, '#f6f2e6');
    // slot: white top and left edges, black right and bottom edges, gold inside
    g.rect(10, 6, 6, 18, '#e8b81c');
    g.rect(10, 6, 5, 2, '#f6f2e6');
    g.rect(10, 6, 2, 17, '#f6f2e6');
    g.rect(14, 8, 2, 16, OUT);
    g.rect(10, 22, 6, 2, OUT);
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
    // baseball cap, three-quarter view: domed crown on the right, brim reaching to the lower left
    const g = new Grid(32, 22);
    const c = '#f4f2ea';
    g.fill((x, y) => y < 16 && ((x - 19) / 11.5) ** 2 + ((y - 15.5) / 14) ** 2 <= 1, c);
    // brim, with a darker underside
    g.poly([[17, 12], [8, 13], [1, 18], [2, 20], [15, 19.5], [24, 16]], c);
    g.poly([[2, 19], [15, 18.5], [15, 20], [3, 21]], '#c9c5b6');
    g.tint((x, y) => y > 15.5 && y < 18.5 && x < 20, '#e2dfd2');
    g.tint((x, y) => x > 25 && y > 5, '#dedbcf');
    g.outline(OUT);
    // panel seams, crown button, sweatband line
    g.line(19, 2, 13, 13, '#bdb8a6');
    g.line(21, 2, 26, 13, '#bdb8a6');
    g.line(13, 14, 26, 14, '#cfcabb');
    g.rect(19, 1, 2, 1, OUT);
    return g;
  },

  cat() {
    // black cat: big square head with two ears and pale eye pixels, short body, legs, tail up behind
    const g = new Grid(30, 27);
    const k = '#121114';
    g.rect(1, 5, 15, 13, k); // head
    g.poly([[1, 6], [2, 0], [7, 5]], k); // ears
    g.poly([[10, 5], [15, 0], [16, 6]], k);
    g.rect(10, 11, 15, 9, k); // body
    g.ellipse(22, 15, 5, 5, k);
    g.rect(3, 17, 3, 9, k); // legs
    g.rect(8, 18, 3, 7, k);
    g.rect(17, 19, 3, 6, k);
    g.rect(22, 18, 3, 8, k);
    g.rect(25, 7, 2, 8, k); // tail up and over
    g.rect(26, 4, 2, 4, k);
    g.rect(27, 3, 2, 2, k);
    g.tint((x, y) => y < 5 && x < 17, '#24222a');
    g.rect(4, 9, 2, 2, '#b6b4bc'); // eyes
    g.rect(11, 9, 2, 2, '#b6b4bc');
    return g;
  },

  camera() {
    // rangefinder: silver top plate with knobs and windows, dark textured body, big knurled lens
    const g = new Grid(54, 37);
    // knobs on top
    g.rect(6, 1, 6, 3, '#8a8a90');
    g.rect(7, 1, 2, 1, '#cfcfd4');
    g.rect(15, 0, 7, 4, '#7c7c82');
    for (let i = 15; i < 22; i += 2) g.rect(i, 0, 1, 4, '#b8b8be');
    // silver top plate
    g.rect(2, 4, 50, 7, '#a9a9ae');
    g.rect(2, 4, 50, 1, '#cbcbd0');
    g.rect(3, 5, 1, 6, '#e2e2e6');
    g.rect(12, 5, 4, 6, '#8e8e94');
    for (let j = 5; j < 11; j += 2) g.rect(13 + (j % 4 === 1 ? 0 : 1), j, 1, 1, '#c4c4ca');
    g.rect(19, 6, 3, 3, '#8a1c24');
    g.rect(20, 7, 1, 1, '#c8303a');
    // rangefinder window
    g.rect(26, 5, 11, 4, '#5a5a62');
    g.rect(27, 6, 9, 1, '#d8d8de');
    g.rect(27, 7, 9, 1, '#7a6a5a');
    // viewfinder
    g.rect(41, 6, 8, 5, '#1c1c22');
    g.rect(44, 8, 3, 1, '#f2e8d0');
    g.rect(49, 5, 2, 6, '#d0d0d6');
    // body
    g.rect(2, 11, 50, 20, '#3d3d43');
    g.fill((x, y) => x > 3 && x < 15 && y > 12 && y < 30 && (Math.floor(x) + Math.floor(y)) % 2 === 0, '#323237');
    g.rect(2, 11, 50, 1, '#2a2a2f');
    g.rect(3, 12, 1, 18, '#8c8c92');
    g.rect(50, 12, 1, 18, '#7c7c82');
    // bottom rail
    g.rect(2, 31, 50, 3, '#8e8e94');
    g.rect(3, 32, 48, 1, '#c6c6cc');
    // strap lugs
    g.rect(0, 6, 2, 3, '#6a6a70');
    g.rect(52, 6, 2, 3, '#6a6a70');
    g.outline(OUT);
    // lens: solid concentric rings (light, dark, light), dark glass with an aperture glint and warm reflection
    const lx = 31;
    const ly = 21.5;
    g.circle(lx, ly, 13.4, '#2a2a30');
    g.circle(lx, ly, 12.6, '#9a9aa2');
    g.circle(lx, ly, 11.6, '#4a4a52');
    g.circle(lx, ly, 9.6, '#b4b4bc');
    g.circle(lx, ly, 8.8, '#2c2c33');
    g.circle(lx, ly, 6.4, '#8e8e98');
    g.circle(lx, ly, 5.6, '#1c1c22');
    g.rect(lx - 2, ly - 3, 4, 1, '#6c6c78');
    g.rect(lx - 3, ly - 2, 1, 3, '#55555f');
    g.rect(lx + 2, ly - 2, 1, 3, '#55555f');
    g.rect(lx - 2, ly + 2, 4, 2, '#b08a48');
    g.rect(lx - 1, ly + 2, 2, 1, '#d8b060');
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
    g.px(c, c, '#fbf2f2');
    g.px(c - 1, c, '#f0a8b0');
    g.px(c + 1, c, '#f0a8b0');
    g.px(c, c - 1, '#f0a8b0');
    g.px(c, c + 1, '#f0a8b0');
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
    // rounded leaf clumps (teal behind, green, lime in front) over a two-tone slate pot
    const g = new Grid(30, 31);
    [[15, 9, 6.5, 6.5], [7, 13, 6.5, 4.5], [23, 13, 6.5, 4.5]].forEach(([x, y, a, b]) => g.ellipse(x, y, a, b, '#1f7a64'));
    [[15, 8, 4.8, 5], [7, 12, 4.6, 3.2], [23, 12, 4.6, 3.2], [11, 15, 3.5, 2.5], [19, 15, 3.5, 2.5]].forEach(([x, y, a, b]) => g.ellipse(x, y, a, b, '#3c9a44'));
    [[14, 6, 3, 3], [6, 11, 3, 2], [22, 11, 3, 2]].forEach(([x, y, a, b]) => g.ellipse(x, y, a, b, '#6cc04a'));
    [[13, 4], [16, 7], [4, 10], [20, 10], [9, 13], [24, 12]].forEach(([x, y]) => g.rect(x, y, 2, 2, '#c8e070'));
    // dark gaps between the clumps, down to the stem
    g.line(15, 17, 10, 12, '#141c3a');
    g.line(15, 17, 20, 12, '#141c3a');
    g.rect(14, 13, 2, 5, '#141c3a');
    g.outline('#16503e');
    // pot: thick dark rim, white lip highlight, light left, shaded right
    g.poly([[7, 21], [23, 21], [21, 30], [9, 30]], '#c4d2ec');
    g.tint((x, y) => x > 16 && y > 20.5, '#8ea2cc');
    g.rect(6, 18, 18, 3, '#1c2040');
    g.rect(8, 21, 9, 1, '#eef2fa');
    g.outline('#14182e');
    return g;
  },

  cash() {
    // bill stack angled down to the right: green top with "$" on both halves, tan band, dark edges
    const g = new Grid(44, 28);
    // long axis runs from upper-left to lower-right
    const P = [[1, 9], [12, 2], [43, 19], [32, 25]];
    const top = P;
    // stack thickness below the two lower edges
    g.poly([[1, 9], [32, 25], [32, 28], [1, 12]], '#3f7a18');
    g.poly([[32, 25], [43, 19], [43, 22], [32, 28]], '#4a8a1c');
    g.poly(top, '#6fb22a');
    // inner lighter panels and darker border
    const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const inset = (t0, t1) => {
      const a = lerp(P[0], P[3], 0.18);
      const b = lerp(P[1], P[2], 0);
      const q = (t, side) => lerp(lerp(P[0], P[1], side), lerp(P[3], P[2], side), t);
      return [q(t0, 0.25), q(t0, 0.75), q(t1, 0.75), q(t1, 0.25)];
    };
    g.poly(inset(0.06, 0.4), '#86c834');
    g.poly(inset(0.62, 0.95), '#86c834');
    // tan band across the middle
    const band = [lerp(P[0], P[3], 0.44), lerp(P[1], P[2], 0.44), lerp(P[1], P[2], 0.58), lerp(P[0], P[3], 0.58)];
    g.poly(band, '#cdb898');
    const bs = [lerp(P[0], P[3], 0.44), lerp(P[0], P[3], 0.58)];
    g.poly([bs[0], bs[1], [bs[1][0], bs[1][1] + 3], [bs[0][0], bs[0][1] + 3]], '#a8957a');
    g.outline('#2c5414');
    const dollar = (x, y) => {
      const c = '#3e7a1c';
      g.rect(x, y, 3, 1, c);
      g.px(x, y + 1, c);
      g.rect(x, y + 2, 3, 1, c);
      g.px(x + 2, y + 3, c);
      g.rect(x, y + 4, 3, 1, c);
      g.px(x + 1, y - 1, c);
      g.px(x + 1, y + 5, c);
    };
    dollar(10, 8);
    dollar(31, 17);
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
