// Procedural surface and cloth textures. Everything is drawn once at load from seeded
// noise, so a film looks the same on every machine and every seek.
// The GLB meshes carry box-projected UVs in studs (1 UV unit = 1 stud), so a texture's
// "tile" is simply how many studs one repeat covers.
import * as THREE from "three";

export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fr = (x) => x - Math.floor(x);
const ss = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
const hash2 = (i, j, seed) => mulberry32((i * 73856093) ^ (j * 19349663) ^ (seed * 83492791))();

/** tileable value noise: octaves is a list of [periodX, periodY] lattice sizes */
function fbm(seed, octaves) {
  const grids = octaves.map(([px, py], k) => {
    const r = mulberry32(seed * 131 + k), a = new Float32Array(px * py);
    for (let i = 0; i < a.length; i++) a[i] = r();
    return { px, py, a };
  });
  return (x, y) => {
    let v = 0, amp = 0.5, tot = 0;
    for (const { px, py, a } of grids) {
      const fx = fr(x) * px, fy = fr(y) * py;
      const x0 = Math.floor(fx) % px, y0 = Math.floor(fy) % py, x1 = (x0 + 1) % px, y1 = (y0 + 1) % py;
      let tx = fx - Math.floor(fx), ty = fy - Math.floor(fy);
      tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      const top = a[y0 * px + x0] + (a[y0 * px + x1] - a[y0 * px + x0]) * tx;
      const bot = a[y1 * px + x0] + (a[y1 * px + x1] - a[y1 * px + x0]) * tx;
      v += amp * (top + (bot - top) * ty); tot += amp; amp *= 0.5;
    }
    return v / tot;
  };
}
const sq = (p) => p.map((n) => [n, n]);

function finish(canvas, tile, srgb) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.flipY = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / tile, 1 / tile);
  t.anisotropy = 8;
  return t;
}

/**
 * One surface: height(x, y) in 0..1 gives the normal map, shade(x, y, h) gives a colour
 * multiplier (a number or [r, g, b], 1 = the material colour unchanged). x, y run 0..1 over the tile.
 */
function surface(size, tile, height, shade, bump = 2) {
  const H = new Float32Array(size * size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) H[j * size + i] = height(i / size, j / size);
  const mk = () => { const c = document.createElement("canvas"); c.width = c.height = size; return c; };
  const cn = mk(), ca = mk();
  const gn = cn.getContext("2d"), ga = ca.getContext("2d");
  const dn = gn.createImageData(size, size), da = ga.createImageData(size, size);
  const enc = (v) => 255 * Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.2);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const k = j * size + i, o = k * 4;
    const l = H[j * size + ((i + size - 1) % size)], r = H[j * size + ((i + 1) % size)];
    const u = H[((j + size - 1) % size) * size + i], d = H[((j + 1) % size) * size + i];
    let nx = (l - r) * bump, ny = (u - d) * bump;
    const inv = 1 / Math.hypot(nx, ny, 1);
    nx *= inv; ny *= inv;
    dn.data[o] = 127.5 + 127.5 * nx; dn.data[o + 1] = 127.5 + 127.5 * ny; dn.data[o + 2] = 127.5 + 127.5 * inv; dn.data[o + 3] = 255;
    const s = shade(i / size, j / size, H[k]);
    if (typeof s === "number") { da.data[o] = da.data[o + 1] = da.data[o + 2] = enc(s); }
    else { da.data[o] = enc(s[0]); da.data[o + 1] = enc(s[1]); da.data[o + 2] = enc(s[2]); }
    da.data[o + 3] = 255;
  }
  gn.putImageData(dn, 0, 0); ga.putImageData(da, 0, 0);
  return { map: finish(ca, tile, true), normalMap: finish(cn, tile, false) };
}

/** brick-like cells: returns [edge distance 0..0.5, row, column] with every other row shifted */
function cells(x, y, cols, rows, shift = 0.5) {
  const row = Math.floor(fr(y) * rows), fy = fr(y * rows);
  const xo = fr(x) * cols + (row % 2) * shift, col = Math.floor(xo) % cols, fx = fr(xo);
  const aspect = rows / cols; // cell width in units of its height
  return [Math.min(Math.min(fx, 1 - fx) / aspect, Math.min(fy, 1 - fy)), row, col, fx, fy];
}

const KINDS = {
  asphalt: () => {
    const n = fbm(1, sq([8, 16, 32, 64, 128])), g = fbm(2, sq([128, 256])), r = mulberry32(3);
    return surface(512, 10, (x, y) => 0.6 * n(x, y) + 0.4 * g(x, y),
      (x, y) => 0.8 + 0.3 * (n(x, y) - 0.5) + 0.22 * (g(x, y) - 0.5) + (r() > 0.988 ? 0.3 : 0), 2.4);
  },
  pavers: () => {
    const n = fbm(4, sq([16, 64, 128]));
    return surface(512, 6, (x, y) => { const [e] = cells(x, y, 4, 4, 0); return ss(0, 0.045, e) * (0.75 + 0.25 * n(x, y)); },
      (x, y) => { const [e, r, c] = cells(x, y, 4, 4, 0); return (0.84 + 0.14 * hash2(r, c, 5)) * (0.7 + 0.3 * ss(0, 0.035, e)) * (0.94 + 0.12 * n(x, y)); }, 3);
  },
  brick: () => {
    const n = fbm(6, sq([32, 64, 128]));
    return surface(512, 4.8, (x, y) => { const [e] = cells(x, y, 4, 8); return ss(0.03, 0.09, e) * (0.72 + 0.28 * n(x, y)); },
      (x, y) => { const [e, r, c] = cells(x, y, 4, 8); return e < 0.06 ? 0.98 : (0.76 + 0.2 * hash2(r, c, 7)) * (0.93 + 0.14 * n(x, y)); }, 3.2);
  },
  plaster: () => {
    const n = fbm(8, sq([4, 8, 32, 64, 128])), big = fbm(9, sq([2, 4]));
    return surface(512, 8, (x, y) => n(x, y), (x, y) => 0.88 + 0.1 * n(x, y) + 0.08 * (big(x, y) - 0.5), 1.6);
  },
  siding: () => {
    const g = fbm(10, [[4, 64], [8, 128]]);
    return surface(512, 4, (x, y) => 0.25 + 0.75 * fr(y * 6), (x, y) => (fr(y * 6) < 0.09 ? 0.68 : 0.9 + 0.1 * g(x, y)), 2.6);
  },
  shingles: () => {
    const n = fbm(11, sq([32, 64]));
    return surface(512, 4, (x, y) => { const [e, , , , fy] = cells(x, y, 6, 6); return ss(0, 0.06, e) * (0.35 + 0.65 * fy); },
      (x, y) => { const [e, r, c] = cells(x, y, 6, 6); return (0.74 + 0.24 * hash2(r, c, 12)) * (0.72 + 0.28 * ss(0, 0.05, e)) * (0.94 + 0.12 * n(x, y)); }, 3);
  },
  planks: () => { // boards run along u, six across the tile
    const g = fbm(13, [[3, 48], [6, 96], [12, 192]]);
    const edge = (x, y) => { const row = Math.floor(fr(y) * 6), fy = fr(y * 6), fx = fr(x + hash2(row, 0, 14)); return Math.min(Math.min(fy, 1 - fy), Math.min(fx, 1 - fx) * 6); };
    return surface(512, 8, (x, y) => ss(0, 0.05, edge(x, y)) * (0.8 + 0.2 * g(x, y)),
      (x, y) => (0.82 + 0.16 * hash2(Math.floor(fr(y) * 6), 1, 15)) * (0.7 + 0.3 * ss(0, 0.04, edge(x, y))) * (0.86 + 0.26 * g(x, y)), 2.4);
  },
  grain: () => { // vertical wood grain
    const g = fbm(16, [[32, 2], [64, 4], [128, 8]]);
    return surface(256, 3, (x, y) => g(x, y), (x, y) => 0.8 + 0.34 * g(x, y), 2);
  },
  grass: () => {
    const n = fbm(17, sq([4, 8, 16, 64, 128])), f = fbm(18, sq([128, 256])), m = fbm(19, sq([3, 6]));
    return surface(512, 9, (x, y) => 0.5 * n(x, y) + 0.5 * f(x, y),
      (x, y) => { const a = n(x, y), b = m(x, y), c = f(x, y); return [0.86 + 0.24 * b + 0.14 * (c - 0.5), 0.84 + 0.2 * a + 0.16 * (c - 0.5), 0.78 + 0.3 * (a - 0.3)]; }, 2.2);
  },
  leaves: () => {
    const n = fbm(20, sq([6, 12, 24, 48])), f = fbm(21, sq([48, 96]));
    return surface(256, 5, (x, y) => Math.abs(n(x, y) - 0.5) * 2 * 0.7 + 0.3 * f(x, y),
      (x, y) => [0.8 + 0.3 * n(x, y), 0.78 + 0.34 * n(x, y), 0.74 + 0.3 * f(x, y)], 2.6);
  },
  stone: () => {
    const n = fbm(22, sq([8, 32, 64, 128]));
    return surface(512, 6, (x, y) => { const [e] = cells(x, y, 2, 4); return ss(0.01, 0.06, e) * (0.6 + 0.4 * n(x, y)); },
      (x, y) => { const [e, r, c] = cells(x, y, 2, 4); return (0.82 + 0.16 * hash2(r, c, 23)) * (0.72 + 0.28 * ss(0.01, 0.05, e)) * (0.9 + 0.2 * n(x, y)); }, 3);
  },
  rock: () => {
    const n = fbm(24, sq([4, 8, 16, 32, 64, 128]));
    return surface(256, 7, (x, y) => Math.abs(n(x, y) - 0.5) * 2, (x, y) => 0.78 + 0.4 * n(x, y), 3);
  },
  fabric: () => { // plain weave
    const n = fbm(25, sq([32, 64]));
    const w = (x, y) => 0.5 + 0.5 * Math.sin(Math.PI * 2 * 28 * x) * Math.sin(Math.PI * 2 * 28 * y);
    return surface(256, 0.9, (x, y) => 0.7 * w(x, y) + 0.3 * n(x, y), (x, y) => 0.93 + 0.05 * w(x, y) + 0.04 * (n(x, y) - 0.5), 1.4);
  },
  knit: () => { // vertical ribs
    const n = fbm(26, sq([32, 64]));
    const rib = (x, y) => Math.abs(Math.sin(Math.PI * 12 * x)) * (0.8 + 0.2 * Math.sin(Math.PI * 2 * 40 * y));
    return surface(256, 1.2, rib, (x, y) => 0.88 + 0.12 * rib(x, y) + 0.04 * (n(x, y) - 0.5), 2);
  },
  denim: () => { // diagonal twill
    const n = fbm(27, sq([16, 64, 128]));
    const tw = (x, y) => 0.5 + 0.5 * Math.sin(Math.PI * 2 * 30 * (x + y));
    return surface(256, 0.8, (x, y) => 0.6 * tw(x, y) + 0.4 * n(x, y), (x, y) => 0.86 + 0.1 * tw(x, y) + 0.1 * (n(x, y) - 0.5), 1.6);
  },
  hair: () => { // strands running down
    const g = fbm(28, [[48, 3], [96, 6]]);
    return surface(256, 1.4, (x, y) => g(x, y), (x, y) => 0.92 + 0.12 * g(x, y), 2.4);
  },
  checker: () => { // two-tone floor tiles, 2x2 per tile repeat
    const n = fbm(31, sq([16, 64, 128]));
    return surface(512, 4, (x, y) => { const [e] = cells(x, y, 2, 2, 0); return ss(0, 0.03, e) * (0.85 + 0.15 * n(x, y)); },
      (x, y) => { const [e, r, c] = cells(x, y, 2, 2, 0); return ((r + c) % 2 ? 0.34 : 1.0) * (0.75 + 0.25 * ss(0, 0.025, e)) * (0.95 + 0.1 * n(x, y)); }, 2.4);
  },
  tiles: () => { // small glossy wall tiles
    const n = fbm(32, sq([32, 128]));
    return surface(512, 2, (x, y) => { const [e] = cells(x, y, 4, 8, 0); return ss(0, 0.06, e); },
      (x, y) => { const [e, r, c] = cells(x, y, 4, 8, 0); return e < 0.05 ? 0.78 : (0.92 + 0.08 * hash2(r, c, 33)) * (0.97 + 0.06 * n(x, y)); }, 2.4);
  },
  carpet: () => {
    const n = fbm(29, sq([64, 128])), r = mulberry32(30);
    return surface(256, 1.5, (x, y) => n(x, y), (x, y) => 0.86 + 0.14 * n(x, y) + 0.08 * (r() - 0.5), 2.4);
  },
};

const made = {};
const kind = (k) => (made[k] = made[k] || KINDS[k]());

// set and prop materials by glTF name: [kind, normal strength, roughness, metalness]
const SURFACES = {
  Road: ["asphalt", 0.9, 0.9], Sidewalk: ["pavers", 0.9, 0.86], Curb: ["plaster", 0.6, 0.9], Step: ["stone", 0.8, 0.9],
  Grass: ["grass", 0.9, 1], ForestGround: ["grass", 0.9, 1], Dirt: ["rock", 0.9, 1], Rock: ["rock", 1, 0.95],
  Wall0: ["brick", 0.9, 0.9], Wall3: ["brick", 0.9, 0.9], Wall6: ["brick", 0.9, 0.9], Chimney: ["brick", 0.9, 0.9],
  Wall1: ["plaster", 0.7, 0.92], Wall4: ["plaster", 0.7, 0.92], Wall7: ["plaster", 0.7, 0.92], RoomWall: ["plaster", 0.45, 0.95],
  Wall2: ["siding", 0.8, 0.85], Wall5: ["siding", 0.8, 0.85], HouseWall: ["siding", 0.8, 0.85],
  Roof: ["shingles", 1, 0.85], HouseRoof: ["shingles", 1, 0.85],
  Trunk: ["grain", 1, 0.9], PineTrunk: ["grain", 1, 0.95], Door: ["grain", 0.7, 0.6], HouseDoor: ["grain", 0.7, 0.55], RoomWood: ["grain", 0.7, 0.6],
  Leaf: ["leaves", 1, 0.95], Pine0: ["leaves", 1, 0.95], Pine1: ["leaves", 1, 0.95], Pine2: ["leaves", 1, 0.95],
  Stone: ["stone", 0.9, 0.85], RoomFloor: ["planks", 0.8, 0.55],
  Rug: ["carpet", 1, 1], Blanket: ["knit", 1, 0.95], Pillow: ["fabric", 0.8, 0.95], AwningRed: ["fabric", 0.8, 0.9], AwningWhite: ["fabric", 0.8, 0.9],
  // smooth surfaces: no texture, just better reflectance (they pick up the sky)
  Metal: [null, 0, 0.38, 0.75], Bumper: [null, 0, 0.3, 0.85], LampBase: [null, 0, 0.4, 0.7],
  Glass: [null, 0, 0.08, 0.2], HouseGlass: [null, 0, 0.08, 0.2], CarGlass: [null, 0, 0.06, 0.3],
  CarPaint: [null, 0, 0.24, 0.35], Tire: [null, 0, 0.85, 0], SaucerHull: [null, 0, 0.28, 0.7], ShipHull: [null, 0, 0.36, 0.6], ShipDome: [null, 0, 0.3, 0.6],
  Frame: [null, 0, 0.6, 0], TowerDark: [null, 0, 0.45, 0.3], Knob: [null, 0, 0.25, 0.9],
  // highway set and road-trip car cabin
  HighwayAsphalt: ["asphalt", 0.95, 0.9], HighwayShoulder: ["rock", 0.7, 0.95], DesertGround: ["rock", 0.55, 0.98],
  MesaRock: ["rock", 1.0, 0.95], RoadWood: ["grain", 0.9, 0.9], Cactus: ["leaves", 0.6, 0.85],
  SeatFabric: ["fabric", 0.75, 0.92], DashMat: ["plaster", 0.25, 0.78], Luggage: ["fabric", 0.7, 0.82],
  RoadCarPaint: [null, 0, 0.24, 0.35], RoadChrome: [null, 0, 0.22, 0.88],
  // home interior and cafe sets
  HomeFloor: ["planks", 0.8, 0.5], HomeWall: ["plaster", 0.35, 0.95], HomeWood: ["grain", 0.7, 0.55], HomeTile: ["tiles", 0.7, 0.3],
  Sofa: ["fabric", 0.9, 0.95], HomeRug: ["carpet", 1, 1], HomeLeaf: ["leaves", 0.8, 0.85], Cabinet: ["plaster", 0.15, 0.6],
  Counter: [null, 0, 0.25, 0.05], Appliance: [null, 0, 0.3, 0.55],
  CafeFloor: ["checker", 0.6, 0.45], CafeBrick: ["brick", 0.9, 0.92], CafeWood: ["grain", 0.8, 0.6], CafePlaster: ["plaster", 0.4, 0.95],
  CafeBoard: ["plaster", 0.2, 0.98],
  // scene kit (core/engine/kit.js): palette surfaces by texture kind
  KitPlanks: ["planks", 0.8, 0.5], KitPlaster: ["plaster", 0.35, 0.95], KitBrick: ["brick", 0.9, 0.92], KitGrain: ["grain", 0.7, 0.6],
  KitTiles: ["tiles", 0.6, 0.3], KitChecker: ["checker", 0.6, 0.45], KitCarpet: ["carpet", 1, 1], KitFabric: ["fabric", 0.9, 0.95],
  KitLeaf: ["leaves", 0.8, 0.85], KitGrass: ["grass", 0.9, 1], KitPavers: ["pavers", 0.9, 0.86], KitAsphalt: ["asphalt", 0.9, 0.9],
  KitStone: ["stone", 0.8, 0.88], KitRock: ["rock", 0.9, 0.95], KitSiding: ["siding", 0.8, 0.85], KitShingles: ["shingles", 1, 0.85],
  KitPolish: [null, 0, 0.25, 0.05], KitMetal: [null, 0, 0.32, 0.6],
};

/** give a set/prop material its texture, bump and reflectance (by glTF material name) */
export function dress(m) {
  const s = SURFACES[m.name];
  if (!s) return;
  const [k, bump, rough, metal = 0] = s;
  if (k) {
    const t = kind(k);
    m.map = t.map; m.normalMap = t.normalMap; m.normalScale.set(bump, bump);
  }
  m.roughness = rough; m.metalness = metal;
  m.needsUpdate = true;
}

/** the bump map of a fabric kind: fabric, knit, denim, hair, carpet */
export const weave = (k) => kind(k).normalMap;

// ---- printed cloth: a 256 px tile in the garment's own colours (material colour stays white)
const PATTERNS = {
  // [tile in studs, draw(g, base, second)]
  stripes: [0.75, (g, a, b) => { g.fillStyle = b; g.fillRect(0, 0, 256, 64); g.fillRect(0, 128, 256, 64); }],
  pinstripe: [0.5, (g, a, b) => { g.fillStyle = b; g.fillRect(0, 0, 14, 256); g.fillRect(128, 0, 14, 256); }],
  plaid: [0.9, (g, a, b) => {
    g.fillStyle = b; g.globalAlpha = 0.5;
    for (const p of [20, 148]) { g.fillRect(p, 0, 56, 256); g.fillRect(0, p, 256, 56); }
    g.globalAlpha = 0.9; for (const p of [104, 232]) { g.fillRect(p, 0, 8, 256); g.fillRect(0, p, 256, 8); }
  }],
  dots: [0.7, (g, a, b) => { g.fillStyle = b; for (const [x, y] of [[64, 64], [192, 192]]) { g.beginPath(); g.arc(x, y, 30, 0, Math.PI * 2); g.fill(); } }],
  checks: [0.7, (g, a, b) => { g.fillStyle = b; g.fillRect(0, 0, 128, 128); g.fillRect(128, 128, 128, 128); }],
  camo: [1.6, (g, a, b) => {
    const r = mulberry32(41); g.fillStyle = b;
    for (let i = 0; i < 16; i++) { const x = r() * 256, y = r() * 256, w = 24 + r() * 44, h = 16 + r() * 30; for (const dx of [-256, 0, 256]) for (const dy of [-256, 0, 256]) { g.beginPath(); g.ellipse(x + dx, y + dy, w, h, r() * 3, 0, Math.PI * 2); g.fill(); } }
  }],
};
const cloths = new Map();
/** printed cloth texture: pattern name, base colour, second colour */
export function cloth(name, base, second) {
  const key = [name, base, second].join("|");
  if (!cloths.has(key)) {
    const [tile, draw] = PATTERNS[name] || PATTERNS.stripes;
    const c = document.createElement("canvas"); c.width = c.height = 256;
    const g = c.getContext("2d");
    g.fillStyle = base; g.fillRect(0, 0, 256, 256);
    draw(g, base, second);
    cloths.set(key, finish(c, tile, true));
  }
  return cloths.get(key);
}
export const CLOTH_PATTERNS = Object.keys(PATTERNS);
