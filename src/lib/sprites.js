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

// Build a sprite from rows of palette letters ('.' = transparent), measured from the
// source's own pixel grid (frame 292, where all twelve icons sit apart).
function fromRows(pal, rows) {
  const g = new Grid(rows[0].length, rows.length);
  rows.forEach((r, y) => [...r].forEach((ch, x) => ch !== '.' && pal[ch] && g.px(x, y, pal[ch])));
  return g;
}

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
    // chunky upright coin: stepped black rim, white left highlight, slot lit top-left
    return fromRows({ K: '#201a1b', W: '#e6e8ea', Y: '#dcb51c' }, [
      '....KKKKKK....',
      '..KKKWWWKKKK..',
      '.KKWWYYYYYKK..',
      'KKWYYWWWKYYKK.',
      'KKWYYWYYKYYKK.',
      'KWYYYWYYKYYYKK',
      'KWYYYWYYKYYYKK',
      'KWYYYWYYKYYYKK',
      'KWYYYWYYKYYYKK',
      'KWYYYWYYKYYYKK',
      'KWYYYWYYKYYYKK',
      'KKWYYWYYKYYKK.',
      '.KWYYKKKKYYKK.',
      '.KKWYYYYYYKK..',
      '..KKKYYYKKKK..',
      '....KKKKKK....',
    ]);
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
    // baseball cap, three-quarter view: two crown panels split by a seam, brim to the lower left,
    // shaded side panel; no logo
    const g = new Grid(28, 27);
    const O = '#3a1e16';
    const front = [[16, 1], [11.8, 2.3], [8.5, 3.6], [6.6, 5.3], [4.9, 7.2], [3.6, 9.2], [2.6, 11.5], [2, 14], [6.6, 15.8], [11.8, 17.2], [16.4, 19], [17.6, 19.7], [17.4, 1.2]];
    const side = [[17.4, 1.2], [18, 2], [21.7, 4], [24.3, 6.2], [26, 8.6], [26.8, 11.2], [27, 14.5], [27, 23], [26.3, 23], [22.4, 21.7], [19.7, 20.4], [17.6, 19.7]];
    const brim = [[0.2, 15.5], [2, 14], [6.6, 15.8], [11.8, 17.2], [16.4, 19], [17.6, 19.7], [15.5, 21.7], [13.2, 23.7], [10.5, 26], [8.5, 26.8], [6.6, 26.5], [4.6, 24.7], [2.6, 21.7], [1, 18.4]];
    g.poly(brim, '#eceee4');
    g.tint((x, y) => y > 22, '#dfe2d4');
    g.poly(front, '#eef0e8');
    g.poly(side, '#e3e6d8');
    g.tint((x, y) => x > 19.5 && x < 23 && y > 7 && y < 14, '#d9dfc8');
    // soft shading along the bottom of the front panel and a speckled brim
    g.tint((x, y) => x < 17 && y > 12.5 && y < 19 && g.get(Math.floor(x), Math.floor(y)) === '#eef0e8' && y > 12.5 + (x - 2) * 0.25, '#dfe3d0');
    g.tint((x, y) => g.get(Math.floor(x), Math.floor(y)) === '#eceee4' && (Math.floor(x) * 3 + Math.floor(y) * 5) % 7 === 0, '#dde1cd');
    g.tint((x, y) => x > 19 && y > 15.8 && g.get(Math.floor(x), Math.floor(y)) === '#e3e6d8', '#b4aca4');
    g.tint((x, y) => x > 21 && y > 18 && g.get(Math.floor(x), Math.floor(y)) === '#b4aca4', '#8e8078');
    const path = (pts, close) => pts.forEach((p, i) => (i || close) && g.line(...(i ? pts[i - 1] : pts[pts.length - 1]), ...p, O));
    path(front.slice(0, 12), false);
    path(side.slice(1), false);
    path(brim.slice(6).concat([brim[0]]), false);
    g.line(17.4, 1.2, 17.6, 19.7, O); // seam
    g.rect(15, 0, 3, 1, O); // button
    g.px(16, 1, '#f6f6f2');
    return g;
  },

  cat() {
    // pouncing black cat: head and ears up at the right, body and front legs reaching down-left
    return fromRows({ K: '#1d1819', E: '#c4c8cc' }, [
      '.............KK......KK.',
      '............KKKK...KKKK.',
      '............KKKKKKKKKKK.',
      '............KKKKKKKKKKK.',
      '...........KKKKKKKKKKKK.',
      '...........KKKKKKKKKKKK.',
      '.......KKKKKKKKKEEKKKEK.',
      '......KKKKKKKKKKEEKKKEKK',
      '......KKKKKKKKKKEEKKKEKK',
      '.....KKKKKKKKKKKKKKKKKKK',
      '....KKKKKKKKKKKKKKKKKKKK',
      '....KKKKKKKKKKKKKKKKKKK.',
      '...KKKKKKKKKKKKKKKKKKK..',
      '...KKKKKKKKKKKKKKKKKKK..',
      '...KKKKKKKKKKKKKKKKKKKK.',
      '..KKKKKKKKKKKKKKKKKKKKK.',
      '.KKKKK...KKKKKKKKKKKKKKK',
      '.KKKKK....KKKKKKKKKKKK..',
      'KKKKK.....KKKKKKKKKKKK..',
      'KKKKK.....KKKKKKKK......',
      '.KKK......KKKKKKKK......',
      '.........KKKKKKK........',
      '..........KKKKKK........',
    ]);
  },

  camera() {
    // rangefinder: silver top plate with knobs and windows, dark textured body, big knurled lens
    const g = new Grid(54, 37);
    // knobs on top
    g.rect(6, 1, 6, 3, '#8a8a90');
    g.rect(7, 1, 2, 1, '#cfcfd4');
    g.rect(15, 0, 7, 4, '#7c7c82');
    for (let i = 15; i < 22; i += 2) g.rect(i, 0, 1, 4, '#b8b8be');
    // silver top plate (taller, as in the source)
    g.rect(2, 4, 50, 10, '#a9a9ae');
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
    g.rect(2, 14, 50, 17, '#3d3d43');
    g.fill((x, y) => x > 3 && x < 15 && y > 15 && y < 30 && (Math.floor(x) + Math.floor(y)) % 2 === 0, '#36363b');
    g.rect(2, 14, 50, 1, '#2a2a2f');
    g.rect(3, 15, 1, 15, '#8c8c92');
    g.rect(50, 15, 1, 15, '#7c7c82');
    // bottom rail
    g.rect(2, 31, 50, 3, '#8e8e94');
    g.rect(3, 32, 48, 1, '#c6c6cc');
    // strap lugs
    g.rect(0, 6, 2, 3, '#6a6a70');
    g.rect(52, 6, 2, 3, '#6a6a70');
    g.outline(OUT);
    // lens: a broad light barrel ring, a dark band, one thin light ring, dark glass with a soft
    // cross-shaped reflection (few rings, so it reads solid rather than stippled when small)
    const lx = 31;
    const ly = 22;
    g.circle(lx, ly, 13.4, '#26262c');
    g.circle(lx, ly, 12.5, '#9a9aa2');
    g.circle(lx, ly, 11.6, '#5e5e66');
    g.circle(lx, ly, 9.4, '#2a2a30');
    g.circle(lx, ly, 8.0, '#8a8a94');
    g.circle(lx, ly, 7.0, '#1c1c22');
    g.line(lx - 4, ly - 4, lx + 4, ly + 4, '#3c3c46');
    g.line(lx + 4, ly - 4, lx - 4, ly + 4, '#3c3c46');
    g.rect(lx - 2, ly + 3, 3, 1, '#9a7a48');
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
    // deck seen from above at an angle: dark grip with grey bolts, tan edge, red wheels
    return fromRows({ b: '#948e80', c: '#b81c2a', d: '#3c3b3b', e: '#333030', f: '#2c1815' }, [
      '...................ffeddddddbf',
      '.................ffeddbddddebf',
      '...............ffeddbedddddebf',
      '.............ffeddddddddbedebf',
      '...........ffeddddddddbddeeebf',
      '.........ffeedddddddddddeeebbf',
      '.......ffeeeedddddddddeeeebbf.',
      '.....ffdeeeeeeddddddeeeebbfff.',
      '.ffffeebeeeeeeeedddeeebbffccf.',
      'fffffeeeebeeeedeeeeebbfffcccf.',
      'fffffbfeeeeeeeeeeebbff..fcccf.',
      'fbfffffbffeeeeeebbff.....fff..',
      '.fbfffffffffeebbff............',
      '..fddddddbbbbbff..............',
      '...ffffffffffff...............',
      '.....fff..fcccf...............',
      '..........fcccf...............',
    ]);
  },

  clapper() {
    // striped hinged stick over a striped band and a navy slate ruled into cells
    return fromRows(
      { a: '#d3d5e1', b: '#4a46a3', d: '#8b8bc9', e: '#443867', f: '#28238b', g: '#272143', h: '#412422', O: '#e8a23a' },
    [
      '............aa.ahhhhabbbh.',
      '........aaaahehgbba.abbbh.',
      '....ahhheeed.adbbd.adbbbh.',
      'hhhhh.adbbda.dbbbd.adbbbah',
      'hbbdaadbbbda.dbbbd.adbbd.h',
      'hbbdaadbbba.adbbdaadbbbdah',
      'hfdaadbbbda.dbbbd..dbeeeeh',
      '.gda.dbbbd.adbbdahhgghhhh.',
      '.gbOOdbbbddeegghhdddd.....',
      '.hOOOggggggghaaaaaaaaaaaa.',
      '.hgggggggghhghhhhhhhhhhhhh',
      '.gehgbbbba.abbbb.aabbbd..h',
      '.gda.dbbbd.adbbbda.dbbbd.h',
      '.gbaaabbbbaaabbbbaaabbbbah',
      '.gfeaadfffeaadfffdaadfffah',
      '.gggbddeggedddeggedddgggbh',
      '.hggedddgggbddbgggdddggggh',
      '.hgggggggggggggggggggggggh',
      '.hgfffffffffffffffffffffgh',
      '.hgbggggggfggggggegggggggh',
      '.hgdggggggdggggggbgggggggh',
      '.hgdggggggdggggggbgggggggh',
      '.hgdggggggdgggggedgggggggh',
      '.hgdddddddddddddddddddddgh',
      '.hgdggggggggggggggggggggdh',
      '.hgdddddddddddddddddddddgh',
      '.hgggggggggggggggggggggggh',
      '.hhhhghhhhhhhhhhhhhhhhhhhh',
    ],
    );
  },
  plant() {
    // pointed leaf clusters around a dark core, on a slate pot with a dark rim and white lip
    return fromRows(
      { b: '#bdd07e', c: '#93a778', d: '#a7b5be', e: '#c4d3d8', f: '#2d574f', g: '#5b9344', h: '#17192f', j: '#291b29', l: '#7380a6', m: '#39231f', w: '#e8ecf0' },
    [
      '..........gggggf...',
      '.........gbgbcgf...',
      '.......fbbgggggf...',
      '......cfbgggggff...',
      'ecccc..fcggfffge...',
      'cgfgfecfcggfffgee..',
      'gggbgffffgghhhhff..',
      'ffggbgfhfgfhgcbbggg',
      'efgggggfhfhgbcfggf.',
      '..ffgfffhhffggffff.',
      '...ffgfffhfgffff...',
      '...cfffffhfffffc...',
      '...cfhhffhfhhhhc...',
      '...jhhhhhhhhhhhj...',
      '..jjjjjjjjjjjhhhj..',
      '..jwwwwwwwwwdlllj..',
      '..jlllllllllllllj..',
      '...jdeeeeeelllli...',
      '...jdeeeeedllllm...',
      '...jdeeeeelllllj...',
      '...mdeeeellllllm...',
      '....mdeeellllmm....',
      '....mddllllllm.....',
      '....mjjjjjjmm......',
    ],
    );
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
